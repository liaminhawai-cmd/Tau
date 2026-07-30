// Instrumentation, not a brain: at a given position, ask "does the net's favourite move match the
// top ladder rung's favourite move?" over the SAME candidate pool, and if not, how strongly does
// each evaluator prefer its own pick over the other's (in standard-deviation units of that
// position's own score spread, so a sharp tactical position and a calm one are comparable). Used by
// frank-tournament.js as an observer at every few plies, independent of which brains are actually
// playing, to collect a sample of where the trained net and the hand-tuned eval genuinely see a
// position differently.
'use strict';
const { genCandidates, scoreCandidates, nnEvalFor, handEvalFor, zScore } = require('./frankai.js');

function makeDisagreeProbe(eng, net, handW, opts) {
  const o = opts || {};
  const sample = o.sample || 4;
  const evalNN = nnEvalFor(net), evalHand = handEvalFor(handW);
  return idx => {
    const { cands, snap0 } = genCandidates(eng, idx, sample);
    if (cands.length < 2) return null;
    const nnScores = scoreCandidates(eng, cands, idx, evalNN, snap0, idx);
    const handScores = scoreCandidates(eng, cands, idx, evalHand, snap0, idx);
    let nnTop = 0, handTop = 0;
    for (let i = 1; i < cands.length; i++) {
      if (nnScores[i] > nnScores[nnTop]) nnTop = i;
      if (handScores[i] > handScores[handTop]) handTop = i;
    }
    if (nnTop === handTop) return { disagreement: 0 };
    const nz = zScore(nnScores), hz = zScore(handScores);
    // how much better each evaluator thinks ITS OWN pick is over the OTHER's pick, summed
    const disagreement = (nz[nnTop] - nz[handTop]) + (hz[handTop] - hz[nnTop]);
    const mv = c => ({ pivotIdx: c.pivotIdx, dir: c.dir, targetRad: c.targetRad, isThrow: c.isThrow });
    return {
      disagreement, mover: idx,
      nnMove: mv(cands[nnTop]), handMove: mv(cands[handTop]),
      nnScoreOfNnMove: nnScores[nnTop], nnScoreOfHandMove: nnScores[handTop],
      handScoreOfHandMove: handScores[handTop], handScoreOfNnMove: handScores[nnTop],
      boardSnap: snap0,
    };
  };
}

// Keeps the top-K most divergent positions seen so far, sorted descending, no unbounded growth.
class TopKLog {
  constructor(k) { this.k = k; this.items = []; }
  offer(item, meta) {
    if (!item || !(item.disagreement > 0)) return;
    this.items.push(Object.assign({}, item, meta));
    this.items.sort((a, b) => b.disagreement - a.disagreement);
    if (this.items.length > this.k) this.items.length = this.k;
  }
}

module.exports = { makeDisagreeProbe, TopKLog };
