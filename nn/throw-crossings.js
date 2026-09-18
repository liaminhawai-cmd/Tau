// Where, over a throw sweep, does the closest pair change chord? POSE=... node nn/throw-crossings.js att pv dir
'use strict';
const FW = require('./forced-win.js');
const CL = require('./contact-law.js');
const TC = require('./throw-cert.js');
const { feetOf, R, MIND: D, EDGE } = CL, CFG = CL.eng.CFG, H = CFG.hubHeight, NSEG = CFG.legSegs;
const DEG = Math.PI / 180, LIM = TC.LIM_SUB;
const a = process.argv.slice(2), pose = process.env.POSE.split(',').map(Number);
const att = +a[0], pv = +a[1], dir = +a[2], victim = 1 - att;
const pieces = FW.piecesOf(pose);
const lim = FW.limitAt(pieces, att, pv, dir).lim, K = Math.round(lim / LIM);
const arcPts = (p,i)=>{const b=p.rot+i*2*Math.PI/3,cb=Math.cos(b),sb=Math.sin(b),o=[];for(let k=0;k<=NSEG;k++){const ph=(k/NSEG)*Math.PI/2,s=Math.sin(ph)*R;o.push({x:p.x+cb*s,y:p.y+sb*s,h:Math.cos(ph)*H});}return o;};
const seg3=(p1,q1,p2,q2)=>{const d1={x:q1.x-p1.x,y:q1.y-p1.y,h:q1.h-p1.h},d2={x:q2.x-p2.x,y:q2.y-p2.y,h:q2.h-p2.h},r={x:p1.x-p2.x,y:p1.y-p2.y,h:p1.h-p2.h};
 const A=d1.x*d1.x+d1.y*d1.y+d1.h*d1.h,E=d2.x*d2.x+d2.y*d2.y+d2.h*d2.h,F=d2.x*r.x+d2.y*r.y+d2.h*r.h,C=d1.x*r.x+d1.y*r.y+d1.h*r.h,B=d1.x*d2.x+d1.y*d2.y+d1.h*d2.h,dn=A*E-B*B;
 let s=dn>1e-12?Math.min(1,Math.max(0,(B*F-C*E)/dn)):0;let t=E>1e-12?(B*s+F)/E:0;
 if(t<0){t=0;s=Math.min(1,Math.max(0,A>1e-12?-C/A:0));}else if(t>1){t=1;s=Math.min(1,Math.max(0,A>1e-12?(B-C)/A:0));}
 const pa={x:p1.x+d1.x*s,y:p1.y+d1.y*s,h:p1.h+d1.h*s},pb={x:p2.x+d2.x*t,y:p2.y+d2.y*t,h:p2.h+d2.h*t};
 return {pa,pb,dist:Math.hypot(pb.x-pa.x,pb.y-pa.y,pb.h-pa.h),s,t};};
const tr = TC.sweep(pieces, att, pv, dir, K);
const VTOL = 1e-9;                  // the closest point sits on a vertex EXACTLY, so this is fp slack only
let prev = null, walkA = 0, walkV = 0, first = null, last = null, thrown = null;
const evs = [];
for (const st of tr) {
  // the pose ENTERING the substep: after the push the pair sits at exactly D, so measuring the
  // post-push pose would report no contact anywhere
  const enter = st.k === 1 ? pieces[victim] : tr[st.k - 2].pose;
  const A3 = [0,1,2].map(i => arcPts(st.att, i)), V3 = [0,1,2].map(j => arcPts(enter, j));
  let best = null;
  for (let i=0;i<3;i++) for (let j=0;j<3;j++) for (let p=0;p<NSEG;p++) for (let q=0;q<NSEG;q++) {
    const c = seg3(A3[i][p],A3[i][p+1],V3[j][q],V3[j][q+1]);
    if (!best || c.dist < best.dist) best = { ...c, i, j, p, q };
  }
  if (st.maxFootR > EDGE && thrown === null) thrown = st.k;
  if (thrown !== null) continue;      // past the throw the sweep keeps running but nothing matters
  if (!st.pushes.length) { prev = null; continue; }
  if (first === null) first = st.k;
  last = st.k;
  const LA = 3.0226;  // chord length, printed below
  if (prev) {
    walkA += Math.abs((best.p + best.s) - (prev.p + prev.s)) * LA;
    walkV += Math.abs((best.q + best.t) - (prev.q + prev.t)) * LA;
    // A changed chord index is NOT automatically a crossing. When the closest point parks ON a
    // vertex -- which it does whenever neither adjacent chord has an interior perpendicular foot --
    // the index flips between the two chords that share it while the point does not move at all.
    // So classify by the ARC POSITION, not the index: a transit moves through the vertex, a dwell
    // sits on it. The victim's phi=30 vertex here is a dwell from 24.67 deg to past the throw.
    for (const [who, uPrev, uNow] of [['attacker', prev.p + prev.s, best.p + best.s], ['victim  ', prev.q + prev.t, best.q + best.t]]) {
      const vPrev = Math.abs(uPrev - Math.round(uPrev)) < VTOL, vNow = Math.abs(uNow - Math.round(uNow)) < VTOL;
      const at = `at ${(st.k*LIM/DEG).toFixed(2)} deg of sweep, substep ${st.k}`;
      if (vNow && vPrev && Math.abs(uNow - uPrev) < VTOL) continue;                  // still parked
      if (vNow) { evs.push(`${who} PARKS on the vertex at phi ${(Math.round(uNow)*7.5).toFixed(1)} deg, ${at}`); continue; }
      if (Math.floor(uPrev) !== Math.floor(uNow)) evs.push(`${who} crosses the vertex at phi ${(Math.max(Math.ceil(Math.min(uPrev,uNow)), 0)*7.5).toFixed(1)} deg, ${at}`);
    }
    if (best.i !== prev.i || best.j !== prev.j) evs.push(`LEG PAIR changed (${prev.i},${prev.j})->(${best.i},${best.j}) at ${(st.k*LIM/DEG).toFixed(2)} deg`);
  }
  prev = best;
}
const A0 = arcPts(tr[0].att, 0);
console.log(`chord length ${Math.hypot(A0[1].x-A0[0].x,A0[1].y-A0[0].y,A0[1].h-A0[0].h).toFixed(4)}u; sweep limit ${(lim/DEG).toFixed(2)} deg = ${K} substeps`);
console.log(`in contact from ${(first*LIM/DEG).toFixed(2)} to ${(last*LIM/DEG).toFixed(2)} deg (${last-first+1} substeps = ${((last-first+1)*LIM/DEG).toFixed(2)} deg); thrown at substep ${thrown} = ${(thrown*LIM/DEG).toFixed(2)} deg`);
console.log(`contact walks ${walkA.toFixed(3)}u down the attacker's leg, ${walkV.toFixed(3)}u down the victim's; ${(walkA/(last-first)).toFixed(4)}u and ${(walkV/(last-first)).toFixed(4)}u per substep`);
console.log(`vertex events (${evs.length}) -- a crossing transits, a park dwells:`); for (const e of evs) console.log('  ' + e);
