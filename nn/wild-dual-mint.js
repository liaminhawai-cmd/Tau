'use strict';
// Resumable GPU expedition for joint value+policy nets. Each deliberately different shared trunk
// trains in short chunks on one fixed game-level validation split. The best combined validation
// checkpoint survives, training stops only after that peak is clearly behind it, and the finished
// entrants join the active dual roster so the normal Elo trainer rates every one of them.
const fs=require('fs');
const path=require('path');
const {spawn,spawnSync}=require('child_process');
const dir=__dirname, models=path.join(dir,'models'), curves=path.join(dir,'wild-dual-curves');
const statePath=path.join(models,'.wild-dual-mint-state.json');
const popPath=path.join(models,'.dual-pop.json');
const chunkEpochs=Math.max(5,+arg('chunkEpochs',10));
const minEpochs=Math.max(chunkEpochs,+arg('minEpochs',40));
const patienceEpochs=Math.max(chunkEpochs,+arg('patienceEpochs',30));
const maxEpochs=Math.max(minEpochs,+arg('maxEpochs',160));
const minDelta=Math.max(0,+arg('minDelta',0.001));
const seed=+arg('seed',43143);
const batch=Math.max(256,+arg('batch',4096));
const shapes=[
  '256,128',          // wide shared representation, then a taper into both heads
  '128,128,128,128',  // deep uniform trunk: repeated refinement without a bottleneck
  '192,48,192',       // bow-tie: force value and policy through a severe shared bottleneck
  '48,96,192',        // expanding trunk: compress first, then fan out before the heads
  '128,32,128,32',    // alternating bottlenecks: repeatedly discard and rebuild features
];
function arg(n,d){const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;}
function loadJson(p,d){try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(_){return d;}}
function atomicJson(p,j){fs.mkdirSync(path.dirname(p),{recursive:true});const t=`${p}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,JSON.stringify(j,null,2));fs.renameSync(t,p);}
function saveState(s){atomicJson(statePath,s);}
function slug(shape,i){return `dual-wild-${String(i+1).padStart(2,'0')}-${shape.replace(/,/g,'x')}`;}
function cudaReady(){const p=spawnSync('python',['-c','import torch; print("yes" if torch.cuda.is_available() else "no")'],{encoding:'utf8',windowsHide:true});return p.status===0&&String(p.stdout).trim()==='yes';}
function runChild(command,args,onLine){return new Promise((resolve,reject)=>{
  const ch=spawn(command,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});let buf='';
  const eat=x=>{const z=String(x);process.stdout.write(z);buf+=z;let p;while((p=buf.indexOf('\n'))>=0){onLine(buf.slice(0,p));buf=buf.slice(p+1);}};
  ch.stdout.on('data',eat);ch.stderr.on('data',d=>process.stderr.write(d));
  ch.on('error',reject);ch.on('exit',c=>c===0?resolve():reject(new Error(`${command} exited ${c}`)));
});}
async function trainChunk(shape,start,out,lr,onMetric){
  const args=['-u',path.join(dir,'torch-train-dual.py'),'--epochs',String(chunkEpochs),
    '--seed',String(seed),'--lr',String(lr),'--wd','0.0001','--batch',String(batch),
    '--device','cuda','--epochOffset',String(start),'--hidden',shape,'--out',out,
    ...(start>0&&fs.existsSync(out)?['--resume',out]:[])];
  await runChild('python',args,line=>{
    const m=line.match(/epoch\s+(\d+)\/(\d+): train value mse ([0-9.eE+-]+) policy ce ([0-9.eE+-]+) \| val value mse ([0-9.eE+-]+) policy ce ([0-9.eE+-]+) combined ([0-9.eE+-]+) arm top1 ([0-9.]+)% bin top1 ([0-9.]+)%/);
    if(m)onMetric({localEpoch:+m[1],trainValueMse:+m[3],trainPolicyCe:+m[4],valValueMse:+m[5],valPolicyCe:+m[6],score:+m[7],armTop1:+m[8]/100,binTop1:+m[9]/100});
  });
  await runChild(process.execPath,[path.join(dir,'verify-dual-export.js'),out],()=>{});
}
async function trainShape(shape,i,state){
  const id=slug(shape,i), out=path.join(models,id+'.json'), peak=path.join(models,'.'+id+'.peak'), curve=path.join(curves,id+'.jsonl');
  const rec=state.shapes[id]||{shape,totalEpochs:0,bestScore:null,peakEpoch:0,lastImproveEpoch:0,done:false};
  if(rec.done&&fs.existsSync(out)){console.log(`\n[dual-wild] ${id}: already complete at epoch ${rec.peakEpoch}, skipping`);return;}
  if(rec.totalEpochs>0&&!fs.existsSync(out)){console.log(`\n[dual-wild] ${id}: checkpoint missing, restarting this shape`);Object.assign(rec,{totalEpochs:0,bestScore:null,peakEpoch:0,lastImproveEpoch:0});}
  fs.mkdirSync(curves,{recursive:true});
  console.log(`\n================ ${id}  trunk ${shape} ================`);
  while(rec.totalEpochs<maxEpochs){
    const start=rec.totalEpochs, lr=Math.max(0.00008,0.001*Math.pow(0.85,Math.floor(start/chunkEpochs))), metrics=[];
    console.log(`[dual-wild] ${id}: epochs ${start+1}-${start+chunkEpochs}, lr ${lr.toFixed(6)}, backend torch-cuda`);
    await trainChunk(shape,start,out,lr,m=>{const row={...m,epoch:start+m.localEpoch,shape,id,at:new Date().toISOString()};metrics.push(row);fs.appendFileSync(curve,JSON.stringify(row)+'\n');});
    rec.totalEpochs=start+chunkEpochs;
    const chunkBest=metrics.reduce((a,b)=>!a||b.score<a.score?b:a,null);
    if(!chunkBest)throw new Error('trainer produced no readable validation metrics');
    if(rec.bestScore==null||chunkBest.score<rec.bestScore-minDelta){
      rec.bestScore=chunkBest.score;rec.peakEpoch=chunkBest.epoch;rec.lastImproveEpoch=chunkBest.epoch;
      rec.peakMetrics=chunkBest;fs.copyFileSync(out,peak);
      console.log(`[dual-wild] ${id}: NEW peak combined ${rec.bestScore.toFixed(5)} at epoch ${rec.peakEpoch}`);
    }
    state.shapes[id]=rec;saveState(state);
    const stale=rec.totalEpochs-Math.max(rec.lastImproveEpoch||0,0);
    if(rec.totalEpochs>=minEpochs&&stale>=patienceEpochs){rec.stopReason=`no >${minDelta} combined-score improvement for ${stale} epochs`;break;}
  }
  if(!rec.stopReason)rec.stopReason=`emergency ceiling ${maxEpochs} epochs`;
  if(fs.existsSync(peak)){fs.copyFileSync(peak,out);try{fs.unlinkSync(peak);}catch(_){}}
  rec.done=fs.existsSync(out);rec.finishedAt=new Date().toISOString();state.shapes[id]=rec;saveState(state);
  console.log(`[dual-wild] ${id}: DONE — peak epoch ${rec.peakEpoch}, combined ${rec.bestScore==null?'?':rec.bestScore.toFixed(5)}; ${rec.stopReason}`);
}
function registerRoster(state){
  const entrants=shapes.map((shape,i)=>{const id=slug(shape,i),rec=state.shapes[id],file=id+'.json';return rec&&rec.done&&fs.existsSync(path.join(models,file))?{file,shape,op:'wild-mint',parent:null,root:file,born:0,epochs:rec.peakEpoch}:null;}).filter(Boolean);
  if(!entrants.length)throw new Error('no verified dual-wild entrants exist to register');
  const old=loadJson(popPath,{version:1,next:1,active:[],pending:null});
  const oldActive=Array.isArray(old.active)?old.active:[];
  const keepOld=oldActive.filter(m=>m&&m.file&&!entrants.some(w=>w.file===m.file));
  const pop={version:1,next:Math.max(1,+old.next||1),active:[...keepOld,...entrants],pending:old.pending||null};
  atomicJson(popPath,pop);
  console.log(`[dual-wild] added ${entrants.length} verified wild entrant(s) to the active dual Elo roster (${pop.active.length} active; four is the protected minimum, not a cap).`);
  if(oldActive.length)console.log(`[dual-wild] previous active entrants remain active; the league will rate the expanded field and retire weak ones one at a time.`);
}
async function main(){
  if(!cudaReady())throw new Error('CUDA PyTorch is required for the dual-wild phase');
  if(!fs.existsSync(path.join(dir,'policy-targets.jsonl')))throw new Error('policy-targets.jsonl missing; run policy-targets.js first');
  const state=loadJson(statePath,{version:1,shapes:{}});
  console.log(`[dual-wild] adaptive expedition: ${shapes.length} joint value+policy trunks; chunks ${chunkEpochs}; min ${minEpochs}; patience ${patienceEpochs}; emergency max ${maxEpochs}`);
  console.log(`[dual-wild] backend: torch-cuda (batch ${batch}, verified dual export every chunk)`);
  console.log(`[dual-wild] fixed game split seed ${seed}; curves -> ${path.relative(process.cwd(),curves)}`);
  for(let i=0;i<shapes.length;i++){
    try{await trainShape(shapes[i],i,state);}
    catch(e){const id=slug(shapes[i],i);console.error(`[dual-wild] ${id} failed: ${e.message} — recording failure and continuing`);state.shapes[id]={...(state.shapes[id]||{}),shape:shapes[i],failedAt:new Date().toISOString(),error:e.message};saveState(state);}
  }
  registerRoster(state);
  console.log('\n[dual-wild] expedition complete. All verified entrants are active and ready for normal Elo placement.');
}
main().catch(e=>{console.error('[dual-wild] fatal:',e.message);process.exitCode=1;});
