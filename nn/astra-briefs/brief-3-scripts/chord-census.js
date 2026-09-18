// Which chord pair holds the global minimum, and where along each chord, on the search's grid.
// Run from a copy of nn/ (see README). The victim pose used at each substep is the PRE-push one,
// which is the pose the push law's contact search actually sees.
const C = require('../contact-law.js');
const R = C.R, DEG = Math.PI / 180, { REPLICA } = C;
const blue0 = { x: -24.31126879077936, y: -37.34799285619334, rot: 1.3448263401595464 };
const red0  = { x: -11.7593, y: -23.2838, rot: 2.9442 };
const P = { x: -34.40582386831619, y: -18.75456367565295 };
const rotAbout = (p, a) => { const c = Math.cos(a), s = Math.sin(a), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + a }; };
const arcP = (p, i) => { const a = p.rot + i * 2 * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a), pts = [];
  for (let k = 0; k <= 12; k++) { const ph = (k / 12) * Math.PI / 2, s = Math.sin(ph) * R; pts.push({ x: p.x + ca * s, y: p.y + sa * s, h: Math.cos(ph) * R }); } return pts; };
function segseg(a0, a1, b0, b1) {                       // sampled on A, exact projection onto B
  let best = 1e9, bt = 0, bs = 0; const N = 20000;
  for (let i = 0; i <= N; i++) { const t = i / N, px = a0.x + (a1.x - a0.x) * t, py = a0.y + (a1.y - a0.y) * t, ph = a0.h + (a1.h - a0.h) * t;
    const dx = b1.x - b0.x, dy = b1.y - b0.y, dh = b1.h - b0.h, L = dx * dx + dy * dy + dh * dh;
    let u = ((px - b0.x) * dx + (py - b0.y) * dy + (ph - b0.h) * dh) / L; u = Math.max(0, Math.min(1, u));
    const d = Math.hypot(b0.x + dx * u - px, b0.y + dy * u - py, b0.h + dh * u - ph);
    if (d < best) { best = d; bt = t; bs = u; } }
  return { d: best, t: bt, u: bs };
}
const trace = []; let opp = { ...blue0 }, act = { ...red0 };
for (let call = 0; call < 46; call++) {
  const o = C.swing([opp, act], 1, 0, -1, 1 * DEG, { ...REPLICA, trace: true, record: true });
  for (const t of o.trace) trace.push({ ...t, k: call * 3 + Math.round(t.alpha / (DEG / 3)) });
  opp = { x: o.opp.x, y: o.opp.y, rot: o.opp.rot }; act = rotAbout(red0, -(call + 1) * DEG);
}
const lo = +(process.argv[2] || 71), hi = +(process.argv[3] || 80);
for (const t of trace) {
  if (t.k < lo || t.k > hi) continue;
  const a = rotAbout(red0, -t.k / 3 * DEG), A = arcP(a, 0), V = arcP(t.opp, 0);
  let best = { d: 1e9 };
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { const r = segseg(A[i], A[i + 1], V[j], V[j + 1]); if (r.d < best.d) best = { d: r.d, i, j, t: r.t, u: r.u }; }
  console.log(`k${t.k}  attacker chord ${best.i} at ${best.t.toFixed(4)}   victim chord ${best.j} at ${best.u.toFixed(4)}   d ${best.d.toFixed(5)}`);
}
