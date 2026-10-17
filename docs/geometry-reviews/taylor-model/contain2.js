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
const { run2, regimes, DELTA, STEP3, STEP_MAX } = require('./cert2.js');
const { fromEnv } = require('./problem.js');
const { createEngine } = require(path.join(__dirname, '../../../nn/engine.js'));
const { MODES } = require('./modes2.js');
const eng = createEngine();

function containment(bp, bd, a0, a1, mode = 'plain', ns = 5, deg = 6) {
  const m = MODES.find(x => x[0] === mode);
  const pr = fromEnv();
  if (pr.firstMover !== 0) throw new Error('contain2.js supports firstMover 0 (blue moves first) only; got ' + pr.firstMover);
  const SEED = [pr.seed.blue.x, pr.seed.blue.y, pr.seed.blue.rot, pr.seed.red.x, pr.seed.red.y, pr.seed.red.rot];
  const KRED = pr.kRed, WIT = pr.witness;
  // SYMREM=1 / VTX=1: the cell was proved with remainders moved into symbols / with a hub on a vertex counted once
  const base = { ...(process.env.SYMREM ? { symRem: true } : {}), ...(process.env.VTX ? { vertexDedup: true } : {}) };
  const r = run2(bp, bd, a0, a1, deg, { push: { ...base, ...(m ? m[2] : {}) }, keepTrace: true, problem: pr });
  const am = 0.5 * a0 + 0.5 * a1, ar = Math.max(a1 - am, am - a0);
  let checks = 0, fails = 0, worst = 0, skipped = 0; const bad = [];
  for (let i = 0; i < ns; i++) {
    const alpha = a0 + (a1 - a0) * i / Math.max(1, ns - 1), t = (alpha - am) / ar;
    // blue's reply exactly as the engine's plan application plays it: full 3 degree calls, then one call
    // for the remainder (the engine splits it into substeps itself; at a boundary between two partial
    // schedules float rounding decides which, so any regime of the same j may be the one it followed)
    const A = alpha * Math.PI / 180, target = A;
    const G = eng.newGame(); const [B, R] = G.pieces;
    B.x = SEED[0]; B.y = SEED[1]; B.rot = SEED[2]; R.x = SEED[3]; R.y = SEED[4]; R.rot = SEED[5]; G.active = pr.firstMover;
    eng.pinFoot(bp);
    let guard = 0, fullCalls = 0;
    while (!G.atLimit && Math.abs(G.netRad) < target && guard++ < 5000) {
      const rem = target - Math.abs(G.netRad);
      if (rem >= STEP3) fullCalls++;
      eng.applySwing(bd * Math.min(STEP3, rem));
    }
    // a target past the largest one the engine executes in full is cut short at the last legal substep: that
    // play is the play for its own, smaller, final angle (covered by another cell), not one for this alpha
    if (G.atLimit) { skipped++; continue; }
    const j = fullCalls;
    const red0 = [R.x, R.y, R.rot];
    const items = r.trace.items.filter(it => it.j === j || it.j === j - 1);
    if (!items.length) { fails++; bad.push(`alpha ${alpha}: no regime with ${j} full calls modelled`); continue; }
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
    eng.pinFoot(WIT.pivot);
    for (let k = 1; k <= KRED; k++) {
      eng.applySwing(WIT.dir * DELTA);
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
  return { margin: r.marginLo, checks, fails, bad, worst, skipped, regimes: r.regimes, redBranches: r.redBranches };
}
module.exports = { containment };

if (require.main === module) {
  const [bp, bd, a0, a1] = process.argv.slice(2, 6).map(Number);
  const mode = process.argv[6] || 'plain', ns = +(process.argv[7] || 5);
  try {
    const c = containment(bp, bd, a0, a1, mode, ns, +(process.env.DEG || 4));
    console.log(`arm (${bp},${bd}) cell [${a0}, ${a1}] ${mode}: margin >= ${c.margin.toFixed(5)}; ${c.checks} comparisons at ${ns - c.skipped} angles${c.skipped ? ` (${c.skipped} beyond the engine's limit skipped)` : ''}, ${c.fails} outside; worst excess ${c.worst.toExponential(2)}${c.bad.length ? ' | ' + c.bad.join(' ; ') : ''}`);
  } catch (e) { console.log(`arm (${bp},${bd}) cell [${a0}, ${a1}] ${mode}: model stopped: ${e.message.slice(0, 120)}`); }
}
