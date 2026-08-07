// Multi-lane version of the L11 clock match (menu 38). arena.js itself is single-process and plays
// its `--games` sequentially -- there is nothing wrong with that for most uses (it is the honest,
// simple way to run one comparison), but at a ~20s/move budget on BOTH sides, 60 games sequentially
// is realistically many hours. Every other heavy comparison in this project (policyloop.js's
// tournament, retroloop.js's ratchet lanes) gets its speed from running several independent arena.js
// processes side by side, not from arena.js itself being parallel, so this does the same thing for
// one specific matchup: measure L11's clock ONCE, split the requested game count across
// cores-1 lanes, spawn that many arena.js children, and pool their --resultsJsonl output into one
// verdict when they are all done.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { createEngine } = require('./engine.js');
const { measureL11Clock } = require('./l11-clock.js');
const { eloFromScore, fmtElo } = require('./elo.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const totalGames = +arg('games', 60);
const measureMoves = +arg('moves', 30);
const noPark = process.argv.includes('--noPark');
// Same cap as retroloop.js's lanes, same reasoning: cores-1 so the OS and everything else still
// has a core, capped so a many-core box doesn't oversubscribe memory/disk for no further speedup.
const lanes = Math.max(1, Math.min(+arg('lanes', Math.max(1, Math.min(os.cpus().length - 1, 14))), totalGames));
const dir = __dirname;
const runTag = 'l11cm' + Date.now().toString(36);

console.log(`measuring L11's own median think time on this machine (${measureMoves} moves)...`);
const clock = measureL11Clock(measureMoves);
console.log(`L11 think time here: min ${clock.min}ms  p25 ${clock.p25}ms  median ${clock.median}ms  ` +
            `p75 ${clock.p75}ms  max ${clock.max}ms`);
console.log(`giving leL11 exactly ${clock.median}ms -- L11 stays native and unclocked.`);
console.log(noPark
  ? 'park stops NOT exempted from smoothing (--noPark) -- the old, park-blind leL11.'
  : 'park stops exempted from plateau smoothing on the leL11 side, as L11 native effectively has.');
console.log(`${totalGames} games across ${lanes} lane(s)...\n`);

// Split as evenly as possible; the first (totalGames % lanes) lanes take one extra game rather than
// one lane silently doing more work than the rest.
const perLane = Array.from({ length: lanes }, (_, i) =>
  Math.floor(totalGames / lanes) + (i < totalGames % lanes ? 1 : 0)).filter(n => n > 0);

const laneDir = path.join(dir, 'data', `.l11cm-${runTag}`);
fs.mkdirSync(laneDir, { recursive: true });

function runLane(i, n) {
  const resultsPath = path.join(laneDir, `lane${i}-results.jsonl`);
  const saveData = path.join(laneDir, `lane${i}-data.jsonl`);
  const logDir = path.join(dir, 'arena-logs', `l11clockmatch-${runTag}-lane${i}`);
  // --parkStopsA: exempt park stops from plateau smoothing on the leL11 side. Without it this
  // matchup is not a fair test of L11's judgement at all -- ladderEval's park term (weight 8, its
  // second-heaviest) lands in a band narrower than one 3 degree step, so a park is ALWAYS an
  // isolated spike whose neighbours are ALWAYS unparked, and the smoothing averages ~2/3 of it away
  // every time. The ladder rungs hit this same bug once already (ladderRoots3's comment: L8 fell
  // from ~63% to ~43% vs L7 until it grew a dedicated park recorder). L11 native keeps its parks;
  // this lets leL11 keep its own. Off => --noPark, for measuring how much it is actually worth.
  const args = ['arena.js', '--a', 'le:L11', '--b', 'L11', '--timeMsA', clock.median,
                ...(noPark ? [] : ['--parkStopsA']),
                '--games', n, '--resultsJsonl', resultsPath, '--saveData', saveData, '--logDir', logDir];
  return new Promise(resolve => {
    const ch = spawn('node', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    ch.stdout.on('data', d => { tail += d; });
    ch.stderr.on('data', d => { tail += d; });
    ch.on('close', code => {
      // Report just the arena.js summary line, not the whole scrolling progress -- N lanes each
      // printing "game 4/9..." on top of each other is noise, the log files are the real record.
      const lastLine = tail.trim().split('\n').filter(Boolean).pop() || '(no output)';
      console.log(`lane ${i} (${n} games) done, exit ${code}: ${lastLine}`);
      resolve();
    });
  });
}

(async () => {
  await Promise.all(perLane.map((n, i) => runLane(i, n)));

  // Pool every lane's --resultsJsonl into one verdict, folding komi (move-cap adjudication) the
  // same way arena.js's own scores() does, so a merged run reads exactly like one long run would.
  // kw, not komiLoss directly: a komi win counts as komiLoss of a win on the 0..1 scale a rating
  // fit uses, which maps to the winner taking 0.5 + komiLoss/2 -- see arena.js's own scores().
  const eng = createEngine();
  const kw = 0.5 + eng.CFG.komiLoss/2;
  let aWins = 0, bWins = 0, draws = 0, aKomi = 0, bKomi = 0, games = 0;
  for (let i = 0; i < perLane.length; i++) {
    const p = path.join(laneDir, `lane${i}-results.jsonl`);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      games++;
      if (r.outcome === 'draw') { draws++; continue; }
      if (r.outcome === 'A') { if (r.adjudicated) aKomi++; else aWins++; }
      else { if (r.adjudicated) bKomi++; else bWins++; }
    }
  }
  const aScore = aWins + kw*aKomi + (1 - kw)*bKomi;
  const bScore = bWins + kw*bKomi + (1 - kw)*aKomi;
  const dec = Math.max(1, aScore + bScore);
  const e = eloFromScore(aScore, bScore);
  console.log(`\n=== pooled: le:L11(T${clock.median}ms) ${aWins}-${bWins}` +
              (draws ? `-${draws}` : '') +
              (aKomi + bKomi ? ` (komi ${aKomi}-${bKomi})` : '') + ` L11  --  ${games} games, ${lanes} lanes ===`);
  console.log(`${(100*aScore/dec).toFixed(0)}% of decided, ${fmtElo(e)} (${e.verdict})`);
  console.log(`\nper-lane data left under ${path.relative(dir, laneDir)} -- merge manually if you want the raw rows.`);
})();
