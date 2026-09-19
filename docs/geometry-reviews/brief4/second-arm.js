'use strict';
const fs=require('fs'),path=require('path');const {TC,CL,pieces}=require('./probe.js'),{geometry}=require('./geometry.js');
const DEGR=180/Math.PI,tr=TC.sweep(pieces,1,2,-1,331),out=[];
for(let k=100;k<=114;k++){
 const row=tr[k-1],q=tr[k-2].pose,b={x:[q.x,q.x],y:[q.y,q.y],rot:[q.rot,q.rot]},g=geometry(row.att,q,[1,0]);
 const an=TC.analyse(b,row.att,[1,0]);
 const post=geometry(row.att,row.pose,[1,0]);
 out.push({k,sweepDeg:k/3,att:row.att,q,postPose:row.pose,pre:g,post,
  psi:an.psiN?.map(x=>x*DEGR),regimes:an.segPairs?.map(s=>({a:s.a,b:s.b,vertex:s.vertex,vk:s.vk,psi:s.psiN?.map(x=>x*DEGR)}))});
}
fs.writeFileSync(path.join(__dirname,'second-arm.json'),JSON.stringify(out,null,2));
console.log(out.map(r=>({k:r.k,phiA:r.pre.phiA,phiV:r.pre.phiV,psi:r.psi,
 first:r.pre.pairs.slice(0,2).map(p=>({a:p.a,b:p.b,s:p.s,t:p.t,d:p.dist})),rn:r.pre.rn,g:r.pre.g})));
