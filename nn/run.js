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
const crypto = require('crypto');

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
// Ladder-involving games were 60% of the corpus (nnladder 0.3 + ladder 0.3), and a full THIRD had
// no net in them at all -- ladder-vs-ladder is pure imitation fuel, games the net never played, in a
// style it is being asked to predict. That caps the net near the best thing in its training mix,
// which is the opposite of the goal. Pure ladder-vs-ladder drops to a garnish (it still covers
// openings and rules corners self-play drifts away from), nn-vs-ladder is KEPT at 0.3 because
// that is where loss weighting bites -- fewer ladder games, but aimed at the rungs actually
// beating the net rather than spread across its comfort zone. --mix restores any other split.
const mix = arg('mix', 'nnnn:0.6,nnladder:0.3,ladder:0.1');
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
// Scale each rung's bell weight by how badly the net loses to it (see lossScale/zpdLevels).
// --lossWeight 0 restores pure bell weighting. lossFloor is the share of its bell weight a rung
// keeps when it is being swept CLEAN -- not zero, because those games are still real data and
// dropping them would blind the regression spot-check that catches a solid rung going bad.
const lossWeightOn = arg('lossWeight', '1') !== '0';
const lossFloor = Math.min(1, Math.max(0, +arg('lossFloor', 0.25)));
// Concentrate ladder opponents at the STRONG end. The ZPD bell centres on the current frontier, so
// while the frontier sits around L5-6 most ladder games are played against rungs the net already
// beats comfortably -- games that cost full arena time and teach very little, and (now that
// self-play feeds the rating pool) contribute rating evidence about rungs nobody is deciding
// anything on. This reshapes the finished pool so most of it lands in [lo, hi] while keeping a
// deliberate minority outside: the low rungs are not worthless, they are what keeps the ladder
// anchored end-to-end and catches a regression that only shows up against weak play. Set
// --ladderBandShare 0 to restore the pure ZPD distribution.
const ladderBandLo = Math.max(1, +arg('ladderBandLo', 7));
// 0 means "to the top of whatever ladder this build has" -- the ladder has grown before (L13 exists
// now) and a hardcoded 11 would silently stop skewing toward the hardest rungs the day it grows again.
const ladderBandHiArg = +arg('ladderBandHi', 0);
const ladderBandShare = Math.min(1, Math.max(0, +arg('ladderBandShare', 0.85)));
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
// The ladder sweep also runs one arena process alongside placement, so reserve a couple of cores
// rather than two thirds of the machine.
const poolWorkers = arg('poolWorkers', String(Math.max(2, +workers - 2)));
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
// The mutant POPULATION. The old shape fight trained one mutant against one control, read the
// verdict off a single placement, and then never rated either file again -- elorank's discoverModels
// has no pattern matching `mut-NNN.json`, so their Elo was a one-shot measurement at the 6-game
// floor that could never refine. A ~25 Elo lead decided by 6 games is noise choosing an
// architecture. Now mutants are stable rated identities that accumulate games across cycles, and
// the population is what is bounded: spawn only while under --mutantCap, at most
// --mutantsPerCycle at a time, and free a slot by retiring one that is CONFIDENTLY weak rather
// than one that is merely behind. Retirement reads the CI's upper bound, not the point estimate:
// culling on a wide interval would kill under-measured mutants for being uncertain, and since a
// culled mutant stops getting games, that mistake is self-reinforcing.
const mutantCap = Math.max(0, +arg('mutantCap', 6));
const mutantsPerCycle = Math.max(1, +arg('mutantsPerCycle', 2));
// Temperature for pickParent's softmax over rankLo (rungs). Lower = sharper: a real standout gets
// most of the draws; a near-tie stays close to flat. See pickParent's own comment for why this
// replaced a fixed positional decay.
const parentPickTemp = Math.max(0.05, +arg('parentPickTemp', 0.5));
// A mutant may not be retired before it has had a real chance to be measured, whatever its rating.
const mutantRetireGames = Math.max(6, +arg('mutantRetireGames', 15));
// The CPU side already has an open population of value-net lineages. The dual head is the GPU
// counterpart, but it is deliberately a SMALL standing population rather than a fresh two-model
// shootout every cycle. Every active file is rated twice (bare value and fused +policy) on the SAME
// Elo graph. Once the population is full, most cycles train no dual at all: rate a few games, then
// probabilistically retire at most one bottom-quartile member and train one from-scratch replacement
// on the next cycle. That interleaving spends compute narrowing the evidence instead of minting
// hundreds of disposable candidates. --noDual disables cleanly on a CPU-only box.
const dualEnabled = !process.argv.includes('--noDual');
const dualEpochChoices = String(arg('dualEpochs', '20,40,60')).split(',').map(Number).filter(n => n > 0);
const dualBatch = Math.max(64, +arg('dualBatch', 4096));
const dualInitialShape = arg('dualHidden', '128,128');
// Option 20 passes this explicitly: launch a real dual GPU probe immediately so CUDA/PyTorch is
// exercised at startup rather than hiding a missing-GPU problem behind the 45-minute pool clock.
// It is deliberately NOT the default for arbitrary run.js invocations or --poolOnce diagnostics.
const dualStartNow = process.argv.includes('--dualStartNow');
let startupDualPromise = null;
// Four is a FLOOR, not a cap. Expeditions may inject a larger field; the league measures it and
// retires at most one weak entrant per cycle until this floor is reached. At the floor, retirement
// becomes an atomic one-for-one replacement so a killed training process can never drop below it.
// Keep the old --dualPopulationCap spelling as a compatibility alias, but it now means minimum.
const dualPopulationMin = Math.max(4, +arg('dualPopulationMin', arg('dualPopulationCap', 4)));
const dualRetireChance = Math.max(0, Math.min(1, +arg('dualRetireChance', 0.60)));
const dualRetireGames = Math.max(6, +arg('dualRetireGames', 6));
const dualBottomFrac = Math.max(0.01, Math.min(0.5, +arg('dualBottomFrac', 0.25)));

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
const dualShapeFile = path.join(dir, 'models', '.dual-trainer-shape.json');
const dualPopFile = path.join(dir, 'models', '.dual-pop.json');
const dualPopHistory = path.join(dir, 'models', '.dual-pop-history.jsonl');
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
// keep noticing the benchmark's own clock has elapsed. Measured directly tonight: a pool
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
function runProcessAsync(cmd, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n$ ${cmd} ${args.join(' ')}`);
    const ch = spawn(cmd, args, { cwd: path.join(dir, '..'), stdio: 'inherit' });
    ch.on('exit', code => code === 0 ? resolve() : reject(new Error(`${label} exited ${code}`)));
    ch.on('error', reject);
  });
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
// Games the komi rule scored at the move cap ride in their own "(komi A-B, ...)" field rather than
// in the W-L triple, and are worth KOMI_LOSS of a win each -- so w and l come back FRACTIONAL. Every
// caller here compares or ratios them, which is unaffected; nothing counts them as integers.
const KOMI_LOSS = 0.3;                    // must track CFG.komiLoss in index.html
const KOMI_W = 0.5 + KOMI_LOSS/2;         // a komi win on the 0..1 scale a win rate uses
const arenaScore = out => {
  const m = [...out.matchAll(/:\s*(\d+)-(\d+)(?:-\d+)?\s+\(/g)];
  if (!m.length) return null;
  const k = [...out.matchAll(/\(komi (\d+)-(\d+)/g)];
  const kA = k.length ? +k[k.length - 1][1] : 0, kB = k.length ? +k[k.length - 1][2] : 0;
  return { w: +m[m.length - 1][1] + KOMI_W*kA + (1 - KOMI_W)*kB,
           l: +m[m.length - 1][2] + KOMI_W*kB + (1 - KOMI_W)*kA };
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

// Per-rung sweep records, {depth: {level: {w, l}}}. The sweep has always computed these -- it logs
// a win-loss per cell -- but nothing kept them anywhere zpdLevels could read, so opponent choice
// could only ever be driven by WHERE THE FRONTIER IS, never by WHICH RUNGS ARE ACTUALLY BEATING US.
// Those differ: the frontier is the highest rung swept clean, while the rungs doing the damage sit
// above it and get sampled by a decaying bell tail precisely because they are far from the peak.
// Measured on the real corpus: L11 held 4.8% of opponent slots and 1.9% of rows against L7/L8's 21%
// each, so a full night of 11 lanes barely moved the two rungs the net is actually trying to beat.
const scoresFile = path.join(dir, 'models', '.ladder-scores');
const readScores = () => {
  try { return JSON.parse(fs.readFileSync(scoresFile, 'utf8')); } catch (e) { return {}; }
};
const writeScores = s => { try { fs.writeFileSync(scoresFile, JSON.stringify(s) + '\n'); } catch (e) {} };

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
// LOSS WEIGHTING (--lossWeight, default on): once real per-rung records exist, scale each rung's
// bell weight by how badly the net is LOSING to it. The bell alone answers "what is near my
// frontier"; this answers "what is beating me", and those are not the same question -- rungs above
// the frontier are exactly the ones the bell's tail starves, which is why L11 sat at 1.9% of rows
// while the net lost to it.
//
// weight = base bell x (lossFloor + (1 - lossFloor) x lossRate), lossRate = l/(w+l) over the stored
// sweep cells for that rung at that depth. A rung swept clean keeps lossFloor of its bell weight
// rather than zero -- dropping beaten rungs entirely would erase the regression signal that catches
// a rung going bad again, and those clean games are still real training data. A rung losing outright
// keeps its full bell weight. Cells with no record are treated as unknown, not as wins, so a rung
// that has never been played is not silently starved on the strength of having no evidence.
function lossScale(scores, d, l, lossFloor) {
  const rec = scores && scores[d] && scores[d][l];
  if (!rec) return 1;                                     // no evidence: leave the bell alone
  const n = (rec.w || 0) + (rec.l || 0);
  if (n <= 0) return 1;
  return lossFloor + (1 - lossFloor)*((rec.l || 0)/n);
}
function zpdLevels(win, regressed, scores) {
  const pool = [];
  const depths = Object.keys(win).map(Number).sort((a, b) => a - b);
  depths.forEach((d, i) => {
    const repeat = Math.max(1, Math.round(9 / Math.pow(3, i)));
    const mu = Math.max(1, win[d]) + 0.5;
    for (let l = 1; l <= LADDER_N; l++) {
      const bell = repeat*Math.exp(-Math.pow(l - mu, 2)/(2*zpdSigma*zpdSigma));
      const n = Math.round(lossWeightOn ? bell*lossScale(scores, d, l, lossFloor) : bell);
      for (let r = 0; r < n; r++) pool.push(l);
    }
  });
  for (const d of Object.keys(regressed))
    for (const l of (regressed[d] || [])) for (let r = 0; r < 3; r++) pool.push(l);
  // max, not add: once the frontier climbs high enough that the bell covers the top rung on its
  // own, this must stop contributing rather than keep piling weight on the hardest opponent.
  for (let have = pool.filter(l => l === LADDER_N).length; have < topFloor; have++) pool.push(LADDER_N);
  return pool.length ? skewToBand(pool) : null;
}

// Reshape a level pool so ladderBandShare of it sits in [ladderBandLo, ladderBandHi]. Works on the
// multiset, not the order, because selfplay.js consumes this with a uniform pick() -- so the
// composition IS the probability distribution.
// Within the band the ZPD bell's own relative weighting is preserved, so this decides HOW MUCH goes
// to the strong rungs without overriding the bell's judgement about WHICH of them are most
// contested.
// If the bell puts NOTHING in the band, the skew is skipped entirely rather than seeding the band
// by hand. An empty in-band slice means the frontier is nowhere near these rungs, and forcing a net
// that loses to L4 into 85% L7+ games buys a pile of one-sided games that teach nothing -- the exact
// failure the ZPD window exists to prevent. Concentrating on the strong end is worth doing once the
// net has business there, which for any net this loop has trained for a while it does.
function skewToBand(pool) {
  const hi = Math.min(LADDER_N, ladderBandHiArg > 0 ? ladderBandHiArg : LADDER_N);
  const lo = Math.min(ladderBandLo, hi);
  if (!ladderBandShare || !pool.length) return pool;
  const inBand = pool.filter(l => l >= lo && l <= hi);
  const outBand = pool.filter(l => l < lo || l > hi);
  if (!inBand.length) return pool;
  const band = inBand;
  const total = pool.length;
  const wantBand = Math.round(total*ladderBandShare);
  const wantOut = Math.max(0, total - wantBand);
  // Resample by EVEN STRIDE across the sorted multiset, not by cycling it. Cycling takes a prefix
  // whenever the target size is not a whole multiple of the source, which silently over-weights
  // whichever rungs sort first: measured on the live pool, cycling turned L7x8/L8x9 into L7x16/L8x13
  // while leaving L9/L10 untouched, and dropped the L6 frontier peak from the minority share
  // entirely. A stride keeps each rung's share proportional, which is the whole claim this function
  // makes -- decide how much goes to the strong end, don't second-guess the bell about which rungs.
  const spread = (arr, want) => Array.from({ length: want },
    (_, i) => arr[Math.min(arr.length - 1, Math.floor(i*arr.length/Math.max(1, want)))]);
  const out = spread(band, wantBand);
  // The minority keeps the bell's own low-rung mix rather than a flat spread -- if the ZPD says a
  // regression is showing up at L4, that is exactly the low rung this share should spend on.
  if (outBand.length) out.push(...spread(outBand, wantOut));
  return out.length ? out : pool;
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

// --- the mutant population --------------------------------------------------------------------
// Registry of the mutants currently holding a slot. Deliberately small and boring: the RATINGS live
// in the pool (that is the whole point of giving mutants stable filenames), so this only has to
// remember which files are active and where each came from. A retired mutant's file is left on disk
// untouched -- retiring frees a training slot, it does not delete evidence, the same rule the
// lineage registry and the ladder rungs already follow.
const mutantPopFile = path.join(dir, 'models', '.mutant-pop.json');
const mutantHistFile = path.join(dir, 'models', '.mutant-history.jsonl');
function loadMutantPop() {
  let pop;
  try { pop = JSON.parse(fs.readFileSync(mutantPopFile, 'utf8')); } catch (e) { pop = null; }
  if (!pop || !Array.isArray(pop.active)) pop = { next: 1, active: [] };
  // A file can vanish (hand-deleted, a half-written train that never landed). An active entry
  // pointing at nothing would be focused into every placement and rated zero games forever, quietly
  // holding a slot the population can never reclaim.
  pop.active = pop.active.filter(m => m && m.file && fs.existsSync(path.join(dir, 'models', m.file)));
  return pop;
}
const saveMutantPop = pop => atomicWrite(mutantPopFile, JSON.stringify(pop, null, 1));

// Which mutant to breed from. Rank-weighted rather than proportional-to-Elo, because Elo here comes
// from small samples and one lucky 11-game outlier at +600 would otherwise dominate every draw (the
// value league produced exactly that artifact). Ranked on the CI's LOWER bound so "strong" means
// confidently strong, not merely lucky.
//
// Softmax over rankLo, not a fixed positional decay (exp(-i/2) by SORT INDEX, the earlier version
// of this function): a positional decay hands #1 the same 37%/#2 24%/... split whether the field is
// a near-tie (rankLo spread of 0.03 rungs -- a fake hierarchy the data doesn't support) or a real
// standout (spread of 3+ rungs -- where 37% badly underweights it). Softmax self-corrects: a
// near-tie stays close to flat, a genuine standout concentrates on it. Measured on both shapes
// before shipping (see the fitted-population test below).
//
// The +FLOOR term (not folded into the softmax) is what keeps a weak-looking shape explorable: an
// architecture that looks bad at 8 games is not yet known to be bad, so no combination of scores can
// drive its draw probability to exactly zero.
function pickParent(actives, ratingOf) {
  if (!actives.length) return null;
  // rankLo is the PESSIMISTIC end of elorank's bootstrap interval on the ladder-level scale, so
  // ordering by it means "confidently strong" rather than "got a lucky draw" -- which matters
  // because these ratings come from small samples and a single 11-game outlier would otherwise win
  // every draw (the value league produced exactly that: a +604 Elo artifact on 11 games).
  const score = m => { const r = ratingOf(m); return r && r.rankLo != null ? r.rankLo : -Infinity; };
  const scores = actives.map(score);
  const finite = scores.filter(Number.isFinite);
  // Nobody rated yet: every draw is equally uninformed. Softmax needs a finite max to subtract
  // (all -Infinity would divide out to NaN), so this is a real branch, not an optimisation.
  if (!finite.length) return actives[Math.floor(Math.random()*actives.length)];
  const maxScore = Math.max(...finite);
  const FLOOR = 0.08;   // never a zero-probability tail, same floor the positional version used
  const weights = scores.map(s =>
    (Number.isFinite(s) ? Math.exp((s - maxScore)/parentPickTemp) : 0) + FLOOR);
  let r = Math.random()*weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < actives.length; i++) { r -= weights[i]; if (r <= 0) return actives[i]; }
  return actives[actives.length - 1];
}
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

const currentDualShape = () => {
  try { return JSON.parse(fs.readFileSync(dualShapeFile, 'utf8')).shape || dualInitialShape; }
  catch (e) { return dualInitialShape; }
};

// --- the dual population ----------------------------------------------------------------------
// Stable identities are the important part: the Elo pool can only narrow a confidence interval if
// tomorrow's games are credited to the same frozen file as today's. Retired files are NEVER deleted;
// they simply leave `active`, so all their historical games remain in elo-results.json.
function loadDualPop() {
  let pop = null, migrated = false;
  try { pop = JSON.parse(fs.readFileSync(dualPopFile, 'utf8')); } catch (e) {}
  if (!pop || !Array.isArray(pop.active)) {
    pop = { version: 1, next: 1, active: [], pending: null };
    // Upgrade an existing run without throwing away the expensive old control/mutant games. Start
    // with the best measured legacy files (falling back to newest when they are unrated), but give
    // every imported net its own root: the migration begins diverse instead of inventing a common
    // ancestor that never really existed.
    let files = [];
    try { files = fs.readdirSync(path.join(dir, 'models')); } catch (e) {}
    const legacy = files.filter(f => /^dual-(?:control|mut)-\d+-e\d+\.json$/.test(f));
    const scores = {};
    try {
      const players = JSON.parse(fs.readFileSync(poolSummary, 'utf8')).players || {};
      for (const r of Object.values(players)) if (r.brain === 'dual' && r.model && Number.isFinite(r.elo)) {
        const f = path.basename(r.model);
        (scores[f] || (scores[f] = [])).push(r.elo);
      }
    } catch (e) {}
    const score = f => scores[f] && scores[f].length
      ? scores[f].reduce((s, n) => s + n, 0)/scores[f].length : -Infinity;
    legacy.sort((a, b) => score(b) - score(a) || b.localeCompare(a, undefined, { numeric: true }));
    for (const file of legacy.slice(0, dualPopulationMin)) {
      const shape = hiddenOf(path.join(dir, 'models', file));
      if (shape) pop.active.push({ file, shape, op: 'legacy-import', parent: null,
                                  root: file, born: 0, epochs: null });
    }
    migrated = pop.active.length > 0;
  }
  pop.version = 1;
  pop.next = Math.max(1, +pop.next || 1);
  const seen = new Set();
  pop.active = pop.active.filter(m => {
    if (!m || !m.file || seen.has(m.file) || !fs.existsSync(path.join(dir, 'models', m.file))) return false;
    seen.add(m.file);
    m.shape = m.shape || hiddenOf(path.join(dir, 'models', m.file));
    m.root = m.root || m.file;
    return !!m.shape;
  });
  // Also advance past orphaned files from a close between training and the registry swap.
  try {
    for (const f of fs.readdirSync(path.join(dir, 'models'))) {
      const m = f.match(/^dual-pop-(\d+)-e\d+\.json$/);
      if (m) pop.next = Math.max(pop.next, +m[1] + 1);
    }
  } catch (e) {}
  // A pending swap is valid only while its victim still holds a seat. Missing bootstrap parents are
  // harmless (the shape is already frozen in the plan), but a missing victim cannot be swapped.
  if (pop.pending && pop.pending.victim && !pop.active.some(m => m.file === pop.pending.victim))
    pop.pending = null;
  pop._migrated = migrated;
  return pop;
}
function saveDualPop(pop) {
  const clean = { version: 1, next: pop.next, active: pop.active, pending: pop.pending || null };
  atomicWrite(dualPopFile, JSON.stringify(clean, null, 1));
  pop._migrated = false;
}
const dualStatus = pop => !pop ? 'disabled' :
  `${pop.active.length} active (minimum ${dualPopulationMin})` +
  (pop.active.length ? ` (${pop.active.map(m => path.basename(m.file, '.json')).join(', ')})` : '') +
  (pop.pending ? `; pending ${pop.pending.victim ? `${pop.pending.victim} -> ` : ''}${pop.pending.file}` : '');

const meanFinite = values => {
  const a = values.filter(Number.isFinite);
  return a.length ? a.reduce((s, n) => s + n, 0)/a.length : null;
};
// Fold bare/+policy and all search depths into ONE architecture reading. Retirement is about the
// shared trunk, not whichever one of its six search identities got a lucky pairing. `games` is the
// minimum across usable identities: every included face has had at least that much evidence.
function dualAggregates(rows, pop) {
  const groups = {};
  for (const r of rows || []) if (r && r.brain === 'dual' && r.model) {
    const file = path.basename(r.model);
    (groups[file] || (groups[file] = [])).push(r);
  }
  const out = {};
  for (const m of (pop && pop.active) || []) {
    const all = groups[m.file] || [];
    const ranked = all.filter(r => Number.isFinite(r.rank) && Number.isFinite(r.rankLo) &&
                                   Number.isFinite(r.rankHi));
    out[m.file] = {
      rows: all, identities: all.length, rankedIdentities: ranked.length,
      elo: meanFinite(all.map(r => r.elo)), rank: meanFinite(ranked.map(r => r.rank)),
      rankLo: meanFinite(ranked.map(r => r.rankLo)), rankHi: meanFinite(ranked.map(r => r.rankHi)),
      ciWidth: meanFinite(ranked.map(r => r.rankHi - r.rankLo)),
      games: ranked.length ? Math.min(...ranked.map(r => r.games || 0)) : 0,
      totalGames: all.reduce((s, r) => s + (r.games || 0), 0),
    };
  }
  return out;
}

function readPreviousDualRatings(pop) {
  try {
    const players = JSON.parse(fs.readFileSync(poolSummary, 'utf8')).players || {};
    return dualAggregates(Object.entries(players).map(([id, r]) => ({ id, ...r })), pop);
  } catch (e) { return {}; }
}

function planDualBirth(pop, num, victim, parent, root, reason, stats) {
  const serialN = pop.next++;
  const serial = String(serialN).padStart(3, '0');
  const epochs = dualEpochChoices[(serialN - 1) % dualEpochChoices.length];
  const baseShape = parent ? parent.shape : currentDualShape();
  const mutation = parent ? mutateHidden(baseShape) : { shape: baseShape, op: 'seed' };
  if (!mutation) return null;
  return {
    file: `dual-pop-${serial}-e${epochs}.json`, victim: victim ? victim.file : null,
    parent: parent ? parent.file : null, root, baseShape, shape: mutation.shape, op: mutation.op,
    epochs, seed: num*1009 + serialN, selectedCycle: num, reason, stats: stats || null,
  };
}

// Pure state transition kept separate from the trainer process so its invariant is obvious and
// testable: a replacement removes exactly one and adds exactly one; bootstrap only fills an empty
// seat. It never mutates the registry if the saved plan no longer matches the live population.
function completeDualBirth(pop, plan, num) {
  const member = { file: plan.file, shape: plan.shape, op: plan.op, parent: plan.parent,
                   root: plan.root || plan.file, born: num, epochs: plan.epochs };
  let next = pop.active.slice();
  if (plan.victim) {
    if (!next.some(m => m.file === plan.victim)) return null;
    next = next.filter(m => m.file !== plan.victim);
  } else if (next.length >= dualPopulationMin) return null;
  if (!next.some(m => m.file === member.file)) next.push(member);
  if (plan.victim && next.length !== pop.active.length) return null;
  pop.active = next;
  pop.pending = null;
  return member;
}

async function trainDualOne(out, shape, epochs, seed, label, device = null) {
  const partial = out.replace(/\.json$/, '.partial.json');
  try {
    await runProcessAsync('python', [path.join('nn', 'torch-train-dual.py'), '--hidden', shape,
      '--epochs', String(epochs), '--batch', String(dualBatch), '--seed', String(seed), '--out', partial,
      ...(device ? ['--device', device] : [])], label);
    await runAsync('verify-dual-export.js', [partial]);
    fs.renameSync(partial, out);
    return true;
  } catch (e) {
    try { fs.unlinkSync(partial); } catch (_) {}
    log(`WARNING: ${label} failed (${e.message}) — dual entrant skipped, CPU trainer continues`);
    return false;
  }
}

async function trainDualPopulation(num) {
  if (!dualEnabled || !dualEpochChoices.length) {
    statusState.dual = 'disabled';
    return { focus: [], pop: null, trained: null };
  }
  const pop = loadDualPop();
  if (pop._migrated) {
    log(`pool cycle ${num} — dual population: imported ${pop.active.length} frozen legacy entrant(s)`);
    saveDualPop(pop);
  }

  // Bootstrap ONE seat per cycle. Existing members keep being rated while the pool fills; a new
  // bootstrap shape is a one-edit child but starts a new root family, preserving early diversity.
  if (!pop.pending && pop.active.length < dualPopulationMin) {
    const ratings = readPreviousDualRatings(pop);
    const rated = pop.active.filter(m => ratings[m.file] && Number.isFinite(ratings[m.file].rankLo));
    const parent = pop.active.length
      ? (rated.length ? pickParent(pop.active, m => ratings[m.file])
                      : pop.active[Math.floor(Math.random()*pop.active.length)]) : null;
    const plan = planDualBirth(pop, num, null, parent, null, 'bootstrap', null);
    if (plan) {
      plan.root = plan.file;
      pop.pending = plan;
      saveDualPop(pop);              // checkpoint BEFORE the expensive train
    }
  }

  let trained = null;
  const plan = pop.pending;
  if (plan) {
    const out = path.join(dir, 'models', plan.file);
    log(`pool cycle ${num} — GPU dual ${plan.reason}: ${plan.baseShape} -> ${plan.shape} (${plan.op}), ` +
        `${plan.epochs} epochs, one replacement only; active ${pop.active.length} (minimum ${dualPopulationMin})`);
    // A verified final file may already exist when the window was closed after rename but before
    // the registry swap. In that case finish the swap instead of paying for the same train twice.
    let ok = fs.existsSync(out);
    if (!ok) {
      await runAsync('policy-targets.js', []);
      ok = await trainDualOne(out, plan.shape, plan.epochs, plan.seed,
                              `dual population ${plan.file} ${plan.shape} e${plan.epochs}`);
    }
    if (ok) {
      const member = completeDualBirth(pop, plan, num);
      if (member) {
        saveDualPop(pop);            // victim leaves only in the same atomic save that adds child
        trained = member.file;
        try {
          fs.appendFileSync(dualPopHistory, JSON.stringify({ at: new Date().toISOString(), cycle: num,
            event: plan.victim ? 'replace' : 'bootstrap', added: member, retired: plan.victim,
            reason: plan.reason, stats: plan.stats }) + '\n');
        } catch (e) {}
        log(`pool cycle ${num} — dual population: ${plan.victim ? `replaced ${plan.victim} with` : 'added'} ` +
            `${member.file}; active ${pop.active.length} (minimum ${dualPopulationMin})`);
      } else {
        log(`pool cycle ${num} — dual replacement file verified, but its saved plan no longer matches ` +
            `the active registry; leaving the old population intact`);
      }
    } else {
      // Keep the victim and the pending plan. The next cycle retries the exact same birth.
      log(`pool cycle ${num} — dual replacement did not finish; old population remains intact and the plan is checkpointed`);
    }
  } else {
    log(`pool cycle ${num} — dual population standing at ${pop.active.length} ` +
        `(minimum ${dualPopulationMin}); training none, rating the entrants`);
  }

  const focus = pop.active.map(m => path.join(dir, 'models', m.file))
    .filter(p => fs.existsSync(p));
  statusState.dual = dualStatus(pop);
  return { focus, pop, trained };
}

// A full imported population normally has no reason to train before it has played new Elo games.
// Startup is the one intentional exception: make a small, verified throwaway dual export so the
// person who launched option 20 sees whether CUDA actually works NOW. It never enters the Elo
// registry, so this diagnostic cannot evict a well-measured incumbent or distort the four-model
// evolution. If the population is below four, startDualNow instead delegates to the real bootstrap.
async function runDualStartupProbe(pop, num) {
  const ratings = readPreviousDualRatings(pop);
  const rated = pop.active.filter(m => ratings[m.file] && Number.isFinite(ratings[m.file].rankLo));
  const parent = pop.active.length
    ? (rated.length ? pickParent(pop.active, m => ratings[m.file])
                    : pop.active[Math.floor(Math.random()*pop.active.length)]) : null;
  const baseShape = parent ? parent.shape : currentDualShape();
  const mutation = parent ? (mutateHidden(baseShape) || { shape: baseShape, op: 'same-shape' })
                          : { shape: baseShape, op: 'seed' };
  const epochs = dualEpochChoices[0]; // shortest selected budget: a prompt CUDA proof, not a contender
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const out = path.join(dir, 'models', `dual-startup-probe-${stamp}-e${epochs}.json`);
  log(`startup — GPU dual probe: ${baseShape} -> ${mutation.shape} (${mutation.op}), ${epochs} epochs; ` +
      `verified export only, not an Elo entrant`);
  await runAsync('policy-targets.js', []);
  const ok = await trainDualOne(out, mutation.shape, epochs, num*1009 + 7,
                                `startup CUDA dual probe ${mutation.shape} e${epochs}`, 'cuda');
  if (ok) log(`startup — CUDA dual probe VERIFIED: ${path.basename(out)}`);
  return { focus: [], pop, trained: ok ? out : null };
}

async function startDualNow() {
  const pop = loadDualPop();
  if (pop._migrated) {
    log(`startup — dual population: imported ${pop.active.length} frozen legacy entrant(s)`);
    saveDualPop(pop);
  }
  statusState.dual = dualStatus(pop);
  // No standing full field yet: the immediate GPU work is useful production work, not a probe.
  if (pop.active.length < dualPopulationMin) return trainDualPopulation(0);
  return runDualStartupProbe(pop, 0);
}

// Schedule, but do not execute, at most one replacement. The victim remains active until the next
// cycle successfully trains and verifies its child. A last surviving family is protected unless
// EVERY member of that family is confidently inside the bottom quartile; otherwise its
// replacement inherits the same root, so a wide-CI unlucky result cannot erase a whole lineage.
function scheduleDualRetirement(pop, ratings, num) {
  if (!pop || pop.pending || pop.active.length < dualPopulationMin) return null;
  const measured = pop.active.map(m => ({ m, r: ratings[m.file] }))
    .filter(x => x.r && Number.isFinite(x.r.rank) && Number.isFinite(x.r.rankHi) &&
                 x.r.rankedIdentities >= 2 && x.r.games >= dualRetireGames);
  if (measured.length !== pop.active.length) {
    log(`pool cycle ${num} — dual retirement waits: ${measured.length}/${pop.active.length} entrants ` +
        `have ${dualRetireGames}+ games on at least a bare and +policy face`);
    return null;
  }
  const rankValues = measured.map(x => x.r.rank).sort((a, b) => a - b);
  const mid = Math.floor(rankValues.length/2);
  const median = rankValues.length % 2 ? rankValues[mid] : (rankValues[mid - 1] + rankValues[mid])/2;
  const bottomN = Math.max(1, Math.ceil(measured.length*dualBottomFrac));
  const bottomCutoff = rankValues[bottomN - 1];
  const bottom = measured.slice().sort((a, b) => a.r.rank - b.r.rank).slice(0, bottomN);
  // "CI in the bottom 25%" means even the OPTIMISTIC endpoint does not clear the quartile cutoff.
  // Merely overlapping the bottom quartile would punish wide intervals for being under-measured.
  const confident = bottom.filter(x => x.r.rankHi <= bottomCutoff);
  if (!confident.length && Math.random() >= dualRetireChance) {
    log(`pool cycle ${num} — dual population: no retirement this cycle (exploration draw)`);
    return null;
  }
  // Within the bottom quartile, prefer the widest CI. This is intentionally exploratory: uncertain
  // weak-looking nets turn over fairly often, while deterministically weak nets always turn over.
  const choices = confident.length ? confident : bottom;
  const victimEntry = choices.slice().sort((a, b) =>
    (b.r.ciWidth || 0) - (a.r.ciWidth || 0) || a.r.rank - b.r.rank)[0];
  const victim = victimEntry.m;
  const family = pop.active.filter(m => m.root === victim.root);
  const familyConfidentlyWeak = family.every(m => {
    const r = ratings[m.file];
    return r && r.rankedIdentities >= 2 && r.games >= dualRetireGames &&
           Number.isFinite(r.rankHi) && r.rankHi <= bottomCutoff;
  });
  const preserveFamily = family.length === 1 && !familyConfidentlyWeak;
  const survivors = pop.active.filter(m => m.file !== victim.file);
  const reason = confident.length ? 'confidently-weak' : 'bottom-quartile-exploration';
  // Above the floor, the experiment is deliberately being whittled: retire one weak entrant and
  // do not mint a replacement. Its file and historical Elo remain untouched. Once the floor is
  // reached, the existing one-for-one replacement path below takes over.
  if (pop.active.length > dualPopulationMin) {
    pop.active = survivors;
    saveDualPop(pop);
    statusState.dual = dualStatus(pop);
    try {
      fs.appendFileSync(dualPopHistory, JSON.stringify({ at: new Date().toISOString(), cycle: num,
        event: 'retire-to-floor', retired: victim.file, reason,
        stats: { rank: victimEntry.r.rank, rankLo: victimEntry.r.rankLo,
                 rankHi: victimEntry.r.rankHi, games: victimEntry.r.games,
                 ciWidth: victimEntry.r.ciWidth, medianRank: median, bottomCutoff } }) + '\n');
    } catch (e) {}
    log(`pool cycle ${num} — dual entrant retired: ${victim.file} (rank ${victimEntry.r.rank.toFixed(2)}, ` +
        `CI ${victimEntry.r.rankLo.toFixed(2)}..${victimEntry.r.rankHi.toFixed(2)}); ` +
        `${pop.active.length} remain, protected floor ${dualPopulationMin}`);
    return { retired: victim.file, replacement: null };
  }
  // Breed from genuinely strong evidence, not just anyone who survived. rankLo is the pessimistic CI
  // endpoint; take the top half on that measure, then retain a little weighted diversity inside it.
  const strong = survivors.slice().sort((a, b) =>
    (ratings[b.file].rankLo ?? -Infinity) - (ratings[a.file].rankLo ?? -Infinity))
    .slice(0, Math.max(1, Math.ceil(survivors.length/2)));
  const parent = preserveFamily ? victim : (pickParent(strong, m => ratings[m.file]) || victim);
  const plan = planDualBirth(pop, num, victim, parent,
    preserveFamily ? victim.root : parent.root, reason, {
      victim: { rank: victimEntry.r.rank, rankLo: victimEntry.r.rankLo,
                rankHi: victimEntry.r.rankHi, games: victimEntry.r.games,
                ciWidth: victimEntry.r.ciWidth },
      medianRank: median, bottomCutoff, preserveFamily, familyConfidentlyWeak,
    });
  if (!plan) return null;
  pop.pending = plan;
  saveDualPop(pop);
  statusState.dual = dualStatus(pop);
  log(`pool cycle ${num} — dual retirement scheduled: ${victim.file} (rank ${victimEntry.r.rank.toFixed(2)}, ` +
      `CI ${victimEntry.r.rankLo.toFixed(2)}..${victimEntry.r.rankHi.toFixed(2)}, bottom-quartile ` +
      `cutoff ${bottomCutoff.toFixed(2)}, median ${median.toFixed(2)}) ` +
      `-> scratch child of ${parent.file}${preserveFamily ? `, preserving root ${victim.root}` :
        familyConfidentlyWeak && family.length === 1 ? ', family allowed to go extinct' : ''}`);
  return plan;
}

// --- variant lineage registry: an open, evolving population ------------------------------------
// Started as four fixed names (wide/ultra/deep/l15_value), each hand-pinned to an architecture.
// Now the population is open: a lineage whose champion clears the top of the pool can spawn a
// mutant child (same single-edit mutateHidden the shape-fight uses), and a lineage that falls out
// of the top can stop getting trained. Nothing on disk is ever deleted -- retiring a lineage only
// drops its rotation slot; its checkpoints stay put as a reference point, the same way a retired
// ladder rung stays in the pool as a yardstick instead of vanishing.
const registryFile = path.join(dir, 'models', '.lineage-registry.json');
const maxActiveLineages = Math.max(1, +arg('maxActiveLineages', 8));
const minActiveLineages = Math.max(1, Math.min(+arg('minActiveLineages', 4), maxActiveLineages));
const cullFloorPct = Math.max(0.01, Math.min(1, +arg('cullFloorPct', 0.10)));   // bottom slice retires
const cullMinTurns = Math.max(1, +arg('cullMinTurns', 3));                      // grace period for new mutants
const lineageExplore = Math.max(0.01, Math.min(0.9, +arg('lineageExplore', 0.15)));

function loadRegistry() {
  try { return JSON.parse(fs.readFileSync(registryFile, 'utf8')); } catch (e) { /* bootstrap below */ }
  const lineages = {};
  for (const n of ['wide', 'ultra', 'deep', 'l15_value']) {
    const p = path.join(dir, 'models', n + '.json');
    const shape = hiddenOf(p);
    if (!shape) continue;
    lineages[n] = { shape, parent: null, status: 'active', born: new Date().toISOString(), turns: 0 };
  }
  return { lineages };
}
function saveRegistry(reg) { fs.writeFileSync(registryFile, JSON.stringify(reg, null, 1)); }
function champOf(name) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'models', `.variant-champ-${name}.json`), 'utf8')); }
  catch (e) { return null; }
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
    `**Dual pool:** ${statusState.dual ?? '(not initialized yet)'}\n\n` +
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
  else if (pattern === 'resume') scan(modelsDir, /^resume-(\d+)\.json$/);
  else scan(modelsDir, /^ckpt-(\d+)\.json$/);
  return max + 1;
}
let batchNum = nextNum('batch');
let cycleNum = nextNum('cycle');
let resumeNum = nextNum('resume');
// Resume-train candidates queued since the last pool cycle rated anything -- folded into that
// cycle's --focus and cleared there. In-memory only (unlike the dual/mutant populations' pending
// state, which persists across a restart): the worst a crash costs here is one candidate's trained
// weights sitting on disk un-refocused, not a whole population's bookkeeping.
let pendingResumeCandidates = [];
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
  // The standing dual entrants play self-play too. Leaving them out made the dual population
  // depend on ONE source of games -- elorank's own placement pass, once per pool cycle behind the
  // whole CPU training queue -- so a dual net could sit at zero games for hours while thousands of
  // self-play games ran past it. They are the same kind of thing as every other pool member: a
  // frozen set of weights with a stable rating id, so they belong in the same opponent pool and on
  // the same Elo graph, and the games they play are training data like any other.
  // Read from the registry rather than by filename glob so retired files stop drawing games the
  // moment they leave `active`, exactly as they stop being rated.
  try {
    const pop = JSON.parse(fs.readFileSync(dualPopFile, 'utf8'));
    for (const m of (pop && pop.active) || []) {
      const p = m && m.file && path.join(dir, 'models', m.file);
      if (p && fs.existsSync(p)) candidates.push(p);
    }
  } catch (e) {}
  return candidates;
}

// Self-play has two jobs at once: generate useful training positions and feed the shared rating
// pool. Strong models are useful opponents, but a wide rank interval is an explicit request for
// more evidence. Uncertainty therefore gets the larger share of the draw weight; a settled narrow-CI
// model still plays if it is strong, while an under-measured model is sampled aggressively until
// its location is known. Grouping by filename folds a dual's bare/+policy faces and all depths back
// into its one shared trunk weight.
function selfplayPoolProfile(paths) {
  const entries = paths.map(p => ({ path: p, name: path.basename(p, '.json') }));
  const names = new Set(entries.map(x => x.name));
  const groups = Object.fromEntries(entries.map(x => [x.name, []]));
  const hashedRatings = {};
  const hashFile = file => {
    try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'); }
    catch (e) { return null; }
  };
  try {
    const players = JSON.parse(fs.readFileSync(poolSummary, 'utf8')).players || {};
    for (const [id, v] of Object.entries(players)) {
      const name = v && v.model ? path.basename(v.model, '.json') : null;
      if (!name || !Number.isFinite(v.elo)) continue;
      const row = { ...v, _id: id };
      if (names.has(name)) groups[name].push(row);
      // Slots deliberately have generic, rotating filenames (pool-slot-01 etc.) even though their
      // contents are exact copies of a frozen Elo snapshot.  Match the bytes as well as the name,
      // so a slot inherits its source model's rating immediately instead of falling back to a
      // uniform draw just because its convenient on-disk label changed.
      const fp = hashFile(v.model);
      if (fp) (hashedRatings[fp] || (hashedRatings[fp] = [])).push(row);
    }
  } catch (e) {}
  for (const { path: p, name } of entries) {
    const fp = hashFile(p);
    if (!fp || !hashedRatings[fp]) continue;
    const have = new Set(groups[name].map(r => r._id));
    for (const row of hashedRatings[fp]) if (!have.has(row._id)) groups[name].push(row);
  }
  const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0)/xs.length : null;
  const stats = Object.fromEntries([...names].map(name => {
    const rows = groups[name] || [];
    const elo = mean(rows.map(r => r.elo).filter(Number.isFinite));
    const widths = rows.map(r => Number.isFinite(r.rankLo) && Number.isFinite(r.rankHi)
      ? r.rankHi - r.rankLo : null).filter(Number.isFinite);
    return [name, { rows, elo, ci: mean(widths),
                    games: rows.reduce((s, r) => s + (+r.games || 0), 0) }];
  }));
  const elos = Object.values(stats).map(s => s.elo).filter(Number.isFinite);
  const cis = Object.values(stats).map(s => s.ci).filter(Number.isFinite);
  const weights = {};
  const eloLo = elos.length ? Math.min(...elos) : 0;
  const eloSpan = elos.length ? Math.max(1, Math.max(...elos) - eloLo) : 1;
  const ciLo = cis.length ? Math.min(...cis) : 0;
  const ciSpan = cis.length ? Math.max(0.01, Math.max(...cis) - ciLo) : 1;
  for (const [name, s] of Object.entries(stats)) {
    const strength = Number.isFinite(s.elo) ? (s.elo - eloLo)/eloSpan : 0.5;
    // Missing CI is maximum uncertainty, matching elorank's scheduler: no interval means we do not
    // know where this model belongs yet, not that it should receive an average amount of evidence.
    const uncertainty = Number.isFinite(s.ci) ? (s.ci - ciLo)/ciSpan : 1;
    // 0.25 floor, then twice as much budget for uncertainty as for strength. This yields the intended
    // ordering: uncertain+strong most; uncertain+weak next; settled+strong still useful; settled+weak
    // least. A model's probability automatically falls as its CI tightens.
    weights[name] = elos.length
      ? +(.25 + .25*strength + .50*Math.max(0, Math.min(1, uncertainty))).toFixed(3)
      : 1;
  }
  // Hard first coverage. A dual has two genuinely different rated uses, so both its bare value
  // head and +policy face get one clean game before ordinary weighted sampling begins. Depths are
  // deliberately not separate coverage seats: they share weights and will spread naturally.
  const coverage = [];
  for (const { path: p, name } of entries) {
    let dual = false;
    try { dual = JSON.parse(fs.readFileSync(p, 'utf8')).dual === true; } catch (e) {}
    const rows = stats[name].rows;
    if (!dual) {
      if (!rows.some(r => (+r.games || 0) > 0)) coverage.push({ name, face: 'bare' });
    } else {
      if (!rows.some(r => !r.dualPolicy && (+r.games || 0) > 0)) coverage.push({ name, face: 'bare' });
      if (!rows.some(r => !!r.dualPolicy && (+r.games || 0) > 0)) coverage.push({ name, face: 'policy' });
    }
  }
  return { weights, coverage };
}

function startSelfplayBatch() {
  const num = batchNum++;
  const out = path.join(dir, 'data', `batch-${String(num).padStart(3, '0')}.jsonl`);
  selfplayOut = out;
  selfplayStartedAt = Date.now();
  // Only bias sampling once there's a model with a real frontier to bias toward -- pre-model,
  // every game is ladder-vs-ladder anyway (see selfplay.js's own kind selection), so there is no
  // "current strength" for a ZPD band to be centred on.
  const dataPool = fs.existsSync(best) ? zpdLevels(readWindows(), readRegressed(), readScores()) : null;
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
  // `best` is a member of the same league, not a privileged 80% default.  Keep it as --model so
  // selfplay still has a primary/fallback file, but include it in the weights handed to every
  // worker.  The presence of that complete weight map tells selfplay to draw BOTH seats from the
  // whole shared population on every game.
  const sharedPool = fs.existsSync(best) ? [best, ...modelPool] : modelPool;
  const profile = selfplayPoolProfile(sharedPool);
  const modelWeights = profile.weights;
  const weightedCount = Object.values(modelWeights).filter(w => w !== 1).length;
  const sharedNote = sharedPool.length ? `, ${sharedPool.length}-model shared pool` : '';
  const weightNote = weightedCount ? `, Elo/CI-weighted ${weightedCount}/${sharedPool.length}` : '';
  const coverageNote = profile.coverage.length ? `, first-coverage ${profile.coverage.length} face(s)` : '';
  log(`self-play batch ${num} starting: ${gamesPerBatch} games (mix ${mix}, ${workers} workers${poolNote}${sharedNote}${weightNote}${coverageNote})`);
  statusState.batch = num;
  statusState.mix = fs.existsSync(best) ? mix : '(no model yet — pure ladder)';
  // Self-play games now feed the rating pool as well as the training corpus. They always knew both
  // sides' pool ids; they just had nowhere to report the outcome. Same append-only inbox the ladder
  // sweep already writes to, drained by whichever elorank run comes next -- so a batch's ~1000 real
  // games stop being rating evidence the pool separately pays arena time to re-derive. Only clean
  // standard-opening games are recorded; see selfplay.js's --eloInbox note for why seeded and
  // random-start games must not be (their outcome is largely decided by the position drawn).
  const args = ['--games', String(gamesPerBatch), '--out', out, '--model', best, '--mix', mix,
    '--workers', workers, '--randomStartFrac', String(randomStartFrac),
    '--modelVarietyFrac', String(modelVarietyFrac),
    '--eloInbox', path.join(dir, 'elo-inbox.jsonl'),
    ...(modelPool.length ? ['--modelPool', modelPool.join(',')] : []),
    '--modelPoolWeights', JSON.stringify(modelWeights),
    '--coverageQueue', JSON.stringify(profile.coverage),
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
    lastPoolAt = Date.now();

// Resume-train from best.json, but no longer promote it directly. It used to: an unconditional
// atomicCopy(fresh, best) every trainEveryMin, with nothing between one tick and the next checking
// whether that resume actually helped. The comment here used to say the round robin bounded it --
// but tournamentEveryMin's round robin only runs when poolEveryMin is 0, which it isn't by default,
// so in the normal configuration NOTHING was gating this. That is exactly the shape of the
// iteration-63/80 failure this file's own header documents (a resumed lineage losing 27% across 158
// games to a from-scratch challenger) -- just with no check at all, rather than a slow one.
// Now this trains to its OWN numbered file (never touching best.json directly) and queues it; the
// next pool cycle folds it into --focus like any other candidate, so it only becomes best.json by
// clearing the same confident rank-CI bar a scratch or mutant challenger has to clear. The frequent
// LIGHT TOUCH this clock exists for is preserved -- training still happens every trainEveryMin --
// only the "incorporate it into the main line unconditionally" step is gone.
async function runTrainCycle() {
  if (!fs.existsSync(best)) return;   // nothing to resume from yet
  const num = resumeNum++;
  const out = path.join(dir, 'models', `resume-${String(num).padStart(3, '0')}.json`);
  log(`resume-train ${epochs} epochs from best.json -> resume-${String(num).padStart(3, '0')} ` +
      `(queued for the next pool cycle's rank-CI check, not promoted automatically)`);
  writeStatus(`resume-train (${epochs} epochs, started ${new Date().toISOString()})`);
  try {
    await runAsync('train-value.js', ['--epochs', epochs, '--out', out, '--resume', best]);
    if (fs.existsSync(out)) {
      // models/value.json is a fixed name several other tools read by that path (option 24's
      // single-pass trainer, option 40's Python-vs-JS check, VALUE-SHOOTOUT) -- keep it current as
      // a courtesy copy so nothing outside this loop breaks, but it is no longer what decides
      // anything here; the numbered file is the one that gets rated.
      atomicCopy(out, fresh);
      pendingResumeCandidates.push(out);
    } else {
      log(`WARNING: resume-train produced no output file — skipping this tick`);
    }
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
    // models dir if a snapshot has been cleaned up since
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

  // Spend already-earned cull evidence BEFORE any new model training. A 30-epoch birth used to
  // stand in front of elorank for hours, so a four-thousand-game cull bank could grow while not one
  // weak model retired. This pass plays no games and trains nothing: it only applies the last
  // completed rank/CI table down toward the 50-model target. The normal placement later in this
  // cycle still ingests every newly arrived result and can cull again.
  await runSoftAsync('elorank.js', ['--cullOnly']);
  // Snapshot the challenger under a stable name first. best.json is rewritten by the resume-train
  // clock, so rating "best.json" would attribute games to a moving target -- the same bug that made
  // elorank snapshot its whole field. A numbered copy is a fixed thing that can be rated once and
  // referred to forever.
  const ckpt = path.join(dir, 'models', `ckpt-${String(num).padStart(3, '0')}.json`);
  if (!fs.existsSync(best)) { log(`pool cycle ${num} — no best.json yet, skipping`); return; }
  atomicCopy(best, ckpt);
  log(`pool cycle ${num} — checkpoint saved: ${path.basename(ckpt)}`);
  statusState.lastCheckpoint = `${path.basename(ckpt)} at ${new Date().toISOString()}`;

  // Start the GPU branch immediately. The CPU branch below (train.js control/mutant/lineage) and
  // continuous self-play run at the same time; only the final Elo placement waits for both.
  // A launch-time GPU check may still be running when the first scheduled pool cycle becomes
  // due. Serialize it with this cycle: the registry must have one writer, and a verified startup
  // entrant should be placed, not immediately replaced by a second concurrent train.
  const dualPromise = (startupDualPromise || Promise.resolve()).then(() => trainDualPopulation(num)).catch(e => {
    log(`WARNING: dual branch failed (${e.message}) — placing CPU candidates only`);
    return { focus: [], pop: null, trained: null };
  });

  // The from-scratch challenger still enters, for the reason the header records: resume-training
  // adds strength over a few iterations and degrades over dozens, and this is what catches the
  // degradation. It just gets PLACED now rather than round-robinned.
  const focus = [ckpt];
  // Whatever runTrainCycle queued since the last time this ran. Consumed here, not left to
  // accumulate: each candidate gets exactly one cycle in the spotlight, the same lifecycle a ckpt
  // snapshot already has -- after that it is just history in elo-results.json, not re-focused.
  for (const p of pendingResumeCandidates) if (fs.existsSync(p) && !focus.includes(p)) focus.push(p);
  pendingResumeCandidates = [];
  let mutantPop = null;
  let slotPaths = [];
  if (+scratchEpochs > 0) {
    // champion shape (won a fight) > pin (a pre-data guess) > incumbent's own shape
    const h = championShape() || scratchHidden || hiddenOfBest();
    // ONE population, holding both kinds. Every active member is focused every cycle whether or not
    // it was trained this cycle -- that is what turns them from one-shot measurements into
    // identities whose rating tightens over time, and it is the half the old shape fight was
    // missing. A scratch is simply a member with zero edits: the champion shape, fresh init.
    //
    // Scratch nets used to be retrained from zero EVERY cycle and, like the old mutants, rated once
    // and never rediscovered (scratch-NNN.json matches no discoverModels pattern). Same waste, same
    // fix. They keep their original job -- the header's reason for having them at all is that
    // resume-training gains for a few iterations then degrades over dozens, and a fresh net at the
    // same shape is what catches that -- but they now do it as standing members with real game
    // counts behind them rather than a 6-game sample thrown away each cycle. A degraded best.json
    // now loses to a well-measured scratch instead of to a noisy one.
    if (mutateShape && h && mutantCap > 0) {
      mutantPop = loadMutantPop();
      // Ratings from the PREVIOUS placement: this cycle's elorank has not run yet, so parent
      // selection reads the most recent thing actually measured.
      let prevRatings = {};
      try {
        const sum = JSON.parse(fs.readFileSync(poolSummary, 'utf8'));
        for (const v of Object.values(sum.players || {})) {
          if (!v.model) continue;
          const k = path.basename(v.model, '.json');
          if (!prevRatings[k] || v.elo > prevRatings[k].elo) prevRatings[k] = v;
        }
      } catch (e) {}
      const ratingOf = m => prevRatings[path.basename(m.file, '.json')] || null;

      const room = mutantCap - mutantPop.active.length;
      const spawn = Math.max(0, Math.min(mutantsPerCycle, room));
      if (!spawn) {
        log(`pool cycle ${num} — population full (${mutantPop.active.length}/${mutantCap}); ` +
            `training none, a slot opens when a member is retired as confidently weak`);
      }
      for (let s = 0; s < spawn; s++) {
        // A scratch is spawned when the population has none at the CURRENT champion shape. That is
        // the control the shape verdict measures against, so it has to exist and it has to be at the
        // shape actually being defended -- once a mutant is adopted, yesterday's scratch is a
        // control for a shape nobody is running any more. Otherwise spawn a mutant.
        const haveScratch = mutantPop.active.some(m => m.kind === 'scratch' && m.shape === h);
        const kind = haveScratch ? 'mutant' : 'scratch';
        // Breed from a rated active when there is one, else from the champion shape -- which is
        // also how the very first mutant gets created on an empty population.
        const parent = kind === 'mutant' ? pickParent(mutantPop.active, ratingOf) : null;
        const baseShape = parent ? parent.shape : h;
        const mut = kind === 'scratch' ? { shape: h, op: 'scratch' } : mutateHidden(baseShape);
        if (!mut) continue;
        const serial = String(mutantPop.next++).padStart(3, '0');
        const file = `${kind}-${serial}.json`;
        const outPath = path.join(dir, 'models', file);
        log(`pool cycle ${num} — ${kind} ${serial}: ` +
            (kind === 'scratch' ? `fresh init at the champion shape ${h}`
                                : `${baseShape} -> ${mut.shape} (${mut.op})` +
                                  (parent ? ` from ${path.basename(parent.file, '.json')}`
                                          : ` from the champion shape`)) +
            `, population ${mutantPop.active.length + 1}/${mutantCap}`);
        writeStatus(`${kind} ${serial} training (${scratchEpochs} epochs, started ${new Date().toISOString()})`);
        await runSoftAsync('train-value.js', ['--epochs', scratchEpochs, '--out', outPath, '--hidden', mut.shape]);
        // Only a member that actually trained joins the population -- a failed run must not consume
        // a slot that nothing can ever retire, since retirement needs a rating and an unrated
        // phantom would never earn one.
        if (fs.existsSync(outPath)) {
          mutantPop.active.push({ file, kind, shape: mut.shape, op: mut.op,
                                  parent: parent ? parent.file : null, born: num });
        } else {
          log(`pool cycle ${num} — ${kind} ${serial} failed to train; slot left open`);
        }
      }
      saveMutantPop(mutantPop);
      for (const m of mutantPop.active) {
        const p = path.join(dir, 'models', m.file);
        if (fs.existsSync(p) && !focus.includes(p)) focus.push(p);
      }
      if (mutantPop.active.length)
        log(`pool cycle ${num} — population (${mutantPop.active.length}/${mutantCap}): ` +
            mutantPop.active.map(m => `${path.basename(m.file, '.json')}(${m.shape})`).join(', '));
    }
  }

  // one variant lineage gets a light touch of training, rotating through the registry's OPEN
  // population -- the original four named architectures, plus whatever mutant children the
  // cull/reproduce pass at the end of this cycle has spawned from successful ones. A retired
  // lineage keeps its files but drops out of this rotation entirely.
  const registry = loadRegistry();
  const activeNames = Object.entries(registry.lineages)
    .filter(([, v]) => v.status === 'active').map(([n]) => n).sort();
  let variantOutV = null, variantName = null;
  if (variantEpochs > 0 && activeNames.length) {
    const name = activeNames[num % activeNames.length];
    variantName = name;
    const info = registry.lineages[name];
    const lineage = fs.readdirSync(path.join(dir, 'models'))
      .filter(f => f.startsWith(name + '-') && /-\d+\.json$/.test(f)).sort();
    // A lineage used to resume from its own last link FOREVER -- wide-094 from wide-092 from
    // wide-090, with no reset ever. That is exactly the unbounded resume-training this file's own
    // header documents as the iteration-63/80 failure: it adds strength over a handful of
    // iterations and degrades over dozens. best.json is protected from it (the round robin and the
    // pool re-derive it from scratch); these lineages were not.
    // So every variantFreshEvery-th turn (tracked per-lineage now, not derived from the cycle number,
    // since the population's size changes as it evolves) it is retrained FROM SCRATCH at its own
    // architecture instead of resumed -- and a brand-new mutant with no checkpoint yet always starts
    // this way, since there is nothing to resume from.
    const canResume = lineage.length > 0;
    const fresh = !canResume || (variantFreshEvery > 0 && info.turns > 0 && info.turns % variantFreshEvery === 0);
    // Resume from the lineage's recorded CHAMPION, not just whichever link finished training most
    // recently -- "most recent" and "best" were silently assumed to be the same file, so a resume
    // step that made things worse (ultra-094 below ultra-093) kept compounding the damage forward
    // forever: resuming from a degraded checkpoint doesn't recover, it just keeps building on the
    // same bad basin. elo-summary.json can't answer "who's currently best" on its own -- a numbered
    // checkpoint like ultra-093.json is only ever in ONE cycle's --focus, so by the time this lineage
    // comes up again its rating has already fallen out of every later summary. So the champion is
    // tracked separately in a small marker file, updated below once THIS cycle's own placement games
    // come back -- the exact "running maximum over rated challengers" pattern that already protects
    // best.json, applied to a lineage instead of the whole pool.
    let from = canResume ? lineage[lineage.length - 1] : null;
    if (from) from = path.join(dir, 'models', from);
    try {
      const champ = champOf(name);
      if (champ && champ.model && fs.existsSync(champ.model)) {
        if (champ.model !== from) log(`pool cycle ${num} — variant lineage: resuming from champion ` +
            `${path.basename(champ.model)} (${Math.round(champ.elo)} Elo)` +
            (from ? `, not newest ${path.basename(from)}` : ''));
        from = champ.model;
      }
    } catch (e) { /* no champion recorded yet -- keep the newest-file fallback */ }
    const outV = path.join(dir, 'models', `${name}-${String(num).padStart(3, '0')}.json`);
    variantOutV = outV;
    if (fresh) {
      log(`pool cycle ${num} — variant lineage: ${name} ${canResume ? 'RESET,' : 'new mutant,'} ` +
          `training from scratch at ${info.shape} (${scratchEpochs} epochs)` +
          (canResume ? ` instead of resuming -- ${info.turns} resumes deep` : ''));
      await runSoftAsync('train-value.js', ['--epochs', scratchEpochs, '--hidden', info.shape, '--out', outV]);
    } else {
      log(`pool cycle ${num} — variant lineage: ${path.basename(from)} + ${variantEpochs} epochs -> ${path.basename(outV)}`);
      await runSoftAsync('train-value.js', ['--epochs', String(variantEpochs), '--resume', from, '--out', outV]);
    }
    if (fs.existsSync(outV)) focus.push(outV);
    info.turns++;
    saveRegistry(registry);
  }

  const dualRun = await dualPromise;
  for (const p of dualRun.focus) if (!focus.includes(p)) focus.push(p);

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

  // Promote on a CONFIDENT separation of rank intervals, not a fixed Elo margin: the challenger's
  // pessimistic bound (rankLo) has to sit entirely above the incumbent's optimistic bound (rankHi).
  // A fixed margin (the old +30 Elo gate) treats a wide-CI lucky streak the same as a well-measured
  // real lead -- exactly the noise-ratchet the old per-iteration gate was retired for (best.json is
  // a running maximum over noisy draws, so it is upward-biased and an equal net has to beat the luck
  // as well as the strength). This is the same "confident, not merely ahead" standard already used
  // to retire a dual population member (rankHi <= bottomCutoff there), applied symmetrically here.
  try {
    const sum = JSON.parse(fs.readFileSync(poolSummary, 'utf8'));
    const allRated = Object.entries(sum.players || {})
      .filter(([, v]) => v.kind === 'nn' && v.model && v.games >= 6)
      .map(([id, v]) => ({ id, ...v }));
    // A dual JSON is not a drop-in replacement for best.json: best uses the one-output nn loader,
    // while dual has 23 outputs and its own loader. Keep both families on one Elo graph, but only
    // ordinary value nets compete for the ordinary best.json seat.
    const rated = allRated.filter(r => r.brain !== 'dual');
    if (!rated.length) { log(`pool cycle ${num} — nothing rated yet, keeping best.json`); return; }
    // one entry per MODEL (best depth), since depth is a search setting rather than a property of
    // the weights being promoted
    const byModel = {};
    for (const r of rated) {
      const k = path.basename(r.model, '.json');
      if (!byModel[k] || r.elo > byModel[k].elo) byModel[k] = r;
    }
    // The variant lineage's champion marker, updated with THIS cycle's own placement results (if a
    // lineage step ran this cycle and its checkpoint got enough games to be in byModel already).
    // Same clear-margin bar as the promotion gate just below, for the same reason: a coinflip-close
    // "improvement" would make the champion pointer random-walk on noise instead of tracking real
    // progress. First-ever reading for a lineage seeds unconditionally -- there's nothing to compare
    // against yet.
    if (variantOutV && byModel[path.basename(variantOutV, '.json')]) {
      const cand = byModel[path.basename(variantOutV, '.json')];
      const livePath = path.join(dir, 'models', path.basename(cand.model));
      const champFile = path.join(dir, 'models', `.variant-champ-${variantName}.json`);
      let prev = null;
      try { prev = JSON.parse(fs.readFileSync(champFile, 'utf8')); } catch (e) {}
      if (!prev || !prev.model || !fs.existsSync(prev.model) || cand.elo - prev.elo >= 30) {
        fs.writeFileSync(champFile, JSON.stringify({
          model: fs.existsSync(livePath) ? livePath : cand.model, elo: cand.elo, games: cand.games,
          rank: cand.rank, rankLo: cand.rankLo, rankHi: cand.rankHi,
          at: new Date().toISOString(),
        }, null, 1));
        log(`pool cycle ${num} — variant lineage: ${variantName} champion is now ` +
            `${path.basename(cand.model)} (${Math.round(cand.elo)} Elo` +
            (prev && prev.elo != null ? `, +${Math.round(cand.elo - prev.elo)} over the previous champion)` : ')'));
      }
    }

    const ranked = Object.values(byModel).sort((a, b) => b.elo - a.elo);
    const top = ranked[0];
    const incumbentName = path.basename(ckpt, '.json');
    const incumbent = byModel[incumbentName];
    const topName = path.basename(top.model, '.json');
    const line = ranked.slice(0, 5)
      .map(r => `${path.basename(r.model, '.json')} ${Math.round(r.elo)}`).join(', ');
    log(`pool cycle ${num} — ratings: ${line}`);
    const hasCI = r => r && Number.isFinite(r.rankLo) && Number.isFinite(r.rankHi);
    if (topName === incumbentName) {
      log(`pool cycle ${num} — current net is already the strongest rated; keeping best.json`);
    } else if (!hasCI(incumbent)) {
      // Unrated/edge-flagged incumbent (e.g. rated off the top of the ladder, or too few games):
      // there is no interval to clear yet, so there is nothing to be confident ABOUT. Wait rather
      // than fall back to the point estimate -- that fallback is exactly the noise-ratchet this
      // gate exists to close off.
      log(`pool cycle ${num} — ${incumbentName} has no usable rank interval yet; ` +
          `too little evidence to judge a promotion, keeping best.json`);
    } else {
      // Search every rated candidate, not just the Elo point-estimate leader: a model with a
      // slightly lower mean but a narrower, higher-floor interval can legitimately be the more
      // confident case even when it isn't "top" by raw Elo. Among everyone who clears the bar,
      // the highest rankLo is the most decisively ahead -- that ordering, not Elo, breaks the tie.
      const challengers = Object.values(byModel)
        .filter(r => path.basename(r.model, '.json') !== incumbentName && hasCI(r) &&
                     r.rankLo > incumbent.rankHi)
        .sort((a, b) => b.rankLo - a.rankLo);
      const winner = challengers[0];
      if (!winner) {
        log(`pool cycle ${num} — no candidate's rank CI clears ${incumbentName}'s ` +
            `(${incumbent.rankLo.toFixed(2)}-${incumbent.rankHi.toFixed(2)}) yet; keeping best.json`);
      } else if (fs.existsSync(winner.model)) {
        const winnerName = path.basename(winner.model, '.json');
        atomicCopy(best, path.join(dir, 'models', `best.pre-pool-${Date.now()}.json`));
        atomicCopy(winner.model, best);
        log(`pool cycle ${num} — promoted ${winnerName} (rank ${winner.rankLo.toFixed(2)}-` +
            `${winner.rankHi.toFixed(2)} clears incumbent ${incumbentName}'s ` +
            `${incumbent.rankLo.toFixed(2)}-${incumbent.rankHi.toFixed(2)})`);
      }
    }
    statusState.lastGate = `pool cycle ${num} — ${line}`;
    slotPaths = refreshModelSlots(ranked);
    if (slotPaths.length) log(`pool cycle ${num} — model-variety slots refreshed: ${slotPaths.length} files`);
    // Champion shape, decided across the whole population rather than by one pairwise fight. The
    // best mutant has to clear the standing champion shape's own control by a clear margin, same bar
    // and same reasoning as the promotion gate above -- "merely ahead" would let the shape
    // random-walk on luck. Unchanged in spirit; what changed is that the challenger is now the best
    // of several rated identities instead of the single mutant that happened to be trained today.
    if (mutantPop && mutantPop.active.length) {
      const rated = mutantPop.active
        .map(m => ({ m, r: byModel[path.basename(m.file, '.json')] }))
        .filter(x => x.r);
      // The control is the best rated SCRATCH still standing at the champion shape -- a fresh net at
      // the shape being defended. Both sides of this comparison are now standing members with games
      // accumulated over cycles, so the verdict rests on far more than the old one-cycle pair did.
      // The control is the best rated member AT the champion shape, whatever it is labelled. Every
      // member is from-scratch trained at its own shape (train.js with --hidden and no --resume), so
      // a mutant that happens to sit at the champion shape is the same object as a scratch there --
      // the kind tag only records why it was spawned. Selecting on shape rather than on the label
      // also closes a real gap: adopting a mutant makes ITS shape the champion, leaving zero
      // scratches at the new shape, and a label-based lookup then had no control and could produce
      // no verdict until a slot happened to free up (6 of 40 cycles in a lifecycle simulation).
      const champShapeNow = championShape() || scratchHidden || hiddenOfBest();
      const atChamp = rated.filter(x => x.m.shape === champShapeNow);
      // Challengers are the members at some OTHER shape -- comparing the champion shape against
      // itself would just measure init variance and could never resolve.
      const challengers = rated.filter(x => x.m.shape !== champShapeNow);
      const ctlEntry = atChamp.slice().sort((a, b) => b.r.elo - a.r.elo)[0];
      const ctl = ctlEntry ? ctlEntry.r : null;
      if (ctl && challengers.length) {
        const bestMut = challengers.slice().sort((a, b) => b.r.elo - a.r.elo)[0];
        const lead = bestMut.r.elo - ctl.elo;
        const verdict = lead >= 25 ? 'adopted' : lead <= -25 ? 'rejected' : 'inconclusive';
        if (verdict === 'adopted') {
          atomicWrite(shapeFile, JSON.stringify({ shape: bestMut.m.shape, cycle: num,
                                                  adoptedAt: new Date().toISOString() }));
          log(`pool cycle ${num} — champion shape: ${bestMut.m.shape} (${bestMut.m.op}) beat the ` +
              `${champShapeNow} control (${path.basename(ctlEntry.m.file, '.json')}, ${ctl.games} games) ` +
              `by ${Math.round(lead)} Elo — adopted`);
        } else {
          log(`pool cycle ${num} — champion shape: best mutant ${bestMut.m.shape} vs ` +
              `${champShapeNow} control: ${Math.round(lead)} Elo — ${verdict}, keeping ${champShapeNow}`);
        }
        try {
          fs.appendFileSync(shapeHistFile, JSON.stringify({ cycle: num, control: champShapeNow,
            mutant: bestMut.m.shape, op: bestMut.m.op, ctlElo: +ctl.elo.toFixed(1),
            mutElo: +bestMut.r.elo.toFixed(1), verdict }) + '\n');
        } catch (e) {}
      }

      // RETIREMENT frees the slot that lets the next mutant be born. The test is deliberately
      // asymmetric: a mutant goes only when its CI's UPPER bound sits below the population's median
      // rating -- "even read optimistically, this is not competitive" -- and only once it has had
      // mutantRetireGames to prove otherwise. Retiring on the point estimate, or on a wide interval,
      // would cull whichever mutant happened to be measured least; and because a retired mutant
      // stops being focused, it would never get the games that could have exonerated it. Nothing is
      // deleted from disk: the file stays rated in the pool as a reference point, exactly like a
      // retired ladder rung.
      // Judged on elorank's RANK scale, not Elo, because that is the only scale it publishes a
      // confidence interval on (bootstrapRanks -> rankLo/rankHi; there is no eloLo/eloHi). Rank is
      // interpolated ladder level, so higher is stronger exactly like Elo, and rankHi is the
      // optimistic end. A mutant with no rankHi at all -- unrated, or pinned off the end of the
      // ladder scale -- is never retired: no interval means no evidence, not bad evidence.
      const ranked = rated.filter(x => x.r.rankHi != null && x.r.rank != null);
      if (ranked.length >= 2) {
        const ranks = ranked.map(x => x.r.rank).sort((a, b) => a - b);
        const median = ranks[Math.floor(ranks.length/2)];
        const survivors = [], retired = [];
        for (const { m, r } of ranked) {
          if ((r.games || 0) >= mutantRetireGames && r.rankHi < median) retired.push({ m, r });
          else survivors.push(m);
        }
        // Keep every unrated active too -- absence of a rating is not evidence of weakness.
        const ratedFiles = new Set(ranked.map(x => x.m.file));
        for (const m of mutantPop.active) if (!ratedFiles.has(m.file)) survivors.push(m);
        if (retired.length) {
          mutantPop.active = survivors;
          saveMutantPop(mutantPop);
          for (const { m, r } of retired) {
            log(`pool cycle ${num} — retired ${path.basename(m.file, '.json')} (${m.shape}): ` +
                `rank ${r.rank.toFixed(1)}, best-case ${r.rankHi.toFixed(1)} still below the ` +
                `population median ${median.toFixed(1)} on ${r.games} games — slot freed`);
            try {
              fs.appendFileSync(mutantHistFile, JSON.stringify({ cycle: num, retired: m.file,
                shape: m.shape, op: m.op, parent: m.parent, born: m.born,
                elo: +r.elo.toFixed(1), rank: r.rank, rankHi: r.rankHi,
                games: r.games, medianRank: +median.toFixed(2) }) + '\n');
            } catch (e) {}
          }
        }
      }
    }

    // Dual population verdict. Each stable file contributes all of its bare/+policy depth identities
    // to one trunk reading; then at most one retirement is SCHEDULED. Training that replacement is
    // next cycle's only dual train, so the loop alternates evidence and exploration instead of doing
    // a thousand games followed by a batch of throwaway nets.
    if (dualRun.pop && dualRun.pop.active.length) {
      const dualRatings = dualAggregates(allRated, dualRun.pop);
      const standing = dualRun.pop.active.map(m => ({ m, r: dualRatings[m.file] }))
        .filter(x => x.r && Number.isFinite(x.r.rank))
        .sort((a, b) => b.r.rank - a.r.rank);
      if (standing.length) {
        log(`pool cycle ${num} — dual standings: ` + standing.map(({ m, r }) =>
          `${path.basename(m.file, '.json')} R${r.rank.toFixed(2)} ` +
          `[${r.rankLo.toFixed(2)},${r.rankHi.toFixed(2)}]`).join(', '));
      } else {
        log(`pool cycle ${num} — dual standings unresolved (active entrants still under the rating floor)`);
      }
      // The clean fusion ablation survives the population change: identical frozen weights and
      // depth, only the use of the policy head differs.
      for (const m of dualRun.pop.active) {
        const rows = (dualRatings[m.file] && dualRatings[m.file].rows) || [];
        const bare = Object.fromEntries(rows.filter(r => !r.dualPolicy).map(r => [r.depth, r]));
        const fused = Object.fromEntries(rows.filter(r => r.dualPolicy).map(r => [r.depth, r]));
        const matched = Object.keys(bare).filter(d => fused[d] && Number.isFinite(bare[d].elo) &&
                                                       Number.isFinite(fused[d].elo));
        if (matched.length) {
          const lead = matched.reduce((s, d) => s + fused[d].elo - bare[d].elo, 0)/matched.length;
          log(`pool cycle ${num} — dual fusion ${path.basename(m.file, '.json')} (${m.shape}): ` +
              `${Math.round(lead)} mean Elo (+policy minus bare, ${matched.length} matched depth(s))`);
        }
      }
      scheduleDualRetirement(dualRun.pop, dualRatings, num);
    }

    // Evolve the lineage population: cull what is losing, breed from what is winning. Nothing on
    // disk is ever deleted -- retiring only drops a lineage's training slot, and its checkpoints stay
    // as a reference point, the same way a retired ladder rung stays in the pool as a yardstick.
    //
    // Both tests are made against the OTHER LINEAGES, not against the whole rated pool, and that is
    // the load-bearing decision here. The pool is dominated by ckpt/scratch/mut, which are trained at
    // --scratchEpochs (30) on the full corpus while a lineage gets --variantEpochs (8); ranking a
    // lineage against them measures the training budget it was denied, not the architecture it is
    // there to test. Measured on the real machine: the rated pool held FOUR entries (ckpt-098 283,
    // mut-098 162, scratch-098 160, deep-098 68), so a "top 10% of the pool" test resolved to "be the
    // single best brain on the machine" -- every lineage would have been retired, and since nothing
    // could ever clear the bar, nothing would ever have bred either. All cull, no mutation, which is
    // the exact opposite of the point. Against its peers the same 10% means "bottom of the pack goes",
    // which is what it was meant to mean all along.
    //
    // The floor and the cap are what keep it a population rather than a collapse: never fewer than
    // minActiveLineages alive (a monoculture cannot explore), never more than maxActiveLineages (each
    // one costs a training slot in the rotation, so an unbounded population starves every member).
    if (variantEpochs > 0) {
      const reg = loadRegistry();
      const champs = Object.entries(reg.lineages)
        .filter(([, v]) => v.status === 'active')
        .map(([n, v]) => ({ name: n, info: v, champ: champOf(n) }))
        .filter(e => e.champ && e.champ.model && fs.existsSync(e.champ.model))
        .sort((a, b) => b.champ.elo - a.champ.elo);           // best lineage first
      if (champs.length >= 2) {
        const countActive = () => Object.values(reg.lineages).filter(v => v.status === 'active').length;
        let changed = false;

        // 1. CULL, but only once the population is actually full. A percentile alone does not work at
        // this scale in either direction -- read as "must be top 10%" nothing survives, read as
        // "bottom 10% dies" nothing is ever culled. Capacity creates the pressure, but uncertainty
        // decides whether it is safe to act: a model retires only when its 90% rank upper bound is
        // below the active median. A noisy newcomer is measured, not killed for four unlucky games.
        if (countActive() >= maxActiveLineages) {
          const toCull = Math.max(1, Math.round(champs.length*cullFloorPct));
          const rankedMids = champs.map(c=>c.champ.rank).filter(Number.isFinite).sort((a,b)=>a-b);
          const medianRank = rankedMids.length ? rankedMids[Math.floor(rankedMids.length/2)] : NaN;
          const confidentWeak = champs.slice().reverse().filter(c => Number.isFinite(medianRank) &&
            Number.isFinite(c.champ.rankHi) && c.champ.rankHi < medianRank);
          for (let n = 0; n < Math.min(toCull, confidentWeak.length); n++) {
            const victim = confidentWeak[n];
            if (!victim || victim.info.status !== 'active') continue;
            if (victim.info.turns < cullMinTurns) continue;     // still finding its feet
            if (countActive() <= minActiveLineages) break;      // never collapse to a monoculture
            victim.info.status = 'retired';
            victim.info.retiredAt = new Date().toISOString();
            victim.info.retiredElo = victim.champ.elo;
            changed = true;
            log(`pool cycle ${num} — variant lineage: ${victim.name} retired ` +
                `(${Math.round(victim.champ.elo)} Elo, last of ${champs.length} lineages) -- ` +
                `files kept as a reference point, no longer trained`);
          }
          if (!confidentWeak.length)
            log(`pool cycle ${num} — lineage roster full, but no low model has a 90% rank-CI ` +
                `entirely below the median yet; nobody retired on noise`);
        }

        // 2. BREED from the best parent that still has room. Strictly rank-1-only stalls: the leader
        // caps at 2 living children, and then nothing reproduces at all while culling continues,
        // draining the population to the floor. Walking down the ranking keeps the top of the table
        // favoured without letting the whole mechanism seize up.
        if (countActive() < maxActiveLineages) {
          const breeders = champs.filter(c => c.info.status === 'active' &&
            Object.values(reg.lineages).filter(v => v.parent === c.name && v.status === 'active').length < 2);
          // Elo-weighted dice roll: the leaders breed most often, but a 15% exploration floor lets
          // a weaker architecture occasionally branch instead of turning the population into one
          // champion's monoculture.
          const breederWeight = (c, i) => {
            const x = breeders.length <= 1 ? 1 : 1 - i/(breeders.length-1);
            return lineageExplore + (1-lineageExplore)*x*x;
          };
          const totalWeight = breeders.reduce((s,c,i)=>s+breederWeight(c,i),0);
          let needle = Math.random()*totalWeight, parent = null;
          for (let i=0;i<breeders.length;i++) if ((needle-=breederWeight(breeders[i],i))<=0) {
            parent=breeders[i]; break;
          }
          if (!parent) parent=breeders[breeders.length-1];
          if (parent) {
            const mut = mutateHidden(parent.info.shape);
            if (mut) {
              // Name off the ROOT ancestor with a flat counter, not off the immediate parent: these
              // names become filenames (<name>-<cycle>.json), and nesting them would grow without
              // bound over a multi-day run -- ultra-m1-m1-m3-m2-m1... The ancestry is not lost, it is
              // in the parent field, which is where it can be read without a filesystem limit.
              const root = parent.info.root || parent.name;
              let k = 1;
              while (reg.lineages[`${root}-m${k}`]) k++;
              const childName = `${root}-m${k}`;
              reg.lineages[childName] = { shape: mut.shape, parent: parent.name, root, status: 'active',
                                           born: new Date().toISOString(), turns: 0 };
              changed = true;
              log(`pool cycle ${num} — variant lineage: ${parent.name} ` +
                  `(${Math.round(parent.champ.elo)} Elo) spawns ${childName} at ${mut.shape} (${mut.op})`);
            }
          }
        }
        if (changed) saveRegistry(reg);
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
    await runSoftAsync('train-value.js', ['--epochs', scratchEpochs, '--out', scratch, ...(h ? ['--hidden', h] : [])]);
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
  // Persist what the sweep just measured so the NEXT batch's opponent pool can be weighted by it
  // (see lossScale). Merged, not overwritten: a sweep only covers its own window plus the anchors,
  // so a straight replace would keep forgetting every rung outside this cycle's span -- including
  // the top rungs, which is exactly the evidence loss weighting needs most.
  if (lossWeightOn) {
    const scores = readScores();
    for (const key of Object.keys(grid)) {
      const s = grid[key];
      if (!s) continue;
      const [lvl, d] = key.split(':');
      scores[d] = scores[d] || {};
      const prev = scores[d][lvl] || { w: 0, l: 0 };
      scores[d][lvl] = { w: prev.w + s.w, l: prev.l + s.l };
    }
    writeScores(scores);
  }
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

// Cycles are started and NOT waited for, so the loop keeps ticking -- checking the other clocks,
// pulling worker games, pushing status -- while a long one runs. Two guard rails on that:
//   * one in-flight run per key. A pool cycle that overruns its own interval must not have a
//     second one started on top of it.
//   * train/pool/round-robin share ONE key because all three rewrite best.json. Two of those at
//     once is a lost promotion, not just wasted CPU. Bench only READS best.json (and atomicCopy
//     renames into place, so it sees the old file or the new one, never a torn one), which is why
//     it gets its own key and genuinely runs in parallel with everything.
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
    // The benchmark only reads best.json, so it needs no lock against training/placement.
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
  if (dualStartNow && dualEnabled) {
    log(`startup — launching the GPU dual check now (before the first ${poolEveryMin}-minute pool clock)`);
    startupDualPromise = startDualNow().catch(e => {
      log(`WARNING: startup dual check failed (${e.message}) — the scheduled pool will retry normal dual work`);
      return { focus: [], pop: null, trained: null };
    });
  }
  // Apply any banked, already-confident retirements immediately on restart, before the
  // first 1000-game batch takes its roster snapshot. This is a no-game/no-training pass.
  runSoftAsync('elorank.js', ['--cullOnly']).then(() => {
    startSelfplayBatch();
    return schedulerLoop();
  }).catch(e => { log(`FATAL: scheduler stopped (${(e && e.message) || e})`); process.exitCode = 1; });
}
