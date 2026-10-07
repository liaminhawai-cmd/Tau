// See ./README.md.
// Falsification of the hubV push REGIME (throw-cert.analyse's hubV block, 2026-10-09): for random
// geometries where the victim's hub grazes an attacker leg, and a random victim pose box, the
// regime's interval enclosures must contain the TRUE per-pose values of the engine's own law:
//   d(p)      = |hub(p) - closest point on the attacker's leg polyline|
//   pushed(p) = d(p) < HUBLEGD,  lambda(p) = (HUBLEGD - d(p))/hf(p), translation lambda*(nx, ny)
//   hf(p)     = |w_xy|/|w|,  the bearing of w = hub - closest point
// plus the OWNERSHIP claims: the closest leg is the regime's leg for every pose in the box, and at
// a vertex-owned regime the closest point IS the vertex.
//
//   node nn/throw-audit/hubv-falsify.js [trials=3000] [samples=100]
'use strict';
const TC = require('../throw-cert.js');
const CL = require('../contact-law.js');
const CFG = CL.eng.CFG, R = CL.R, H = CFG.hubHeight, NSEG = CFG.legSegs;
const HUBLEGD = CFG.legRadius * 2.9, HF_FLOOR = 0.35;

const cosRange = a => { const [lo, hi] = a; if (hi - lo >= 2 * Math.PI) return [-1, 1]; const c0 = Math.cos(lo), c1 = Math.cos(hi); let mn = Math.min(c0, c1), mx = Math.max(c0, c1); const k0 = Math.ceil(lo / Math.PI); for (let k = k0; k * Math.PI <= hi; k++) { if (k % 2 === 0) mx = 1; else mn = -1; } return [mn, mx]; };
const sinRange = a => cosRange([a[0] - Math.PI / 2, a[1] - Math.PI / 2]);
const mulI = (a, b) => { const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]; return [Math.min(...p), Math.max(...p)]; };
const arcPts = (p, i) => { const a = p.rot + i * 2 * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a), pts = []; for (let k = 0; k <= NSEG; k++) { const ph = (k / NSEG) * Math.PI / 2, s = Math.sin(ph) * R; pts.push({ x: p.x + ca * s, y: p.y + sa * s, h: Math.cos(ph) * H }); } return pts; };
// the true closest point of the hub on a leg polyline, and the engine-law hubV push quantities
const closest = (hub, att) => {
  let best = null;
  for (let i = 0; i < 3; i++) { const arc = arcPts(att, i);
    for (let k = 0; k < NSEG; k++) { const A0 = arc[k], A1 = arc[k + 1], ux = A1.x - A0.x, uy = A1.y - A0.y, uh = A1.h - A0.h, L2 = ux * ux + uy * uy + uh * uh;
      let t = L2 > 1e-12 ? ((hub.x - A0.x) * ux + (hub.y - A0.y) * uy + (hub.h - A0.h) * uh) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const pt = { x: A0.x + t * ux, y: A0.y + t * uy, h: A0.h + t * uh, i, k, atVertex: t <= 1e-9 ? k : t >= 1 - 1e-9 ? k + 1 : -1 };
      const d = Math.hypot(hub.x - pt.x, hub.y - pt.y, hub.h - pt.h);
      if (!best || d < best.d) best = { ...pt, d };
    } }
  return best;
};

const matInv3 = M => { const [[a, b, c], [d, e, f], [g, h, i]] = M; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return null; const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g), G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d; return [[A, D, G], [B, E, H], [C, F, I]].map(r => r.map(v => v / det)); };
const matVec3 = (M, v) => [0, 1, 2].map(r => M[r][0] * v[0] + M[r][1] * v[1] + M[r][2] * v[2]);

const trials = +(process.argv[2] || 3000), samples = +(process.argv[3] || 100);
let regimes = 0, refused = 0, escapes = 0, wrongLeg = 0, vertexWrong = 0, pushes = 0, noPush = 0, pinChecks = 0, pinEscapes = 0, worst = null, worstPin = null;
for (let t = 0; t < trials; t++) {
  const att = { x: (Math.random() * 2 - 1) * 40, y: (Math.random() * 2 - 1) * 40, rot: Math.random() * 2 * Math.PI };
  const th = Math.random() * 2 * Math.PI, dd = 7 + Math.random() * 12;   // the hub-graze window
  const c = { x: att.x + Math.cos(th) * dd, y: att.y + Math.sin(th) * dd, rot: Math.random() * 2 * Math.PI };
  const hx = 0.001 + Math.random() * (process.env.WIDE ? 0.4 : 0.05), hy = 0.001 + Math.random() * (process.env.WIDE ? 0.4 : 0.05), hr = (0.01 + Math.random() * 1.5) * Math.PI / 180;
  const box = { x: [c.x - hx, c.x + hx], y: [c.y - hy, c.y + hy], rot: [c.rot - hr, c.rot + hr] };
  const pre = TC.analyse(box, att, null, true);
  if (pre.refuse) { refused++; continue; }
  const hv = pre.hubV && pre.hubV.regime;
  if (!hv) continue;   // hubV not possible this trial
  regimes++;
  for (let s = 0; s < samples; s++) {
    const vp = { x: c.x + (Math.random() * 2 - 1) * hx, y: c.y + (Math.random() * 2 - 1) * hy, rot: c.rot + (Math.random() * 2 - 1) * hr };
    const hub = { x: vp.x, y: vp.y, h: H };
    const cp = closest(hub, att);
    if (cp.i !== hv.i) { wrongLeg++; if (!worst) worst = { why: 'wrong leg', cp, hv }; continue; }
    if (hv.vertex >= 0 && !hv.straddle && cp.atVertex !== hv.vertex) { vertexWrong++; if (!worst) worst = { why: 'vertex ownership', cp, hv }; }
    // containment: d in the regime's distance interval
    if (cp.d < hv.d[0] - 1e-9 || cp.d > hv.d[1] + 1e-9) { escapes++; if (!worst) worst = { why: 'd escape', cp, hv }; continue; }
    const wX = hub.x - cp.x, wY = hub.y - cp.y, wH = hub.h - cp.h, L = cp.d, hfT = Math.hypot(wX, wY) / L;
    if (hfT < hv.hf[0] - 1e-9 || hfT > hv.hf[1] + 1e-9) { escapes++; if (!worst) worst = { why: 'hf escape', cp, hv }; continue; }
    if (cp.d >= HUBLEGD || hfT < HF_FLOOR) { noPush++; continue; }   // not pushed, or the law's floored branch (refused upstream)
    pushes++;
    const lam = (HUBLEGD - cp.d) / hfT, nx = (wX / Math.hypot(wX, wY)), ny = (wY / Math.hypot(wX, wY));
    const dX = mulI(hv.lam, cosRange(hv.psi)), dY = mulI(hv.lam, sinRange(hv.psi));
    if (lam < hv.lam[0] - 1e-9 || lam > hv.lam[1] + 1e-9) { escapes++; if (!worst) worst = { why: 'lambda escape', cp, hv, lam }; }
    if (lam * nx < dX[0] - 1e-9 || lam * nx > dX[1] + 1e-9 || lam * ny < dY[0] - 1e-9 || lam * ny > dY[1] + 1e-9) { escapes++; if (!worst) worst = { why: 'translation escape', cp, hv, lam, nx, ny }; }
  }
  // DIRECT REBUILT-STATE FALSIFICATION (Copilot's method, maths/5.log): the shell pin must contain
  // every sampled pose's engine post-push state -- not just the regime's d/hf/lambda intervals.
  if ((hv.vertex >= 0 && !hv.straddle) || (hv.vertex < 0 && hv.seg)) {
    if (hv.d[1] < HUBLEGD) {
      const qc0 = { x: (box.x[0] + box.x[1]) / 2, y: (box.y[0] + box.y[1]) / 2, rot: (box.rot[0] + box.rot[1]) / 2 };
      const qcNext = { ...qc0 };
      const pc = TC.pushSubstep(att, qcNext);   // pushSubstep mutates qcNext in place to the post-push pose
      const hp = pc.pushes.filter(pu => pu.kind === 'hubV');
      if (hp.length && hp.length === pc.pushes.length && hp.every(pu => pu.i === hv.i)) {
        const dcx = hp.reduce((s, pu) => s + pu.lambda * pu.nx, 0), dcy = hp.reduce((s, pu) => s + pu.lambda * pu.ny, 0);
        const ps = TC.hubVPinnedState(hv, qc0, qcNext, box, dcx, dcy);
        const Mi = ps && matInv3(ps.M);
        if (Mi) {
          for (let t = 0; t < samples; t++) {
            const vp = { x: box.x[0] + Math.random() * (box.x[1] - box.x[0]), y: box.y[0] + Math.random() * (box.y[1] - box.y[0]), rot: box.rot[0] + Math.random() * (box.rot[1] - box.rot[0]) };
            const pr = TC.pushSubstep(att, vp);   // vp mutated in place to the post-push pose
            const kinds = new Set(pr.pushes.map(pu => pu.kind));
            if (kinds.has('leg') || kinds.has('hubA') || kinds.has('hubhub')) continue;   // mixed: not the hubV-only pin's claim
            if (pr.pushes.some(pu => pu.kind === 'hubV' && pu.i !== hv.i)) continue;
            const u = matVec3(Mi, [vp.x - qcNext.x, vp.y - qcNext.y, vp.rot - qcNext.rot]);
            let ok = true;
            for (let r = 0; r < 3; r++) if (u[r] < ps.U[r][0] - 1e-9 || u[r] > ps.U[r][1] + 1e-9) ok = false;
            pinChecks++; if (!ok) { pinEscapes++; if (!worstPin) worstPin = { u, U: ps.U, vp, opp: pv.opp, hv: { vertex: hv.vertex, d: hv.d.map(v => +v.toFixed(5)) } }; }
          }
        }
      }
    }
  }
}
console.log(`hubV regime falsification: ${trials} trials x ${samples} samples; ${regimes} regimes (of which ${refused} refused ownership), ${pushes} pushed poses, ${noPush} clear/floored poses`);
console.log(`  escapes (a true value outside its interval): ${escapes}; wrong-leg poses: ${wrongLeg}; vertex-ownership violations: ${vertexWrong}`);
console.log(`  rebuilt-state pin checks: ${pinChecks}; pin escapes: ${pinEscapes}`);
if (worstPin) console.log(`  first pin escape: u ${worstPin.u.map(v => +v.toExponential(3))} vs U ${JSON.stringify(worstPin.U.map(iv => iv.map(v => +v.toExponential(3))))} (regime vertex ${worstPin.hv.vertex}, d ${worstPin.hv.d})`);
if (worst) console.log(`  first violation: ${worst.why} ${JSON.stringify(worst.cp && { i: worst.cp.i, k: worst.cp.k, d: +worst.cp.d.toFixed(4) })} vs regime ${JSON.stringify(worst.hv && { i: worst.hv.i, vertex: worst.hv.vertex, d: worst.hv.d.map(v => +v.toFixed(4)) })}`);
console.log(escapes === 0 && wrongLeg === 0 && vertexWrong === 0 && pinEscapes === 0 ? 'PASS' : 'FAIL');
process.exit(escapes === 0 && wrongLeg === 0 && vertexWrong === 0 && pinEscapes === 0 ? 0 : 1);
