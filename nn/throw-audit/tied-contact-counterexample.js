// Check Astra's tied-interior-contact counterexample against our own engine.
'use strict';
const CL = require('../contact-law.js');
const { R, MIND: D } = CL, CFG = CL.eng.CFG, H = CFG.hubHeight, NSEG = CFG.legSegs;
const att = { x: -12.831776146126225, y: -26.997105145410310, rot: 2.7766483918085445 };
const vic = { x: -23.828114646314690, y: -38.136424156513700, rot: 1.3281868071241907 };
const arcPts = (p,i)=>{const b=p.rot+i*2*Math.PI/3,cb=Math.cos(b),sb=Math.sin(b),o=[];for(let k=0;k<=NSEG;k++){const ph=(k/NSEG)*Math.PI/2,s=Math.sin(ph)*R;o.push({x:p.x+cb*s,y:p.y+sb*s,h:Math.cos(ph)*H});}return o;};
const seg3=(p1,q1,p2,q2)=>{const d1={x:q1.x-p1.x,y:q1.y-p1.y,h:q1.h-p1.h},d2={x:q2.x-p2.x,y:q2.y-p2.y,h:q2.h-p2.h},r={x:p1.x-p2.x,y:p1.y-p2.y,h:p1.h-p2.h};
 const A=d1.x*d1.x+d1.y*d1.y+d1.h*d1.h,E=d2.x*d2.x+d2.y*d2.y+d2.h*d2.h,F=d2.x*r.x+d2.y*r.y+d2.h*r.h,C=d1.x*r.x+d1.y*r.y+d1.h*r.h,B=d1.x*d2.x+d1.y*d2.y+d1.h*d2.h,dn=A*E-B*B;
 let s=dn>1e-12?Math.min(1,Math.max(0,(B*F-C*E)/dn)):0;let t=E>1e-12?(B*s+F)/E:0;
 if(t<0){t=0;s=Math.min(1,Math.max(0,A>1e-12?-C/A:0));}else if(t>1){t=1;s=Math.min(1,Math.max(0,A>1e-12?(B-C)/A:0));}
 const pa={x:p1.x+d1.x*s,y:p1.y+d1.y*s,h:p1.h+d1.h*s},pb={x:p2.x+d2.x*t,y:p2.y+d2.y*t,h:p2.h+d2.h*t};
 return {pa,pb,dist:Math.hypot(pb.x-pa.x,pb.y-pa.y,pb.h-pa.h),s,t};};
const scan = v => { const A3=[0,1,2].map(i=>arcPts(att,i)), V3=[0,1,2].map(j=>arcPts(v,j)); const out=[];
  for(let i=0;i<3;i++)for(let j=0;j<3;j++){let best=null; for(let p=0;p<NSEG;p++)for(let q=0;q<NSEG;q++){const c=seg3(A3[i][p],A3[i][p+1],V3[j][q],V3[j][q+1]); if(!best||c.dist<best.dist)best={...c,p,q};} out.push({i,j,...best});}
  return out; };
const rows = scan(vic);
const A3=[0,1,2].map(i=>arcPts(att,i)), V3=[0,1,2].map(j=>arcPts(vic,j));
const pairAt=(i,j,p,q)=>seg3(A3[i][p],A3[i][p+1],V3[j][q],V3[j][q+1]);
console.log('CLAIM 1: two segment pairs on leg (0,0) tie at 2.870742032284565 / ...564');
for (const [p,q] of [[3,4],[2,4]]) { const c=pairAt(0,0,p,q);
  const n=[(c.pb.x-c.pa.x)/c.dist,(c.pb.y-c.pa.y)/c.dist,(c.pb.h-c.pa.h)/c.dist];
  console.log(`  A${p}/V${q}: dist ${c.dist.toFixed(15)}  sA ${c.s.toFixed(7)}  sV ${c.t.toFixed(7)}  n3 (${n.map(x=>x.toFixed(9)).join(', ')})`); }
console.log('CLAIM 2: every other leg pair is at least 4.626u away');
console.log('  ' + rows.filter(r=>!(r.i===0&&r.j===0)).map(r=>`(${r.i},${r.j}) ${r.dist.toFixed(3)}`).join('  '));
console.log(`  min over other leg pairs: ${Math.min(...rows.filter(r=>!(r.i===0&&r.j===0)).map(r=>r.dist)).toFixed(4)}`);
console.log('CLAIM 3: a 1e-7 shift in x switches the selected pair and jumps the normal by 0.119');
for (const dx of [-1e-7, 1e-7]) { const v={...vic, x: vic.x+dx}; const rr=scan(v).reduce((m,x)=>x.dist<m.dist?x:m);
  const V=[0,1,2].map(j=>arcPts(v,j)); const c=seg3(A3[rr.i][rr.p],A3[rr.i][rr.p+1],V[rr.j][rr.q],V[rr.j][rr.q+1]);
  const n=[(c.pb.x-c.pa.x)/c.dist,(c.pb.y-c.pa.y)/c.dist,(c.pb.h-c.pa.h)/c.dist];
  console.log(`  x${dx>0?'+':'-'}1e-7: selects A${rr.p}/V${rr.q} dist ${c.dist.toFixed(12)} n3 (${n.map(x=>x.toFixed(6)).join(', ')})  contactA (${c.pa.x.toFixed(4)},${c.pa.y.toFixed(4)},${c.pa.h.toFixed(4)})`); }
const na=(()=>{const c=pairAt(0,0,3,4);return [(c.pb.x-c.pa.x)/c.dist,(c.pb.y-c.pa.y)/c.dist,(c.pb.h-c.pa.h)/c.dist];})();
const nb=(()=>{const c=pairAt(0,0,2,4);return [(c.pb.x-c.pa.x)/c.dist,(c.pb.y-c.pa.y)/c.dist,(c.pb.h-c.pa.h)/c.dist];})();
console.log(`  |n3 jump| = ${Math.hypot(na[0]-nb[0],na[1]-nb[1],na[2]-nb[2]).toFixed(6)} (Astra: 0.119185), angle ${(2*Math.asin(Math.hypot(na[0]-nb[0],na[1]-nb[1],na[2]-nb[2])/2)*180/Math.PI).toFixed(3)} deg`);
const ca=pairAt(0,0,3,4), cb2=pairAt(0,0,2,4);
console.log(`  |attacker contact jump| = ${Math.hypot(ca.pa.x-cb2.pa.x,ca.pa.y-cb2.pa.y,ca.pa.h-cb2.pa.h).toFixed(6)} (Astra: 0.359471)`);
console.log(`  |victim contact jump|   = ${Math.hypot(ca.pb.x-cb2.pb.x,ca.pb.y-cb2.pb.y,ca.pb.h-cb2.pb.h).toFixed(6)} (Astra: 0.110240)`);
console.log('CLAIM 4: resolvePush from the two inputs differs by 0.00246518u in final hub position');
const out = [-1e-7, 1e-7].map(dx => { const o={x:vic.x+dx,y:vic.y,rot:vic.rot}; const a={...att};
  const TC = require('../throw-cert.js'); TC.pushSubstep ? TC.pushSubstep(a,o) : null; return o; });
console.log(`  final hubs: (${out[0].x.toFixed(9)}, ${out[0].y.toFixed(9)}) and (${out[1].x.toFixed(9)}, ${out[1].y.toFixed(9)})`);
console.log(`  |difference| = ${Math.hypot(out[0].x-out[1].x, out[0].y-out[1].y).toFixed(9)}u, rot diff ${(out[0].rot-out[1].rot).toExponential(3)}`);
