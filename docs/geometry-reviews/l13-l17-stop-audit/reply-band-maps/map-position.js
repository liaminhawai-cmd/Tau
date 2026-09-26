'use strict';
// Reply-band maps (Astra/GPT's request, PR #34 CLAUDE-RESPONSE.md): for a position with the defender
// to move, walk every defender arm under a fixed call schedule, and at each reachable stop test the
// attacker's six swing-to-the-jam endpoint responses -- the six ladderScore3 and ladderDeadEscape use.
//
// A nonterminal defender stop is PUNISHED if at least one legal endpoint response throws the
// defender, and is an ENDPOINT COUNTEREXAMPLE to D_E(q) if none does:
//   counterexample = !responses.some(r => r.legal && r.throwsDefender)
// A stop where the defender's own move throws the attacker is TERMINAL: the defender has won, so it
// is an escape without any reply (ladderDeadEscape returns it straight away). A stop where the
// defender throws itself is not a legal defender move and is excluded, again as ladderDeadEscape does.
//
// Verdicts are relative to the tested response set and the call schedule. "No counterexample on
// this grid" is not D_E, and a counterexample refutes D_E only -- an interior attacker stop, or a
// later continuation, may still win (D_1 and beyond are not tested here).
//
// ISOLATION: the whole arm is swept first and every landed stop snapshotted; replies are tested only
// afterwards, from each snapshot. Nothing the reply simulation touches (G.pivot, G.pinned,
// G.pushContact, the turn accumulators, G.active) can reach the defender's sweep. The previous
// version tested replies in the middle of the sweep and restored G by hand; it missed G.pivot, so
// every later stop on the arm rotated about the attacker's last pivot foot.
//
// Run: node map-position.js --pose x0,y0,r0,x1,y1,r1 --victim 0|1 [--label name] [--json out.json]
//      TAU_ROOT=<dir with index.html and nn/engine.js>  TAU_SOURCE_REV=<commit it came from>
const fs = require('fs'), path = require('path'), crypto = require('crypto'), Module = require('module');
const DEG = 180 / Math.PI;

// ladderRestore, HARD_MIN_MOVE_RAD and AI_SAFETY_CAP_RAD are not in nn/engine.js's default exports on
// every revision, so the export list is patched in memory -- the same technique stop-coverage.js uses.
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
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
const SOURCE_PIN = {
  rev: process.env.TAU_SOURCE_REV || null,
  indexHtmlSha256: sha256('index.html'),
  engineJsSha256: sha256('nn/engine.js'),
};

function loadPose(pose, active) {
  eng.newGame();
  const g = eng.getG();
  g.pieces.forEach((q, i) => { q.x = pose[3 * i]; q.y = pose[3 * i + 1]; q.rot = pose[3 * i + 2]; });
  g.active = active;
  return g;
}

// Pass 1: the defender's arm, uninterrupted. Every call that lands is a stop.
function sweep(pose, victim, pivotIdx, dir, callDeg) {
  const call = callDeg / DEG;
  const g = loadPose(pose, victim);
  eng.pinFoot(pivotIdx);
  const stops = [];
  let guard = 0, calls = 0, selfThrows = 0, belowMin = 0;
  while (Math.abs(g.netRad) < eng.AI_SAFETY_CAP_RAD && !g.atLimit && guard++ < 4000) {
    eng.applySwing(dir * call); calls++;
    const a = Math.abs(g.netRad);
    if (a < eng.HARD_MIN_MOVE_RAD) { belowMin++; continue; }
    if (g.pieces[victim].anyFootOff()) { selfThrows++; continue; }
    stops.push({ deg: a * DEG, atLimit: g.atLimit, snap: eng.takeSnap(),
                 attackerThrown: g.pieces[1 - victim].anyFootOff() });
  }
  return { stops, calls, selfThrows, belowMin, limitDeg: Math.abs(g.netRad) * DEG, endedAtLimit: g.atLimit };
}

// Pass 2: the six endpoint replies from one stop, each from a fresh restore of that stop.
function testReplies(snap, victim) {
  const att = 1 - victim, out = [];
  for (let ap = 0; ap < 3; ap++) for (const ad of [1, -1]) {
    eng.ladderRestore(snap);
    eng.setActive(att);
    const anet = eng.simMoveToLimit(ap, ad);
    const gg = eng.getG();
    const legal = Math.abs(anet) >= eng.HARD_MIN_MOVE_RAD && !gg.pieces[att].anyFootOff();
    out.push({
      pivotIdx: ap, dir: ad, legal,
      throwsDefender: legal ? gg.pieces[victim].anyFootOff() : null,
      defenderOutermostRadUAfter: legal ? +eng.outermostRadU(gg.pieces[victim]).toFixed(6) : null,
    });
  }
  return out;
}

const samePose = (s, t) => s.length === t.length && s.every((p, i) => p.x === t[i].x && p.y === t[i].y && p.rot === t[i].rot);

function mapArm(pose, victim, pivotIdx, dir, callDeg) {
  const sw = sweep(pose, victim, pivotIdx, dir, callDeg);
  const stops = sw.stops.map(st => {
    const base = { deg: +st.deg.toFixed(6), atLimit: st.atLimit,
                   pose: st.snap.map(p => ({ x: +p.x.toFixed(6), y: +p.y.toFixed(6), rot: +p.rot.toFixed(6) })) };
    if (st.attackerThrown) return { ...base, kind: 'terminal-escape', responses: null };
    const responses = testReplies(st.snap, victim);
    const punished = responses.some(r => r.legal && r.throwsDefender);
    return { ...base, kind: punished ? 'punished' : 'counterexample',
             legalResponses: responses.filter(r => r.legal).length,
             winningResponses: responses.filter(r => r.legal && r.throwsDefender).length, responses };
  });
  // The replies must not have moved the sweep: re-sweep and compare every stop bit for bit.
  const again = sweep(pose, victim, pivotIdx, dir, callDeg);
  const isolated = again.stops.length === sw.stops.length &&
                   again.stops.every((s, i) => samePose(s.snap, sw.stops[i].snap));
  if (!isolated) throw new Error(`arm ${pivotIdx}/${dir} at ${callDeg} deg: re-sweep disagrees with the mapped sweep`);
  const maxStop = sw.stops.length ? Math.max(...sw.stops.map(s => s.deg)) : 0;
  if (maxStop > sw.limitDeg) throw new Error(`arm ${pivotIdx}/${dir}: stop at ${maxStop} beyond the arm's end ${sw.limitDeg}`);
  return { pivotIdx, dir, callDeg, calls: sw.calls, limitDeg: +sw.limitDeg.toFixed(6), endedAtLimit: sw.endedAtLimit,
           excluded: { belowMinMove: sw.belowMin, defenderThrowsItself: sw.selfThrows }, resweepIdentical: isolated, stops };
}

// Consecutive counterexample stops (terminal escapes count as escapes) grouped into bands.
function groupBands(stops, callDeg) {
  const bands = [];
  let cur = null;
  for (const s of stops) {
    if (s.kind === 'punished') { cur = null; continue; }
    if (cur) { cur.maxDeg = s.deg; cur.count++; cur.kinds.add(s.kind); }
    else { cur = { minDeg: s.deg, maxDeg: s.deg, count: 1, kinds: new Set([s.kind]) }; bands.push(cur); }
  }
  return bands.map(b => ({ minDeg: b.minDeg, maxDeg: b.maxDeg, count: b.count, kinds: [...b.kinds] }));
}

function mapPosition(pose, victim, label) {
  const out = { label, sourcePin: SOURCE_PIN, pose, victim,
    method: 'defender arm swept uninterrupted first; six endpoint replies tested afterwards from each stop snapshot; ' +
            'counterexample = nonterminal stop with no legal throwing endpoint reply; terminal-escape = the defender stop throws the attacker; ' +
            'no stop budget; fresh engine.newGame() with the pose set directly, no ko history',
    arms: {} };
  for (const [sched, callDeg] of [['oneDegPlusFinal', 1], ['quarterDeg', 0.25]]) {
    out.arms[sched] = [];
    for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
      const arm = mapArm(pose, victim, pv, dir, callDeg);
      arm.bands = groupBands(arm.stops, callDeg);
      out.arms[sched].push(arm);
    }
  }
  return out;
}

function summarise(result) {
  const s = { label: result.label, sourcePin: result.sourcePin, pose: result.pose, victim: result.victim, schedules: {} };
  for (const [sched, arms] of Object.entries(result.arms)) {
    const all = arms.flatMap(a => a.stops);
    const count = k => all.filter(x => x.kind === k).length;
    s.schedules[sched] = {
      stops: all.length, punished: count('punished'), counterexamples: count('counterexample'),
      terminalEscapes: count('terminal-escape'),
      verdictOnThisGrid: count('counterexample') + count('terminal-escape') > 0
        ? 'endpoint counterexample found (refutes D_E only)' : 'no endpoint counterexample on this grid',
      arms: arms.map(a => ({
        pivotIdx: a.pivotIdx, dir: a.dir, limitDeg: a.limitDeg, stops: a.stops.length,
        punished: a.stops.filter(x => x.kind === 'punished').length,
        escapeBands: a.bands.map(b => `${b.minDeg.toFixed(3)}-${b.maxDeg.toFixed(3)} (${b.count} stop${b.count > 1 ? 's' : ''}${b.kinds.includes('terminal-escape') ? ', incl. terminal' : ''})`),
      })),
    };
  }
  return s;
}

function main() {
  const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const poseArg = argOf('--pose'); if (!poseArg) throw new Error('--pose x0,y0,r0,x1,y1,r1 required');
  const pose = poseArg.split(',').map(Number);
  if (pose.length !== 6 || pose.some(isNaN)) throw new Error('bad --pose');
  const victim = +argOf('--victim', '0');
  const result = mapPosition(pose, victim, argOf('--label', 'unlabeled'));
  const j = argOf('--json', null);
  if (j) { fs.writeFileSync(j, JSON.stringify(result) + '\n'); console.error(`wrote full map to ${j}`); }
  console.log(JSON.stringify(summarise(result), null, 2));
}
if (require.main === module) main();
module.exports = { mapPosition, summarise, sweep, testReplies, eng };
