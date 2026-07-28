// Why does one net get BETTER with search depth and another get WORSE? Compares the value
// SURFACES of two or more nets over the same real positions, rather than comparing their games.
//
//   node nn/valueprobe.js models/arch-96x64x48.json models/arch-82x64x48x32.json [--n 400]
//
// The measured puzzle this exists for: at search depth 1 arch-82x64x48x32 ranked first (58%) and
// arch-96x64x48 third (55%); at depth 2 they swapped hard, 48% and 63%. Both saved epochs had
// near-identical val mse (0.6353 vs 0.6336), so "which fits the labels better" cannot explain it.
// Something about the SHAPE of the value surface must, and nnai.js says exactly where to look:
//
//   * the depth-1 ranking uses SMOOTHED scores -- each waypoint is averaged with its immediate
//     neighbours (w.s), which deliberately pulls down isolated spikes;
//   * the depth-2 re-rank scores leaves with RAW net.value(), no smoothing at all.
//
// So a jagged evaluator is protected at depth 1 and exposed at depth 2, which is the right shape
// of explanation for the swap. Three measurable properties follow, all computed here:
//
//   roughness  how far a waypoint sits from the mean of its neighbours along a real sweep,
//              normalised by that position's own value spread -- the same statistic nnai.js
//              already computes to decide how much to trust its own eval (its ROUGH_REF is 0.0225,
//              measured over 158 positions). Higher = spikier = more exposed by depth-2 search.
//   spread     std dev of values across positions. A net whose outputs cluster can still ORDER
//              sibling waypoints correctly (enough for greedy depth-1 play) while having little
//              resolution left to compare leaves down different lines, which is what depth 2 does.
//   saturation fraction of |value| > 0.9. tanh output saturation is the specific way spread
//              collapses: confident-looking, crisp argmax, no headroom to discriminate at leaves.
//
// Positions come from the accumulated data's stored poses (the `p` field), so this measures the
// nets where they are actually asked to play rather than on synthetic positions.
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { MLP } = require('./net.js');
const { features } = require('./features.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const modelPaths = process.argv.slice(2).filter(a => !a.startsWith('--') &&
  process.argv[process.argv.indexOf(a) - 1] !== '--n');
const N = +arg('n', 400);
const STEP_RAD = 3*Math.PI/180;      // nnai.js's own sweep step
const CAP_RAD = 170*Math.PI/180;
const MIN_MOVE = 2*Math.PI/180;

if (modelPaths.length < 1) {
  console.error('usage: node nn/valueprobe.js <model.json> [more.json ...] [--n 400]');
  process.exit(1);
}

// Reservoir-sample stored poses, same approach selfplay.js uses for seeding.
function loadPoses(dataDir, k) {
  const pool = [];
  let seen = 0, files = [];
  try { files = fs.readdirSync(dataDir).filter(f => f.endsWith('.jsonl')); } catch (e) { return pool; }
  for (const f of files) {
    let txt;
    try { txt = fs.readFileSync(path.join(dataDir, f), 'utf8'); } catch (e) { continue; }
    for (const line of txt.split('\n')) {
      if (!line) continue;
      try {
        const j = JSON.parse(line);
        if (!j.p || j.p.length !== 6 || (j.m !== 0 && j.m !== 1)) continue;
        seen++;
        if (pool.length < k) pool.push({ p: j.p, m: j.m });
        else { const r = Math.floor(Math.random()*seen); if (r < k) pool[r] = { p: j.p, m: j.m }; }
      } catch (e) {}
    }
  }
  return pool;
}

const eng = createEngine();
const restoreTo = pose => {
  eng.newGame();
  const g = eng.getG(), sp = pose.p;
  g.pieces[0].x = sp[0]; g.pieces[0].y = sp[1]; g.pieces[0].rot = sp[2];
  g.pieces[1].x = sp[3]; g.pieces[1].y = sp[4]; g.pieces[1].rot = sp[5];
  eng.setActive(pose.m);
};

// Walk the same sweeps nnai.js walks and collect this net's raw values along each arm.
function sweepValues(net, pose) {
  const idx = pose.m;
  const arms = [];
  const flat = [];
  for (let pv = 0; pv < 3; pv++) {
    for (const dir of [1, -1]) {
      restoreTo(pose);
      if (eng.getG().active !== idx) continue;
      eng.pinFoot(pv);
      const arm = [];
      let guard = 0;
      while (!eng.getG().atLimit && Math.abs(eng.getG().netRad) < CAP_RAD && guard++ < 200) {
        eng.applySwing(dir*STEP_RAD);
        const g = eng.getG();
        if (Math.abs(g.netRad) < MIN_MOVE) { if (g.atLimit) break; continue; }
        // skip throws: engine-exact, not eval output (nnai.js excludes them from roughness too)
        const oppOff = g.pieces[1 - idx].feet().some(f => Math.hypot(f.x, f.y) > eng.CFG.edgeU + eng.CFG.edgeEps);
        if (oppOff) break;
        g.active = 1 - idx;
        const v = -net.value(features(eng));
        g.active = idx;
        arm.push(v); flat.push(v);
      }
      if (arm.length >= 3) arms.push(arm);
    }
  }
  return { arms, flat };
}

const poses = loadPoses(path.join(__dirname, 'data'), N);
if (!poses.length) { console.error('no stored poses found in nn/data — run selfplay first'); process.exit(1); }
console.log(`probing ${modelPaths.length} net(s) over ${poses.length} stored positions\n`);

const rows = [];
for (const mp of modelPaths) {
  const net = MLP.fromJSON(JSON.parse(fs.readFileSync(mp, 'utf8')));
  let roughSum = 0, roughN = 0;
  const all = [];
  for (const pose of poses) {
    const { arms, flat } = sweepValues(net, pose);
    if (flat.length < 3) continue;
    let lo = Infinity, hi = -Infinity;
    for (const v of flat) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const spread = hi - lo;
    if (spread < 1e-9) continue;
    // normalised roughness, exactly nnai.js's definition
    for (const arm of arms)
      for (let i = 1; i + 1 < arm.length; i++) {
        roughSum += Math.abs(arm[i] - (arm[i-1] + arm[i+1])/2)/spread;
        roughN++;
      }
    for (const v of flat) all.push(v);
  }
  const mean = all.reduce((a, b) => a + b, 0)/all.length;
  const sd = Math.sqrt(all.reduce((a, b) => a + (b - mean)*(b - mean), 0)/all.length);
  const sat = all.filter(v => Math.abs(v) > 0.9).length/all.length;
  rows.push({ name: path.basename(mp), rough: roughN ? roughSum/roughN : 0, sd, sat, n: all.length });
}

const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
console.log(pad('model', 30) + padL('roughness', 11) + padL('spread(sd)', 12) + padL('|v|>0.9', 9));
console.log('-'.repeat(62));
for (const r of rows)
  console.log(pad(r.name, 30) + padL(r.rough.toFixed(4), 11) +
              padL(r.sd.toFixed(4), 12) + padL((100*r.sat).toFixed(1) + '%', 9));
console.log(`\nnnai.js's reference roughness (measured over 158 positions) is 0.0225.`);
console.log(`Higher roughness / lower spread / higher saturation all predict a net that search`);
console.log(`should help LESS, since depth-2 leaf scoring uses raw values with no smoothing.`);
