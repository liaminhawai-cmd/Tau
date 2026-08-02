// The overnight loop, restructured: self-play runs CONTINUOUSLY in the background, chaining itself
// into a fresh batch the instant one finishes, and never waits on anything else. A separate
// housekeeping clock -- retrain-from-scratch, round robin, promote, ladder sweep -- runs on its own
// schedule in parallel, sharing cores with self-play rather than pausing it.
//   node nn/run.js [--gamesPerBatch 1000] [--checkEveryMin 5]
//                  [--tournamentEveryMin 180] [--benchEveryMin 60]
//                  [--benchLevels 3] [--benchCellGames 3] [--benchDepths 1,2,3]
//                  [--tournamentRecent 12] [--spotCheckRecent 3] [--spotCheckGames 2]
//
// TWO CHANGES FROM THE OLD LOOP, both driven by the same overnight logs.
//
// 1. The resume-train runs on a CLOCK (--trainEveryMin) instead of once per self-play batch, and
//    is deliberately kept rather than removed. Getting this right took two passes, so the evidence
//    is worth recording:
//      - Round robins at iterations 60, 70 and 80 all showed a from-scratch retrain beating the
//        resumed lineage, by a growing margin (58%, then 65% with the incumbent placing 12th of 15
//        -- worse than a bare 6-epoch continuation carrying no lineage at all). Same failure the
//        iteration-63 bake-off caught: ~370 cumulative epochs over the same rows losing 27% across
//        158 games to a challenger's 30. That reads as "resume-training is harmful", and the first
//        version of this file removed it outright.
//      - But a round robin run AFTER iteration 80's promotion measured the opposite: best.json --
//        by then the promoted scratch net plus ~4 iterations of resume-training on top -- beat a
//        freshly retrained scratch 18-6 head to head and won the field 58% to 45%, over 120 decided
//        games per model, which is outside noise.
//    Reconciled: resume-training ADDS strength over a handful of iterations and DEGRADES over
//    dozens. It is not the resume step that fails, it is unbounded accumulation. The round robin
//    below is the bound -- it retrains from scratch and promotes on merit, resetting the lineage
//    whenever drift has actually cost something. Removing the resume step threw away real gains to
//    avoid a failure the existing mechanism already contains.
//    --trainEveryMin 0 restores the pure retrain-from-scratch behaviour if that judgement flips.
//
// 2. Self-play no longer runs in small batches that run.js waits on before doing anything else.
//    execFileSync blocks this whole process until the child exits -- including the straggler tail,
//    since selfplay.js's pull-based dispatch (a lane grabs the next game the moment it's free)
//    still has nothing left to hand out once fewer games remain than there are idle lanes, and a
//    single L9-vs-L9 marathon can run 30-45 minutes alone. At 30 games per batch that tax gets paid
//    every 20-60 minutes; measured directly in the logs, e.g. one iteration idled most of its 14
//    lanes for a chunk of its 3970s total. A self-play process is now started ONCE with a large
//    --gamesPerBatch and left running in the background (spawn, not execFileSync); the moment it
//    exits -- games exhausted, or a crash -- an 'exit' listener relaunches the next batch within
//    seconds, with a freshly recomputed ZPD pool. The straggler tax still exists (it's inherent to
//    any finite batch) but now triggers once per ~1000 games instead of once per 30, and the gap
//    between batches is fork overhead, not another 20-60 minute wait. selfplay.js's own merge step
//    changed to match: it now appends each task's data to the output file as that task finishes,
//    not once the whole batch is done, or a batch in the thousands would produce literally nothing
//    on disk until hours after the first game finished.
//    Housekeeping -- the retrain/tournament/sweep below -- runs on an independent wall-clock
//    schedule instead of being gated on self-play "finishing" (it mostly never does anymore). While
//    housekeeping's own child processes run, self-play keeps going in parallel, sharing cores rather
//    than losing them for however long housekeeping takes.
'use strict';
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Games per self-play batch before it's retired and replaced with a fresh one (see point 2 above).
// 1000 is a deliberate jump from the old 30-per-iteration: the straggler tail costs roughly the
// same in absolute minutes no matter the batch size (it's bounded by the single slowest game type,
// not by how many games came before it), so a bigger batch doesn't shrink the tax, it just pays it
// far less often relative to useful work done.
const gamesPerBatch = Math.max(1, +arg('gamesPerBatch', 1000));
// How often the housekeeping clock wakes up to check whether it's time for a round robin or a
// ladder sweep, and to push whatever the current (possibly still-growing) data file has on it.
// Short on purpose -- this tick is nearly free (a few file reads, maybe a git push), so there is
// no real cost to checking often, and every check is a chance to get fresher data onto git sooner.
const checkEveryMin = Math.max(0.5, +arg('checkEveryMin', 5));
const tournamentEveryMin = Math.max(1, +arg('tournamentEveryMin', 180));
const benchEveryMin = Math.max(1, +arg('benchEveryMin', 60));
// Resume-train from best.json on its own clock, then promote. See the "WHAT CHANGED" note at the
// top for why this exists and why it is bounded by the round robin rather than removed.
// --trainEveryMin 0 disables it (pure retrain-from-scratch, decided only by round robins).
const trainEveryMin = Math.max(0, +arg('trainEveryMin', 30));
const epochs = arg('epochs', '6');
// selfplay.js's game-source mix, once a model exists (before that it's always pure ladder-vs-
// ladder). This used to be a single "selfRatio" ramped 0.25->0.85 across the first 6 iterations
// then left completely flat -- but nn-vs-nn scaled as selfRatio^2 while nn-vs-ladder only scaled
// as selfRatio*(1-selfRatio), so the 0.85 cap actually meant 72% nn-vs-nn / 13% nn-vs-ladder / 15%
// ladder-only, not the ~85%-self split the number suggested. That heavy, PERMANENTLY-flat nn-vs-nn
// share is a real suspect in why a round robin found real playing strength peaking at iterations
// 11-13 and drifting through 14-20 -- ladder brains don't drift with the net, so a bigger, fixed
// share of them is what keeps the training data from being graded by the same student whose
// answers are being checked.
const mix = arg('mix', 'nnnn:0.4,nnladder:0.3,ladder:0.3');
// Fraction of self-play games started from a fully random legal pose rather than the canonical
// start (see opening.js's randomStartPose). Coverage of shapes no real trajectory reaches -- a
// piece hard against the rim with the opponent clear across the board -- which the value net still
// has to score sensibly. A minority slice on purpose: an unconstrained pose is a rougher signal
// per game than a near-canonical one. Rows carry src:'random' so its effect stays measurable.
const randomStartFrac = arg('randomStartFrac', '0');
// The benchmark is a SWEEP, not a single score. "0-12 vs L8" says "weaker than L8" and nothing
// else -- it cannot tell a net that plays like L2 from one that nearly beat L7, which is why four
// consecutive readings of 0%, 9%, 0%, 17% carried no usable signal. Playing a small number of
// games in many cells (a few ladder levels x a few search depths) reads as a PLACEMENT instead:
// each individual cell is noisy, but every depth is backed by all the levels and every level by
// all the depths, and the shape across cells (does depth 3 beat depth 2? where does the win rate
// fall off?) is legible long before any one cell is significant.
const benchLevels = Math.max(1, +arg('benchLevels', 3));      // ladder rungs per depth, per sweep
const benchCellGames = arg('benchCellGames', '3');            // games per (level, depth) cell
// Ladder rungs played EVERY sweep regardless of where the window sits, so results stay comparable
// across sweeps and across models (see the union in runBenchCycle). Includes the top rung, which
// used to be special-cased here for the same reason -- otherwise the rung the net is ultimately
// judged against goes unmeasured until the window crawls all the way up. Costs a few extra cells
// per sweep; --benchAnchors 11 restores the old behaviour of anchoring on the top rung alone.
const benchAnchors = arg('benchAnchors', '3,7,11').split(',').map(Number).filter(n => n > 0);
// Shape of the self-play opponent distribution over ladder rungs (see zpdLevels). sigma is the
// bell's width in rungs: 1.6 puts roughly two thirds of the weight within +-1.6 rungs of the
// frontier while still leaving a usable trickle three or four rungs out. topFloor is the minimum
// number of entries the TOP rung gets in the finished pool, which is what guarantees it is never
// simply absent -- the bug this replaced.
const zpdSigma = Math.max(0.1, +arg('zpdSigma', 1.6));
const topFloor = Math.max(0, +arg('topFloor', 3));
// Which depths to sweep. Cost grows ~3.6x PER PLY (measured: 5.6x at depth 2, 20x at depth 3), so
// this is not a free dial -- depth 4 costs ~47x a depth-1 game and depth 5 ~168x, compounded by the
// fact that the deeper rungs are themselves searching brains (L8 is a depth-3 search, ~2.5s/call).
// 1,2,3 is the affordable span; because strength moves along a diagonal (see the windows below),
// measuring the contour at cheap depths tells you where it sits at expensive ones without paying.
const benchDepths = arg('benchDepths', '1,2,3').split(',')
  .map(Number).filter(d => Number.isFinite(d) && d >= 1);
// Capped, or this grows every time it fires: ckpt-NNN.json accumulates one file per round robin
// forever, so an uncapped field is O(n^2) in how long the run has been going, not a fixed cost.
// --tournamentRecent keeps the field to a fixed-size sliding window (see tournament.js).
const tournamentRecent = arg('tournamentRecent', '12');
// selfplay is embarrassingly parallel — use most of the machine's cores by default (capped: each
// worker holds its own engine sandbox, and Node.js counts hyperthreads as full cores in
// os.cpus(), so this isn't literally "one worker per physical core"). --workers 1 for serial.
const workers = arg('workers', String(Math.max(1, Math.min(os.cpus().length - 1, 14))));
// Worker count for placement and the round robin. This was briefly set to 30% of --workers on the
// theory that these had previously had the machine to themselves; that was simply wrong. self-play
// is started with spawn() and has ALWAYS run as a concurrent background child (see
// startSelfplayBatch), so placement was already sharing cores with it long before the scheduler
// became non-blocking. Measured cost of the mistake on the real machine: pool cycle 94's placement
// added only 10 new matchups in 40 minutes at 4 workers, leaving most brains on 4 games and the
// ladder yardstick visibly out of order in the fitted table.
// What genuinely IS new alongside placement is retro (1 process) and the ladder sweep's arena
// (1 process), so the right reservation is a couple of cores, not two thirds of them.
const poolWorkers = arg('poolWorkers', String(Math.max(2, +workers - 2)));
// How many retromine processes to run at once. Each picks its own seed positions at random and
// writes its own file, so they are independent investigations needing no coordination -- but
// retrograde rows have never once been generated on this run, so the useful next step is finding
// out what ONE produces, not scaling an unmeasured thing. Raise it when there is a reason to.
const retroWorkers = Math.max(1, +arg('retroWorkers', 1));
// Every round robin, ALSO train a challenger from scratch on all accumulated data and enter it in
// the field. This is now the ONLY way best.json changes (see point 1 above) -- not an occasional
// sanity check on a resumed lineage anymore, but the actual training step.
const scratchEpochs = arg('scratchEpochs', '30');
// Pin the from-scratch challenger's ARCHITECTURE instead of copying whatever best.json currently
// is. Without this the shape choice is a one-way ratchet that can silently undo a measured result:
// the challenger reads its shape off best.json, so the moment a round robin promotes an older
// checkpoint of the previous shape, every later challenger is built that shape too, no new nets of
// the adopted shape are ever generated again, and the adopted lineage ages out of the --recent
// window within `tournamentRecent` cycles. Gone for good, from a single noisy round robin.
// Unset (the default) keeps the old behaviour of following best.json.
const scratchHidden = arg('scratchHidden', null);
// Standing rating pool. Every new checkpoint is PLACED against opponents near its own strength
// instead of a full round robin being replayed, and its rating persists so it never needs
// measuring again. The round robin re-answers questions it already answered -- ckpt-069 vs
// ckpt-070 got replayed at iteration 80, 90 and 100, each time reaching the same conclusion at a
// cost of 1260 games. Placing one new model takes a couple of dozen.
// What keeps the scale honest across a long run is that LADDER rungs are in the pool as ordinary
// players: they are code, not files, so they cannot drift, retire or be overwritten. Without a
// fixed anchor a self-referential pool inflates as a whole and the numbers stop meaning anything.
// --poolEveryMin 0 disables it and falls back to the round robin alone.
const poolEveryMin = Math.max(0, +arg('poolEveryMin', 45));
const poolBudgetHours = +arg('poolBudgetHours', 0.25);
// Placement plays at D1 and D2 only. D3 costs ~20x D1 per game and rank is a property of
// (net x depth) rather than of the net, so a third depth triples the bill to answer a question the
// promotion gate does not ask.
const poolDepths = arg('poolDepths', '1,2');
const poolGames = arg('poolGames', '4');
const poolLevels = arg('poolLevels', '');
// Capped model-variety slots. Fixed ladder-rank targets ("1.5, 2.5, 4.5...") break down once nets
// exceed L11 -- ultra rates 509 against L11's 332, no ladder rank left to even express where it
// sits -- so slots are spaced by ELO PERCENTILE across whatever is currently rated instead. That
// self-calibrates as the whole population's range shifts and always includes the actual current
// top, however far past the ladder it has gone. --poolSlots 0 disables the mechanism.
const poolSlots = Math.max(0, +arg('poolSlots', 10));
// How many resumes a variant lineage may accumulate before it is rebuilt from scratch at its own
// architecture. Bounds exactly the failure this file's header records for best.json -- see the
// reset in runPoolCycle. 0 disables the reset and restores the old resume-forever behaviour.
const variantFreshEvery = Math.max(0, +arg('variantFreshEvery', 5));
// Fraction of self-play BATCHES (this machine) that use a slot/architecture model instead of
// best.json. A minority slice on purpose -- best.json's own self-play is the most relevant data,
// since that is the net actually being strengthened; this exists so the value net sees more than
// one architecture's blind spots over a long run, same "minority slice, not a replacement"
// reasoning as --randomStartFrac.
const modelVarietyFrac = Math.max(0, Math.min(1, +arg('modelVarietyFrac', 0.2)));
// --poolOnce: run a single placement cycle and exit, instead of starting the trainer. This is how
// the cycle gets exercised on demand -- every bug in this code path so far was found by running it,
// not by reading it, and a 45-minute clock is a poor way to reach a code path.
const poolOnce = process.argv.includes('--poolOnce');
// The hand-built architectures (wide/ultra/deep/l15_value) stay ALIVE, not archived: each pool
// cycle resume-trains ONE of them -- rotating, few epochs, so the main line keeps nearly all the
// compute -- and places the result in the pool under a numbered name. The numbered name matters:
// retraining "wide.json" in place would attribute one rating to many different nets (the exact
// moving-target bug the pool exists to avoid), where wide-041, wide-042, ... is a lineage whose
// slow rise (or failure to rise) through the ranks is readable straight off the pool.
const variantEpochs = +arg('variantEpochs', 8);
// Every Nth pool cycle runs the placement WITHOUT the pairing restriction (--focusPairs 0): same
// budget, but the scheduler spends it wherever the pool's ratings are least certain. Over many
// cycles this is what makes the pool slowly granular everywhere instead of sharp only at the
// newest models. 0 disables.
const poolWideEvery = Math.max(0, +arg('poolWideEvery', 4));
// Architecture hill-climb. Each pool cycle trains TWO from-scratch nets under identical
// conditions -- same epochs, same data corpus, same placement run, same gate -- differing ONLY in
// shape: the champion shape, and one random small edit of it (one layer widened, one narrowed, a
// layer added, a layer dropped). Whichever ends up rated clearly higher owns the shape going
// forward, so the shape random-walks uphill one measured fight at a time instead of being a
// hand-picked constant revisited only when a human thinks of it. --mutateShape 0 disables.
const mutateShape = arg('mutateShape', '1') !== '0';
// Retrograde mining on its own clock, using the pool as its strength axis (see retromine.js).
const retroEveryMin = Math.max(0, +arg('retroEveryMin', 120));
const retroSeeds = +arg('retroSeeds', 4);

// Atomic save: write/copy to a temp file beside the target, then rename over it. A rename either
// fully lands or doesn't happen at all, where a direct writeFileSync/copyFileSync can be caught
// mid-flight -- and this window gets closed at the user's will at any moment (that's the whole
// point of START.bat), including mid-write of best.json itself. Without this, an unlucky close
// could hand the next self-play batch a truncated net with no automatic recovery.
function atomicWrite(destPath, data) {
  const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, destPath);
}
function atomicCopy(srcPath, destPath) {
  const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(srcPath, tmp);
  fs.renameSync(tmp, destPath);
}

const dir = __dirname;
const best = path.join(dir, 'models', 'best.json');
const poolFile = path.join(dir, 'elo-results.json');
const poolSummary = path.join(dir, 'elo-summary.json');
const fresh = path.join(dir, 'models', 'value.json');
const log = msg => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log('\n=== ' + line);
  fs.appendFileSync(path.join(dir, 'log.txt'), line + '\n');
};
const run = (script, args) => {
  console.log(`\n$ node nn/${script} ${args.join(' ')}`);
  execFileSync('node', [path.join(dir, script), ...args], { stdio: 'inherit' });
};
// housekeeping's own steps are informational (the round robin is the only real gate) — a benchmark
// crash must never kill an overnight training loop
const runSoft = (script, args) => {
  try { run(script, args); }
  catch (e) { log(`WARNING: ${script} failed (${e.message}) — continuing`); }
};
// The sweep needs each arena's RESULT, not just its exit code — capture stdout (still echoed
// below) and pull the final "aWins-bWins" summary line arena.js prints out of it.
const runCaptured = (script, args) => {
  console.log(`\n$ node nn/${script} ${args.join(' ')}`);
  const out = execFileSync('node', [path.join(dir, script), ...args], { encoding: 'utf8' });
  process.stdout.write(out);
  return out;
};
const runCapturedSoft = (script, args) => {
  try { return runCaptured(script, args); }
  catch (e) { log(`WARNING: ${script} failed (${e.message}) — continuing`); return ''; }
};
// Non-blocking equivalents. execFileSync freezes Node's ENTIRE single-threaded event loop for as
// long as the child runs -- fine for a one-shot script, fatal for a scheduler that also has to
// keep noticing retro's and bench's own clocks have elapsed. Measured directly tonight: a pool
// cycle's training+placement steps ran 2.5+ hours end to end, and for that whole stretch nothing
// else in this process could run AT ALL -- not a CPU contention problem, a "the orchestrator
// cannot execute its own next line of JS" problem. spawn()+Promise fixes that: the child runs as
// its own OS process regardless, and this process's event loop stays free to keep ticking.
function runAsync(script, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n$ node nn/${script} ${args.join(' ')}`);
    const ch = spawn('node', [path.join(dir, script), ...args], { stdio: 'inherit' });
    ch.on('exit', code => code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)));
    ch.on('error', reject);
  });
}
async function runSoftAsync(script, args) {
  try { await runAsync(script, args); }
  catch (e) { log(`WARNING: ${script} failed (${e.message}) — continuing`); }
}
function runCapturedAsync(script, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n$ node nn/${script} ${args.join(' ')}`);
    let out = '';
    const ch = spawn('node', [path.join(dir, script), ...args]);
    ch.stdout.on('data', d => { out += d; process.stdout.write(d); });
    ch.stderr.on('data', d => process.stderr.write(d));
    ch.on('exit', code => code === 0 ? resolve(out)
      : reject(Object.assign(new Error(`${script} exited ${code}`), { partialOut: out })));
    ch.on('error', reject);
  });
}
async function runCapturedSoftAsync(script, args) {
  try { return await runCapturedAsync(script, args); }
  catch (e) { log(`WARNING: ${script} failed (${e.message}) — continuing`); return e.partialOut || ''; }
}
// arena.js's closing line reads "nn(best.json,D2) vs L3: 3-0  (100% of decided, ...)". Take the LAST
// such pair -- the earlier ones are the live per-game running tally, which has the same "N-M" shape.
const arenaScore = out => {
  const m = [...out.matchAll(/:\s*(\d+)-(\d+)(?:-\d+)?\s+\(/g)];
  return m.length ? { w: +m[m.length - 1][1], l: +m[m.length - 1][2] } : null;
};

// The hidden-layer spec of whatever is currently best.json, as train.js's --hidden wants it
// ("96,96"), so the from-scratch challenger is always the same ARCHITECTURE as the incumbent and
// the round robin between them is a clean test of the training schedule alone. Returns null if
// best.json doesn't exist yet or can't be read, in which case train.js's own default applies.
// Shape of any saved model, read off its own weights. hiddenOfBest is this applied to best.json.
const hiddenOf = p => {
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(j.sizes) && j.sizes.length > 2) return j.sizes.slice(1, -1).join(',');
  } catch (e) {}
  return null;
};
const hiddenOfBest = () => {
  try {
    const j = JSON.parse(fs.readFileSync(best, 'utf8'));
    if (Array.isArray(j.sizes) && j.sizes.length > 2) return j.sizes.slice(1, -1).join(',');
  } catch (e) {}
  return null;
};

// How many rungs the ladder actually has, read from the game itself rather than hardcoded so the
// sweep can't walk off the end if a level is ever added or removed.
let LADDER_N = 11;
try { LADDER_N = require('./engine.js').createEngine().AI_LADDER.length; } catch (e) {}

// Each depth carries its OWN window bottom, persisted (restarts are constant here -- closing the
// window, a reboot, a code pull -- and a window that reset to L1 each time would spend its whole
// budget re-proving rungs retired hours ago).
//
// Per-depth, because strength is a DIAGONAL across the (level x depth) grid, not a vertical line:
// each extra ply buys roughly another ladder rung, so at any one moment 1-ply is fighting L1-L3
// while 3-ply is fighting L4-L6. A single shared window forced every depth onto the same rungs,
// which made most cells a foregone 0-3 or 3-0 -- and a foregone cell costs exactly what an
// informative one costs. Worse, retirement keyed on 1-ply alone, so the whole sweep was pinned to
// the slowest-moving row: the net was beating L8 at 4-ply while the window sat at L1-L4, because
// raw 1-ply still dropped games to L2. Letting each depth climb at its own rate makes the set of
// window bottoms the progress metric itself (e.g. "1ply:L2 2ply:L4 3ply:L6" -- that IS the
// diagonal, and it moving up-left is exactly what improvement looks like).
const windowFile = path.join(dir, 'models', '.ladder-window');
const readWindows = () => {
  const flat = () => { const o = {}; for (const d of benchDepths) o[d] = 1; return o; };
  try {
    const raw = fs.readFileSync(windowFile, 'utf8').trim();
    const n = +raw;
    // migrate the old format: a bare number was one window shared by every depth
    if (Number.isFinite(n) && n >= 1) { const o = {}; for (const d of benchDepths) o[d] = n; return o; }
    const j = JSON.parse(raw), o = {};
    for (const d of benchDepths) o[d] = (Number.isFinite(+j[d]) && +j[d] >= 1) ? +j[d] : 1;
    return o;
  } catch (e) {}
  return flat();
};
const writeWindows = w => { try { fs.writeFileSync(windowFile, JSON.stringify(w) + '\n'); } catch (e) {} };

// Regression memory, kept separate from the window file: {depth: [level, level, ...]}, the rungs
// BELOW each depth's current frontier that used to sweep clean and, on a later spot-check (see the
// benchmark block below), didn't. Persisted for the same reason the window is -- it must survive a
// restart, and it must not be recomputed from scratch every run (that would mean losing a whole
// benchEveryMin cycle's worth of "still regressed" signal every time the console gets closed).
const regressedFile = path.join(dir, 'models', '.ladder-regressed');
const readRegressed = () => {
  try { return JSON.parse(fs.readFileSync(regressedFile, 'utf8')); } catch (e) { return {}; }
};
const writeRegressed = r => { try { fs.writeFileSync(regressedFile, JSON.stringify(r) + '\n'); } catch (e) {} };

// Zone-of-proximal-development sampling: instead of selfplay.js's flat default ladder-opponent pool
// (2,3,4,5,6, the same range no matter how strong the net already is), build a pool centred on each
// depth's CURRENT frontier. selfplay.js's pick() is a uniform draw over the array it's given, so
// weighting is just repetition: a level appearing 9 times is 9x as likely to be drawn as one
// appearing once, no change needed in selfplay.js itself. Depths are weighted 9:3:1 (roughly the
// ~3.6x-per-ply decay selfplay.js's own nnDepthMix already uses to match search COST, rounded to a
// plain 3x step) because that same skew is how much of selfplay's game volume actually plays at each
// depth -- most games are depth-1, so the depth-1 frontier should dominate the pool, not get diluted
// by deeper depths' bands that most games never touch anyway. Regressed levels (any depth) are
// folded in at a flat 3x weight -- deliberately not scaled by depth, since a rung the net USED to
// have solid is a more urgent gap than a fresh rung it never mastered in the first place.
//
// The shape over levels is a BELL centred half a rung above the frontier (so the peak straddles
// win[d] and win[d]+1, the two rungs actually in contention), not a hard box. topFloor guarantees
// the TOP rung a few entries even where the bell has decayed to nothing, since it is 4-5 sigma out
// while the frontier is down at L6 and would otherwise reproduce the "never played L11" bug this
// replaced. --topFloor 0 restores pure bell weighting.
function zpdLevels(win, regressed) {
  const pool = [];
  const depths = Object.keys(win).map(Number).sort((a, b) => a - b);
  depths.forEach((d, i) => {
    const repeat = Math.max(1, Math.round(9 / Math.pow(3, i)));
    const mu = Math.max(1, win[d]) + 0.5;
    for (let l = 1; l <= LADDER_N; l++) {
      const n = Math.round(repeat*Math.exp(-Math.pow(l - mu, 2)/(2*zpdSigma*zpdSigma)));
      for (let r = 0; r < n; r++) pool.push(l);
    }
  });
  for (const d of Object.keys(regressed))
    for (const l of (regressed[d] || [])) for (let r = 0; r < 3; r++) pool.push(l);
  // max, not add: once the frontier climbs high enough that the bell covers the top rung on its
  // own, this must stop contributing rather than keep piling weight on the hardest opponent.
  for (let have = pool.filter(l => l === LADDER_N).length; have < topFloor; have++) pool.push(LADDER_N);
  return pool.length ? pool : null;
}

// --- architecture hill-climb helpers ------------------------------------------------------------
// The champion shape lives in a file, not a variable: it has to survive restarts, and it has to
// OUTRANK the --scratchHidden pin once fights have been won -- a pin is a guess made before the
// data existed, the store is the running result of measured head-to-heads that started from that
// guess. Delete the file to reset the climb to the pin.
const shapeFile = path.join(dir, 'models', '.scratch-shape');
const shapeHistFile = path.join(dir, 'models', '.shape-history');
const championShape = () => {
  try { return JSON.parse(fs.readFileSync(shapeFile, 'utf8')).shape || null; } catch (e) { return null; }
};
// One small random edit of a hidden spec ("96,64,48"). Sizes snap to multiples of 4 with a floor
// of 8; depth changes insert the geometric mean of the neighbours (the size a smooth taper would
// have put there anyway) or drop a random layer. Single edit per fight ON PURPOSE: change two
// things and a win says nothing about either.
function mutateHidden(spec) {
  const shape = spec.split(',').map(Number).filter(n => n > 0);
  if (!shape.length) return null;
  const snap = n => Math.max(8, Math.round(n/4)*4);
  const ops = ['widen', 'narrow', 'add'];
  if (shape.length > 2) ops.push('drop');
  for (let tries = 0; tries < 8; tries++) {
    const op = ops[Math.floor(Math.random()*ops.length)];
    const next = shape.slice();
    const i = Math.floor(Math.random()*next.length);
    if (op === 'widen') next[i] = snap(next[i]*(1.15 + Math.random()*0.2));
    else if (op === 'narrow') next[i] = snap(next[i]*(0.7 + Math.random()*0.15));
    else if (op === 'add') {
      const j = Math.floor(Math.random()*(next.length + 1));
      const a = next[j - 1] || next[0], b = next[j] || next[next.length - 1];
      next.splice(j, 0, snap(Math.sqrt(a*b)));
    } else next.splice(i, 1);
    const out = next.join(',');
    if (out !== spec) return { shape: out, op };
  }
  return null;
}

// A small status file, pushed to git at each major transition, so progress can be checked by
// reading the repo (GitHub's own UI, or `git fetch` anywhere) instead of reading this console --
// this machine is the only thing that can see the console, but anyone with the repo can see git.
// Every git call here is soft: nothing in this file may ever throw past writeStatus(), so a git
// hiccup (no network, no credentials configured, a real merge conflict) can only skip an update,
// never interrupt training. On a push rejection (the remote has commits this checkout doesn't --
// expected, since code changes land on the same branch) it does one plain `git pull` (a real
// merge, never a force-push) and retries once; if that still fails, it just gives up for this
// cycle and tries again at the next transition.
const repoRoot = path.join(dir, '..');
// Which git can this PROCESS actually run? The shell:true trick below (resolve like a typed
// command) turned out not to be enough on the real machine either: the trainer's console spammed
// "'git' is not recognized as an internal or external command" on every single transition of a
// 10-hour run, because that box pulls with GitHub Desktop and has NO git on PATH at all -- Desktop
// carries its own bundled copy instead. Probe once, cheapest first: bare `git`, then GitHub
// Desktop's bundle (a versioned app-x.y.z dir, newest first, since old versions linger after
// updates), then Git for Windows' default install dirs. null = nothing anywhere; status.md then
// stays local-only and the log says so ONCE instead of three lines per transition.
let gitCmd;                                   // undefined = not probed yet, null = probed, none found
let warnedNoGit = false;
function findGit() {
  if (gitCmd !== undefined) return gitCmd;
  const q = s => '"' + String(s).replace(/"/g, '\\"') + '"';
  const works = cmd => {
    try {
      execFileSync(cmd === 'git' ? 'git' : q(cmd), ['--version'],
                   { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return true;
    } catch (e) { return false; }
  };
  const candidates = ['git'];
  try {
    const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
    // numeric version compare, not string sort -- "3.4.10" must beat "3.4.2"
    const ver = f => f.slice(4).split('.').map(Number);
    const apps = fs.readdirSync(base).filter(f => /^app-/.test(f))
      .sort((a, b) => { const va = ver(a), vb = ver(b);
        for (let i = 0; i < 3; i++) if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0);
        return 0; });
    for (const a of apps) candidates.push(path.join(base, a, 'resources', 'app', 'git', 'cmd', 'git.exe'));
  } catch (e) {}
  candidates.push('C:\\Program Files\\Git\\cmd\\git.exe',
                  'C:\\Program Files (x86)\\Git\\cmd\\git.exe');
  gitCmd = candidates.find(works) || null;
  if (gitCmd && gitCmd !== 'git') log(`status updates: using git at ${gitCmd}`);
  return gitCmd;
}
const statusState = {};
// Artefacts pushed alongside status.md, split by how git stores them. Data files are written once
// (well -- now GROW incrementally as the current self-play batch progresses, but a line already
// written to disk is never rewritten, only appended past) so git keeps one delta-friendly history
// per file. Models are dense float JSON that does not delta-compress, so pushing each one would
// add a fresh blob to history forever; best.json therefore rides along only when a round robin
// actually promotes something.
// --no-push-artifacts turns this off, e.g. if a second trainer is pushing to the same branch, where
// two machines writing the same batch-NNN.jsonl name would collide.
const pushArtifacts = !process.argv.includes('--no-push-artifacts');
function writeStatus(stage, extraPaths) {
  statusState.stage = stage;
  statusState.updatedAt = new Date().toISOString();
  const md = `# Tau NN training status\n_Last updated: ${statusState.updatedAt}_\n\n` +
    `**Self-play batch:** ${statusState.batch ?? '-'}\n` +
    `**Stage:** ${statusState.stage}\n` +
    `**mix:** ${statusState.mix ?? '-'}\n\n` +
    `**Last gate result:** ${statusState.lastGate ?? '(none yet)'}\n\n` +
    `**Last checkpoint:** ${statusState.lastCheckpoint ?? '(none yet)'}\n\n` +
    `**Last ladder sweep:** ${statusState.lastBenchmark ?? '(none yet)'}\n`;
  // The real stderr text, not Node's generic "Command failed: <cmdline>" wrapper -- declared
  // outside the try so the OUTER catch (an unguarded call like `git add` throwing) can use it too,
  // not just the inner catches around push/pull.
  const errText = e => String((e && (e.stderr || e.stdout)) || (e && e.message) || e).trim().split('\n').slice(0, 3).join(' | ');
  try {
    fs.writeFileSync(path.join(dir, 'status.md'), md);
    // shell:true so Windows resolves `git` the same way a typed command would (PATH + PATHEXT) --
    // a plain execFileSync bypasses that and fails outright (ENOENT) on setups where git is only
    // reachable through the shell's own resolution, e.g. a GitHub-Desktop-managed git not
    // separately added to PATH the way a spawned child process needs. Confirmed on the real
    // machine: `git pull` inside START.bat (typed-command-equivalent) works fine, the identical
    // execFileSync('git', ...) here did not, until this fix. shell:true has its own cost, though:
    // Node just joins the args array with spaces and hands the WHOLE string to the shell, so an
    // arg containing a space (the commit message) silently splits into two shell words instead of
    // staying one argument -- confirmed by testing: it produced `git commit -m nn: status update`,
    // which git parsed as message "nn:" plus two bogus pathspecs and rejected outright. Quoting
    // every argument ourselves before joining is the fix; verified against a scratch repo that this
    // produces the correct single-line commit message AND still resolves git on the shell path.
    const q = s => '"' + String(s).replace(/"/g, '\\"') + '"';
    // encoding (not stdio:'ignore') so a failure's REAL stderr is visible in log.txt/the console --
    // a bare "Command failed: git ..." wrapper message with the actual git error thrown away was a
    // real diagnostic dead end already hit once (see git history): after fixing the ENOENT (git not
    // found at all) and a quoting bug (args joined without quotes), a THIRD failure showed up with
    // no way to tell what git itself objected to. Whatever surfaces next gets logged in full instead
    // of guessed at.
    const found = findGit();
    if (!found) {
      if (!warnedNoGit) {
        warnedNoGit = true;
        log('status.md stays local-only: no git found (PATH, GitHub Desktop bundle, Program Files all probed)');
      }
      return;
    }
    const gitExe = found === 'git' ? 'git' : q(found);
    const git = (args) => execFileSync(gitExe, args.map(q), { cwd: repoRoot, shell: true, encoding: 'utf8' });
    git(['add', 'nn/status.md']);
    // Each extra path is added separately and softly: a missing file must never take down the
    // status push, which is the one thing that has to keep working for a many-hour run to stay
    // observable.
    // -f is REQUIRED, not belt-and-braces: nn/.gitignore excludes data/ and models/ wholesale, so
    // a plain `git add` on these paths fails outright. -f names the specific exceptions worth
    // keeping rather than punching holes in .gitignore, which is still right for everything else
    // under those directories (checkpoints, log.txt, scratch models).
    if (pushArtifacts && extraPaths) {
      for (const p of extraPaths) {
        try { git(['add', '-f', p]); } catch (e) { log(`could not stage ${p} (${errText(e)})`); }
      }
    }
    try { git(['commit', '-m', 'nn: status update']); } catch (e) { /* nothing changed -- fine */ }
    try { git(['push']); }
    catch (e) {
      try { git(['pull', '--no-edit', '--no-rebase']); git(['push']); }
      catch (e2) { log(`status push skipped (${errText(e2)})`); }
    }
  } catch (e) { log(`WARNING: status write failed (${errText(e)}) — continuing`); }
}

// Pull worker machines' pushed games onto disk on its OWN schedule. Before this, the only pull in
// this file was writeStatus's fallback -- triggered when THIS machine's own push happens to lose a
// race, which merges in whatever landed in the meantime as a side effect. That is usually soon
// enough in practice (both sides push every few minutes), but it is incidental, not guaranteed --
// nothing bounds how long a run could go without picking up a worker's games if the desktop's own
// pushes simply don't happen to collide with one for a while. For an unattended overnight run with
// a second machine now generating data, "usually" is the wrong word to be resting on: this makes
// it deterministic instead. Every train.js call already scans the whole data/ directory, so a
// worker's files start feeding training the moment they are ON DISK -- this is the only step that
// was missing to make that promised, not lucky.
function pullWorkers() {
  const found = findGit();
  if (!found) return;
  const q = s => '"' + String(s).replace(/"/g, '\\"') + '"';
  const errText = e => String((e && (e.stderr || e.stdout)) || (e && e.message) || e).trim().split('\n').slice(0, 3).join(' | ');
  try {
    const gitExe = found === 'git' ? 'git' : q(found);
    const before = execFileSync(gitExe, ['rev-parse', 'HEAD'].map(q),
                                { cwd: repoRoot, shell: true, encoding: 'utf8' }).trim();
    execFileSync(gitExe, ['pull', '--no-edit', '--no-rebase'].map(q),
                { cwd: repoRoot, shell: true, encoding: 'utf8' });
    const after = execFileSync(gitExe, ['rev-parse', 'HEAD'].map(q),
                               { cwd: repoRoot, shell: true, encoding: 'utf8' }).trim();
    if (before !== after) log(`pulled new commits (worker games, most likely) from origin`);
  } catch (e) { log(`WARNING: periodic pull failed (${errText(e)}) — continuing`); }
}

// One-time reseed: the fresh-vs-best gate used to always promote regardless of the arena result
// (fixed above), so best.json was never a real ratchet -- it could easily be worse than an earlier
// checkpoint. Before trusting it, run a full round robin across every saved model once and promote
// whichever actually wins the most, then never do this again (the now-real gate keeps it honest
// from here on). A sentinel file (not the checkpoint count) marks it done, since it must survive
// restarts and must not re-run every time start.bat is double-clicked.
const tournamentDone = path.join(dir, 'models', '.tournament-done');
if (!fs.existsSync(tournamentDone)) {
  const modelsDir = path.join(dir, 'models');
  const candidates = fs.existsSync(modelsDir)
    ? fs.readdirSync(modelsDir).filter(f => /^(ckpt-\d+|best|value)\.json$/.test(f))
    : [];
  if (candidates.length > 1) {
    log(`one-time reseed: ${candidates.length} saved models found -- running a round robin to find the real best before continuing`);
    runSoft('tournament.js', ['--promote', '--recent', tournamentRecent, '--workers', workers]);
  }
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.writeFileSync(tournamentDone, new Date().toISOString() + '\n');
}

// Two independent counters now, where there used to be one: a self-play BATCH used to be the same
// thing as a training/checkpoint ITERATION, one-to-one. They're decoupled now -- batches are large
// and chain themselves continuously, checkpoints only happen when a round robin actually runs -- so
// each needs its own resume point, read from its own file family.
function nextNum(pattern) {
  const modelsDir = path.join(dir, 'models');
  let max = 0;
  const scan = (d, rx) => { if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d)) { const m = rx.exec(f); if (m) max = Math.max(max, +m[1]); } };
  if (pattern === 'batch') scan(path.join(dir, 'data'), /^batch-(\d+)\.jsonl$/);
  else scan(modelsDir, /^ckpt-(\d+)\.json$/);
  return max + 1;
}
let batchNum = nextNum('batch');
let cycleNum = nextNum('cycle');
if (batchNum > 1) log(`resuming self-play at batch ${batchNum} (found data up to batch-${String(batchNum - 1).padStart(3, '0')}.jsonl)`);
if (cycleNum > 1) log(`resuming ${poolEveryMin > 0 ? 'pool' : 'round-robin'} cycles at ${cycleNum} ` +
  `(found checkpoints up to ckpt-${String(cycleNum - 1).padStart(3, '0')}.json)`);

// --- self-play: one long-running process, chaining itself into a fresh batch on exit ---------
let selfplayChild = null, selfplayOut = null, selfplayStartedAt = null;
// Every model-variety slot/architecture file currently on disk, handed to selfplay.js as a POOL
// (see its own header note) so EACH SIDE of EACH nn-involving game rolls independently -- an nnnn
// game can genuinely be two different architectures facing off, not one net occasionally facing
// itself under an alias, which is what switching the WHOLE batch's primary model would have meant.
function currentModelPool() {
  const candidates = [];
  try {
    for (const f of fs.readdirSync(path.join(dir, 'models'))) {
      if (/^pool-slot-\d+\.json$/.test(f) ||
          ['wide.json', 'ultra.json', 'deep.json', 'l15_value.json'].includes(f))
        candidates.push(path.join(dir, 'models', f));
    }
  } catch (e) {}
  return candidates;
}

function startSelfplayBatch() {
  const num = batchNum++;
  const out = path.join(dir, 'data', `batch-${String(num).padStart(3, '0')}.jsonl`);
  selfplayOut = out;
  selfplayStartedAt = Date.now();
  // Only bias sampling once there's a model with a real frontier to bias toward -- pre-model,
  // every game is ladder-vs-ladder anyway (see selfplay.js's own kind selection), so there is no
  // "current strength" for a ZPD band to be centred on.
  const dataPool = fs.existsSync(best) ? zpdLevels(readWindows(), readRegressed()) : null;
  // Print the actual counts, not just "ZPD-biased levels pool" -- the shape of this distribution
  // is a real tuning decision (--zpdSigma, --topFloor) and was invisible before; a stale window
  // silently giving a rung zero games is exactly how the net went 61 iterations without ever
  // playing L11.
  const poolNote = dataPool
    ? ', pool ' + [...new Set(dataPool)].sort((a, b) => a - b)
        .map(l => `L${l}x${dataPool.filter(x => x === l).length}`).join(' ')
    : '';
  // Published for worker machines (worker.js): they play the same frontier-centred opponent mix
  // as this machine instead of selfplay's static default, and they get it through git like
  // everything else. Rides along on the next status push.
  if (dataPool) {
    try {
      atomicWrite(path.join(dir, 'zpd-pool.json'),
                  JSON.stringify({ updated: new Date().toISOString(), levels: dataPool }));
    } catch (e) {}
  }
  const modelPool = currentModelPool();
  const varietyNote = modelPool.length ? `, ${modelPool.length}-model variety pool` : '';
  log(`self-play batch ${num} starting: ${gamesPerBatch} games (mix ${mix}, ${workers} workers${poolNote}${varietyNote})`);
  statusState.batch = num;
  statusState.mix = fs.existsSync(best) ? mix : '(no model yet — pure ladder)';
  const args = ['--games', String(gamesPerBatch), '--out', out, '--model', best, '--mix', mix,
    '--workers', workers, '--randomStartFrac', String(randomStartFrac),
    '--modelVarietyFrac', String(modelVarietyFrac),
    ...(modelPool.length ? ['--modelPool', modelPool.join(',')] : []),
    ...(dataPool ? ['--levels', dataPool.join(',')] : [])];
  const ch = spawn('node', [path.join(dir, 'selfplay.js'), ...args], { stdio: 'inherit' });
  selfplayChild = ch;
  ch.on('exit', (code) => {
    log(`self-play batch ${num} ended (exit ${code}) — starting the next one`);
    startSelfplayBatch();
  });
  ch.on('error', (e) => {
    log(`WARNING: self-play batch ${num} failed to start (${e.message}) — retrying in ${checkEveryMin} min`);
    selfplayChild = null;
    setTimeout(startSelfplayBatch, checkEveryMin*60000);
  });
}

// --- housekeeping: retrain-from-scratch + round robin + promote, and the ladder sweep ---------
// Both run on their own wall-clock schedule, independent of self-play, which keeps generating
// games in the background the whole time these run (sharing cores, not losing them).
let lastTournamentAt = Date.now(), lastBenchAt = Date.now(), lastTrainAt = Date.now(),
    lastPoolAt = Date.now(), lastRetroAt = Date.now();

// Resume-train from best.json and promote the result. Bounded, not unbounded: the round robin
// below periodically retrains from scratch and promotes on merit, which is what stops this from
// compounding into the iteration-63/80 failure (see the header). Runs on a clock now rather than
// once per self-play batch, since batches are hours long and this should not be.
async function runTrainCycle() {
  if (!fs.existsSync(best)) return;   // nothing to resume from yet
  log(`resume-train ${epochs} epochs from best.json`);
  writeStatus(`resume-train (${epochs} epochs, started ${new Date().toISOString()})`);
  try {
    await runAsync('train.js', ['--epochs', epochs, '--out', fresh, '--resume', best]);
    atomicCopy(fresh, best);
    log(`resume-train complete — promoted (round robin every ${tournamentEveryMin} min decides the real best)`);
    statusState.lastGate = `resume-train promoted at ${new Date().toISOString()}`;
  } catch (e) {
    log(`WARNING: resume-train failed (${e.message}) — continuing`);
  }
}

// Place the current best.json in the standing pool, then promote whichever rated model is
// strongest. Replaces the round robin's job with far fewer games, and leaves behind a rating
// history for every checkpoint on ONE scale -- which is the thing that was missing when three
// round robins disagreed about whether resume-training helps and a fourth reversed the answer.
// A curve would have shown it directly instead of it having to be inferred.
// Refresh the capped model-variety slots from the SAME ratings a pool cycle just computed --
// costs nothing extra to determine, the Elo is already known. `ranked` is one entry per model at
// its best rated depth (see the promotion block above), already sorted; this just re-sorts
// ascending to pick evenly-spaced percentile positions across it. Slots get OVERWRITTEN in place
// as the population shifts -- never accumulated -- which is what keeps the git footprint capped
// regardless of how many models the pool has ever rated.
function refreshModelSlots(ranked) {
  if (poolSlots <= 0 || ranked.length < 2) return [];
  const byElo = ranked.slice().sort((a, b) => a.elo - b.elo);
  const picks = [];
  const seen = new Set();
  for (let i = 0; i < poolSlots; i++) {
    const idx = byElo.length === 1 ? 0 : Math.round(i*(byElo.length - 1)/(poolSlots - 1));
    const cand = byElo[idx];
    if (seen.has(cand.model)) continue;   // small population: fewer real slots is honest, not padded
    seen.add(cand.model);
    picks.push(cand);
  }
  const pushed = [];
  picks.forEach((cand, i) => {
    // summaries written by elorank point at its .elo-snapshot copies; fall back to the live
    // models dir if a snapshot has been cleaned up since (same fallback retromine.js uses)
    let mp = cand.model;
    if (!mp || !fs.existsSync(mp)) mp = path.join(dir, 'models', path.basename(cand.model || ''));
    if (!fs.existsSync(mp)) return;
    const slotPath = path.join(dir, 'models', `pool-slot-${String(i + 1).padStart(2, '0')}.json`);
    atomicCopy(mp, slotPath);
    pushed.push(path.relative(repoRoot, slotPath).replace(/\\/g, '/'));
  });
  // Fixed architecture references, pushed under their own names -- unconditional, not percentile-
  // picked, because they represent different SHAPES worth having available regardless of where
  // their current rating happens to fall (a shape briefly weak is still a shape worth the
  // occasional game, the same reasoning the shape-fight itself runs on).
  for (const name of ['wide', 'ultra', 'deep', 'l15_value']) {
    const p2 = path.join(dir, 'models', name + '.json');
    if (fs.existsSync(p2)) pushed.push(path.relative(repoRoot, p2).replace(/\\/g, '/'));
  }
  return pushed;
}

async function runPoolCycle() {
  const num = cycleNum++;
  // Snapshot the challenger under a stable name first. best.json is rewritten by the resume-train
  // clock, so rating "best.json" would attribute games to a moving target -- the same bug that made
  // elorank snapshot its whole field. A numbered copy is a fixed thing that can be rated once and
  // referred to forever.
  const ckpt = path.join(dir, 'models', `ckpt-${String(num).padStart(3, '0')}.json`);
  if (!fs.existsSync(best)) { log(`pool cycle ${num} — no best.json yet, skipping`); return; }
  atomicCopy(best, ckpt);
  log(`pool cycle ${num} — checkpoint saved: ${path.basename(ckpt)}`);
  statusState.lastCheckpoint = `${path.basename(ckpt)} at ${new Date().toISOString()}`;

  // The from-scratch challenger still enters, for the reason the header records: resume-training
  // adds strength over a few iterations and degrades over dozens, and this is what catches the
  // degradation. It just gets PLACED now rather than round-robinned.
  const focus = [ckpt];
  let mutInfo = null;
  let slotPaths = [];
  if (+scratchEpochs > 0) {
    const scratch = path.join(dir, 'models', `scratch-${String(num).padStart(3, '0')}.json`);
    // champion shape (won a fight) > pin (a pre-data guess) > incumbent's own shape
    const h = championShape() || scratchHidden || hiddenOfBest();
    log(`pool cycle ${num} — training a from-scratch challenger (${scratchEpochs} epochs` +
        (h ? `, --hidden ${h}` : '') + `)`);
    writeStatus(`from-scratch challenger training (${scratchEpochs} epochs, started ${new Date().toISOString()})`);
    await runSoftAsync('train.js', ['--epochs', scratchEpochs, '--out', scratch, ...(h ? ['--hidden', h] : [])]);
    if (fs.existsSync(scratch)) focus.push(scratch);
    // The shape fight. Trained back-to-back with the control on the same corpus (self-play may
    // append a few games in between -- noise against tens of thousands of rows), same epochs, and
    // placed in the same pool run. The fight is fair because everything except the shape is shared.
    if (mutateShape && h) {
      const mut = mutateHidden(h);
      if (mut) {
        const mutPath = path.join(dir, 'models', `mut-${String(num).padStart(3, '0')}.json`);
        log(`pool cycle ${num} — shape fight: control ${h} vs mutant ${mut.shape} (${mut.op})`);
        await runSoftAsync('train.js', ['--epochs', scratchEpochs, '--out', mutPath, '--hidden', mut.shape]);
        if (fs.existsSync(mutPath)) { focus.push(mutPath); mutInfo = { ...mut, control: h, mutPath, scratch }; }
      }
    }
  }

  // one variant lineage gets a light touch of training, rotating through whichever exist
  const variants = ['wide', 'ultra', 'deep', 'l15_value']
    .filter(n => fs.existsSync(path.join(dir, 'models', n + '.json')));
  if (variantEpochs > 0 && variants.length) {
    const name = variants[num % variants.length];
    const lineage = fs.readdirSync(path.join(dir, 'models'))
      .filter(f => f.startsWith(name + '-') && /-\d+\.json$/.test(f)).sort();
    // A lineage used to resume from its own last link FOREVER -- wide-094 from wide-092 from
    // wide-090, with no reset ever. That is exactly the unbounded resume-training this file's own
    // header documents as the iteration-63/80 failure: it adds strength over a handful of
    // iterations and degrades over dozens. best.json is protected from it (the round robin and the
    // pool re-derive it from scratch); these lineages were not. Suggestive rather than proof, but
    // ultra was the top-rated brain in the pool at ~500 Elo and has since dropped out of the rated
    // list entirely.
    // So every variantFreshEvery-th time a given lineage comes up, it is retrained FROM SCRATCH at
    // its own architecture instead of resumed. The shape -- which is the whole reason these
    // lineages exist -- is preserved; only the accumulated resume-training is discarded. The pool
    // then judges fresh against resumed on merit, as it does for everything else.
    const turn = Math.floor(num/variants.length);       // how many times THIS lineage has come up
    const fresh = variantFreshEvery > 0 && turn > 0 && turn % variantFreshEvery === 0;
    const base = path.join(dir, 'models', name + '.json');
    const from = path.join(dir, 'models', lineage.length ? lineage[lineage.length - 1] : name + '.json');
    const outV = path.join(dir, 'models', `${name}-${String(num).padStart(3, '0')}.json`);
    const shape = hiddenOf(fresh ? base : from);
    if (fresh && shape) {
      log(`pool cycle ${num} — variant lineage: ${name} RESET, training from scratch at ${shape} ` +
          `(${scratchEpochs} epochs) instead of resuming -- ${turn} resumes deep`);
      await runSoftAsync('train.js', ['--epochs', scratchEpochs, '--hidden', shape, '--out', outV]);
    } else {
      log(`pool cycle ${num} — variant lineage: ${path.basename(from)} + ${variantEpochs} epochs -> ${path.basename(outV)}`);
      await runSoftAsync('train.js', ['--epochs', String(variantEpochs), '--resume', from, '--out', outV]);
    }
    if (fs.existsSync(outV)) focus.push(outV);
  }

  const wide = poolWideEvery > 0 && num % poolWideEvery === 0;
  log(`pool cycle ${num} — placing ${focus.map(f => path.basename(f)).join(', ')} in the rating pool` +
      (wide ? ' (wide pass: budget goes wherever the pool is least certain)' : ''));
  writeStatus(`rating pool placement (started ${new Date().toISOString()})`);
  await runSoftAsync('elorank.js', ['--focus', focus.join(','), ...(wide ? ['--focusPairs', '0'] : []),
                         '--out', poolFile, '--summary', poolSummary,
                         '--budgetHours', String(poolBudgetHours), '--workers', poolWorkers,
                         '--depths', poolDepths, '--games', poolGames,
                         ...(poolLevels ? ['--levels', poolLevels] : []), '--saveData',
                         path.join(dir, 'data', `pool-${String(num).padStart(3, '0')}.jsonl`)]);

  // Promote on rating, with the interval respected: a challenger has to be clearly ahead, not
  // merely ahead, or this becomes the noise-ratchet the old per-iteration gate was retired for
  // (best.json is a running maximum over noisy draws, so it is upward-biased and an equal net has
  // to beat the luck as well as the strength).
  try {
    const sum = JSON.parse(fs.readFileSync(poolSummary, 'utf8'));
    const rated = Object.entries(sum.players || {})
      .filter(([, v]) => v.kind === 'nn' && v.model && v.games >= 6)
      .map(([id, v]) => ({ id, ...v }));
    if (!rated.length) { log(`pool cycle ${num} — nothing rated yet, keeping best.json`); return; }
    // one entry per MODEL (best depth), since depth is a search setting rather than a property of
    // the weights being promoted
    const byModel = {};
    for (const r of rated) {
      const k = path.basename(r.model, '.json');
      if (!byModel[k] || r.elo > byModel[k].elo) byModel[k] = r;
    }
    const ranked = Object.values(byModel).sort((a, b) => b.elo - a.elo);
    const top = ranked[0];
    const incumbentName = path.basename(ckpt, '.json');
    const incumbent = byModel[incumbentName];
    const topName = path.basename(top.model, '.json');
    const line = ranked.slice(0, 5)
      .map(r => `${path.basename(r.model, '.json')} ${Math.round(r.elo)}`).join(', ');
    log(`pool cycle ${num} — ratings: ${line}`);
    if (topName === incumbentName) {
      log(`pool cycle ${num} — current net is already the strongest rated; keeping best.json`);
    } else if (incumbent && top.elo - incumbent.elo < 30) {
      log(`pool cycle ${num} — ${topName} leads by only ${Math.round(top.elo - incumbent.elo)} Elo; ` +
          `too close to justify swapping, keeping best.json`);
    } else if (fs.existsSync(top.model)) {
      atomicCopy(best, path.join(dir, 'models', `best.pre-pool-${Date.now()}.json`));
      atomicCopy(top.model, best);
      log(`pool cycle ${num} — promoted ${topName} (${Math.round(top.elo)} Elo` +
          (incumbent ? `, +${Math.round(top.elo - incumbent.elo)} over the incumbent` : '') + `)`);
    }
    statusState.lastGate = `pool cycle ${num} — ${line}`;
    slotPaths = refreshModelSlots(ranked);
    if (slotPaths.length) log(`pool cycle ${num} — model-variety slots refreshed: ${slotPaths.length} files`);
    // Shape-fight verdict, decided by the same ratings. The mutant needs a clear lead to take the
    // shape (same reasoning as the promotion gate: a from-scratch pair is two noisy draws, and
    // "merely ahead" would let the shape random-walk on luck); a clear LOSS is recorded too, so
    // .shape-history accumulates which kinds of edits helped and which hurt.
    if (mutInfo) {
      const ctl = byModel[path.basename(mutInfo.scratch, '.json')];
      const mut = byModel[path.basename(mutInfo.mutPath, '.json')];
      if (ctl && mut) {
        const lead = mut.elo - ctl.elo;
        const verdict = lead >= 25 ? 'adopted' : lead <= -25 ? 'rejected' : 'inconclusive';
        if (verdict === 'adopted') {
          atomicWrite(shapeFile, JSON.stringify({ shape: mutInfo.shape, cycle: num,
                                                  adoptedAt: new Date().toISOString() }));
          log(`pool cycle ${num} — shape fight: mutant ${mutInfo.shape} (${mutInfo.op}) beat ` +
              `${mutInfo.control} by ${Math.round(lead)} Elo — new champion shape`);
        } else {
          log(`pool cycle ${num} — shape fight: ${mutInfo.shape} (${mutInfo.op}) vs ` +
              `${mutInfo.control}: ${Math.round(lead)} Elo — ${verdict}, keeping ${mutInfo.control}`);
        }
        try {
          fs.appendFileSync(shapeHistFile, JSON.stringify({ cycle: num, control: mutInfo.control,
            mutant: mutInfo.shape, op: mutInfo.op, ctlElo: +ctl.elo.toFixed(1),
            mutElo: +mut.elo.toFixed(1), verdict }) + '\n');
        } catch (e) {}
      } else {
        log(`pool cycle ${num} — shape fight unresolved (` +
            `${ctl ? '' : 'control unrated'}${!ctl && !mut ? ', ' : ''}${mut ? '' : 'mutant unrated'}` +
            `) — no verdict, keeping ${mutInfo.control}`);
      }
    }
  } catch (e) {
    log(`WARNING: pool promotion skipped (${e.message}) — keeping best.json`);
  }
  writeStatus(`pool cycle ${num} complete`, ['nn/models/best.json', 'nn/elo-summary.json', ...slotPaths]);
}

async function runTournamentCycle() {
  const num = cycleNum++;
  // The from-scratch challenger. Trained BEFORE the round robin so it is in the field when the
  // round robin runs, and deliberately without --resume: resuming is the very thing this whole
  // redesign exists to stop doing. The shape is read off best.json rather than left to train.js's
  // default, so that adopting a different architecture (by copying it over best.json) isn't
  // silently undone by a challenger that reverts to 96,96 every cycle.
  if (+scratchEpochs > 0) {
    const scratch = path.join(dir, 'models', 'scratch.json');
    const h = scratchHidden || hiddenOfBest();
    log(`round-robin cycle ${num} — training a from-scratch challenger (${scratchEpochs} epochs` +
        (h ? `, --hidden ${h}` : '') + `)`);
    writeStatus(`from-scratch challenger training (${scratchEpochs} epochs, started ${new Date().toISOString()})`);
    await runSoftAsync('train.js', ['--epochs', scratchEpochs, '--out', scratch, ...(h ? ['--hidden', h] : [])]);
  }
  log(`round-robin cycle ${num} — across the most recent ${tournamentRecent} checkpoints (this is what picks best.json now)`);
  writeStatus(`round robin running (started ${new Date().toISOString()})`);
  await runSoftAsync('tournament.js', ['--promote', '--recent', tournamentRecent, '--workers', poolWorkers]);
  statusState.lastGate = `cycle ${num} — round robin complete`;
  // The one moment best.json is worth a permanent blob in history: the round robin just decided
  // it. Not pushed on every self-play batch because the file is overwritten each cycle and dense
  // float JSON does not delta-compress -- see the note above pushArtifacts.
  writeStatus(`round robin complete (cycle ${num})`, ['nn/models/best.json']);
  // Checkpoint: one numbered snapshot per CYCLE now, not per self-play batch -- a batch no longer
  // produces a new trained model on its own, so there is nothing new to checkpoint until a round
  // robin actually runs. tournament.js's --recent window reads these exactly as before.
  if (fs.existsSync(best)) {
    const ckpt = path.join(dir, 'models', `ckpt-${String(num).padStart(3, '0')}.json`);
    atomicCopy(best, ckpt);
    log(`round-robin cycle ${num} — checkpoint saved: ${path.basename(ckpt)}`);
    statusState.lastCheckpoint = `${path.basename(ckpt)} at ${new Date().toISOString()}`;
  }
}

async function runBenchCycle() {
  const win = readWindows();
  const spans = {};
  for (const d of benchDepths) {
    const bottom = Math.max(1, Math.min(win[d], LADDER_N - benchLevels + 1));
    spans[d] = [bottom, Math.min(bottom + benchLevels - 1, LADDER_N)];
  }
  const spanNote = benchDepths.map(d => `D${d}:L${spans[d][0]}-L${spans[d][1]}`).join(' ');
  log(`ladder sweep, per-depth windows ${spanNote} x ${benchCellGames} games`);
  writeStatus(`ladder sweep running (${spanNote}, started ${new Date().toISOString()})`);
  // The sweep's games are real games with real outcomes, so they are worth keeping rather than
  // being reduced to a win-loss tally and thrown away -- they cost the same CPU either way, and
  // arena.js writes selfplay.js's exact row schema. They land in whichever batch file self-play is
  // CURRENTLY writing, the same file everything downstream already globs and pushes.
  //
  // The sweep plays the newest CHECKPOINT, not best.json, and that is a deliberate change: its
  // win/loss now also feeds the Elo pool (see the inbox write below), and a result is only worth
  // rating if it is attributable to fixed weights. best.json is rewritten by the resume-train clock
  // and by promotion, so "best@D2" as a rated identity is a moving target -- the exact bug
  // elorank's .elo-snapshot exists to prevent. A numbered checkpoint is frozen and is ALREADY a
  // rated player in the pool, so these games sharpen an existing rating instead of inventing a
  // fuzzy one. Cost: the frontier now tracks the last checkpoint rather than the live net, at most
  // one pool cycle behind -- and those in-between resume-train edits are ungated increments the
  // pool re-judges anyway.
  const sweepNet = (() => {
    try {
      const ck = fs.readdirSync(path.join(dir, 'models'))
        .filter(f => /^ckpt-\d+\.json$/.test(f)).sort();
      if (ck.length) return { path: path.join(dir, 'models', ck[ck.length - 1]),
                              id: path.basename(ck[ck.length - 1], '.json') };
    } catch (e) {}
    return { path: best, id: null };     // no checkpoint yet: play best.json, contribute no rating
  })();
  if (!sweepNet.id) log('ladder sweep: no checkpoint yet, sweeping best.json and not feeding Elo');
  // Append-only, one line per cell, drained by elorank on its next run. NOT a direct write to
  // elo-results.json: bench and pool cycles run concurrently now, and two read-modify-write writers
  // on that file would silently lose one side's results.
  const eloInbox = path.join(dir, 'elo-inbox.jsonl');
  const cell = async (lvl, d) => {
    const s = arenaScore(await runCapturedSoftAsync('arena.js',
      ['--a', 'nn:0:' + sweepNet.path, '--b', 'L' + lvl, '--games', benchCellGames, '--depth', String(d),
       '--idA', `${sweepNet.id || 'best'}@D${d}`, '--idB', 'L' + lvl,
       '--saveData', selfplayOut || path.join(dir, 'data', 'bench-fallback.jsonl')]));
    if (s && sweepNet.id) {
      try {
        fs.appendFileSync(eloInbox, JSON.stringify({
          a: `${sweepNet.id}@D${d}`, b: `L${lvl}`, w: s.w, l: s.l, d: 0,
          src: 'ladder-sweep', at: new Date().toISOString(),
        }) + '\n');
      } catch (e) {}
    }
    return s;
  };
  // Cells are the moving window UNION a fixed anchor set, deduped so nothing is played twice.
  // The window is what advances the frontier; the anchors are what make results comparable.
  // Why anchors matter more now: these games feed the Elo pool, and the ladder is NOT evenly spaced
  // for a net -- the last fit flagged six rungs rating below a lower rung. If each sweep rates a
  // model against whichever rungs its window happened to sit on, every model is anchored to a
  // different slice of an uneven yardstick and cross-model comparison inherits that unevenness.
  // Playing the SAME rungs every time makes the unevenness common-mode: it still distorts the
  // absolute numbers, but it distorts every model identically, so comparisons between them survive.
  // The dice are rolled once, not once per model.
  const anchorSet = benchAnchors.filter(l => l >= 1 && l <= LADDER_N);
  const grid = {};
  for (const d of benchDepths) {
    const lvls = new Set(anchorSet);
    for (let lvl = spans[d][0]; lvl <= spans[d][1]; lvl++) lvls.add(lvl);
    for (const lvl of [...lvls].sort((a, b) => a - b)) grid[lvl + ':' + d] = await cell(lvl, d);
  }
  const table = benchDepths.map(d => {
    const cells = [];
    for (let lvl = spans[d][0]; lvl <= spans[d][1]; lvl++) {
      const s = grid[lvl + ':' + d];
      cells.push(`L${lvl} ${s ? s.w + '-' + s.l : '-'}`.padStart(10));
    }
    const top = grid[LADDER_N + ':' + d];
    if (top) cells.push(`  | L${LADDER_N} ${top.w}-${top.l}`);
    return `    D${d}` + cells.join('');
  });
  log(`ladder sweep (net's win-loss per cell):\n` + table.join('\n'));
  // Regression spot-check: the sweep above only ever looks at the CURRENT window, so once a rung
  // retires nothing ever re-examines it. Cheaply re-test the most recently retired rungs per depth
  // (spotCheckGames, far fewer than benchCellGames -- a check, not a placement).
  const spotCheckRecent = Math.max(0, +arg('spotCheckRecent', 3));
  const spotCheckGames = arg('spotCheckGames', '2');
  if (spotCheckRecent > 0) {
    const regressed = readRegressed();
    const notes = [];
    for (const d of benchDepths) {
      const from = Math.max(1, win[d] - spotCheckRecent);
      for (let lvl = from; lvl < win[d]; lvl++) {
        const s = arenaScore(await runCapturedSoftAsync('arena.js',
          ['--a', 'nn:0:' + best, '--b', 'L' + lvl, '--games', spotCheckGames, '--depth', String(d)]));
        const ok = s && s.w > 0 && s.l === 0;
        const was = (regressed[d] || []).includes(lvl);
        if (!ok && !was) {
          regressed[d] = [...(regressed[d] || []), lvl];
          notes.push(`D${d} L${lvl} regressed (${s ? s.w + '-' + s.l : 'n/a'})`);
        } else if (ok && was) {
          regressed[d] = regressed[d].filter(x => x !== lvl);
          notes.push(`D${d} L${lvl} recovered`);
        }
      }
    }
    if (notes.length) {
      log(`regression spot-check: ` + notes.join(', '));
      writeRegressed(regressed);
    }
  }
  // Retire a rung for THIS DEPTH only. Demanding 100% on two adjacent rungs is what makes a
  // 3-game cell safe: two clean sweeps is ~1.6% by luck for an even matchup.
  const swept = (l, d) => { const s = grid[l + ':' + d]; return s && s.w > 0 && s.l === 0; };
  for (const d of benchDepths) {
    const [bottom, top] = spans[d];
    if (bottom + 1 <= top && swept(bottom, d) && swept(bottom + 1, d) &&
        bottom < LADDER_N - benchLevels + 1) {
      win[d] = bottom + 1;
      log(`depth ${d}: L${bottom} retired (${d}-ply swept L${bottom} and L${bottom + 1}); ` +
          `its window moves up to L${bottom + 1}-L${Math.min(bottom + benchLevels, LADDER_N)}`);
    }
  }
  writeWindows(win);
  const frontier = benchDepths.map(d => `${d}ply:L${win[d]}`).join(' ');
  const regressedNow = readRegressed();
  const regressedNote = benchDepths
    .map(d => (regressedNow[d] || []).length ? `D${d}:L${regressedNow[d].join(',L')}` : null)
    .filter(Boolean).join(' ');
  log(`frontier ${frontier}` + (regressedNote ? ` | regressed ${regressedNote}` : ''));
  statusState.lastBenchmark = `frontier ${frontier}` +
    (regressedNote ? ` | regressed ${regressedNote}` : '') + ` — ` +
    table.map(r => r.trim().replace(/\s+/g, ' ')).join(' | ');
}

// Rewind endings and ask how strong an escape needs to be (retromine.js), with the pool as the
// strength axis. Needs ratings to exist; quietly waits until they do.
async function runRetroCycle() {
  if (!fs.existsSync(poolSummary)) { log('retro cycle skipped — no rating pool yet'); return; }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  // Each miner picks its seed positions at random from the same corpus, so N of them explore N
  // independent lines with no coordination -- separate output files, no shared state at all.
  const outs = Array.from({ length: retroWorkers }, (_, i) =>
    path.join(dir, 'data', `retro-${stamp}` + (retroWorkers > 1 ? `-${i + 1}` : '') + '.jsonl'));
  log(`retro cycle — ${retroWorkers > 1 ? `${retroWorkers} miners x ` : ''}${retroSeeds} seed ` +
      `games mined backward from their endings`);
  writeStatus(`retrograde mining (started ${new Date().toISOString()})`);
  await Promise.all(outs.map(o => runSoftAsync('retromine.js',
    ['--summary', poolSummary, '--seeds', String(retroSeeds),
     '--maxReplaysPerSeed', '40', '--out', o])));
  const made = outs.filter(o => fs.existsSync(o)).map(o => path.relative(repoRoot, o).replace(/\\/g, '/'));
  const rows = made.reduce((n, f) => {
    try { return n + fs.readFileSync(path.join(repoRoot, f), 'utf8').split('\n').filter(Boolean).length; }
    catch (e) { return n; }
  }, 0);
  log(`retro cycle complete — ${rows} row(s) across ${made.length} file(s)`);
  writeStatus(`retro cycle complete (${rows} rows)`, made.length ? made : undefined);
}

// Cycles are started and NOT waited for, so the loop keeps ticking -- checking the other clocks,
// pulling worker games, pushing status -- while a long one runs. Two guard rails on that:
//   * one in-flight run per key. A pool cycle that overruns its own interval must not have a
//     second one started on top of it.
//   * train/pool/round-robin share ONE key because all three rewrite best.json. Two of those at
//     once is a lost promotion, not just wasted CPU. Retro and bench only READ best.json (and
//     atomicCopy renames into place, so a reader sees the old file or the new one, never a torn
//     one), which is why they get their own keys and genuinely run in parallel with everything.
// Git stays synchronous on purpose: execFileSync can't interleave on a single-threaded event
// loop, so two cycles can never land half-built commits on top of each other.
const busyCycles = new Set();
function fire(key, name, fn) {
  if (busyCycles.has(key)) return false;
  busyCycles.add(key);
  fn().catch(e => log(`WARNING: ${name} cycle failed (${(e && e.message) || e}) — continuing`))
      .finally(() => busyCycles.delete(key));
  return true;   // started; the caller advances its clock only when this is true
}

// --- the scheduler: wakes up on a short clock, does nothing most ticks -------------------------
async function schedulerLoop() {
  for (;;) {
    await sleep(checkEveryMin*60000);
    const now = Date.now();
    // Pull first, every tick, before anything reads nn/data or decides what to train on -- see
    // pullWorkers's own header for why this can no longer be left to a lucky push collision.
    pullWorkers();
    // Push whatever the CURRENTLY-GROWING batch file has on it so far. Batches now take hours, not
    // minutes, to complete -- without this, git only ever sees a finished batch, which would mean
    // going many hours between updates instead of every checkEveryMin, exactly the opposite of
    // what incremental writes in selfplay.js were for.
    if (selfplayOut && fs.existsSync(selfplayOut))
      writeStatus(`self-play batch ${statusState.batch} running (started ` +
        `${new Date(selfplayStartedAt).toISOString()})`,
        [path.relative(repoRoot, selfplayOut).replace(/\\/g, '/'),
         // worker machines read this for their opponent mix -- cheap to ride along every push
         ...(fs.existsSync(path.join(dir, 'zpd-pool.json')) ? ['nn/zpd-pool.json'] : [])]);
    // The three best.json-writing cycles contend for one lock, so the MOST OVERDUE one goes first
    // rather than whichever happens to be listed first. With a fixed order a short-interval cycle
    // can take the lock on every single tick and the others never run at all -- which is the exact
    // shape of the bug this whole change exists to fix, and not worth reintroducing one lock down.
    // A cycle that doesn't get the lock leaves its clock untouched, so it stays overdue, grows more
    // overdue, and wins the next tick: waiting is bounded, never indefinite.
    const overdueBy = (last, every) => every > 0 ? now - last - every*60000 : -Infinity;
    const contenders = [
      ['resume-train', overdueBy(lastTrainAt, trainEveryMin), runTrainCycle, () => { lastTrainAt = now; }],
      ['pool', overdueBy(lastPoolAt, poolEveryMin), runPoolCycle, () => { lastPoolAt = now; }],
      // The round robin is kept as an occasional full recalibration, not the routine gate. Placement
      // is cheap and incremental; this re-derives everything from scratch and would catch a pool
      // that had drifted for some reason the ladder anchors did not prevent.
      ['round robin', poolEveryMin === 0 ? overdueBy(lastTournamentAt, tournamentEveryMin) : -Infinity,
       runTournamentCycle, () => { lastTournamentAt = now; }],
    ].filter(c => c[1] >= 0).sort((a, b) => b[1] - a[1]);
    if (contenders.length && fire('model', contenders[0][0], contenders[0][2])) contenders[0][3]();
    // Retro and bench take no lock against the above: they only read best.json, so they run
    // genuinely in parallel with training and placement, which is the whole point.
    if (retroEveryMin > 0 && now - lastRetroAt >= retroEveryMin*60000 &&
        fire('retro', 'retro', runRetroCycle)) lastRetroAt = now;
    if (now - lastBenchAt >= benchEveryMin*60000 &&
        fire('bench', 'ladder sweep', runBenchCycle)) lastBenchAt = now;
    writeStatus(`self-play batch ${statusState.batch} running, next check in ${checkEveryMin} min`);
  }
}

if (poolOnce) {
  log('--poolOnce: running a single rating-pool placement cycle, then exiting');
  runPoolCycle().then(() => log('--poolOnce: done'),
                      e => { log(`--poolOnce failed: ${(e && e.message) || e}`); process.exitCode = 1; });
} else {
  startSelfplayBatch();
  schedulerLoop().catch(e => { log(`FATAL: scheduler stopped (${(e && e.message) || e})`); process.exitCode = 1; });
}
