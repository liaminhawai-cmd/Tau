const F=require('../forced-win.js');
const C=require('../contact-law.js');
const R=C.R, DEG=Math.PI/180;
const poses=[
{id:'ndpxhts24',victim:0,p:[-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442]},
{id:'6dgqa1fd8',victim:1,p:[2.6627,33.2224,2.2687,4.2061,47.1181,4.4905]},
{id:'l5807vazg',victim:1,p:[37.6039,-3.2612,1.8896,50.4287,10.5092,-.859]},
{id:'0r8c3cohc',victim:1,p:[.8192,-30.3367,-3.2227,19.4916,-35.329,4.106]}];
const arms=[];for(let p=0;p<3;p++)for(const d of [1,-1])arms.push({p,d});
const ek=e=>`f${e.foot}:c${e.circle}/${(e.D??e.A*180/Math.PI).toFixed(2)}(${e.sign>0?'+':'-'})`;
console.log('rho =',R*Math.sqrt(3));
// 1. 24 arms: limitAt vs limitLadder, and Astra's table for ndpxhts24
let worst=0,mism=0;
for(const q of poses){const ps=F.piecesOf(q.p);for(const a of arms){const e=F.limitAt(ps,q.victim,a.p,a.d),l=F.limitLadder(ps,q.victim,a.p,a.d);worst=Math.max(worst,Math.abs(e.lim-l.lim));if(e.sig!==l.sig)mism++;
 if(q.id==='ndpxhts24')console.log(`(${a.p},${a.d>0?'+':'-'}) lim ${(e.lim/DEG).toFixed(4)} sig ${e.sig} events ${(e.events||[]).map(ek).join(' ')}`);}}
console.log('1. closed form vs ladder on 24 arms: worst |dlim| rad',worst,'sig mismatches',mism);
// 2. events of arm (0,-) at ndpxhts24
const ps0=F.piecesOf(poses[0].p), feet0=C.feetOf(ps0[0]);
const ev=F.limitEvents(feet0,0,-1);
console.log('2. events on (0,-):',ev.length,' kinds:',JSON.stringify(ev.reduce((m,e)=>(m[e.kind+(e.circle===4?'-rim':'')]=(m[e.kind+(e.circle===4?'-rim':'')]||0)+1,m),{})));
const find=(foot,circle,D,sign)=>ev.find(e=>e.foot===foot&&e.circle===circle&&e.kind==='level'&&Math.abs(e.D-D)<1e-6&&e.sign===sign);
const e2a0=find(2,2,40.81,-1), e1r1=find(1,1,54.11,-1);
console.log('   f2:a0/40.81(-) at',(e2a0.s/DEG).toFixed(6),'  f1:r1/54.11(-) at',(e1r1.s/DEG).toFixed(6),' gap H =',((e1r1.s-e2a0.s)/DEG).toFixed(6));
// 3. gradient of H by central differences in hub x, y, and t=R*drot
function Hat(x,y,rot){const f=C.feetOf({x,y,rot});const ev=F.limitEvents(f,0,-1);const a=ev.find(e=>e.foot===2&&e.circle===2&&e.kind==='level'&&Math.abs(e.D-40.81)<1e-6&&e.sign===-1),b=ev.find(e=>e.foot===1&&e.circle===1&&e.kind==='level'&&Math.abs(e.D-54.11)<1e-6&&e.sign===-1);return (b.s-a.s)/DEG;}
const [x0,y0,r0]=poses[0].p;const h=1e-4;
console.log('3. grad H (deg per u): dx',((Hat(x0+h,y0,r0)-Hat(x0-h,y0,r0))/(2*h)).toFixed(6),' dy',((Hat(x0,y0+h,r0)-Hat(x0,y0-h,r0))/(2*h)).toFixed(6),' dt',((Hat(x0,y0,r0+h/R)-Hat(x0,y0,r0-h/R))/(2*h)).toFixed(6),'  Astra: -3.988378 +1.692944 +4.330027');
// pivot-plane invariance: hold P fixed, vary rot; H should be constant
{const P=feet0[0];let mx=0;for(const t of [-3,-1.5,0.75,3]){const rot=r0+t/R;const hub={x:P.x-R*Math.cos(rot),y:P.y-R*Math.sin(rot),rot};mx=Math.max(mx,Math.abs(Hat(hub.x,hub.y,hub.rot)-Hat(x0,y0,r0)));}console.log('   H with pivot fixed, rot varied +-3u: max change deg',mx.toExponential(2));}
// distance from seed pivot to the E01 curve in the pivot plane: minimise |dP| s.t. H(P)=0 with rot free (H independent of rot given P)
{const P=feet0[0];const HP=(px,py)=>Hat(px-R*Math.cos(r0),py-R*Math.sin(r0),r0);let best=null;
 for(let ang=0;ang<360;ang+=0.5){const dx=Math.cos(ang*DEG),dy=Math.sin(ang*DEG);let lo=0,hi=4;if(HP(P.x+hi*dx,P.y+hi*dy)*HP(P.x,P.y)>0)continue;for(let it=0;it<50;it++){const m=(lo+hi)/2;(HP(P.x+m*dx,P.y+m*dy)*HP(P.x,P.y)>0?lo=m:hi=m);}if(!best||hi<best.d)best={d:hi,dx:hi*dx,dy:hi*dy};}
 console.log('   nearest point of E01 in pivot plane: dist',best.d.toFixed(5),'offset',best.dx.toFixed(5),best.dy.toFixed(5),'  Astra: 1.16062 at (1.09175,-0.39384)');}
