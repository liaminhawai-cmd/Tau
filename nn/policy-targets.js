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
// PER-FILE CACHE (on by default): mining re-walks the WHOLE accumulated corpus every single call,
// and tryMineThrow below runs a real (bounded) physics sweep per game -- cheap for one file, but paid
// in full for every game in history, every mint, against a corpus that only grows. Observed live:
// ~2h09m per mint on a ~24k-game corpus, consistent cycle over cycle -- which is the entire reason a
// 1-hour-budget policy loop completed zero arena games across four straight cycles (mint alone blew
// the whole budget before the tournament phase ever started). Fix: since a game never spans files
// (`prev`/`prevGame` reset at the top of the per-file loop below) and source files are append-only in
// practice, a file's mined output is a pure function of that file's own bytes, cacheable per file
// keyed on (mtimeMs, size). Any write to a file changes its signature, so a file caught mid-write is
// never stuck serving a stale cached read -- it just falls back to a fresh mine, same as an unseen
// file. Namespaced by the flags that change what mining PRODUCES (minDepth/allSources/noThrows) so
// switching those can't silently replay results computed under a different scheme. --noCache bypasses
// it entirely (e.g. to confirm the cache reproduces the uncached output byte-for-byte).
//
// SOURCE WEIGHT (on by default): a row's `mv` tag (selfplay.js) identifies the brain that chose the
// move -- an "L7" ladder id, or "ckpt-105@D2"/"best@D1" for a net search. Every row is still mined
// (nothing is excluded), but tagged with a per-row `sw` in [0.25, 1] that train-policy.js multiplies
// into its existing z/elo weight, same "multiply several honest, partial signals together" pattern
// eloweight.js already uses for the mover's rating. This REPLACES an earlier version of this file
// that hard-excluded ladder/shallow/untagged rows outright: measured live (same net, same clock,
// A vs B), the hard-filtered champion LOST to both the unfiltered champion (8-16) and to no policy
// at all (8-16), while unfiltered roughly matched no-policy (11-13) -- consistent with the filter
// starving an 18k-param classifier of 90% of its rows (27.7k vs 308.8k) for a source-quality
// argument that, on this evidence, did not pay for the volume it cost. Weighting keeps the same
// diagnosis (a fixed ladder brain's move is a different, weaker thing to imitate than a real search
// pick) without discarding the data outright:
//   - ladder-mover rows: 0.25 -- same floor eloweight.js already uses for "untrusted but still real,
//     still legal" rows, not zero, because they still describe the reachable position distribution.
//   - net rows below --minDepth (default 2): 0.5 -- nnai.js's lookahead starts at depth 2, so a
//     depth-1 net move has no recursive opponent search behind it, closer to a single-shot eval pick.
//   - untagged rows (`mv` missing, pre-tagging era): 0.625 -- eloweight.js's own "unknown is
//     ordinary, not weak" neutral value (floor + (1-floor)/2), reused verbatim for consistency.
//   - net rows at/above --minDepth: 1 (full trust -- genuine full-width search output).
// Pass --allSources for a flat weight of 1 everywhere (the pre-weighting comparison arm).
//
// KNOWN GAP (mitigated below, not eliminated): each game's FINAL move (the one that won it, usually
// a throw) has no successor row, so the primary diff above can never reconstruct it -- confirmed
// blind spot, see nnai.js's "policy systematically under-rates throw arms" comment. tryMineThrow()
// recovers an APPROXIMATE target for it instead of leaving the gap, weighted by the same sourceWeight
// (a ladder brain's throw is still the ladder's play, not the net's): see that function's own header
// for exactly what is and isn't trustworthy about it. Pass --noThrows to disable just that half.
//
//   node nn/policy-targets.js [--data nn/data] [--out nn/data/policy-targets.jsonl]
//                             [--minDepth 2] [--allSources] [--noThrows] [--noCache]
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { moveFrame, jointMoveFrame } = require('./features.js');
const { armIndex, binIndex, actionIndex, CAP_RAD, JOINT_ENCODING } = require('./policy.js');

const MIN_MOVE = 2*Math.PI/180;    // below this the engine treats it as a non-move; also skips
                                   // the null-plan "pass" rows (pose unchanged, active swapped)
const STEP_RAD = 3*Math.PI/180;    // the engine brains' own sampling step (matches nnai.js's STEP_RAD)

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function norm(a) { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; }

// One counter bucket per file, so a cache entry carries its own contribution to every summary line
// without the reader having to re-derive it from the (possibly not re-read) source file.
function freshCounts() {
  return { games: 0, targets: 0, throwTargets: 0, throwMissed: 0, skippedRows: 0, passRows: 0,
           ambiguous: 0, fullTrustRows: 0, shallowRows: 0, ladderRows: 0, untaggedRows: 0 };
}

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
  const noCache = process.argv.includes('--noCache');
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

  // Per-row source weight (see header for the four tiers and why). Never a hard exclude -- every
  // row still gets mined, just multiplied down at train time when its source is less trustworthy.
  const FULL_TRUST = 1, SHALLOW_W = 0.5, LADDER_W = 0.25, UNTAGGED_W = 0.625;
  const sourceWeight = mv => {
    if (allSources) return FULL_TRUST;
    if (!mv) return UNTAGGED_W;
    if (/^L\d+$/.test(mv)) return LADDER_W;
    const dm = /@D(\d+)$/.exec(mv);
    if (!dm) return UNTAGGED_W;            // unrecognised mv format -- treat like unknown, don't guess
    return +dm[1] < minDepth ? SHALLOW_W : FULL_TRUST;
  };

  // Namespaced by exactly the flags that change mining OUTPUT, so a run under different flags can
  // never be served a cached result computed under a different scheme.
  // v2 rows carry the new 96-way joint action as well as the legacy arm/bin pair. Keep them in a
  // new namespace so an old per-file cache can never replay rows without `action`.
  const cacheKey = 'joint-v2-' + (allSources ? 'allSources' : `minDepth${minDepth}${noThrows ? '-noThrows' : ''}`);
  const cacheDir = path.join(__dirname, '.mine-cache', cacheKey);
  const manifestPath = path.join(cacheDir, 'manifest.json');
  let manifest = {};
  if (!noCache) {
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) {}
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { manifest = {}; }
  }
  const newManifest = {};   // rebuilt fresh each run -- entries for files no longer present just drop

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
  function tryMineThrow(finalRow, emit, c) {
    if (!finalRow || finalRow.adj || !(finalRow.z > 0)) return;  // draw, loss, or an adjudicated
                                                                   // (non-literal) win: no throw here
    const sw = sourceWeight(finalRow.mv);
    const mover = finalRow.m, victim = 1 - mover;
    setPose(finalRow.p, mover);
    const frame = moveFrame(eng), jointFrame = jointMoveFrame(eng);
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
            const jointLeg = jointFrame.order.indexOf(pv);
            const action = actionIndex(jointLeg, dir*jointFrame.mirror, rad);
            emit({ f: finalRow.f, arm, bin, action, policyEncoding: JOINT_ENCODING,
                   z: finalRow.z, g: finalRow.g,
                   thrown: 1, ...(sw !== 1 ? { sw } : {}),
                   ...(finalRow.mv ? { mv: finalRow.mv } : {}) });
            c.throwTargets++;
            reset();
            return;
          }
        }
      }
    }
    reset();
    c.throwMissed++;   // z>0, not adjudicated, yet no arm's sweep reproduces a throw -- worth knowing
                        // the rate of, since a high count would mean this reconstruction is unreliable
  }

  // Mines one file's text fully from scratch, emitting each target line via `emit` and tallying into
  // `c`. Identical logic to the pre-cache version of this file -- only pulled out so both the
  // cache-miss path below and a bare --noCache run can share it.
  function mineFile(txt, emit, c) {
    let prev = null;   // previous parsed row of the SAME game
    let prevGame = null;
    for (const line of txt.split('\n')) {
      if (!line) continue;
      let j;
      try { j = JSON.parse(line); } catch (e) { continue; }
      if (!j.p || j.m === undefined || j.g == null) { c.skippedRows++; prev = null; prevGame = null; continue; }
      if (j.g !== prevGame) {
        if (prevGame !== null) { c.games++; if (!noThrows) tryMineThrow(prev, emit, c); }
        prev = null; prevGame = j.g;
      }
      if (prev) {
        const mover = prev.m;
        const sw = sourceWeight(prev.mv);
        if (sw === LADDER_W) c.ladderRows++;
        else if (sw === SHALLOW_W) c.shallowRows++;
        else if (sw === UNTAGGED_W) c.untaggedRows++;
        else c.fullTrustRows++;
        const dRot = norm(j.p[mover*3 + 2] - prev.p[mover*3 + 2]);
        if (Math.abs(dRot) < MIN_MOVE) { c.passRows++; prev = j; continue; }   // null-plan pass
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
        if (best > 0.05 || second < 0.5) { c.ambiguous++; prev = j; continue; }
        // canonical frame AT THE DECISION POSITION (prev), for the mover
        setPose(prev.p, mover);
        const frame = moveFrame(eng), jointFrame = jointMoveFrame(eng);
        const slot = frame.order.indexOf(pivotIdx);
        const arm = armIndex(slot, (dRot > 0 ? 1 : -1)*frame.mirror);
        const bin = binIndex(dRot);
        const jointLeg = jointFrame.order.indexOf(pivotIdx);
        const action = actionIndex(jointLeg, (dRot > 0 ? 1 : -1)*jointFrame.mirror, dRot);
        // `mv` rides along when present so train-policy.js can weight by the mover's CURRENT pool
        // rating at train time (see eloweight.js for why the id and not the rating is stored). `sw`
        // rides along the same way for the source weight -- see header for the four tiers.
        emit({ f: prev.f, arm, bin, action, policyEncoding: JOINT_ENCODING,
               z: prev.z, g: prev.g,
               ...(sw !== 1 ? { sw } : {}), ...(prev.mv ? { mv: prev.mv } : {}) });
        c.targets++;
      }
      prev = j;
    }
    if (prevGame !== null) { c.games++; if (!noThrows) tryMineThrow(prev, emit, c); }
  }

  const files = fs.readdirSync(dataDir)
    .filter(f => f.endsWith('.jsonl') && !f.startsWith('policy-targets')).sort();
  const ws = fs.createWriteStream(outPath);
  let games = 0, targets = 0, skippedRows = 0, passRows = 0, ambiguous = 0;
  let fullTrustRows = 0, shallowRows = 0, ladderRows = 0, untaggedRows = 0;
  let cacheHits = 0, cacheMisses = 0;
  const fold = c => {
    games += c.games; targets += c.targets; skippedRows += c.skippedRows; passRows += c.passRows;
    ambiguous += c.ambiguous; fullTrustRows += c.fullTrustRows; shallowRows += c.shallowRows;
    ladderRows += c.ladderRows; untaggedRows += c.untaggedRows;
    throwTargets += c.throwTargets; throwMissed += c.throwMissed;
  };
  let throwTargets = 0, throwMissed = 0;

  for (const file of files) {
    const filePath = path.join(dataDir, file);
    let st;
    try { st = fs.statSync(filePath); } catch (e) { continue; }
    const cacheFile = path.join(cacheDir, file);
    const cached = !noCache && manifest[file];

    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      // Fast path: this file's signature hasn't changed since the last mint, so its mined output
      // can't have either -- replay the cached lines verbatim instead of re-parsing the source and
      // re-running the throw-reconstruction physics sweep for every game in it.
      let cachedTxt;
      try { cachedTxt = fs.readFileSync(cacheFile, 'utf8'); } catch (e) { cachedTxt = null; }
      if (cachedTxt !== null) {
        if (cachedTxt) ws.write(cachedTxt);
        fold(cached.c);
        newManifest[file] = cached;
        cacheHits++;
        continue;
      }
      // cache entry in the manifest but the backing file vanished -- fall through to a fresh mine
    }
    cacheMisses++;

    let txt;
    try { txt = fs.readFileSync(filePath, 'utf8'); } catch (e) { continue; }
    const c = freshCounts();
    let buf = noCache ? null : '';
    const emit = obj => {
      const line = JSON.stringify(obj);
      ws.write(line + '\n');
      if (buf !== null) buf += line + '\n';
    };
    mineFile(txt, emit, c);
    fold(c);
    if (buf !== null) {
      try {
        fs.writeFileSync(cacheFile, buf);
        newManifest[file] = { mtimeMs: st.mtimeMs, size: st.size, c };
      } catch (e) {}   // cache write failing shouldn't fail the mint -- just costs the speedup next time
    }
  }
  if (!noCache) {
    try { fs.writeFileSync(manifestPath, JSON.stringify(newManifest)); } catch (e) {}
  }

  ws.end(() => console.log(
    `policy targets: ${targets} moves reconstructed from ${games} games -> ${outPath}\n` +
    (noThrows ? '' : `(+ ${throwTargets} throw targets recovered, ${throwMissed} misses)\n`) +
    `(skipped: ${skippedRows} rows without pose/tag, ${passRows} null-plan passes, ` +
    `${ambiguous} ambiguous-pivot rotations)\n` +
    (allSources ? '(source weighting: OFF, --allSources -- flat weight 1)'
      : `(source weighting: minDepth ${minDepth} -- ${fullTrustRows} full-trust, ` +
        `${shallowRows} shallow@${SHALLOW_W}, ${ladderRows} ladder@${LADDER_W}, ` +
        `${untaggedRows} untagged@${UNTAGGED_W})`) + '\n' +
    (noCache ? '(cache: OFF, --noCache)'
      : `(cache: ${cacheHits} file(s) replayed, ${cacheMisses} freshly mined)`)));
}

main();
