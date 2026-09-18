'use strict';
// Brain factory shared by the timing test and the playoff: L<n> ladder rungs and best.json at a depth.
const fs = require('fs'), path = require('path');
const REPO = process.env.TAU_REPO || path.resolve(__dirname, '..', '..');
const { createEngine } = require(path.join(REPO, 'nn/engine.js'));
const { MLP } = require(path.join(REPO, 'nn/net.js'));
const { nnPlanFor } = require(path.join(REPO, 'nn/nnai.js'));
let netCache = {};
function net(file) { if (!netCache[file]) netCache[file] = MLP.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8'))); return netCache[file]; }
function makeBrain(eng, spec) {
  let m;
  if ((m = /^L(\d+)$/.exec(spec))) { const lvl = +m[1]; return { name: spec, fn: idx => eng.ladderPlanFor(lvl - 1, idx) }; }
  if ((m = /^best@D(\d)$/.exec(spec))) {
    const d = +m[1], n = net(path.join(REPO, 'nn/models/best.json'));
    return { name: spec, fn: idx => nnPlanFor(eng, n, idx, { temperature: 0, depth: d, keepForDepth: 4 }) };
  }
  throw new Error('unknown brain ' + spec);
}
function loadPose(eng, pose, active, plies) {
  const g = eng.getG();
  g.pieces.forEach((p, i) => { p.x = pose[i][0]; p.y = pose[i][1]; p.rot = pose[i][2]; });
  g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
  g.pinned = null; g.pivot = null; g.active = active; g.over = false; g.winner = null;
  g.plies = plies || 0; g.adjudicated = false;
  if (g.cornerOpening) { g.cornerOpening = [false, false]; g.cornerDone = [true, true]; }
  if (typeof eng.koReset === 'function') eng.koReset();
}
module.exports = { createEngine, makeBrain, loadPose, REPO };
