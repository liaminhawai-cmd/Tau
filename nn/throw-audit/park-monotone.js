// See ./README.md.
//
// IS THERE A MONOTONE QUANTITY OVER THE WHOLE DWELL?
//
// The interval certificate certifies at +-0.0002u and the sampled certificate it is meant to
// replace works on cells of about +-0.125u, so it is 600x too small per axis, and the shortfall is
// a threshold rather than a tuning problem (nn/THROW-CONTACT-LEMMAS.md section 10). All of the
// growth is in the chord-vertex park, and every one of its 25 substeps is a chance to grow.
//
// The route that would avoid paying that cost is not to carry a tight enclosure through the park at
// all. Its hypotheses are weaker than an enclosure in two ways worth separating:
//
//   H3  the exposed foot's RADIAL GAIN per substep is bounded below by some g_min > 0 over the
//       whole box, so the radius accumulates and the throw follows by summing, and
//   H4  the box is INVARIANT under the pushes -- it maps into itself -- which is far weaker than
//       tracking where inside it each pose goes.
//
// This measures both on the engine, over a box 500x wider than the certificate manages, plus the
// two things that would sink the route regardless: whether the radius is actually monotone in the
// substep for every pose, and whether the contact regime is shared across the box at each substep
// (a split regime is where a monotone argument would have to branch anyway).
'use strict';
const FW = require('../forced-win.js');
const CL = require('../contact-law.js');
const TC = require('../throw-cert.js');
const { feetOf, EDGE, R } = CL;
const DEG = Math.PI / 180;

const pose = process.env.POSE.split(',').map(Number);
const att = +(process.argv[2] ?? 1), pv = +(process.argv[3] ?? 0), dir = +(process.argv[4] ?? -1);
const jF = +(process.argv[5] ?? 1);
const half = +(process.argv[6] ?? 0.1), N = +(process.argv[7] ?? 200);
// Rotation half-width in RADIANS, given explicitly. The default ties it to the position half-width
// through R, matching the project's pose metric d = hypot(dx,dy) + R|drot|, but a box quoted as
// "+-0.25u / +-0.01 rad" is a different box from "+-0.25u" in that metric and the two do not
// compare, so it has to be sayable.
const hrotArg = process.argv[8] === undefined ? null : +process.argv[8];
const victim = 1 - att;

const base = FW.piecesOf(pose);
const K = Math.round(FW.limitAt(base, att, pv, dir).lim / TC.LIM_SUB);
const rOf = p => { const f = feetOf(p)[jF]; return Math.hypot(f.x, f.y); };

// deterministic sampling: corners, axis midpoints and a fixed pseudo-random fill
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const c = base[victim], hr = hrotArg === null ? half / R : hrotArg, offs = [];
for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dt of [-1, 0, 1]) offs.push([dx * half, dy * half, dt * hr]);
while (offs.length < N) offs.push([(2 * rnd() - 1) * half, (2 * rnd() - 1) * half, (2 * rnd() - 1) * hr]);

const runs = offs.map(o => {
  const pcs = base.map((p, i) => (i === victim ? { x: c.x + o[0], y: c.y + o[1], rot: c.rot + o[2] } : { ...p }));
  const tr = TC.sweep(pcs, att, pv, dir, K);
  return { o, tr, r: tr.map(t => rOf(t.pose)), pair: tr.map(t => (t.pushes.length ? `${t.pushes[0].kind}${t.pushes[0].i},${t.pushes[0].j}` : '-')) };
});

const centre = runs[13];   // offs[13] is (0,0,0): the middle of the 3x3x3 block
console.log(`box +-${half}u, +-${(hr / DEG).toFixed(3)} deg, ${runs.length} poses, arm (${pv},${dir}), foot ${jF}, ${K} substeps, rim ${EDGE}`);
console.log(`centre thrown at substep ${centre.r.findIndex(v => v > EDGE) + 1 || '-'}\n`);

// (a) is the radius monotone in the substep, for every pose?
let firstDrop = null, worstDrop = 0;
for (const run of runs) for (let k = 1; k < run.r.length; k++) {
  const d = run.r[k - 1] - run.r[k];
  if (d > 1e-12) { if (d > worstDrop) worstDrop = d; if (firstDrop === null || k + 1 < firstDrop) firstDrop = k + 1; }
}
console.log(`MONOTONE IN THE SUBSTEP: ${firstDrop === null ? 'yes, for every pose over the whole sweep'
  : `NO -- first fall at substep ${firstDrop}, worst fall ${worstDrop.toFixed(6)}u`}`);

// (b) the per-substep radial gain, min over the box, and (c) how far the poses spread
const firstContact = Math.min(...runs.map(r => r.tr.findIndex(t => t.pushes.length) + 1));
const thrownAll = Math.max(...runs.map(r => r.r.findIndex(v => v > EDGE) + 1));
console.log(`first push over the box: substep ${firstContact}; every pose thrown by substep ${thrownAll}`);
console.log('\n  k    deg    gain: min       max      |  radius: min      max     spread  |  regimes  thrown');
const dist = (a, b) => Math.hypot(a.pose.x - b.pose.x, a.pose.y - b.pose.y, R * (a.pose.rot - b.pose.rot));
let worstGain = Infinity, worstGainK = 0;
for (let k = 1; k <= K; k++) {
  const g = runs.map(r => r.r[k - 1] - (k === 1 ? rOf(base[victim]) : r.r[k - 2]));
  const gmin = Math.min(...g), gmax = Math.max(...g);
  const rs = runs.map(r => r.r[k - 1]);
  let spread = 0; for (const r of runs) spread = Math.max(spread, dist(r.tr[k - 1], centre.tr[k - 1]));
  const regimes = new Set(runs.map(r => r.pair[k - 1]));
  const thrown = runs.filter(r => r.r[k - 1] > EDGE).length;
  // Only CONTACT substeps count. Before first touch the victim is not pushed at all, so the gain is
  // exactly zero and a bound taken over every substep reads as "not positive" while saying nothing:
  // on arm (2,-1) of this seed the first push is at substep 75 of 331. The barrier sums the substeps
  // that actually push, so that is where a lower bound has to hold.
  const pushed = runs.every(r => r.tr[k - 1].pushes.length);
  if (pushed && gmin < worstGain) { worstGain = gmin; worstGainK = k; }
  if (k >= firstContact && k <= Math.min(K, thrownAll + 20)) console.log(`  ${String(k).padStart(3)} ${(k * TC.LIM_SUB / DEG).toFixed(2).padStart(6)}  ${gmin.toFixed(6).padStart(9)} ${gmax.toFixed(6).padStart(9)}  | ${Math.min(...rs).toFixed(3).padStart(8)} ${Math.max(...rs).toFixed(3).padStart(8)} ${spread.toFixed(4).padStart(8)}  |    ${regimes.size}      ${thrown}/${runs.length}`);
}
console.log(`\nH3 (radial gain bounded below over the box, CONTACT substeps only): min gain ${worstGain.toFixed(6)}u at substep ${worstGainK} -- ${worstGain > 0 ? 'POSITIVE throughout' : 'NOT positive'}`);
// The park window separately. The two differ by more than an order of magnitude and quoting the
// park's figure as "the smallest step anywhere" overstates the margin by about 20x.
{ const [pk0, pk1] = [74, 98]; let m = Infinity, mk = 0;
  for (let k = pk0; k <= Math.min(pk1, K); k++) for (const r of runs) {
    if (!r.tr[k - 1].pushes.length) continue;
    const g = r.r[k - 1] - r.r[k - 2]; if (g < m) { m = g; mk = k; } }
  console.log(`   over the PARK window ${pk0}-${pk1} only: min gain ${m === Infinity ? 'n/a' : m.toFixed(6) + 'u at substep ' + mk}`); }
// measured across the CONTACT window: during free flight the victim does not move, so including
// the no-push substeps only dilutes whatever the pushes do.
const sp0 = Math.max(...runs.map(r => dist(r.tr[firstContact - 1], centre.tr[firstContact - 1])));
const spEnd = Math.max(...runs.map(r => dist(r.tr[thrownAll - 1], centre.tr[thrownAll - 1])));
console.log(`H4 (box invariance), first contact ${firstContact} to the throw ${thrownAll}: pose spread about the centre ${sp0.toFixed(4)}u -> ${spEnd.toFixed(4)}u -- the true dynamics ${spEnd <= sp0 ? `CONTRACT (x${(spEnd / sp0).toFixed(3)})` : `EXPAND by ${(spEnd / sp0).toFixed(3)}x`}`);
const allThrown = runs.filter(r => r.r.some(v => v > EDGE)).length;
console.log(`every pose thrown: ${allThrown}/${runs.length}; latest throw substep ${Math.max(...runs.map(r => r.r.findIndex(v => v > EDGE) + 1))}`);
