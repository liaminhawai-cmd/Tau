'use strict';
// One committee member, living in its own thread (see committee.js). It answers three questions
// about a position the main thread hands it:
//   sweep  -- "what are your top few candidate moves here?"   (the member's own root shortlist)
//   judge  -- "how good is THIS move for the mover, once you have replied as well as you can?"
//   propose-- sweep with k=1, kept for the old rank-and-veto path
// Every member runs the SAME search (nnai.js), differing only in its leaf evaluator: a value net's
// forward pass, a dual trunk's value head, or a ladder rung's hand-tuned weights (laddereval.js's
// trick -- the rung's judgement unwelded from the rung's fixed search, so it takes a depth like
// everything else and produces a real candidate list instead of a single verdict).
//
// Each member also maps its own raw score to a WIN PROBABILITY, because that is the only scale on
// which different brains can be added up. A net already speaks in ~[-1,1] expected outcome; a rung
// speaks in tens-to-hundreds of eval points and needs a logistic squash. committee.js sums the logs
// of those probabilities, so a member that thinks a move is nearly dead drags the total toward
// -Infinity all by itself -- a continuous version of the hard veto, which still applies on top for
// engine-PROVEN losses.
//
// Sync from the caller's point of view: the main thread blocks on Atomics.wait until this worker
// bumps the shared counter, then drains the port with receiveMessageOnPort. That is what lets a
// plain synchronous brain.fn(idx) fan out over cores without arena.js growing an async game loop.
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { features } = require('./features.js');
const { MLP } = require('./net.js');
const { nnPlanFor } = require('./nnai.js');

const { spec, depth, keepForDepth, ladderTemp, ctrl, port } = workerData;
const CTRL = new Int32Array(ctrl);
const eng = createEngine();
eng.newGame();
const G = () => eng.getG();
const EPS = 1e-3;
const clampP = p => Math.min(1 - EPS, Math.max(EPS, p));

// ---- member: { name, plan, sweep, leaf, prob } ------------------------------------------------
function build(spec) {
  const lm = /^L(\d+)(\+corner)?$/i.exec(spec);
  if (lm) {
    const lvl = +lm[1], corner = !!lm[2], def = eng.AI_LADDER[lvl - 1];
    if (!def) throw new Error('no such ladder level: ' + spec);
    // The rung's own weights, read once. A rung with no territory weights (L1/L2-style) borrows
    // L11's, the same fallback the rest of the ladder tooling uses.
    const w = def.w && def.w.zone ? def.w : eng.AI_LADDER[10].w;
    // The evalFn contract is "score for `side`, whoever's turn it is" -- ladderEval reads G itself
    // and answers for the index given, which is exactly that. (Negating the opponent's view would
    // be wrong here: ladderEval is NOT antisymmetric, see nnai.js's header.)
    const evalFn = (e, side) => e.ladderEval(side, w);
    // T=100: laddereval.js records an observed range of about +-400 on real positions, so this
    // keeps a decisive position near 0.98/0.02 without saturating an ordinary one.
    const T = ladderTemp || 100;
    const rung = idx => { const g = G(); (g.cornerOpening || (g.cornerOpening = [null, null]))[idx] = corner; return eng.ladderPlanFor(lvl - 1, idx); };
    return {
      name: 'L' + lvl + (corner ? '+corner' : ''),
      plan: (idx, d) => nnPlanFor(eng, null, idx, { temperature: 0, depth: d || depth, keepForDepth, evalFn }),
      // The rung's AUTHENTIC move is always in the pool alongside the eval-at-depth shortlist: the
      // fixed ladder search is the thing the league actually rates, and it sometimes picks a move
      // its own evaluator ranks below the top at this depth.
      sweep: (idx, d, k) => { const top = []; nnPlanFor(eng, null, idx, { temperature: 0, depth: d || depth, keepForDepth, evalFn, captureTop: top, captureTopN: k }); const r = rung(idx); return r ? [{ pivotIdx: r.pivotIdx, dir: r.dir, targetRad: r.targetRad }, ...top] : top; },
      leaf: idx => eng.ladderEval(idx, w),
      prob: s => clampP(1 / (1 + Math.exp(-s / T))),
    };
  }
  const parts = spec.split(':');
  const netProb = v => clampP((v + 1) / 2);
  if (parts[0] === 'dual') {
    const mp = parts.length > 2 ? parts.slice(2).join(':') : path.join(__dirname, 'models', 'dual.json');
    const dual = require('./dualnet.js').DualMLP.fromJSON(JSON.parse(fs.readFileSync(mp, 'utf8')));
    const usePolicy = /\+P$/i.test(parts[1] || '');
    const common = d => ({ temperature: 0, depth: d || depth, keepForDepth, dual, dualPolicy: usePolicy, policyPrune: false });
    return {
      name: 'dual(' + path.basename(mp) + (usePolicy ? ',+P' : '') + ')',
      plan: (idx, d) => nnPlanFor(eng, null, idx, common(d)),
      sweep: (idx, d, k) => { const top = []; nnPlanFor(eng, null, idx, { ...common(d), captureTop: top, captureTopN: k }); return top; },
      leaf: idx => { const v = dual.value(features(eng)); return G().active === idx ? v : -v; },
      prob: netProb,
    };
  }
  if (parts[0] !== 'nn') throw new Error('unknown committee member: ' + spec);
  const mp = parts.length > 2 ? parts.slice(2).join(':') : path.join(__dirname, 'models', 'best.json');
  const net = MLP.fromJSON(JSON.parse(fs.readFileSync(mp, 'utf8')));
  return {
    name: 'nn(' + path.basename(mp) + ')',
    plan: (idx, d) => nnPlanFor(eng, net, idx, { temperature: 0, depth: d || depth, keepForDepth }),
    sweep: (idx, d, k) => { const top = []; nnPlanFor(eng, net, idx, { temperature: 0, depth: d || depth, keepForDepth, captureTop: top, captureTopN: k }); return top; },
    leaf: idx => { const v = net.value(features(eng)); return G().active === idx ? v : -v; },
    prob: netProb,
  };
}
const member = build(spec);

// The position arrives as the raw pose; everything transient is reset exactly as nnai's restore()
// does. Ko history is deliberately NOT carried: search never consults it (applyPlanSearch), and the
// main thread legalises the final choice through applyPlan like any other brain's move.
function load(pose, active, plies) {
  const g = G();
  g.pieces.forEach((p, i) => { p.x = pose[i][0]; p.y = pose[i][1]; p.rot = pose[i][2]; });
  g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
  g.pinned = null; g.pivot = null; g.active = active; g.over = false; g.winner = null;
  g.plies = plies || 0; g.cornerOpening = [false, false]; g.cornerDone = [true, true];
}
// Mover's verdict on `plan`: play it, let the member answer one ply shallower, read the member's
// leaf, and report it as a probability. `proven` is the engine's own word, not an opinion -- +1 the
// mover has won outright, -1 it has lost outright -- and committee.js treats those as absolute.
function judge(pose, active, plies, plan, d) {
  load(pose, active, plies);
  const idx = active;
  eng.applyPlanSearch(plan);
  let g = G();
  if (g.over) return { proven: g.winner === idx ? 1 : -1, p: g.winner === idx ? 1 - EPS : EPS, s: g.winner === idx ? 1e6 : -1e6 };
  const reply = member.plan(1 - idx, Math.max(1, (d || depth) - 1));
  if (reply) {
    eng.applyPlanSearch(reply);
    g = G();
    if (g.over) return { proven: g.winner === idx ? 1 : -1, p: g.winner === idx ? 1 - EPS : EPS, s: g.winner === idx ? 1e6 : -1e6 };
  }
  const s = member.leaf(idx);
  return { proven: 0, p: member.prob(s), s };
}
function sweep(pose, active, plies, d, k) {
  load(pose, active, plies);
  const out = member.sweep(active, d, Math.max(1, k || 4)) || [];
  const seen = [];
  for (const p of out) {
    if (!p || !Number.isFinite(p.targetRad)) continue;
    if (seen.some(q => q.pivotIdx === p.pivotIdx && q.dir === p.dir && Math.abs(Math.abs(q.targetRad) - Math.abs(p.targetRad)) < 1e-9)) continue;
    seen.push({ pivotIdx: p.pivotIdx, dir: p.dir, targetRad: p.targetRad });
  }
  return seen;
}

port.on('message', job => {
  let out;
  try {
    if (job.type === 'sweep') out = { id: job.id, plans: sweep(job.pose, job.active, job.plies, job.depth, job.k) };
    else if (job.type === 'propose') { const p = sweep(job.pose, job.active, job.plies, job.depth, 1); out = { id: job.id, plan: p[0] || null }; }
    else if (job.type === 'judge') out = { id: job.id, scores: job.plans.map(p => judge(job.pose, job.active, job.plies, p, job.depth)) };
    else out = { id: job.id, error: 'unknown job ' + job.type };
  } catch (e) { out = { id: job.id, error: e && e.stack || String(e) }; }
  port.postMessage(out);
  Atomics.add(CTRL, 0, 1);
  Atomics.notify(CTRL, 0);
});
port.postMessage({ ready: true, name: member.name });
Atomics.add(CTRL, 0, 1);
Atomics.notify(CTRL, 0);
