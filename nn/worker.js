'use strict';
// Spare-machine worker: complementary compute, not a second copy of the desktop stream.
//
// The desktop publishes ONE gold/silver/bronze set -- the top 3 DISTINCT models on the whole live
// ladder, ranked across every depth, not three per depth. Option 22 is a DATA factory, so it does
// not load uncertainty or try to re-measure the field.  Each NN seat is drawn from those medals by
// shared Elo strength, and each medal plays at the depth of the face that actually earned it.  A
// small slice plays a top fixed production rung, also strength-weighted.  No ladder-vs-ladder games.
// If medals do not exist yet, best.json/pool-slot fallback keeps the worker alive.
// After each chunk this also runs one deliberately tiny rescue mine: at most TWO replay games.
const {execFileSync, spawn}=require('child_process');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const ladderSampling=require('./ladder-sampling.js');
const {loadSeedPoses}=require('./selfplay.js');

function arg(name,dflt){const i=process.argv.indexOf('--'+name);return i>=0?process.argv[i+1]:dflt;}
const dir=__dirname, repoRoot=path.join(dir,'..');
const log=m=>console.log(`\n=== [${new Date().toISOString()}] ${m}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const gamesPerChunk=Math.max(1,+arg('games',120));
const pushEveryMin=Math.max(.5,+arg('pushEveryMin',4));
const workers=Math.max(1,+arg('workers',Math.max(1,Math.min(os.cpus().length-1,12))));
const randomStartFrac=String(arg('randomStartFrac','0.35'));
const seedFrac=Math.max(0,Math.min(1,+arg('seedFrom','0.25')));
const ladderShare=Math.max(0,Math.min(.35,+arg('ladderShare',.10)));
// Cost-weighted fallback depths for best.json only, before medals exist.
const depthMix=String(arg('nnDepthMix','1:0.15,2:1,3:0.07'));
const rescue=arg('rescue','1')!=='0';
const name=(arg('name',os.hostname())||'worker').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,20)||'worker';

const q=s=>'"'+String(s).replace(/"/g,'\\"')+'"';
let gitCmd;
function findGit(){
  if(gitCmd!==undefined)return gitCmd;
  const works=c=>{try{execFileSync(c==='git'?'git':q(c),['--version'],{shell:true,encoding:'utf8',stdio:['ignore','pipe','ignore']});return true;}catch(_){return false;}};
  const candidates=['git'];
  try{
    const base=path.join(process.env.LOCALAPPDATA||'','GitHubDesktop');
    for(const a of fs.readdirSync(base).filter(f=>/^app-/.test(f)).sort().reverse())
      candidates.push(path.join(base,a,'resources','app','git','cmd','git.exe'));
  }catch(_){}
  candidates.push('C:\\Program Files\\Git\\cmd\\git.exe','C:\\Program Files (x86)\\Git\\cmd\\git.exe');
  gitCmd=candidates.find(works)||null; return gitCmd;
}
function git(args){const g=findGit();if(!g)throw new Error('no git found');return execFileSync(g==='git'?'git':q(g),args.map(q),{cwd:repoRoot,shell:true,encoding:'utf8'});}
function gitSoft(args,what){try{git(args);return true;}catch(e){log(`${what} failed (${String(e.stderr||e.message||e).trim().split('\n').slice(0,2).join(' | ')}) — continuing`);return false;}}

function validModel(p){
  try{const j=JSON.parse(fs.readFileSync(p,'utf8'));return !!(j&&(j.dual===true||Array.isArray(j.sizes)));}catch(_){return false;}
}
function uniqueModels(files){
  const seen=new Set(), out=[];
  for(const p of files){
    if(!validModel(p))continue;
    let h;try{h=crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');}catch(_){continue;}
    if(seen.has(h))continue;seen.add(h);out.push(p);
  }
  return out;
}
function slotFallback(){
  const md=path.join(dir,'models'), slots=[];
  try{for(const f of fs.readdirSync(md)){const m=f.match(/^pool-slot-(\d+)\.json$/);if(m){const p=path.join(md,f);if(validModel(p))slots.push({n:+m[1],p});}}}catch(_){}
  return slots.sort((a,b)=>b.n-a.n).slice(0,3).map(x=>x.p);
}
// medals.json carries the face depth and fitted Elo that earned each alias.  Both matter: strength
// decides how often the medal is sampled; depth decides how that exact rated face plays.
function readMedals(){
  const medalDir=path.join(dir,'medals');
  let meta=null; try{meta=JSON.parse(fs.readFileSync(path.join(medalDir,'medals.json'),'utf8'));}catch(_){}
  const out=[];
  for(const name of ['gold','silver','bronze']){
    const p=path.join(medalDir,`${name}.json`), r=meta&&meta.medals&&meta.medals[name];
    if(!validModel(p))continue;
    const d=r&&r.depth;
    out.push({name,path:p,depth:[1,2,3,4].includes(+d)?+d:2,
      elo:r&&Number.isFinite(+r.elo)?+r.elo:null,rankLo:r&&Number.isFinite(+r.rankLo)?+r.rankLo:null});
  }
  return out;
}
function laneDepths(n){
  const weights={};
  for(const part of depthMix.split(',')){const [d,w]=part.split(':').map(Number);if([1,2,3].includes(d)&&w>0)weights[d]=w;}
  const ds=Object.keys(weights).map(Number),sum=ds.reduce((s,d)=>s+weights[d],0)||1;
  if(!ds.length)return Array(n).fill(2);
  const exact=ds.map(d=>({d,x:n*weights[d]/sum})),counts={};let used=0;
  for(const e of exact){counts[e.d]=Math.floor(e.x);used+=counts[e.d];}
  exact.sort((a,b)=>(b.x-Math.floor(b.x))-(a.x-Math.floor(a.x)));
  for(let i=0;i<n-used;i++)counts[exact[i%exact.length].d]++;
  const out=[];for(const d of ds.sort((a,b)=>a-b))for(let i=0;i<counts[d];i++)out.push(d);
  return out.length?out:Array(n).fill(2);
}

async function pushProgress(files,label){
  const present=files.filter(f=>fs.existsSync(f)); if(!present.length)return;
  let rows=0; for(const f of present)try{rows+=fs.readFileSync(f,'utf8').split('\n').filter(Boolean).length;}catch(_){}
  let staged=false;
  for(const f of present)staged=gitSoft(['add','-f',path.relative(repoRoot,f).replace(/\\/g,'/')],'add')||staged;
  if(!staged)return;
  gitSoft(['commit','-m',`nn: strong worker ${name} ${label} (${rows} rows)`],'commit');
  for(const wait of [0,2000,5000,10000]){
    if(wait)await sleep(wait);
    gitSoft(['pull','--no-edit','--no-rebase'],'pre-push pull');
    if(gitSoft(['push'],'push')){log(`${label}: ${rows} rows pushed`);return;}
  }
  log(`${label}: ${rows} rows committed locally; push will retry next pass`);
}

function championPool(){
  const best=path.join(dir,'models','best.json');
  return {best,slotFallback:slotFallback()};
}

function buildLanes(){
  const {best,slotFallback:fb}=championPool(), medals=readMedals();
  if(!medals.length){
    const depths=laneDepths(workers), levels=ladderSampling.productionTop(3).join(',');
    return {medals:[],profile:null,lanes:Array.from({length:workers},(_,i)=>({model:best,pool:fb,depth:depths[i]||2,label:'best-fallback'})),levels};
  }
  const profile=ladderSampling.factoryProfile(dir,medals,{top:3,ladderGameShare:ladderShare});
  const paths=medals.map(m=>m.path), lanes=[];
  // Primary choice only spreads file loading across aliases.  Once the complete weight map is
  // passed, selfplay-legacy draws BOTH seats independently from all three medals by Elo strength.
  for(let i=0;i<workers;i++){
    const m=medals[i%medals.length],pool=uniqueModels(paths.filter(p=>p!==m.path));
    lanes.push({model:m.path,pool,depth:m.depth,label:`medals/${m.name}`});
  }
  return{medals,profile,lanes,levels:profile.levels.join(',')};
}

function playChunk(chunk){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const built=buildLanes(), lanes0=built.lanes, levels=built.levels;
  const per=Math.max(1,Math.round(gamesPerChunk/workers));
  let seedFile=null;
  if(seedFrac>0){
    const poses=loadSeedPoses(path.join(dir,'data'),400);
    if(poses.length>=20){seedFile=path.join(dir,'data',`w-${name}-${stamp}.seeds`);fs.writeFileSync(seedFile,JSON.stringify(poses));}
  }
  const medalNote=built.medals.length
    ? built.medals.map(m=>`${m.name}@D${m.depth}${Number.isFinite(m.elo)?` E${m.elo.toFixed(0)}`:''}`).join(', ')
    : lanes0.map(l=>`${l.label}@D${l.depth}`).join(', ');
  const mix=built.profile?built.profile.mixString:'nnnn:0.85,nnladder:0.15,ladder:0';
  const modelWeights=built.profile?built.profile.modelWeights:{};
  const depthMap=Object.fromEntries((built.medals||[]).map(m=>[m.name,m.depth]));
  log(`chunk ${chunk}: ${workers} lanes x ${per}; ${medalNote}; strength-only weights `+
      `${Object.entries(modelWeights).map(([k,v])=>`${k}=${v}`).join(' ')||'fallback'}; mix ${mix}; ladder ${levels}`);
  const files=[], lanes=[];
  lanes0.forEach((lane,i)=>{
    const out=path.join(dir,'data',`w-${name}-${stamp}-w${i+1}.jsonl`); files.push(out);
    lanes.push(new Promise(resolve=>{
      // Use legacy directly so this spare machine keeps the explicit medal set instead of the
      // desktop evolutionary wrapper replacing it with the broad live roster.
      const args=[path.join(dir,'selfplay-legacy.js'),'--games',String(per),'--workers','1','--out',out,
        '--model',lane.model,'--levels',levels,'--deep',levels,'--nnDepthMix',`${lane.depth}:1`,
        '--mix',mix,'--randomStartFrac',randomStartFrac,'--modelVarietyFrac','1',
        ...(lane.pool.length?['--modelPool',lane.pool.join(',')]:[]),
        ...(built.medals.length?['--modelPoolWeights',JSON.stringify(modelWeights),'--modelPoolDepths',JSON.stringify(depthMap)]:[]),
        ...(seedFile?['--seedFrom',String(seedFrac),'--seedPool',seedFile]:['--seedFrom','0'])];
      const ch=spawn('node',args,{stdio:['ignore','inherit','inherit'],env:{...process.env,TAU_WORKER:String(i+1)}});
      ch.on('exit',()=>resolve()); ch.on('error',e=>{log(`lane ${i+1} (${lane.label}) failed (${e.message})`);resolve();});
    }));
  });
  const done=Promise.all(lanes); if(seedFile)done.then(()=>{try{fs.unlinkSync(seedFile);}catch(_){}});
  return {files,done,stamp};
}

function runTinyRescue(stamp){
  if(!rescue)return null;
  const medalSummary=path.join(dir,'medals','elo-summary.json');
  const summary=fs.existsSync(medalSummary)?medalSummary:path.join(dir,'elo-summary.json');
  if(!fs.existsSync(summary))return null;
  const out=path.join(dir,'data',`retro-${name}-${stamp}.jsonl`);
  log(`two-step rescue: one seed, at most TWO replay games; medal-aware D1/D2 axis (${path.relative(dir,summary)})`);
  return new Promise(resolve=>{
    const ch=spawn('node',[path.join(dir,'retromine.js'),'--summary',summary,
      '--seeds','1','--maxDepth','2','--seedBottom','6','--bigGuns','1','--probesPerPos','2',
      '--maxReplaysPerSeed','2','--ultimateGuns','1','--randomStartFrac','0.2','--out',out],
      {stdio:['ignore','inherit','inherit']});
    ch.on('exit',()=>resolve(fs.existsSync(out)?out:null));
    ch.on('error',e=>{log(`rescue failed to start (${e.message})`);resolve(null);});
  });
}

async function main(){
  log(`strong worker "${name}" up: ${workers} lanes; strength-only gold/silver/bronze at earned depths; `+
      `${Math.round(ladderShare*100)}% top-rung reference games; no ladder-v-ladder; rescue ${rescue?'on':'off'}`);
  for(let chunk=1;;chunk++){
    gitSoft(['pull','--no-edit','--no-rebase'],'pull');
    const {files,done,stamp}=playChunk(chunk); let finished=false; done.then(()=>finished=true);
    while(!finished){await Promise.race([sleep(pushEveryMin*60000),done]);if(!finished)await pushProgress(files,`chunk ${chunk} running`);}
    const retro=await runTinyRescue(stamp); if(retro)files.push(retro);
    await pushProgress(files,`chunk ${chunk} complete`);
  }
}
main().catch(e=>{console.error('worker failed:',e);process.exitCode=1;});
