// Is there a monotone quantity over the whole vertex dwell, over a box far larger than the one
// the interval certificate closes on? Samples victim start poses from a box, runs each on the
// search's grid, and asks of the exposed foot's radius: does it increase at every substep of the
// park, and what is its worst value over the box at each substep.
const C = require('../contact-law.js');
const DEG = Math.PI / 180, { REPLICA, feetOf, EDGE } = C;
const blue0 = { x: -24.31126879077936, y: -37.34799285619334, rot: 1.3448263401595464 };
const red0  = { x: -11.7593, y: -23.2838, rot: 2.9442 };
const P = { x: -34.40582386831619, y: -18.75456367565295 };
const rotAbout = (p, a) => { const c = Math.cos(a), s = Math.sin(a), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + a }; };
const BOX = +(process.argv[2] || 0.1), ROT = +(process.argv[3] || 0.01), N = +(process.argv[4] || 200);
const FOOT = 1;                                              // the foot that leaves the board on this seed
let seed = 987654321; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };

const PARK = [74, 98], runs = [], starts = [];
for (let i = 0; i < N; i++) {
  const q0 = i === 0 ? { ...blue0 }
    : { x: blue0.x + BOX * rnd(), y: blue0.y + BOX * rnd(), rot: blue0.rot + ROT * rnd() };
  const r = [];
  let opp = { ...q0 }, act = { ...red0 };
  for (let call = 0; call < 46; call++) {
    const o = C.swing([opp, act], 1, 0, -1, 1 * DEG, { ...REPLICA, record: true });
    for (const rec of o.record) { const f = feetOf(rec); r.push({ foot: Math.hypot(f[FOOT].x, f[FOOT].y), max: Math.max(...f.map(g => Math.hypot(g.x, g.y))) }); }
    opp = { x: o.opp.x, y: o.opp.y, rot: o.opp.rot }; act = rotAbout(red0, -(call + 1) * DEG);
  }
  runs.push(r);
  const f0 = feetOf(q0).map(g => Math.hypot(g.x, g.y));
  starts.push({ maxR: Math.max(...f0), off: Math.max(...f0) > EDGE, touching: C.minGapOf(red0, q0, 12) < 2.88 });
}
console.log(`start poses: max foot radius ${Math.min(...starts.map(s => s.maxR)).toFixed(3)} to ${Math.max(...starts.map(s => s.maxR)).toFixed(3)} (rim ${EDGE}); off board at the start: ${starts.filter(s => s.off).length}; already touching the attacker: ${starts.filter(s => s.touching).length}`);
const at = k => runs.map(r => r[k - 1]);
const off = r => { for (let k = 1; k <= r.length; k++) if (r[k - 1].max > EDGE) return k; return null; };
const leaves = runs.map(off);
const never = leaves.filter(k => k === null).length;
console.log(`box +-${BOX}u / +-${ROT} rad, ${N} poses (the first is the centre), foot ${FOOT}, rim ${EDGE}`);
console.log(`thrown: ${N - never} of ${N}; first leaves at substep ${Math.min(...leaves.filter(Boolean))}, last at ${Math.max(...leaves.filter(Boolean))}`);

// monotonicity of the exposed foot's radius across the park, per pose
let worstStep = Infinity, worstAt = null, nonMono = 0;
for (let i = 0; i < runs.length; i++) {
  let bad = false;
  for (let k = PARK[0]; k < PARK[1]; k++) {
    const d = runs[i][k].foot - runs[i][k - 1].foot;
    if (d < worstStep) { worstStep = d; worstAt = k + 1; }
    if (d <= 0) bad = true;
  }
  if (bad) nonMono++;
}
console.log(`across substeps ${PARK[0]}-${PARK[1]}: ${nonMono} of ${N} poses have a non-increasing step; smallest step anywhere ${worstStep.toFixed(6)}u (at substep ${worstAt})`);
console.log('\nsubstep  min foot radius over the box   max        centre     spread   clears rim?');
for (const k of [70, 74, 78, 82, 84, 85, 86, 90, 94, 98]) {
  const v = at(k).map(r => r.foot), mn = Math.min(...v), mx = Math.max(...v);
  console.log(`${String(k).padStart(5)}    ${mn.toFixed(4)}                      ${mx.toFixed(4)}    ${at(k)[0].foot.toFixed(4)}   ${(mx - mn).toFixed(4)}   ${mn > EDGE ? 'yes' : 'no'}`);
}
