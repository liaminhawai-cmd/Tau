'use strict';
// Second-order automatic differentiation in mass coordinates (x,y,sqrt(I)*theta).
// This implements exact smooth contact branches; callers must establish their
// projection/KKT/winner conditions. Ordinary floating point, not interval proof.
const {TC,CL}=require('./probe.js');const R=CL.R,I=CL.I,SQI=Math.sqrt(I),D=CL.MIND;
const zero=()=>[0,0,0],zmat=()=>[zero(),zero(),zero()];
const C=v=>({v,g:zero(),H:zmat()});
const X=(v,i)=>{const x=C(v);x.g[i]=1;return x;};
const A=(a,b)=>({v:a.v+b.v,g:a.g.map((x,i)=>x+b.g[i]),H:a.H.map((r,i)=>r.map((x,j)=>x+b.H[i][j]))});
const scale=(a,s)=>({v:a.v*s,g:a.g.map(x=>x*s),H:a.H.map(r=>r.map(x=>x*s))});
const sub=(a,b)=>A(a,scale(b,-1));
const mul=(a,b)=>({v:a.v*b.v,g:a.g.map((x,i)=>x*b.v+a.v*b.g[i]),H:a.H.map((r,i)=>r.map((x,j)=>x*b.v+a.v*b.H[i][j]+a.g[i]*b.g[j]+b.g[i]*a.g[j]))});
const unary=(a,f,df,ddf)=>({v:f(a.v),g:a.g.map(x=>df(a.v)*x),H:a.H.map((r,i)=>r.map((x,j)=>df(a.v)*x+ddf(a.v)*a.g[i]*a.g[j]))});
const pow=(a,p)=>unary(a,x=>x**p,x=>p*x**(p-1),x=>p*(p-1)*x**(p-2));
const sin=a=>unary(a,Math.sin,Math.cos,x=>-Math.sin(x));
const cos=a=>unary(a,Math.cos,x=>-Math.sin(x),x=>-Math.cos(x));
const div=(a,b)=>mul(a,pow(b,-1));
const dot=(a,b)=>a.map((x,i)=>mul(x,b[i])).reduce(A,C(0));
const va=(a,b)=>a.map((x,i)=>A(x,b[i]));
const vs=(a,b)=>a.map((x,i)=>sub(x,b[i]));
const vm=(a,s)=>a.map(x=>mul(x,s));
const len=a=>pow(dot(a,a),.5);
const xyz=p=>[p.x,p.y,p.h].map(C);
function contactMap(att,q,{legs=[0,0],a:ai,b:bi,kind='interior',vk=4,ak=5}={}) {
 const z=[q.x,q.y,SQI*q.rot].map(X),theta=A(scale(z[2],1/SQI),C(legs[1]*2*Math.PI/3)),ct=cos(theta),st=sin(theta);
 const vp=k=>{const ph=k*Math.PI/24,rho=R*Math.sin(ph);return[A(z[0],scale(ct,rho)),A(z[1],scale(st,rho)),C(R*Math.cos(ph))];};
 const points=TC.arcPts(att,legs[0]);
 let pa,pv,w,sa=null,sv=null;
 if(kind==='victim-vertex') {
   const A0=xyz(points[ai]),edge=vs(xyz(points[ai+1]),A0),u=vm(edge,pow(len(edge),-1));pv=vp(vk);
   sa=dot(vs(pv,A0),u);pa=va(A0,vm(u,sa));w=vs(pv,pa);
 } else {
   const V0=vp(bi),edge=vs(vp(bi+1),V0),b=vm(edge,pow(len(edge),-1));
   if(kind==='attacker-vertex') {pa=xyz(points[ak]);sv=dot(vs(pa,V0),b);pv=va(V0,vm(b,sv));w=vs(pv,pa);}
   else {
     const A0=xyz(points[ai]),edgeA=vs(xyz(points[ai+1]),A0),u=vm(edgeA,pow(len(edgeA),-1)),v=vs(V0,A0),c=dot(u,b),ur=dot(u,v),br=dot(b,v);
     sv=div(sub(mul(c,ur),br),sub(C(1),mul(c,c)));sa=A(ur,mul(c,sv));
     pa=va(A0,vm(u,sa));pv=va(V0,vm(b,sv));w=vs(pv,pa);
   }
 }
 const d=len(w),gap=sub(d,C(D)),wh=len(w.slice(0,2)),nh=w.slice(0,2).map(x=>div(x,wh));
 const lever=[sub(pv[0],z[0]),sub(pv[1],z[1])],rn=sub(mul(lever[0],nh[1]),mul(lever[1],nh[0]));
 const direction=[...nh,scale(rn,1/I)],g=gap.g,H=gap.H,S=g.reduce((s,x)=>s+x*x,0);
 const phi=z.map((x,i)=>x.v-gap.v*g[i]/S);
 const J=g.map((_,i)=>g.map((_,j)=>(i===j?1:0)-g[i]*g[j]/S-gap.v*H[i][j]/S+
   2*gap.v*g[i]*g.reduce((s,x,k)=>s+x*H[k][j],0)/(S*S)));
 return{distance:d.v,G:gap.v,g,H,S,phi,J,sa:sa?.v,sv:sv?.v,hf:wh.v/d.v,rn:rn.v,
   direction:direction.map(x=>x.v),B:direction.map(x=>x.g.map((v,j)=>v*(j===2?SQI:1)))};
}
module.exports={contactMap};
