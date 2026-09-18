// See ./README.md.
//
// WHY THE SLAB STAYS THIN, AND BY HOW MUCH.
//
// slab-shape.js measured that the reachable set is a thin sheet: at +-0.1u the poses spread 0.13u
// across the plane and 0.003u along the push, because the contact shell pins them. gain-bound.js
// then showed that supplying that thickness is what makes H3 close. What neither does is explain the
// number, and a certificate cannot assume it.
//
// The argument, which this script checks against the engine. Write g_k(q) for the distance from the
// attacker's leg at substep k to the victim's. After substep k-1's push the solver leaves EVERY pose
// on the shell, g_{k-1} = D up to its own tolerance, so the set's thickness in g is reset to the
// shell's own width -- it does not accumulate, and that is the structural reason there is no
// threshold here. The attacker then turns by one substep and the distance falls by that substep's
// advance,
//
//     pen_k(q) = D - g_k(q) = LIM_SUB * [ z x (p_A - P) ] . n   + O(LIM_SUB^2)
//
// with p_A the attacker's contact point, P its pivot foot and n the unit contact normal. Everything
// on the right is a property of the contact geometry, so the SPREAD of the penetration across the
// set is LIM_SUB times the spread of that moment arm -- one substep's worth of a quantity that
// varies only as much as the contact point does. That is why a 0.13u-wide set presents a 1e-3u-thin
// profile: 0.00582 rad times a moment arm that differs by a tenth of a unit between its poses.
//
// Measured here: the shell residual entering each substep, the spread of the penetration, and the
// predicted spread. The prediction has to bound the measurement at every substep or the argument is
// wrong.
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
  ? { x: c0.x+o[0], y: c0.y+o[1], rot: c0.rot+o[2] } : { ...p })), att, pv, dir, K),
  start: { x: c0.x+o[0], y: c0.y+o[1], rot: c0.rot+o[2] } }));
const centre = runs[13];

console.log(`box +-${half}u, +-${(hr/DEG).toFixed(3)} deg, ${runs.length} poses, arm (${pv},${dir}), foot ${jF}, substep ${(TC.LIM_SUB/DEG).toFixed(4)} deg`);
console.log('\n   k   deg  | shell residual    | penetration spread | predicted        | ratio');
console.log('            | entering substep  | measured           | LIM_SUB x hull(arm)| meas/pred');
let worst = 0, worstK = 0, n = 0, maxPred = 0, maxPredK = 0, maxMeas = 0, firstK = null, maxAfter = 0, maxAfterK = 0;
for (let k = 2; k <= K; k++) {
  const pr = centre.tr[k-1].pushes; if (!pr.length) continue;
  const i = pr[0].i, j = pr[0].j;
  const Ak = arcPts(rotAbout(att0, P, dir*k*TC.LIM_SUB), i);
  const Ap = arcPts(rotAbout(att0, P, dir*(k-1)*TC.LIM_SUB), i);
  const pens = [], arms = [], shells = [];
  let all = true;
  for (const r of runs) {
    const q = r.tr[k-2].pose;
    if (rOf(q) > EDGE) continue;                              // already thrown, out of the argument
    const V = arcPts(q, j);
    const cNow = closestOf(Ak, V), cPrev = closestOf(Ap, V);
    if (cNow.dist >= D) { all = false; continue; }
    pens.push(D - cNow.dist);
    shells.push(cPrev.dist - D);
    // the moment arm: the rate at which this contact closes per radian of the attacker's turn
    // The rate is not constant WITHIN the substep: the contact point migrates along the leg, and at
    // a vertex crossing it jumps chords. Taking it only at the substep's end understates the spread
    // by up to 1.7x there, which is the same trap the outside review named for the stopping program
    // -- two events of one foot can land in one substep. So hull the rate over the substep's own
    // sweep, which is what the integral actually sees.
    for (let m = 0; m <= 4; m++) {
      const Am = arcPts(rotAbout(att0, P, dir*(k-1+m/4)*TC.LIM_SUB), i), cm = closestOf(Am, V);
      const nm = [(cm.pb.x-cm.pa.x)/cm.dist, (cm.pb.y-cm.pa.y)/cm.dist, (cm.pb.h-cm.pa.h)/cm.dist];
      arms.push(-dir * (-(cm.pa.y - P.y)*nm[0] + (cm.pa.x - P.x)*nm[1]));
    }
  }
  if (!all || pens.length < 2) continue;
  const rng = a => Math.max(...a) - Math.min(...a);
  const meas = rng(pens), pred = TC.LIM_SUB * rng(arms) + rng(shells), ratio = meas / Math.max(pred, 1e-12);
  n++; if (ratio > worst) { worst = ratio; worstK = k; }
  if (firstK === null) firstK = k;
  if (pred > maxPred) { maxPred = pred; maxPredK = k; }
  // The entry substep is the odd one out: the poses are not all on the shell yet, so its residual is
  // the box's own width rather than the solver's tolerance. It is the same grazing substep section
  // 12 says a slab must not start on, and skipping it makes the thickness bound tight as well.
  if (k > firstK && pred > maxAfter) { maxAfter = pred; maxAfterK = k; }
  if (meas > maxMeas) maxMeas = meas;
  if (k % 10 === 0 || k < 20)
    console.log(`  ${String(k).padStart(3)} ${(k*TC.LIM_SUB/DEG).toFixed(2).padStart(6)} | ${rng(shells).toExponential(2).padStart(17)} | ${meas.toExponential(2).padStart(18)} | ${pred.toExponential(2).padStart(16)} | ${ratio.toFixed(3).padStart(8)}`);
}
console.log(`\nthickest the slab ever gets: predicted ${maxPred.toExponential(3)}u at substep ${maxPredK}, measured ${maxMeas.toExponential(3)}u`);
console.log(`ignoring the entry substep ${firstK}: predicted at most ${maxAfter.toExponential(3)}u, at substep ${maxAfterK}`);
console.log(`over ${n} substeps where the whole set is in contact: worst measured/predicted ${worst.toFixed(3)} at substep ${worstK}`);
console.log(worst <= 1 ? 'THE PREDICTION BOUNDS THE MEASUREMENT EVERYWHERE: one substep of a moment arm that varies\nonly as much as the contact point does, on top of a shell that resets every substep.'
  : 'THE PREDICTION IS EXCEEDED somewhere -- the first-order argument is missing a term.');
