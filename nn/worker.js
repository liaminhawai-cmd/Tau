'use strict';
// Spare-machine worker: complementary compute, not a second copy of the desktop stream.
//
// The desktop already publishes pool-slot-NN.json in ascending fitted-Elo percentile order after
// every placement cycle.  This worker therefore treats the highest three slots as its rolling
// bronze/silver/gold set, alongside best.json, and spends most of its clock on D2 with a small D3
// garnish.  After each chunk it runs one deliberately tiny rescue mine: at most TWO replay games.
// If the losing position was already doomed earlier than that, too bad -- this worker is for late
// conversion mistakes, not an all-night archaeological dig through the whole game.
const {execFileSync, spawn}=require('child_process');
const fs=require('fs');
const os=require('os');
const path=require('path');
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
function championPool(){
  const md=path.join(dir,'models'), slots=[];
  try{
    for(const f of fs.readdirSync(md)){
      const m=f.match(/^pool-slot-(\d+)\.json$/); if(!m)continue;
      const p=path.join(md,f); if(validModel(p))slots.push({n:+m[1],p});
    }
  }catch(_){}
  slots.sort((a,b)=>b.n-a.n);
  const out=slots.slice(0,3).map(x=>x.p);
  const best=path.join(md,'best.json'); if(validModel(best))out.unshift(best);
  return [...new Set(out)];
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
  const champs=championPool(), levels=strongLevels();
  const best=champs[0]||path.join(dir,'models','best.json');
  const pool=champs.slice(1);
  const per=Math.max(1,Math.round(gamesPerChunk/workers));
  let seedFile=null;
  if(seedFrac>0){
    const poses=loadSeedPoses(path.join(dir,'data'),400);
    if(poses.length>=20){seedFile=path.join(dir,'data',`w-${name}-${stamp}.seeds`);fs.writeFileSync(seedFile,JSON.stringify(poses));}
  }
  log(`chunk ${chunk}: ${workers} lanes x ${per}; champions ${champs.map(p=>path.basename(p)).join(', ')||'none'}; levels ${levels}; depth mix ${depthMix}`);
  const files=[], lanes=[];
  for(let i=0;i<workers;i++){
    const out=path.join(dir,'data',`w-${name}-${stamp}-w${i+1}.jsonl`); files.push(out);
    lanes.push(new Promise(resolve=>{
      // Use legacy directly so this spare machine keeps the explicit champion set instead of the
      // desktop evolutionary wrapper replacing it with whatever local historical files happen to exist.
      const args=[path.join(dir,'selfplay-legacy.js'),'--games',String(per),'--workers','1','--out',out,
        '--model',best,'--levels',levels,'--deep',levels,'--nnDepthMix',depthMix,
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
  if(!rescue||!fs.existsSync(path.join(dir,'elo-summary.json')))return null;
  const out=path.join(dir,'data',`retro-${name}-${stamp}.jsonl`);
  log('two-step rescue: one seed, at most TWO replay games; D1/D2 axis with strongest measured escape hatch');
  return new Promise(resolve=>{
    const ch=spawn('node',[path.join(dir,'retromine.js'),'--summary',path.join(dir,'elo-summary.json'),
      '--seeds','1','--maxDepth','2','--seedBottom','6','--bigGuns','1','--probesPerPos','2',
      '--maxReplaysPerSeed','2','--ultimateGuns','1','--randomStartFrac','0.2','--out',out],
      {stdio:['ignore','inherit','inherit']});
    ch.on('exit',()=>resolve(fs.existsSync(out)?out:null));
    ch.on('error',e=>{log(`rescue failed to start (${e.message})`);resolve(null);});
  });
}

async function main(){
  log(`strong worker "${name}" up: ${workers} lanes; top-3 published slots + best; mostly D2, small D3; rescue ${rescue?'on':'off'}`);
  for(let chunk=1;;chunk++){
    gitSoft(['pull','--no-edit','--no-rebase'],'pull');
    const {files,done,stamp}=playChunk(chunk); let finished=false; done.then(()=>finished=true);
    while(!finished){await Promise.race([sleep(pushEveryMin*60000),done]);if(!finished)await pushProgress(files,`chunk ${chunk} running`);}
    const retro=await runTinyRescue(stamp); if(retro)files.push(retro);
    await pushProgress(files,`chunk ${chunk} complete`);
  }
}
main().catch(e=>{console.error('worker failed:',e);process.exitCode=1;});
