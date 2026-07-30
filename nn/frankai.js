// Shared primitives for "franken" brains that combine the trained net with a hand-tuned ladder
// eval (see frank.js). The physics sweep (pinFoot/applySwing to find every legal stop) is the
// expensive part of any brain, per net.js's own cost model; the net forward pass and ladderEval are
// both cheap. So generation and scoring are split: genCandidates() sweeps ONCE and snapshots every
// waypoint, scoreCandidates() restores those snapshots and asks an arbitrary evaluator to score them
// -- as many times, with as many different evaluators, as a caller wants, without re-simulating.
'use strict';
const { features } = require('./features.js');

const STEP_RAD = 3*Math.PI/180;
const CAP_RAD = 170*Math.PI/180;
const MIN_MOVE = 2*Math.PI/180;

function snapRestore(eng, snap, activeIdx) {
  const g = eng.getG();
  g.pieces.forEach((p, i) => { p.x = snap[i].x; p.y = snap[i].y; p.rot = snap[i].rot; });
  g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
  g.pinned = null; g.pivot = null; g.active = activeIdx; g.over = false; g.winner = null;
}

// One full dense sweep (all 6 pivot x dir arms) for `idx` to move, sampled every `sampleDeg`
// (plus each arm's natural final stop). Snapshot-only: no evaluator is called here. Returns
// { cands, snap0 } -- snap0 is the position BEFORE any candidate, for the caller to return to.
function genCandidates(eng, idx, sampleDeg) {
  const sampleRad = (sampleDeg || 3)*Math.PI/180;
  const snap0 = eng.takeSnap();
  const cands = [];
  for (let pv = 0; pv < 3; pv++) {
    for (const dir of [1, -1]) {
      snapRestore(eng, snap0, idx);
      eng.pinFoot(pv);
      let guard = 0, lastMark = 0;
      while (!eng.getG().atLimit && Math.abs(eng.getG().netRad) < CAP_RAD && guard++ < 500) {
        eng.applySwing(dir*STEP_RAD);
        const g = eng.getG();
        const a = Math.abs(g.netRad);
        if (a < MIN_MOVE) continue;
        if (!g.atLimit && a - lastMark < sampleRad) continue;
        lastMark = a;
        const oppOff = g.pieces[1 - idx].feet().some(f => Math.hypot(f.x, f.y) > eng.CFG.edgeU + eng.CFG.edgeEps);
        cands.push({ pivotIdx: pv, dir, targetRad: g.netRad, isThrow: oppOff, snap: eng.takeSnap() });
      }
    }
  }
  snapRestore(eng, snap0, idx);
  return { cands, snap0 };
}

// Score an already-generated candidate list from `forIdx`'s perspective, using `evalFor(eng, idx)`
// (higher = better for idx). `moverIdx` is whoever generated the candidates (needed to restore
// snapshots with the right `active`). Leaves the engine at snap0 when done.
function scoreCandidates(eng, cands, forIdx, evalFor, snap0, moverIdx) {
  const BIG = 1e6;
  const scores = cands.map(c => {
    if (c.isThrow) {
      const mag = BIG - Math.abs(c.targetRad)*1e-3;
      return forIdx === moverIdx ? mag : -mag;
    }
    snapRestore(eng, c.snap, moverIdx);
    return evalFor(eng, forIdx);
  });
  snapRestore(eng, snap0, moverIdx);
  return scores;
}

function planOf(c) { return { pivotIdx: c.pivotIdx, dir: c.dir, targetRad: c.targetRad }; }

function nnEvalFor(net) {
  return (eng, idx) => {
    const g = eng.getG(), orig = g.active;
    g.active = idx;
    const v = net.value(features(eng));
    g.active = orig;
    return v;
  };
}
function handEvalFor(w) {
  return (eng, idx) => eng.ladderEval(idx, w);
}

function rankOf(scores) {          // 0 = best
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const rank = new Array(scores.length);
  order.forEach((idx, r) => { rank[idx] = r; });
  return rank;
}
function zScore(arr) {
  const n = arr.length, mean = arr.reduce((a, b) => a + b, 0)/n;
  const variance = arr.reduce((a, b) => a + (b - mean)*(b - mean), 0)/n;
  const sd = Math.sqrt(variance) || 1;
  return arr.map(v => (v - mean)/sd);
}

module.exports = { genCandidates, scoreCandidates, planOf, nnEvalFor, handEvalFor, snapRestore, rankOf, zScore };
