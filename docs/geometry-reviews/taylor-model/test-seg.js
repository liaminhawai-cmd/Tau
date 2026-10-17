// Is segDist3Lower (the lower bound used to screen contact candidates) ever above the true distance
// between two segments? Compared with a dense brute-force minimum over both segments on random pairs,
// a third of them nearly parallel and a third nearly touching.   node test-seg.js [pairs=20000]
'use strict';
const P = require('./push-tm.js');
const pairs = +(process.argv[2] || 20000);
let seed = 4242; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const uni = (a, b) => a + (b - a) * rnd();
const pt = () => ({ x: uni(-30, 30), y: uni(-30, 30), h: uni(0, 23) });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: a.h + (b.h - a.h) * t });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.h - b.h);
function brute(p1, q1, p2, q2) {
  // minimise |P(s) - Q(t)| over [0,1]^2: coarse grid, then ternary refinement of each variable (the squared distance is convex)
  let best = Infinity;
  const inner = s => { let lo = 0, hi = 1; for (let k = 0; k < 60; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (dist(lerp(p1, q1, s), lerp(p2, q2, m1)) < dist(lerp(p1, q1, s), lerp(p2, q2, m2))) hi = m2; else lo = m1; } return dist(lerp(p1, q1, s), lerp(p2, q2, 0.5 * (lo + hi))); };
  let lo = 0, hi = 1; for (let k = 0; k < 60; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (inner(m1) < inner(m2)) hi = m2; else lo = m1; }
  best = inner(0.5 * (lo + hi));
  return Math.min(best, inner(0), inner(1));
}
let worst = -Infinity, n = 0, tight = 0;
for (let i = 0; i < pairs; i++) {
  const p1 = pt(), q1 = pt(); let p2 = pt(), q2 = pt();
  const kind = i % 3;
  if (kind === 1) { const d = { x: q1.x - p1.x, y: q1.y - p1.y, h: q1.h - p1.h }; const o = pt(); p2 = o; q2 = { x: o.x + d.x * uni(0.5, 1.5) + uni(-1e-3, 1e-3), y: o.y + d.y * uni(0.5, 1.5) + uni(-1e-3, 1e-3), h: o.h + d.h * uni(0.5, 1.5) + uni(-1e-3, 1e-3) }; }
  if (kind === 2) { p2 = lerp(p1, q1, rnd()); p2 = { x: p2.x + uni(-2, 2), y: p2.y + uni(-2, 2), h: p2.h + uni(-2, 2) }; }
  const lb = P.segDist3Lower(p1, q1, p2, q2), d = brute(p1, q1, p2, q2);
  n++;
  worst = Math.max(worst, lb - d);
  if (d > 0 && lb > 0.9 * d) tight++;
}
console.log(`${n} pairs: the bound exceeded the brute-force distance by at most ${worst.toExponential(2)} (negative = never; the screen keeps FLOAT_SLACK = ${P.FLOAT_SLACK}); ${tight} pairs where it was within 10%`);
process.exit(worst > 1e-9 ? 1 : 0);
