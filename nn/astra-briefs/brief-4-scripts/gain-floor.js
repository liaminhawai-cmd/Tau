// The quantity the barrier theorem actually sums: at each substep, the MINIMUM over every pose in
// the box of the exposed foot's radial gain. A substep where some pose is not in contact has a
// minimum of exactly zero -- a pose that is not pushed does not move -- so the barrier cannot count
// it. The floor that matters is the smallest positive per-substep minimum.
const C = require('../contact-law.js');
const DEG = Math.PI / 180, { REPLICA, feetOf, EDGE } = C;
const blue0 = { x: -24.31126879077936, y: -37.34799285619334, rot: 1.3448263401595464 };
const red0  = { x: -11.7593, y: -23.2838, rot: 2.9442 };
const P = { x: -34.40582386831619, y: -18.75456367565295 };
const rotAbout = (p, a) => { const c = Math.cos(a), s = Math.sin(a), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + a }; };
const BOX = +process.argv[2], ROT = +process.argv[3], N = +(process.argv[4] || 200), EPS = 1e-9;
let seed = 987654321; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
const runs = [];
for (let i = 0; i < N; i++) {
  const q0 = i === 0 ? { ...blue0 } : { x: blue0.x + BOX * rnd(), y: blue0.y + BOX * rnd(), rot: blue0.rot + ROT * rnd() };
  const r = []; let opp = { ...q0 }, act = { ...red0 };
  for (let call = 0; call < 46; call++) {
    const o = C.swing([opp, act], 1, 0, -1, 1 * DEG, { ...REPLICA, record: true });
    for (const rec of o.record) { const f = feetOf(rec); r.push({ foot: Math.hypot(f[1].x, f[1].y), max: Math.max(...f.map(g => Math.hypot(g.x, g.y))) }); }
    opp = { x: o.opp.x, y: o.opp.y, rot: o.opp.rot }; act = rotAbout(red0, -(call + 1) * DEG);
  }
  runs.push(r);
}
const K = runs[0].length;
let full = 0, partial = 0, none = 0, floor = Infinity, floorAt = null, smallestSingle = Infinity, singleAt = null;
const partialAt = [];
for (let k = 2; k <= K; k++) {
  const g = runs.map(r => r[k - 1].foot - r[k - 2].foot);
  const mn = Math.min(...g), mx = Math.max(...g);
  for (const v of g) if (v > EPS && v < smallestSingle) { smallestSingle = v; singleAt = k; }
  if (mn > EPS) { full++; if (mn < floor) { floor = mn; floorAt = k; } }
  else if (mx > EPS) { partial++; partialAt.push(k); }
  else none++;
}
console.log(`+-${BOX}u / +-${ROT} rad, ${N} poses`);
console.log(`  substeps with every pose in contact: ${full};  partial: ${partial} (${partialAt.join(',')});  none: ${none}`);
console.log(`  FLOOR, the smallest per-substep minimum over poses where all are in contact: ${floor.toExponential(3)}u at substep ${floorAt}`);
console.log(`  smallest nonzero gain any single pose ever has: ${smallestSingle.toExponential(3)}u at substep ${singleAt} (never summed by the barrier)`);
