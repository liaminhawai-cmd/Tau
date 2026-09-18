// How wide is the reachable set ALONG the contact normal, as against across it? For each substep,
// the spread over the pose box of the attacker-victim separation entering that substep, set beside
// the spatial spread of the poses themselves. If the separation range is orders of magnitude below
// the box width, a blanket pad over the box overstates the distance uncertainty by that factor.
const C = require('../contact-law.js');
const DEG = Math.PI / 180, { REPLICA, feetOf, EDGE, MIND } = C;
const blue0 = { x: -24.31126879077936, y: -37.34799285619334, rot: 1.3448263401595464 };
const red0  = { x: -11.7593, y: -23.2838, rot: 2.9442 };
const P = { x: -34.40582386831619, y: -18.75456367565295 };
const rotAbout = (p, a) => { const c = Math.cos(a), s = Math.sin(a), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + a }; };
const BOX = +(process.argv[2] || 0.1), ROT = +(process.argv[3] || 0.01), N = +(process.argv[4] || 200);
const D = 2.88;
let seed = 987654321; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
const poses = [];                       // poses[i][k-1] = victim pose ENTERING substep k
for (let i = 0; i < N; i++) {
  const q0 = i === 0 ? { ...blue0 } : { x: blue0.x + BOX * rnd(), y: blue0.y + BOX * rnd(), rot: blue0.rot + ROT * rnd() };
  const r = [{ ...q0 }]; let opp = { ...q0 }, act = { ...red0 };
  for (let call = 0; call < 46; call++) {
    const o = C.swing([opp, act], 1, 0, -1, 1 * DEG, { ...REPLICA, record: true });
    for (const rec of o.record) r.push({ x: rec.x, y: rec.y, rot: rec.rot });
    opp = { x: o.opp.x, y: o.opp.y, rot: o.opp.rot }; act = rotAbout(red0, -(call + 1) * DEG);
  }
  poses.push(r);
}
const K = poses[0].length - 1;
// whole box in contact entering substep k: every pose is pushed during it, read off motion
const moving = [];
for (let k = 1; k <= K; k++) moving[k] = poses.every(p => Math.abs(p[k].x - p[k-1].x) + Math.abs(p[k].y - p[k-1].y) + Math.abs(p[k].rot - p[k-1].rot) > 1e-12);
const actAt = k => rotAbout(red0, -((k - 1) / 3) * DEG);   // entering substep k
let sumRange = 0, nContact = 0, parkSum = 0, parkN = 0, worst = 0, worstAt = null;
let spanSum = 0;
console.log(`+-${BOX}u / +-${ROT} rad, ${N} poses, D = ${D}`);
console.log('substep   separation: min      max      range     pose spread (u)');
for (let k = 1; k <= K; k++) {
  const a = actAt(k);
  const d = poses.map(p => C.minGapOf(a, p[k - 1], 12));
  const mn = Math.min(...d), mx = Math.max(...d);
  const xs = poses.map(p => p[k - 1].x), ys = poses.map(p => p[k - 1].y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (moving[k]) {                                          // whole box in contact entering this substep
    nContact++; sumRange += mx - mn; spanSum += span;
    if (mx - mn > worst) { worst = mx - mn; worstAt = k; }
    if (k >= 74 && k <= 98) { parkSum += mx - mn; parkN++; }
  }
  if ([12, 16, 20, 30, 50, 70, 74, 80, 84, 90, 98].includes(k))
    console.log(`${String(k).padStart(7)}   ${mn.toFixed(6)}  ${mx.toFixed(6)}  ${(mx - mn).toExponential(2)}   ${span.toFixed(4)}${moving[k] ? '' : '   (not all in contact)'}`);
}
console.log(`\nsubsteps with the whole box in contact entering them: ${nContact}`);
console.log(`mean separation range over those substeps: ${(sumRange / nContact).toExponential(3)}u; worst ${worst.toExponential(3)}u at substep ${worstAt}`);
console.log(`mean separation range through the park (74-98): ${(parkSum / parkN).toExponential(3)}u over ${parkN} substeps`);
console.log(`mean pose spread over those substeps: ${(spanSum / nContact).toFixed(4)}u`);
console.log(`ratio, pose spread to separation range: ${(spanSum / sumRange).toFixed(1)}x on average`);
