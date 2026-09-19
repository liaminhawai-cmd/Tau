// Astra's brief-2 fixed-pivot counterexamples, checked with limitAt AND limitLadder
const F=require('../forced-win.js'), C=require('../contact-law.js');
const R=C.R, DEG=Math.PI/180;
const seed6=[2.6627,33.2224,2.2687,4.2061,47.1181,4.4905];           // 6dgqa1fd8, victim red (1)
const rows=[[3.621167321272143,47.101382410223884,4.459446497865713],
            [3.584301808338408,47.110878950025620,4.461094864381486],
            [3.536570349498783,47.123078361319970,4.463228044578368]];
console.log('== 6dgqa1fd8, arm (0,+), pivot foot 0 held fixed (Astra: 95.333, 63.667, 95.333)');
for(const [x,y,rot] of rows){
  const ps=F.piecesOf(seed6); ps[1]={x,y,rot};
  const P=C.feetOf(ps[1])[0];
  const a=F.limitAt(ps,1,0,1), l=F.limitLadder(ps,1,0,1);
  console.log(`  pivot (${P.x.toFixed(12)}, ${P.y.toFixed(12)})  limitAt ${(a.lim/DEG).toFixed(4)} [${a.sig}]  ladder ${(l.lim/DEG).toFixed(4)} [${l.sig}]`);
}
// the offset case: (dx,dy,t)=(-0.66,0,-0.66), arm (0,+) to 95.333 with |P0-K6| > rho+0.81
{const ps=F.piecesOf(seed6); ps[1].x+=-0.66; ps[1].rot+=-0.66/R;
 const P=C.feetOf(ps[1])[0], a=F.limitAt(ps,1,0,1), l=F.limitLadder(ps,1,0,1);
 const K=C.eng.LINE_INTERSECTIONS.map((q,i)=>({i,d:Math.hypot(P.x-q.x,P.y-q.y),q}));
 const rho=R*Math.sqrt(3);
 console.log(`\n== offset (-0.66,0,-0.66): limitAt ${(a.lim/DEG).toFixed(4)} [${a.sig}] ladder ${(l.lim/DEG).toFixed(4)} [${l.sig}]`);
 console.log('   nearest corners |P0-K|:', K.sort((u,v)=>u.d-v.d).slice(0,3).map(k=>`c${k.i} ${k.d.toFixed(6)}`).join(' '), ` rho+0.81 = ${(rho+0.81).toFixed(6)}`);
 console.log('   events of this arm:', (a.events||[]).map(e=>`f${e.foot}:c${e.circle}/${(e.D??e.A).toFixed(2)}(${e.sign>0?'+':'-'})`).join(' ')||'none');
}
// 0r8c3cohc: fixed P2, vary theta (Astra: 63.667, 5.667, 63.333)
console.log('\n== 0r8c3cohc, arm (2,+), pivot foot 2 fixed at (7.931356990148707,-14.041485656602546)');
{const seed0=[.8192,-30.3367,-3.2227,19.4916,-35.329,4.106];
 const P2={x:7.931356990148707,y:-14.041485656602546};
 const base=F.piecesOf(seed0)[1];
 // find the theta values: scan a small range and print the distinct limits
 const out=[];
 for(let k=-40;k<=40;k++){const rot=base.rot+k*0.0001/1;const hub={x:P2.x-R*Math.cos(rot+2*2*Math.PI/3),y:P2.y-R*Math.sin(rot+2*2*Math.PI/3),rot};
  const ps=F.piecesOf(seed0);ps[1]=hub;const a=F.limitAt(ps,1,2,1);out.push({k,dth:(rot-base.rot)/DEG,lim:+(a.lim/DEG).toFixed(4),sig:a.sig});}
 const runs=[];for(const o of out){const L=runs[runs.length-1];if(L&&L.lim===o.lim&&L.sig===o.sig){L.to=o.dth;L.n++;}else runs.push({lim:o.lim,sig:o.sig,from:o.dth,to:o.dth,n:1,k:o.k});}
 for(const r of runs)console.log(`  dtheta ${r.from.toFixed(4)} to ${r.to.toFixed(4)} deg: limit ${r.lim} [${r.sig}]  (n=${r.n})`);
 // ladder check on one pose from each run
 for(const r of runs.slice(0,6)){const rot=base.rot+r.k*0.0001;const hub={x:P2.x-R*Math.cos(rot+4*Math.PI/3),y:P2.y-R*Math.sin(rot+4*Math.PI/3),rot};
  const ps=F.piecesOf(seed0);ps[1]=hub;const l=F.limitLadder(ps,1,2,1);console.log(`    ladder at dtheta ${((rot-base.rot)/DEG).toFixed(4)}: ${(l.lim/DEG).toFixed(4)} [${l.sig}]`);}
}
