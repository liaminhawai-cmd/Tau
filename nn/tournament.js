// Round robin across saved checkpoints, to find the actual strongest model instead of trusting
// best.json to already be it. Why this is needed: run.js's per-iteration fresh-vs-best gate was
// retired (it was reading noise -- see run.js's own comment), so best.json is now "whichever net
// trained most recently," not a ratchet that only ever goes up. This plays models against each
// other, all at temperature 0 (deterministic move choice), and ranks by win rate. A couple of
// forced random opening plies (opening.js) give each game a genuinely different position to play
// out from, instead of replaying the same 2 deterministic lines over and over.
//
// TWO THINGS THIS FILE GOT WRONG THE FIRST TIME, both load-bearing once run.js calls this on a
// schedule rather than as a one-off:
//   1. It ran every saved checkpoint against every other, and ckpt-NNN.json accumulates one new
//      file per iteration FOREVER. Pairs grow O(n^2) in the number of checkpoints, so cost doesn't
//      just scale with how often this runs -- it grows every time it fires, without bound. By
//      iteration 100 that is ~5000 pairs. --recent caps the field to a fixed-size sliding window
//      (the most recent N checkpoints + best/value), so cost stays roughly CONSTANT run to run.
//   2. It played every game in one single-threaded loop while selfplay.js next to it forks one
//      worker per core. Observed on the real machine: a 12-model tournament (already past what a
//      handful of restarts produces) was still running after an hour, blocking every later
//      training iteration behind it (run.js calls this synchronously). --workers splits the pair
//      list round-robin across forked processes, same pattern as selfplay.js.
//
//   node nn/tournament.js [--dir nn/models] [--games 6] [--openingPlies 2] [--recent 12]
//                         [--workers 8] [--promote]
'use strict';
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { createEngine } = require('./engine.js');
const { MLP } = require('./net.js');
const { nnPlanFor } = require('./nnai.js');
const { playRandomOpening } = require('./opening.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

// The field: best.json, value.json and scratch.json (if present) always included, plus only the
// most recent `recent` ckpt-NNN.json by iteration number -- this is what keeps the tournament's
// cost from growing every time run.js calls it, no matter how long the run has been going.
// scratch.json is run.js's from-scratch challenger, retrained on all accumulated data immediately
// before each round robin (see run.js's --scratchEpochs). It must be in the field unconditionally
// rather than via the --recent window, since it is not a ckpt-NNN and the whole point of it is to
// be measured against the incrementally-trained incumbent every single time.
function pickFiles(modelsDir, recent) {
  const all = fs.readdirSync(modelsDir).filter(f => /^(ckpt-\d+|best|value|scratch)\.json$/.test(f));
  const named = all.filter(f => f === 'best.json' || f === 'value.json' || f === 'scratch.json');
  const ckpts = all.filter(f => /^ckpt-\d+\.json$/.test(f))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0])
    .slice(-Math.max(1, recent));
  return [...named, ...ckpts].sort();
}

function playGame(eng, netA, netB, aIsBlue, openingPlies) {
  eng.newGame();
  playRandomOpening(eng, openingPlies);
  let plies = 0, nulls = 0;
  while (!eng.getG().over && plies < 300) {
    const idx = eng.getG().active;
    const net = (idx === 0) === aIsBlue ? netA : netB;
    const plan = nnPlanFor(eng, net, idx, { temperature: 0 });
    if (!plan) { if (++nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
    nulls = 0;
    eng.applyPlan(plan);
    plies++;
  }
  const G = eng.getG();
  if (!G.over) return null;              // draw (300-ply cap)
  return (G.winner === 0) === aIsBlue;   // true: A won, false: B won
}

// The same (files, pairs) construction runs in the parent AND in every worker, from the same
// --dir/--recent, so a worker can be handed just its own index and independently know which slice
// of the pair list is its without the parent needing to serialize file lists or pair indices
// through argv.
function buildPairs(files) {
  const pairs = [];
  for (let i = 0; i < files.length; i++)
    for (let j = i + 1; j < files.length; j++) pairs.push([i, j]);
  return pairs;
}

function main() {
  const modelsDir = arg('dir', path.join(__dirname, 'models'));
  const gamesPerSide = Math.max(1, +arg('games', 6));   // each side plays first this many times
  const openingPlies = +arg('openingPlies', 2);
  const recent = Math.max(1, +arg('recent', 12));
  const doPromote = process.argv.includes('--promote');
  const workerIndex = arg('workerIndex', null);
  const workerCount = +arg('workerCount', 1);

  const files = pickFiles(modelsDir, recent);
  if (files.length < 2) {
    console.error(`need at least 2 model files (ckpt-*.json / best.json / value.json) in ${modelsDir}`);
    process.exit(1);
  }
  const pairs = buildPairs(files);
  const perPair = gamesPerSide*2;

  // ---- worker mode: play this process's share of pairs, write partial results, exit ----
  if (workerIndex !== null) {
    const TAG = `[w${+workerIndex + 1}] `;
    const eng = createEngine();
    const nets = files.map(f => MLP.fromJSON(JSON.parse(fs.readFileSync(path.join(modelsDir, f), 'utf8'))));
    const wins = {}, decided = {};
    for (const f of files) { wins[f] = 0; decided[f] = 0; }
    // round-robin, not a contiguous slice: pair cost varies a lot (a deep-search game can run far
    // longer than a fast one), and round-robin spreads that variance across workers far more evenly
    // than handing worker 0 the first N/workers pairs and worker N-1 the last.
    for (let k = +workerIndex; k < pairs.length; k += workerCount) {
      const [i, j] = pairs[k];
      let aw = 0, bw = 0, draws = 0;
      for (let g = 0; g < perPair; g++) {
        const aIsBlue = g % 2 === 0;
        const r = playGame(eng, nets[i], nets[j], aIsBlue, openingPlies);
        if (r === true) aw++; else if (r === false) bw++; else draws++;
      }
      wins[files[i]] += aw; decided[files[i]] += aw + bw;
      wins[files[j]] += bw; decided[files[j]] += aw + bw;
      console.log(`${TAG}${files[i]} vs ${files[j]}: ${aw}-${bw}` + (draws ? ` (${draws} draws)` : ''));
    }
    fs.writeFileSync(arg('out', ''), JSON.stringify({ wins, decided }));
    return;
  }

  console.log(`tournament: ${files.length} models, ${pairs.length} pairs, ${perPair} games/pair ` +
              `(${pairs.length*perPair} games total, most recent ${recent} checkpoints), temperature 0`);
  const t0 = Date.now();
  const wins = {}, decided = {};
  for (const f of files) { wins[f] = 0; decided[f] = 0; }

  const workers = Math.max(1, Math.min(+arg('workers', 1), pairs.length));
  if (workers <= 1) {
    // plain single-process path -- what a bare `node tournament.js` still does, so a one-off
    // manual run doesn't have to think about temp files or worker counts.
    const eng = createEngine();
    const nets = files.map(f => MLP.fromJSON(JSON.parse(fs.readFileSync(path.join(modelsDir, f), 'utf8'))));
    for (const [i, j] of pairs) {
      let aw = 0, bw = 0, draws = 0;
      for (let g = 0; g < perPair; g++) {
        const aIsBlue = g % 2 === 0;
        const r = playGame(eng, nets[i], nets[j], aIsBlue, openingPlies);
        if (r === true) aw++; else if (r === false) bw++; else draws++;
      }
      wins[files[i]] += aw; decided[files[i]] += aw + bw;
      wins[files[j]] += bw; decided[files[j]] += aw + bw;
      console.log(`${files[i]} vs ${files[j]}: ${aw}-${bw}` + (draws ? ` (${draws} draws)` : ''));
    }
    finish();
  } else {
    const tmpBase = path.join(modelsDir, `.tournament-tmp-${process.pid}-`);
    let live = workers;
    for (let w = 0; w < workers; w++) {
      const out = tmpBase + w + '.json';
      const ch = fork(__filename, ['--dir', modelsDir, '--games', String(gamesPerSide),
        '--openingPlies', String(openingPlies), '--recent', String(recent),
        '--workerIndex', String(w), '--workerCount', String(workers), '--out', out]);
      ch.on('exit', () => {
        try {
          const r = JSON.parse(fs.readFileSync(out, 'utf8'));
          for (const f of files) { wins[f] += r.wins[f] || 0; decided[f] += r.decided[f] || 0; }
        } catch (e) { console.warn(`warning: worker ${w} produced no usable result (${e.message})`); }
        try { fs.unlinkSync(out); } catch (e) {}
        if (--live === 0) finish();
      });
    }
  }

  function finish() {
    const ranked = files
      .map(f => ({ f, w: wins[f], d: decided[f], rate: decided[f] ? wins[f]/decided[f] : 0 }))
      .sort((a, b) => b.rate - a.rate);
    console.log(`\n=== ranking (${((Date.now() - t0)/1000).toFixed(0)}s) ===`);
    ranked.forEach((r, i) => console.log(
      `${i + 1}. ${r.f}: ${r.w}/${r.d} decided (${(100*r.rate).toFixed(0)}%)`));

    const champ = ranked[0].f;
    console.log(`\nstrongest: ${champ}`);
    if (!doPromote) {
      console.log(`(dry run -- pass --promote to back up models/best.json and replace it with ${champ})`);
      return;
    }
    const bestPath = path.join(modelsDir, 'best.json');
    if (champ === 'best.json') { console.log('best.json is already the strongest -- nothing to do'); return; }
    if (fs.existsSync(bestPath)) {
      const backup = path.join(modelsDir, `best.pre-tournament-${Date.now()}.json`);
      fs.copyFileSync(bestPath, backup);
      console.log(`backed up old best.json -> ${path.basename(backup)}`);
    }
    fs.copyFileSync(path.join(modelsDir, champ), bestPath);
    console.log(`promoted ${champ} -> best.json`);
  }
}

main();
