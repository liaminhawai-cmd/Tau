// Containment check: for sample angles in a cell, the float engine's blue pose after every substep
// must lie inside at least one branch of the model at that angle.
//   node contain2.js <a0> <a1> [branch=0|1] [samples]
const { run } = require('./cert.js');
const { createEngine } = require(require('path').join(__dirname, '../../../nn/engine.js')); const eng = createEngine();
const S = [-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442];
const [a0, a1] = process.argv.slice(2, 4).map(Number); const br = +(process.argv[4] || 0), ns = +(process.argv[5] || 9);
const r = run(a0, a1, 6, br ? { push: { branch: true, tolHull: 1e-7, maxBranches: 8 } } : {});
const am = 0.5 * a0 + 0.5 * a1, ar = Math.max(a1 - am, am - a0);
let worstAll = 0, checks = 0, fails = 0;
for (let i = 0; i < ns; i++) {
  const alpha = a0 + (a1 - a0) * i / (ns - 1), t = (alpha - am) / ar;
  const G = eng.newGame(); const [B, R] = G.pieces; B.x = S[0]; B.y = S[1]; B.rot = S[2]; R.x = S[3]; R.y = S[4]; R.rot = S[5]; G.active = 0;
  eng.applyPlanSearch({ pivotIdx: 1, dir: -1, targetRad: alpha * Math.PI / 180 }); eng.pinFoot(0);
  for (let k = 1; k <= r.trace.length; k++) {
    eng.applySwing(-0.375 * Math.PI / 180);
    const branches = Array.isArray(r.trace[k - 1]) ? r.trace[k - 1] : [r.trace[k - 1]];
    let best = Infinity;
    for (const b of branches) {
      let out = 0;
      for (const [key, v] of [['x', B.x], ['y', B.y], ['rot', B.rot]]) { const e = b[key].at(t); out = Math.max(out, e[0] - v, v - e[1]); }
      best = Math.min(best, Math.max(out, 0));
    }
    checks++; if (best > 1e-9) fails++; worstAll = Math.max(worstAll, best);
  }
}
console.log(`cell [${a0}, ${a1}] branch=${br}: ${checks} substep checks over ${ns} angles, ${fails} outside by more than 1e-9, worst excess ${worstAll.toExponential(2)}; margin >= ${r.marginLo.toFixed(6)}`);
