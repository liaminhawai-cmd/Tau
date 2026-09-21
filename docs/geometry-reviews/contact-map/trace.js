'use strict';
const fs=require('fs'),path=require('path');
const {loadChecker,pieces,CL}=require('./source-loader.js');
const TC=loadChecker(s=>s.replace('pushes.push({ ...tag, nx, ny, rn, lambda, sep });','pushes.push({ ...tag, nx, ny, rn, lambda, sep, before: {...opp}, after: {x:opp.x+lambda*nx,y:opp.y+lambda*ny,rot:opp.rot+lambda*rn/I} });'));
const tr=TC.sweep(pieces,1,2,-1,112),rows=[];
let multi=0;
for(let k=1;k<=tr.length;k++){
 const row=tr[k-1],counts={};for(const p of row.pushes)counts[p.iter]=(counts[p.iter]||0)+1;
 if(Object.values(counts).some(n=>n>1))multi++;
 for(const p of row.pushes){
  const d=p.dist,g=[p.hf*p.nx,p.hf*p.ny,p.hf*p.rn/Math.sqrt(CL.I)],s=g.reduce((s,v)=>s+v*v,0),gap=CL.MIND-d;
  const delta=[p.after.x-p.before.x,p.after.y-p.before.y,Math.sqrt(CL.I)*(p.after.rot-p.before.rot)];
  const predicted=g.map(v=>gap*v/s),identityError=Math.hypot(...delta.map((v,i)=>v-predicted[i]));
  const A=TC.arcPts(row.att,p.i),V=TC.arcPts(p.before,p.j);let best=null;
  for(let a=0;a<12;a++)for(let b=0;b<12;b++){const c=TC.segClosest3(A[a],A[a+1],V[b],V[b+1]);if(!best||c.dist<best.dist)best={a,b,...c};}
  const residual=TC.pairDist(row.att,p.after,[p.i,p.j]).dist-CL.MIND;
  rows.push({k,iter:p.iter,kind:p.kind,i:p.i,j:p.j,gap,hf:p.hf,rn:p.rn,grad2:s,lambda:p.lambda,residual,identityError,a:best.a,b:best.b,s:best.s,t:best.t,before:p.before,after:p.after,att:row.att});
 }
}
const summary={source:'18efad5398798b65b477f9af4be17947a358d3ce',arm:[2,-1],substeps:112,pushes:rows.length,substepsWithMultipleContactsPerPass:multi,firstPush:rows[0]?.k,kinds:[...new Set(rows.map(r=>r.kind))],pairs:[...new Set(rows.map(r=>r.i+','+r.j))],maxIdentityError:Math.max(...rows.map(r=>r.identityError)),maxGap:Math.max(...rows.map(r=>r.gap)),minHf:Math.min(...rows.map(r=>r.hf)),flags:tr.filter(r=>r.flags.hub||r.flags.deep||r.flags.cap||r.flags.hfFloor).map(r=>r.flags),maxAbsResidual:Math.max(...rows.map(r=>Math.abs(r.residual)))};
fs.writeFileSync(path.join(__dirname,'trace.json'),JSON.stringify({summary,rows},null,2)+'\n');fs.writeFileSync(path.join(__dirname,'trace-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
