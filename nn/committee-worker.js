'use strict';
// One committee member, living in its own thread (see committee.js). It answers two questions about
// a position the main thread hands it: "what would you play?" (propose) and "how good is THIS move
// for the mover, once I have replied as well as I can?" (judge). Both run the member's own search
// at its own depth, so a rung and a net each speak in their own voice; committee.js only compares
// RANKS across members, never raw scores, because a value net speaks in [-1,1] and a ladder rung in
// hundreds of eval points.
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

const { spec, depth, keepForDepth, ctrl, port } = workerData;
// A judge answers a proposal one ply shallower than it proposes, exactly as nnai's own deep loop
// searches the opponent at depth-1: measured on the 10x400 net, D3 is 11.6s and D2 2.2s, so
// judging three proposals at full depth would cost three root searches per move on top of the one.
const judgeDepth = Math.max(1, depth - 1);
const CTRL = new Int32Array(ctrl);
const eng = createEngine();
eng.newGame();
const G = () => eng.getG();

// ---- member: { name, plan(idx) -> plan|null, leaf(idx) -> score for idx, whoever is to move } ----
function build(spec) {
  const lm = /^L(\d+)(\+corner)?$/i.exec(spec);
  if (lm) {
    const lvl = +lm[1], corner = !!lm[2], def = eng.AI_LADDER[lvl - 1];
    if (!def) throw new Error('no such ladder level: ' + spec);
    const w = def.w && def.w.zone ? def.w : eng.AI_LADDER[10].w;   // L1-type rungs borrow L11's eval
    return {
      name: 'L' + lvl + (corner ? '+corner' : ''),
      plan: idx => { const g = G(); (g.cornerOpening || (g.cornerOpening = [null, null]))[idx] = corner; return eng.ladderPlanFor(lvl - 1, idx); },
      leaf: idx => eng.ladderEval(idx, w),
    };
  }
  const parts = spec.split(':');
  if (parts[0] === 'dual') {
    const mp = parts.length > 2 ? parts.slice(2).join(':') : path.join(__dirname, 'models', 'dual.json');
    const dual = require('./dualnet.js').DualMLP.fromJSON(JSON.parse(fs.readFileSync(mp, 'utf8')));
    const usePolicy = /\+P$/i.test(parts[1] || '');
    return {
      name: 'dual(' + path.basename(mp) + (usePolicy ? ',+P' : '') + ')',
      plan: (idx, d) => nnPlanFor(eng, null, idx, { temperature: 0, depth: d || depth, keepForDepth, dual, dualPolicy: usePolicy, policyPrune: false }),
      leaf: idx => { const v = dual.value(features(eng)); return G().active === idx ? v : -v; },
    };
  }
  if (parts[0] !== 'nn') throw new Error('unknown committee member: ' + spec);
  const mp = parts.length > 2 ? parts.slice(2).join(':') : path.join(__dirname, 'models', 'best.json');
  const net = MLP.fromJSON(JSON.parse(fs.readFileSync(mp, 'utf8')));
  return {
    name: 'nn(' + path.basename(mp) + ')',
    plan: (idx, d) => nnPlanFor(eng, net, idx, { temperature: 0, depth: d || depth, keepForDepth }),
    leaf: idx => { const v = net.value(features(eng)); return G().active === idx ? v : -v; },
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
// Mover's score for `plan` in this member's eyes: play it, let the member answer at its own depth,
// then read the member's leaf. A finished game is engine-exact (+-1e6), which is the only verdict
// committee.js treats as "completely dead" -- a net saying -0.98 is an opinion, a thrown foot is not.
function judge(pose, active, plies, plan) {
  load(pose, active, plies);
  const idx = active;
  eng.applyPlanSearch(plan);
  let g = G();
  if (g.over) return g.winner === idx ? 1e6 : -1e6;
  const reply = member.plan(1 - idx, judgeDepth);
  if (reply) {
    eng.applyPlanSearch(reply);
    g = G();
    if (g.over) return g.winner === idx ? 1e6 : -1e6;
  }
  return member.leaf(idx);
}
function propose(pose, active, plies) {
  load(pose, active, plies);
  const p = member.plan(active);
  return p ? { pivotIdx: p.pivotIdx, dir: p.dir, targetRad: p.targetRad } : null;
}

port.on('message', job => {
  let out;
  try {
    if (job.type === 'propose') out = { id: job.id, plan: propose(job.pose, job.active, job.plies) };
    else if (job.type === 'judge') out = { id: job.id, scores: job.plans.map(p => judge(job.pose, job.active, job.plies, p)) };
    else out = { id: job.id, error: 'unknown job ' + job.type };
  } catch (e) { out = { id: job.id, error: e && e.stack || String(e) }; }
  port.postMessage(out);
  Atomics.add(CTRL, 0, 1);
  Atomics.notify(CTRL, 0);
});
port.postMessage({ ready: true, name: member.name });
Atomics.add(CTRL, 0, 1);
Atomics.notify(CTRL, 0);
