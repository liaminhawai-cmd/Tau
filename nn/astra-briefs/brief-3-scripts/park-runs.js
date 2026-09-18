// The park is not the same interval before and after the push. Reported per substep k:
// the victim's chord and parameter at the closest pair, using (a) the pose ENTERING substep k,
// which is what the contact search sees, and (b) the pose LEAVING it, after the push.
const C = require('../contact-law.js');
const R = C.R, DEG = Math.PI / 180, { REPLICA } = C;
const blue0 = { x: -24.31126879077936, y: -37.34799285619334, rot: 1.3448263401595464 };
const red0  = { x: -11.7593, y: -23.2838, rot: 2.9442 };
const P = { x: -34.40582386831619, y: -18.75456367565295 };
const rotAbout = (p, a) => { const c = Math.cos(a), s = Math.sin(a), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + a }; };
const arcP = (p, i) => { const a = p.rot + i * 2 * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a), pts = [];
  for (let k = 0; k <= 12; k++) { const ph = (k / 12) * Math.PI / 2, s = Math.sin(ph) * R; pts.push({ x: p.x + ca * s, y: p.y + sa * s, h: Math.cos(ph) * R }); } return pts; };
function segseg(a0, a1, b0, b1) { let best = 1e9, bt = 0, bs = 0; const N = 20000;
  for (let i = 0; i <= N; i++) { const t = i / N, px = a0.x + (a1.x - a0.x) * t, py = a0.y + (a1.y - a0.y) * t, ph = a0.h + (a1.h - a0.h) * t;
    const dx = b1.x - b0.x, dy = b1.y - b0.y, dh = b1.h - b0.h, L = dx * dx + dy * dy + dh * dh;
    let u = ((px - b0.x) * dx + (py - b0.y) * dy + (ph - b0.h) * dh) / L; u = Math.max(0, Math.min(1, u));
    const d = Math.hypot(b0.x + dx * u - px, b0.y + dy * u - py, b0.h + dh * u - ph);
    if (d < best) { best = d; bt = t; bs = u; } }
  return { d: best, t: bt, u: bs }; }
const victimAt = (vp, k) => { const a = rotAbout(red0, -k / 3 * DEG), A = arcP(a, 0), V = arcP(vp, 0);
  let best = { d: 1e9 };
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { const r = segseg(A[i], A[i + 1], V[j], V[j + 1]); if (r.d < best.d) best = { d: r.d, i, j, t: r.t, u: r.u }; }
  return { ...best, parked: (best.j === 4 && best.u < 1e-9) || (best.j === 3 && best.u > 1 - 1e-9) }; };

const pre = new Map(), post = [];
let opp = { ...blue0 }, act = { ...red0 };
for (let call = 0; call < 46; call++) {
  const o = C.swing([opp, act], 1, 0, -1, 1 * DEG, { ...REPLICA, trace: true, record: true });
  for (const t of o.trace) pre.set(call * 3 + Math.round(t.alpha / (DEG / 3)), { x: t.opp.x, y: t.opp.y, rot: t.opp.rot });
  for (let s = 0; s < o.record.length; s++) post.push({ ...o.record[s], k: call * 3 + s + 1 });
  opp = { x: o.opp.x, y: o.opp.y, rot: o.opp.rot }; act = rotAbout(red0, -(call + 1) * DEG);
}
const runs = label => { const ks = []; return { ks }; };
const preK = [], postK = [];
console.log('  k   entering the substep      leaving it');
for (let k = 70; k <= 115; k++) {
  const a = pre.has(k) ? victimAt(pre.get(k), k) : null;
  const b = victimAt(post[k - 1], k);
  if (a && a.parked) preK.push(k);
  if (b.parked) postK.push(k);
  if (k <= 82 || k >= 96)
    console.log(`${String(k).padStart(3)}   chord ${a ? a.j : '-'} at ${a ? a.u.toFixed(5) : '   -   '}${a && a.parked ? ' PARKED' : '       '}    chord ${b.j} at ${b.u.toFixed(5)}${b.parked ? ' PARKED' : ''}`);
}
const spans = ks => { const out = []; let s = ks[0], p = ks[0];
  for (const k of ks.slice(1)) { if (k === p + 1) { p = k; continue; } out.push([s, p]); s = p = k; } out.push([s, p]); return out; };
console.log('\nparked entering the substep:', spans(preK).map(([a, b]) => `${a}-${b}`).join(', '));
console.log('parked leaving the substep: ', spans(postK).map(([a, b]) => `${a}-${b}`).join(', '));
console.log('the throw is at substep 84');
