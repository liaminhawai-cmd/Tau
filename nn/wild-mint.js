'use strict';
// One-off architecture expedition. Each deliberately different shape trains in 10-epoch chunks on
// one fixed game-level validation split. We keep the best validation checkpoint seen across ALL
// chunks, stop only after the curve has clearly flattened, then leave the peak file in models/ for
// the normal evolutionary trainer to discover and rate. Safe to kill/restart: state is checkpointed
// after every completed chunk and train.js writes model files atomically.
const fs=require('fs');
const path=require('path');
const {spawn,spawnSync}=require('child_process');
const dir=__dirname, models=path.join(dir,'models'), curves=path.join(dir,'wild-curves');
const statePath=path.join(models,'.wild-mint-state.json');
const chunkEpochs=Math.max(5,+arg('chunkEpochs',10));
const minEpochs=Math.max(chunkEpochs,+arg('minEpochs',30));
const patienceEpochs=Math.max(chunkEpochs,+arg('patienceEpochs',30));
const maxEpochs=Math.max(minEpochs,+arg('maxEpochs',200)); // emergency ceiling, not the normal stop
const minDelta=Math.max(0,+arg('minDelta',0.00015));
const seed=+arg('seed',43043);
const torchBatch=Math.max(256,+arg('torchBatch',4096));
const requestedBackend=String(arg('backend','auto')).toLowerCase();
const continueExisting=process.argv.includes('--continue-expedition')||process.argv.includes('--force');
function cudaReady(){
  if(requestedBackend==='js')return false;
  const p=spawnSync('python',['-c','import torch; print("yes" if torch.cuda.is_available() else "no")'],
    {encoding:'utf8',windowsHide:true});
  return p.status===0 && String(p.stdout).trim()==='yes';
}
// The expedition's fixed corpus. torch-train-core keeps the newest files up to a byte budget and
// the league writes new ones continuously, so pointed at nn/data a long run silently changes which
// games it trains on -- and, because split_and_weight shuffles list(by_game.keys()) with the seed
// and takes 10%, changing the file set reshuffles the VALIDATION SET too. The seed pins the RNG,
// not the list. Every shape must sit the same paper or the numbers below cannot be compared, so we
// train against a frozen copy instead. nn/freeze-arch-data.js makes it.
const FROZEN=path.join(dir,'data-arch-frozen');
const FROZEN_GLOB=path.join(FROZEN,'*.jsonl');
// Larger than the snapshot, so cap_files keeps all of it and never drops a file mid-expedition.
const FROZEN_BUDGET_MB='4096';
const TRUNK10x400=Array(10).fill(400).join(',');
const useTorch=cudaReady();
const backend=useTorch?'torch-cuda':'js-cpu';
// A plain string is a plain net, and stays one -- the first eight keep their slugs and their
// entries in .wild-mint-state.json, so a resumed expedition still recognises them as done.
// An object may also carry a memory topology and its own id.
const shapes=[
  '256',
  '256,128',
  '256,128,64,32',
  '192,48,192',
  '48,96,192',
  '64,64,64,64,64,64',
  '192,96,32',
  '128,32,128,32',
  // Bulge twins: identical shape, identical seed, and the only difference is whether the two
  // 40-wide pinches have a route around them. Every bottleneck above is UNBYPASSED, so none of
  // them separates "narrow layers lose information" from "narrow layers lose information they
  // have no way around". These two do.
  {id:'peak-bulge-plain-200x40',   shape:'200,40,200,40,200', eloWeight:'logistic'},
  {id:'peak-bulge-dense40-200x40', shape:'200,40,200,40,200', eloWeight:'logistic',
   topology:'dense-memory', memoryWidth:40, residualScale:0.2},
  // Ablations of the production recipe (10x400, k=40, scale 0.2 -- best.json and half the pool).
  // k004/016/040/120 move only the packet width; noresid keeps the packets and drops the residual
  // trunk. k040 is the shared control for both questions.
  {id:'peak-mem-k004-10x400', shape:TRUNK10x400, eloWeight:'logistic',
   topology:'dense-memory', memoryWidth:4,   residualScale:0.2},
  {id:'peak-mem-k016-10x400', shape:TRUNK10x400, eloWeight:'logistic',
   topology:'dense-memory', memoryWidth:16,  residualScale:0.2},
  {id:'peak-mem-k040-10x400', shape:TRUNK10x400, eloWeight:'logistic',
   topology:'dense-memory', memoryWidth:40,  residualScale:0.2},
  {id:'peak-mem-k120-10x400', shape:TRUNK10x400, eloWeight:'logistic',
   topology:'dense-memory', memoryWidth:120, residualScale:0.2},
  {id:'peak-mem-k040-noresid-10x400', shape:TRUNK10x400, eloWeight:'logistic',
   topology:'dense-memory', memoryWidth:40,  residualScale:0},
];
function arg(n,d){const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;}
function loadState(){try{return JSON.parse(fs.readFileSync(statePath,'utf8'));}catch(_){return {version:1,shapes:{}};}}
function saveState(s){fs.mkdirSync(models,{recursive:true});const t=`${statePath}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,JSON.stringify(s,null,2));fs.renameSync(t,statePath);}
const spec=x=>typeof x==='string'?{shape:x}:x;
function slug(x,i){const s=spec(x);return s.id||`wild-${String(i+1).padStart(2,'0')}-${s.shape.replace(/,/g,'x')}`;}
function runChild(command,args,onLine){return new Promise((resolve,reject)=>{
  const ch=spawn(command,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let buf='';
  const eat=x=>{const z=String(x);process.stdout.write(z);buf+=z;let p;while((p=buf.indexOf('\n'))>=0){onLine(buf.slice(0,p));buf=buf.slice(p+1);}};
  ch.stdout.on('data',eat);ch.stderr.on('data',d=>process.stderr.write(d));
  ch.on('error',reject);ch.on('exit',c=>c===0?resolve():reject(new Error(`${command} exited ${c}`)));
});}
async function runTrain(x,start,out,lr,onMetric){
  const sp=spec(x),shape=sp.shape;
  if(useTorch){
    const args=['-u',path.join(dir,'torch-train-core.py'),'--epochs',String(chunkEpochs),
      '--seed',String(seed),'--lr',String(lr),'--wd','0.0001','--batch',String(torchBatch),
      '--gameWeight','sqrt','--familyWeight','sqrt','--drawWeight','0.25','--device','cuda',
      '--data',FROZEN_GLOB,'--dataBudgetMB',FROZEN_BUDGET_MB,
      ...(sp.eloWeight?['--eloWeight',sp.eloWeight]:[]),
      ...(sp.topology?['--topology',sp.topology]:[]),
      ...(sp.memoryWidth!=null?['--memoryWidth',String(sp.memoryWidth)]:[]),
      ...(sp.residualScale!=null?['--residualScale',String(sp.residualScale)]:[]),
      '--hidden',shape,'--out',out,...(start>0&&fs.existsSync(out)?['--resume',out]:[])];
    await runChild('python',args,line=>{
      const m=line.match(/epoch\s+(\d+)\/(\d+): train mse ([0-9.eE+-]+), val mse ([0-9.eE+-]+), val sign-acc ([0-9.]+)%/);
      if(m)onMetric({localEpoch:+m[1],trainMse:+m[3],valMse:+m[4],signAcc:+m[5]/100});
    });
    await runChild(process.execPath,[path.join(dir,'verify-torch-export.js'),out],()=>{});
  }else{
    // net.js cannot train a structured topology at all, and a plain net wearing an ablation's
    // name would silently answer the question wrong. Fail the shape instead; the loop records
    // the failure and carries on with the rest of the expedition.
    if(sp.topology&&sp.topology!=='plain')
      throw new Error(`${sp.topology} needs CUDA PyTorch; refusing to mint a plain net as this shape`);
    const args=[path.join(dir,'train.js'),'--epochs',String(chunkEpochs),'--seed',String(seed),
      '--lr',String(lr),'--lrDecay','flat','--out',out,
      ...(start>0&&fs.existsSync(out)?['--resume',out]:['--hidden',shape])];
    await runChild(process.execPath,args,line=>{
      const m=line.match(/epoch\s+(\d+)\/(\d+): train mse ([0-9.eE+-]+), val mse ([0-9.eE+-]+), val sign-acc ([0-9.]+)%/);
      if(m)onMetric({localEpoch:+m[1],trainMse:+m[3],valMse:+m[4],signAcc:+m[5]/100});
    });
  }
}
async function trainShape(x,i,state){
  const sp=spec(x),shape=sp.shape;
  const id=slug(x,i), out=path.join(models,id+'.json'), peak=path.join(models,'.'+id+'.peak'), curve=path.join(curves,id+'.jsonl');
  const rec=state.shapes[id]||{shape,totalEpochs:0,bestVal:null,peakEpoch:0,lastImproveEpoch:0,done:false};
  if(rec.done&&fs.existsSync(out)){console.log(`\n[wild] ${id}: already complete at epoch ${rec.peakEpoch}, skipping`);return;}
  if(rec.totalEpochs>0&&!fs.existsSync(out)){console.log(`\n[wild] ${id}: checkpoint missing, restarting this shape`);Object.assign(rec,{totalEpochs:0,bestVal:null,peakEpoch:0,lastImproveEpoch:0});}
  fs.mkdirSync(curves,{recursive:true});
  console.log(`\n================ ${id}  shape ${shape}${sp.topology?`  ${sp.topology} k=${sp.memoryWidth} scale=${sp.residualScale}`:''} ================`);
  while(rec.totalEpochs<maxEpochs){
    const start=rec.totalEpochs;
    const lr=Math.max(0.00008,0.001*Math.pow(0.85,Math.floor(start/chunkEpochs)));
    const metrics=[];
    if(rec.backend&&rec.backend!==backend)console.log(`[wild] ${id}: continuing checkpoint via ${backend} (was ${rec.backend})`);
    rec.backend=backend;
    console.log(`[wild] ${id}: epochs ${start+1}-${start+chunkEpochs}, lr ${lr.toFixed(6)}, backend ${backend}`);
    await runTrain(x,start,out,lr,m=>{const row={...m,epoch:start+m.localEpoch,shape,id,backend,at:new Date().toISOString()};metrics.push(row);fs.appendFileSync(curve,JSON.stringify(row)+'\n');});
    rec.totalEpochs=start+chunkEpochs;
    const chunkBest=metrics.reduce((a,b)=>!a||b.valMse<a.valMse?b:a,null);
    if(chunkBest&&(rec.bestVal==null||chunkBest.valMse<rec.bestVal-minDelta)){
      rec.bestVal=chunkBest.valMse;rec.peakEpoch=chunkBest.epoch;rec.lastImproveEpoch=chunkBest.epoch;
      fs.copyFileSync(out,peak);
      console.log(`[wild] ${id}: NEW peak val ${rec.bestVal.toFixed(5)} at epoch ${rec.peakEpoch}`);
    }
    state.shapes[id]=rec;saveState(state);
    const stale=rec.totalEpochs-Math.max(rec.lastImproveEpoch||0,0);
    if(rec.totalEpochs>=minEpochs&&stale>=patienceEpochs){rec.stopReason=`no >${minDelta} val-MSE improvement for ${stale} epochs`;break;}
  }
  if(!rec.stopReason)rec.stopReason=`emergency ceiling ${maxEpochs} epochs`;
  if(fs.existsSync(peak)){fs.copyFileSync(peak,out);try{fs.unlinkSync(peak);}catch(_){}}
  rec.done=fs.existsSync(out);rec.finishedAt=new Date().toISOString();state.shapes[id]=rec;saveState(state);
  console.log(`[wild] ${id}: DONE — peak epoch ${rec.peakEpoch}, val ${rec.bestVal==null?'?':rec.bestVal.toFixed(5)}; ${rec.stopReason}`);
}
async function main(){
  const state=loadState();
  if(fs.existsSync(statePath)&&!continueExisting){
    const touched=Object.keys(state.shapes||{}).length,done=Object.values(state.shapes||{}).filter(x=>x&&x.done).length;
    console.log(`[wild] prior expedition state found (${done}/${shapes.length} complete; ${touched} touched). Restart mode skips one-off search.`);
    console.log('[wild] use --continue-expedition only when you deliberately want to continue it.');
    return;
  }
  const pending=shapes.filter((x,i)=>{const r=state.shapes[slug(x,i)];return !(r&&r.done&&fs.existsSync(path.join(models,slug(x,i)+'.json')));});
  if(pending.length&&!fs.existsSync(FROZEN)){
    console.error('[wild] no frozen corpus at '+path.relative(process.cwd(),FROZEN));
    console.error('[wild] Without it every chunk re-reads the live nn/data, the file set drifts as');
    console.error('[wild] the league writes, and the seed then shuffles a DIFFERENT list into a');
    console.error('[wild] different validation split -- so the shapes cannot be compared at all.');
    console.error('[wild] Run:  node nn/freeze-arch-data.js');
    process.exitCode=1;return;
  }
  console.log(`[wild] adaptive expedition: ${shapes.length} shapes; chunks ${chunkEpochs}; min ${minEpochs}; patience ${patienceEpochs}; emergency max ${maxEpochs}`);
  if(pending.length)console.log(`[wild] frozen corpus: ${path.relative(process.cwd(),FROZEN)} (identical rows and split for every chunk of every shape)`);
  console.log(`[wild] backend: ${backend}${useTorch?` (batch ${torchBatch}, verified export every chunk)`:' (install CUDA PyTorch to accelerate)'}`);
  console.log(`[wild] fixed validation split seed ${seed}; curves -> ${path.relative(process.cwd(),curves)}`);
  for(let i=0;i<shapes.length;i++){
    try{await trainShape(shapes[i],i,state);}catch(e){console.error(`[wild] ${slug(shapes[i],i)} failed: ${e.message} — recording failure and continuing`);const id=slug(shapes[i],i);state.shapes[id]={...(state.shapes[id]||{}),shape:spec(shapes[i]).shape,failedAt:new Date().toISOString(),error:e.message};saveState(state);}
  }
  console.log('\n[wild] value expedition complete. Peak checkpoints are in nn/models; the dual-policy expedition is next.');
}
main().catch(e=>{console.error('[wild] fatal:',e);process.exitCode=1;});