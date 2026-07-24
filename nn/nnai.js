// The NN brain: candidate moves are (pivot × direction × stop-fraction) swings simulated through
// the real engine; each resulting position is scored by the value net from the opponent's
// perspective (negamax over one ply), with terminal wins recognized exactly. Same
// { pivotIdx, dir, targetRad } plan shape as every ladder brain, so the arena and the game can
// swap it in anywhere. `temperature` softens the argmax into a softmax pick — that's the whole
// adaptive-difficulty dial, one number, monotone by construction.
'use strict';
const { features } = require('./features.js');

const STOP_FRACS = [1, 0.7, 0.45, 0.22];
const MIN_MOVE = 2*Math.PI/180;

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
      const full = eng.simMoveToLimit(pv, dir);
      restore();
      if (Math.abs(full) < MIN_MOVE) continue;
      for (const frac of STOP_FRACS) {
        const target = full*frac;
        if (Math.abs(target) < MIN_MOVE) continue;
        eng.pinFoot(pv);
        let guard = 0;
        while (!eng.getG().atLimit && Math.abs(eng.getG().netRad) < Math.abs(target) && guard++ < 5000)
          eng.applySwing(dir*Math.min(3*Math.PI/180, Math.abs(target) - Math.abs(eng.getG().netRad)));
        const g = eng.getG();
        let v;
        const oppOff = g.pieces[1 - idx].feet().some(f => Math.hypot(f.x, f.y) > eng.CFG.edgeU + eng.CFG.edgeEps);
        if (oppOff) v = 1e6 - Math.abs(target)*1e-3;   // a throw — take the shortest one
        else {
          g.active = 1 - idx;                           // value from the opponent-to-move view
          v = -net.value(features(eng));
          g.active = idx;
        }
        cands.push({ pivotIdx: pv, dir, targetRad: target, v });
        restore();
      }
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.v - a.v);
  const temp = o.temperature || 0;
  if (temp > 1e-6 && cands[0].v < 1e5) {                // never dice away a clean throw
    const mx = cands[0].v;
    const ws = cands.map(c => Math.exp((c.v - mx)/temp));
    let r = Math.random()*ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) { r -= ws[i]; if (r <= 0) return cands[i]; }
  }
  return cands[0];
}

module.exports = { nnPlanFor, STOP_FRACS };
