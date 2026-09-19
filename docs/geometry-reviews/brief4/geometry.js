'use strict';
const {TC,CL}=require('./probe.js');
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),vec=(p,q)=>[q.x-p.x,q.y-p.y,q.h-p.h];
const norm=x=>Math.hypot(...x),unit=x=>x.map(v=>v/norm(x));
function geometry(att,q,legs=[0,0]) {
 const A=TC.arcPts(att,legs[0]),V=TC.arcPts(q,legs[1]),pairs=[];
 for(let a=0;a<12;a++)for(let b=0;b<12;b++)pairs.push({a,b,...TC.segClosest3(A[a],A[a+1],V[b],V[b+1])});
 pairs.sort((a,b)=>a.dist-b.dist);const p=pairs[0],n=unit(vec(p.pa,p.pb)),hf=Math.hypot(n[0],n[1]),nh=[n[0]/hf,n[1]/hf];
 const r=[p.pb.x-q.x,p.pb.y-q.y],rn=r[0]*nh[1]-r[1]*nh[0];
 const ft=CL.feetOf(q)[1],fr=Math.hypot(ft.x,ft.y),u=[ft.x/fr,ft.y/fr],ff=[(ft.x-q.x)/CL.R,(ft.y-q.y)/CL.R];
 const g=dot(nh,u)+rn/CL.I*CL.R*dot([-ff[1],ff[0]],u);
 return {best:p,pairs,n,hf,nh,rn,g,footRadius:fr,phiA:(p.a+p.s)*7.5,phiV:(p.b+p.t)*7.5,
  vertexDistanceA:Math.min(p.s,1-p.s)*norm(vec(A[p.a],A[p.a+1])),vertexDistanceV:Math.min(p.t,1-p.t)*norm(vec(V[p.b],V[p.b+1]))};
}
module.exports={geometry,dot,vec,norm,unit};
