'use strict';
// Astra/GPT's request (PR #34 CLAUDE-RESPONSE.md, "Request for reply-band maps"): for a given
// position with the defender to move, map every arm's reachable stops and, at each one, whether
// EVERY endpoint attacker response is legal and whether it throws the defender -- i.e. an
// endpoint-response counterexample to D_E(q) in the response's own terms, not a Boolean escape
// verdict alone. Group consecutive counterexample stops into bands; keep isolated exceptions
// separate; report the two call schedules (one-degree-plus-final-partial, and quarter-degree)
// separately, because the finite engine map depends on its call subdivision and nominal stop angle
// alone does not identify the computed state.
//
// Run: node map-position.js --pose x0,y0,r0,x1,y1,r1 --victim 0|1 [--label name] [--json out.json]
//
// What this DOES: for the fixed post-move pose given, and for the defender's OWN move already
// played to reach each sampled stop, tests the attacker's six swing-to-the-jam endpoint responses
// (pinFoot + swing to the natural limit -- the same six ladderScore3 checks) and records, for each:
// legality, whether it throws the defender, and outermostRadU(defender) afterward as a continuous
// proxy for "how close" a non-throwing response came (NOT the certified geometric margin from
// nn/forced-win.js/contact-law.js -- that is a different, much more expensive computation this
// script does not attempt).
//
// What this does NOT do: it does not test interior attacker stops (that is D_1, not D_E -- see
// CLAUDE-RESPONSE.md's formalization), does not vary the attacker's pose, and is not a proof of
// anything. It is exactly what it says: a map of one search's own vocabulary over one position.
const fs = require('fs'), path = require('path'), Module = require('module');
const DEG = 180 / Math.PI;

// Several names this script needs (ladderRestore, HARD_MIN_MOVE_RAD, AI_SAFETY_CAP_RAD) are not in
// nn/engine.js's default export set on either branch. Rather than edit engine.js on disk (which
// would make this script branch-specific), patch the extraction in memory -- the same technique
// docs/geometry-reviews/l13-l17-stop-audit/stop-coverage.js uses, so a reader of one recognises the
// other.
const WANT = ['ladderRestore', 'HARD_MIN_MOVE_RAD', 'AI_SAFETY_CAP_RAD', 'AI_STEP_RAD'];
function loadEngine(root) {
  const enginePath = path.join(root, 'nn/engine.js');
  const has = n => new RegExp(`^(?:function\\s*\\*?|class|const|let)\\s+${n}\\b`, 'm')
    .test(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  const present = WANT.filter(has);
  const src = fs.readFileSync(enginePath, 'utf8')
    .replace('const SEEDS = [', `const SEEDS = [${present.map(n => `'${n}',`).join('')}`)
    .replace('__exports = {', `__exports = {${present.map(n => `${n},`).join('')}`);
  const m = new Module(enginePath, module);
  m.filename = enginePath; m.paths = Module._nodeModulePaths(path.dirname(enginePath));
  m._compile(src, enginePath);
  return m.exports.createEngine();
}

const ROOT = path.resolve(process.env.TAU_ROOT || path.resolve(__dirname, '../../../..'));
const eng = loadEngine(ROOT);

function sweepArm(pose, victim, pivotIdx, dir, callDeg) {
  const att = 1 - victim;
  const call = callDeg / DEG;
  const load = () => {
    eng.newGame(); const g = eng.getG();
    g.pieces.forEach((q, i) => { q.x = pose[3 * i]; q.y = pose[3 * i + 1]; q.rot = pose[3 * i + 2]; });
    g.active = victim; return g;
  };
  // find the arm's natural limit under a coarse sweep first, so we know where to stop
  load(); eng.pinFoot(pivotIdx);
  let g = eng.getG(), guard = 0;
  const commanded = [];
  while (Math.abs(g.netRad) < eng.AI_SAFETY_CAP_RAD && !g.atLimit && guard++ < 2000) {
    const before = Math.abs(g.netRad);
    eng.applySwing(dir * call);
    commanded.push(+(call * DEG).toFixed(6));
  }
  const limitDeg = Math.abs(g.netRad) * DEG;
  const atLimit = g.atLimit;
  const legAfterLimit = !g.pieces[victim].anyFootOff();

  // now re-walk the same arm, testing every stop that lands (a real reachable state under this call
  // schedule), recording the six endpoint responses at each. Response-testing calls ladderRestore
  // and simMoveToLimit, which mutate the SAME live G the outer sweep is walking (netRad, atLimit,
  // turnDir, crossings, contact, active all get touched) -- so the sweep's own progress has to be
  // saved and restored around each response-testing block, not just the pose. (Caught by a smoke
  // test: without this, every arm reported exactly one stop no matter its true limit, because
  // ladderRestore's netRad=0 reset silently restarted the sweep from scratch after every stop.)
  load(); eng.pinFoot(pivotIdx);
  g = eng.getG(); guard = 0;
  const stops = [];
  const testResponses = snap => {
    const responses = [];
    for (let ap = 0; ap < 3; ap++) for (const ad of [1, -1]) {
      eng.ladderRestore(snap);
      eng.setActive(att);
      const anet = eng.simMoveToLimit(ap, ad);
      const gg = eng.getG();
      const legal = Math.abs(anet) >= eng.HARD_MIN_MOVE_RAD && !gg.pieces[att].anyFootOff();
      const throws = legal && gg.pieces[victim].anyFootOff();
      responses.push({
        pivotIdx: ap, dir: ad, legal,
        throwsDefender: legal ? throws : null,
        defenderOutermostRadUAfter: legal ? +eng.outermostRadU(gg.pieces[victim]).toFixed(6) : null,
      });
    }
    return responses;
  };
  while (Math.abs(g.netRad) < eng.AI_SAFETY_CAP_RAD && !g.atLimit && guard++ < 2000) {
    eng.applySwing(dir * call);
    const a = Math.abs(g.netRad);
    if (a < eng.HARD_MIN_MOVE_RAD) continue;
    if (g.pieces[victim].anyFootOff()) continue;   // the move itself throws the attacker -- not a defender stop to test replies from
    // save the sweep's own progress before it gets clobbered by response-testing
    const sweepSnap = eng.takeSnap();
    const sweepNetRad = g.netRad, sweepAtLimit = g.atLimit, sweepTurnDir = g.turnDir,
          sweepCrossings = g.crossings, sweepContact = g.contact, sweepPinned = g.pinned;
    const responses = testResponses(sweepSnap);
    // restore full sweep state -- pose AND the turn-tracking fields ladderRestore zeroes
    eng.ladderRestore(sweepSnap);
    g.netRad = sweepNetRad; g.atLimit = sweepAtLimit; g.turnDir = sweepTurnDir;
    g.crossings = sweepCrossings; g.contact = sweepContact; g.pinned = sweepPinned;
    eng.setActive(victim);
    const everyResponseThrowsDefender = responses.every(r => r.legal && r.throwsDefender);
    stops.push({
      deg: +(a * DEG).toFixed(6), atLimit: sweepAtLimit,
      pose: g.pieces.map(p => ({ x: +p.x.toFixed(6), y: +p.y.toFixed(6), rot: +p.rot.toFixed(6) })),
      responses, endpointCounterexampleToD_E: everyResponseThrowsDefender,
    });
  }
  return { pivotIdx, dir, callDeg, commandedCalls: commanded.length, limitDeg: +limitDeg.toFixed(6), atLimit, legAfterLimit, stops };
}

function groupBands(stops, resolutionDeg) {
  const witnessed = stops.filter(s => s.endpointCounterexampleToD_E);
  const bands = [];
  let cur = null;
  for (const s of witnessed) {
    if (cur && s.deg - cur.maxDeg <= resolutionDeg * 1.5) { cur.maxDeg = s.deg; cur.count++; }
    else { cur = { minDeg: s.deg, maxDeg: s.deg, count: 1 }; bands.push(cur); }
  }
  const isolated = bands.filter(b => b.count === 1).map(b => b.minDeg);
  return { bands, isolatedCount: isolated.length, isolatedDeg: isolated };
}

function mapPosition(pose, victim, label) {
  const out = { label, sourcePin: null, pose, victim, sideAssumptions: {
    note: 'fresh engine.newGame() then pose set directly; no ko history; single defender ply from this position; active side reset to victim before each arm sweep',
  }, arms: {} };
  for (const [schedName, callDeg] of [['oneDegPlusFinal', 1], ['quarterDeg', 0.25]]) {
    out.arms[schedName] = [];
    for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
      const arm = sweepArm(pose, victim, pv, dir, callDeg);
      arm.bands = groupBands(arm.stops, callDeg);
      out.arms[schedName].push(arm);
    }
  }
  return out;
}

function main() {
  const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const poseArg = argOf('--pose'); if (!poseArg) throw new Error('--pose x0,y0,r0,x1,y1,r1 required');
  const pose = poseArg.split(',').map(Number);
  if (pose.length !== 6 || pose.some(isNaN)) throw new Error('bad --pose');
  const victim = +argOf('--victim', '0');
  const label = argOf('--label', 'unlabeled');
  const result = mapPosition(pose, victim, label);
  // slim summary alongside the full map, since the full map with per-stop 6-response detail is large
  const summary = { label, pose, victim, arms: {} };
  for (const sched of Object.keys(result.arms)) {
    summary.arms[sched] = result.arms[sched].map(a => ({
      pivotIdx: a.pivotIdx, dir: a.dir, limitDeg: a.limitDeg, stopCount: a.stops.length,
      counterexampleBands: a.bands.bands.map(b => `${b.minDeg.toFixed(3)}-${b.maxDeg.toFixed(3)} (${b.count} stops)`),
      isolatedCounterexamples: a.bands.isolatedDeg,
    }));
  }
  const j = argOf('--json', null);
  if (j) { fs.writeFileSync(j, JSON.stringify(result, null, 1) + '\n'); console.error(`wrote full map to ${j}`); }
  console.log(JSON.stringify(summary, null, 2));
}
main();
