// exact vertex crossings: track the closest-pair chord indices of the engine's own arcClosest
const F=require('../forced-win.js');const C=require('../contact-law.js');const R=C.R,DEG=Math.PI/180,{REPLICA,feetOf}=C;
const blue0={x:-24.31126879077936,y:-37.34799285619334,rot:1.3448263401595464}, red0={x:-11.7593,y:-23.2838,rot:2.9442};
const H=R, NSEG=12;
const arcPts=(p,i)=>{const a=p.rot+i*2*Math.PI/3,ca=Math.cos(a),sa=Math.sin(a),pts=[];for(let k=0;k<=NSEG;k++){const ph=(k/NSEG)*Math.PI/2,s=Math.sin(ph)*R;pts.push({x:p.x+ca*s,y:p.y+sa*s,h:Math.cos(ph)*H});}return pts;};
function seg3(p1,q1,p2,q2){const d1={x:q1.x-p1.x,y:q1.y-p1.y,h:q1.h-p1.h},d2={x:q2.x-p2.x,y:q2.y-p2.y,h:q2.h-p2.h},r={x:p1.x-p2.x,y:p1.y-p2.y,h:p1.h-p2.h};
 const a=d1.x*d1.x+d1.y*d1.y+d1.h*d1.h,e=d2.x*d2.x+d2.y*d2.y+d2.h*d2.h,f=d2.x*r.x+d2.y*r.y+d2.h*r.h,c=d1.x*r.x+d1.y*r.y+d1.h*r.h,b=d1.x*d2.x+d1.y*d2.y+d1.h*d2.h,dn=a*e-b*b;
 let s=dn>1e-12?Math.min(1,Math.max(0,(b*f-c*e)/dn)):0;let t=e>1e-12?(b*s+f)/e:0;
 if(t<0){t=0;s=Math.min(1,Math.max(0,a>1e-12?-c/a:0));}else if(t>1){t=1;s=Math.min(1,Math.max(0,a>1e-12?(b-c)/a:0));}
 const pa={x:p1.x+d1.x*s,y:p1.y+d1.y*s,h:p1.h+d1.h*s},pb={x:p2.x+d2.x*t,y:p2.y+d2.y*t,h:p2.h+d2.h*t};
 return {pa,pb,dist:Math.hypot(pb.x-pa.x,pb.y-pa.y,pb.h-pa.h),s,t};}
const P={x:-34.40582386831619,y:-18.75456367565295};
const rot=(p,dA)=>{const c=Math.cos(dA),s=Math.sin(dA),rx=p.x-P.x,ry=p.y-P.y;return {x:P.x+rx*c-ry*s,y:P.y+rx*s+ry*c,rot:p.rot+dA};};
const SUB=(1/3)*DEG;
const o=C.swing([blue0,red0],1,0,-1,46*DEG,{...REPLICA,stepDeg:1/3,record:true});
let prev=null,rows=[];
for(let k=1;k<=o.record.length;k++){const rec=o.record[k-1];const att=rot(red0,-k*SUB);
 const A=arcPts(att,0),V=arcPts(rec,0);let best=null;
 for(let a=0;a<NSEG;a++)for(let b=0;b<NSEG;b++){const c=seg3(A[a],A[a+1],V[b],V[b+1]);if(!best||c.dist<best.dist)best={a,b,...c};}
 const deg=k*(1/3);
 const phiA=Math.asin(Math.min(1,Math.hypot(best.pa.x-att.x,best.pa.y-att.y)/R))/DEG;
 const phiV=Math.asin(Math.min(1,Math.hypot(best.pb.x-rec.x,best.pb.y-rec.y)/R))/DEG;
 if(best.dist<C.MIND+1e-9){ if(prev&&(best.a!==prev.a||best.b!==prev.b)){const side=best.a!==prev.a?'attacker':'victim',v=best.a!==prev.a?7.5*Math.max(best.a,prev.a):7.5*Math.max(best.b,prev.b);
   console.log(`  chord pair ${prev.a},${prev.b} -> ${best.a},${best.b} between sweep ${(deg-1/3).toFixed(2)} and ${deg.toFixed(2)} deg: ${side}'s leg, vertex phi=${v.toFixed(1)} deg`);}
  rows.push({deg,a:best.a,b:best.b,phiA,phiV,dist:best.dist});prev={a:best.a,b:best.b};}
 if(rec.maxFootR>C.EDGE){console.log('thrown at sweep',deg.toFixed(2),'deg');break;}
}
const f=rows[0],l=rows[rows.length-1];
console.log(`in contact ${f.deg.toFixed(2)} to ${l.deg.toFixed(2)} deg; phiA ${f.phiA.toFixed(2)} -> ${l.phiA.toFixed(2)}, phiV ${f.phiV.toFixed(2)} -> ${l.phiV.toFixed(2)}`);
console.log(`walk attacker ${((f.phiA-l.phiA)*DEG*R).toFixed(3)}u, victim ${((f.phiV-l.phiV)*DEG*R).toFixed(3)}u; per substep ${((f.phiA-l.phiA)*DEG*R/(rows.length-1)).toFixed(4)}u and ${((f.phiV-l.phiV)*DEG*R/(rows.length-1)).toFixed(4)}u; chord ${(R*7.5*DEG).toFixed(3)}u`);
