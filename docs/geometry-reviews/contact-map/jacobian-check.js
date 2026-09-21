'use strict';
// Numerical consistency check, not a uniform derivative certificate.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {TC,CL}=require('./source-loader.js');
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'trace.json'))),sqrtI=Math.sqrt(CL.I),h=1e-4;
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>Math.hypot(...a);
const out=[];
for(const row of data.rows.filter(r=>r.iter===0&&Math.min(r.s,1-r.s,r.t,1-r.t)>.02)){
 const A=TC.arcPts(row.att,row.i),z=[row.before.x,row.before.y,sqrtI*row.before.rot];
 function at(z){const q={x:z[0],y:z[1],rot:z[2]/sqrtI},V=TC.arcPts(q,row.j),c=TC.segClosest3(A[row.a],A[row.a+1],V[row.b],V[row.b+1]);
  const nx=(c.pb.x-c.pa.x)/c.dist,ny=(c.pb.y-c.pa.y)/c.dist,rn3=(c.pb.x-q.x)*ny-(c.pb.y-q.y)*nx;
  const g=[nx,ny,rn3/sqrtI],s=dot(g,g),p=CL.MIND-c.dist;
  return {g,s,p,F:z.map((v,i)=>v+p*g[i]/s),params:[c.s,c.t]};}
 const c=at(z),H=Array.from({length:3},()=>[]),JF=Array.from({length:3},()=>[]);
 for(let j=0;j<3;j++){const lo=z.slice(),hi=z.slice();lo[j]-=h;hi[j]+=h;const l=at(lo),u=at(hi);
  assert([...l.params,...u.params].every(v=>v>0&&v<1));
  for(let i=0;i<3;i++){H[i][j]=(u.g[i]-l.g[i])/(2*h);JF[i][j]=(u.F[i]-l.F[i])/(2*h);}}
 const un=c.g.map(v=>v/Math.sqrt(c.s)),pred=H.map((r,i)=>r.map((_,j)=>{
  let rh=0;for(let k=0;k<3;k++)rh+=((i===k?1:0)-2*un[i]*un[k])*H[k][j];
  return (i===j?1:0)-un[i]*un[j]+c.p*rh/c.s;}));
 const error=norm(JF.flatMap((r,i)=>r.map((v,j)=>v-pred[i][j])));
 assert(error<2e-6);const aa=H[0][2],bb=H[1][2],cc=H[2][2],hessianNorm=(Math.abs(cc)+Math.sqrt(cc*cc+4*(aa*aa+bb*bb)))/2;out.push({k:row.k,error,gradientNorm:Math.sqrt(c.s),hessianNorm});
}
const result={description:'Central-difference check on nominal interior/interior chord branches; not an interval proof',h,cases:out.length,maxFrobeniusError:Math.max(...out.map(r=>r.error)),rows:out};
fs.writeFileSync(path.join(__dirname,'jacobian-check.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,rows:undefined},null,2));
