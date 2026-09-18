// How much does the set spread in the directions the shell does NOT pin? The deviation of each pose
// from the centre, in the foot-displacement metric (dx, dy, R*drot), is almost entirely tangential,
// since the along-normal part collapses to the shell's width within a few substeps. So its extent
// tracks the tangential spread: this reports it at first contact and at the centre's throw, per box.
const C = require('../contact-law.js');
const DEG = Math.PI / 180, { REPLICA, feetOf, R } = C;
const blue0 = { x: -24.31126879077936, y: -37.34799285619334, rot: 1.3448263401595464 };
const red0  = { x: -11.7593, y: -23.2838, rot: 2.9442 };
const P = { x: -34.40582386831619, y: -18.75456367565295 };
const rotAbout = (p, a) => { const c = Math.cos(a), s = Math.sin(a), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + a }; };
const BOX = +(process.argv[2] || 0.025), N = +(process.argv[4] || 200);
const ROT = process.argv[3] !== undefined && process.argv[3] !== '-' ? +process.argv[3] : BOX / R;
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
const dev = k => { const c = poses[0][k - 1]; let m = 0;
  for (const p of poses) { const d = p[k - 1];
    m = Math.max(m, Math.hypot(d.x - c.x, d.y - c.y, R * (d.rot - c.rot))); } return m; };
const moving = [];
for (let k = 1; k <= K; k++) moving[k] = poses.every(p => Math.abs(p[k].x - p[k-1].x) + Math.abs(p[k].y - p[k-1].y) + Math.abs(p[k].rot - p[k-1].rot) > 1e-12);
let entry = null; for (let k = 1; k <= K; k++) if (moving[k]) { entry = k; break; }
const THROW = 84;
const a = dev(entry), b = dev(THROW);
console.log(`+-${BOX}u / +-${(ROT / DEG).toFixed(3)} deg, ${N} poses: spread ${a.toFixed(5)} at first contact (substep ${entry}) -> ${b.toFixed(5)} at the centre's throw (84), x${(b / a).toFixed(4)}`);
{ // per-substep profile: where does the spread contract and where does it grow?
  let minAt = null, minV = Infinity;
  for (let k = entry; k <= THROW; k++) { const v = dev(k); if (v < minV) { minV = v; minAt = k; } }
  console.log(`   profile: ${dev(entry).toFixed(5)} at ${entry} -> trough ${minV.toFixed(5)} at ${minAt} -> ${dev(THROW).toFixed(5)} at ${THROW}; dip x${(minV/dev(entry)).toFixed(4)}, rise x${(dev(THROW)/minV).toFixed(4)} over ${THROW-minAt} substeps (x${Math.pow(dev(THROW)/minV, 1/(THROW-minAt)).toFixed(5)} a substep)`);
  const f = k => dev(k) / dev(k - 1);
  console.log('   per-substep factor: ' + [entry+5, 20, 30, 35, 40, 50, 60, 70, 74, 80, 84].filter(k => k > entry && k <= THROW).map(k => `${k}:${f(k).toFixed(5)}`).join('  '));
}
let flat = 1, worst = 1, worstAt = null;
for (let k = entry + 1; k <= THROW; k++) { const f = dev(k) / dev(k - 1);
  if (k < 74) flat *= f;
  if (f > worst) { worst = f; worstAt = k; } }
console.log(`   through the interior stretch (${entry + 1}..73): x${flat.toFixed(4)} in total; worst single substep x${worst.toFixed(4)} at ${worstAt}; park (74..84) x${(b / dev(73)).toFixed(4)}`);
