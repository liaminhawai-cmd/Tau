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
// SOURCE FILTER (default on): a row's `mv` tag (selfplay.js) identifies the brain that chose the
// move -- an "L7" ladder id, or "ckpt-105@D2"/"best@D1" for a net search. Only rows played by a net
// at depth >= --minDepth (default 2) are kept by default. Two things are true at once here:
//   - ladder-mover rows are the opponent's move, not ours -- imitating them caps the policy at
//     whatever the fixed heuristic ladder does, the same ceiling the value net's own training mix
//     was just rebalanced away from (see run.js's lossWeight commit). Over half the historical
//     corpus is ladder-involving play by row count (see claude-digest.md's per-mover table).
//   - depth-1 net moves have NO recursive opponent search behind them (nnai.js's lookahead starts
//     at depth 2) -- they are closer to a single-shot eval pick than a policy-improvement target.
// Pass --allSources to restore the old unfiltered behaviour (useful for an A/B against this filter).
// Untagged rows (`mv` missing, pre-tagging era) are excluded by default for the same reason: their
// source can't be verified, so they can't be trusted as "real search" targets either.
//
// KNOWN GAP (mitigated below, not eliminated): each game's FINAL move (the one that won it, usually
// a throw) has no successor row, so the primary diff above can never reconstruct it -- confirmed
// blind spot, see nnai.js's "policy systematically under-rates throw arms" comment. tryMineThrow()
// recovers an APPROXIMATE target for it instead of leaving the gap: see that function's own header
// for exactly what is and isn't trustworthy about it. Pass --noThrows to disable just that half.
//
//   node nn/policy-targets.js [--data nn/data] [--out nn/data/policy-targets.jsonl]
//                             [--minDepth 2] [--allSources] [--noThrows]
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { moveFrame } = require('./features.js');
const { armIndex, binIndex, CAP_RAD } = require('./policy.js');

const MIN_MOVE = 2*Math.PI/180;    // below this the engine treats it as a non-move; also skips
                                   // the null-plan "pass" rows (pose unchanged, active swapped)
const STEP_RAD = 3*Math.PI/180;    // the engine brains' own sampling step (matches nnai.js's STEP_RAD)

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
  const minDepth = +arg('minDepth', 2);
  const allSources = process.argv.includes('--allSources');
  const noThrows = process.argv.includes('--noThrows');
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

  // Classifies a row's `mv` tag against --minDepth / --allSources. Returns null if the row passes
  // (nothing to skip), else a reason string used to bump the right counter at the call site.
  const sourceReject = mv => {
    if (allSources) return null;
    if (!mv) return 'untagged';
    if (/^L\d+$/.test(mv)) return 'ladder';
    const dm = /@D(\d+)$/.exec(mv);
    if (!dm) return 'untagged';           // unrecognised mv format -- don't guess, exclude
    return +dm[1] < minDepth ? 'shallow' : null;
  };

  // THROW RECONSTRUCTION: a game's winning move (usually a throw) has no successor row, so the main
  // loop below never sees it. Recover an APPROXIMATE target instead of leaving the gap: from the
  // final recorded position, re-sweep the mover's own 6 arms with the exact contact-physics check
  // every brain already uses to detect a throw (see nnai.js's opponentHasThrow), and take the FIRST
  // one that pushes the opponent's foot off the rim. This is not necessarily the exact swing distance
  // the mover actually chose -- only that some throw was available and taken is known, not which one
  // -- but every brain in this codebase ranks a throw waypoint above everything else the instant one
  // appears (ladderEval / nnPlanFor both score a throw candidate at ~1e6), so "stops at the first
  // available throw" is what virtually every existing mover actually does. Rows from this path are
  // tagged `thrown:1` so they stay distinguishable from the exact diff-reconstructed targets above,
  // and are subject to the same --minDepth/--allSources source filter (a ladder brain's throw is
  // still the ladder's play, not the net's).
  let throwTargets = 0, throwMissed = 0, throwFiltered = 0;
  function tryMineThrow(finalRow, ws) {
    if (!finalRow || finalRow.adj || !(finalRow.z > 0)) return;  // draw, loss, or an adjudicated
                                                                   // (non-literal) win: no throw here
    const reason = sourceReject(finalRow.mv);
    if (reason) { throwFiltered++; return; }
    const mover = finalRow.m, victim = 1 - mover;
    setPose(finalRow.p, mover);
    const frame = moveFrame(eng);
    const snap = eng.takeSnap();
    const reset = () => {
      const g = eng.getG();
      g.pieces.forEach((p, i) => { p.x = snap[i].x; p.y = snap[i].y; p.rot = snap[i].rot; });
      g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
      g.pinned = null; g.pivot = null; g.active = mover; g.over = false; g.winner = null;
    };
    for (let pv = 0; pv < 3; pv++) {
      for (const dir of [1, -1]) {
        reset(); eng.pinFoot(pv);
        let guard = 0, rad = 0;
        while (!eng.getG().atLimit && Math.abs(eng.getG().netRad) < CAP_RAD && guard++ < 200) {
          eng.applySwing(dir*STEP_RAD); rad = Math.abs(eng.getG().netRad);
          if (eng.getG().pieces[victim].feet().some(f =>
              Math.hypot(f.x, f.y) > eng.CFG.edgeU + eng.CFG.edgeEps)) {
            const slot = frame.order.indexOf(pv);
            const arm = armIndex(slot, dir*frame.mirror);
            const bin = binIndex(rad);
            ws.write(JSON.stringify({ f: finalRow.f, arm, bin, z: finalRow.z, g: finalRow.g,
                                      thrown: 1, ...(finalRow.mv ? { mv: finalRow.mv } : {}) }) + '\n');
            throwTargets++;
            reset();
            return;
          }
        }
      }
    }
    reset();
    throwMissed++;   // z>0, not adjudicated, yet no arm's sweep reproduces a throw -- worth knowing
                      // the rate of, since a high count would mean this reconstruction is unreliable
  }

  const files = fs.readdirSync(dataDir)
    .filter(f => f.endsWith('.jsonl') && !f.startsWith('policy-targets')).sort();
  const ws = fs.createWriteStream(outPath);
  let games = 0, targets = 0, skippedRows = 0, passRows = 0, ambiguous = 0;
  let ladderSkipped = 0, shallowSkipped = 0, untaggedSkipped = 0;

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
      if (j.g !== prevGame) {
        if (prevGame !== null) { games++; if (!noThrows) tryMineThrow(prev, ws); }
        prev = null; prevGame = j.g;
      }
      if (prev) {
        const mover = prev.m;
        const reason = sourceReject(prev.mv);
        if (reason) {
          if (reason === 'ladder') ladderSkipped++;
          else if (reason === 'shallow') shallowSkipped++;
          else untaggedSkipped++;
          prev = j; continue;
        }
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
    if (prevGame !== null) { games++; if (!noThrows) tryMineThrow(prev, ws); prevGame = null; prev = null; }
  }
  ws.end(() => console.log(
    `policy targets: ${targets} moves reconstructed from ${games} games -> ${outPath}\n` +
    (noThrows ? '' : `(+ ${throwTargets} throw targets recovered, ${throwMissed} misses, ${throwFiltered} filtered by source)\n`) +
    `(skipped: ${skippedRows} rows without pose/tag, ${passRows} null-plan passes, ` +
    `${ambiguous} ambiguous-pivot rotations)\n` +
    (allSources ? '(source filter: OFF, --allSources)'
      : `(source filter: minDepth ${minDepth} -- excluded ${ladderSkipped} ladder-mover, ` +
        `${shallowSkipped} shallow-depth, ${untaggedSkipped} untagged rows)`)));
}

main();
