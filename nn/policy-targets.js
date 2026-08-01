// Mint policy-head training targets from the self-play data that ALREADY exists -- no games are
// replayed. Every row selfplay.js writes carries the raw pose (`p`) and mover (`m`), and a game's
// rows are contiguous and in ply order under one `g` tag. So for consecutive rows of a game, the
// move played at row i is fully reconstructible from the pose delta:
//   the mover's piece rotated about its pinned foot, so rot[i+1]-rot[i] IS the signed swing
//   (dir = its sign, targetRad = its magnitude), and the pivot foot is the mover's one foot
//   whose world position did not change.
// The reconstructed move is then re-expressed in the canonical frame the feature vector lives in
// (features.moveFrame): pivot as a radius-sorted slot, direction flipped by the mirror. Rows
// without pose/tag (the pre-tagging era) are skipped -- they only ever feed the value head.
//
// KNOWN GAP: each game's FINAL move (the one that won it, usually a throw) has no successor row,
// so it cannot be reconstructed and the policy never trains on "play the throw". That is fine by
// construction: search detects throws engine-exactly and ranks them above everything before the
// policy is ever consulted -- pruning must simply never drop throw candidates (see nnai.js).
//
//   node nn/policy-targets.js [--data nn/data] [--out nn/data/policy-targets.jsonl]
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { moveFrame } = require('./features.js');
const { armIndex, binIndex } = require('./policy.js');

const MIN_MOVE = 2*Math.PI/180;    // below this the engine treats it as a non-move; also skips
                                   // the null-plan "pass" rows (pose unchanged, active swapped)

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function norm(a) { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; }

function main() {
  const dataDir = arg('data', path.join(__dirname, 'data'));
  // NOT inside dataDir: train.js globs nn/data/*.jsonl, and these rows carry a real `f` and `z`,
  // so they pass its validation and get trained on as VALUE data -- silently double-weighting
  // every position the miner could reconstruct (and only those: a game's final, usually throwing,
  // move has no successor row to diff, so finishes keep single weight while the rest count twice).
  const outPath = arg('out', path.join(__dirname, 'policy-targets.jsonl'));
  const eng = createEngine();
  eng.newGame();
  const G = eng.getG(), footR = eng.CFG.footR;

  const setPose = (p, mover) => {
    for (let i = 0; i < 2; i++) {
      G.pieces[i].x = p[i*3]; G.pieces[i].y = p[i*3 + 1]; G.pieces[i].rot = p[i*3 + 2];
    }
    G.active = mover;
  };
  const feetOf = (p, pieceIdx) => {
    const x = p[pieceIdx*3], y = p[pieceIdx*3 + 1], rot = p[pieceIdx*3 + 2];
    const out = [];
    for (let k = 0; k < 3; k++) {
      const a = rot + k*2*Math.PI/3;
      out.push({ x: x + Math.cos(a)*footR, y: y + Math.sin(a)*footR });
    }
    return out;
  };

  const files = fs.readdirSync(dataDir)
    .filter(f => f.endsWith('.jsonl') && !f.startsWith('policy-targets')).sort();
  const ws = fs.createWriteStream(outPath);
  let games = 0, targets = 0, skippedRows = 0, passRows = 0, ambiguous = 0;

  for (const file of files) {
    let txt;
    try { txt = fs.readFileSync(path.join(dataDir, file), 'utf8'); } catch (e) { continue; }
    let prev = null;   // previous parsed row of the SAME game
    let prevGame = null;
    for (const line of txt.split('\n')) {
      if (!line) continue;
      let j;
      try { j = JSON.parse(line); } catch (e) { continue; }
      if (!j.p || j.m === undefined || j.g == null) { skippedRows++; prev = null; prevGame = null; continue; }
      if (j.g !== prevGame) { if (prevGame !== null) games++; prev = null; prevGame = j.g; }
      if (prev) {
        const mover = prev.m;
        const dRot = norm(j.p[mover*3 + 2] - prev.p[mover*3 + 2]);
        if (Math.abs(dRot) < MIN_MOVE) { passRows++; prev = j; continue; }   // null-plan pass
        // pivot = the mover's foot that stayed put. With a rotation this size exactly one can.
        const before = feetOf(prev.p, mover), after = feetOf(j.p, mover);
        let pivotIdx = -1, best = Infinity, second = Infinity;
        for (let k = 0; k < 3; k++) {
          const d = Math.hypot(after[k].x - before[k].x, after[k].y - before[k].y);
          if (d < best) { second = best; best = d; pivotIdx = k; }
          else if (d < second) second = d;
        }
        // sanity: the pivot must be genuinely stationary and clearly separated from the runner-up
        // (a tiny rotation moves all feet a similar hair -- those are not usable targets)
        if (best > 0.05 || second < 0.5) { ambiguous++; prev = j; continue; }
        // canonical frame AT THE DECISION POSITION (prev), for the mover
        setPose(prev.p, mover);
        const frame = moveFrame(eng);
        const slot = frame.order.indexOf(pivotIdx);
        const arm = armIndex(slot, (dRot > 0 ? 1 : -1)*frame.mirror);
        const bin = binIndex(dRot);
        // `mv` rides along when present so train-policy.js can weight by the mover's CURRENT pool
        // rating at train time (see eloweight.js for why the id and not the rating is stored).
        ws.write(JSON.stringify({ f: prev.f, arm, bin, z: prev.z, g: prev.g,
                                  ...(prev.mv ? { mv: prev.mv } : {}) }) + '\n');
        targets++;
      }
      prev = j;
    }
    if (prevGame !== null) { games++; prevGame = null; prev = null; }
  }
  ws.end(() => console.log(
    `policy targets: ${targets} moves reconstructed from ${games} games -> ${outPath}\n` +
    `(skipped: ${skippedRows} rows without pose/tag, ${passRows} null-plan passes, ` +
    `${ambiguous} ambiguous-pivot rotations)`));
}

main();
