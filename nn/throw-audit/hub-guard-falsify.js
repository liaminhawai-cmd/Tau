// See ./README.md.
// Falsification of the TIGHT hub guards in throw-cert.analyse (2026-10-07): the interval
// point-to-segment lower bound hubLegLB and the exact point-to-rectangle hubHubMin.
//
//   node nn/throw-audit/hub-guard-falsify.js [trials=1500] [samples=150]
//
// Two claims are attacked per trial, on a random near-contact geometry and a random victim box:
//   CONTAINMENT (soundness): the claimed lower bounds never exceed the true minimum over the box,
//     estimated by brute sampling (violation would make the guard unsound);
//   NO FALSE PASS (completeness of the pass): when analyse does NOT refuse on hub-leg, no sampled
//     pose in the box actually has a hub-leg distance under HUBLEGD (or hub-hub under 2*HUBR).
// The probe also reports the median claimed-vs-sampled gap, the tightness the fix bought over
// the old centre-minus-pad bound.
'use strict';
const TC = require('../throw-cert.js');
const CL = require('../contact-law.js');
const CFG = CL.eng.CFG, R = CL.R, H = CFG.hubHeight, NSEG = CFG.legSegs;
const HUBLEGD = CFG.legRadius * 2.9, HUBR = CFG.legRadius * 1.9;

const arcPts = (p, i) => { const a = p.rot + i * 2 * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a), o = []; for (let k = 0; k <= NSEG; k++) { const ph = (k / NSEG) * Math.PI / 2, s = Math.sin(ph) * R; o.push({ x: p.x + ca * s, y: p.y + sa * s, h: Math.cos(ph) * H }); } return o; };
const ptSeg = (p, a, b) => { const ux = b.x - a.x, uy = b.y - a.y, uh = b.h - a.h, wx = p.x - a.x, wy = p.y - a.y, wh = p.h - a.h;
  const L2 = ux * ux + uy * uy + uh * uh; let t = L2 > 1e-12 ? (wx * ux + wy * uy + wh * uh) / L2 : 0; t = Math.max(0, Math.min(1, t));
  const fx = a.x + t * ux, fy = a.y + t * uy, fh = a.h + t * uh;
  return Math.hypot(p.x - fx, p.y - fy, p.h - fh); };
// the true hub-leg distance of a pose pair, both directions, exactly the quantity the engine tests
const trueHubLeg = (att, vic) => { let m = Infinity;
  const aH = { x: att.x, y: att.y, h: H }, vH = { x: vic.x, y: vic.y, h: H };
  for (let j = 0; j < 3; j++) { const arc = arcPts(vic, j); for (let k = 0; k < NSEG; k++) { const d = ptSeg(aH, arc[k], arc[k + 1]); if (d < m) m = d; } }
  for (let i = 0; i < 3; i++) { const arc = arcPts(att, i); for (let k = 0; k < NSEG; k++) { const d = ptSeg(vH, arc[k], arc[k + 1]); if (d < m) m = d; } }
  return m; };
const trueHubHub = (att, vic) => Math.hypot(att.x - vic.x, att.y - vic.y);

const trials = +(process.argv[2] || 1500), samples = +(process.argv[3] || 150);
let badContain = 0, falsePass = 0, gaps = [], passed = 0, refused = 0, worst = null;
for (let t = 0; t < trials; t++) {
  const att = { x: (Math.random() * 2 - 1) * 40, y: (Math.random() * 2 - 1) * 40, rot: Math.random() * 2 * Math.PI };
  // GRAZE=1 puts the victim centre where its legs graze the attacker's hub: the attacker hub is at
  // height H and a leg point at arc angle ph has height cos(ph)*H and horizontal reach sin(ph)*R, so
  // hub-leg distances near the 4.18 threshold occur at horizontal offsets around sin(0.6)*R ~ 13u
  // -- the window [7,19], exercising the REFUSING side of the guard; the default 2R+ regime keeps
  // hub-leg well clear (exercising the PASSING side).
  const th = Math.random() * 2 * Math.PI, dd = process.env.GRAZE ? (7 + Math.random() * 12) : (2 * R + 2.9 + Math.random() * 8);
  const c = { x: att.x + Math.cos(th) * dd, y: att.y + Math.sin(th) * dd, rot: Math.random() * 2 * Math.PI };
  const hx = 0.005 + Math.random() * 0.4, hy = 0.005 + Math.random() * 0.4, hr = (0.01 + Math.random() * 1.5) * Math.PI / 180;
  const box = { x: [c.x - hx, c.x + hx], y: [c.y - hy, c.y + hy], rot: [c.rot - hr, c.rot + hr] };
  const res = TC.analyse(box, att, null);
  const lb = res.hubLegLB, hh = res.hubHubMin;
  if (!(lb <= HUBLEGD)) passed++; else refused++;
  let sMin = Infinity, sHH = Infinity;
  for (let s = 0; s < samples; s++) {
    const u1 = Math.random() * 2 - 1, u2 = Math.random() * 2 - 1, u3 = Math.random() * 2 - 1;
    const vp = { x: c.x + u1 * hx, y: c.y + u2 * hy, rot: c.rot + u3 * hr };
    const hl = trueHubLeg(att, vp); if (hl < sMin) sMin = hl;
    const h2 = trueHubHub(att, vp); if (h2 < sHH) sHH = h2;
  }
  // CONTAINMENT: claimed lower bound must not exceed the sampled true minimum (small slack for sampling noise)
  if (lb > sMin + 1e-9) { badContain++; if (!worst || lb - sMin > worst.d) worst = { d: lb - sMin, lb, sMin, box, att: { ...att } }; }
  if (hh > sHH + 1e-9) badContain++;
  // NO FALSE PASS: a pass claims the whole box is clear; a sampled contact refutes it
  if (lb >= HUBLEGD && sMin < HUBLEGD - 1e-9) falsePass++;
  if (hh >= 2 * HUBR && sHH < 2 * HUBR - 1e-9) falsePass++;
  if (Number.isFinite(sMin)) gaps.push(sMin - lb);
}
gaps.sort((a, b) => a - b);
const med = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
console.log(`hub-guard falsification: ${trials} trials x ${samples} samples, ${passed} guard-pass / ${refused} guard-refuse`);
console.log(`  containment violations (LB > sampled true min): ${badContain}   false passes (guard passed but a sampled pose contacts): ${falsePass}`);
if (med != null) console.log(`  tightness: median slack of the LB under the sampled minimum ${med.toFixed(4)}u (p90 ${gaps[Math.floor(gaps.length * 0.9)].toFixed(4)}u, max ${gaps[gaps.length - 1].toFixed(4)}u)`);
if (worst) console.log(`  worst containment violation: LB ${worst.lb.toFixed(4)} vs sampled ${worst.sMin.toFixed(4)} at box ${JSON.stringify(worst.box)}`);
console.log(badContain === 0 && falsePass === 0 ? 'PASS' : 'FAIL');
process.exit(badContain === 0 && falsePass === 0 ? 0 : 1);
