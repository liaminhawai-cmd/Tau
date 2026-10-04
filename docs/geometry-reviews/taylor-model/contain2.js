// Containment check for cert2: replay the shipped engine (float) at sample stop angles inside a cell
// and require its poses to lie inside the model:
//   - red's pose after blue's reply (phase A) inside one of the model's red branches, and
//   - blue's pose after every one of red's 123 substeps (phase B) inside a branch of that red
//     branch's phase B states.
// The engine's own substeps are reproduced one call at a time: a full call of 8 substeps of DELTA
// is 8 calls of DELTA, and the partial call's m substeps are m calls of r/m (each is one substep).
//   node contain2.js <bluePivot> <blueDir> <a0> <a1> [mode=plain|straddle|branch] [samples=5]
'use strict';
const path = require('path');
const { run2, regimes, DELTA, STEP3, STEP_MAX, K_RED } = require('./cert2.js');
const { createEngine } = require(path.join(__dirname, '../../../nn/engine.js'));
const { MODES } = require('./modes2.js');
const eng = createEngine();
const SEED = [-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442];

function containment(bp, bd, a0, a1, mode = 'plain', ns = 5, deg = 6) {
  const m = MODES.find(x => x[0] === mode);
  const r = run2(bp, bd, a0, a1, deg, { push: m ? m[2] : {}, keepTrace: true });
  const am = 0.5 * a0 + 0.5 * a1, ar = Math.max(a1 - am, am - a0);
  let checks = 0, fails = 0, worst = 0; const bad = [];
  for (let i = 0; i < ns; i++) {
    const alpha = a0 + (a1 - a0) * i / Math.max(1, ns - 1), t = (alpha - am) / ar;
    // which regime the engine follows at this alpha
    const A = alpha * Math.PI / 180;
    let j = Math.floor(A / STEP3); let rr = A - j * STEP3;
    if (rr <= 1e-12 && j > 0) { j -= 1; rr = STEP3; }
    const mm = Math.max(1, Math.ceil(rr / STEP_MAX - 1e-12));
    const G = eng.newGame(); const [B, R] = G.pieces;
    B.x = SEED[0]; B.y = SEED[1]; B.rot = SEED[2]; R.x = SEED[3]; R.y = SEED[4]; R.rot = SEED[5]; G.active = 0;
    eng.pinFoot(bp);
    for (let k = 0; k < 8 * j; k++) eng.applySwing(bd * DELTA);
    for (let k = 0; k < mm; k++) eng.applySwing(bd * (rr / mm));
    const red0 = [R.x, R.y, R.rot];
    const items = r.trace.items.filter(it => it.j === j && it.m === mm);
    if (!items.length) { fails++; bad.push(`alpha ${alpha}: regime (${j},${mm}) not modelled`); continue; }
    const inside = (tm, v) => { const e = tm.at(t); return Math.max(e[0] - v, v - e[1], 0); };
    // red branch that contains the engine's red pose
    let found = null;
    for (const it of items) {
      for (let b = 0; b < it.red.length; b++) {
        const o = Math.max(inside(it.red[b].x, red0[0]), inside(it.red[b].y, red0[1]), inside(it.red[b].rot, red0[2]));
        checks += 3;
        if (o <= 1e-9 && !found) found = { it, b };
        worst = Math.max(worst, Math.min(o, 1e9));
      }
    }
    if (!found) { fails++; bad.push(`alpha ${alpha}: red pose after reply outside every red branch`); continue; }
    worst = 0;
    eng.endTurn();                        // blue's turn ends, red becomes active (the engine's own handoff)
    if (G.over) { fails++; bad.push(`alpha ${alpha}: game over after blue's reply`); continue; }
    eng.pinFoot(0);
    for (let k = 1; k <= K_RED; k++) {
      eng.applySwing(-DELTA);
      const branches = found.it.B[found.b][k - 1];
      let best = Infinity;
      for (const bs of branches) {
        let out = 0;
        for (const [key, v] of [['x', B.x], ['y', B.y], ['rot', B.rot]]) out = Math.max(out, inside(bs[key], v));
        best = Math.min(best, out);
      }
      checks += 3; if (best > 1e-9) { fails++; if (bad.length < 3) bad.push(`alpha ${alpha}: blue outside the model after red substep ${k} by ${best.toExponential(2)}`); }
      worst = Math.max(worst, Math.min(best, 1e9));
    }
  }
  return { margin: r.marginLo, checks, fails, bad, worst, regimes: r.regimes, redBranches: r.redBranches };
}
module.exports = { containment };

if (require.main === module) {
  const [bp, bd, a0, a1] = process.argv.slice(2, 6).map(Number);
  const mode = process.argv[6] || 'plain', ns = +(process.argv[7] || 5);
  try {
    const c = containment(bp, bd, a0, a1, mode, ns, +(process.env.DEG || 4));
    console.log(`arm (${bp},${bd}) cell [${a0}, ${a1}] ${mode}: margin >= ${c.margin.toFixed(5)}; ${c.checks} comparisons at ${ns} angles, ${c.fails} outside; worst excess ${c.worst.toExponential(2)}${c.bad.length ? ' | ' + c.bad.join(' ; ') : ''}`);
  } catch (e) { console.log(`arm (${bp},${bd}) cell [${a0}, ${a1}] ${mode}: model stopped: ${e.message.slice(0, 120)}`); }
}
