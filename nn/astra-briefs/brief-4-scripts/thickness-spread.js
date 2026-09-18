// How thick is the set along the contact normal? After a substep's push the solver leaves every
// pose on the shell at separation D, so the penetration entering the NEXT substep is one substep's
// worth of the attacker's advance. This measures that directly: pen_k = D - (separation between the
// pose entering substep k and the attacker AFTER substep k's rotation), over a sampled box.
const C = require('../contact-law.js');
const DEG = Math.PI / 180, { REPLICA, feetOf } = C;
const blue0 = { x: -24.31126879077936, y: -37.34799285619334, rot: 1.3448263401595464 };
const red0  = { x: -11.7593, y: -23.2838, rot: 2.9442 };
const P = { x: -34.40582386831619, y: -18.75456367565295 };
const rotAbout = (p, a) => { const c = Math.cos(a), s = Math.sin(a), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + a }; };
const BOX = +(process.argv[2] || 0.025), N = +(process.argv[4] || 200), D = 2.88;
const ROT = process.argv[3] !== undefined ? +process.argv[3] : 0.00433 * (BOX / 0.1);
let seed = 987654321; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
const poses = [];
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
const actAt = k => rotAbout(red0, -((k - 1) / 3) * DEG);
const moving = [];
for (let k = 1; k <= K; k++) moving[k] = poses.every(p => Math.abs(p[k].x - p[k-1].x) + Math.abs(p[k].y - p[k-1].y) + Math.abs(p[k].rot - p[k-1].rot) > 1e-12);
let entry = null; for (let k = 1; k <= K; k++) if (moving[k]) { entry = k; break; }
let thickest = 0, thickestAt = null, sum = 0, n = 0;
const rows = [];
for (let k = 1; k <= K; k++) {
  if (!moving[k]) continue;
  const aNext = actAt(k + 1);
  const pen = poses.map(p => D - C.minGapOf(aNext, p[k - 1], 12));
  const mn = Math.min(...pen), mx = Math.max(...pen);
  rows.push([k, mn, mx, mx - mn]);
  if (k > entry) { sum += mx; n++; if (mx > thickest) { thickest = mx; thickestAt = k; } }
}
console.log(`+-${BOX}u / +-${(ROT / DEG).toFixed(3)} deg, ${N} poses; first whole-box-contact substep ${entry}`);
console.log('substep   penetration entering the next push: min      max      spread');
for (const [k, mn, mx, sp] of rows) if ([entry, entry+1, 20, 40, 60, 70, 73, 74, 75, 80, 84, 90, 98].includes(k))
  console.log(`${String(k).padStart(7)}   ${mn.toExponential(2)}  ${mx.toExponential(2)}  ${sp.toExponential(2)}`);
console.log(`thickest after the entry substep: ${thickest.toExponential(3)}u at substep ${thickestAt}; mean ${(sum / n).toExponential(3)}u over ${n} substeps`);
