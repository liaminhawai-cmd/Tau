// identify each big wall's closed form: compare the plane fit with candidate wall functions' gradients
const F=require('../forced-win.js');const C=require('../contact-law.js');
const R=C.R, DEG=Math.PI/180;
const eng=C.eng, CFG=eng.CFG;
const circles=[{n:'r0',cx:0,cy:0,r:CFG.rings[0]},{n:'r1',cx:0,cy:0,r:CFG.rings[1]},{n:'a0',cx:CFG.sideArcs[0].cx,cy:CFG.sideArcs[0].cy,r:CFG.sideArcs[0].r},{n:'a1',cx:CFG.sideArcs[1].cx,cy:CFG.sideArcs[1].cy,r:CFG.sideArcs[1].r},{n:'rim',cx:0,cy:0,r:C.EDGE}];
const corners=eng.LINE_INTERSECTIONS.map((p,i)=>({n:'K'+(i+1),x:p.x,y:p.y}));
console.log('corners',corners.map(k=>`${k.n}=(${k.x.toFixed(2)},${k.y.toFixed(2)})`).join(' '));
console.log('sideArcs',JSON.stringify(CFG.sideArcs),'rings',JSON.stringify(CFG.rings),'touchEps',CFG.touchEps,'cornerEps',CFG.cornerEps);
const walls=[
 {id:'6dgqa1fd8',v:1,p:[2.6627,33.2224,2.2687,4.2061,47.1181,4.4905],arm:[0,1],n:[-0.697,0.102,-0.710],d:-1.018,what:'corner merge a0,r1 -> stop r0 (35 deg)'},
 {id:'l5807vazg',v:1,p:[37.6039,-3.2612,1.8896,50.4287,10.5092,-.859],arm:[0,1],n:[-0.937,0.146,-0.319],d:-0.555,what:'(0,+) crossed a1/stop r1 <-> crossed r1/stop r0 (19.7 deg); same plane on (1,-) and (1,+)'},
 {id:'l5807vazg',v:1,p:[37.6039,-3.2612,1.8896,50.4287,10.5092,-.859],arm:[0,1],n:[-0.778,-0.073,-0.624],d:0.708,what:'(0,+) crossed a1,r1/stop r0 <-> crossed a1/stop r1 (19.7 deg)'},
 {id:'0r8c3cohc',v:1,p:[.8192,-30.3367,-3.2227,19.4916,-35.329,4.106],arm:[0,1],n:[-0.723,-0.654,-0.224],d:0.354,what:'(0,+) stop f1:a1 <-> stop f1:r0 (10.7 deg)'},
 {id:'0r8c3cohc',v:1,p:[.8192,-30.3367,-3.2227,19.4916,-35.329,4.106],arm:[1,-1],n:[-0.086,0.826,-0.558],d:-1.143,what:'(1,-) crossed r0/stop f2:a1 <-> crossed r1/stop f0:r0 (13 deg); same plane on (1,+),(2,+),(2,-)'},
 {id:'0r8c3cohc',v:1,p:[.8192,-30.3367,-3.2227,19.4916,-35.329,4.106],arm:[2,1],n:[0.899,-0.338,-0.279],d:1.358,what:'(2,+) corner merge a1,r1 -> stop f0:a1 (59.7 deg)'},
 {id:'0r8c3cohc',v:1,p:[.8192,-30.3367,-3.2227,19.4916,-35.329,4.106],arm:[0,1],n:[-0.782,-0.545,-0.304],d:1.435,what:'(0,+) corner merge a1,r1 -> stop f1:r0 (17.7 deg)'},
];
const feetAt=(seed,v,dx,dy,t)=>{const ps=F.piecesOf(seed);const q={x:ps[v].x+dx,y:ps[v].y+dy,rot:ps[v].rot+t/R};return {q,feet:C.feetOf(q)};};
function grad(fn){const h=1e-4;return [(fn(h,0,0)-fn(-h,0,0))/(2*h),(fn(0,h,0)-fn(0,-h,0))/(2*h),(fn(0,0,h)-fn(0,0,-h))/(2*h)];}
for(const w of walls){
 console.log(`\n== ${w.id} ${w.what}: plane normal (${w.n}), seed at ${w.d}u`);
 const cands=[];
 // A4/A5: foot j at level D of circle c (centreline, band edges, rim)
 for(let j=0;j<3;j++)for(const c of circles)for(const D of (c.n==='rim'?[c.r]:[c.r-CFG.touchEps,c.r,c.r+CFG.touchEps])){
  const fn=(dx,dy,t)=>{const {feet}=feetAt(w.p,w.v,dx,dy,t);return Math.hypot(feet[j].x-c.cx,feet[j].y-c.cy)-D;};
  cands.push({name:`start: |foot${j}-${c.n}| = ${D.toFixed(2)}`,f:fn(0,0,0),g:grad(fn)});}
 // corner discs at the start: foot j within cornerEps of K
 for(let j=0;j<3;j++)for(const k of corners){const fn=(dx,dy,t)=>{const {feet}=feetAt(w.p,w.v,dx,dy,t);return Math.hypot(feet[j].x-k.x,feet[j].y-k.y)-CFG.cornerEps;};cands.push({name:`start: foot${j} in corner disc ${k.n}`,f:fn(0,0,0),g:grad(fn)});}
 // A2-type: the moving foot's circle (radius rho about the pivot) tangent to a corner disc or a level circle: | |P-K| - rho | = eps
 const pv=w.arm[0];
 for(const k of corners)for(const sgn of [1,-1]){const fn=(dx,dy,t)=>{const {feet}=feetAt(w.p,w.v,dx,dy,t);const P=feet[pv];const rho=Math.hypot(feet[(pv+1)%3].x-P.x,feet[(pv+1)%3].y-P.y);return Math.hypot(P.x-k.x,P.y-k.y)-(rho+sgn*CFG.cornerEps);};cands.push({name:`tangency: |P-${k.n}| = rho ${sgn>0?'+':'-'} 0.81 (foot circle grazes corner disc)`,f:fn(0,0,0),g:grad(fn)});}
 // A1: event order between any two events of this arm that lie within 90 deg (difference of their angles)
 {const {feet}=feetAt(w.p,w.v,0,0,0);const ev=F.limitEvents(feet,pv,w.arm[1]).filter(e=>e.s<95*DEG);
  const key=e=>`f${e.foot}:c${e.circle}:${e.kind}:${(e.D??e.A).toFixed(3)}:${e.sign}`;
  const nm=e=>`f${e.foot}:${['r0','r1','a0','a1','rim','K1','K2','K3','K4','K5','K6','K7','K8'][e.circle]}${e.kind==='level'?'@'+e.D.toFixed(2):'ray'+(e.A*180/Math.PI).toFixed(1)}${e.sign>0?'+':'-'}`;
  for(let a=0;a<ev.length;a++)for(let b=a+1;b<ev.length;b++){if(ev[a].foot===ev[b].foot&&ev[a].circle===ev[b].circle)continue;const ka=key(ev[a]),kb=key(ev[b]);
   const fn=(dx,dy,t)=>{const {feet}=feetAt(w.p,w.v,dx,dy,t);const E=F.limitEvents(feet,pv,w.arm[1]);const A=E.find(e=>key(e)===ka),B=E.find(e=>key(e)===kb);if(!A||!B)return NaN;return (B.s-A.s)/DEG;};
   const f=fn(0,0,0),g=grad(fn);if(!Number.isFinite(f)||g.some(x=>!Number.isFinite(x)))continue;cands.push({name:`order: s[${nm(ev[b])}] - s[${nm(ev[a])}] (${(ev[a].s/DEG).toFixed(2)} vs ${(ev[b].s/DEG).toFixed(2)} deg)`,f,g,deg:true});}}
 // score: gradient direction vs plane normal, and predicted signed distance vs plane distance
 const scored=cands.map(c=>{const gl=Math.hypot(...c.g);if(gl<1e-9)return null;const u=c.g.map(x=>x/gl);const cos=u[0]*w.n[0]+u[1]*w.n[1]+u[2]*w.n[2];const dist=-c.f/gl;// distance along +u to the zero set
  const along=cos>0?dist:-dist;// signed distance along the plane normal
  return {...c,cos:Math.abs(cos),dist:along,err:Math.abs(along-w.d)+ (1-Math.abs(cos))*3};}).filter(Boolean).sort((a,b)=>a.err-b.err);
 for(const s of scored.slice(0,4))console.log(`   |cos| ${s.cos.toFixed(3)}  zero set at ${s.dist.toFixed(3)}u along the normal (fit: ${w.d})  value at seed ${s.f.toFixed(3)}${s.deg?' deg':'u'}  ${s.name}`);
}
