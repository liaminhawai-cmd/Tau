'use strict';
// Three resumable 96-action policy experiments. They share one frozen value evaluator so Elo
// measures only policy geometry/scale, not three different value nets at the same time.
const fs=require('fs');
const path=require('path');
const {spawn,spawnSync}=require('child_process');
const dir=__dirname, models=path.join(dir,'models'), curves=path.join(dir,'joint-policy-curves');
const statePath=path.join(models,'.joint-policy-mint-state.json');
const ENCODING='centre-left-right-signed32-v1';
const configs=[
  {id:'policy-joint-normal-96x64', hidden:'96,64', topology:'plain', batch:4096, lr:0.00085},
  {id:'policy-joint-large-4x512', hidden:'512,512,512,512', topology:'plain', batch:2048, lr:0.00055},
  {id:'policy-joint-behemoth-10x400-dense40', hidden:Array(10).fill(400).join(','),
   topology:'dense-memory', memoryWidth:40, residualScale:0.2, batch:2048, lr:0.0005},
];
function arg(n,d){const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;}
const chunkEpochs=Math.max(5,+arg('chunkEpochs',10));
const minEpochs=Math.max(chunkEpochs,+arg('minEpochs',30));
const patienceEpochs=Math.max(chunkEpochs,+arg('patienceEpochs',30));
const maxEpochs=Math.max(minEpochs,+arg('maxEpochs',200));
const minDelta=Math.max(0,+arg('minDelta',0.001));
const seed=+arg('seed',43243);
function cudaReady(){const p=spawnSync('python',['-c','import torch; print("yes" if torch.cuda.is_available() else "no")'],{encoding:'utf8',windowsHide:true});return p.status===0&&String(p.stdout).trim()==='yes';}
function loadState(){try{return JSON.parse(fs.readFileSync(statePath,'utf8'));}catch(_){return {version:1,models:{}};}}
function atomicWrite(p,s){fs.mkdirSync(path.dirname(p),{recursive:true});const t=`${p}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,s);fs.renameSync(t,p);}
function saveState(s){atomicWrite(statePath,JSON.stringify(s,null,2));}
function runChild(command,args,onLine){return new Promise((resolve,reject)=>{
  const ch=spawn(command,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});let buf='';
  const eat=x=>{const z=String(x);process.stdout.write(z);buf+=z;let p;while((p=buf.indexOf('\n'))>=0){onLine(buf.slice(0,p));buf=buf.slice(p+1);}};
  ch.stdout.on('data',eat);ch.stderr.on('data',d=>process.stderr.write(d));ch.on('error',reject);
  ch.on('exit',c=>c===0?resolve():reject(new Error(`${command} exited ${c}`)));
});}
function usableValue(p){try{const j=JSON.parse(fs.readFileSync(p,'utf8'));return !j.dual&&Array.isArray(j.sizes)&&j.sizes[j.sizes.length-1]===1;}catch(_){return false;}}
function ensureFrozenBase(){
  const out=path.join(models,'policy-joint-base.json');
  if(usableValue(out))return out;
  const choices=[path.join(dir,'medals','gold.json'),path.join(models,'best.json'),path.join(models,'value.json')];
  const src=choices.find(usableValue);
  if(!src)throw new Error('no ordinary one-output value net found to freeze for policy Elo entrants');
  fs.mkdirSync(models,{recursive:true});fs.copyFileSync(src,out);
  console.log(`[joint-policy] froze common value evaluator ${path.basename(src)} -> ${path.basename(out)}`);
  return out;
}
function writeEntrant(c){
  const policyFile=`${c.id}.json`, entry=`${c.id}-entry.json`;
  atomicWrite(path.join(models,entry),JSON.stringify({
    version:1,policyEntrant:true,policyEncoding:ENCODING,
    valueFile:'policy-joint-base.json',policyFile,
    label:c.id,shape:c.hidden,topology:c.topology,
  },null,2));
  console.log(`[joint-policy] Elo entrant ready: ${entry} (common value + ${policyFile})`);
}
async function trainOne(c,state){
  const out=path.join(models,c.id+'.json'), peak=path.join(models,'.'+c.id+'.peak');
  const curve=path.join(curves,c.id+'.jsonl');
  const rec=state.models[c.id]||(state.models[c.id]={totalEpochs:0,bestVal:null,peakEpoch:0,lastImproveEpoch:0});
  if(rec.done&&fs.existsSync(out)){writeEntrant(c);console.log(`[joint-policy] ${c.id}: complete at peak epoch ${rec.peakEpoch}, skipping`);return;}
  if(rec.totalEpochs>0&&!fs.existsSync(out)){console.log(`[joint-policy] ${c.id}: checkpoint missing; restarting`);Object.assign(rec,{totalEpochs:0,bestVal:null,peakEpoch:0,lastImproveEpoch:0,done:false});}
  console.log(`\n================ ${c.id} ================`);
  console.log(`[joint-policy] ${c.hidden}; ${c.topology}${c.memoryWidth?` k=${c.memoryWidth}`:''}`);
  while(rec.totalEpochs<maxEpochs){
    const start=rec.totalEpochs, lr=Math.max(0.000035,c.lr*Math.pow(0.85,Math.floor(start/chunkEpochs)));
    const metrics=[];
    const args=['-u',path.join(dir,'torch-train-joint-policy.py'),'--targets',path.join(dir,'policy-targets.jsonl'),
      '--out',out,'--hidden',c.hidden,'--topology',c.topology,'--epochs',String(chunkEpochs),
      '--epochOffset',String(start),'--seed',String(seed),'--batch',String(c.batch),'--lr',String(lr),
      '--wd','0.0001','--device','cuda','--throwWeight','1.5','--quickWinBonus','0.2',
      ...(c.memoryWidth?['--memoryWidth',String(c.memoryWidth),'--residualScale',String(c.residualScale)]:[]),
      ...(start>0&&fs.existsSync(out)?['--resume',out]:[])];
    console.log(`[joint-policy] epochs ${start+1}-${start+chunkEpochs}, lr ${lr.toFixed(6)}, CUDA batch ${c.batch}`);
    await runChild('python',args,line=>{const m=line.match(/epoch\s+(\d+)\/\d+: train ce ([0-9.eE+-]+), val ce ([0-9.eE+-]+), action@1 ([0-9.]+)%, @3 ([0-9.]+)%, leg ([0-9.]+)%, dir ([0-9.]+)%/);if(m){const row={epoch:start+(+m[1]),trainCe:+m[2],valCe:+m[3],action1:+m[4]/100,action3:+m[5]/100,legAcc:+m[6]/100,dirAcc:+m[7]/100,at:new Date().toISOString()};metrics.push(row);fs.mkdirSync(curves,{recursive:true});fs.appendFileSync(curve,JSON.stringify(row)+'\n');}});
    await runChild(process.execPath,[path.join(dir,'verify-joint-policy-export.js'),out],()=>{});
    rec.totalEpochs=start+chunkEpochs;
    const best=metrics.reduce((a,b)=>!a||b.valCe<a.valCe?b:a,null);
    if(best&&(rec.bestVal==null||best.valCe<rec.bestVal-minDelta)){
      rec.bestVal=best.valCe;rec.peakEpoch=best.epoch;rec.lastImproveEpoch=best.epoch;fs.copyFileSync(out,peak);
      console.log(`[joint-policy] NEW peak val CE ${rec.bestVal.toFixed(5)} at epoch ${rec.peakEpoch}`);
    }
    saveState(state);
    const stale=rec.totalEpochs-(rec.lastImproveEpoch||0);
    if(rec.totalEpochs>=minEpochs&&stale>=patienceEpochs){rec.stopReason=`no >${minDelta} val-CE improvement for ${stale} epochs`;break;}
  }
  if(!rec.stopReason)rec.stopReason=`emergency ceiling ${maxEpochs} epochs`;
  if(fs.existsSync(peak)){fs.copyFileSync(peak,out);try{fs.unlinkSync(peak);}catch(_){}}
  await runChild(process.execPath,[path.join(dir,'verify-joint-policy-export.js'),out],()=>{});
  rec.done=true;rec.finishedAt=new Date().toISOString();saveState(state);writeEntrant(c);
  console.log(`[joint-policy] DONE ${c.id} — peak epoch ${rec.peakEpoch}, val CE ${rec.bestVal?.toFixed(5)}; ${rec.stopReason}`);
}
async function main(){
  if(!cudaReady())throw new Error('CUDA PyTorch is required for the joint-policy expedition');
  ensureFrozenBase();fs.mkdirSync(curves,{recursive:true});const state=loadState();state.models||={};
  console.log(`[joint-policy] 96 actions: centre/left/right x signed direction x 16 distances`);
  console.log(`[joint-policy] 3 shapes; chunks ${chunkEpochs}; min ${minEpochs}; patience ${patienceEpochs}; max ${maxEpochs}`);
  let failed=0;
  for(const c of configs)try{await trainOne(c,state);}catch(e){failed++;console.error(`[joint-policy] ${c.id} failed: ${e.message}`);}
  if(failed)process.exitCode=1;
  else console.log('[joint-policy] all three verified descriptors will enter the ordinary Elo roster on trainer startup');
}
main().catch(e=>{console.error('[joint-policy] fatal:',e.message);process.exitCode=1;});
