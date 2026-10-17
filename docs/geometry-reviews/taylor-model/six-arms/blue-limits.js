// For each blue arm: the largest target the engine executes in full (no limit hit), by bisection, and what
// happens beyond it. The 3 degree-call probe in arms.js finds a limit that is a multiple of 0.375 degrees;
// the engine's own plan application (applyPlanSearch) runs finer partial calls and goes further.
//   node blue-limits.js
const { createEngine } = require(require('path').join(__dirname, '../../../../nn/engine.js'));
const eng = createEngine();
const SEED = [-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442];
const STEP = 3 * Math.PI / 180;
function play(bp, bd, alphaDeg) {
  const G = eng.newGame(); const [B, R] = G.pieces;
  B.x = SEED[0]; B.y = SEED[1]; B.rot = SEED[2]; R.x = SEED[3]; R.y = SEED[4]; R.rot = SEED[5]; G.active = 0;
  const target = alphaDeg * Math.PI / 180;
  eng.pinFoot(bp);
  let guard = 0;
  while (!G.atLimit && Math.abs(G.netRad) < target && guard++ < 5000) {
    const rem = target - Math.abs(G.netRad);
    eng.applySwing(bd * Math.min(STEP, rem));
  }
  return { reached: !G.atLimit, net: Math.abs(G.netRad) * 180 / Math.PI, reason: G.limitReason, over: R.anyFootOff() };
}
const arms = [[0, -1, 63.375], [0, 1, 44.25], [1, -1, 16.5], [1, 1, 14.625], [2, -1, 15.75], [2, 1, 4.875]];
for (const [bp, bd, L] of arms) {
  let lo = L, hi = L + 0.4;
  const a = play(bp, bd, L), b = play(bp, bd, hi);
  for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi); (play(bp, bd, m).reached ? (lo = m) : (hi = m)); }
  const beyond = play(bp, bd, L + 0.4);
  console.log(`arm (${bp},${bd > 0 ? '+' : '-'}) engine limit ${L}: target L reached=${a.reached}; largest fully executed target B = ${lo.toFixed(9)} (L + ${(lo - L).toFixed(6)}); beyond: stops at ${beyond.net.toFixed(6)} reason ${beyond.reason}; red pushed off by then: ${beyond.over}`);
}
