// Where should the first slab begin? Prints, at each substep, the MINIMUM over every pose in the
// box of the exposed foot's radial gain -- the quantity a per-slab (H2)/(H3) sums -- for a run of
// N poses, so the profile can be read rather than reduced to a single floor. Sampling shows up as
// a shift in the level; geometry shows up as the same shape at every N.
const C = require('../contact-law.js');
const DEG = Math.PI / 180, { REPLICA, feetOf, EDGE } = C;
const blue0 = { x: -24.31126879077936, y: -37.34799285619334, rot: 1.3448263401595464 };
const red0  = { x: -11.7593, y: -23.2838, rot: 2.9442 };
const P = { x: -34.40582386831619, y: -18.75456367565295 };
const rotAbout = (p, a) => { const c = Math.cos(a), s = Math.sin(a), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + a }; };
const BOX = +(process.argv[2] || 0.125), ROT = +(process.argv[3] || 0.01), N = +(process.argv[4] || 200), EPS = 1e-9;
let seed = 987654321; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
const runs = [];
for (let i = 0; i < N; i++) {
  const q0 = i === 0 ? { ...blue0 } : { x: blue0.x + BOX * rnd(), y: blue0.y + BOX * rnd(), rot: blue0.rot + ROT * rnd() };
  const r = []; let opp = { ...q0 }, act = { ...red0 };
  for (let call = 0; call < 46; call++) {
    const o = C.swing([opp, act], 1, 0, -1, 1 * DEG, { ...REPLICA, record: true });
    for (const rec of o.record) { const f = feetOf(rec); r.push(Math.hypot(f[1].x, f[1].y)); }
    opp = { x: o.opp.x, y: o.opp.y, rot: o.opp.rot }; act = rotAbout(red0, -(call + 1) * DEG);
  }
  runs.push(r);
}
const K = runs[0].length;
const mins = [];
for (let k = 2; k <= K; k++) mins[k] = Math.min(...runs.map(r => r[k - 1] - r[k - 2]));
let firstFull = null;
for (let k = 2; k <= K; k++) if (mins[k] > EPS) { firstFull = k; break; }
// the first substep from which EVERY later substep has all poses in contact
let sustained = null;
for (let k = K; k >= 2; k--) { if (mins[k] > EPS) sustained = k; else break; }
console.log(`+-${BOX}u / +-${ROT} rad, ${N} poses`);
console.log(`  first substep with the whole box in contact: ${firstFull};  sustained from: ${sustained}`);
const show = [];
for (let k = firstFull; k <= Math.min(firstFull + 20, K); k++) show.push(k);
for (const k of [40, 50, 60, 70, 74, 80, 84, 90, 98]) if (k <= K && !show.includes(k)) show.push(k);
console.log('  substep   min gain over the box');
for (const k of show) console.log(`  ${String(k).padStart(7)}   ${mins[k] <= EPS ? '0 (some pose not in contact)' : mins[k].toExponential(2) + 'u'}`);
// what a slab starting at s would carry, per substep, to substep 98
for (const s of [firstFull, firstFull + 1, firstFull + 2]) {
  let worst = Infinity; for (let k = s; k <= 98; k++) worst = Math.min(worst, mins[k]);
  console.log(`  slab from ${s} to 98: worst per-substep minimum ${worst <= EPS ? '0' : worst.toExponential(2) + 'u'}`);
}
