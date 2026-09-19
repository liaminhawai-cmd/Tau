// See ./README.md.
'use strict';
const FW = require('../forced-win.js');
const CL = require('../contact-law.js');
const TC = require('../throw-cert.js');
const { R, MIND: D, EDGE } = CL, CFG = CL.eng.CFG, H = CFG.hubHeight, NSEG = CFG.legSegs;
const DEG = Math.PI/180;
const pose = process.env.POSE.split(',').map(Number), pieces = FW.piecesOf(pose);
const att = 1, pv = 0, dir = -1, victim = 0;
const lim = FW.limitAt(pieces, att, pv, dir).lim, K = Math.round(lim / TC.LIM_SUB);
const arcPts = (p,i)=>{const b=p.rot+i*2*Math.PI/3,cb=Math.cos(b),sb=Math.sin(b),o=[];for(let k=0;k<=NSEG;k++){const ph=(k/NSEG)*Math.PI/2,s=Math.sin(ph)*R;o.push({x:p.x+cb*s,y:p.y+sb*s,h:Math.cos(ph)*H});}return o;};
const seg3=(p1,q1,p2,q2)=>{const d1={x:q1.x-p1.x,y:q1.y-p1.y,h:q1.h-p1.h},d2={x:q2.x-p2.x,y:q2.y-p2.y,h:q2.h-p2.h},r={x:p1.x-p2.x,y:p1.y-p2.y,h:p1.h-p2.h};
 const A=d1.x*d1.x+d1.y*d1.y+d1.h*d1.h,E=d2.x*d2.x+d2.y*d2.y+d2.h*d2.h,F=d2.x*r.x+d2.y*r.y+d2.h*r.h,C=d1.x*r.x+d1.y*r.y+d1.h*r.h,B=d1.x*d2.x+d1.y*d2.y+d1.h*d2.h,dn=A*E-B*B;
 let s=dn>1e-12?Math.min(1,Math.max(0,(B*F-C*E)/dn)):0;let t=E>1e-12?(B*s+F)/E:0;
 if(t<0){t=0;s=Math.min(1,Math.max(0,A>1e-12?-C/A:0));}else if(t>1){t=1;s=Math.min(1,Math.max(0,A>1e-12?(B-C)/A:0));}
 const pa={x:p1.x+d1.x*s,y:p1.y+d1.y*s,h:p1.h+d1.h*s},pb={x:p2.x+d2.x*t,y:p2.y+d2.y*t,h:p2.h+d2.h*t};
 return {pa,pb,dist:Math.hypot(pb.x-pa.x,pb.y-pa.y,pb.h-pa.h),s,t};};
const tr = TC.sweep(pieces, att, pv, dir, K);
console.log('ASTRA: "chord data immediately before substep 11: chi=73.6430 deg, d=2.834490u, pair (3,4), fractions (0.461718, 0.882485)"');
for (const k of [11, 12, 13]) {
  const enter = k === 1 ? pieces[victim] : tr[k-2].pose, A3 = arcPts(tr[k-1].att, 0), V3 = arcPts(enter, 0);
  let best=null; for(let p=0;p<NSEG;p++)for(let q=0;q<NSEG;q++){const c=seg3(A3[p],A3[p+1],V3[q],V3[q+1]); if(!best||c.dist<best.dist)best={...c,p,q};}
  const uA=[A3[best.p+1].x-A3[best.p].x,A3[best.p+1].y-A3[best.p].y,A3[best.p+1].h-A3[best.p].h];
  const uV=[V3[best.q+1].x-V3[best.q].x,V3[best.q+1].y-V3[best.q].y,V3[best.q+1].h-V3[best.q].h];
  const la=Math.hypot(...uA), lv=Math.hypot(...uV);
  const chi=Math.acos(Math.abs((uA[0]*uV[0]+uA[1]*uV[1]+uA[2]*uV[2])/(la*lv)))/DEG;
  console.log(`  pre-push at substep ${k}: pair (${best.p},${best.q}) d ${best.dist.toFixed(6)} fractions (${best.s.toFixed(6)}, ${best.t.toFixed(6)}) chi ${chi.toFixed(4)} deg`);
}
console.log('\nHow many Gauss-Seidel passes does the centre actually use, and does any substep exhaust the 10?');
let maxIters=0, exhausted=0, withPush=0;
for (const st of tr) { if (!st.pushes.length) continue; withPush++; if (st.flags.iters > maxIters) maxIters = st.flags.iters; if (st.flags.iters >= CFG.pushIters || st.flags.iters >= 10) exhausted++; }
console.log(`  ${withPush} pushing substeps, max passes used ${maxIters} of 10, substeps that exhausted the cap: ${exhausted}`);
console.log('\nPost-push minimum gap over the whole sweep (is it ever below D?)');
let worstBelow = 0, maxOver = 0;
for (const st of tr) { if (!st.pushes.length) continue; const A3=[0,1,2].map(i=>arcPts(st.att,i)), V3=[0,1,2].map(j=>arcPts(st.pose,j));
  let best=Infinity; for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let p=0;p<NSEG;p++)for(let q=0;q<NSEG;q++){const c=seg3(A3[i][p],A3[i][p+1],V3[j][q],V3[j][q+1]); if(c.dist<best)best=c.dist;}
  if (best < D) worstBelow = Math.min(worstBelow, best - D); if (best - D > maxOver) maxOver = best - D; }
console.log(`  worst shortfall below D: ${worstBelow.toExponential(3)}u   worst overshoot above D: ${maxOver.toExponential(3)}u`);
console.log(`  (Astra's route via D4 predicts a two-sided residual of 1.13e-3u on interior chords)`);
