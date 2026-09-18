// Certify ply-1 dead points (victim to move, every reply thrown) for the k=2 retro seeds.
// Resumable: results appended to dead1.jsonl; seeds already there are skipped. Worker threads.
const fs=require('fs'), path=require('path'), { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const S=__dirname;
const OUT=S+'/dead1.jsonl';
if (isMainThread) {
  const maxSeconds = +(process.argv[2]||540), threads = +(process.argv[3]||3);
  const seeds = fs.readFileSync(S+'/seeds.jsonl','utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(s=>s.k===2);
  const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l).key) : []);
  const todo = seeds.filter(s=>!done.has(s.p.map(v=>v.toFixed(2)).join(',')+'|'+s.mover));
  console.log(`seeds ${seeds.length}, done ${done.size}, todo ${todo.length}, threads ${threads}, budget ${maxSeconds}s`);
  const t0=Date.now(); let next=0, active=0, tally={dead:0,escape:0,unresolved:0,screenEscape:0};
  function launch(){
    if (next>=todo.length || (Date.now()-t0)/1000 > maxSeconds) { if(active===0){ console.log('tally', JSON.stringify(tally), 'elapsed', ((Date.now()-t0)/1000).toFixed(0)+'s'); process.exit(0);} return; }
    const s=todo[next++]; active++;
    const w=new Worker(__filename,{workerData:s});
    w.on('message', r=>{ fs.appendFileSync(OUT, JSON.stringify(r)+'\n'); tally[r.status]=(tally[r.status]||0)+1; console.log(`${r.status.padEnd(12)} ${r.seconds.toFixed(0).padStart(4)}s  worst ${r.worstMargin!=null?r.worstMargin.toFixed(2):'-'}  ${r.g}`); });
    w.on('exit', ()=>{ active--; launch(); });
    w.on('error', e=>{ console.log('worker error', e.message); });
  }
  for (let i=0;i<threads;i++) launch();
} else {
  const FW=require('/home/user/Tau/nn/forced-win.js'); const CL=require('/home/user/Tau/nn/contact-law.js');
  const s=workerData, t0=Date.now();
  const pieces=[{x:s.p[0],y:s.p[1],rot:s.p[2]},{x:s.p[3],y:s.p[4],rot:s.p[5]}];
  const key=s.p.map(v=>v.toFixed(2)).join(',')+'|'+s.mover;
  let out;
  const scr=FW.deadCertificate(pieces, s.mover, CL.REPLICA, {screen:true});
  if (scr.status==='escape' || (scr.minBest!=null && scr.minBest <= -0.75)) out={status:'screenEscape', worstMargin: scr.minBest ?? null, why: scr.why||'screen minBest '+(scr.minBest!=null?scr.minBest.toFixed(2):'?')};
  else { const v=FW.deadCertificate(pieces, s.mover, CL.REPLICA, {}); out={status:v.status, worstMargin: Number.isFinite(v.worstMargin)?v.worstMargin:null, why:v.why||null, slivers:v.slivers||0, minBest:v.minBest??null}; }
  parentPort.postMessage({key, g:s.g, file:s.file, k:s.k, mover:s.mover, p:s.p, ...out, seconds:(Date.now()-t0)/1000});
}
