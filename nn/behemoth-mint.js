'use strict';
// One deliberately oversized value net: ten 400-wide hidden layers, residual local flow, and a
// 40-neuron memory packet from every hidden layer concatenated into every layer in front. It uses
// the same fixed-split/chunk/patience deal as wild-mint, but CUDA is mandatory and the verified
// peak alone enters the ordinary Elo pool. Safe to close and resume after any completed chunk.
const fs=require('fs');
const path=require('path');
const {spawn,spawnSync}=require('child_process');
const dir=__dirname, models=path.join(dir,'models'), curves=path.join(dir,'behemoth-curves');
const statePath=path.join(models,'.behemoth-mint-state.json');
const id='behemoth-10x400-dense40';
const shape=Array(10).fill(400).join(',');
const out=path.join(models,id+'.json'), peak=path.join(models,'.'+id+'.peak');
const curve=path.join(curves,id+'.jsonl');
function arg(n,d){const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;}
const chunkEpochs=Math.max(5,+arg('chunkEpochs',10));
const minEpochs=Math.max(chunkEpochs,+arg('minEpochs',30));
const patienceEpochs=Math.max(chunkEpochs,+arg('patienceEpochs',30));
const maxEpochs=Math.max(minEpochs,+arg('maxEpochs',200));
const minDelta=Math.max(0,+arg('minDelta',0.00012));
const seed=+arg('seed',43143);
const torchBatch=Math.max(256,+arg('torchBatch',2048));
function cudaReady(){const p=spawnSync('python',['-c','import torch; print("yes" if torch.cuda.is_available() else "no")'],{encoding:'utf8',windowsHide:true});return p.status===0&&String(p.stdout).trim()==='yes';}
function loadState(){try{return JSON.parse(fs.readFileSync(statePath,'utf8'));}catch(_){return {version:1};}}
function saveState(s){fs.mkdirSync(models,{recursive:true});const t=`${statePath}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,JSON.stringify(s,null,2));fs.renameSync(t,statePath);}
function runChild(command,args,onLine){return new Promise((resolve,reject)=>{
  const ch=spawn(command,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});let buf='';
  const eat=x=>{const z=String(x);process.stdout.write(z);buf+=z;let p;while((p=buf.indexOf('\n'))>=0){onLine(buf.slice(0,p));buf=buf.slice(p+1);}};
  ch.stdout.on('data',eat);ch.stderr.on('data',d=>process.stderr.write(d));
  ch.on('error',reject);ch.on('exit',c=>c===0?resolve():reject(new Error(`${command} exited ${c}`)));
});}
async function trainChunk(start,lr,onMetric){
  const args=['-u',path.join(dir,'torch-train-core.py'),'--epochs',String(chunkEpochs),
    '--seed',String(seed),'--lr',String(lr),'--wd','0.0001','--batch',String(torchBatch),
    '--gameWeight','sqrt','--familyWeight','sqrt','--drawWeight','0.25','--device','cuda',
    '--hidden',shape,'--topology','dense-memory','--memoryWidth','40','--residualScale','0.2',
    '--out',out,...(start>0&&fs.existsSync(out)?['--resume',out]:[])];
  await runChild('python',args,line=>{const m=line.match(/epoch\s+(\d+)\/(\d+): train mse ([0-9.eE+-]+), val mse ([0-9.eE+-]+), val sign-acc ([0-9.]+)%/);if(m)onMetric({localEpoch:+m[1],trainMse:+m[3],valMse:+m[4],signAcc:+m[5]/100});});
  await runChild(process.execPath,[path.join(dir,'verify-torch-export.js'),out],()=>{});
}
async function main(){
  if(!cudaReady())throw new Error('CUDA PyTorch is required for the behemoth expedition');
  const rec=loadState();
  if(rec.done&&fs.existsSync(out)){console.log(`[behemoth] already complete at epoch ${rec.peakEpoch}, skipping`);return;}
  if((rec.totalEpochs||0)>0&&!fs.existsSync(out)){console.log('[behemoth] checkpoint missing; restarting');Object.assign(rec,{totalEpochs:0,bestVal:null,peakEpoch:0,lastImproveEpoch:0,done:false});}
  fs.mkdirSync(curves,{recursive:true});
  console.log(`[behemoth] ${id}: ${shape}; dense memory k=40 to every later layer; residual scale 0.2`);
  console.log(`[behemoth] adaptive chunks ${chunkEpochs}; min ${minEpochs}; patience ${patienceEpochs}; emergency max ${maxEpochs}; CUDA batch ${torchBatch}`);
  while((rec.totalEpochs||0)<maxEpochs){
    const start=rec.totalEpochs||0, lr=Math.max(0.00004,0.0005*Math.pow(0.85,Math.floor(start/chunkEpochs))), metrics=[];
    console.log(`[behemoth] epochs ${start+1}-${start+chunkEpochs}, lr ${lr.toFixed(6)}`);
    await trainChunk(start,lr,m=>{const row={...m,epoch:start+m.localEpoch,id,shape,topology:'dense-memory-v1',memoryWidth:40,at:new Date().toISOString()};metrics.push(row);fs.appendFileSync(curve,JSON.stringify(row)+'\n');});
    rec.totalEpochs=start+chunkEpochs;
    const chunkBest=metrics.reduce((a,b)=>!a||b.valMse<a.valMse?b:a,null);
    if(chunkBest&&(rec.bestVal==null||chunkBest.valMse<rec.bestVal-minDelta)){
      rec.bestVal=chunkBest.valMse;rec.peakEpoch=chunkBest.epoch;rec.lastImproveEpoch=chunkBest.epoch;fs.copyFileSync(out,peak);
      console.log(`[behemoth] NEW peak val ${rec.bestVal.toFixed(5)} at epoch ${rec.peakEpoch}`);
    }
    saveState(rec);
    const stale=rec.totalEpochs-Math.max(rec.lastImproveEpoch||0,0);
    if(rec.totalEpochs>=minEpochs&&stale>=patienceEpochs){rec.stopReason=`no >${minDelta} val-MSE improvement for ${stale} epochs`;break;}
  }
  if(!rec.stopReason)rec.stopReason=`emergency ceiling ${maxEpochs} epochs`;
  if(fs.existsSync(peak)){fs.copyFileSync(peak,out);try{fs.unlinkSync(peak);}catch(_){}}
  rec.done=fs.existsSync(out);rec.finishedAt=new Date().toISOString();saveState(rec);
  console.log(`[behemoth] DONE — peak epoch ${rec.peakEpoch}, val ${rec.bestVal==null?'?':rec.bestVal.toFixed(5)}; ${rec.stopReason}`);
  console.log('[behemoth] verified peak is now discoverable by the ordinary Elo pool');
}
main().catch(e=>{console.error('[behemoth] fatal:',e.message);process.exitCode=1;});
