// See ./README.md.
// Is the victim's contact point parked on the phi=30 vertex of leg 0, or transiting?
'use strict';
const FW = require('../forced-win.js');
const CL = require('../contact-law.js');
const TC = require('../throw-cert.js');
const { R, MIND: D } = CL, CFG = CL.eng.CFG, H = CFG.hubHeight, NSEG = CFG.legSegs;
const DEG = Math.PI/180;
const pose = process.env.POSE.split(',').map(Number), pieces = FW.piecesOf(pose);
const att = 1, pv = 0, dir = -1, victim = 0;
const lim = FW.limitAt(pieces, att, pv, dir).lim, K = Math.round(lim / TC.LIM_SUB);
const arcPts = (p,i)=>{const b=p.rot+i*2*Math.PI/3,cb=Math.cos(b),sb=Math.sin(b),o=[];for(let k=0;k<=NSEG;k++){const ph=(k/NSEG)*Math.PI/2,s=Math.sin(ph)*R;o.push({x:p.x+cb*s,y:p.y+sb*s,h:Math.cos(ph)*H});}return o;};
const seg3=(p1,q1,p2,q2)=>{const d1={x:q1.x-p1.x,y:q1.y-p1.y,h:q1.h-p1.h},d2={x:q2.x-p2.x,y:q2.y-p2.y,h:q2.h-p2.h},r={x:p1.x-p2.x,y:p1.y-p2.y,h:p1.h-p2.h};
 const A=d1.x*d1.x+d1.y*d1.y+d1.h*d1.h,E=d2.x*d2.x+d2.y*d2.y+d2.h*d2.h,F=d2.x*r.x+d2.y*r.y+d2.h*r.h,C=d1.x*r.x+d1.y*r.y+d1.h*r.h,B=d1.x*d2.x+d1.y*d2.y+d1.h*d2.h,dn=A*E-B*B;
 let s=dn>1e-12?Math.min(1,Math.max(0,(B*F-C*E)/dn)):0;let t=E>1e-12?Math.min(1,Math.max(0,(B*s+F)/E)):0;
 if(t<=0||t>=1){t=Math.min(1,Math.max(0,t));s=Math.min(1,Math.max(0,A>1e-12?(B*t-C)/A:0));}
 const pa={x:p1.x+d1.x*s,y:p1.y+d1.y*s,h:p1.h+d1.h*s},pb={x:p2.x+d2.x*t,y:p2.y+d2.y*t,h:p2.h+d2.h*t};
 return {s,t,dist:Math.hypot(pb.x-pa.x,pb.y-pa.y,pb.h-pa.h),pb};};
const tr = TC.sweep(pieces, att, pv, dir, K);
console.log('  k   deg    pair   sA    sV   dist   arc angle of the victim contact (deg)   at a vertex?');
for (let k = 1; k <= K; k++) {
  const st = tr[k-1]; if (!st.pushes.length) continue;
  const A=[0,1,2].map(i=>arcPts(st.att,i)), pose0 = k===1?pieces[victim]:tr[k-2].pose, V=[0,1,2].map(j=>arcPts(pose0,j));
  let best=null;
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let a=0;a<NSEG;a++)for(let b=0;b<NSEG;b++){
    const c=seg3(A[i][a],A[i][a+1],V[j][b],V[j][b+1]);
    if(!best||c.dist<best.dist)best={...c,i,j,a,b};}
  // the contact's arc angle along the victim leg: chord b spans [b, b+1] * 90/NSEG degrees
  const phi = (best.b + best.t) * 90 / NSEG;
  const onVertex = Math.abs(phi - Math.round(phi/(90/NSEG))*(90/NSEG)) < 1e-9;
  const deg = k*TC.LIM_SUB/DEG;
  if (deg >= 22 && deg <= 28.5) console.log(`  ${String(k).padStart(3)} ${deg.toFixed(2).padStart(5)}  (${best.i},${best.j}) ${best.a},${best.b}  ${best.s.toFixed(3)} ${best.t.toFixed(3)} ${best.dist.toFixed(4)}   phi ${phi.toFixed(6).padStart(10)}   ${onVertex?'VERTEX':''}`);
}
