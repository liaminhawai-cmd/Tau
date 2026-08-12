'use strict';
// One-off architecture expedition. Each deliberately different shape trains in 10-epoch chunks on
// one fixed game-level validation split. We keep the best validation checkpoint seen across ALL
// chunks, stop only after the curve has clearly flattened, then leave the peak file in models/ for
// the normal evolutionary trainer to discover and rate. Safe to kill/restart: state is checkpointed
// after every completed chunk and train.js writes model files atomically.
const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');
const dir=__dirname, models=path.join(dir,'models'), curves=path.join(dir,'wild-curves');
const statePath=path.join(models,'.wild-mint-state.json');
const chunkEpochs=Math.max(5,+arg('chunkEpochs',10));
const minEpochs=Math.max(chunkEpochs,+arg('minEpochs',30));
const patienceEpochs=Math.max(chunkEpochs,+arg('patienceEpochs',30));
const maxEpochs=Math.max(minEpochs,+arg('maxEpochs',200)); // emergency ceiling, not the normal stop
const minDelta=Math.max(0,+arg('minDelta',0.00015));
const seed=+arg('seed',43043);
const shapes=[
  '256',             // very wide, one hidden layer
  '256,128',         // wide shallow taper
  '256,128,64,32',   // large smooth funnel
  '192,48,192',      // hard bottleneck / bow-tie
  '48,96,192',       // expanding pyramid
  '64,64,64,64,64,64', // deep and narrow
  '192,96,32',       // aggressive taper
  '128,32,128,32',   // alternating bottlenecks
];
function arg(n,d){const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;}
function loadState(){try{return JSON.parse(fs.readFileSync(statePath,'utf8'));}catch(_){return {version:1,shapes:{}};}}
function saveState(s){fs.mkdirSync(models,{recursive:true});const t=`${statePath}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,JSON.stringify(s,null,2));fs.renameSync(t,statePath);}
function slug(shape,i){return `wild-${String(i+1).padStart(2,'0')}-${shape.replace(/,/g,'x')}`;}
function runTrain(args,onMetric){return new Promise((resolve,reject)=>{
  const ch=spawn(process.execPath,[path.join(dir,'train.js'),...args],{stdio:['ignore','pipe','pipe']});
  let buf='';
  const eat=s=>{process.stdout.write(s);buf+=s;let p;while((p=buf.indexOf('\n'))>=0){const line=buf.slice(0,p);buf=buf.slice(p+1);const m=line.match(/epoch\s+(\d+)\/(\d+): train mse ([0-9.eE+-]+), val mse ([0-9.eE+-]+), val sign-acc ([0-9.]+)%/);if(m)onMetric({localEpoch:+m[1],trainMse:+m[3],valMse:+m[4],signAcc:+m[5]/100});}};
  ch.stdout.on('data',d=>eat(String(d)));ch.stderr.on('data',d=>process.stderr.write(d));
  ch.on('error',reject);ch.on('exit',c=>c===0?resolve():reject(new Error(`train.js exited ${c}`)));
});}
async function trainShape(shape,i,state){
  const id=slug(shape,i), out=path.join(models,id+'.json'), peak=path.join(models,'.'+id+'.peak'), curve=path.join(curves,id+'.jsonl');
  const rec=state.shapes[id]||{shape,totalEpochs:0,bestVal:null,peakEpoch:0,lastImproveEpoch:0,done:false};
  if(rec.done&&fs.existsSync(out)){console.log(`\n[wild] ${id}: already complete at epoch ${rec.peakEpoch}, skipping`);return;}
  if(rec.totalEpochs>0&&!fs.existsSync(out)){console.log(`\n[wild] ${id}: checkpoint missing, restarting this shape`);Object.assign(rec,{totalEpochs:0,bestVal:null,peakEpoch:0,lastImproveEpoch:0});}
  fs.mkdirSync(curves,{recursive:true});
  console.log(`\n================ ${id}  shape ${shape} ================`);
  while(rec.totalEpochs<maxEpochs){
    const start=rec.totalEpochs;
    const lr=Math.max(0.00008,0.001*Math.pow(0.85,Math.floor(start/chunkEpochs)));
    const metrics=[];
    const args=['--epochs',String(chunkEpochs),'--seed',String(seed),'--lr',String(lr),'--lrDecay','flat','--out',out,
      ...(start>0&&fs.existsSync(out)?['--resume',out]:['--hidden',shape])];
    console.log(`[wild] ${id}: epochs ${start+1}-${start+chunkEpochs}, lr ${lr.toFixed(6)}`);
    await runTrain(args,m=>{const row={...m,epoch:start+m.localEpoch,shape,id,at:new Date().toISOString()};metrics.push(row);fs.appendFileSync(curve,JSON.stringify(row)+'\n');});
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
  console.log(`[wild] adaptive expedition: ${shapes.length} shapes; chunks ${chunkEpochs}; min ${minEpochs}; patience ${patienceEpochs}; emergency max ${maxEpochs}`);
  console.log(`[wild] fixed validation split seed ${seed}; curves -> ${path.relative(process.cwd(),curves)}`);
  for(let i=0;i<shapes.length;i++){
    try{await trainShape(shapes[i],i,state);}catch(e){console.error(`[wild] ${slug(shapes[i],i)} failed: ${e.message} — recording failure and continuing`);const id=slug(shapes[i],i);state.shapes[id]={...(state.shapes[id]||{}),shape:shapes[i],failedAt:new Date().toISOString(),error:e.message};saveState(state);}
  }
  console.log('\n[wild] expedition complete. Peak checkpoints are in nn/models; normal option 20 can now absorb/rate them.');
}
main().catch(e=>{console.error('[wild] fatal:',e);process.exitCode=1;});
