// Hybrid "franken" brains: the trained net combined with the top ladder rung's hand-tuned eval,
// four different ways. All return the standard { name, fn: idx => plan } shape arena.js/tournament.js
// use, so they drop into the same harness as any nn/ladder brain (see frank-tournament.js).
'use strict';
const { opponentHasThrow } = require('./nnai.js');
const { genCandidates, scoreCandidates, planOf, nnEvalFor, handEvalFor, snapRestore, rankOf, zScore } =
  require('./frankai.js');

// C1 -- nn picks the root move (ply 1), each shortlisted candidate's opponent reply is modelled by
// the hand-tuned eval (ply 2: "what would L11 play here"), and the resulting position is re-scored
// by the net for the final pick. Literally "nn depth 1, hand-eval depth 2" as one search.
function makeC1(eng, net, handW, opts) {
  const o = opts || {};
  const rootSample = o.rootSample || 3, replySample = o.replySample || 9, keep = o.keep || 5;
  const evalNN = nnEvalFor(net), evalHand = handEvalFor(handW);
  return idx => {
    const { cands, snap0 } = genCandidates(eng, idx, rootSample);
    if (!cands.length) return null;
    const nnScores = scoreCandidates(eng, cands, idx, evalNN, snap0, idx);
    const order = cands.map((_, i) => i).sort((a, b) => nnScores[b] - nnScores[a]);
    if (cands[order[0]].isThrow) return planOf(cands[order[0]]);

    let bestI = order[0], bestVal = -Infinity;
    for (let k = 0; k < Math.min(keep, order.length); k++) {
      const ci = order[k], c = cands[ci];
      snapRestore(eng, c.snap, 1 - idx);
      let val;
      const oppGen = genCandidates(eng, 1 - idx, replySample);
      if (!oppGen.cands.length) {
        val = evalNN(eng, idx);
      } else {
        const oppScores = scoreCandidates(eng, oppGen.cands, 1 - idx, evalHand, oppGen.snap0, 1 - idx);
        let bi = 0; for (let i = 1; i < oppScores.length; i++) if (oppScores[i] > oppScores[bi]) bi = i;
        const oc = oppGen.cands[bi];
        if (oc.isThrow) val = -1e6;
        else { snapRestore(eng, oc.snap, idx); val = evalNN(eng, idx); }
      }
      snapRestore(eng, snap0, idx);
      if (val > bestVal) { bestVal = val; bestI = ci; }
    }
    return planOf(cands[bestI]);
  };
}

// C2 -- alternating 3-ply minimax: my move ranked by nn, opponent's reply ranked by the hand eval,
// my follow-up ranked by nn again -- "nn / hand / nn". Then a final quiesce-style instakill screen
// (reusing nnai.js's opponentHasThrow) prefers a top pick that doesn't hang an immediate throw.
function makeC2(eng, net, handW, opts) {
  const o = opts || {};
  const K1 = o.k1 || 4, K2 = o.k2 || 2, K3 = o.k3 || 3;
  const s1 = o.s1 || 5, s2 = o.s2 || 9, s3 = o.s3 || 7;
  const evalNN = nnEvalFor(net), evalHand = handEvalFor(handW);
  return idx => {
    const { cands: c1, snap0 } = genCandidates(eng, idx, s1);
    if (!c1.length) return null;
    const c1Scores = scoreCandidates(eng, c1, idx, evalNN, snap0, idx);
    const order1 = c1.map((_, i) => i).sort((a, b) => c1Scores[b] - c1Scores[a]);
    if (c1[order1[0]].isThrow) return planOf(c1[order1[0]]);

    const n1 = Math.min(K1, order1.length);
    const deep = new Array(n1);
    for (let i = 0; i < n1; i++) {
      const cand1 = c1[order1[i]];
      snapRestore(eng, cand1.snap, 1 - idx);
      const c2gen = genCandidates(eng, 1 - idx, s2);
      let worst;
      if (!c2gen.cands.length) {
        worst = evalNN(eng, idx);
      } else {
        const c2Scores = scoreCandidates(eng, c2gen.cands, 1 - idx, evalHand, c2gen.snap0, 1 - idx);
        const order2 = c2gen.cands.map((_, j) => j).sort((a, b) => c2Scores[b] - c2Scores[a]);
        worst = Infinity;
        for (let j = 0; j < Math.min(K2, order2.length); j++) {
          const cand2 = c2gen.cands[order2[j]];
          if (cand2.isThrow) { worst = Math.min(worst, -1e6); continue; }
          snapRestore(eng, cand2.snap, idx);
          const c3gen = genCandidates(eng, idx, s3);
          let my3;
          if (!c3gen.cands.length) my3 = evalNN(eng, idx);
          else {
            const c3Scores = scoreCandidates(eng, c3gen.cands, idx, evalNN, c3gen.snap0, idx);
            my3 = Math.max(...c3Scores);
          }
          worst = Math.min(worst, my3);
          snapRestore(eng, c2gen.snap0, 1 - idx);
        }
      }
      snapRestore(eng, snap0, idx);
      deep[i] = worst;
    }
    const rank = deep.map((_, i) => i).sort((a, b) => deep[b] - deep[a]);
    // instakill safety screen: among the top few by the 3-ply score, prefer one that doesn't hang
    // an immediate opponent throw right now (same idea as nn's own `quiesce` option)
    for (const ri of rank.slice(0, Math.min(3, rank.length))) {
      const cc = c1[order1[ri]];
      snapRestore(eng, cc.snap, 1 - idx);
      const unsafe = opponentHasThrow(eng, idx);
      snapRestore(eng, snap0, idx);
      if (!unsafe) return planOf(cc);
    }
    return planOf(c1[order1[rank[0]]]);
  };
}

// C3 -- rank fusion: one shared candidate pool, scored by BOTH evaluators. A candidate that lands in
// EITHER evaluator's top-N is eligible; among those, the Borda-style combined rank (nn rank + hand
// rank, lower is better) wins. Pure 1-ply, no lookahead -- the whole idea lives in the combination.
function makeC3(eng, net, handW, opts) {
  const o = opts || {};
  const sample = o.sample || 4, topN = o.topN || 5;
  const evalNN = nnEvalFor(net), evalHand = handEvalFor(handW);
  return idx => {
    const { cands, snap0 } = genCandidates(eng, idx, sample);
    if (!cands.length) return null;
    const throwIdx = cands.findIndex(c => c.isThrow);
    if (throwIdx >= 0) return planOf(cands[throwIdx]);
    const nnScores = scoreCandidates(eng, cands, idx, evalNN, snap0, idx);
    const handScores = scoreCandidates(eng, cands, idx, evalHand, snap0, idx);
    const nnRank = rankOf(nnScores), handRank = rankOf(handScores);
    let bi = -1, bestCombined = Infinity;
    for (let i = 0; i < cands.length; i++) {
      if (nnRank[i] >= topN && handRank[i] >= topN) continue;
      const combined = nnRank[i] + handRank[i];
      if (combined < bestCombined) { bestCombined = combined; bi = i; }
    }
    if (bi < 0) bi = nnRank.indexOf(0);   // shouldn't happen (rank 0 is always < topN) but be safe
    return planOf(cands[bi]);
  };
}

// C4 -- normalised linear blend: z-score both evaluators over the same candidate pool (puts the
// net's tanh-ish scale and the hand eval's unbounded weighted-sum scale on comparable footing) and
// pick the candidate maximising alpha*nn + (1-alpha)*hand. Simplest possible baseline to contrast
// against the structured searches above -- also 1-ply, no lookahead.
function makeC4(eng, net, handW, opts) {
  const o = opts || {};
  const sample = o.sample || 4, alpha = o.alpha === undefined ? 0.5 : o.alpha;
  const evalNN = nnEvalFor(net), evalHand = handEvalFor(handW);
  return idx => {
    const { cands, snap0 } = genCandidates(eng, idx, sample);
    if (!cands.length) return null;
    const throwIdx = cands.findIndex(c => c.isThrow);
    if (throwIdx >= 0) return planOf(cands[throwIdx]);
    const nnScores = scoreCandidates(eng, cands, idx, evalNN, snap0, idx);
    const handScores = scoreCandidates(eng, cands, idx, evalHand, snap0, idx);
    const nz = zScore(nnScores), hz = zScore(handScores);
    let bi = 0, best = -Infinity;
    for (let i = 0; i < cands.length; i++) {
      const s = alpha*nz[i] + (1 - alpha)*hz[i];
      if (s > best) { best = s; bi = i; }
    }
    return planOf(cands[bi]);
  };
}

module.exports = { makeC1, makeC2, makeC3, makeC4 };
