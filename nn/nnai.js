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
'use strict';
const { features } = require('./features.js');

const ROUGH_REF = 0.0225;            // measured median sweep roughness over 158 real positions
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
    g.pinned = null; g.pivot = null; g.active = idx; g.over = false; g.winner = null;
  };
  const cands = [];
  let roughSum = 0, roughN = 0;
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
      // Roughness: how far each waypoint sits from the average of its two neighbours. A smooth ramp
      // scores ~0; an isolated spike, or a good-bad-good alternation, scores high. Free -- it reuses
      // values the sweep already computed. Throws are engine-exact (not eval output), so a waypoint
      // touching one is skipped rather than counted as "the evaluator is unstable here".
      for (let i = 1; i + 1 < arm.length; i++) {
        if (arm[i-1].v >= 1e5 || arm[i].v >= 1e5 || arm[i+1].v >= 1e5) continue;
        roughSum += Math.abs(arm[i].v - (arm[i-1].v + arm[i+1].v)/2);
        roughN++;
      }
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
    for (let i = 0; i < keep; i++) {
      const c = cands[i];
      eng.applyPlan(c);
      const g1 = eng.getG();
      let deep;
      if (g1.over) deep = g1.winner === idx ? 1e6 : -1e6;
      else {
        const oppPlan = nnPlanFor(eng, net, 1 - idx, { temperature: 0, depth: depth - 1, keepForDepth: o.keepForDepth });
        if (!oppPlan) deep = net.value(features(eng));     // opponent wedged -- score as-is
        else {
          eng.applyPlan(oppPlan);
          const g2 = eng.getG();
          deep = g2.over ? (g2.winner === idx ? 1e6 : -1e6) : net.value(features(eng));
        }
      }
      restore();
      c.deep = deep;
    }
    cands.splice(0, keep, ...cands.slice(0, keep).sort((a, b) => b.deep - a.deep));
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
    const plan = nnPlanFor(eng, net, idx, { temperature: o.temperature, depth, keepForDepth });
    if (!plan) return best;               // wedged -- nothing this depth found, keep whatever we had
    best = plan; best.searchDepth = depth;
    lastCost = Date.now() - t1;
    const elapsed = Date.now() - t0;
    if (elapsed >= timeMs) return best;
    if (elapsed + lastCost*keepForDepth > timeMs) return best;   // next depth almost certainly won't finish
    depth++;
  }
}

module.exports = { nnPlanFor, nnPlanForTimed };
