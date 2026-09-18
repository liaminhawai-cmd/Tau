// See ./README.md.
//
// H3, COMPUTED RIGOROUSLY RATHER THAN SAMPLED.
//
// park-monotone.js measured the barrier's two hypotheses over a box and found both true on 200
// sampled poses (nn/THROW-CONTACT-LEMMAS.md section 11). Sampling says they hold, not that they are
// provable. Of the two, H3 -- a lower bound on the exposed foot's radial gain per substep, valid for
// EVERY pose in the box -- is the half that needs no accumulation: each substep is an independent
// interval evaluation, so nothing it produces feeds back into the box it is evaluated over. That is
// why it can be done now, before anyone has proved H4 (invariance).
//
// This script computes it. At each substep it evaluates `analyse` over the tube box around the
// centre's pose, which gives the contact pair, the normal cone, hf and the lever rn as INTERVALS
// over the box, and from those bounds the gain below:
//
//   the engine's push is  lambda = sep / (1 + rn^2 / I),  sep = (D - dist) / max(hf, hfFloor)
//   capped at REPLICA.cap, along the horizontal unit normal n with the spin lambda rn / I, so with
//   F the exposed foot and Fhat its radial unit vector at the START of the substep,
//
//     r_after  >=  Fhat . F_after                                  (|v| >= u.v for any unit u)
//              =   r + lambda [ n.Fhat + (rn/I) R (-sin th, cos th).Fhat ]  -  R dth^2 / 2
//
//   the last term being the exact second-order remainder of the foot's own rotation. Every quantity
//   in the bracket is an interval over the box, so its minimum is a bound over every pose in it.
//
// TWO THINGS THIS IS NOT. It is conditional on H4: the tube is hypothesised, not proved invariant,
// and the script reports how the SAMPLED poses sit inside it so the hypothesis is at least not
// already false. And it gives zero to every substep where the whole box is not certainly in contact
// -- the obligation of section 12 -- because there the minimum over poses is exactly zero.
'use strict';
const FW = require('../forced-win.js');
const CL = require('../contact-law.js');
const TC = require('../throw-cert.js');
const { feetOf, EDGE, R, I, MIND: D, REPLICA } = CL;
const DEG = Math.PI / 180;

const pose = process.env.POSE.split(',').map(Number);
const att = +(process.argv[2] ?? 1), pv = +(process.argv[3] ?? 0), dir = +(process.argv[4] ?? -1);
const jF = +(process.argv[5] ?? 1);
const half = +(process.argv[6] ?? 0.1);
const hrotArg = process.argv[7] === undefined ? null : +process.argv[7];
const NS = +(process.argv[8] ?? 200);
const DELTA = process.env.DELTA === undefined ? null : +process.env.DELTA;
// The tube is where the poses have to STAY; the box they start in has to be smaller, because the
// sampled poses spread a little before the shell pins them. INIT is that starting box.
const INIT = process.env.INIT === undefined ? null : +process.env.INIT;                 // sampled poses, for the tube-containment check only
const victim = 1 - att;

// interval arithmetic, positive-width only where it says so
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[1], a[1] - b[0]];
const mul = (a, b) => { const p = [a[0]*b[0], a[0]*b[1], a[1]*b[0], a[1]*b[1]]; return [Math.min(...p), Math.max(...p)]; };
const scale = (a, k) => (k >= 0 ? [a[0]*k, a[1]*k] : [a[1]*k, a[0]*k]);
const sq = a => (a[0] >= 0 ? [a[0]*a[0], a[1]*a[1]] : a[1] <= 0 ? [a[1]*a[1], a[0]*a[0]] : [0, Math.max(a[0]*a[0], a[1]*a[1])]);
const divPos = (a, b) => [Math.min(a[0]/b[0], a[0]/b[1]), Math.max(a[1]/b[0], a[1]/b[1])];
function cosRange(a) { const [lo, hi] = a; if (hi - lo >= 2*Math.PI) return [-1, 1];
  let mn = Math.min(Math.cos(lo), Math.cos(hi)), mx = Math.max(Math.cos(lo), Math.cos(hi));
  for (let k = Math.ceil(lo/Math.PI); k*Math.PI <= hi; k++) { if (k % 2 === 0) mx = 1; else mn = -1; } return [mn, mx]; }
const sinRange = a => cosRange([a[0] - Math.PI/2, a[1] - Math.PI/2]);

const base = FW.piecesOf(pose);
const K = Math.round(FW.limitAt(base, att, pv, dir).lim / TC.LIM_SUB);
const att0 = base[att], Pv = feetOf(att0)[pv];
const rotAbout = (p, P, dA) => { const c = Math.cos(dA), s = Math.sin(dA), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx*c - ry*s, y: P.y + rx*s + ry*c, rot: p.rot + dA }; };
const hr = hrotArg === null ? half / R : hrotArg;
const tr = TC.sweep(base, att, pv, dir, K);
const rOf = p => { const f = feetOf(p)[jF]; return Math.hypot(f.x, f.y); };

console.log(`box +-${half}u, +-${(hr/DEG).toFixed(3)} deg, arm (${pv},${dir}), foot ${jF}, ${K} substeps, rim ${EDGE}`);
console.log(DELTA === null ? 'distance uncertainty: the box\'s blanket pad (no assumption about the set\'s shape)'
  : `distance uncertainty: ${DELTA}u by the SLAB HYPOTHESIS (every other bound still over the full box)`);

// the certified bound, substep by substep
const rows = [];
for (let k = 1; k <= K; k++) {
  const q = k === 1 ? base[victim] : tr[k - 2].pose;          // the pose the substep's push acts on
  const A = rotAbout(att0, Pv, dir * k * TC.LIM_SUB);
  const box = { x: [q.x - half, q.x + half], y: [q.y - half, q.y + half], rot: [q.rot - hr, q.rot + hr] };
  const row = { k, gain: 0, why: '' };
  const want = tr[k - 1].pushes.length ? [tr[k - 1].pushes[0].i, tr[k - 1].pushes[0].j] : null;
  const an = TC.analyse(box, A, want);
  if (an.free) { row.why = 'no pose in contact'; rows.push(row); continue; }
  if (an.refuse) { row.why = `REFUSED: ${an.refuse}`; rows.push(row); continue; }
  // Whole-box contact is the same number: with DELTA set, the slab hypothesis supplies the distance
  // range here too, since a set pinned to the shell is exactly a set whose distance range is small.
  const del = DELTA === null ? an.pad : DELTA;
  if (!(an.distC + del < D)) { row.why = `partial contact (dist ${an.distC.toFixed(3)} +- ${del.toFixed(3)} vs D ${D})`; rows.push(row); continue; }
  // the push, as an interval over the box
  // The distance uncertainty is the ONE number the bound is most sensitive to, and the blanket pad
  // is a wild overstatement of it: slab-shape.js measures the poses' true distance range at 0.003u
  // where the pad of a +-0.1u box is 0.24u. DELTA replaces it with the slab hypothesis -- that the
  // set is thin along the contact normal, which is what the shell pins it to -- leaving every other
  // bound over the full box. Unset, it is the blanket pad and the run is unconditional on shape.
  const gap = [D - (an.distC + del), Math.min(D - (an.distC - del), D)];
  const hfLo = Math.max(an.hf[0], REPLICA.hfFloor), hfHi = Math.max(an.hf[1], REPLICA.hfFloor);
  const rn2 = sq(an.rn), wEff = [1 + rn2[0]/I, 1 + rn2[1]/I];
  const sepLo = Math.min(gap[0] / hfHi, REPLICA.cap), sepHi = Math.min(gap[1] / hfLo, REPLICA.cap);
  const lam = [sepLo / wEff[1], sepHi / wEff[0]];
  // the direction, as an interval over the box
  const th = [box.rot[0] + jF*2*Math.PI/3, box.rot[1] + jF*2*Math.PI/3];
  const ct = cosRange(th), st = sinRange(th);
  const Fx = add(box.x, scale(ct, R)), Fy = add(box.y, scale(st, R));
  const r2 = add(sq(Fx), sq(Fy));
  if (r2[0] <= 0) { row.why = 'the foot box contains the centre of the board'; rows.push(row); continue; }
  const rIv = [Math.sqrt(r2[0]), Math.sqrt(r2[1])];
  const fx = divPos(Fx, rIv), fy = divPos(Fy, rIv);
  const nx = cosRange(an.psiN), ny = sinRange(an.psiN);
  const lever = add(mul(scale(st, -R), fx), mul(scale(ct, R), fy));
  const dirDot = add(add(mul(nx, fx), mul(ny, fy)), mul(scale(an.rn, 1/I), lever));
  // The second-order remainder of the foot's own rotation. Bounding it through the push model costs
  // a factor of iters^2, because the solver may take up to ten passes and each one's magnitude would
  // have to be bounded by the first's -- and at the early grazing substeps that penalty alone is ten
  // times the gain, which reads as a negative bound where the engine plainly gains. The tube gives it
  // for free instead: the pose is in the tube before the substep and in it after, so its rotation
  // change differs from the CENTRE's, which is known exactly, by at most the tube's own width.
  const dthC = Math.abs((k === 1 ? tr[0].pose.rot : tr[k - 1].pose.rot) - q.rot);
  const dth = dthC + 2 * hr;
  const pen = R * dth * dth / 2;
  row.gain = (dirDot[0] >= 0 ? lam[0] * dirDot[0] : REPLICA.iters * lam[1] * dirDot[0]) - pen;
  row.lam = lam; row.dirDot = dirDot; row.pen = pen; row.rIv = rIv; row.psi = an.psiN;
  rows.push(row);
}

// where the bound is allowed to start summing: the first substep whose whole box is certainly in
// contact, and one later, since section 12 measured that first substep to be a grazing one worth a
// tenth of its neighbours.
const firstFull = rows.findIndex(r => r.gain !== 0 || (r.why === '' && r.lam)) + 1;
console.log(`\nfirst substep with the WHOLE box certainly in contact: ${firstFull || '-'}`);
console.log('\n  k    deg   |   lambda lo      dirDot lo   |  gain bound   running sum  | note');
let sum = 0, firstOK = null;
const r0 = rows.find(r => r.rIv);
for (const r of rows) {
  if (r.k > K) break;
  if (r.gain > 0) { if (firstOK === null) firstOK = r.k; sum += r.gain; }
  else if (firstOK !== null) sum += Math.min(0, r.gain);
  if (r.lam || r.why.startsWith('REFUSED') || (r.why && firstOK !== null))
    console.log(`  ${String(r.k).padStart(3)} ${(r.k*TC.LIM_SUB/DEG).toFixed(2).padStart(6)}  | ${(r.lam ? r.lam[0].toExponential(3) : '-').padStart(11)}  ${(r.dirDot ? r.dirDot[0].toFixed(5) : '-').padStart(10)}  | ${r.gain.toExponential(3).padStart(11)} ${sum.toFixed(5).padStart(11)}  | ${r.why}`);
}
// what the sum has to reach
const startLo = (() => { const q = base[victim];
  const th = [q.rot - hr + jF*2*Math.PI/3, q.rot + hr + jF*2*Math.PI/3];
  const Fx = add([q.x - half, q.x + half], scale(cosRange(th), R)), Fy = add([q.y - half, q.y + half], scale(sinRange(th), R));
  return Math.sqrt(add(sq(Fx), sq(Fy))[0]); })();
console.log(`\nstarting radius, min over the box: ${startLo.toFixed(4)}u; rim ${EDGE}u; to clear it the bound must sum to ${(EDGE - startLo).toFixed(4)}u`);
console.log(`certified sum over the sweep: ${sum.toFixed(4)}u -- ${sum > EDGE - startLo ? 'ENOUGH: the throw follows from H3 alone, given the tube' : 'SHORT by ' + (EDGE - startLo - sum).toFixed(4) + 'u'}`);
const refused = rows.filter(r => r.why.startsWith('REFUSED')).length, partial = rows.filter(r => r.why.startsWith('partial')).length;
console.log(`substeps: ${rows.filter(r => r.lam).length} bounded, ${partial} partial-contact (counted zero), ${refused} refused by analyse`);

// H4 is hypothesised, not proved. The least this run can do is say whether the sampled poses stay
// inside the tube it assumed -- if they leave it, the bound above is over a box the dynamics do not
// respect and means nothing.
let seed = 12345; const rnd = () => (seed = (seed*1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const c = base[victim], offs = [];
const ih = INIT === null ? half : INIT, ihr = hr * (ih / half);
for (const dx of [-1,0,1]) for (const dy of [-1,0,1]) for (const dt of [-1,0,1]) offs.push([dx*ih, dy*ih, dt*ihr]);
while (offs.length < NS) offs.push([(2*rnd()-1)*ih, (2*rnd()-1)*ih, (2*rnd()-1)*ihr]);
let worstX = 0, worstT = 0, worstK = 0, thrownBy = 0;
for (const o of offs) {
  const pcs = base.map((p, i) => (i === victim ? { x: c.x + o[0], y: c.y + o[1], rot: c.rot + o[2] } : { ...p }));
  const t2 = TC.sweep(pcs, att, pv, dir, K);
  const thrown = t2.findIndex(s => rOf(s.pose) > EDGE) + 1;
  thrownBy = Math.max(thrownBy, thrown || K);
  for (let k = 1; k <= (thrown || K); k++) {
    const dx = Math.max(Math.abs(t2[k-1].pose.x - tr[k-1].pose.x), Math.abs(t2[k-1].pose.y - tr[k-1].pose.y));
    const dt = Math.abs(t2[k-1].pose.rot - tr[k-1].pose.rot);
    if (dx > worstX) { worstX = dx; worstK = k; }
    if (dt > worstT) worstT = dt;
  }
}
console.log(`\nTUBE CHECK (sampled, ${offs.length} poses started in +-${ih}u, up to each pose's throw): worst deviation from the centre ${worstX.toFixed(4)}u at substep ${worstK}, ${(worstT/DEG).toFixed(4)} deg`);
console.log(`  tube half-width assumed: ${half}u, ${(hr/DEG).toFixed(4)} deg -- the sample ${worstX <= half && worstT <= hr ? 'STAYS INSIDE it' : 'LEAVES it, so the bound above is over the wrong box'}`);
