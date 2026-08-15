'use strict';
// Spare-machine worker: complementary compute, not a second copy of the desktop stream.
//
// The desktop publishes separate gold/silver/bronze aliases for D1 and D2 from the latest
// confidently-rated pool (rankLo ordering). Each lane plays best + medals for ITS OWN depth, spends
// most of its clock on D2 with a small D3 garnish, and after each chunk runs one deliberately tiny
// rescue mine: at most TWO replay games. If the losing position was already doomed earlier than
// that, too bad -- this worker is for late conversion mistakes, not an all-night archaeological dig.
const {execFileSync, spawn}=require('child_process');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
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
// Cost-weighted: roughly 82% D2, 12% D1, 6% D3 by draw weight before game-length effects.
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
function championPool(depth=2){
  const best=path.join(dir,'models','best.json'), medalDir=path.join(dir,'medals');
  const medalDepth=depth===1?1:2; // scarce D3 games use the proven D2 set until D3 has its own field
  const depthFiles=['gold','silver','bronze'].map(n=>path.join(medalDir,`${n}-d${medalDepth}.json`)).filter(validModel);
  const legacyFiles=['gold','silver','bronze'].map(n=>path.join(medalDir,n+'.json')).filter(validModel);
  const medalFiles=depthFiles.length===3?depthFiles:legacyFiles;
  // First desktop cycle after this code lands will mint medals. Until then, retain the old top-slot
  // fallback so option 22 is never dead just because the aliases have not been published once yet.
  return uniqueModels([best,...(medalFiles.length?medalFiles:slotFallback())]);
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
function strongLevels(){
  try{
    const z=JSON.parse(fs.readFileSync(path.join(dir,'zpd-pool.json'),'utf8'));
    if(Array.isArray(z.levels)&&z.levels.length){
      const u=[...new Set(z.levels.map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
      return u.slice(-Math.min(4,u.length)).join(',');
    }
  }catch(_){}
  return '8,9,10,11';
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

function playChunk(chunk){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const depths=laneDepths(workers), levels=strongLevels();
  const pools={1:championPool(1),2:championPool(2),3:championPool(3)};
  const per=Math.max(1,Math.round(gamesPerChunk/workers));
  let seedFile=null;
  if(seedFrac>0){
    const poses=loadSeedPoses(path.join(dir,'data'),400);
    if(poses.length>=20){seedFile=path.join(dir,'data',`w-${name}-${stamp}.seeds`);fs.writeFileSync(seedFile,JSON.stringify(poses));}
  }
  const depthCounts=depths.reduce((o,d)=>(o[d]=(o[d]||0)+1,o),{});
  log(`chunk ${chunk}: ${workers} lanes x ${per}; lane depths ${Object.entries(depthCounts).map(([d,n])=>`D${d}x${n}`).join(' ')}; levels ${levels}`);
  for(const depth of [1,2])log(`D${depth} champions: ${pools[depth].map(p=>path.relative(dir,p)).join(', ')||'none'}`);
  const files=[], lanes=[];
  for(let i=0;i<workers;i++){
    const depth=depths[i]||2, champs=pools[depth]||pools[2];
    const best=champs[0]||path.join(dir,'models','best.json'), pool=champs.slice(1);
    const out=path.join(dir,'data',`w-${name}-${stamp}-w${i+1}.jsonl`); files.push(out);
    lanes.push(new Promise(resolve=>{
      // Use legacy directly so this spare machine keeps the explicit champion set instead of the
      // desktop evolutionary wrapper replacing it with whatever local historical files happen to exist.
      const args=[path.join(dir,'selfplay-legacy.js'),'--games',String(per),'--workers','1','--out',out,
        '--model',best,'--levels',levels,'--deep',levels,'--nnDepthMix',`${depth}:1`,
        '--randomStartFrac',randomStartFrac,'--modelVarietyFrac','1',
        ...(pool.length?['--modelPool',pool.join(',')]:[]),
        ...(seedFile?['--seedFrom',String(seedFrac),'--seedPool',seedFile]:['--seedFrom','0'])];
      const ch=spawn('node',args,{stdio:['ignore','inherit','inherit'],env:{...process.env,TAU_WORKER:String(i+1)}});
      ch.on('exit',()=>resolve()); ch.on('error',e=>{log(`lane ${i+1} failed (${e.message})`);resolve();});
    }));
  }
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
  log(`strong worker "${name}" up: ${workers} lanes; depth-separated medal pools; mostly D2, small D3; rescue ${rescue?'on':'off'}`);
  for(let chunk=1;;chunk++){
    gitSoft(['pull','--no-edit','--no-rebase'],'pull');
    const {files,done,stamp}=playChunk(chunk); let finished=false; done.then(()=>finished=true);
    while(!finished){await Promise.race([sleep(pushEveryMin*60000),done]);if(!finished)await pushProgress(files,`chunk ${chunk} running`);}
    const retro=await runTinyRescue(stamp); if(retro)files.push(retro);
    await pushProgress(files,`chunk ${chunk} complete`);
  }
}
main().catch(e=>{console.error('worker failed:',e);process.exitCode=1;});
