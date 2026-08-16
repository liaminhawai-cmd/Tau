// Rank every brain we have -- ladder rungs AND neural nets at several search depths -- on ONE
// scale, so retromine.js's interleaved strength ladder can be built from measurement instead of
// guesswork. Output is a fractional rank per net ("wide.json at depth 2 plays like L4.6"), plus a
// live table; retromine.js reads the JSON summary directly for its strength axis.
//
//   node nn/elorank.js [--games 4] [--depths 1,2,3] [--levels 1,2,3,4,5,6,7,8,9,10,11]
//                      [--models a.json,b.json] [--spread 6] [--workers N]
//                      [--out nn/elo-results.json] [--saveData nn/data/elo.jsonl] [--refit]
//
// WHY ELO AND NOT A FULL ROUND ROBIN. A full matrix over ~20 brains is 190 pairs; at the depth-3
// game costs measured in this project (5-8 minutes each) that is days, and most of those cells are
// foregone anyway (L1 vs best-at-D3 tells you nothing you didn't know). Bradley-Terry only needs
// the comparison GRAPH to be connected -- ratings propagate transitively, so a well-chosen sparse
// subset yields the same global ordering for a fraction of the games. The pairing below is built
// for exactly that connectivity (see buildPairs).
//
// PRECISION IS DELIBERATELY LOW. These brains are spiky and non-transitive -- today's data has the
// same net beating L8 and losing to L7 in the same sweep -- so chasing tight confidence intervals
// on any single pairing is wasted compute. A single-number summary that is roughly right across
// the whole field is what the interleaved ladder actually needs; being half a rung off costs
// almost nothing there, while being unranked costs the whole design.
//
// LADDER RUNGS ARE THE ANCHOR. Fitting nets alone would give a self-consistent scale with no
// meaning ("net A is 120 Elo above net B" -- above WHAT?). Including L1..L11 as ordinary players
// makes the fitted ladder Elos a measured yardstick and every net's rank an interpolation against
// it.  Permanent does NOT mean privileged scheduling: once a rung is well measured its need falls
// to the same tiny floor as any settled player and it stops consuming ordinary rating compute.
//
// Raw per-pair results are checkpointed to --out after every pair, so a run that is interrupted
// (or a machine that gets closed) resumes where it stopped instead of replaying. --refit skips
// playing entirely and just re-runs the fit over whatever is already stored.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function atomicWrite(destPath, data) {
  const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, destPath);
}
function atomicCopy(srcPath, destPath) {
  const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(srcPath, tmp);
  fs.renameSync(tmp, destPath);
}

const dir = __dirname;
const modelsDir = path.join(dir, 'models');
const gamesPerPair = Math.max(1, +arg('games', 4));
// Compatibility knob only.  Ladder pairs no longer receive a larger default batch than anything
// else; the adaptive need score below decides whether they deserve to be picked at all.
const ladderGames = Math.max(1, +arg('ladderGames', gamesPerPair));
const depths = (arg('depths', '1,2,3') || '').split(',').map(Number).filter(d => d >= 1);
const levels = (arg('levels', '') || '').split(',').map(Number).filter(n => n >= 1);
const os = require('os');
const workers = Math.max(1, +arg('workers', Math.max(1, Math.min(os.cpus().length - 1, 14))));
const outPath = arg('out', path.join(dir, 'elo-results.json'));
const saveData = arg('saveData', null);
const refitOnly = process.argv.includes('--refit');
const spread = Math.max(0, +arg('spread', 6));
const openingPlies = +arg('openingPlies', 4);
const randomStartFrac = +arg('randomStartFrac', 0);
const budgetHours = +arg('budgetHours', 0);
const KOMI_LOSS = 0.3;
const dryRun = process.argv.includes('--dryrun');
const focusRaw = (arg('focus', '') || '').split(',').map(x => x.trim()).filter(Boolean);
const focusPaths = focusRaw.map(x => path.basename(x, '.json'));
const allowPlayers = new Set((arg('allowPlayers', '') || '').split(',').map(x => x.trim()).filter(Boolean));
const faceAllowed = id => !allowPlayers.size || allowPlayers.has(id);
const summaryPath = arg('summary', null);
const focusPairsOnly = arg('focusPairs', '1') !== '0';
// Kept as a parsed compatibility argument because older launchers pass it, but there is no longer
// an anchor quota/boost.  A rung competes for a game on the same strength/information score.
const anchorShare = Math.min(0.9, Math.max(0, +arg('anchorShare', 0)));
const strengthExplore = Math.min(0.9, Math.max(0.01, +arg('strengthExplore', 0.15)));
// Rungs do not have their own bootstrap rank CI (they define that rank scale), so game count is the
// one honest need proxy for them.  At 12 games a rung is still worth half-need; at the current
// 500+ games it lands on the ordinary uncertainty floor.  A newly-added rung starts at 1 and gets
// first coverage automatically.
const ladderNeedGames = Math.max(1, +arg('ladderNeedGames', 12));
const SEC_PER_WEIGHT = 55;
let totalWeight = 0;
void anchorShare;

// --- who is in the field ----------------------------------------------------------------------
function discoverModels() {
  const explicit = (arg('models', '') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (explicit.length) return explicit;
  let files = [];
  try { files = fs.readdirSync(modelsDir); } catch (e) { return []; }
  const pick = [];
  for (const n of ['best.json', 'wide.json', 'ultra.json', 'deep.json', 'l15_value.json', 'scratch.json'])
    if (files.includes(n)) pick.push(path.join(modelsDir, n));
  const ck = files.filter(f => /^ckpt-\d+\.json$/.test(f))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  if (spread > 0 && ck.length) {
    const step = Math.max(1, Math.floor(ck.length/spread));
    for (let i = 0; i < ck.length && pick.length < 40; i += step) pick.push(path.join(modelsDir, ck[i]));
    const last = path.join(modelsDir, ck[ck.length - 1]);
    if (!pick.includes(last)) pick.push(last);
  }
  let keepDual = [], haveDualRegistry = false;
  try {
    const pop = JSON.parse(fs.readFileSync(path.join(modelsDir, '.dual-pop.json'), 'utf8'));
    if (Array.isArray(pop.active)) {
      haveDualRegistry = true;
      keepDual = pop.active.map(m => m && m.file).filter(f => f && files.includes(f));
    }
  } catch (e) {}
  if (!haveDualRegistry) keepDual = files
    .filter(f => /^dual-(?:(?:control|mut)-\d+-e\d+|pop-\d+-e\d+)\.json$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(-4);
  for (const f of keepDual) pick.push(path.join(modelsDir, f));
  for (const f of focusRaw) {
    const abs = path.isAbsolute(f) ? f : path.resolve(f);
    if (fs.existsSync(abs) && !pick.some(q => path.resolve(q) === abs)) pick.push(abs);
  }
  return pick;
}

function snapshotModels(paths) {
  const snapDir = path.join(modelsDir, '.elo-snapshot');
  const fresh = !fs.existsSync(snapDir);
  try {
    fs.mkdirSync(snapDir, { recursive: true });
    const out = [];
    for (const p of paths) {
      const dest = path.join(snapDir, path.basename(p));
      if (fresh || !fs.existsSync(dest)) atomicCopy(p, dest);
      try {
        const j=JSON.parse(fs.readFileSync(p,'utf8'));
        if(j.policyEntrant===true)for(const key of ['valueFile','policyFile']){
          const src=path.resolve(path.dirname(p),j[key]), dep=path.join(snapDir,path.basename(j[key]));
          if(fresh||!fs.existsSync(dep))atomicCopy(src,dep);
        }
      } catch (_) {}
      out.push(dest);
    }
    if (fresh) console.log(`snapshotted ${out.length} models to ${snapDir} (field frozen for this run)`);
    else console.log(`reusing existing snapshot in ${snapDir} (${out.length} models)`);
    return out;
  } catch (e) {
    console.error(`WARNING: could not snapshot models (${e.message}) -- rating live files, so do ` +
                  `NOT run the trainer at the same time`);
    return paths;
  }
}

const players = [];
function modelKind(file) {
  try { const j=JSON.parse(fs.readFileSync(file,'utf8')); return j.policyEntrant===true?'policy':j.dual===true?'dual':'value'; }
  catch (e) { return 'value'; }
}
let LADDER_N = 11, LADDER_DEFS = [];
try { LADDER_DEFS = require('./engine.js').createEngine().AI_LADDER; LADDER_N = LADDER_DEFS.length; } catch (e) {}
const productionLevels = LADDER_DEFS.length
  ? LADDER_DEFS.map((d,i)=>d && !d.experimental ? i+1 : null).filter(Boolean)
  : Array.from({ length:LADDER_N },(_,i)=>i+1);
const useLevels = levels.length ? levels.filter(l => l <= LADDER_N) : productionLevels;
for (const l of useLevels)
  players.push({ id: `L${l}`, kind: 'ladder', spec: `L${l}`, level: l, label: `L${l}` });
for (const m of snapshotModels(discoverModels())) for (const d of depths) {
  const name = path.basename(m, '.json');
  const kind=modelKind(m);
  if (kind === 'policy') {
    if(d<2)continue;
    const desc=JSON.parse(fs.readFileSync(m,'utf8'));
    const valuePath=path.resolve(path.dirname(m),desc.valueFile), policyPath=path.resolve(path.dirname(m),desc.policyFile);
    const id=`${name}@D${d}`;
    if(faceAllowed(id))players.push({ id, kind:'nn', brain:'policy', spec:`nn:0:${valuePath}`,
                                     depth:d, model:m, policyPath, ab:true,
                                     label:`${desc.label||name} D${d}` });
  } else if (kind !== 'dual') {
    const id=`${name}@D${d}`;
    if(faceAllowed(id))players.push({ id, kind: 'nn', spec: `nn:0:${m}`,
                                     depth: d, model: m, label: `${name} D${d}` });
  } else {
    const bareId=`${name}@D${d}`,policyId=`${name}+P@D${d}`;
    if(faceAllowed(bareId))players.push({ id:bareId, kind:'nn', brain:'dual', spec:`dual:0:${m}`,
                                         depth:d, model:m, label:`${name} D${d}` });
    if(faceAllowed(policyId))players.push({ id:policyId, kind:'nn', brain:'dual', spec:`dual:0:${m}`,
                                           depth:d, model:m, dualPolicy:true, ab:true,
                                           label:`${name}+policy D${d}` });
  }
}

function buildPairs() {
  const pairs = [];
  const add = (a, b) => { if (a && b && a.id !== b.id) pairs.push([a.id, b.id]); };
  const byId = Object.fromEntries(players.map(p => [p.id, p]));
  const ladder = players.filter(p => p.kind === 'ladder');
  const nets = players.filter(p => p.kind === 'nn');
  for (let i = 0; i + 1 < ladder.length; i++) add(ladder[i], ladder[i + 1]);
  for (let i = 0; i + 2 < ladder.length; i++) add(ladder[i], ladder[i + 2]);
  const rungSpread = ladder.length >= 4
    ? [ladder[0], ladder[Math.floor(ladder.length/3)], ladder[Math.floor(2*ladder.length/3)], ladder[ladder.length - 1]]
    : ladder;
  for (const r of rungSpread) for (const n of nets) add(n, r);
  for (let i = 0; i < nets.length; i++) {
    add(nets[i], nets[(i + 1) % nets.length]);
    if (nets.length > 3) add(nets[i], nets[(i + Math.floor(nets.length/2)) % nets.length]);
  }
  const seen = new Set(), uniq = [];
  for (const [a, b] of pairs) {
    const key = a < b ? a + '|' + b : b + '|' + a;
    if (seen.has(key)) continue;
    seen.add(key); uniq.push([byId[a], byId[b]]);
  }
  return uniq;
}
void buildPairs;

const store = (() => {
  try { return JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) { return { results: {} }; }
})();
store.results = store.results || {};
const keyOf = (a, b) => `${a.id}|${b.id}`;

const inboxPath = arg('inbox', path.join(dir, 'elo-inbox.jsonl'));
(function drainInbox() {
  let txt;
  try { txt = fs.readFileSync(inboxPath, 'utf8'); } catch (e) { return; }
  let merged = 0, skipped = 0;
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (!r.a || !r.b) { skipped++; continue; }
      const k = `${r.a}|${r.b}`, prev = store.results[k] || { w: 0, l: 0, d: 0 };
      store.results[k] = { w: prev.w + (+r.w || 0), l: prev.l + (+r.l || 0), d: (prev.d || 0) + (+r.d || 0) };
      merged++;
    } catch (e) { skipped++; }
  }
  if (merged) {
    atomicWrite(outPath, JSON.stringify(store, null, 1));
    try { fs.unlinkSync(inboxPath); } catch (e) {}
    console.log(`merged ${merged} result line(s) from ${path.basename(inboxPath)}` +
                (skipped ? ` (${skipped} unreadable, left out)` : ''));
  }
})();

const focusField = Math.max(0, +arg('focusField', 8));
if (focusPaths.length && focusPairsOnly && focusField > 0) {
  const nnPlayers = players.filter(p => p.kind === 'nn');
  const isFocus = p => focusPaths.includes(path.basename(p.model, '.json'));
  const others = nnPlayers.filter(p => !isFocus(p));
  if (others.length > focusField) {
    const prior = fitBT(players.map(p => p.id), store.results);
    const rated = others.filter(p => (prior[p.id] || 0) !== 0);
    const fallback = rated.length ? Math.max(...rated.map(p => prior[p.id])) : 0;
    const anchors = nnPlayers.filter(isFocus).map(p => prior[p.id] || fallback);
    const dist = p => Math.min(...anchors.map(a => Math.abs((prior[p.id] || 0) - a)));
    const keep = new Set(others.sort((x, y) => dist(x) - dist(y)).slice(0, focusField).map(p => p.id));
    for (let i = players.length - 1; i >= 0; i--)
      if (players[i].kind === 'nn' && !isFocus(players[i]) && !keep.has(players[i].id))
        players.splice(i, 1);
    console.log(`focus mode: ${players.filter(p => p.kind === 'nn' && isFocus(p)).length} model(s) ` +
                `being placed against the ${keep.size} nearest-rated of ${others.length} pool ` +
                `members, plus ${players.filter(p => p.kind === 'ladder').length} permanent ladder rungs`);
  }
}

const SIDE_COST = p => {
  if (p.kind === 'ladder') return p.level <= 5 ? 1 : p.level <= 7 ? 2 : p.level <= 9 ? 4 : 5;
  return p.depth >= 3 ? 4 : p.depth === 2 ? 2.5 : 1;
};
const pairWeight = (a, b) => (SIDE_COST(a) + SIDE_COST(b))*
  ((a.kind === 'ladder' && b.kind === 'ladder') ? ladderGames : gamesPerPair);
let doneWeight = 0, startedAt = 0;
let consecutiveFailures = 0, stopAll = false;
const FAIL_LIMIT = 8;
const fmtDur = s => s >= 3600 ? `${(s/3600).toFixed(1)}h` : `${Math.round(s/60)}m`;
void pairWeight;void doneWeight;void totalWeight;void SEC_PER_WEIGHT;

function playPair(a, b) {
  return new Promise(resolve => {
    const bothLadder = a.kind === 'ladder' && b.kind === 'ladder';
    const n = bothLadder ? ladderGames : gamesPerPair;
    const args = [path.join(dir, 'arena.js'), '--a', a.spec, '--b', b.spec,
                  '--games', String(n), '--openingPlies', String(openingPlies),
                  '--idA', a.id, '--idB', b.id];
    if (randomStartFrac > 0) args.push('--randomStartFrac', String(randomStartFrac));
    if (a.kind === 'nn') args.push('--depthA', String(a.depth));
    if (b.kind === 'nn') args.push('--depthB', String(b.depth));
    if (a.dualPolicy) args.push('--dualPolicyA');
    if (b.dualPolicy) args.push('--dualPolicyB');
    if (a.policyPath) args.push('--policyA', a.policyPath);
    if (b.policyPath) args.push('--policyB', b.policyPath);
    if (a.ab) args.push('--abA');
    if (b.ab) args.push('--abB');
    if (saveData) args.push('--saveData', saveData);
    execFile('node', args, { encoding: 'utf8', maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      const m = [...String(stdout || '').matchAll(/:\s*(\d+)-(\d+)(?:-(\d+))?\s+\(/g)];
      if (!m.length) {
        const why = String(stderr || (err && err.message) || '').trim().split('\n')
          .filter(Boolean).slice(-2).join(' | ');
        console.log(`  ! no result for ${a.label} vs ${b.label}` + (why ? `: ${why}` : ''));
        if (++consecutiveFailures >= FAIL_LIMIT) {
          console.error(`\n${consecutiveFailures} games in a row produced no result -- arena.js is ` +
                        `failing, not the brains. Stopping rather than burning the budget.`);
          stopAll = true;
        }
        return resolve();
      }
      consecutiveFailures = 0;
      const last = m[m.length - 1];
      const kk = [...String(stdout || '').matchAll(/\(komi (\d+)-(\d+)/g)];
      const kA = kk.length ? +kk[kk.length - 1][1] : 0, kB = kk.length ? +kk[kk.length - 1][2] : 0;
      const w = +last[1] + KOMI_LOSS*kA, l = +last[2] + KOMI_LOSS*kB;
      const d = +(last[3] || 0) + (1 - KOMI_LOSS)*(kA + kB);
      record(a, b, w, l, d);
      atomicWrite(outPath, JSON.stringify(store, null, 1));
      const gs = gamesOf(), least = Math.round(Math.min(...players.map(p => gs[p.id] || 0)));
      const elapsedMin = (Date.now() - startedAt)/60000;
      const leftNote = budgetHours > 0
        ? `~${fmtDur(Math.max(0, budgetHours*3600 - elapsedMin*60))} left`
        : `${Math.round(elapsedMin)}m elapsed`;
      const conf = Number.isFinite(globalThis.__lastWorst)
        ? `, worst rank CI +-${globalThis.__lastWorst.toFixed(2)}` : '';
      console.log(`  ${a.label} vs ${b.label}: ${w}-${l}${d ? '-' + d : ''}` +
                  `   [min games ${least}${conf}, ${leftNote}]`);
      resolve();
    });
  });
}

function fitBT(ids, results) {
  const idx = Object.fromEntries(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const wins = Array(n).fill(0);
  const games = Array.from({ length: n }, () => Array(n).fill(0));
  for (const [key, r] of Object.entries(results)) {
    const [ai, bi] = key.split('|');
    if (!(ai in idx) || !(bi in idx)) continue;
    const i = idx[ai], j = idx[bi];
    const total = r.w + r.l + (r.d || 0);
    if (!total) continue;
    wins[i] += r.w + (r.d || 0)/2;
    wins[j] += r.l + (r.d || 0)/2;
    games[i][j] += total; games[j][i] += total;
  }
  const PRIOR = 1.0;
  let p = Array(n).fill(1);
  for (let iter = 0; iter < 500; iter++) {
    const next = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let denom = PRIOR/(p[i] + 1);
      for (let j = 0; j < n; j++) if (games[i][j]) denom += games[i][j]/(p[i] + p[j]);
      next[i] = (wins[i] + PRIOR/2)/Math.max(denom, 1e-12);
    }
    const geo = Math.exp(next.reduce((a, v) => a + Math.log(Math.max(v, 1e-12)), 0)/n);
    for (let i = 0; i < n; i++) next[i] /= geo;
    let delta = 0;
    for (let i = 0; i < n; i++) delta = Math.max(delta, Math.abs(next[i] - p[i]));
    p = next;
    if (delta < 1e-9) break;
  }
  const elo = {};
  ids.forEach((id, i) => { elo[id] = 400*Math.log10(Math.max(p[i], 1e-12)); });
  return elo;
}

function rankOf(eloVal, ladderElos) {
  const pts = ladderElos.slice().sort((a, b) => a.elo - b.elo);
  if (pts.length < 2) return { rank: NaN, edge: 'noscale' };
  if (eloVal <= pts[0].elo) return { rank: pts[0].level, edge: 'below' };
  if (eloVal >= pts[pts.length - 1].elo) return { rank: pts[pts.length - 1].level, edge: 'above' };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (eloVal >= a.elo && eloVal <= b.elo) {
      const t = (eloVal - a.elo)/Math.max(b.elo - a.elo, 1e-9);
      return { rank: a.level + t*(b.level - a.level), edge: null };
    }
  }
  return { rank: pts[pts.length - 1].level, edge: 'above' };
}
function extrapolatedRankOf(eloVal, ladderElos) {
  const pts = ladderElos.slice().sort((a, b) => a.elo - b.elo);
  if (pts.length < 2 || !Number.isFinite(eloVal)) return NaN;
  const measured = rankOf(eloVal, pts);
  if (!measured.edge) return measured.rank;
  const high = measured.edge === 'above';
  const local = high ? pts.slice(-Math.min(4, pts.length)) : pts.slice(0, Math.min(4, pts.length));
  const gaps = [];
  for (let i = 1; i < local.length; i++) {
    const dl = local[i].level - local[i-1].level, de = local[i].elo - local[i-1].elo;
    if (dl > 0 && de > 0) gaps.push(de/dl);
  }
  if (!gaps.length) return NaN;
  gaps.sort((a,b)=>a-b);
  const mid = Math.floor(gaps.length/2);
  const eloPerLevel = gaps.length%2 ? gaps[mid] : (gaps[mid-1]+gaps[mid])/2;
  const anchor = high ? pts[pts.length-1] : pts[0];
  return anchor.level + (eloVal-anchor.elo)/Math.max(eloPerLevel,1e-9);
}

function bootstrapRanks(B) {
  const ids = players.map(p => p.id);
  const nets = players.filter(p => p.kind === 'nn');
  const samples = Object.fromEntries(nets.map(p => [p.id, []]));
  let skipped = 0;
  const entries = Object.entries(store.results);
  for (let b = 0; b < B; b++) {
    const res = {};
    for (const [key, r] of entries) {
      const n = r.w + r.l + (r.d || 0);
      if (!n) continue;
      const N = Math.max(1, Math.round(n));
      let w = 0, l = 0, d = 0;
      for (let i = 0; i < N; i++) {
        const u = Math.random()*n;
        if (u < r.w) w++; else if (u < r.w + r.l) l++; else d++;
      }
      res[key] = { w, l, d };
    }
    const elo = fitBT(ids, res);
    const g = {};
    for (const [key, r] of entries) {
      const [x, y] = key.split('|'); const t = r.w + r.l + (r.d || 0);
      g[x] = (g[x] || 0) + t; g[y] = (g[y] || 0) + t;
    }
    const rungs = players.filter(p => p.kind === 'ladder')
      .map(p => ({ level: p.level, elo: elo[p.id], games: g[p.id] || 0 }))
      .sort((a, c) => a.level - c.level)
      .filter(r => r.games >= 6);
    const scale = [];
    for (const r of rungs) if (!scale.length || r.elo > scale[scale.length - 1].elo) scale.push(r);
    if (scale.length < 2) { skipped++; continue; }
    for (const p of nets) {
      const rk = rankOf(elo[p.id], scale);
      rk.extrapRank = extrapolatedRankOf(elo[p.id], scale);
      if (Number.isFinite(rk.rank)) samples[p.id].push(rk);
    }
  }
  const out = {};
  for (const p of nets) {
    const order = r => r.rank + (r.edge === 'above' ? 0.5 : r.edge === 'below' ? -0.5 : 0);
    const v = samples[p.id].sort((a, c) => order(a) - order(c));
    if (v.length >= 10) {
      const lo = v[Math.floor(0.05*v.length)], hi = v[Math.floor(0.95*v.length)];
      const xv = v.filter(r=>Number.isFinite(r.extrapRank)).slice().sort((a,b)=>a.extrapRank-b.extrapRank);
      const xlo = xv.length >= 10 ? xv[Math.floor(0.05*xv.length)].extrapRank : NaN;
      const xhi = xv.length >= 10 ? xv[Math.floor(0.95*xv.length)].extrapRank : NaN;
      out[p.id] = { lo:lo.rank, hi:hi.rank, loEdge:lo.edge || null, hiEdge:hi.edge || null,
        xLo:xlo, xHi:xhi, n:v.length };
    } else out[p.id] = { lo:NaN, hi:NaN, loEdge:null, hiEdge:null, xLo:NaN, xHi:NaN, n:v.length };
  }
  return { ci: out, skipped, B };
}

function worstRankHalfWidth(ci) {
  let worst = 0, anyMissing = false;
  for (const p of players) {
    if (p.kind !== 'nn') continue;
    if (focusPaths.length && focusPairsOnly && !focusPaths.includes(path.basename(p.model, '.json'))) continue;
    const c = ci[p.id];
    if (!c || !Number.isFinite(c.lo) || c.loEdge || c.hiEdge) { anyMissing = true; continue; }
    worst = Math.max(worst, (c.hi - c.lo)/2);
  }
  return anyMissing ? Infinity : worst;
}

function report() {
  const ids = players.map(p => p.id);
  const elo = fitBT(ids, store.results);
  const played = {};
  for (const [key, r] of Object.entries(store.results)) {
    const [a, b] = key.split('|'); const t = r.w + r.l + (r.d || 0);
    played[a] = (played[a] || 0) + t; played[b] = (played[b] || 0) + t;
  }
  const MIN_RUNG_GAMES = 6;
  const rungsAll = players.filter(p => p.kind === 'ladder')
    .map(p => ({ level: p.level, elo: elo[p.id], games: played[p.id] || 0 }))
    .sort((a, b) => a.level - b.level);
  const wellPlayed = rungsAll.filter(r => r.games >= MIN_RUNG_GAMES);
  const ladderElos = [], droppedRungs = [];
  for (const r of wellPlayed) {
    if (ladderElos.length && r.elo <= ladderElos[ladderElos.length - 1].elo) { droppedRungs.push(r); continue; }
    ladderElos.push(r);
  }
  const thinRungs = rungsAll.filter(r => r.games < MIN_RUNG_GAMES);
  const rows = players.map(p => {
    const e = elo[p.id];
    const rk = p.kind === 'nn' ? rankOf(e, ladderElos) : { rank: p.level, edge: null };
    const extrapRank = p.kind === 'nn' && rk.edge ? extrapolatedRankOf(e, ladderElos) : null;
    return { p, elo: e, rank: rk.rank, edge: rk.edge, extrapRank,
      games: Math.round(played[p.id] || 0) };
  }).sort((a, b) => a.elo - b.elo);

  console.log(`\n=== fitted ranking (${Object.keys(store.results).length} pairs, ` +
              `${Math.round(Object.values(store.results).reduce((s, r) => s + r.w + r.l + (r.d || 0), 0))} games) ===`);
  const MIN_GAMES = 4;
  const boot = bootstrapRanks(+arg('bootstrap', 150));
  const tty = process.stdout.isTTY;
  const rung = s => tty ? `\x1b[1m\x1b[4m${s}\x1b[0m` : s;
  console.log('  rating  rank    measured 90% CI      extrapolated rank / 90% CI       games  brain');
  for (const r of rows) {
    const thin = r.games < MIN_GAMES;
    const rankCell = r.p.kind !== 'nn' ? '  -  '
      : thin || r.edge === 'noscale' || !Number.isFinite(r.rank) ? '    ?'
      : r.edge ? (r.edge === 'above' ? '>' : '<') + String(r.rank).padStart(4)
      : r.rank.toFixed(2).padStart(5);
    const c = boot.ci[r.p.id];
    const ciBound = (v, edge) => edge === 'above' ? `>L${v.toFixed(1)}`
      : edge === 'below' ? `<L${v.toFixed(1)}` : `L${v.toFixed(1)}`;
    const ciCell = r.p.kind !== 'nn' ? '                  '
      : (c && Number.isFinite(c.lo)) ? `${ciBound(c.lo,c.loEdge)} - ${ciBound(c.hi,c.hiEdge)}`.padStart(18)
      : '(not yet)'.padStart(18);
    const xCell = r.p.kind === 'nn' && Number.isFinite(r.extrapRank)
      ? (`xL${r.extrapRank.toFixed(1)}` +
         (c && Number.isFinite(c.xLo) ? ` [xL${c.xLo.toFixed(1)} - xL${c.xHi.toFixed(1)}]` : '')).padStart(32)
      : ''.padStart(32);
    const line = `  ${String(Math.round(r.elo)).padStart(6)}  ${rankCell}  ${ciCell}  ${xCell}  ` +
                 `${String(r.games).padStart(5)}  ${r.p.label}${thin ? '  (too few games)' : ''}`;
    console.log(r.p.kind === 'ladder' ? rung(line) : line);
  }
  if (boot.skipped)
    console.log(`\n(${boot.skipped}/${boot.B} bootstrap resamples had an unusable ladder and were ` +
                `skipped -- a high share here means the yardstick still needs games, not the nets)`);
  if (thinRungs.length)
    console.log(`\n(yardstick: L${thinRungs.map(r => r.level).join(', L')} have under ${MIN_RUNG_GAMES} ` +
                `games and are not used for interpolation yet)`);
  if (droppedRungs.length)
    console.log(`(yardstick: L${droppedRungs.map(r => r.level).join(', L')} rated BELOW a lower rung -- ` +
                `excluded from interpolation. Either they need more games, or the ladder really is ` +
                `out of order there, which is worth knowing either way.)`);
  if (ladderElos.length < 2)
    console.log(`(too few usable rungs to interpolate any rank yet -- let ordinary adaptive coverage finish)`);

  if (summaryPath) {
    const out = { updated: new Date().toISOString(), players: {} };
    for (const r of rows) {
      const c = boot.ci[r.p.id];
      out.players[r.p.id] = {
        kind: r.p.kind, elo: +r.elo.toFixed(1), games: r.games,
        ...(r.p.kind === 'nn' ? {
          model: r.p.model, depth: r.p.depth, brain: r.p.brain || 'nn',
          dualPolicy: !!r.p.dualPolicy,
          rank: Number.isFinite(r.rank) && !r.edge ? +r.rank.toFixed(2) : null,
          rankLo: c && Number.isFinite(c.lo) ? +c.lo.toFixed(2) : null,
          rankHi: c && Number.isFinite(c.hi) ? +c.hi.toFixed(2) : null,
          rankLoEdge: c && c.loEdge ? c.loEdge : null,
          rankHiEdge: c && c.hiEdge ? c.hiEdge : null,
          extrapRank: Number.isFinite(r.extrapRank) ? +r.extrapRank.toFixed(2) : null,
          extrapRankLo: c && Number.isFinite(c.xLo) ? +c.xLo.toFixed(2) : null,
          extrapRankHi: c && Number.isFinite(c.xHi) ? +c.xHi.toFixed(2) : null,
        } : { level: r.p.level }),
      };
    }
    try {
      atomicWrite(summaryPath, JSON.stringify(out, null, 1));
      console.log(`\nratings written to ${summaryPath}`);
    } catch (e) { console.error(`could not write ${summaryPath} (${e.message})`); }
  }

  const thinCount = rows.filter(r => r.p.kind === 'nn' && r.games < MIN_GAMES).length;
  if (thinCount) console.log(`\n(${thinCount} brains have fewer than ${MIN_GAMES} games and are left ` +
                             `unranked -- re-run --refit later, or let the run finish)`);
  const above = rows.filter(r => r.p.kind === 'nn' && r.edge === 'above');
  const topUsable = ladderElos.length ? ladderElos[ladderElos.length - 1].level : LADDER_N;
  if (above.length)
    console.log(`\n(${above.map(r => r.p.label).join(', ')} rated above L${topUsable}, the top rung in ` +
                `this fit -- no rung to interpolate a ladder rank against, so rank shows ">"; ` +
                `their Elo is still exact)`);
}

function record(a, b, w, l, d) {
  const k = keyOf(a, b), prev = store.results[k] || { w: 0, l: 0, d: 0 };
  store.results[k] = { w: prev.w + w, l: prev.l + l, d: (prev.d || 0) + d };
}

const gamesOf = () => {
  const n = {};
  for (const [key, r] of Object.entries(store.results)) {
    const [a, b] = key.split('|'); const t = r.w + r.l + (r.d || 0);
    n[a] = (n[a] || 0) + t; n[b] = (n[b] || 0) + t;
  }
  return n;
};
const pairGamesOf = () => {
  const n = {};
  for (const [key, r] of Object.entries(store.results)) {
    const [a, b] = key.split('|'); const t = r.w + r.l + (r.d || 0);
    const k = a < b ? a + '|' + b : b + '|' + a;
    n[k] = (n[k] || 0) + t;
  }
  return n;
};

// Pick the most informative matchup available right now.  Every player now uses the same basic
// competition: close expected result x remaining need x strength/exploration x pair novelty / CPU.
// NN need comes from its bootstrapped rank CI.  A rung has no rank CI of its own because it defines
// the scale, so its permanent game count supplies the need term instead.  There is deliberately no
// rung boost, anchor quota, mixed-pair privilege or "ladder is never done" exception anymore.
let lastCI = null;
const UNC_REF = 1.0;
const UNC_FLOOR = 0.05;
function uncertaintyOf(p, g) {
  if (!(g[p.id] > 0)) return 1;
  if (p.kind === 'ladder')
    return Math.max(UNC_FLOOR, Math.min(1, ladderNeedGames/(ladderNeedGames + (g[p.id] || 0))));
  const c = lastCI && lastCI[p.id];
  if (!c || !Number.isFinite(c.lo) || !Number.isFinite(c.hi)) return 1;
  return Math.max(UNC_FLOOR, Math.min(1, ((c.hi - c.lo)/2)/UNC_REF));
}

function pickPair(elo, inFlight) {
  const g = gamesOf(), pg = pairGamesOf();
  const allElos = players.map(p=>elo[p.id]).filter(Number.isFinite);
  const minE = allElos.length ? Math.min(...allElos) : 0;
  const maxE = allElos.length ? Math.max(...allElos) : 0;
  const span = Math.max(1, maxE-minE);
  // Same standing scale for EVERY player.  Ladder identity remains special only for reporting and
  // retirement immunity; its fitted strength no longer gets silently hard-coded to 1.
  const standing = p => strengthExplore + (1-strengthExplore)*
    Math.max(0, Math.min(1, ((elo[p.id]||0)-minE)/span));
  const priority = (a, b) => (uncertaintyOf(a, g) + uncertaintyOf(b, g))*
    Math.sqrt(standing(a)*standing(b));

  let best = null, bestScore = -Infinity;
  let bestNew = null, bestNewScore = -Infinity;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const k = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
      if (inFlight.has(k)) continue;
      if (focusPaths.length && focusPairsOnly) {
        const inFocus = q => q.kind === 'nn' && focusPaths.includes(path.basename(q.model, '.json'));
        if (!inFocus(a) && !inFocus(b)) continue;
      }
      const bothLadder = a.kind === 'ladder' && b.kind === 'ladder';
      if (bothLadder && Math.abs(a.level - b.level) > 2) continue;
      const pExp = 1/(1 + Math.pow(10, ((elo[b.id] || 0) - (elo[a.id] || 0))/400));
      const closeness = 4*pExp*(1 - pExp);
      const novelty = 1/(1 + (pg[k] || 0)/gamesPerPair);
      const cpuCost = Math.sqrt(SIDE_COST(a)+SIDE_COST(b));
      const score = (0.15 + closeness)*priority(a, b)*novelty/cpuCost;
      if (score > bestScore) { bestScore = score; best = [a, b]; }
      if ((!(g[a.id] > 0) || !(g[b.id] > 0)) && score > bestNewScore) {
        bestNewScore = score; bestNew = [a, b];
      }
    }
  }
  return bestNew || best;
}

async function main() {
  if (refitOnly) { report(); return; }
  const targetGames = Math.max(1, +arg('targetGames', 12));
  const rankTolerance = +arg('rankTolerance', 0.5);
  console.log(`elorank: ${players.length} brains, ${workers} lanes, adaptive pairing ` +
              `(close rating + need + shared strength/exploration + CPU cost), ${gamesPerPair} games per matchup`);
  console.log(`  ladder rungs are permanent but ordinary: count-need reference ${ladderNeedGames} games, `+
              `settled floor ${UNC_FLOOR}`);
  console.log(`  stops when every net's rank is known to +-${rankTolerance} rungs (90% CI)` +
              (budgetHours > 0 ? `, or at ${budgetHours}h` : '') + `, whichever comes first`);
  const already = Object.keys(store.results).length;
  if (already) console.log(`resuming: ${already} matchups already stored`);
  if (dryRun) { console.log('(--dryrun: nothing played)'); return; }

  startedAt = Date.now();
  const inFlight = new Set();
  let stop = false, checksSinceBoot = 0;
  const outOfTime = () => budgetHours > 0 && (Date.now() - startedAt)/3600000 >= budgetHours;

  const lane = async () => {
    for (;;) {
      if (stop || stopAll || outOfTime()) return;
      const g = gamesOf();
      const mustCover = focusPaths.length && focusPairsOnly
        ? players.filter(p => p.kind === 'nn' && focusPaths.includes(path.basename(p.model, '.json')))
        : players;
      if (mustCover.length && mustCover.every(p => (g[p.id] || 0) >= targetGames)) { stop = true; return; }
      if (checksSinceBoot++ >= workers && players.some(p => (g[p.id] || 0) >= 6)) {
        checksSinceBoot = 0;
        const { ci } = bootstrapRanks(80);
        lastCI = ci;
        if (rankTolerance > 0 && mustCover.every(p => (g[p.id] || 0) >= 6)) {
          const worst = worstRankHalfWidth(ci);
          globalThis.__lastWorst = worst;
          if (worst <= rankTolerance) {
            console.log(`\nevery net's rank now known to +-${worst.toFixed(2)} rungs ` +
                        `(target ${rankTolerance}) -- stopping`);
            stop = true; return;
          }
        }
      }
      const elo = fitBT(players.map(p => p.id), store.results);
      const pick = pickPair(elo, inFlight);
      if (!pick) return;
      const [a, b] = pick;
      const k = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
      inFlight.add(k);
      try { await playPair(a, b); } finally { inFlight.delete(k); }
    }
  };
  await Promise.all(Array.from({ length: workers }, lane));
  const mins = ((Date.now() - startedAt)/60000).toFixed(0);
  console.log(`\nplayed for ${mins}m` + (outOfTime() ? ' (time budget reached)' : ' (coverage target reached)'));
  report();
}

main();
