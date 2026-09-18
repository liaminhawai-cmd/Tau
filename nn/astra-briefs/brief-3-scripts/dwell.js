const F=require('../forced-win.js');const C=require('../contact-law.js');const R=C.R,DEG=Math.PI/180,{REPLICA,feetOf}=C;
const blue0={x:-24.31126879077936,y:-37.34799285619334,rot:1.3448263401595464}, red0={x:-11.7593,y:-23.2838,rot:2.9442};
const P={x:-34.40582386831619,y:-18.75456367565295};
const o=C.swing([blue0,red0],1,0,-1,46*DEG,{...REPLICA,stepDeg:1/3,trace:true,record:true});
const arcP=(p,i)=>{const a=p.rot+i*2*Math.PI/3,ca=Math.cos(a),sa=Math.sin(a),pts=[];for(let k=0;k<=12;k++){const ph=(k/12)*Math.PI/2,s=Math.sin(ph)*R;pts.push({x:p.x+ca*s,y:p.y+sa*s,h:Math.cos(ph)*R});}return pts;};
let dwellFrom=null,n=0,maxd=0,thrownAt=null;
for(const t of o.trace){const deg=t.alpha/DEG,k=Math.round(deg*3),rec=o.record[k-1];
 const V=arcP(rec,0),vx=V[4];                                  // the victim's phi = 30 vertex
 const d=Math.hypot(t.pb.x-vx.x,t.pb.y-vx.y);                  // horizontal distance of the contact point from it
 if(d<1e-6){ if(dwellFrom===null)dwellFrom=deg; n++; maxd=Math.max(maxd,d);} else if(dwellFrom!==null&&deg>dwellFrom){ /* left it */ }
 if(thrownAt===null&&rec.maxFootR>C.EDGE)thrownAt=deg;
}
console.log(`victim contact sits EXACTLY on its phi = 30 vertex from sweep ${dwellFrom.toFixed(2)} deg for ${n} of the ${o.trace.length} contact substeps (max deviation ${maxd.toExponential(1)}u)`);
console.log(`throw at ${thrownAt.toFixed(2)} deg, sweep limit 46.00; so the dwell covers ${(thrownAt-dwellFrom).toFixed(2)} deg of the ${thrownAt.toFixed(2)}-degree run to the throw`);
const last=o.trace[o.trace.length-1];
console.log(`at the end of the sweep phiB = ${(last.phiB/DEG).toFixed(3)} deg, phiA = ${(last.phiA/DEG).toFixed(3)} deg`);
// is it a genuine corner-stick? check the distance function along the victim polyline either side of the vertex
const k0=Math.round(26*3),rec=o.record[k0-1],att=(dA=>{const c=Math.cos(dA),s=Math.sin(dA),rx=red0.x-P.x,ry=red0.y-P.y;return {x:P.x+rx*c-ry*s,y:P.y+rx*s+ry*c,rot:red0.rot+dA};})(-k0*(1/3)*DEG);
const A=arcP(att,0),V=arcP(rec,0);
function segd(p,q0,q1){const dx=q1.x-q0.x,dy=q1.y-q0.y,dh=q1.h-q0.h,L=dx*dx+dy*dy+dh*dh;let t=((p.x-q0.x)*dx+(p.y-q0.y)*dy+(p.h-q0.h)*dh)/L;t=Math.max(0,Math.min(1,t));return Math.hypot(q0.x+dx*t-p.x,q0.y+dy*t-p.y,q0.h+dh*t-p.h);}
console.log('\nat sweep 26.00, distance from the attacker polyline to points along the victim leg near the vertex (phi in deg -> 3D distance u):');
for(let ph=27;ph<=33;ph+=0.5){const s=Math.sin(ph*DEG)*R,a=rec.rot,pt={x:rec.x+Math.cos(a)*s,y:rec.y+Math.sin(a)*s,h:Math.cos(ph*DEG)*R};
 let best=Infinity;for(let i=0;i<12;i++)best=Math.min(best,segd(pt,A[i],A[i+1]));
 console.log(`   phi ${ph.toFixed(1).padStart(4)}  ${best.toFixed(5)}${Math.abs(ph-30)<1e-9?'   <- the polyline vertex':''}`);}
