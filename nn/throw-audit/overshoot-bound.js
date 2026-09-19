// See ./README.md.
'use strict';
const FW = require('../forced-win.js');
const CL = require('../contact-law.js');
const TC = require('../throw-cert.js');
const { R, I, MIND: D, EDGE } = CL, CFG = CL.eng.CFG, H = CFG.hubHeight, NSEG = CFG.legSegs;
const DEG = Math.PI/180;
const pose = process.env.POSE.split(',').map(Number), pieces = FW.piecesOf(pose);
const att = 1, pv = 0, dir = -1, victim = 0;
const lim = FW.limitAt(pieces, att, pv, dir).lim, K = Math.round(lim / TC.LIM_SUB);
const arcPts = (p,i)=>{const b=p.rot+i*2*Math.PI/3,cb=Math.cos(b),sb=Math.sin(b),o=[];for(let k=0;k<=NSEG;k++){const ph=(k/NSEG)*Math.PI/2,s=Math.sin(ph)*R;o.push({x:p.x+cb*s,y:p.y+sb*s,h:Math.cos(ph)*H});}return o;};
const seg3=(p1,q1,p2,q2)=>{const d1={x:q1.x-p1.x,y:q1.y-p1.y,h:q1.h-p1.h},d2={x:q2.x-p2.x,y:q2.y-p2.y,h:q2.h-p2.h},r={x:p1.x-p2.x,y:p1.y-p2.y,h:p1.h-p2.h};
 const A=d1.x*d1.x+d1.y*d1.y+d1.h*d1.h,E=d2.x*d2.x+d2.y*d2.y+d2.h*d2.h,F=d2.x*r.x+d2.y*r.y+d2.h*r.h,C=d1.x*r.x+d1.y*r.y+d1.h*r.h,B=d1.x*d2.x+d1.y*d2.y+d1.h*d2.h,dn=A*E-B*B;
 let s=dn>1e-12?Math.min(1,Math.max(0,(B*F-C*E)/dn)):0;let t=E>1e-12?(B*s+F)/E:0;
 if(t<0){t=0;s=Math.min(1,Math.max(0,A>1e-12?-C/A:0));}else if(t>1){t=1;s=Math.min(1,Math.max(0,A>1e-12?(B-C)/A:0));}
 return {dist:Math.hypot((p2.x+d2.x*t)-(p1.x+d1.x*s),(p2.y+d2.y*t)-(p1.y+d1.y*s),(p2.h+d2.h*t)-(p1.h+d1.h*s))};};
const minGap = (a, v) => { const A3=[0,1,2].map(i=>arcPts(a,i)), V3=[0,1,2].map(j=>arcPts(v,j)); let best=Infinity;
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let p=0;p<NSEG;p++)for(let q=0;q<NSEG;q++){const c=seg3(A3[i][p],A3[i][p+1],V3[j][q],V3[j][q+1]); if(c.dist<best)best=c.dist;} return best; };
const tr = TC.sweep(pieces, att, pv, dir, K);
const etaOf = eps => R*(1-Math.cos(eps)) + R*Math.max(0, eps-Math.sin(eps));
console.log(' k   deg   flags            passes  post-push min gap - D   my eta bound   ratio');
let worst = 0, worstClean = 0, viol = 0;
for (const st of tr) {
  if (!st.pushes.length) continue;
  const over = minGap(st.att, st.pose) - D;
  const Lam = st.pushes.reduce((s,p)=>s+p.lambda, 0), rn = Math.max(...st.pushes.map(p=>Math.abs(p.rn)));
  const eta = etaOf(Lam*rn/I);
  const clean = !(st.flags.hub || st.flags.deep || st.flags.cap || st.flags.hfFloor) && st.pushes.every(p=>p.kind==='leg');
  if (over > worst) worst = over;
  if (clean && over > worstClean) worstClean = over;
  if (clean && over > eta) { viol++; if (viol <= 6) console.log(` ${String(st.k).padStart(3)} ${(st.k*TC.LIM_SUB/DEG).toFixed(2).padStart(6)}  BOUND EXCEEDED  ${st.flags.iters}      ${over.toExponential(3)}         ${eta.toExponential(3)}   ${(over/eta).toFixed(1)}`); }
  if (over > 1e-3) console.log(` ${String(st.k).padStart(3)} ${(st.k*TC.LIM_SUB/DEG).toFixed(2).padStart(6)}  hub${st.flags.hub} deep${st.flags.deep} cap${st.flags.cap} hf${st.flags.hfFloor} kinds ${[...new Set(st.pushes.map(p=>p.kind))].join('/')}  ${st.flags.iters}   ${over.toExponential(3)}   ${eta.toExponential(3)}`);
}
console.log(`\nworst post-push overshoot over the whole sweep: ${worst.toExponential(3)}u`);
console.log(`worst over substeps with ONLY plain leg pushes and no flags: ${worstClean.toExponential(3)}u`);
console.log(`substeps where a clean push beat my eta bound: ${viol}`);
