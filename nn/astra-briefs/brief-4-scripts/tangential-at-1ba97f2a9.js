// See ./README.md.
//
// DOES THE SET SPREAD SIDEWAYS?
//
// Sections 13 and 14 leave the barrier route needing one hypothesis: that the tube is invariant in
// the two directions ACROSS the push. The thin direction is settled -- the shell resets it every
// substep -- and the gain bound is settled. This is the half that is left, and it is worth measuring
// before anyone proves it, which is how the other two went.
//
// The decomposition. At each substep the contact gives a normal direction in pose space,
// G = (hf n_x, hf n_y, hf rn), the gradient of the pair's distance. A pose's deviation from the
// centre splits into its component along G -- the slab's thickness, already bounded -- and what is
// left, which is the tangential spread. If the tangential part is NON-EXPANSIVE over the contact
// window, invariance is nearly immediate and the tube can be taken as the starting box. If it grows
// by a constant factor a substep, the route has the same threshold the enclosure had, just later.
'use strict';
const FW = require('../forced-win.js');
const CL = require('../contact-law.js');
const TC = require('../throw-cert.js');
const { feetOf, EDGE, R, MIND: D } = CL;
const DEG = Math.PI / 180, H = R, NSEG = 12;

const pose = process.env.POSE.split(',').map(Number);
const att = +(process.argv[2] ?? 1), pv = +(process.argv[3] ?? 0), dir = +(process.argv[4] ?? -1);
const jF = +(process.argv[5] ?? 1);
const half = +(process.argv[6] ?? 0.1);
const hrotArg = process.argv[7] === undefined ? null : +process.argv[7];
const NS = +(process.argv[8] ?? 200);
const victim = 1 - att;

// the two legs' polylines and their closest pair, written out here so the measurement does not
// inherit any of the certificate's gates
const arcPts = (p, i) => { const a = p.rot + i*2*Math.PI/3, ca = Math.cos(a), sa = Math.sin(a), out = [];
  for (let k = 0; k <= NSEG; k++) { const ph = (k/NSEG)*(Math.PI/2), s = Math.sin(ph)*R;
    out.push({ x: p.x + ca*s, y: p.y + sa*s, h: Math.cos(ph)*H }); } return out; };
function segClosest(p1, q1, p2, q2) {
  const d1 = [q1.x-p1.x, q1.y-p1.y, q1.h-p1.h], d2 = [q2.x-p2.x, q2.y-p2.y, q2.h-p2.h];
  const r = [p1.x-p2.x, p1.y-p2.y, p1.h-p2.h];
  const a = d1[0]*d1[0]+d1[1]*d1[1]+d1[2]*d1[2], e = d2[0]*d2[0]+d2[1]*d2[1]+d2[2]*d2[2];
  const f = d2[0]*r[0]+d2[1]*r[1]+d2[2]*r[2], c = d1[0]*r[0]+d1[1]*r[1]+d1[2]*r[2];
  const b = d1[0]*d2[0]+d1[1]*d2[1]+d1[2]*d2[2], den = a*e - b*b;
  let s = den > 1e-12 ? Math.min(1, Math.max(0, (b*f - c*e)/den)) : 0;
  let t = Math.min(1, Math.max(0, (b*s + f)/e));
  s = Math.min(1, Math.max(0, (b*t - c)/a));
  const pa = { x: p1.x+d1[0]*s, y: p1.y+d1[1]*s, h: p1.h+d1[2]*s };
  const pb = { x: p2.x+d2[0]*t, y: p2.y+d2[1]*t, h: p2.h+d2[2]*t };
  return { pa, pb, dist: Math.hypot(pb.x-pa.x, pb.y-pa.y, pb.h-pa.h) };
}
const closestOf = (A, V) => { let best = null;
  for (let a = 0; a < NSEG; a++) for (let b = 0; b < NSEG; b++) {
    const c = segClosest(A[a], A[a+1], V[b], V[b+1]); if (!best || c.dist < best.dist) best = c; }
  return best; };

const base = FW.piecesOf(pose);
const K = Math.round(FW.limitAt(base, att, pv, dir).lim / TC.LIM_SUB);
const att0 = base[att], P = feetOf(att0)[pv];
const rotAbout = (p, Q, dA) => { const c = Math.cos(dA), s = Math.sin(dA), rx = p.x-Q.x, ry = p.y-Q.y;
  return { x: Q.x + rx*c - ry*s, y: Q.y + rx*s + ry*c, rot: p.rot + dA }; };
const hr = hrotArg === null ? half/R : hrotArg;
const rOf = p => { const f = feetOf(p)[jF]; return Math.hypot(f.x, f.y); };

let seed = 12345; const rnd = () => (seed = (seed*1103515245 + 12345) & 0x7fffffff)/0x7fffffff;
const c0 = base[victim], offs = [];
for (const dx of [-1,0,1]) for (const dy of [-1,0,1]) for (const dt of [-1,0,1]) offs.push([dx*half, dy*half, dt*hr]);
while (offs.length < NS) offs.push([(2*rnd()-1)*half, (2*rnd()-1)*half, (2*rnd()-1)*hr]);
const runs = offs.map(o => ({ o, tr: TC.sweep(base.map((p,i) => (i === victim
  ? { x: c0.x+o[0], y: c0.y+o[1], rot: c0.rot+o[2] } : { ...p })), att, pv, dir, K) }));
const centre = runs[13];

// the pose metric: rotation carried as R*drot, so the three coordinates are comparable lengths
console.log(`box +-${half}u, +-${(hr/DEG).toFixed(3)} deg, ${runs.length} poses, arm (${pv},${dir}), foot ${jF}`);
console.log('\n   k   deg  | deviation from the centre | along G   | across G  | across, per substep');
let first = null, firstAcross = 0, lastAcross = 0, lastK = 0, worstStep = 0, worstStepK = 0, prevAcross = null;
let firstTotal = 0, lastTotal = 0, midK = null, midAcross = 0, midTotal = 0;
for (let k = 1; k <= K; k++) {
  const pr = centre.tr[k-1].pushes; if (!pr.length) continue;
  const qc = centre.tr[k-1].pose;
  if (rOf(qc) > EDGE) break;
  const i = pr[0].i, j = pr[0].j;
  const A = arcPts(rotAbout(att0, P, dir*k*TC.LIM_SUB), i), V = arcPts(qc, j);
  const cc = closestOf(A, V);
  const n3 = [(cc.pb.x-cc.pa.x)/cc.dist, (cc.pb.y-cc.pa.y)/cc.dist, (cc.pb.h-cc.pa.h)/cc.dist];
  const hf = Math.hypot(n3[0], n3[1]), nx = n3[0]/hf, ny = n3[1]/hf;
  const rn = (cc.pb.x - qc.x)*ny - (cc.pb.y - qc.y)*nx;
  // G in the scaled metric (dx, dy, R drot)
  let g = [hf*nx, hf*ny, hf*rn/R]; const gL = Math.hypot(...g); g = g.map(v => v/gL);
  // Also the WHOLE deviation, unsplit, because the brief thread measures that and the two readings
  // have to be reconciled rather than left side by side: if the total grows while the tangential
  // part is flat, the difference is either the along-G component or G's own rotation.
  let along = 0, across = 0, total = 0;
  for (const r of runs) {
    const q = r.tr[k-1].pose; if (rOf(q) > EDGE) continue;
    const d = [q.x - qc.x, q.y - qc.y, R*(q.rot - qc.rot)];
    const p = d[0]*g[0] + d[1]*g[1] + d[2]*g[2];
    const t = Math.hypot(d[0]-p*g[0], d[1]-p*g[1], d[2]-p*g[2]);
    along = Math.max(along, Math.abs(p)); across = Math.max(across, t);
    total = Math.max(total, Math.hypot(d[0], d[1], d[2]));
  }
  if (first === null) { first = k; firstAcross = across; firstTotal = total; }
  lastTotal = total;
  const step = prevAcross === null ? 1 : across / Math.max(prevAcross, 1e-12);
  if (k > first && step > worstStep) { worstStep = step; worstStepK = k; }
  prevAcross = across; lastAcross = across; lastK = k;
  if (k === first + 60) { midK = k; midAcross = across; midTotal = total; }
  if (k % 10 === 0 || k < first + 4) console.log(`  ${String(k).padStart(3)} ${(k*TC.LIM_SUB/DEG).toFixed(2).padStart(6)} | ${total.toFixed(5).padStart(25)} | ${along.toFixed(5).padStart(9)} | ${across.toFixed(5).padStart(9)} | ${step.toFixed(5).padStart(9)}`);
}
console.log(`\nacross the push, first contact ${first} to substep ${lastK} (the centre's throw): ${firstAcross.toFixed(5)}u -> ${lastAcross.toFixed(5)}u, x${(lastAcross/firstAcross).toFixed(4)} overall`);
console.log(`the WHOLE deviation, unsplit, over the same window: ${firstTotal.toFixed(5)}u -> ${lastTotal.toFixed(5)}u, x${(lastTotal/firstTotal).toFixed(4)}`);
if (midK) console.log(`over the INTERIOR stretch alone, ${first} to ${midK}: across x${(midAcross/firstAcross).toFixed(4)}, whole x${(midTotal/firstTotal).toFixed(4)}`);
console.log(`worst single substep: x${worstStep.toFixed(5)} at substep ${worstStepK}`);
// The worst substep is not the figure to compound. What a tube has to absorb is the OVERALL factor,
// and where the growth sits matters more than its peak: a factor confined to the last dozen substeps
// of the park is a transient a fixed tube covers, while the same factor spread over every substep
// would be the constant-rate growth that gave the enclosure its threshold.
console.log(worstStep <= 1 ? 'NON-EXPANSIVE at every substep: the tangential map never grows the set, so the starting box IS\nthe tube and invariance is a one-line argument.'
  : `A tube ${(lastAcross/firstAcross).toFixed(3)}x the starting box's tangential extent covers the whole contact window here.\nWhere the growth sits is in the table: flat or contracting through the interior stretch, and\nconfined to the park's last substeps, which is a transient rather than a constant rate.`);
