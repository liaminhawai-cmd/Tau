const F=require('../forced-win.js');const C=require('../contact-law.js');const R=C.R,DEG=Math.PI/180;
const key=e=>`f${e.foot}:c${e.circle}:${e.kind}:${(e.D??e.A).toFixed(3)}:${e.sign}`;
function grad(fn){const h=1e-4;return [(fn(h,0,0)-fn(-h,0,0))/(2*h),(fn(0,h,0)-fn(0,-h,0))/(2*h),(fn(0,0,h)-fn(0,0,-h))/(2*h)];}
const feetAt=(seed,v,dx,dy,t)=>{const ps=F.piecesOf(seed);const q={x:ps[v].x+dx,y:ps[v].y+dy,rot:ps[v].rot+t/R};return C.feetOf(q);};
function report(name,fn,fitN,fitD){const f=fn(0,0,0),g=grad(fn),gl=Math.hypot(...g),u=g.map(x=>x/gl);const cos=u[0]*fitN[0]+u[1]*fitN[1]+u[2]*fitN[2];console.log(`${name}: value at seed ${f.toFixed(4)}, |grad| ${gl.toFixed(4)} per u, unit grad (${u.map(x=>x.toFixed(3))}), cos with plane normal ${cos.toFixed(3)}, distance to zero set ${(Math.abs(f)/gl).toFixed(3)}u (plane fit ${Math.abs(fitD)}u)`);}
// l5807vazg: foot 2 on a1's centreline (start side), and the two-foot order wall f2 leaves a1 band vs f1 enters r1 band
{const seed=[37.6039,-3.2612,1.8896,50.4287,10.5092,-.859],v=1;
 report('l5807vazg A: |foot2 - Ca1| - 40.00',(dx,dy,t)=>{const f=feetAt(seed,v,dx,dy,t)[2];return Math.hypot(f.x-66.667,f.y)-40;},[-0.937,0.146,-0.319],-0.555);
 report('l5807vazg B: s[f1 enters r1 band 54.11] - s[f2 leaves a1 band 40.81] on arm (0,+), deg',(dx,dy,t)=>{const E=F.limitEvents(feetAt(seed,v,dx,dy,t),0,1);const a=E.find(e=>e.foot===2&&e.circle===3&&e.kind==='level'&&Math.abs(e.D-40.81)<1e-6&&e.sign===-1),b=E.find(e=>e.foot===1&&e.circle===1&&e.kind==='level'&&Math.abs(e.D-54.11)<1e-6&&e.sign===1);return (b.s-a.s)/DEG;},[-0.778,-0.073,-0.624],0.708);
 // rot-independence of B in the pivot plane
 {const P=feetAt(seed,v,0,0,0)[0];const ps=F.piecesOf(seed);const H=(rot)=>{const q={x:P.x-R*Math.cos(rot),y:P.y-R*Math.sin(rot),rot};const E=F.limitEvents(C.feetOf(q),0,1);const a=E.find(e=>e.foot===2&&e.circle===3&&e.kind==='level'&&Math.abs(e.D-40.81)<1e-6&&e.sign===-1),b=E.find(e=>e.foot===1&&e.circle===1&&e.kind==='level'&&Math.abs(e.D-54.11)<1e-6&&e.sign===1);return (b.s-a.s)/DEG;};let mx=0;for(const t of [-3,-1,1,3])mx=Math.max(mx,Math.abs(H(ps[v].rot+t/R)-H(ps[v].rot)));console.log('   B with the pivot foot fixed and rot varied +-3u: max change '+mx.toExponential(2)+' deg');}
}
// 0r8c3cohc: foot 0 on r1's centreline; tangency of foot 1's circle about foot 0 to a1's outer band edge
{const seed=[.8192,-30.3367,-3.2227,19.4916,-35.329,4.106],v=1;
 report('0r8c3cohc C: |foot0| - 53.30',(dx,dy,t)=>{const f=feetAt(seed,v,dx,dy,t)[0];return Math.hypot(f.x,f.y)-53.3;},[-0.086,0.826,-0.558],-1.143);
 report('0r8c3cohc D: |foot0 - Ca1| - (rho + 40.81), arm (0,+) tangency',(dx,dy,t)=>{const fe=feetAt(seed,v,dx,dy,t);const P=fe[0],rho=Math.hypot(fe[1].x-P.x,fe[1].y-P.y);return Math.hypot(P.x-66.667,P.y)-(rho+40.81);},[-0.723,-0.654,-0.224],0.354);
 report('0r8c3cohc E: |foot0 - K8| - (rho + 0.81), arm (0,+) corner-disc tangency',(dx,dy,t)=>{const fe=feetAt(seed,v,dx,dy,t);const P=fe[0],rho=Math.hypot(fe[1].x-P.x,fe[1].y-P.y);return Math.hypot(P.x-42.64,P.y+31.98)-(rho+0.81);},[-0.782,-0.545,-0.304],1.435);
}
// 6dgqa1fd8: corner-disc tangency K6 for foot 2 about foot 0
{const seed=[2.6627,33.2224,2.2687,4.2061,47.1181,4.4905],v=1;
 report('6dgqa1fd8 F: |foot0 - K6| - (rho + 0.81), arm (0,+) corner-disc tangency',(dx,dy,t)=>{const fe=feetAt(seed,v,dx,dy,t);const P=fe[0],rho=Math.hypot(fe[2].x-P.x,fe[2].y-P.y);return Math.hypot(P.x+42.64,P.y-31.98)-(rho+0.81);},[-0.697,0.102,-0.710],-1.018);
 const E=F.limitEvents(feetAt(seed,v,0,0,0),0,1).filter(e=>e.circle>=5&&e.s<100*DEG);console.log('   corner-disc events on (0,+) at the seed within 100 deg: '+E.map(e=>`${(e.s/DEG).toFixed(2)} f${e.foot} K${e.circle-4}${e.sign>0?'+':'-'}`).join(', '));
}
// ndpxhts24 throw: 3D crossing angle between the leg tangents at the contact
{const rows=JSON.parse(require('fs').readFileSync('out/throw-rows.json'));
 const blue0={x:-24.31126879077936,y:-37.34799285619334,rot:1.3448263401595464}, red0={x:-11.7593,y:-23.2838,rot:2.9442};
 const P={x:-34.40582386831619,y:-18.75456367565295};
 for(const k of [10,20,30,40,50,60,70]){const r=rows[k-1];if(!r.contact)continue;const alpha=-k*0.4*DEG;const psiA=red0.rot+alpha;const psiV=r.pose[2]*DEG;const phA=r.phiA*DEG,phV=r.phiB*DEG;
  const uA=[Math.cos(phA)*Math.cos(psiA),Math.cos(phA)*Math.sin(psiA),-Math.sin(phA)],uV=[Math.cos(phV)*Math.cos(psiV),Math.cos(phV)*Math.sin(psiV),-Math.sin(phV)];
  const cr=[uA[1]*uV[2]-uA[2]*uV[1],uA[2]*uV[0]-uA[0]*uV[2],uA[0]*uV[1]-uA[1]*uV[0]];const s=Math.hypot(...cr);
  console.log(`k${k} ${r.deg}deg: leg dirs red ${(psiA/DEG).toFixed(1)} blue ${(psiV/DEG).toFixed(1)}, phi red ${r.phiA} blue ${r.phiB}, horizontal chord angle ${r.psi}, 3D crossing angle ${(Math.asin(Math.min(1,s))/DEG).toFixed(1)} deg, hf ${r.hf}, rn ${r.rn}, n ${r.n}, K=1+1/sin ${(1+1/s).toFixed(2)}`);}
}
