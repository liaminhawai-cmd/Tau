// See ./README.md.
//
// CLAIM UNDER TEST (outside review, brief 3): "the park persistence shortcut is false -- the
// before-push vertex run is steps 74-98 but the after-push run is 79-104, and at step 74 the second
// vertex inequality already fails after the push."
//
// The two runs are measured here off the same sweep. For each substep k the BEFORE column takes the
// pose the engine integrated from (tr[k-2].pose) and the AFTER column takes the pose it produced
// (tr[k-1].pose), against the SAME attacker geometry for that substep, and reports where the global
// closest point sits along the victim's leg in arc angle -- a vertex is an exact multiple of
// 90/NSEG degrees. Arc angle, not chord index: at a vertex both adjacent chords report the same
// physical point, so the index flips while the point does not move.
'use strict';
const FW = require('../forced-win.js');
const CL = require('../contact-law.js');
const TC = require('../throw-cert.js');
const { R, MIND: D } = CL, CFG = CL.eng.CFG, H = CFG.hubHeight, NSEG = CFG.legSegs;
const DEG = Math.PI / 180, VTOL = 1e-9;
const pose = process.env.POSE.split(',').map(Number), pieces = FW.piecesOf(pose);
const att = 1, pv = 0, dir = -1, victim = 0;
const lim = FW.limitAt(pieces, att, pv, dir).lim, K = Math.round(lim / TC.LIM_SUB);
const arcPts = (p, i) => { const b = p.rot + i * 2 * Math.PI / 3, cb = Math.cos(b), sb = Math.sin(b), o = []; for (let k = 0; k <= NSEG; k++) { const ph = (k / NSEG) * Math.PI / 2, s = Math.sin(ph) * R; o.push({ x: p.x + cb * s, y: p.y + sb * s, h: Math.cos(ph) * H }); } return o; };
const seg3 = (p1, q1, p2, q2) => { const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, h: q1.h - p1.h }, d2 = { x: q2.x - p2.x, y: q2.y - p2.y, h: q2.h - p2.h }, r = { x: p1.x - p2.x, y: p1.y - p2.y, h: p1.h - p2.h };
  const A = d1.x * d1.x + d1.y * d1.y + d1.h * d1.h, E = d2.x * d2.x + d2.y * d2.y + d2.h * d2.h, F = d2.x * r.x + d2.y * r.y + d2.h * r.h, C = d1.x * r.x + d1.y * r.y + d1.h * r.h, B = d1.x * d2.x + d1.y * d2.y + d1.h * d2.h, dn = A * E - B * B;
  let s = dn > 1e-12 ? Math.min(1, Math.max(0, (B * F - C * E) / dn)) : 0; let t = E > 1e-12 ? Math.min(1, Math.max(0, (B * s + F) / E)) : 0;
  if (t <= 0 || t >= 1) { t = Math.min(1, Math.max(0, t)); s = Math.min(1, Math.max(0, A > 1e-12 ? (B * t - C) / A : 0)); }
  const pa = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, h: p1.h + d1.h * s }, pb = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, h: p2.h + d2.h * t };
  return { s, t, dist: Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.h - pa.h), pa, pb }; };
const contactOf = (A, p) => { const V = [0, 1, 2].map(j => arcPts(p, j)); let best = null;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let a = 0; a < NSEG; a++) for (let b = 0; b < NSEG; b++) { const c = seg3(A[i][a], A[i][a + 1], V[j][b], V[j][b + 1]); if (!best || c.dist < best.dist) best = { ...c, i, j, a, b }; }
  const phi = (best.b + best.t) * 90 / NSEG, step = 90 / NSEG;
  return { ...best, phi, onVertex: Math.abs(phi - Math.round(phi / step) * step) < VTOL }; };
const tr = TC.sweep(pieces, att, pv, dir, K);
const runs = { before: [], after: [] };
console.log('   k    deg   BEFORE the push          AFTER the push');
console.log('                phi      pair  vtx       phi      pair  vtx');
for (let k = 1; k <= K; k++) {
  const st = tr[k - 1]; if (!st.pushes.length) continue;
  const A = [0, 1, 2].map(i => arcPts(st.att, i));
  const b4 = contactOf(A, k === 1 ? pieces[victim] : tr[k - 2].pose), af = contactOf(A, st.pose);
  if (b4.onVertex) runs.before.push(k);
  if (af.onVertex) runs.after.push(k);
  const deg = k * TC.LIM_SUB / DEG;
  if (deg >= 22 && deg <= 36) console.log(`  ${String(k).padStart(3)} ${deg.toFixed(2).padStart(6)}   ${b4.phi.toFixed(6).padStart(10)} (${b4.i},${b4.j})${b4.a},${b4.b}  ${b4.onVertex ? 'V' : ' '}    ${af.phi.toFixed(6).padStart(10)} (${af.i},${af.j})${af.a},${af.b}  ${af.onVertex ? 'V' : ' '}`);
}
const spanOf = a => (a.length ? `${a[0]}..${a[a.length - 1]} (${a.length} substeps${a.length === a[a.length - 1] - a[0] + 1 ? '' : ', WITH GAPS'})` : 'none');
console.log(`\n  vertex run before the push: ${spanOf(runs.before)}`);
console.log(`  vertex run after  the push: ${spanOf(runs.after)}`);
