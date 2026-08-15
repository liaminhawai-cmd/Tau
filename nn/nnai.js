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
//
// `depth` (default 1, today's behaviour) adds real lookahead on top of the same trained net, the
// same trick every hand-tuned ladder brain past L6 already uses (a depth:2/3 minimax over its own
// weighted eval): take the top `keepForDepth` candidates from the 1-ply pass, actually play each
// one out, let the opponent (same net, recursively) find ITS best reply, and re-rank the top slice
// by that 2-ply-deeper outcome instead of the shallow score. A static evaluator does not need to be
// trained "for" search to benefit from it -- search just spends more evaluations to catch what a
// single greedy pass misses -- so this is a free strength boost on an already-trained net. Kept
// off by default (depth 1) because it costs roughly keepForDepth x as much per move: fine for the
// gate/benchmark/human-facing play, too slow to want it in every self-play game by default.
//
// `quiesce` (default off) is a cheap add-on rather than another ply: it screens the top few
// candidates for an immediate opponent throw reply using pure contact physics (opponentHasThrow,
// below) and promotes the first one that survives, with no network calls at all. At depth 1 -- the
// only ply with no lookahead whatsoever -- this is real information a plain 1-ply pass doesn't
// have. At depth 2+ it's close to a no-op, since the recursive opponent search already discovers a
// reply throw on its own; kept available at every depth anyway since it's nearly free.
// `policy` (optional, a policy.js PolicyMLP) can be spent two ways, and they are not equivalent.
//
// `abCut` (preferred) uses it to ORDER arms and then cuts a recursive search off as soon as it
// has refuted the candidate being tested. Ordering alone changes nothing -- the same arms get
// swept -- and cutting alone helps little, since without ordering the refuting arm is usually
// swept last. Together they are the version that can actually pay, and crucially the search is
// never blind: if no cutoff fires, every arm is still examined, so a bad policy costs time
// rather than strength. Measured before trusting: MEASURE THIS, see the A/B note below.
//
// `policyPrune` (the original wiring, kept for comparison) instead DELETES arms outright in the
// RECURSIVE opponent searches, keeping only the policy's top `policyArms` (default 3).
// Verdict so far: at equal depth it costs almost nothing (24-game A/B finished 8-9, i.e. the
// top-3 arms nearly always contain what full search would pick) but at equal THINK TIME it does
// not pay either (9-10), and that looks structural rather than unlucky: dropping 6 arms to 3 in
// recursion saves ~30-40% overall, while one more ply costs 4-6x, so the saving never buys the
// extra depth that iterative deepening only banks in whole plies. Prefer abCut.
// MEASURED SINCE, and the reason matters more than the number. Counting ACTUAL arm sweeps at
// depth 3 / keepForDepth 4, pruning is perfectly linear -- it is not the pruning that runs out:
//     arms 6 -> 126 sweeps, 2323ms      arms 3 -> 63 sweeps (2.00x), 1404ms (1.65x)
//     arms 2 ->  42 sweeps (3.00x), 1198ms (1.94x)
//     arms 1 ->  21 sweeps (6.00x),  811ms (2.86x)
// Sweeps divide exactly as expected. Wall time does not, because sweeping is only ~73% of the
// search: the other ~27% (snapshot/restore per candidate, candidate sorting, the plateau smoothing
// above, quiescence screening, feature extraction, recursion bookkeeping) does not scale with arm
// count at all. Solving T = S*(sweeps ratio) + F gives S~1687ms, F~636ms, which predicts the arms-2
// time as 1687/3 + 636 = 1198ms -- exactly what was measured.
// THE CONSEQUENCE, and the cleanest statement of why pruning cannot buy depth: even pruning to zero
// sweeps caps out at 1/0.27 = 3.7x, while one more ply costs 4-6x. Arm pruning can therefore never
// bank a ply, at ANY arm count -- not because it saturates, but because the un-prunable remainder
// sits just below the price of a ply.
//     cut keepForDepth 3/2/1   ->  1.74x / 3.24x / 8.04x   (compounds every ply -- this CAN)
// keepForDepth caps CHILDREN PER NODE at 4, and one arm's sweep already yields more than 4 candidate
// waypoints -- so dropping 6 arms to 2 leaves the tree exactly the same SHAPE and only makes each
// node cheaper to generate. That is a bounded constant, never the 4-6x a ply costs. Cutting
// keepForDepth deletes nodes outright, so it compounds.
// The consequence: a policy's real lever here is not pruning arms for speed, it is making a NARROW
// keepForDepth safe enough to be worth the ply it buys. Measured: depth 4 at keep 2 / arms 2 runs
// in 1070ms where the depth 3 / keep 4 default takes 1907ms -- a full ply deeper in half the time,
// which only pays if the two kept candidates are usually the right ones. That is exactly what an
// ~90%-arm-top-3 policy is for, and it is the configuration nothing has tested yet (menu 35).
//
// `dual` (optional, a dualnet.js DualMLP) is a THIRD way to spend a policy, orthogonal to the
// abCut/policyPrune choice above: a single net with a shared trunk that outputs a value AND a
// policy from one forward pass, instead of paying for a separate net.js MLP and policy.js
// PolicyMLP. It always supplies the default leaf evaluator (same role `net` plays for a plain
// value-net search) -- that part is free, it's just "which net", not an extra decision. Whether it
// ALSO supplies arm ordering/pruning is a separate opt-in, `dualPolicy`: off by default so a bare
// `dual:` brain is directly comparable to a bare `nn:` brain (value only, no policy spend), on to
// run the actual fusion experiment (does one forward pass beat two, at equal search settings).
// See dualnet.js's header and torch-train-dual.py for how the net is trained and why
// policy-targets.jsonl -- which already carries a value target `z` alongside every `arm`/`bin` --
// is exactly the data a joint objective needs with no new mining required.
// Why arms (for both) and why only in recursion: profiling shows the physics stepping dominates move cost
// (an 18k-param forward pass is microseconds), so skipping individual waypoints saves nothing --
// only skipping a whole arm's sweep does. And the root is left full-width deliberately: it costs
// one sweep regardless, and the root is where silently never considering a move hurts most. The
// known blind spot is throws: policy targets are mined from pose deltas, and each game's final
// (usually throwing) move has no successor row to mine, so the policy systematically under-rates
// throw arms -- a pruned recursive search can miss an opponent throw a full-width depth-2 search
// would have caught. `quiesce` covers exactly that hole cheaply; prefer them together.
'use strict';
const { features, moveFrame, jointMoveFrame } = require('./features.js');
const { actionIndex } = require('./policy.js');

const ROUGH_REF = 0.0225;            // measured median sweep roughness over 158 real positions
const STEP_RAD = 3*Math.PI/180;      // the engine brains' own sampling step
const CAP_RAD = 170*Math.PI/180;     // same safety cap as every other brain
const MIN_MOVE = 2*Math.PI/180;      // below this the engine would undo the turn as a non-move
// Same park band the ladder rungs use (index.html's PARK_LO/PARK_HI): a foot within PARK_HI of a
// printed line but NOT within PARK_LO of it -- parked just off the centreline, magnet still on the
// ink. Duplicated rather than imported because these are plain numbers in the shipped game's script
// body, not part of the engine's exported surface; if they move there, they must move here too.
const PARK_LO = 0.05, PARK_HI = 0.34;

// Is any NON-PIVOT foot of `idx` sitting in the park band? Mirrors ladderRoots3's own park test.
// Only meaningful for evaluators that actually reward parks (ladderEval's park term); the value net
// gets the same information through features.js's exp() park indicator instead, which is why this
// is opt-in rather than always on.
function isParkStop(eng, idx, pv) {
  const feet = eng.getG().pieces[idx].feet();
  for (let fi = 0; fi < 3; fi++) {
    if (fi === pv) continue;
    if (!eng.nearLineIds(feet[fi], PARK_HI).length) continue;
    if (eng.nearLineIds(feet[fi], PARK_LO).length) continue;   // dead-centre stops skipped, same as L11
    return true;
  }
  return false;
}

// Cheap throw-only lookahead, no network calls at all: from the CURRENT position (with `attacker`
// = 1-victimIdx to move), does ANY of their 6 (pivot x direction) sweeps push a `victimIdx` foot
// past the rim at any point along the way? Same contact-physics check every brain already does to
// detect a throw (see the `oppOff` line in nnPlanFor below), just walked for the OTHER side and
// stopped the instant it finds one instead of continuing to score every remaining waypoint.
//
// This exists because a plain depth-1 nnPlanFor pass has NO lookahead at all -- it can walk
// straight into a position the opponent throws from next turn, because nothing after the move ever
// asks "can they punish this." depth 2 already asks that (a full recursive nnPlanFor call for the
// opponent, whose own throw waypoints score 1e6 and win their ranking outright, propagating back as
// -1e6 to us) -- but paying for a FULL valued opponent search (~60 net.value() calls per arm) just
// to learn a yes/no is wasteful when the physics stepping itself is orders of magnitude cheaper
// than a forward pass. This gets the same yes/no for a fraction of the cost.
//
// Self-contained: snapshots and restores its own state, so it can be dropped in anywhere the
// engine is already sitting at the position to check without disturbing the caller.
function opponentHasThrow(eng, victimIdx) {
  const attacker = 1 - victimIdx;
  const origActive = eng.getG().active;
  const snap = eng.takeSnap();
  const reset = active => {
    const g = eng.getG();
    g.pieces.forEach((p, i) => { p.x = snap[i].x; p.y = snap[i].y; p.rot = snap[i].rot; });
    g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
    g.pinned = null; g.pivot = null; g.active = active; g.over = false; g.winner = null;
  };
  for (let pv = 0; pv < 3; pv++) {
    for (const dir of [1, -1]) {
      reset(attacker);
      eng.pinFoot(pv);
      let guard = 0;
      while (!eng.getG().atLimit && Math.abs(eng.getG().netRad) < CAP_RAD && guard++ < 200) {
        eng.applySwing(dir*STEP_RAD);
        if (eng.getG().pieces[victimIdx].feet().some(f => Math.hypot(f.x, f.y) > eng.CFG.edgeU + eng.CFG.edgeEps)) {
          reset(origActive);
          return true;
        }
      }
    }
  }
  reset(origActive);
  return false;
}

function nnPlanFor(eng, net, idx, opts) {
  const o = opts || {};
  const stopStride = Math.max(1, o.stopStride || 1);
  // o.parkStops: mark park stops during the sweep and exempt them from plateau smoothing (see the
  // smoothing block below for the measurement and the ladder's own precedent). OFF by default, so
  // every value-net search stays bit-identical -- the value net reads parks through features.js's
  // exp() indicator rather than a single heavy weight, and smoothing a learned evaluator's spikes
  // is the behaviour that block was actually designed for. Intended for hand-tuned evaluators whose
  // park term is a real engine fact rather than possible noise, i.e. laddereval.js's.
  const parkStops = !!o.parkStops;
  // The LEAF EVALUATOR is pluggable: o.evalFn(eng, side) -> a score for `side`, higher better,
  // WHOEVER'S TURN IT IS. That last clause is the whole contract and it used to be implicit, which
  // cost a whole experiment. The old code scored a leaf as `-evalFn(eng, 1 - idx)` -- negate the
  // opponent's view -- which silently requires the evaluator to be ANTISYMMETRIC (eval(me) ==
  // -eval(them)). The value net is trained on z so it approximately is. ladderEval is NOT: `park`
  // reads only pieces[idx], `oppFree` only pieces[1-idx], `triMe` only me=idx, and with L11's
  // weights (park:8 is its second-heaviest term) the asymmetry is large. Measured over 10 real
  // positions: mean |ladderEval(0) - (-ladderEval(1))| = 37.7, and THE SIGN DISAGREED IN 9 OF 10.
  // So `le:L11` was not "L11's judgement in a different search", it was a frequently sign-flipped
  // number, which is why it lost 0-42 to the real L11 over seven policy-loop cycles.
  //
  // The fix is to make the contract explicit rather than assumed: every call site now asks for
  // `idx`'s score directly, and an evaluator that needs to know whose turn it is reads G.active
  // itself. The default value-net evaluator does exactly the flip the call sites used to do by
  // hand, so every value-net search is bit-identical to before (see the wedged-node note at the
  // depth loop for the one deliberate exception, which was a latent sign error for EVERY evaluator).
  const evalFn = o.evalFn || (o.dual
    ? ((e, side) => {
        const v = o.dual.value(features(e));
        return e.getG().active === side ? v : -v;
      })
    : ((e, side) => {
        const v = net.value(features(e));
        return e.getG().active === side ? v : -v;
      }));
  // o.sweepDeg: the angular step the sweep samples stops at, default the module's 3 degrees.
  // Worth a knob because resolution turns out to be nearly free: measured 7/20/40/60 waypoints at
  // 9/3/1.5/1 degrees for 18.32/20.18/21.45/24.82ms -- 8.5x the stops for 35% more time, because
  // the cost tracks the ARC SWEPT and the arc is identical either way. Finer sampling also improves
  // the candidate set without making the recursion more expensive, since keepForDepth caps how many
  // candidates get a deep search regardless of how many were generated. Real L11 samples at 9.
  const stepRad = (o.sweepDeg ? +o.sweepDeg : 3)*Math.PI/180;
  const G = eng.getG();
  if (G.active !== idx) throw new Error('nnPlanFor called for the wrong side');
  const snap = eng.takeSnap();
  const restore = () => {
    const g = eng.getG();
    g.pieces.forEach((p, i) => { p.x = snap[i].x; p.y = snap[i].y; p.rot = snap[i].rot; });
    g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
    g.pinned = null; g.pivot = null; g.active = idx; g.over = false; g.winner = null;
  };
  // Arm ORDER (and, if policyPrune, arm pruning). Canonical arm ranks map back to engine
  // (pivot, direction) via the same frame the policy's training targets were expressed in.
  //
  // Ordering is the safe way to spend a policy. Pruning deletes arms the search then cannot see;
  // ordering only changes the sequence, so if no cutoff fires every arm is still swept and the
  // answer is bit-identical to an unordered search. It pays off only in combination with
  // `cutIfAbove` below -- a good arm first means the refutation is found before the remaining
  // sweeps are paid for. On its own, ordering costs and saves exactly nothing.
  let armList = [];
  for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) armList.push({ pv, dir });
  // A dual net only doubles as an arm-ordering source when `dualPolicy` opts in (see the header
  // note above) -- an explicit `o.policy` always wins if both are somehow given.
  const policySrc = o.policy || (o.dualPolicy && o.dual);
  let jointActions = null, jointFrame = null;
  if (policySrc) {
    const pred = policySrc.predict(features(eng));
    const frame = pred.actions ? jointMoveFrame(eng) : moveFrame(eng);
    const { arms } = pred;
    if (pred.actions) { jointActions = pred.actions; jointFrame = frame; }
    const armKey = a => a.pv*2 + (a.dir > 0 ? 1 : 0);
    const score = new Map();
    for (let ai = 0; ai < arms.length; ai++) {
      const slot = ai >> 1, canonDir = (ai & 1) === 0 ? 1 : -1;
      score.set(frame.order[slot]*2 + ((canonDir*frame.mirror) > 0 ? 1 : 0), arms[ai]);
    }
    armList.sort((a, b) => (score.get(armKey(b)) || 0) - (score.get(armKey(a)) || 0));
    if (o.policyPrune) armList = armList.slice(0, Math.max(1, Math.min(6, o.policyArms || 3)));
  }
  const cands = [];
  let roughSum = 0, roughN = 0;
  let bestRaw = -Infinity;
  {
    for (const { pv, dir } of armList) {
      eng.pinFoot(pv);
      const arm = [];   // this arm's waypoints, in sweep order (smoothing needs adjacency)
      let guard = 0;
      while (!eng.getG().atLimit && Math.abs(eng.getG().netRad) < CAP_RAD && guard++ < 200) {
        eng.applySwing(dir*stepRad);
        const g = eng.getG();
        const rad = g.netRad;                       // signed; applyPlan abs()es it, dir carries sign
        if (Math.abs(rad) < MIN_MOVE) { if (g.atLimit) break; continue; }
        const oppOff = g.pieces[1 - idx].feet().some(f => Math.hypot(f.x, f.y) > eng.CFG.edgeU + eng.CFG.edgeEps);
        // o.stopStride > 1 keeps only every Nth waypoint of a sweep. The sweep itself is NOT
        // shortened -- it cannot be, since reaching any stop means stepping the physics through
        // every stop before it -- so this saves only the net evaluation, measured at ~11% of a
        // sweep (13.98ms stepping vs 2.9ms for all 20 evals). Small by construction, and the
        // reason the header says arms are the only granularity worth cutting at. Exposed anyway
        // so "narrow the arms" and "thin the stops" can be compared rather than argued about.
        // A THROW is never skipped whatever the stride: it is engine-exact, decisive, and the one
        // thing the policy is already known to under-rate, so thinning it away would silently
        // reintroduce the exact blind spot tryMineThrow exists to close.
        if (!oppOff && stopStride > 1 && (guard % stopStride) !== 0) continue;
        let v;
        if (oppOff) v = 1e6 - Math.abs(rad)*1e-3;   // a throw — engine-exact; shortest one wins
        else {
          // G.active is set to the REAL position (opponent to move after this swing) because
          // features() reads it; the score asked for is still idx's. The default evaluator turns
          // that into the same negated opponent-view value the old code computed inline.
          g.active = 1 - idx;
          v = evalFn(eng, idx);
          g.active = idx;
        }
        let prior;
        if (jointActions) {
          const leg = jointFrame.order.indexOf(pv);
          prior = jointActions[actionIndex(leg, dir*jointFrame.mirror, rad)];
        }
        arm.push({ pivotIdx: pv, dir, targetRad: rad, v,
                   ...(prior !== undefined ? { prior } : {}),
                   ...(parkStops && !oppOff && isParkStop(eng, idx, pv) ? { park: true } : {}) });
      }
      restore();
      // plateau-vs-needle smoothing, throws and non-throws never blended across the boundary.
      // PARKS are exempt for the same reason throws are: the smoothing exists to pull down an
      // isolated spike of "good" flanked by "bad", on the theory that a needle in a small net's
      // output is more likely noise than signal. A park is the opposite -- an engine-verifiable
      // fact about where a foot physically sits, in a band (PARK_LO..PARK_HI) narrower than one 3
      // degree step, so it is ALWAYS an isolated spike and its neighbours are ALWAYS unparked.
      // Averaging it with them destroys most of the term by construction: measured under L11's
      // weights (park:8), a park stop scoring 23.24 raw smoothed down to 16.41, losing ~6.7 every
      // time its neighbours were unparked. The ladder rungs hit this exact bug once already --
      // ladderRoots3's own comment records L8 falling from ~63% to ~43% vs L7 when coarse sampling
      // stopped landing real parks, which is why it grew a dedicated park recorder.
      for (let i = 0; i < arm.length; i++) {
        const w = arm[i], isThrow = w.v >= 1e5;
        if (isThrow || w.park) { w.s = w.v; cands.push(w); continue; }
        let sum = w.v, n = 1;
        if (i > 0 && arm[i-1].v < 1e5) { sum += arm[i-1].v; n++; }
        if (i + 1 < arm.length && arm[i+1].v < 1e5) { sum += arm[i+1].v; n++; }
        w.s = sum/n;
        cands.push(w);
      }
      // Roughness: how far each waypoint sits from the average of its two neighbours. A smooth ramp
      // scores ~0; an isolated spike, or a good-bad-good alternation, scores high. Free -- it reuses
      // values the sweep already computed. Throws are engine-exact (not eval output), so a waypoint
      // touching one is skipped rather than counted as "the evaluator is unstable here".
      for (let i = 1; i + 1 < arm.length; i++) {
        if (arm[i-1].v >= 1e5 || arm[i].v >= 1e5 || arm[i+1].v >= 1e5) continue;
        roughSum += Math.abs(arm[i].v - (arm[i-1].v + arm[i+1].v)/2);
        roughN++;
      }
      // Arm-level beta cutoff. The caller (the depth loop below) passes the score its best
      // candidate so far already guarantees it; once THIS side has found a reply better than
      // that, the candidate being tested is already refuted and the exact margin is worthless,
      // so the remaining arm sweeps are pure waste. Arm granularity is the only granularity worth
      // cutting at: the physics stepping dominates, so skipping waypoints saves nothing and only
      // skipping a whole sweep does (same reasoning as the pruning note in the header).
      //
      // This is a bound, not an exact value -- the returned plan is "good enough to refute", not
      // provably this side's best -- which is exactly what the caller needs, since it only asks
      // whether the candidate can beat what it already holds. Never applied at the root: the root
      // has no cutIfAbove passed to it, and needs its full candidate list for ranking, quiescence
      // and temperature.
      for (const w of arm) if (w.v > bestRaw) bestRaw = w.v;
      if (o.cutIfAbove != null && bestRaw > o.cutIfAbove) break;
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.s - a.s);

  // Normalised roughness: absolute jaggedness means nothing on its own, only relative to how much
  // this position's eval varies at all (a dead-flat position with tiny wobble is still calm).
  // High roughness = either genuinely sharp tactics OR an evaluator that's unreliable here -- both
  // are answered the same way, by searching deeper and leaning on real playouts instead of the net.
  let lo = Infinity, hi = -Infinity;
  for (const c of cands) { if (c.v >= 1e5) continue; if (c.v < lo) lo = c.v; if (c.v > hi) hi = c.v; }
  const spread = hi - lo;
  const roughness = (roughN && spread > 1e-9) ? (roughSum/roughN)/spread : 0;

  const depth = o.depth || 1;
  if (depth >= 2 && cands[0].v < 1e5) {          // a clean throw is already provably best, skip
    // adaptive: spend the search budget where the eval is least trustworthy -- a calm (smooth)
    // position gets a narrow slice deep-searched, a jagged one gets a wide one. Scaled RELATIVE to
    // typical roughness rather than by an absolute gain: measured over 158 real positions the
    // distribution is tight (p10 0.011, median 0.023, p90 0.037), so an absolute multiplier barely
    // differentiates, while relative scaling spans keep 2 (calm) to ~7 (sharp). Because the mean
    // roughness sits ~= the median, mean keep stays ~= base: this REDISTRIBUTES a fixed budget
    // rather than spending more. ROUGH_REF was measured with one net; a very differently-shaped
    // evaluator may want it re-measured (scratch probe: rough-probe.js).
    //
    // RESULT SO FAR: INCONCLUSIVE, which is why this stays off by default. A compute-neutral
    // head-to-head (same net, depth 2, adaptive keep vs fixed keep=4) went 14-10 over 24 games --
    // 0.8 sigma from the expected 12, two-tailed p ~0.54, i.e. indistinguishable from a coin flip,
    // and the lead swung both ways during the run. Resolving an effect that small needs ~300 games
    // (~5h), which is not worth it while label quality is the known binding constraint. Do not read
    // 14-10 as a win if revisiting this.
    const base = o.keepForDepth || 4;
    const keep = Math.min(cands.length, o.adaptive
      ? Math.max(2, Math.min(12, Math.round(base*(roughness/ROUGH_REF))))
      : base);
    // bestDeep drives the cutoff: a candidate only matters if it can beat what we already hold, so
    // the opponent search is told to stop as soon as it proves this one can't. The opponent scores
    // from their own side, hence the negation. Off unless o.abCut, so the default search is
    // bit-identical to before -- the cutoff returns a bound rather than an exact value, and that
    // trade deserves to be measured before it becomes the default.
    // A joint policy ranks actual signed-distance candidates, not merely six broad arms. Let it
    // choose which `keep` candidates earn recursive search -- the compounding lever arm pruning
    // could never reach. Every legal waypoint was still generated and every throw is protected;
    // this changes the narrow deep-search frontier only. Legacy policies retain the old shallow-
    // value shortlist exactly.
    const deepCands = jointActions
      ? cands.slice().sort((a, b) => (b.prior || 0) - (a.prior || 0)).slice(0, keep)
      : cands.slice(0, keep);
    let bestDeep = -Infinity;
    for (const c of deepCands) {
      eng.applyPlanSearch(c);   // hypothetical: must not file into koHist or tick the move cap
      const g1 = eng.getG();
      let deep;
      if (g1.over) deep = g1.winner === idx ? 1e6 : -1e6;
      else {
        const oppPlan = nnPlanFor(eng, net, 1 - idx, { temperature: 0, depth: depth - 1, keepForDepth: o.keepForDepth,
                                                      policy: o.policy, policyPrune: !!o.policyPrune, policyArms: o.policyArms, stopStride: o.stopStride, evalFn: o.evalFn, sweepDeg: o.sweepDeg, parkStops: o.parkStops,
                                                      dual: o.dual, dualPolicy: o.dualPolicy,
                                                      abCut: o.abCut,
                                                      cutIfAbove: (o.abCut && bestDeep > -Infinity) ? -bestDeep : null });
        // Opponent wedged (no legal waypoint at all) -- score the position as it stands. This line
        // used to read `net.value(features(eng))`, which was wrong twice over: it ignored evalFn
        // entirely (so a le:L11 search mixed [-1,1] value-net scores into a +-400 scale here), and
        // G.active is 1-idx at this point, so the raw net.value was the OPPONENT's score assigned
        // to a variable the caller reads as idx's -- a sign error for every evaluator including the
        // value net. Rare (it needs a genuinely wedged side) but wrong whenever it fired.
        if (!oppPlan) deep = evalFn(eng, idx);
        else {
          eng.applyPlanSearch(oppPlan);
          const g2 = eng.getG();
          deep = g2.over ? (g2.winner === idx ? 1e6 : -1e6) : evalFn(eng, idx);
        }
      }
      restore();
      c.deep = deep;
      if (deep > bestDeep) bestDeep = deep;
    }
    deepCands.sort((a, b) => b.deep - a.deep);
    const chosenForDepth = new Set(deepCands);
    cands.splice(0, cands.length, ...deepCands, ...cands.filter(c => !chosenForDepth.has(c)));
  }

  // Quiescence (`o.quiesce`): screen the top few candidates for an immediate opponent throw reply
  // and promote the first one that survives, using opponentHasThrow's cheap physics-only check
  // instead of a full deeper search. This is the one place it adds information a plain depth-1
  // pass doesn't already have -- depth 2+'s recursive opponent search already discovers a reply
  // throw on its own (see the comment above opponentHasThrow), so a candidate that hangs one
  // should already be sorted out of the top slice by the time this runs; the check here is close
  // to a no-op at depth 2+ in practice, and kept uniform across all depths anyway since it's cheap
  // and harmless where redundant, rather than special-casing depth 1 alone.
  if (o.quiesce && cands[0].v < 1e5) {           // a proven throw is already provably best, skip
    const checkN = Math.min(cands.length, o.quiesceCands || o.keepForDepth || 4);
    for (let i = 0; i < checkN; i++) {
      const c = cands[i];
      eng.applyPlanSearch(c);
      const unsafe = opponentHasThrow(eng, idx);
      restore();
      if (!unsafe) {
        if (i > 0) { cands.splice(i, 1); cands.unshift(c); }
        break;
      }
      // none of the top checkN survive -- every close-to-best move loses immediately. Leave the
      // ranking as-is rather than reaching further down for a worse-scored "safe" move the eval
      // itself thinks is bad for other reasons.
    }
  }

  const temp = o.temperature || 0;
  let chosen = cands[0];
  if (temp > 1e-6 && cands[0].v < 1e5) {            // never dice away a clean throw
    const mx = cands[0].s;
    const ws = cands.map(c => Math.exp((c.s - mx)/temp));
    let r = Math.random()*ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) { r -= ws[i]; if (r <= 0) { chosen = cands[i]; break; } }
  }
  chosen.roughness = roughness;   // reported for diagnostics/calibration, never used to rank
  return chosen;
}

// Iterative deepening: search depth 1, then 2, then 3... keeping only the last FULLY completed
// depth's answer, until `timeMs` runs out -- exactly how a chess engine uses a time budget instead
// of a fixed ply count. Never returns a partial (interrupted mid-search) result: depth N's answer
// only replaces depth N-1's once N has completely finished. Each depth also re-derives its own
// weighted-average cost estimate from the depths tried so far (roughly keepForDepth x per extra
// ply), so it stops requesting a depth it almost certainly can't finish rather than overrunning
// the clock by a large factor.
function nnPlanForTimed(eng, net, idx, opts) {
  const o = opts || {};
  const timeMs = o.timeMs || 2000;
  const keepForDepth = o.keepForDepth || 4;
  const t0 = Date.now();
  let best = null, lastCost = 0, depth = 1;
  for (;;) {
    const t1 = Date.now();
    const plan = nnPlanFor(eng, net, idx, { temperature: o.temperature, depth, keepForDepth,
                                             quiesce: o.quiesce, policy: o.policy,
                                             policyPrune: !!o.policyPrune, policyArms: o.policyArms, stopStride: o.stopStride,
                                             parkStops: o.parkStops, dual: o.dual, dualPolicy: o.dualPolicy,
                                             evalFn: o.evalFn, sweepDeg: o.sweepDeg, abCut: o.abCut });
    if (!plan) return best;               // wedged -- nothing this depth found, keep whatever we had
    best = plan; best.searchDepth = depth;
    lastCost = Date.now() - t1;
    const elapsed = Date.now() - t0;
    if (elapsed >= timeMs) return best;
    if (elapsed + lastCost*keepForDepth > timeMs) return best;   // next depth almost certainly won't finish
    depth++;
  }
}

module.exports = { nnPlanFor, nnPlanForTimed, opponentHasThrow };
