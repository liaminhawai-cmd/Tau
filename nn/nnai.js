// The NN brain: for every (pivot × direction) the swing is simulated ONCE through the real engine
// all the way to its natural limit, and every ~3° step along the way is evaluated as a candidate
// stop — the sweep passes through every legal stopping angle anyway, so dense sampling is nearly
// free (the physics stepping is the cost; a 5k-parameter forward pass is not). This replaced the
// old fixed stop-fractions [1, 0.7, 0.45, 0.22]: those re-simulated the same arc five times to
// evaluate only four stops, and a subtle move between two fractions simply could not be played.
//
// Selection prefers STABLE maxima: each waypoint's score is averaged with its immediate
// neighbours (±1 step ≈ ±3°), so a wide plateau of good keeps its height while a one-waypoint
// needle gets pulled down. The evaluator is a small net — an isolated spike of "good" flanked by
// "bad" is more likely eval noise than a real tactical needle. The exception is a THROW, which
// the engine detects exactly (not the net): throws bypass smoothing entirely, are never blended
// into a non-throw neighbour's average (stopping just short of a throw must not inherit its
// score), and are never diced away by temperature.
//
// Same { pivotIdx, dir, targetRad } plan shape as every ladder brain, so the arena and the game
// can swap it in anywhere. `temperature` softens the argmax into a softmax pick — that's the
// whole adaptive-difficulty dial, one number, monotone by construction. (With dense waypoints a
// plateau contributes several near-identical high-weight entries, so exploration mass leans
// toward stable regions — intended.)
'use strict';
const { features } = require('./features.js');

const STEP_RAD = 3*Math.PI/180;      // the engine brains' own sampling step
const CAP_RAD = 170*Math.PI/180;     // same safety cap as every other brain
const MIN_MOVE = 2*Math.PI/180;      // below this the engine would undo the turn as a non-move

function nnPlanFor(eng, net, idx, opts) {
  const o = opts || {};
  const G = eng.getG();
  if (G.active !== idx) throw new Error('nnPlanFor called for the wrong side');
  const snap = eng.takeSnap();
  const restore = () => {
    const g = eng.getG();
    g.pieces.forEach((p, i) => { p.x = snap[i].x; p.y = snap[i].y; p.rot = snap[i].rot; });
    g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
    g.pinned = null; g.pivot = null;
  };
  const cands = [];
  for (let pv = 0; pv < 3; pv++) {
    for (const dir of [1, -1]) {
      eng.pinFoot(pv);
      const arm = [];   // this arm's waypoints, in sweep order (smoothing needs adjacency)
      let guard = 0;
      while (!eng.getG().atLimit && Math.abs(eng.getG().netRad) < CAP_RAD && guard++ < 200) {
        eng.applySwing(dir*STEP_RAD);
        const g = eng.getG();
        const rad = g.netRad;                       // signed; applyPlan abs()es it, dir carries sign
        if (Math.abs(rad) < MIN_MOVE) { if (g.atLimit) break; continue; }
        let v;
        const oppOff = g.pieces[1 - idx].feet().some(f => Math.hypot(f.x, f.y) > eng.CFG.edgeU + eng.CFG.edgeEps);
        if (oppOff) v = 1e6 - Math.abs(rad)*1e-3;   // a throw — engine-exact; shortest one wins
        else {
          g.active = 1 - idx;                       // value from the opponent-to-move view
          v = -net.value(features(eng));
          g.active = idx;
        }
        arm.push({ pivotIdx: pv, dir, targetRad: rad, v });
      }
      restore();
      // plateau-vs-needle smoothing, throws and non-throws never blended across the boundary
      for (let i = 0; i < arm.length; i++) {
        const w = arm[i], isThrow = w.v >= 1e5;
        if (isThrow) { w.s = w.v; cands.push(w); continue; }
        let sum = w.v, n = 1;
        if (i > 0 && arm[i-1].v < 1e5) { sum += arm[i-1].v; n++; }
        if (i + 1 < arm.length && arm[i+1].v < 1e5) { sum += arm[i+1].v; n++; }
        w.s = sum/n;
        cands.push(w);
      }
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.s - a.s);
  const temp = o.temperature || 0;
  if (temp > 1e-6 && cands[0].v < 1e5) {            // never dice away a clean throw
    const mx = cands[0].s;
    const ws = cands.map(c => Math.exp((c.s - mx)/temp));
    let r = Math.random()*ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) { r -= ws[i]; if (r <= 0) return cands[i]; }
  }
  return cands[0];
}

module.exports = { nnPlanFor };
