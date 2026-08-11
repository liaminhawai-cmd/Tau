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
// Four is both the default and the floor. A replacement is prepared while its victim remains active,
// then swapped atomically after verification, so even a killed training process never drops below it.
const dualPopulationCap = Math.max(4, +arg('dualPopulationCap', 4));
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
const KOMI_LOSS = 0.3;
const KOMI_W = 0.5 + KOMI_LOSS/2;
const arenaScore = out => {
  const m = [...out.matchAll(/:\s*(\d+)-(\d+)(?:-\d+)?\s+\(/g)];
  if (!m.length) return null;
  const k = [...out.matchAll(/\(komi (\d+)-(\d+)/g)];
  const kA = k.length ? +k[k.length - 1][1] : 0, kB = k.length ? +k[k.length - 1][2] : 0;
  return { w: +m[m.length - 1][1] + KOMI_W*kA + (1 - KOMI_W)*kB,
           l: +m[m.length - 1][2] + KOMI_W*kB + (1 - KOMI_W)*kA };
};

const hiddenOf = p => {
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(j.sizes) && j.sizes.length > 2) return j.sizes.slice(1, -1).join(',');
  } catch (e) {}
  return null;
};
const hiddenOfBest = () => hiddenOf(best);
let LADDER_N = 11;
try { LADDER_N = require('./engine.js').createEngine().AI_LADDER.length; } catch (e) {}

const windowFile = path.join(dir, 'models', '.ladder-window');
const readWindows = () => {
  const flat = () => { const o = {}; for (const d of benchDepths) o[d] = 1; return o; };
  try {
    const raw = fs.readFileSync(windowFile, 'utf8').trim();
    const n = +raw;
    if (Number.isFinite(n) && n >= 1) { const o = {}; for (const d of benchDepths) o[d] = n; return o; }
    const j = JSON.parse(raw), o = {};
    for (const d of benchDepths) o[d] = (Number.isFinite(+j[d]) && +j[d] >= 1) ? +j[d] : 1;
    return o;
  } catch (e) {}
  return flat();
};
const writeWindows = w => { try { fs.writeFileSync(windowFile, JSON.stringify(w) + '\n'); } catch (e) {} };
const regressedFile = path.join(dir, 'models', '.ladder-regressed');
const readRegressed = () => {
  try { return JSON.parse(fs.readFileSync(regressedFile, 'utf8')); } catch (e) { return {}; }
};
const writeRegressed = r => { try { fs.writeFileSync(regressedFile, JSON.stringify(r) + '\n'); } catch (e) {} };
const scoresFile = path.join(dir, 'models', '.ladder-scores');
const readScores = () => {
  try { return JSON.parse(fs.readFileSync(scoresFile, 'utf8')); } catch (e) { return {}; }
};
const writeScores = s => { try { fs.writeFileSync(scoresFile, JSON.stringify(s) + '\n'); } catch (e) {} };
function lossScale(scores, d, l, floor) {
  const rec = scores && scores[d] && scores[d][l];
  if (!rec) return 1;
  const n = (rec.w || 0) + (rec.l || 0);
  if (n <= 0) return 1;
  return floor + (1 - floor)*((rec.l || 0)/n);
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
  for (let have = pool.filter(l => l === LADDER_N).length; have < topFloor; have++) pool.push(LADDER_N);
  return pool.length ? skewToBand(pool) : null;
}
function skewToBand(pool) {
  const hi = Math.min(LADDER_N, ladderBandHiArg > 0 ? ladderBandHiArg : LADDER_N);
  const lo = Math.min(ladderBandLo, hi);
  if (!ladderBandShare || !pool.length) return pool;
  const inBand = pool.filter(l => l >= lo && l <= hi);
  const outBand = pool.filter(l => l < lo || l > hi);
  if (!inBand.length) return pool;
  const total = pool.length;
  const wantBand = Math.round(total*ladderBandShare);
  const wantOut = Math.max(0, total - wantBand);
  const spread = (arr, want) => Array.from({ length: want },
    (_, i) => arr[Math.min(arr.length - 1, Math.floor(i*arr.length/Math.max(1, want)))]);
  const out = spread(inBand, wantBand);
  if (outBand.length) out.push(...spread(outBand, wantOut));
  return out.length ? out : pool;
}

const shapeFile = path.join(dir, 'models', '.scratch-shape');
const shapeHistFile = path.join(dir, 'models', '.shape-history');
const championShape = () => {
  try { return JSON.parse(fs.readFileSync(shapeFile, 'utf8')).shape || null; } catch (e) { return null; }
};
const mutantPopFile = path.join(dir, 'models', '.mutant-pop.json');
const mutantHistFile = path.join(dir, 'models', '.mutant-history.jsonl');
function loadMutantPop() {
  let pop;
  try { pop = JSON.parse(fs.readFileSync(mutantPopFile, 'utf8')); } catch (e) { pop = null; }
  if (!pop || !Array.isArray(pop.active)) pop = { next: 1, active: [] };
  pop.active = pop.active.filter(m => m && m.file && fs.existsSync(path.join(dir, 'models', m.file)));
  return pop;
}
const saveMutantPop = pop => atomicWrite(mutantPopFile, JSON.stringify(pop, null, 1));
function pickParent(actives, ratingOf) {
  if (!actives.length) return null;
  const score = m => { const r = ratingOf(m); return r && r.rankLo != null ? r.rankLo : -Infinity; };
  const scores = actives.map(score);
  const finite = scores.filter(Number.isFinite);
  if (!finite.length) return actives[Math.floor(Math.random()*actives.length)];
  const maxScore = Math.max(...finite);
  const FLOOR = 0.08;
  const weights = scores.map(s => (Number.isFinite(s) ? Math.exp((s - maxScore)/parentPickTemp) : 0) + FLOOR);
  let r = Math.random()*weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < actives.length; i++) { r -= weights[i]; if (r <= 0) return actives[i]; }
  return actives[actives.length - 1];
}
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
function loadDualPop() {
  let pop = null, migrated = false;
  try { pop = JSON.parse(fs.readFileSync(dualPopFile, 'utf8')); } catch (e) {}
  if (!pop || !Array.isArray(pop.active)) {
    pop = { version: 1, next: 1, active: [], pending: null };
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
    for (const file of legacy.slice(0, dualPopulationCap)) {
      const shape = hiddenOf(path.join(dir, 'models', file));
      if (shape) pop.active.push({ file, shape, op: 'legacy-import', parent: null, root: file, born: 0, epochs: null });
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
  try {
    for (const f of fs.readdirSync(path.join(dir, 'models'))) {
      const m = f.match(/^dual-pop-(\d+)-e\d+\.json$/);
      if (m) pop.next = Math.max(pop.next, +m[1] + 1);
    }
  } catch (e) {}
  if (pop.pending && pop.pending.victim && !pop.active.some(m => m.file === pop.pending.victim)) pop.pending = null;
  pop._migrated = migrated;
  return pop;
}
function saveDualPop(pop) {
  const clean = { version: 1, next: pop.next, active: pop.active, pending: pop.pending || null };
  atomicWrite(dualPopFile, JSON.stringify(clean, null, 1));
  pop._migrated = false;
}
const dualStatus = pop => !pop ? 'disabled' :
  `${pop.active.length}/${dualPopulationCap} active` +
  (pop.active.length ? ` (${pop.active.map(m => path.basename(m.file, '.json')).join(', ')})` : '') +
  (pop.pending ? `; pending ${pop.pending.victim ? `${pop.pending.victim} -> ` : ''}${pop.pending.file}` : '');
const meanFinite = values => {
  const a = values.filter(Number.isFinite);
  return a.length ? a.reduce((s, n) => s + n, 0)/a.length : null;
};
function dualAggregates(rows, pop) {
  const groups = {};
  for (const r of rows || []) if (r && r.brain === 'dual' && r.model) {
    const file = path.basename(r.model);
    (groups[file] || (groups[file] = [])).push(r);
  }
  const out = {};
  for (const m of (pop && pop.active) || []) {
    const all = groups[m.file] || [];
    const ranked = all.filter(r => Number.isFinite(r.rank) && Number.isFinite(r.rankLo) && Number.isFinite(r.rankHi));
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
function completeDualBirth(pop, plan, num) {
  const member = { file: plan.file, shape: plan.shape, op: plan.op, parent: plan.parent,
                   root: plan.root || plan.file, born: num, epochs: plan.epochs };
  let next = pop.active.slice();
  if (plan.victim) {
    if (!next.some(m => m.file === plan.victim)) return null;
    next = next.filter(m => m.file !== plan.victim);
  } else if (next.length >= dualPopulationCap) return null;
  if (!next.some(m => m.file === member.file)) next.push(member);
  if (plan.victim && next.length !== pop.active.length) return null;
  if (next.length > dualPopulationCap) return null;
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
  if (!pop.pending && pop.active.length < dualPopulationCap) {
    const ratings = readPreviousDualRatings(pop);
    const rated = pop.active.filter(m => ratings[m.file] && Number.isFinite(ratings[m.file].rankLo));
    const parent = pop.active.length
      ? (rated.length ? pickParent(pop.active, m => ratings[m.file]) : pop.active[Math.floor(Math.random()*pop.active.length)]) : null;
    const plan = planDualBirth(pop, num, null, parent, null, 'bootstrap', null);
    if (plan) { plan.root = plan.file; pop.pending = plan; saveDualPop(pop); }
  }
  let trained = null;
  const plan = pop.pending;
  if (plan) {
    const out = path.join(dir, 'models', plan.file);
    log(`pool cycle ${num} — GPU dual ${plan.reason}: ${plan.baseShape} -> ${plan.shape} (${plan.op}), ${plan.epochs} epochs, one replacement only; active ${pop.active.length}/${dualPopulationCap}`);
    let ok = fs.existsSync(out);
    if (!ok) {
      await runAsync('policy-targets.js', []);
      ok = await trainDualOne(out, plan.shape, plan.epochs, plan.seed, `dual population ${plan.file} ${plan.shape} e${plan.epochs}`);
    }
    if (ok) {
      const member = completeDualBirth(pop, plan, num);
      if (member) {
        saveDualPop(pop);
        trained = member.file;
        try { fs.appendFileSync(dualPopHistory, JSON.stringify({ at: new Date().toISOString(), cycle: num,
          event: plan.victim ? 'replace' : 'bootstrap', added: member, retired: plan.victim,
          reason: plan.reason, stats: plan.stats }) + '\n'); } catch (e) {}
        log(`pool cycle ${num} — dual population: ${plan.victim ? `replaced ${plan.victim} with` : 'added'} ${member.file}; active ${pop.active.length}/${dualPopulationCap}`);
      }
    } else log(`pool cycle ${num} — dual replacement did not finish; old population remains intact and the plan is checkpointed`);
  } else log(`pool cycle ${num} — dual population full (${pop.active.length}/${dualPopulationCap}); training none, rating the standing entrants`);
  const focus = pop.active.map(m => path.join(dir, 'models', m.file)).filter(p => fs.existsSync(p));
  statusState.dual = dualStatus(pop);
  return { focus, pop, trained };
}
async function runDualStartupProbe(pop, num) {
  const ratings = readPreviousDualRatings(pop);
  const rated = pop.active.filter(m => ratings[m.file] && Number.isFinite(ratings[m.file].rankLo));
  const parent = pop.active.length ? (rated.length ? pickParent(pop.active, m => ratings[m.file]) : pop.active[Math.floor(Math.random()*pop.active.length)]) : null;
  const baseShape = parent ? parent.shape : currentDualShape();
  const mutation = parent ? (mutateHidden(baseShape) || { shape: baseShape, op: 'same-shape' }) : { shape: baseShape, op: 'seed' };
  const epochs = dualEpochChoices[0];
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const out = path.join(dir, 'models', `dual-startup-probe-${stamp}-e${epochs}.json`);
  log(`startup — GPU dual probe: ${baseShape} -> ${mutation.shape} (${mutation.op}), ${epochs} epochs; verified export only, not an Elo entrant`);
  await runAsync('policy-targets.js', []);
  const ok = await trainDualOne(out, mutation.shape, epochs, num*1009 + 7, `startup CUDA dual probe ${mutation.shape} e${epochs}`, 'cuda');
  if (ok) log(`startup — CUDA dual probe VERIFIED: ${path.basename(out)}`);
  return { focus: [], pop, trained: ok ? out : null };
}
async function startDualNow() {
  const pop = loadDualPop();
  if (pop._migrated) { log(`startup — dual population: imported ${pop.active.length} frozen legacy entrant(s)`); saveDualPop(pop); }
  statusState.dual = dualStatus(pop);
  if (pop.active.length < dualPopulationCap) return trainDualPopulation(0);
  return runDualStartupProbe(pop, 0);
}
function scheduleDualRetirement(pop, ratings, num) {
  if (!pop || pop.pending || pop.active.length !== dualPopulationCap) return null;
  const measured = pop.active.map(m => ({ m, r: ratings[m.file] }))
    .filter(x => x.r && Number.isFinite(x.r.rank) && Number.isFinite(x.r.rankHi) && x.r.rankedIdentities >= 2 && x.r.games >= dualRetireGames);
  if (measured.length !== pop.active.length) return null;
  const rankValues = measured.map(x => x.r.rank).sort((a, b) => a - b);
  const mid = Math.floor(rankValues.length/2);
  const median = rankValues.length % 2 ? rankValues[mid] : (rankValues[mid - 1] + rankValues[mid])/2;
  const bottomN = Math.max(1, Math.ceil(measured.length*dualBottomFrac));
  const bottomCutoff = rankValues[bottomN - 1];
  const bottom = measured.slice().sort((a, b) => a.r.rank - b.r.rank).slice(0, bottomN);
  const confident = bottom.filter(x => x.r.rankHi <= bottomCutoff);
  if (!confident.length && Math.random() >= dualRetireChance) return null;
  const choices = confident.length ? confident : bottom;
  const victimEntry = choices.slice().sort((a, b) => (b.r.ciWidth || 0) - (a.r.ciWidth || 0) || a.r.rank - b.r.rank)[0];
  const victim = victimEntry.m;
  const family = pop.active.filter(m => m.root === victim.root);
  const familyConfidentlyWeak = family.every(m => {
    const r = ratings[m.file];
    return r && r.rankedIdentities >= 2 && r.games >= dualRetireGames && Number.isFinite(r.rankHi) && r.rankHi <= bottomCutoff;
  });
  const preserveFamily = family.length === 1 && !familyConfidentlyWeak;
  const survivors = pop.active.filter(m => m.file !== victim.file);
  const strong = survivors.slice().sort((a, b) => (ratings[b.file].rankLo ?? -Infinity) - (ratings[a.file].rankLo ?? -Infinity))
    .slice(0, Math.max(1, Math.ceil(survivors.length/2)));
  const parent = preserveFamily ? victim : (pickParent(strong, m => ratings[m.file]) || victim);
  const reason = confident.length ? 'confidently-weak' : 'bottom-quartile-exploration';
  const plan = planDualBirth(pop, num, victim, parent, preserveFamily ? victim.root : parent.root, reason, {
    victim: { rank: victimEntry.r.rank, rankLo: victimEntry.r.rankLo, rankHi: victimEntry.r.rankHi,
              games: victimEntry.r.games, ciWidth: victimEntry.r.ciWidth },
    medianRank: median, bottomCutoff, preserveFamily, familyConfidentlyWeak,
  });
  if (!plan) return null;
  pop.pending = plan; saveDualPop(pop); statusState.dual = dualStatus(pop); return plan;
}

const registryFile = path.join(dir, 'models', '.lineage-registry.json');
const maxActiveLineages = Math.max(1, +arg('maxActiveLineages', 8));
const minActiveLineages = Math.max(1, Math.min(+arg('minActiveLineages', 4), maxActiveLineages));
const cullFloorPct = Math.max(0.01, Math.min(1, +arg('cullFloorPct', 0.10)));
const cullMinTurns = Math.max(1, +arg('cullMinTurns', 3));
const lineageExplore = Math.max(0.01, Math.min(0.9, +arg('lineageExplore', 0.15)));
function loadRegistry() {
  try { return JSON.parse(fs.readFileSync(registryFile, 'utf8')); } catch (e) {}
  const lineages = {};
  for (const n of ['wide', 'ultra', 'deep', 'l15_value']) {
    const p = path.join(dir, 'models', n + '.json');
    const shape = hiddenOf(p);
    if (shape) lineages[n] = { shape, parent: null, status: 'active', born: new Date().toISOString(), turns: 0 };
  }
  return { lineages };
}
function saveRegistry(reg) { fs.writeFileSync(registryFile, JSON.stringify(reg, null, 1)); }
function champOf(name) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'models', `.variant-champ-${name}.json`), 'utf8')); }
  catch (e) { return null; }
}

const repoRoot = path.join(dir, '..');
let gitCmd;
let warnedNoGit = false;
function findGit() {
  if (gitCmd !== undefined) return gitCmd;
  const q = s => '"' + String(s).replace(/"/g, '\\"') + '"';
  const works = cmd => {
    try { execFileSync(cmd === 'git' ? 'git' : q(cmd), ['--version'], { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); return true; }
    catch (e) { return false; }
  };
  const candidates = ['git'];
  try {
    const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
    const ver = f => f.slice(4).split('.').map(Number);
    const apps = fs.readdirSync(base).filter(f => /^app-/.test(f)).sort((a, b) => {
      const va = ver(a), vb = ver(b);
      for (let i = 0; i < 3; i++) if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0);
      return 0;
    });
    for (const a of apps) candidates.push(path.join(base, a, 'resources', 'app', 'git', 'cmd', 'git.exe'));
  } catch (e) {}
  candidates.push('C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe');
  gitCmd = candidates.find(works) || null;
  if (gitCmd && gitCmd !== 'git') log(`status updates: using git at ${gitCmd}`);
  return gitCmd;
}
const statusState = {};
const pushArtifacts = !process.argv.includes('--no-push-artifacts');
function writeStatus(stage, extraPaths) {
  statusState.stage = stage;
  statusState.updatedAt = new Date().toISOString();
  const md = `# Tau NN training status\n_Last updated: ${statusState.updatedAt}_\n\n` +
    `**Self-play batch:** ${statusState.batch ?? '-'}\n` + `**Stage:** ${statusState.stage}\n` + `**mix:** ${statusState.mix ?? '-'}\n\n` +
    `**Dual pool:** ${statusState.dual ?? '(not initialized yet)'}\n\n` + `**Last gate result:** ${statusState.lastGate ?? '(none yet)'}\n\n` +
    `**Last checkpoint:** ${statusState.lastCheckpoint ?? '(none yet)'}\n\n` + `**Last ladder sweep:** ${statusState.lastBenchmark ?? '(none yet)'}\n`;
  const errText = e => String((e && (e.stderr || e.stdout)) || (e && e.message) || e).trim().split('\n').slice(0, 3).join(' | ');
  try {
    fs.writeFileSync(path.join(dir, 'status.md'), md);
    const found = findGit();
    if (!found) { if (!warnedNoGit) { warnedNoGit = true; log('status.md stays local-only: no git found (PATH, GitHub Desktop bundle, Program Files all probed)'); } return; }
    const q = s => '"' + String(s).replace(/"/g, '\\"') + '"';
    const gitExe = found === 'git' ? 'git' : q(found);
    const git = args => execFileSync(gitExe, args.map(q), { cwd: repoRoot, shell: true, encoding: 'utf8' });
    git(['add', 'nn/status.md']);
    if (pushArtifacts && extraPaths) for (const p of extraPaths) try { git(['add', '-f', p]); } catch (e) { log(`could not stage ${p} (${errText(e)})`); }
    try { git(['commit', '-m', 'nn: status update']); } catch (e) {}
    try { git(['push']); } catch (e) {
      try { git(['pull', '--no-edit', '--no-rebase']); git(['push']); } catch (e2) { log(`status push skipped (${errText(e2)})`); }
    }
  } catch (e) { log(`WARNING: status write failed (${errText(e)}) — continuing`); }
}
function pullWorkers() {
  const found = findGit();
  if (!found) return;
  const q = s => '"' + String(s).replace(/"/g, '\\"') + '"';
  const errText = e => String((e && (e.stderr || e.stdout)) || (e && e.message) || e).trim().split('\n').slice(0, 3).join(' | ');
  try {
    const gitExe = found === 'git' ? 'git' : q(found);
    const before = execFileSync(gitExe, ['rev-parse', 'HEAD'].map(q), { cwd: repoRoot, shell: true, encoding: 'utf8' }).trim();
    execFileSync(gitExe, ['pull', '--no-edit', '--no-rebase'].map(q), { cwd: repoRoot, shell: true, encoding: 'utf8' });
    const after = execFileSync(gitExe, ['rev-parse', 'HEAD'].map(q), { cwd: repoRoot, shell: true, encoding: 'utf8' }).trim();
    if (before !== after) log(`pulled new commits (worker games, most likely) from origin`);
  } catch (e) { log(`WARNING: periodic pull failed (${errText(e)}) — continuing`); }
}

const tournamentDone = path.join(dir, 'models', '.tournament-done');
if (!fs.existsSync(tournamentDone)) {
  const modelsDir = path.join(dir, 'models');
  const candidates = fs.existsSync(modelsDir) ? fs.readdirSync(modelsDir).filter(f => /^(ckpt-\d+|best|value)\.json$/.test(f)) : [];
  if (candidates.length > 1) runSoft('tournament.js', ['--promote', '--recent', tournamentRecent, '--workers', workers]);
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.writeFileSync(tournamentDone, new Date().toISOString() + '\n');
}
function nextNum(pattern) {
  const modelsDir = path.join(dir, 'models');
  let max = 0;
  const scan = (d, rx) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d)) { const m = rx.exec(f); if (m) max = Math.max(max, +m[1]); } };
  if (pattern === 'batch') scan(path.join(dir, 'data'), /^batch-(\d+)\.jsonl$/);
  else if (pattern === 'resume') scan(modelsDir, /^resume-(\d+)\.json$/);
  else scan(modelsDir, /^ckpt-(\d+)\.json$/);
  return max + 1;
}
let batchNum = nextNum('batch');
let cycleNum = nextNum('cycle');
let resumeNum = nextNum('resume');
let pendingResumeCandidates = [];
if (batchNum > 1) log(`resuming self-play at batch ${batchNum} (found data up to batch-${String(batchNum - 1).padStart(3, '0')}.jsonl)`);
if (cycleNum > 1) log(`resuming ${poolEveryMin > 0 ? 'pool' : 'round-robin'} cycles at ${cycleNum} (found checkpoints up to ckpt-${String(cycleNum - 1).padStart(3, '0')}.json)`);

let selfplayChild = null, selfplayOut = null, selfplayStartedAt = null;
function currentModelPool() {
  const candidates = [];
  try {
    for (const f of fs.readdirSync(path.join(dir, 'models'))) {
      if (/^pool-slot-\d+\.json$/.test(f) || ['wide.json', 'ultra.json', 'deep.json', 'l15_value.json'].includes(f)) candidates.push(path.join(dir, 'models', f));
    }
  } catch (e) {}
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
    const widths = rows.map(r => Number.isFinite(r.rankLo) && Number.isFinite(r.rankHi) ? r.rankHi - r.rankLo : null).filter(Number.isFinite);
    return [name, { rows, elo, ci: mean(widths), games: rows.reduce((s, r) => s + (+r.games || 0), 0) }];
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
  const dataPool = fs.existsSync(best) ? zpdLevels(readWindows(), readRegressed(), readScores()) : null;
  const poolNote = dataPool
    ? ', pool ' + [...new Set(dataPool)].sort((a, b) => a - b).map(l => `L${l}x${dataPool.filter(x => x === l).length}`).join(' ')
    : '';
  if (dataPool) {
    try { atomicWrite(path.join(dir, 'zpd-pool.json'), JSON.stringify({ updated: new Date().toISOString(), levels: dataPool })); } catch (e) {}
  }
  const modelPool = currentModelPool();
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
  const args = ['--games', String(gamesPerBatch), '--out', out, '--model', best, '--mix', mix,
    '--workers', workers, '--randomStartFrac', String(randomStartFrac), '--modelVarietyFrac', String(modelVarietyFrac),
    '--eloInbox', path.join(dir, 'elo-inbox.jsonl'),
    ...(modelPool.length ? ['--modelPool', modelPool.join(',')] : []),
    '--modelPoolWeights', JSON.stringify(modelWeights), '--coverageQueue', JSON.stringify(profile.coverage),
    ...(dataPool ? ['--levels', dataPool.join(',')] : [])];
  const ch = spawn('node', [path.join(dir, 'selfplay.js'), ...args], { stdio: 'inherit' });
  selfplayChild = ch;
  ch.on('exit', code => { log(`self-play batch ${num} ended (exit ${code}) — starting the next one`); startSelfplayBatch(); });
  ch.on('error', e => {
    log(`WARNING: self-play batch ${num} failed to start (${e.message}) — retrying in ${checkEveryMin} min`);
    selfplayChild = null;
    setTimeout(startSelfplayBatch, checkEveryMin*60000);
  });
}

let lastTournamentAt = Date.now(), lastBenchAt = Date.now(), lastTrainAt = Date.now(), lastPoolAt = Date.now();
async function runTrainCycle() {
  if (!fs.existsSync(best)) return;
  const num = resumeNum++;
  const out = path.join(dir, 'models', `resume-${String(num).padStart(3, '0')}.json`);
  log(`resume-train ${epochs} epochs from best.json -> resume-${String(num).padStart(3, '0')} (queued for the next pool cycle's rank-CI check, not promoted automatically)`);
  writeStatus(`resume-train (${epochs} epochs, started ${new Date().toISOString()})`);
  try {
    await runAsync('train.js', ['--epochs', epochs, '--out', out, '--resume', best]);
    if (fs.existsSync(out)) { atomicCopy(out, fresh); pendingResumeCandidates.push(out); }
  } catch (e) { log(`WARNING: resume-train failed (${e.message}) — continuing`); }
}
function refreshModelSlots(ranked) {
  if (poolSlots <= 0 || ranked.length < 2) return [];
  const byElo = ranked.slice().sort((a, b) => a.elo - b.elo);
  const picks = [], seen = new Set();
  for (let i = 0; i < poolSlots; i++) {
    const idx = byElo.length === 1 ? 0 : Math.round(i*(byElo.length - 1)/(poolSlots - 1));
    const cand = byElo[idx];
    if (seen.has(cand.model)) continue;
    seen.add(cand.model); picks.push(cand);
  }
  const pushed = [];
  picks.forEach((cand, i) => {
    let mp = cand.model;
    if (!mp || !fs.existsSync(mp)) mp = path.join(dir, 'models', path.basename(cand.model || ''));
    if (!fs.existsSync(mp)) return;
    const slotPath = path.join(dir, 'models', `pool-slot-${String(i + 1).padStart(2, '0')}.json`);
    atomicCopy(mp, slotPath);
    pushed.push(path.relative(repoRoot, slotPath).replace(/\\/g, '/'));
  });
  for (const name of ['wide', 'ultra', 'deep', 'l15_value']) {
    const p2 = path.join(dir, 'models', name + '.json');
    if (fs.existsSync(p2)) pushed.push(path.relative(repoRoot, p2).replace(/\\/g, '/'));
  }
  return pushed;
}

async function runPoolCycle() {
  const num = cycleNum++;
  const ckpt = path.join(dir, 'models', `ckpt-${String(num).padStart(3, '0')}.json`);
  if (!fs.existsSync(best)) { log(`pool cycle ${num} — no best.json yet, skipping`); return; }
  atomicCopy(best, ckpt);
  log(`pool cycle ${num} — checkpoint saved: ${path.basename(ckpt)}`);
  statusState.lastCheckpoint = `${path.basename(ckpt)} at ${new Date().toISOString()}`;
  const dualPromise = (startupDualPromise || Promise.resolve()).then(() => trainDualPopulation(num)).catch(e => {
    log(`WARNING: dual branch failed (${e.message}) — placing CPU candidates only`); return { focus: [], pop: null, trained: null };
  });
  const focus = [ckpt];
  for (const p of pendingResumeCandidates) if (fs.existsSync(p) && !focus.includes(p)) focus.push(p);
  pendingResumeCandidates = [];
  let mutantPop = null, slotPaths = [];
  if (+scratchEpochs > 0) {
    const h = championShape() || scratchHidden || hiddenOfBest();
    if (mutateShape && h && mutantCap > 0) {
      mutantPop = loadMutantPop();
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
      for (let s = 0; s < spawn; s++) {
        const haveScratch = mutantPop.active.some(m => m.kind === 'scratch' && m.shape === h);
        const kind = haveScratch ? 'mutant' : 'scratch';
        const parent = kind === 'mutant' ? pickParent(mutantPop.active, ratingOf) : null;
        const baseShape = parent ? parent.shape : h;
        const mut = kind === 'scratch' ? { shape: h, op: 'scratch' } : mutateHidden(baseShape);
        if (!mut) continue;
        const serial = String(mutantPop.next++).padStart(3, '0');
        const file = `${kind}-${serial}.json`;
        const outPath = path.join(dir, 'models', file);
        await runSoftAsync('train.js', ['--epochs', scratchEpochs, '--out', outPath, '--hidden', mut.shape]);
        if (fs.existsSync(outPath)) mutantPop.active.push({ file, kind, shape: mut.shape, op: mut.op,
          parent: parent ? parent.file : null, born: num });
      }
      saveMutantPop(mutantPop);
      for (const m of mutantPop.active) {
        const p = path.join(dir, 'models', m.file);
        if (fs.existsSync(p) && !focus.includes(p)) focus.push(p);
      }
    }
  }
  const registry = loadRegistry();
  const activeNames = Object.entries(registry.lineages).filter(([, v]) => v.status === 'active').map(([n]) => n).sort();
  let variantOutV = null, variantName = null;
  if (variantEpochs > 0 && activeNames.length) {
    const name = activeNames[num % activeNames.length];
    variantName = name;
    const info = registry.lineages[name];
    const lineage = fs.readdirSync(path.join(dir, 'models')).filter(f => f.startsWith(name + '-') && /-\d+\.json$/.test(f)).sort();
    const canResume = lineage.length > 0;
    const freshLineage = !canResume || (variantFreshEvery > 0 && info.turns > 0 && info.turns % variantFreshEvery === 0);
    let from = canResume ? path.join(dir, 'models', lineage[lineage.length - 1]) : null;
    const champ = champOf(name);
    if (champ && champ.model && fs.existsSync(champ.model)) from = champ.model;
    const outV = path.join(dir, 'models', `${name}-${String(num).padStart(3, '0')}.json`);
    variantOutV = outV;
    if (freshLineage) await runSoftAsync('train.js', ['--epochs', scratchEpochs, '--hidden', info.shape, '--out', outV]);
    else await runSoftAsync('train.js', ['--epochs', String(variantEpochs), '--resume', from, '--out', outV]);
    if (fs.existsSync(outV)) focus.push(outV);
    info.turns++;
    saveRegistry(registry);
  }
  const dualRun = await dualPromise;
  for (const p of dualRun.focus) if (!focus.includes(p)) focus.push(p);
  const wide = poolWideEvery > 0 && num % poolWideEvery === 0;
  log(`pool cycle ${num} — placing ${focus.map(f => path.basename(f)).join(', ')} in the rating pool` + (wide ? ' (wide pass: budget goes wherever the pool is least certain)' : ''));
  writeStatus(`rating pool placement (started ${new Date().toISOString()})`);
  await runSoftAsync('elorank.js', ['--focus', focus.join(','), ...(wide ? ['--focusPairs', '0'] : []),
    '--out', poolFile, '--summary', poolSummary, '--budgetHours', String(poolBudgetHours), '--workers', poolWorkers,
    '--depths', poolDepths, '--games', poolGames, ...(poolLevels ? ['--levels', poolLevels] : []), '--saveData',
    path.join(dir, 'data', `pool-${String(num).padStart(3, '0')}.jsonl`)]);
  try {
    const sum = JSON.parse(fs.readFileSync(poolSummary, 'utf8'));
    const allRated = Object.entries(sum.players || {}).filter(([, v]) => v.kind === 'nn' && v.model && v.games >= 6).map(([id, v]) => ({ id, ...v }));
    const rated = allRated.filter(r => r.brain !== 'dual');
    if (!rated.length) return;
    const byModel = {};
    for (const r of rated) {
      const k = path.basename(r.model, '.json');
      if (!byModel[k] || r.elo > byModel[k].elo) byModel[k] = r;
    }
    if (variantOutV && byModel[path.basename(variantOutV, '.json')]) {
      const cand = byModel[path.basename(variantOutV, '.json')];
      const livePath = path.join(dir, 'models', path.basename(cand.model));
      const champFile = path.join(dir, 'models', `.variant-champ-${variantName}.json`);
      let prev = null;
      try { prev = JSON.parse(fs.readFileSync(champFile, 'utf8')); } catch (e) {}
      if (!prev || !prev.model || !fs.existsSync(prev.model) || cand.elo - prev.elo >= 30)
        fs.writeFileSync(champFile, JSON.stringify({ model: fs.existsSync(livePath) ? livePath : cand.model,
          elo: cand.elo, games: cand.games, rank: cand.rank, rankLo: cand.rankLo, rankHi: cand.rankHi,
          at: new Date().toISOString() }, null, 1));
    }
    const ranked = Object.values(byModel).sort((a, b) => b.elo - a.elo);
    const top = ranked[0];
    const incumbentName = path.basename(ckpt, '.json');
    const incumbent = byModel[incumbentName];
    const topName = path.basename(top.model, '.json');
    const line = ranked.slice(0, 5).map(r => `${path.basename(r.model, '.json')} ${Math.round(r.elo)}`).join(', ');
    const hasCI = r => r && Number.isFinite(r.rankLo) && Number.isFinite(r.rankHi);
    if (topName !== incumbentName && hasCI(incumbent)) {
      const challengers = Object.values(byModel)
        .filter(r => path.basename(r.model, '.json') !== incumbentName && hasCI(r) && r.rankLo > incumbent.rankHi)
        .sort((a, b) => b.rankLo - a.rankLo);
      const winner = challengers[0];
      if (winner && fs.existsSync(winner.model)) {
        atomicCopy(best, path.join(dir, 'models', `best.pre-pool-${Date.now()}.json`));
        atomicCopy(winner.model, best);
      }
    }
    statusState.lastGate = `pool cycle ${num} — ${line}`;
    slotPaths = refreshModelSlots(ranked);
    if (mutantPop && mutantPop.active.length) {
      const popRated = mutantPop.active.map(m => ({ m, r: byModel[path.basename(m.file, '.json')] })).filter(x => x.r);
      const champShapeNow = championShape() || scratchHidden || hiddenOfBest();
      const atChamp = popRated.filter(x => x.m.shape === champShapeNow);
      const challengers = popRated.filter(x => x.m.shape !== champShapeNow);
      const ctlEntry = atChamp.slice().sort((a, b) => b.r.elo - a.r.elo)[0];
      if (ctlEntry && challengers.length) {
        const bestMut = challengers.slice().sort((a, b) => b.r.elo - a.r.elo)[0];
        const lead = bestMut.r.elo - ctlEntry.r.elo;
        const verdict = lead >= 25 ? 'adopted' : lead <= -25 ? 'rejected' : 'inconclusive';
        if (verdict === 'adopted') atomicWrite(shapeFile, JSON.stringify({ shape: bestMut.m.shape, cycle: num, adoptedAt: new Date().toISOString() }));
        try { fs.appendFileSync(shapeHistFile, JSON.stringify({ cycle: num, control: champShapeNow,
          mutant: bestMut.m.shape, op: bestMut.m.op, ctlElo: +ctlEntry.r.elo.toFixed(1), mutElo: +bestMut.r.elo.toFixed(1), verdict }) + '\n'); } catch (e) {}
      }
      const rankeds = popRated.filter(x => x.r.rankHi != null && x.r.rank != null);
      if (rankeds.length >= 2) {
        const ranks = rankeds.map(x => x.r.rank).sort((a, b) => a - b);
        const median = ranks[Math.floor(ranks.length/2)];
        const survivors = [], retired = [];
        for (const { m, r } of rankeds) {
          if ((r.games || 0) >= mutantRetireGames && r.rankHi < median) retired.push({ m, r });
          else survivors.push(m);
        }
        const ratedFiles = new Set(rankeds.map(x => x.m.file));
        for (const m of mutantPop.active) if (!ratedFiles.has(m.file)) survivors.push(m);
        if (retired.length) { mutantPop.active = survivors; saveMutantPop(mutantPop); }
      }
    }
    if (dualRun.pop && dualRun.pop.active.length) {
      const dualRatings = dualAggregates(allRated, dualRun.pop);
      scheduleDualRetirement(dualRun.pop, dualRatings, num);
    }
    if (variantEpochs > 0) {
      const reg = loadRegistry();
      const champs = Object.entries(reg.lineages).filter(([, v]) => v.status === 'active')
        .map(([n, v]) => ({ name: n, info: v, champ: champOf(n) }))
        .filter(e => e.champ && e.champ.model && fs.existsSync(e.champ.model)).sort((a, b) => b.champ.elo - a.champ.elo);
      if (champs.length >= 2) {
        const countActive = () => Object.values(reg.lineages).filter(v => v.status === 'active').length;
        let changed = false;
        if (countActive() >= maxActiveLineages) {
          const toCull = Math.max(1, Math.round(champs.length*cullFloorPct));
          const rankedMids = champs.map(c => c.champ.rank).filter(Number.isFinite).sort((a,b)=>a-b);
          const medianRank = rankedMids.length ? rankedMids[Math.floor(rankedMids.length/2)] : NaN;
          const confidentWeak = champs.slice().reverse().filter(c => Number.isFinite(medianRank) && Number.isFinite(c.champ.rankHi) && c.champ.rankHi < medianRank);
          for (let n = 0; n < Math.min(toCull, confidentWeak.length); n++) {
            const victim = confidentWeak[n];
            if (!victim || victim.info.status !== 'active' || victim.info.turns < cullMinTurns || countActive() <= minActiveLineages) continue;
            victim.info.status = 'retired'; victim.info.retiredAt = new Date().toISOString(); victim.info.retiredElo = victim.champ.elo; changed = true;
          }
        }
        if (countActive() < maxActiveLineages) {
          const breeders = champs.filter(c => c.info.status === 'active' && Object.values(reg.lineages).filter(v => v.parent === c.name && v.status === 'active').length < 2);
          const breederWeight = (c, i) => { const x = breeders.length <= 1 ? 1 : 1 - i/(breeders.length-1); return lineageExplore + (1-lineageExplore)*x*x; };
          const totalWeight = breeders.reduce((s,c,i)=>s+breederWeight(c,i),0);
          let needle = Math.random()*totalWeight, parent = null;
          for (let i=0;i<breeders.length;i++) if ((needle-=breederWeight(breeders[i],i))<=0) { parent=breeders[i]; break; }
          if (!parent) parent=breeders[breeders.length-1];
          if (parent) {
            const mut = mutateHidden(parent.info.shape);
            if (mut) {
              const root = parent.info.root || parent.name;
              let k = 1; while (reg.lineages[`${root}-m${k}`]) k++;
              reg.lineages[`${root}-m${k}`] = { shape: mut.shape, parent: parent.name, root, status: 'active', born: new Date().toISOString(), turns: 0 };
              changed = true;
            }
          }
        }
        if (changed) saveRegistry(reg);
      }
    }
  } catch (e) { log(`WARNING: pool promotion skipped (${e.message}) — keeping best.json`); }
  writeStatus(`pool cycle ${num} complete`, ['nn/models/best.json', 'nn/elo-summary.json', ...slotPaths]);
}

async function runTournamentCycle() {
  const num = cycleNum++;
  if (+scratchEpochs > 0) {
    const scratch = path.join(dir, 'models', 'scratch.json');
    const h = scratchHidden || hiddenOfBest();
    await runSoftAsync('train.js', ['--epochs', scratchEpochs, '--out', scratch, ...(h ? ['--hidden', h] : [])]);
  }
  await runSoftAsync('tournament.js', ['--promote', '--recent', tournamentRecent, '--workers', poolWorkers]);
  statusState.lastGate = `cycle ${num} — round robin complete`;
  writeStatus(`round robin complete (cycle ${num})`, ['nn/models/best.json']);
  if (fs.existsSync(best)) {
    const ckpt = path.join(dir, 'models', `ckpt-${String(num).padStart(3, '0')}.json`);
    atomicCopy(best, ckpt);
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
  writeStatus(`ladder sweep running (${spanNote}, started ${new Date().toISOString()})`);
  const sweepNet = (() => {
    try {
      const ck = fs.readdirSync(path.join(dir, 'models')).filter(f => /^ckpt-\d+\.json$/.test(f)).sort();
      if (ck.length) return { path: path.join(dir, 'models', ck[ck.length - 1]), id: path.basename(ck[ck.length - 1], '.json') };
    } catch (e) {}
    return { path: best, id: null };
  })();
  const eloInbox = path.join(dir, 'elo-inbox.jsonl');
  const cell = async (lvl, d) => {
    const s = arenaScore(await runCapturedSoftAsync('arena.js', ['--a', 'nn:0:' + sweepNet.path, '--b', 'L' + lvl,
      '--games', benchCellGames, '--depth', String(d), '--idA', `${sweepNet.id || 'best'}@D${d}`, '--idB', 'L' + lvl,
      '--saveData', selfplayOut || path.join(dir, 'data', 'bench-fallback.jsonl')]));
    if (s && sweepNet.id) try { fs.appendFileSync(eloInbox, JSON.stringify({ a: `${sweepNet.id}@D${d}`, b: `L${lvl}`, w: s.w, l: s.l, d: 0,
      src: 'ladder-sweep', at: new Date().toISOString() }) + '\n'); } catch (e) {}
    return s;
  };
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
      const s = grid[lvl + ':' + d]; cells.push(`L${lvl} ${s ? s.w + '-' + s.l : '-'}`.padStart(10));
    }
    const top = grid[LADDER_N + ':' + d]; if (top) cells.push(`  | L${LADDER_N} ${top.w}-${top.l}`);
    return `    D${d}` + cells.join('');
  });
  if (lossWeightOn) {
    const scores = readScores();
    for (const key of Object.keys(grid)) {
      const s = grid[key]; if (!s) continue;
      const [lvl, d] = key.split(':'); scores[d] = scores[d] || {};
      const prev = scores[d][lvl] || { w: 0, l: 0 }; scores[d][lvl] = { w: prev.w + s.w, l: prev.l + s.l };
    }
    writeScores(scores);
  }
  const spotCheckRecent = Math.max(0, +arg('spotCheckRecent', 3));
  const spotCheckGames = arg('spotCheckGames', '2');
  if (spotCheckRecent > 0) {
    const regressed = readRegressed();
    for (const d of benchDepths) {
      const from = Math.max(1, win[d] - spotCheckRecent);
      for (let lvl = from; lvl < win[d]; lvl++) {
        const s = arenaScore(await runCapturedSoftAsync('arena.js', ['--a', 'nn:0:' + best, '--b', 'L' + lvl, '--games', spotCheckGames, '--depth', String(d)]));
        const ok = s && s.w > 0 && s.l === 0;
        const was = (regressed[d] || []).includes(lvl);
        if (!ok && !was) regressed[d] = [...(regressed[d] || []), lvl];
        else if (ok && was) regressed[d] = regressed[d].filter(x => x !== lvl);
      }
    }
    writeRegressed(regressed);
  }
  const swept = (l, d) => { const s = grid[l + ':' + d]; return s && s.w > 0 && s.l === 0; };
  for (const d of benchDepths) {
    const [bottom, top] = spans[d];
    if (bottom + 1 <= top && swept(bottom, d) && swept(bottom + 1, d) && bottom < LADDER_N - benchLevels + 1) win[d] = bottom + 1;
  }
  writeWindows(win);
  const frontier = benchDepths.map(d => `${d}ply:L${win[d]}`).join(' ');
  const regressedNow = readRegressed();
  const regressedNote = benchDepths.map(d => (regressedNow[d] || []).length ? `D${d}:L${regressedNow[d].join(',L')}` : null).filter(Boolean).join(' ');
  statusState.lastBenchmark = `frontier ${frontier}` + (regressedNote ? ` | regressed ${regressedNote}` : '') + ` — ` + table.map(r => r.trim().replace(/\s+/g, ' ')).join(' | ');
}
const busyCycles = new Set();
function fire(key, name, fn) {
  if (busyCycles.has(key)) return false;
  busyCycles.add(key);
  fn().catch(e => log(`WARNING: ${name} cycle failed (${(e && e.message) || e}) — continuing`)).finally(() => busyCycles.delete(key));
  return true;
}
async function schedulerLoop() {
  for (;;) {
    await sleep(checkEveryMin*60000);
    const now = Date.now();
    pullWorkers();
    if (selfplayOut && fs.existsSync(selfplayOut))
      writeStatus(`self-play batch ${statusState.batch} running (started ${new Date(selfplayStartedAt).toISOString()})`,
        [path.relative(repoRoot, selfplayOut).replace(/\\/g, '/'), ...(fs.existsSync(path.join(dir, 'zpd-pool.json')) ? ['nn/zpd-pool.json'] : [])]);
    const overdueBy = (last, every) => every > 0 ? now - last - every*60000 : -Infinity;
    const contenders = [
      ['resume-train', overdueBy(lastTrainAt, trainEveryMin), runTrainCycle, () => { lastTrainAt = now; }],
      ['pool', overdueBy(lastPoolAt, poolEveryMin), runPoolCycle, () => { lastPoolAt = now; }],
      ['round robin', poolEveryMin === 0 ? overdueBy(lastTournamentAt, tournamentEveryMin) : -Infinity, runTournamentCycle, () => { lastTournamentAt = now; }],
    ].filter(c => c[1] >= 0).sort((a, b) => b[1] - a[1]);
    if (contenders.length && fire('model', contenders[0][0], contenders[0][2])) contenders[0][3]();
    if (now - lastBenchAt >= benchEveryMin*60000 && fire('bench', 'ladder sweep', runBenchCycle)) lastBenchAt = now;
    writeStatus(`self-play batch ${statusState.batch} running, next check in ${checkEveryMin} min`);
  }
}

if (poolOnce) {
  log('--poolOnce: running a single rating-pool placement cycle, then exiting');
  runPoolCycle().then(() => log('--poolOnce: done'), e => { log(`--poolOnce failed: ${(e && e.message) || e}`); process.exitCode = 1; });
} else {
  if (dualStartNow && dualEnabled) {
    log(`startup — launching the GPU dual check now (before the first ${poolEveryMin}-minute pool clock)`);
    startupDualPromise = startDualNow().catch(e => {
      log(`WARNING: startup dual check failed (${e.message}) — the scheduled pool will retry normal dual work`);
      return { focus: [], pop: null, trained: null };
    });
  }
  startSelfplayBatch();
  schedulerLoop().catch(e => { log(`FATAL: scheduler stopped (${(e && e.message) || e})`); process.exitCode = 1; });
}
