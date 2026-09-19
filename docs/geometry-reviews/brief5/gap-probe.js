'use strict';
// A small reproducible probe of one reported unresolved interval. The finite
// samples do not establish coverage between samples or classify all controls.
const fs=require('fs'),path=require('path');
const {FW,CL}=require('./load.js'),E=CL.eng;
const all=fs.readFileSync(path.join(__dirname,'repo/docs/dead-regions/screened-not-dead.jsonl'),'utf8').split('\n').filter(x=>x[0]==='{').map(JSON.parse);
const seed=all.find(x=>x.status==='unresolved'),match=seed.why.match(/reply \((\d+),(-?\d+)\) ([\d.]+)-([\d.]+)deg/);
const [pv,dir,lo,hi]=match.slice(1).map(Number),pieces=FW.piecesOf(seed.p),victim=seed.mover,attacker=1-victim,DEG=Math.PI/180;
const fam=FW.replyFamily(pieces,victim,pv,dir,CL.REPLICA),samples=[];
for(let k=0;k<=8;k++){
 const requested=lo+(hi-lo)*k/8,stop=requested*DEG;
 const rec=fam.out.record.find(r=>r.alpha>=stop-1e-9)||fam.out.record.at(-1);
 const rp=pieces.map(p=>({...p}));rp[victim]=FW.moverAt(pieces[victim],pv,dir,rec.alpha);rp[attacker]={x:rec.x,y:rec.y,rot:rec.rot};
 const replica=FW.ARMS.map(([apv,adir])=>{const t=FW.throwMargin(rp,attacker,apv,adir,CL.REPLICA);return{arm:[apv,adir],margin:t.margin,signature:FW.signature(t.out)};});
 // Real engine, one-degree calls plus the final remainder, as simCheckEscape.
 let g=FW.load(pieces,victim);E.pinFoot(pv);let guard=0;
 while(!g.atLimit&&Math.abs(g.netRad)<stop-1e-9&&guard++<2000)E.applySwing(dir*Math.min(DEG,stop-Math.abs(g.netRad)));
 const after=g.pieces.map(p=>({x:p.x,y:p.y,rot:p.rot}));
 const attackerThrown=g.pieces[attacker].feet().some(f=>Math.hypot(f.x,f.y)>CL.EDGE);
 const engine=FW.ARMS.map(([apv,adir])=>({arm:[apv,adir],result:FW.sweepThrows(after,attacker,apv,adir)}));
 samples.push({requestedDegrees:requested,replicaRecordDegrees:rec.alpha/DEG,replica,engine,attackerThrown});
}
const out={seed,replyArm:[pv,dir],gapDegrees:[lo,hi],scope:'Nine diagnostic stops; replica records snap to the next stored step. Engine uses one-degree calls plus a final remainder. No interval proof.',samples};
fs.writeFileSync(path.join(__dirname,'gap-probe.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({seed:seed.g,gap:[lo,hi],samples:samples.map(s=>({requested:s.requestedDegrees,record:s.replicaRecordDegrees,bestReplica:Math.max(...s.replica.map(x=>x.margin)),positiveReplica:s.replica.filter(x=>x.margin>0).map(x=>x.arm),engine:s.engine}))},null,2));
