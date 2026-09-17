// The contact law as a continuous function, checked against the engine.
//
//   node nn/contact-law.js [events=200] [events.json]
//
// WHAT IT CLAIMS. The mover rotates rigidly about the pinned foot. The pushed piece is a free
// planar rigid body (m = 1, I = inertiaK * R^2) that at every instant takes the LEAST motion, in
// the metric m|v|^2 + I w^2, that keeps every tube-tube gap >= 2*rho (Gauss's principle of least
// constraint). For one contact that is closed-form: with n the horizontal unit normal, hf its
// horizontal fraction, r the contact point from the pushed hub and rn = r x n,
//     slide = lambda * n / m,  spin = lambda * rn / I,  lambda = (gap / hf) / (1/m + rn^2 / I)
// -- spin fraction rn^2 / (I + rn^2): a hub push slides, a foot push (rn ~ R) spins 59%. No
// restitution (the pushed piece stops when the push stops) and no tangential friction (legs slide
// freely along each other). Integrated at a fine step with no correction cap, no horizontal-
// fraction floor, no crossing shove and fine arcs, that is the IDEAL law; with the engine's knobs
// (0.4-degree substeps, 12-segment arcs, 10 Gauss-Seidel iterations, 0.8u cap per iteration, hf
// floored at 0.35, the deep-crossing shove) the same code is the REPLICA.
//
// MEASURED (200 contact events: uniform poses, opening-ish poses, rim-biased and throw-biased ones,
// 24 of them engine throws), pushed piece's final pose against the engine's:
//     replica  0.000u / 0.000deg on all 200 -- the reimplementation is the engine, so what follows
//              is attributable knob by knob;
//     ideal    median 0.023u, p90 0.156u, max 0.63u; rotation median 0.019deg, max 1.15deg;
//              0.6% of the displacement at the median, 3.5% at p90; throws 24/24;
//     ideal + the engine's 12-segment legs: median 0.008u, p90 0.054u, max 0.16u (0.1% / 0.7%)
//     ideal + 0.4-degree step alone: max 0.75u
//     ideal + cap / + hf floor / + deep rule: identical to ideal -- none of the three fired once.
// So the law IS the engine, and the residual is the engine's polyline of a curved leg (then its
// step), not the physics: the sim approximates the ideal piece, as it should.
//
// WHAT DOES NOT HOLD STILL. Tracing the primary contact through a push: the contact point moves
// ~3 degrees along each leg at the median but 22-23 at p90 (max 64-69), and the angle between the
// legs changes 17 degrees at the median. A closed form frozen at first touch (my contact point's
// chord over the rest of the swing, projected on the normal, split by the lever arm at touch) is
// off by 11% of the displacement at the median, 48% at p90, max 16u -- right on 22/24 throws but
// not a law. The instantaneous response is closed-form; a push over a swing is an ODE in which
// frictionless tubes slide along each other. Contact lasts 51% of the swing at the median.
'use strict';
const path = require('path');
const { createEngine } = require('./engine.js');
const { randomStartPose, playRandomOpening } = require('./opening.js');

const eng = createEngine();
const CFG = eng.CFG;
const R = CFG.footR, H = CFG.hubHeight, RHO = CFG.legRadius, I = CFG.inertiaK * R * R, M = 1;
const HUBR = RHO * 1.9, MIND = 2 * RHO, HUBLEGD = HUBR + RHO;
const EDGE = CFG.edgeU + CFG.edgeEps;

// ---- the objects (the same definitions as the game's Piece, restated) ----
const feetOf = p => [0, 1, 2].map(i => { const a = p.rot + i * 2 * Math.PI / 3; return { x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R }; });
const chordsOf = p => feetOf(p).map(f => [{ x: p.x, y: p.y }, f]);
function arcsOf(p, N) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const a = p.rot + i * 2 * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a), pts = [];
    for (let k = 0; k <= N; k++) { const ph = (k / N) * Math.PI / 2, s = Math.sin(ph) * R; pts.push({ x: p.x + ca * s, y: p.y + sa * s, h: Math.cos(ph) * H }); }
    out.push(pts);
  }
  return out;
}
const rotateAround = (p, px, py, dA) => { const c = Math.cos(dA), s = Math.sin(dA), rx = p.x - px, ry = p.y - py; p.x = px + rx * c - ry * s; p.y = py + rx * s + ry * c; p.rot += dA; };
const anyOff = p => feetOf(p).some(f => Math.hypot(f.x, f.y) > EDGE);

// ---- geometry (pure) ----
function segClosest(a, b, c, d) {
  const d1 = { x: b.x - a.x, y: b.y - a.y }, d2 = { x: d.x - c.x, y: d.y - c.y }, r = { x: a.x - c.x, y: a.y - c.y };
  const A = d1.x * d1.x + d1.y * d1.y, E = d2.x * d2.x + d2.y * d2.y, F = d2.x * r.x + d2.y * r.y;
  const C = d1.x * r.x + d1.y * r.y, B = d1.x * d2.x + d1.y * d2.y, denom = A * E - B * B;
  let s = denom !== 0 ? Math.min(1, Math.max(0, (B * F - C * E) / denom)) : 0;
  let t = (B * s + F) / E;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -C / A)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (B - C) / A)); }
  const pa = { x: a.x + d1.x * s, y: a.y + d1.y * s }, pb = { x: c.x + d2.x * t, y: c.y + d2.y * t };
  return { pa, pb, dist: Math.hypot(pa.x - pb.x, pa.y - pb.y) };
}
function segClosest3(p1, q1, p2, q2) {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, h: q1.h - p1.h }, d2 = { x: q2.x - p2.x, y: q2.y - p2.y, h: q2.h - p2.h }, r = { x: p1.x - p2.x, y: p1.y - p2.y, h: p1.h - p2.h };
  const a = d1.x * d1.x + d1.y * d1.y + d1.h * d1.h, e = d2.x * d2.x + d2.y * d2.y + d2.h * d2.h;
  const f = d2.x * r.x + d2.y * r.y + d2.h * r.h, c = d1.x * r.x + d1.y * r.y + d1.h * r.h, b = d1.x * d2.x + d1.y * d2.y + d1.h * d2.h, denom = a * e - b * b;
  let s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
  let t = e > 1e-12 ? (b * s + f) / e : 0;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, a > 1e-12 ? -c / a : 0)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, a > 1e-12 ? (b - c) / a : 0)); }
  const pa = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, h: p1.h + d1.h * s }, pb = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, h: p2.h + d2.h * t };
  return { pa, pb, dist: Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.h - pa.h) };
}
function arcClosest(A, B) { let best = null; for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++) { const c = segClosest3(A[i], A[i + 1], B[j], B[j + 1]); if (!best || c.dist < best.dist) best = c; } return best; }
function pointArcClosest(p, A) {
  let best = null;
  for (let i = 0; i < A.length - 1; i++) {
    const a = A[i], b = A[i + 1], dx = b.x - a.x, dy = b.y - a.y, dh = b.h - a.h, len2 = dx * dx + dy * dy + dh * dh || 1e-12;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.h - a.h) * dh) / len2; t = Math.max(0, Math.min(1, t));
    const pt = { x: a.x + dx * t, y: a.y + dy * t, h: a.h + dh * t }, d = Math.hypot(pt.x - p.x, pt.y - p.y, pt.h - p.h);
    if (!best || d < best.dist) best = { pt, dist: d };
  }
  return best;
}

// ---- the law, with the engine's departures as knobs ----
const IDEAL   = { N: 24, stepDeg: 0.1, iters: 60, cap: Infinity, hfFloor: 1e-4, deepRule: false, tol: 1e-7 };
const REPLICA = { N: 12, stepDeg: 0.4,  iters: 10, cap: 0.8,      hfFloor: 0.35, deepRule: true,  tol: 0 };

function swing(pieces, activeIdx, pivotIdx, dir, rad, K) {
  const active = { ...pieces[activeIdx] }, opp = { ...pieces[1 - activeIdx] };
  const pivot = feetOf(active)[pivotIdx];
  const stepMax = K.stepDeg * Math.PI / 180, steps = Math.max(1, Math.ceil(rad / stepMax)), step = dir * rad / steps;
  const flags = { deep: 0, hfFloor: 0, cap: 0, multi: 0, maxContacts: 0 };
  const trace = K.trace ? [] : null;                      // per-step primary-contact geometry
  let alpha = 0;
  for (let s = 0; s < steps; s++) {
    rotateAround(active, pivot.x, pivot.y, step); alpha += Math.abs(step);
    let primary = null;                                   // deepest leg-leg contact this step
    const aArcs = arcsOf(active, K.N), aChords = chordsOf(active), aHub = { x: active.x, y: active.y, h: H };
    const opp0 = { x: opp.x, y: opp.y };
    const apply = (px, py, nx, ny, sep) => {
      if (sep > K.cap) { flags.cap++; sep = K.cap; }
      const rx = px - opp.x, ry = py - opp.y, rn = rx * ny - ry * nx, wEff = 1 / M + rn * rn / I, lambda = sep / wEff;
      opp.x += (lambda / M) * nx; opp.y += (lambda / M) * ny; opp.rot += (lambda * rn) / I;
    };
    const push3d = (pa, pb, dist, gap) => {
      const nx3 = (pb.x - pa.x) / dist, ny3 = (pb.y - pa.y) / dist, hf = Math.hypot(nx3, ny3);
      if (hf < 1e-4) return;
      if (hf < K.hfFloor) flags.hfFloor++;
      apply(pb.x, pb.y, nx3 / hf, ny3 / hf, gap / Math.max(hf, K.hfFloor));
    };
    for (let iter = 0; iter < K.iters; iter++) {
      const oArcs = arcsOf(opp, K.N), oChords = chordsOf(opp), oHub = { x: opp.x, y: opp.y, h: H };
      let any = 0, worst = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        if (segClosest(aChords[i][0], aChords[i][1], oChords[j][0], oChords[j][1]).dist >= MIND) continue;
        const c = arcClosest(aArcs[i], oArcs[j]);
        if (c.dist >= MIND) continue;
        any++; worst = Math.max(worst, MIND - c.dist);
        if (trace && iter === 0 && (!primary || MIND - c.dist > primary.pen)) {
          // where along each leg (phi: 0 = hub, pi/2 = foot), the angle between the legs, the
          // normal's horizontal fraction, and the lever arm on the pushed piece
          const sa = Math.hypot(c.pa.x - active.x, c.pa.y - active.y), sb = Math.hypot(c.pb.x - opp.x, c.pb.y - opp.y);
          const nx3 = (c.pb.x - c.pa.x) / c.dist, ny3 = (c.pb.y - c.pa.y) / c.dist, hf = Math.hypot(nx3, ny3);
          const nx = nx3 / Math.max(hf, 1e-9), ny = ny3 / Math.max(hf, 1e-9);
          const rn = (c.pb.x - opp.x) * ny - (c.pb.y - opp.y) * nx;
          const la = aChords[i], lb = oChords[j];
          const ang = v => Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x);
          let psi = ang(la) - ang(lb); psi = Math.atan2(Math.sin(psi), Math.cos(psi));
          primary = { pen: MIND - c.dist, i, j, phiA: Math.asin(Math.min(1, sa / R)), phiB: Math.asin(Math.min(1, sb / R)), psi, hf, rn, nx, ny,
                      pa: { x: c.pa.x, y: c.pa.y }, pb: { x: c.pb.x, y: c.pb.y }, alpha, opp: { x: opp.x, y: opp.y, rot: opp.rot } };
        }
        if (K.deepRule && c.dist < 0.3) {
          flags.deep++;
          const A = aChords[i], ax = A[1].x - A[0].x, ay = A[1].y - A[0].y, L = Math.hypot(ax, ay) || 1;
          let nx = -ay / L, ny = ax / L;
          if (nx * (opp0.x - c.pa.x) + ny * (opp0.y - c.pa.y) < 0) { nx = -nx; ny = -ny; }
          apply(c.pb.x, c.pb.y, nx, ny, MIND);
        } else if (c.dist < 1e-9) {
          // exactly crossed centrelines: the normal is undefined; the ideal law never gets here at a
          // fine step, and if it does, the only defined direction is off my leg's chord
          const A = aChords[i], ax = A[1].x - A[0].x, ay = A[1].y - A[0].y, L = Math.hypot(ax, ay) || 1;
          let nx = -ay / L, ny = ax / L;
          if (nx * (opp0.x - c.pa.x) + ny * (opp0.y - c.pa.y) < 0) { nx = -nx; ny = -ny; }
          apply(c.pb.x, c.pb.y, nx, ny, MIND);
        } else push3d(c.pa, c.pb, c.dist, MIND - c.dist);
      }
      for (let j = 0; j < 3; j++) { const c = pointArcClosest(aHub, oArcs[j]); if (c.dist < HUBLEGD && c.dist > 1e-6) { any++; worst = Math.max(worst, HUBLEGD - c.dist); push3d(aHub, c.pt, c.dist, HUBLEGD - c.dist); } }
      for (let i = 0; i < 3; i++) { const c = pointArcClosest(oHub, aArcs[i]); if (c.dist < HUBLEGD && c.dist > 1e-6) { any++; worst = Math.max(worst, HUBLEGD - c.dist); push3d(c.pt, oHub, c.dist, HUBLEGD - c.dist); } }
      { const dx = opp.x - active.x, dy = opp.y - active.y, d = Math.hypot(dx, dy); if (d < 2 * HUBR && d > 1e-6) { any++; worst = Math.max(worst, 2 * HUBR - d); apply(opp.x, opp.y, dx / d, dy / d, 2 * HUBR - d); } }
      if (any > 1) flags.multi++;
      flags.maxContacts = Math.max(flags.maxContacts, any);
      if (!any || worst <= K.tol) break;
    }
    if (trace && primary) trace.push(primary);
  }
  return { opp, off: anyOff(opp), flags, trace, pivot, rad };
}

// A victim parked near the rim with the attacker a leg's reach away, not touching: the poses where
// throws actually happen, which uniform poses almost never produce.
function touching(a, b) {
  const A = arcsOf(a, 12), B = arcsOf(b, 12), ca = chordsOf(a), cb = chordsOf(b);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { if (segClosest(ca[i][0], ca[i][1], cb[j][0], cb[j][1]).dist >= MIND) continue; if (arcClosest(A[i], B[j]).dist < MIND + 0.2) return true; }
  const ha = { x: a.x, y: a.y, h: H }, hb = { x: b.x, y: b.y, h: H };
  for (let j = 0; j < 3; j++) if (pointArcClosest(ha, B[j]).dist < HUBLEGD + 0.2) return true;
  for (let i = 0; i < 3; i++) if (pointArcClosest(hb, A[i]).dist < HUBLEGD + 0.2) return true;
  return Math.hypot(a.x - b.x, a.y - b.y) < 2 * HUBR + 0.2;
}
function nearRimPose(g) {
  const hubMax = CFG.edgeU - R - CFG.edgeEps;
  for (let t = 0; t < 60; t++) {
    const victim = Math.random() < 0.5 ? 0 : 1, v = g.pieces[victim], a = g.pieces[1 - victim];
    const rv = hubMax - 8 * Math.random(), av = Math.random() * 2 * Math.PI;
    v.x = rv * Math.cos(av); v.y = rv * Math.sin(av); v.rot = Math.random() * 2 * Math.PI;
    const d = 25 + 20 * Math.random(), aa = Math.random() * 2 * Math.PI;
    a.x = v.x + d * Math.cos(aa); a.y = v.y + d * Math.sin(aa); a.rot = Math.random() * 2 * Math.PI;
    if (Math.hypot(a.x, a.y) > hubMax) continue;
    if (anyOff(a) || anyOff(v)) continue;
    if (touching(a, v)) continue;
    return true;
  }
  return false;
}

// One victim foot 1-6u inside the rim, the attacker's hub 28-44u from that foot on the inward side.
function throwPose(g) {
  const hubMax = CFG.edgeU - R - CFG.edgeEps;
  for (let t = 0; t < 80; t++) {
    const victim = Math.random() < 0.5 ? 0 : 1, v = g.pieces[victim], a = g.pieces[1 - victim];
    const fr = CFG.edgeU - 1 - 5 * Math.random(), fa = Math.random() * 2 * Math.PI;   // the exposed foot
    const fx = fr * Math.cos(fa), fy = fr * Math.sin(fa);
    v.rot = Math.random() * 2 * Math.PI;                                              // foot 0 at angle rot from the hub
    v.x = fx - Math.cos(v.rot) * R; v.y = fy - Math.sin(v.rot) * R;
    if (Math.hypot(v.x, v.y) > hubMax || anyOff(v)) continue;
    const d = 28 + 16 * Math.random(), aa = fa + Math.PI + (Math.random() - 0.5) * 1.6;   // inward of the foot, +-45deg
    a.x = fx + d * Math.cos(aa); a.y = fy + d * Math.sin(aa); a.rot = Math.random() * 2 * Math.PI;
    if (Math.hypot(a.x, a.y) > hubMax || anyOff(a)) continue;
    if (touching(a, v)) continue;
    g.active = 1 - victim; return true;
  }
  return false;
}

// ---- sample contact events from the engine and compare ----
function sampleEvent() {
  eng.newGame();                                   // G is rebuilt per game: fetch it after
  const g = eng.getG();
  const u = Math.random();
  if (u < 0.25) randomStartPose(eng); else if (u < 0.45) playRandomOpening(eng, 1 + Math.floor(Math.random() * 6)); else if (u < 0.7) { if (!nearRimPose(g)) return null; } else if (!throwPose(g)) return null;
  if (u < 0.7) g.active = Math.random() < 0.5 ? 0 : 1;
  const pieces = g.pieces.map(p => ({ x: p.x, y: p.y, rot: p.rot }));
  const pv = Math.floor(Math.random() * 3), dir = Math.random() < 0.5 ? 1 : -1;
  const snap = eng.takeSnap();
  const lim = Math.abs(eng.simMoveToLimit(pv, dir));
  eng.restoreSnap(snap);
  if (lim < 3 * Math.PI / 180) return null;
  const want = lim * (0.2 + 0.8 * Math.random());
  eng.pinFoot(pv);
  eng.applySwing(dir * want);
  const rad = Math.abs(g.netRad);
  const oppE = { ...g.pieces[1 - g.active] }, offE = g.pieces[1 - g.active].feet().some(f => Math.hypot(f.x, f.y) > EDGE);
  const active = g.active;
  const before = pieces[1 - active];
  const moved = Math.hypot(oppE.x - before.x, oppE.y - before.y) + Math.abs(oppE.rot - before.rot) * R;
  eng.restoreSnap(snap);
  if (rad < 1e-6 || moved < 1e-6) return null;                  // no contact -- not an event
  return { pieces, active, pv, dir, rad, engine: { x: oppE.x, y: oppE.y, rot: oppE.rot, off: offE }, moved };
}

const N = +(process.argv[2] || 200);
const rows = [];
let tries = 0;
while (rows.length < N && tries++ < N * 50) { const ev = sampleEvent(); if (ev) rows.push(ev); }
console.log(`${rows.length} contact events from ${tries} sampled swings`);

const err = (a, b) => ({ pos: Math.hypot(a.x - b.x, a.y - b.y), rot: Math.abs(a.rot - b.rot) * 180 / Math.PI });
const summarize = (name, K) => {
  const e = [], flagsTot = { deep: 0, hfFloor: 0, cap: 0, multi: 0 }; let offAgree = 0, offE = 0, offP = 0, evFlag = { deep: 0, hfFloor: 0, cap: 0, multi: 0 };
  for (const r of rows) {
    const out = swing(r.pieces, r.active, r.pv, r.dir, r.rad, K);
    const d = err(out.opp, r.engine); d.moved = r.moved; d.flags = out.flags; e.push(d);
    if (out.off === r.engine.off) offAgree++; if (r.engine.off) offE++; if (out.off) offP++;
    for (const k of Object.keys(flagsTot)) { flagsTot[k] += out.flags[k]; if (out.flags[k]) evFlag[k]++; }
  }
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const pos = e.map(d => d.pos), rot = e.map(d => d.rot), rel = e.map(d => d.pos / Math.max(d.moved, 1e-9));
  const within = (tp, tr) => e.filter(d => d.pos <= tp && d.rot <= tr).length;
  console.log(`\n== ${name} ==  step ${K.stepDeg}deg  arcs ${K.N}  cap ${K.cap}  hfFloor ${K.hfFloor}  deepRule ${K.deepRule}`);
  console.log(`  position error (u): median ${q(pos, .5).toFixed(3)}  p90 ${q(pos, .9).toFixed(3)}  max ${q(pos, 1).toFixed(2)}   relative-to-displacement median ${(100 * q(rel, .5)).toFixed(1)}%  p90 ${(100 * q(rel, .9)).toFixed(1)}%`);
  console.log(`  rotation error (deg): median ${q(rot, .5).toFixed(3)}  p90 ${q(rot, .9).toFixed(3)}  max ${q(rot, 1).toFixed(2)}`);
  console.log(`  within 0.2u & 0.5deg: ${within(0.2, 0.5)}/${e.length}   within 0.5u & 1deg: ${within(0.5, 1)}/${e.length}   within 1u & 2deg: ${within(1, 2)}/${e.length}`);
  console.log(`  throw agreement: ${offAgree}/${e.length}  (engine throws ${offE}, predicted ${offP})`);
  console.log(`  events touching a regime: deep-crossing ${evFlag.deep}, hf<0.35 ${evFlag.hfFloor}, cap>0.8u ${evFlag.cap}, multi-contact ${evFlag.multi}`);
  return e;
};
const eRep = summarize('REPLICA (engine knobs)', REPLICA);
const eIde = summarize('IDEAL (continuous law)', IDEAL);
// attribution: ideal with ONE engine departure switched on at a time
summarize('ideal + 0.4deg step',   { ...IDEAL, stepDeg: 0.4 });
summarize('ideal + 12-seg arcs',   { ...IDEAL, N: 12 });
summarize('ideal + 0.8u cap',      { ...IDEAL, cap: 0.8 });
summarize('ideal + hf floor 0.35', { ...IDEAL, hfFloor: 0.35 });
summarize('ideal + deep rule',     { ...IDEAL, deepRule: true });
// ---- does the contact geometry hold still? and does a frozen-geometry formula predict the push? ----
{
  const q = (arr, p) => { const t = [...arr].sort((a, b) => a - b); return t[Math.min(t.length - 1, Math.floor(p * t.length))]; };
  const dPhiA = [], dPhiB = [], dPsi = [], dHf = [], dRn = [], frozenErr = [], frozenRel = [], frozenEndErr = [], contactFrac = [];
  let frozenThrowAgree = 0, nThrow = 0;
  for (const r of rows) {
    const out = swing(r.pieces, r.active, r.pv, r.dir, r.rad, { ...IDEAL, trace: true });
    const T = out.trace; if (!T || T.length < 2) continue;
    const range = f => { const v = T.map(f); return Math.max(...v) - Math.min(...v); };
    dPhiA.push(range(t => t.phiA) * 180 / Math.PI); dPhiB.push(range(t => t.phiB) * 180 / Math.PI);
    { const p0 = T[0].psi; const dev = T.map(t => { let d = t.psi - p0; return Math.atan2(Math.sin(d), Math.cos(d)); }); dPsi.push((Math.max(...dev) - Math.min(...dev)) * 180 / Math.PI); }
    dHf.push(range(t => t.hf)); dRn.push(range(t => t.rn));
    contactFrac.push(T.length * IDEAL.stepDeg * Math.PI / 180 / r.rad);
    // frozen formula from the FIRST touch: my contact point a0 rotates about the pivot for the rest
    // of the swing; the victim's point must follow its normal component, scaled 1/hf, and the
    // slide/spin split is the least-constraint one with the lever arm at first touch.
    const t0 = T[0], P = out.pivot, dirS = r.dir;
    const frozen = (alphaEnd) => {
      const dA = dirS * (alphaEnd - t0.alpha);
      const ax0 = t0.pa.x - P.x, ay0 = t0.pa.y - P.y, c = Math.cos(dA), sn = Math.sin(dA);
      const ax1 = ax0 * c - ay0 * sn, ay1 = ax0 * sn + ay0 * c;
      const chordN = ((ax1 - ax0) * t0.nx + (ay1 - ay0) * t0.ny);              // my point's travel along the normal
      const push = Math.max(0, chordN) / Math.max(t0.hf, 1e-4);
      const wEff = 1 / M + t0.rn * t0.rn / I, lambda = push / wEff;
      const o = r.pieces[1 - r.active];
      return { x: o.x + lambda * t0.nx, y: o.y + lambda * t0.ny, rot: o.rot + lambda * t0.rn / I };
    };
    const fEnd = frozen(r.rad), fContactEnd = frozen(T[T.length - 1].alpha);
    const e1 = Math.hypot(fEnd.x - out.opp.x, fEnd.y - out.opp.y), e2 = Math.hypot(fContactEnd.x - out.opp.x, fContactEnd.y - out.opp.y);
    frozenErr.push(e1); frozenRel.push(e1 / Math.max(r.moved, 1e-9)); frozenEndErr.push(e2);
    if (r.engine.off) { nThrow++; if (anyOff(fEnd)) frozenThrowAgree++; }
  }
  console.log(`\n== contact geometry during a push (${dPhiA.length} traced events) ==`);
  console.log(`  range of phi on my leg (deg):   median ${q(dPhiA, .5).toFixed(1)}  p90 ${q(dPhiA, .9).toFixed(1)}  max ${q(dPhiA, 1).toFixed(1)}`);
  console.log(`  range of phi on their leg (deg): median ${q(dPhiB, .5).toFixed(1)}  p90 ${q(dPhiB, .9).toFixed(1)}  max ${q(dPhiB, 1).toFixed(1)}`);
  console.log(`  range of leg angle psi (deg):    median ${q(dPsi, .5).toFixed(1)}  p90 ${q(dPsi, .9).toFixed(1)}  max ${q(dPsi, 1).toFixed(1)}`);
  console.log(`  range of hf:                     median ${q(dHf, .5).toFixed(3)}  p90 ${q(dHf, .9).toFixed(3)}   range of lever arm (u): median ${q(dRn, .5).toFixed(2)}  p90 ${q(dRn, .9).toFixed(2)}`);
  console.log(`  fraction of the swing in contact: median ${(100 * q(contactFrac, .5)).toFixed(0)}%  p90 ${(100 * q(contactFrac, .9)).toFixed(0)}%`);
  console.log(`== frozen-geometry formula (no integration) vs the integrated law ==`);
  console.log(`  final-pose error (u): median ${q(frozenErr, .5).toFixed(2)}  p90 ${q(frozenErr, .9).toFixed(2)}  max ${q(frozenErr, 1).toFixed(2)}   relative: median ${(100 * q(frozenRel, .5)).toFixed(0)}%  p90 ${(100 * q(frozenRel, .9)).toFixed(0)}%`);
  console.log(`  same, but stopping the formula where contact actually ended: median ${q(frozenEndErr, .5).toFixed(2)}  p90 ${q(frozenEndErr, .9).toFixed(2)}`);
  console.log(`  throws: formula agrees on ${frozenThrowAgree}/${nThrow} engine throws`);
}
// the worst ideal-vs-engine events, with what they touched
const worst = eIde.map((d, i) => ({ i, ...d })).sort((a, b) => b.pos - a.pos).slice(0, 8);
console.log('\nworst ideal-vs-engine events:');
for (const w of worst) { const r = rows[w.i]; console.log(`  #${w.i} pos err ${w.pos.toFixed(2)}u rot err ${w.rot.toFixed(2)}deg  displacement ${r.moved.toFixed(2)}u  swing ${(r.rad * 180 / Math.PI).toFixed(1)}deg  flags ${JSON.stringify(w.flags)}`); }
if (process.argv[3]) require('fs').writeFileSync(process.argv[3], JSON.stringify(rows));
