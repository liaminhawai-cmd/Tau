'use strict';

// Adaptive, multicore league for the four value-net training/shape variants.
// One connected rating graph:
//   4 frozen models x depths 1/2/3 = 12 NN players
//   L7..L11 = 5 occasional ladder anchors
// About 10% of scheduled games are NN-vs-ladder; the rest are NN-vs-NN, including cross-depth.
// Every completed game is added to nn/data and to an append-only league history. Ratings and
// 90% Elo CIs are refreshed continuously. Close/Ctrl-C whenever you like; the state resumes.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { createEngine } = require('./engine.js');

const ROOT = path.resolve(__dirname, '..');
const DIR = __dirname;
const MODELS = path.join(DIR, 'models');
const HOST = os.hostname();
const SAFEHOST = HOST.replace(/[^\w.-]+/g, '_');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
function atomicWrite(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const t = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(t, s);
  fs.renameSync(t, p);
}
function appendFile(dst, src) {
  if (!fs.existsSync(src)) return;
  const b = fs.readFileSync(src);
  if (b.length) fs.appendFileSync(dst, b);
}
function normShape(s) {
  return String(s || '').split(',').map(x => x.trim()).filter(Boolean).join(',');
}
function shapeTag(s) { return normShape(s).replace(/,/g, 'x'); }
function hiddenFromModel(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(j.sizes) && j.sizes.length >= 3 ? j.sizes.slice(1, -1).join(',') : null;
  } catch (_) { return null; }
}
function runSync(cmd, args, label) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${label} failed with exit code ${r.status}`);
}

const shapes = [...new Set([normShape(arg('shapeA', '96,96')), normShape(arg('shapeB', '208'))])];
if (shapes.length !== 2) throw new Error('value league needs two different shapes');
const depths = (arg('depths', '1,2,3') || '').split(',').map(Number).filter(d => d >= 1);
const ladderLevels = (arg('levels', '7,8,9,10,11') || '').split(',').map(Number).filter(n => n >= 1);
const ladderShare = Math.max(0, Math.min(0.5, +arg('ladderShare', 0.10)));
const lanes = Math.max(1, Math.min(+arg('lanes', Math.max(1, Math.min(os.cpus().length - 1, 14))), 14));
const openingPlies = Math.max(0, +arg('openingPlies', 4));
const ciEvery = Math.max(1, +arg('ciEvery', 8));
const bootstrapN = Math.max(20, +arg('bootstrap', 120));
// Same budget for BOTH kinds -- see ensureModel. 40, not train.js's own default of 8, because that
// default exists for run.js's frequent incremental resume-train cadence, not for a one-shot
// from-scratch fit like this; 40 was already the number Torch was getting.
const baseEpochs = Math.max(1, +arg('epochs', 40));
const fresh = process.argv.includes('--fresh');
const prepareOnly = process.argv.includes('--prepareOnly');
const eng = createEngine();
const KOMI = eng.CFG.komiLoss;
const KOMI_WIN_SCORE = 0.5 + KOMI/2;

const leagueDir = path.join(DIR, 'arena-logs', `value-league-${SAFEHOST}`);
const tempDir = path.join(leagueDir, 'tmp');
const RUN_TAG = Date.now().toString(36) + '-' + process.pid;
const statePath = path.join(leagueDir, 'state.json');
const historyPath = path.join(leagueDir, 'games.jsonl');
const standingsPath = path.join(leagueDir, 'standings.txt');
const summaryPath = path.join(leagueDir, 'standings.json');
const dataPath = path.join(DIR, 'data', `value-league-${SAFEHOST}.jsonl`);
fs.mkdirSync(MODELS, { recursive: true });
fs.mkdirSync(tempDir, { recursive: true });
fs.mkdirSync(path.dirname(dataPath), { recursive: true });

function sourceCandidates(kind, hidden) {
  const tag = shapeTag(hidden);
  const generic = kind === 'torch' ? `torch-${HOST}.json` : 'value.json';
  const base = kind === 'torch'
    ? [`torch-${tag}-${HOST}.json`, `shootout-torch-${tag}-${HOST}.json`, generic]
    : [`shootout-js-${tag}-${HOST}.json`, generic];
  return base.map(n => path.join(MODELS, n));
}
function frozenPath(kind, hidden) {
  return path.join(MODELS, `value-league-${kind}-${shapeTag(hidden)}-${HOST}.json`);
}
function ensureModel(kind, hidden) {
  const dest = frozenPath(kind, hidden);
  if (!fresh && fs.existsSync(dest) && hiddenFromModel(dest) === hidden) {
    console.log(`league model ready: ${path.basename(dest)}`);
    return dest;
  }
  // --fresh means retrain, full stop -- so this fallback is skipped too, not just the frozen-dest
  // check above. Without that, --fresh could silently adopt e.g. value.json (option 24's own
  // output, itself just train.js with no --epochs set) and quietly reuse whatever budget trained
  // IT, which is exactly the "epochs nobody chose on purpose" bug this whole fix exists for.
  if (!fresh) for (const src of sourceCandidates(kind, hidden)) {
    if (fs.existsSync(src) && hiddenFromModel(src) === hidden) {
      fs.copyFileSync(src, dest);
      console.log(`froze ${kind} ${hidden}: ${path.basename(src)} -> ${path.basename(dest)}`);
      return dest;
    }
  }
  if (kind === 'torch') {
    runSync('python', [path.join('nn', 'torch-train.py'), '--hidden', hidden, '--epochs', String(baseEpochs), '--out', dest],
      `TRAIN TORCH ${hidden}`);
    runSync('node', [path.join('nn', 'verify-torch-export.js'), dest], `VERIFY TORCH ${hidden}`);
  } else {
    // Same epoch count, same default batch (256 on both sides -- see torch-train-core.py), same
    // data, same weighting: --epochs used to be left unset here, which meant train.js's OWN
    // default of 8 rather than a deliberate choice, against Torch's explicit 40. That is not a
    // framework comparison, it is a training-budget comparison wearing a framework's name -- fixed
    // by passing baseEpochs to both sides instead of specifying it on only one.
    runSync('node', [path.join('nn', 'train.js'), '--hidden', hidden, '--epochs', String(baseEpochs), '--out', dest],
      `TRAIN JS ${hidden}`);
  }
  if (hiddenFromModel(dest) !== hidden) throw new Error(`trained ${kind} model has wrong shape: ${dest}`);
  return dest;
}

const baseModels = [];
for (const hidden of shapes) {
  baseModels.push({ key: `torch-${shapeTag(hidden)}`, label: `Torch ${hidden}`, file: ensureModel('torch', hidden), hidden });
  baseModels.push({ key: `js-${shapeTag(hidden)}`, label: `JS ${hidden}`, file: ensureModel('js', hidden), hidden });
}
if (prepareOnly) process.exit(0);

if (fresh) {
  for (const p of [statePath, historyPath, standingsPath, summaryPath]) {
    try { fs.unlinkSync(p); } catch (_) {}
  }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(tempDir, { recursive: true });
}

const players = [];
for (const m of baseModels) for (const d of depths) {
  players.push({
    id: `${m.key}@D${d}`, kind: 'nn', depth: d,
    spec: `nn:0:${m.file}`, model: m.file,
    label: `${m.label} D${d}`,
  });
}
for (const level of ladderLevels)
  players.push({ id: `L${level}`, kind: 'ladder', level, spec: `L${level}`, label: `L${level}` });
const byId = Object.fromEntries(players.map(p => [p.id, p]));
const nnPlayers = players.filter(p => p.kind === 'nn');
const ladderPlayers = players.filter(p => p.kind === 'ladder');

function emptyState() {
  return { version: 1, created: new Date().toISOString(), updated: new Date().toISOString(), games: 0, ladderGames: 0, pairs: {} };
}
let state = emptyState();
try {
  if (!fresh && fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
} catch (e) {
  console.warn(`state.json unreadable (${e.message}); rebuilding from games.jsonl`);
  state = emptyState();
  if (fs.existsSync(historyPath)) {
    for (const line of fs.readFileSync(historyPath, 'utf8').split('\n').filter(Boolean)) {
      try { const g = JSON.parse(line); applyGameToState(g, false); } catch (_) {}
    }
  }
}

function pairKey(a, b) { return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`; }
function pairN(ps) { return (ps.w||0)+(ps.l||0)+(ps.d||0)+(ps.kw||0)+(ps.kl||0); }
function pairScoreA(ps) {
  return (ps.w||0) + 0.5*(ps.d||0) + KOMI_WIN_SCORE*(ps.kw||0) + (1-KOMI_WIN_SCORE)*(ps.kl||0);
}
function applyGameToState(g, touchUpdated = true) {
  const aid = g.a, bid = g.b;
  const canonical = aid < bid;
  const k = canonical ? `${aid}|${bid}` : `${bid}|${aid}`;
  const ps = state.pairs[k] || (state.pairs[k] = { w:0,l:0,d:0,kw:0,kl:0 });
  let outcome = g.outcome;
  if (!canonical) {
    if (outcome === 'A') outcome = 'B'; else if (outcome === 'B') outcome = 'A';
  }
  if (outcome === 'draw') ps.d++;
  else if (outcome === 'A') { if (g.adjudicated) ps.kw++; else ps.w++; }
  else if (outcome === 'B') { if (g.adjudicated) ps.kl++; else ps.l++; }
  state.games++;
  if ((byId[aid] && byId[aid].kind === 'ladder') || (byId[bid] && byId[bid].kind === 'ladder')) state.ladderGames++;
  if (touchUpdated) state.updated = new Date().toISOString();
}

function gamesOf() {
  const g = Object.fromEntries(players.map(p => [p.id, 0]));
  for (const [k, ps] of Object.entries(state.pairs)) {
    const [a,b] = k.split('|'); const n = pairN(ps);
    if (a in g) g[a] += n;
    if (b in g) g[b] += n;
  }
  return g;
}
function pairGames(a,b) { return pairN(state.pairs[pairKey(a,b)] || {}); }

function fitElo(pairOverride = null) {
  const pairs = pairOverride || state.pairs;
  const ids = players.map(p => p.id);
  const idx = Object.fromEntries(ids.map((id,i) => [id,i]));
  const n = ids.length;
  const score = Array(n).fill(0);
  const games = Array.from({length:n}, () => Array(n).fill(0));
  for (const [k, ps] of Object.entries(pairs)) {
    const [a,b] = k.split('|');
    if (!(a in idx) || !(b in idx)) continue;
    const total = pairN(ps); if (!total) continue;
    const i = idx[a], j = idx[b], sa = pairScoreA(ps);
    score[i] += sa; score[j] += total-sa;
    games[i][j] += total; games[j][i] += total;
  }
  const PRIOR = 1;
  let p = Array(n).fill(1);
  for (let it=0; it<400; it++) {
    const q = Array(n).fill(0);
    for (let i=0;i<n;i++) {
      let den = PRIOR/(p[i]+1);
      for (let j=0;j<n;j++) if (games[i][j]) den += games[i][j]/(p[i]+p[j]);
      q[i] = (score[i]+PRIOR/2)/Math.max(den,1e-12);
    }
    const geo = Math.exp(q.reduce((s,x)=>s+Math.log(Math.max(x,1e-12)),0)/n);
    let delta=0;
    for (let i=0;i<n;i++) { q[i]/=geo; delta=Math.max(delta,Math.abs(q[i]-p[i])); }
    p=q; if (delta<1e-9) break;
  }
  const elo={}; ids.forEach((id,i)=>elo[id]=400*Math.log10(Math.max(p[i],1e-12)));
  const anchor = Number.isFinite(elo.L11) ? elo.L11 : 0;
  for (const id of ids) elo[id] -= anchor;
  return elo;
}

function randn() {
  let u=0,v=0; while(!u)u=Math.random(); while(!v)v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}
function bootstrapCI(B = bootstrapN) {
  const samples = Object.fromEntries(players.map(p => [p.id, []]));
  const entries = Object.entries(state.pairs).filter(([,ps]) => pairN(ps)>0);
  for (let b=0;b<B;b++) {
    const fake={};
    for (const [k,ps] of entries) {
      const n=pairN(ps), p=pairScoreA(ps)/n;
      const sd=Math.sqrt(Math.max(0,n*p*(1-p)));
      const wa=Math.max(0,Math.min(n,Math.round(n*p + sd*randn())));
      fake[k]={w:wa,l:n-wa,d:0,kw:0,kl:0};
    }
    const e=fitElo(fake);
    for (const id of Object.keys(samples)) samples[id].push(e[id]);
  }
  const out={};
  for (const [id,a] of Object.entries(samples)) {
    a.sort((x,y)=>x-y);
    const lo=a[Math.max(0,Math.floor(0.05*(a.length-1)))];
    const hi=a[Math.min(a.length-1,Math.ceil(0.95*(a.length-1)))];
    out[id]={lo,hi};
  }
  return out;
}

function standingsText(elo, ci) {
  const g=gamesOf();
  const rows=players.map(p=>({p,elo:elo[p.id]||0,g:g[p.id]||0,ci:ci[p.id]})).sort((a,b)=>b.elo-a.elo);
  const pct = state.games ? 100*state.ladderGames/state.games : 0;
  const lines=[];
  lines.push('TAU VALUE LEAGUE');
  lines.push(`updated ${new Date().toISOString()}`);
  lines.push(`${state.games} games total | ladder ${state.ladderGames} (${pct.toFixed(1)}%, target ${(100*ladderShare).toFixed(0)}%) | ${lanes} lanes`);
  lines.push('Elo is anchored at L11 = 0. CI is 90%.');
  lines.push('');
  lines.push('OVERALL');
  lines.push('  #     Elo        90% CI    games  player');
  rows.forEach((r,i)=>{
    const enough=r.g>=4 && r.ci && Number.isFinite(r.ci.lo);
    const ciTxt=enough?`${Math.round(r.ci.lo)}..${Math.round(r.ci.hi)}`:'?';
    lines.push(`${String(i+1).padStart(3)}  ${String(Math.round(r.elo)).padStart(6)}  ${ciTxt.padStart(13)}  ${String(r.g).padStart(6)}  ${r.p.label}`);
  });
  for (const d of depths) {
    lines.push(''); lines.push(`DEPTH ${d} MODELS`);
    const rr=rows.filter(r=>r.p.kind==='nn'&&r.p.depth===d);
    rr.forEach((r,i)=>lines.push(`  ${i+1}. ${r.p.label}  Elo ${Math.round(r.elo)}  games ${r.g}`));
  }
  lines.push(''); lines.push('Close/Ctrl-C any time; state is checkpointed after every completed game.');
  return lines.join('\n')+'\n';
}
function writeReport(forceCI=false) {
  const elo=fitElo();
  let ci={};
  try {
    const enoughForCI = state.games >= 8;
    if (enoughForCI && (forceCI || state.games % ciEvery===0)) ci=bootstrapCI();
    else if (fs.existsSync(summaryPath)) ci=JSON.parse(fs.readFileSync(summaryPath,'utf8')).ci || {};
  } catch (_) { ci={}; }
  const g=gamesOf();
  const rows=players.map(p=>({id:p.id,label:p.label,kind:p.kind,depth:p.depth||null,level:p.level||null,
    model:p.model||null,elo:+(elo[p.id]||0).toFixed(1),games:g[p.id]||0,
    eloLo:ci[p.id]&&Number.isFinite(ci[p.id].lo)?+ci[p.id].lo.toFixed(1):null,
    eloHi:ci[p.id]&&Number.isFinite(ci[p.id].hi)?+ci[p.id].hi.toFixed(1):null}));
  const summary={updated:new Date().toISOString(),games:state.games,ladderGames:state.ladderGames,
    ladderShare:state.games?state.ladderGames/state.games:0,targetLadderShare:ladderShare,anchor:'L11=0',rows,ci};
  atomicWrite(summaryPath,JSON.stringify(summary,null,1));
  atomicWrite(standingsPath,standingsText(elo,ci));
  return {elo,ci};
}

const inFlight=new Map();
let stopping=false;
let seq=state.games;
let lastReportGames=-1;

function choosePair(wantLadder) {
  const elo=fitElo();
  const g=gamesOf();
  const candidates=[];
  if (wantLadder) {
    for (const a of nnPlayers) for (const b of ladderPlayers) candidates.push([a,b]);
  } else {
    for (let i=0;i<nnPlayers.length;i++) for (let j=i+1;j<nnPlayers.length;j++) candidates.push([nnPlayers[i],nnPlayers[j]]);
  }
  let best=null,bestScore=-Infinity;
  for (const [a,b] of candidates) {
    const k=pairKey(a,b); if (inFlight.has(k)) continue;
    const ea=elo[a.id]||0, eb=elo[b.id]||0;
    const p=1/(1+Math.pow(10,(eb-ea)/400));
    const close=0.12+4*p*(1-p);
    const need=1/Math.sqrt(1+(g[a.id]||0))+1/Math.sqrt(1+(g[b.id]||0));
    const novelty=1/(1+pairGames(a,b)/4);
    const rungNeed=wantLadder ? 1/Math.sqrt(1+(g[b.id]||0)) : 1;
    const jitter=0.92+0.16*Math.random();
    const score=close*need*novelty*rungNeed*jitter;
    if(score>bestScore){bestScore=score;best=[a,b];}
  }
  return best;
}

function shouldScheduleLadder() {
  const active=inFlight.size;
  const ladderActive=[...inFlight.values()].filter(x=>x.ladder).length;
  const total=state.games+active;
  const ladd=state.ladderGames+ladderActive;
  return ladd < Math.ceil(ladderShare*Math.max(1,total+1));
}

function launchGame(lane) {
  if (stopping) return Promise.resolve();
  const wantLadder=shouldScheduleLadder();
  const pick=choosePair(wantLadder) || choosePair(!wantLadder);
  if(!pick) return new Promise(r=>setTimeout(r,250));
  let [a,b]=pick;
  const k=pairKey(a,b);
  // arena.js gives side A blue in a one-game process. Flip A/B on alternate meetings so colour is balanced.
  if(pairGames(a,b)%2===1) [a,b]=[b,a];
  const token=`${RUN_TAG}-g${String(++seq).padStart(7,'0')}-l${lane}`;
  const resultFile=path.join(tempDir,`${token}.result.jsonl`);
  const dataFile=path.join(tempDir,`${token}.data.jsonl`);
  const childLogDir=path.join(tempDir,`${token}-log`);
  const args=[path.join(DIR,'arena.js'),'--a',a.spec,'--b',b.spec,'--games','1','--openingPlies',String(openingPlies),
    '--idA',a.id,'--idB',b.id,'--resultsJsonl',resultFile,'--saveData',dataFile,'--logDir',childLogDir];
  if(a.kind==='nn')args.push('--depthA',String(a.depth));
  if(b.kind==='nn')args.push('--depthB',String(b.depth));
  inFlight.set(k,{lane,ladder:a.kind==='ladder'||b.kind==='ladder',a:a.id,b:b.id});
  return new Promise(resolve=>{
    const ch=spawn('node',args,{cwd:ROOT,stdio:['ignore','ignore','pipe']});
    let err=''; ch.stderr.on('data',d=>err+=d);
    ch.on('close',code=>{
      inFlight.delete(k);
      try {
        if(code!==0) throw new Error(`arena exit ${code}: ${err.trim()}`);
        const lines=fs.existsSync(resultFile)?fs.readFileSync(resultFile,'utf8').split('\n').filter(Boolean):[];
        if(!lines.length) throw new Error('arena produced no result line');
        const r=JSON.parse(lines[lines.length-1]);
        const game={seq:state.games+1,at:new Date().toISOString(),a:a.id,b:b.id,outcome:r.outcome,
          adjudicated:!!r.adjudicated,plies:r.plies,aIsBlue:r.aIsBlue};
        applyGameToState(game);
        fs.appendFileSync(historyPath,JSON.stringify(game)+'\n');
        atomicWrite(statePath,JSON.stringify(state,null,1));
        appendFile(dataPath,dataFile);
        try{fs.unlinkSync(resultFile);}catch(_){}
        try{fs.unlinkSync(dataFile);}catch(_){}
        try{fs.rmSync(childLogDir,{recursive:true,force:true});}catch(_){}
        if(state.games!==lastReportGames && state.games%ciEvery===0) {
          writeReport(true); lastReportGames=state.games;
        } else writeReport(false);
        const pct=100*state.ladderGames/Math.max(1,state.games);
        process.stdout.write(`\r${state.games} games | ladder ${pct.toFixed(1)}% | running ${inFlight.size}/${lanes} | standings: ${path.relative(ROOT,standingsPath)}   `);
      } catch(e) {
        console.error(`\nlane ${lane}: ${e.message}`);
      }
      resolve();
    });
  });
}

async function laneLoop(i){
  while(!stopping){await launchGame(i);}
}
async function finish(){
  writeReport(true);
  console.log(`\n\nStopped cleanly. ${state.games} completed games are rated.`);
  console.log(`Standings: ${path.relative(ROOT,standingsPath)}`);
  console.log(`JSON:      ${path.relative(ROOT,summaryPath)}`);
  console.log(`History:   ${path.relative(ROOT,historyPath)}`);
  console.log(`Training:  ${path.relative(ROOT,dataPath)}`);
}
let sigCount=0;
process.on('SIGINT',()=>{
  sigCount++;
  if(sigCount===1){stopping=true;console.log('\nStopping after the games already in flight finish...');}
  else process.exit(130);
});

console.log('\n============================================================');
console.log('TAU VALUE LEAGUE');
console.log('============================================================');
console.log(`12 NN identities: 4 frozen models x D${depths.join('/D')}`);
console.log(`ladder anchors: ${ladderPlayers.map(p=>p.label).join(', ')} at ~${Math.round(100*ladderShare)}% of games`);
console.log(`${lanes} arena lanes (arena.js itself is single-core; the league runs lanes in parallel)`);
console.log('NN matchmaking is adaptive: close Elo + underplayed players + underplayed pairings.');
console.log('Cross-depth games are allowed; each model@depth remains a separate rated player.');
console.log(`all completed games -> ${path.relative(ROOT,dataPath)}`);
console.log(`live standings -> ${path.relative(ROOT,standingsPath)}\n`);
writeReport(false);

Promise.all(Array.from({length:lanes},(_,i)=>laneLoop(i+1))).then(finish).catch(e=>{console.error(e);process.exitCode=1;});