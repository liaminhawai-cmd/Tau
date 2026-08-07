// L11's hand-tuned evaluator, packaged as a leaf evaluator for nnai.js's search.
//
// What this is for: L11 is the strongest ladder brain, but it is FIXED DEPTH (depth 3, maxCands 28,
// sampleDeg 9) with no clock. So it cannot spend a search saving on anything -- prune its arms and
// it just finishes sooner at the same strength. Its judgement and its search are welded together.
//
// This unwelds them. engine.js already exports ladderEval, so L11's weights can be dropped into
// nnai.js's search instead: iterative deepening against a real clock, keepForDepth, quiescence, and
// policy-driven arm pruning -- all the machinery the value net gets. That makes two genuinely new
// questions askable:
//   - Is L11's eval better or worse than the trained net's, holding the SEARCH constant? Every
//     comparison so far confounded the two (L11's eval inside L11's fixed search vs the net's eval
//     inside nnai's timed search), so neither has ever been isolated.
//   - Does a policy head pay off better on a hand-tuned eval than on a learned one? Plausibly yes:
//     the policy is trained to imitate strong movers, and much of the corpus IS ladder play, so its
//     arm ordering may agree with L11's preferences more closely than with the net's.
//
// L11 ITSELF IS NOT TOUCHED. This is a new brain that borrows L11's weights; AI_LADDER, the rating
// pool, and every recorded ladder result stay exactly as they were. That matters because the ladder
// is the measuring stick -- improving the ruler does not lengthen the thing being measured, it just
// breaks comparability with everything already recorded.
//
// Note on scale: ladderEval returns tens-to-hundreds where the value net returns [-1, 1]. Nothing
// in the search compares the two (a single evaluator is used throughout any one search), but the
// THROW sentinel in nnPlanFor is a literal 1e6 and the win/loss terminals are +-1e6, so an
// evaluator must stay well inside that. L11's terms are bounded by its weights and the board size;
// observed range on real positions is roughly +-400, which leaves three orders of magnitude of
// headroom before a normal score could be mistaken for a throw.
'use strict';

// Exactly AI_LADDER[10]'s weights -- L11: L10's territory eval plus the triangle-angle term.
// Copied rather than read from eng.AI_LADDER so that retuning a ladder rung cannot silently change
// what this brain is, which would make its recorded results incomparable across runs.
const L11_WEIGHTS = { margin: 1, zone: 12, park: 8, oppFree: -1.1, triMe: 0.2 };
// L10 and L9 for comparison arms -- same eval family, progressively less territory emphasis.
const L10_WEIGHTS = { margin: 1, zone: 12, park: 8, oppFree: -1.1, triMe: 0.15 };
const L9_WEIGHTS  = { margin: 1, zone: 2.2, park: 1.9, center: 0.12, oppFree: -0.2 };

const WEIGHTS = { L9: L9_WEIGHTS, L10: L10_WEIGHTS, L11: L11_WEIGHTS };

// nnai.js calls evalFn(eng, side) and wants "higher is better FOR side", WHOEVER'S TURN IT IS.
// ladderEval(idx, w) is already exactly that, so this is a thin adapter rather than a
// reimplementation -- the scoring stays the engine's, extracted live from the shipped game like
// everything else in engine.js.
//
// THAT LAST CLAUSE WAS NOT ALWAYS TRUE, and the first version of this file shipped against the
// wrong contract. nnai.js used to score a leaf as `-evalFn(eng, 1 - idx)`, which requires the
// evaluator to be ANTISYMMETRIC (eval(me) == -eval(them)). The value net is trained on z so it
// approximately is. ladderEval is NOT: `park` sums over pieces[idx] only, `oppFree` over
// pieces[1-idx] only, `triMe` over me=idx only -- three one-sided terms, and park carries L11's
// second-heaviest weight (8). Measured on real played positions, mean |ladderEval(0) -
// (-ladderEval(1))| = 24.9 with the sign disagreeing outright at plies 0, 2 and 4. So this brain
// was not "L11's judgement in a different search", it was a frequently sign-flipped number, and it
// lost 0-42 to the real L11 across seven policy-loop cycles before anyone read the negation.
// nnai.js now asks every call site for idx's score directly. If a future evaluator is added here,
// it does NOT need to be antisymmetric -- just answer honestly about the side you are handed.
function makeLadderEval(eng, which) {
  const w = WEIGHTS[which] || L11_WEIGHTS;
  return (e, side) => e.ladderEval(side, w);
}

module.exports = { makeLadderEval, WEIGHTS, L11_WEIGHTS };
