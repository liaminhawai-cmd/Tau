// See ./README.md.
//
// WHAT SHAPE IS THE INVARIANT SET?
//
// gain-bound.js computes H3 rigorously over a tube box around the centre's trajectory, and at a tube
// of +-0.1u it certifies NOTHING: not one substep of the sweep passes the whole-box contact test,
// because that test needs the box's whole distance range to sit under D and the box is 0.24u wide
// against a penetration of a few hundredths. The sampled measurement said the opposite -- 123 of 131
// substeps have every pose in contact -- and both are right, which means the reachable set is not a
// box around the centre. The dynamics PIN every pose onto the contact shell, so the set is a thin
// sheet: as wide as the box tangentially, as thin as the shell along the push.
//
// This measures that shape directly. At each substep it reports, over the sampled poses, the range
// of the distance to the attacker's leg entering the substep (the thickness the shell leaves) and
// the spread of the poses across it (the width the certificate has to carry). The ratio is how much
// an axis-aligned box overpays.
'use strict';
const FW = require('../forced-win.js');
const CL = require('../contact-law.js');
const TC = require('../throw-cert.js');
const { feetOf, EDGE, R, MIND: D } = CL;
const DEG = Math.PI / 180;

const pose = process.env.POSE.split(',').map(Number);
const att = +(process.argv[2] ?? 1), pv = +(process.argv[3] ?? 0), dir = +(process.argv[4] ?? -1);
const jF = +(process.argv[5] ?? 1);
const half = +(process.argv[6] ?? 0.1);
const hrotArg = process.argv[7] === undefined ? null : +process.argv[7];
const NS = +(process.argv[8] ?? 200);
const victim = 1 - att;

const base = FW.piecesOf(pose);
const K = Math.round(FW.limitAt(base, att, pv, dir).lim / TC.LIM_SUB);
const att0 = base[att], Pv = feetOf(att0)[pv];
const rotAbout = (p, P, dA) => { const c = Math.cos(dA), s = Math.sin(dA), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx*c - ry*s, y: P.y + rx*s + ry*c, rot: p.rot + dA }; };
const hr = hrotArg === null ? half / R : hrotArg;
const rOf = p => { const f = feetOf(p)[jF]; return Math.hypot(f.x, f.y); };
const pad = Math.hypot(half, half) + 2*R*Math.sin(hr/2);

let seed = 12345; const rnd = () => (seed = (seed*1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const c = base[victim], offs = [];
for (const dx of [-1,0,1]) for (const dy of [-1,0,1]) for (const dt of [-1,0,1]) offs.push([dx*half, dy*half, dt*hr]);
while (offs.length < NS) offs.push([(2*rnd()-1)*half, (2*rnd()-1)*half, (2*rnd()-1)*hr]);

const runs = offs.map(o => {
  const pcs = base.map((p, i) => (i === victim ? { x: c.x + o[0], y: c.y + o[1], rot: c.rot + o[2] } : { ...p }));
  return { o, tr: TC.sweep(pcs, att, pv, dir, K), start: pcs[victim] };
});
const centre = runs[13];

// the pair the centre uses, and the distance each pose presents to it entering each substep
const dOf = (q, A, pair) => { try { const an = TC.analyse({ x: [q.x, q.x], y: [q.y, q.y], rot: [q.rot, q.rot] }, A, pair);
  return Number.isFinite(an.distC) ? an.distC : null; } catch (e) { return null; } };

console.log(`box +-${half}u, +-${(hr/DEG).toFixed(3)} deg, ${runs.length} poses, arm (${pv},${dir}), foot ${jF}, ${K} substeps`);
console.log(`the blanket pad a box of this size carries: ${pad.toFixed(4)}u; D = ${D}\n`);
console.log('  k    deg  | pre-push distance over the poses  | shell     | pose spread | overpay');
console.log('            |   min        max       range      | D - max   | dx      drot|  pad/range');
let firstC = null, lastRow = null, sums = { range: 0, n: 0 };
for (let k = 1; k <= K; k++) {
  const pr = centre.tr[k-1].pushes;
  if (!pr.length) continue;
  const A = rotAbout(att0, Pv, dir * k * TC.LIM_SUB), pair = [pr[0].i, pr[0].j];
  const ds = []; let free = 0;
  for (const r of runs) {
    const q = k === 1 ? r.start : r.tr[k-2].pose;
    if (rOf(q) > EDGE) continue;                    // already thrown: it is out of the argument
    const d = dOf(q, A, pair); if (d !== null) ds.push(d); else free++;
  }
  if (ds.length < 2) continue;
  // a pose whose closest pair is out of reach of the attacker's leg is one the whole-box contact
  // test has to give zero to, so count them rather than letting them vanish into a NaN

  const mn = Math.min(...ds), mx = Math.max(...ds), range = mx - mn;
  if (firstC === null) firstC = k;
  let sx = 0, st = 0;
  for (const r of runs) { const q = k === 1 ? r.start : r.tr[k-2].pose, qc = k === 1 ? centre.start : centre.tr[k-2].pose;
    sx = Math.max(sx, Math.hypot(q.x - qc.x, q.y - qc.y)); st = Math.max(st, Math.abs(q.rot - qc.rot)); }
  sums.range += range; sums.n++;
  const row = `  ${String(k).padStart(3)} ${(k*TC.LIM_SUB/DEG).toFixed(2).padStart(6)} | ${mn.toFixed(4)} ${mx.toFixed(4)} ${range.toFixed(5).padStart(9)} | ${(D-mx).toExponential(2).padStart(9)} | ${sx.toFixed(4)} ${(st/DEG).toFixed(3).padStart(6)} | ${(pad/Math.max(range,1e-9)).toFixed(1).padStart(8)}${free ? `  (${free} free)` : ''}`;
  if (k <= firstC + 6 || k % 10 === 0 || k >= K - 3) console.log(row);
  lastRow = row;
}
console.log(`\nmean distance range over the ${sums.n} contact substeps: ${(sums.range/Math.max(sums.n,1)).toFixed(5)}u`);
console.log(`a box of +-${half}u carries a blanket pad of ${pad.toFixed(4)}u, so it overstates the distance uncertainty by about ${(pad/(sums.range/Math.max(sums.n,1))).toFixed(0)}x`);
console.log(`\nREADING: the poses are spread over ~${half*2}u of the plane but present the attacker with a distance range of`);
console.log(`~${(sums.range/Math.max(sums.n,1)).toFixed(4)}u, because each has been pushed onto the same shell. An invariant set has to be thin along`);
console.log(`the push and wide across it; an axis-aligned box is the wrong shape by the ratio above.`);
