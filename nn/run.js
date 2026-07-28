// The overnight loop: selfplay -> train -> arena, forever (Ctrl-C any time; every stage saves).
//   node nn/run.js [--gamesPerIter 30] [--epochs 6] [--benchEvery 10] [--benchLevels 3]
//                  [--benchCellGames 3] [--benchDepths 1,2,3] [--tournamentEvery 10]
//                  [--tournamentRecent 12] [--spotCheckRecent 3] [--spotCheckGames 2]
// Iteration 1 has no model, so selfplay is pure ladder sparring; from then on the freshest net
// plays most of its own games. Every iteration's net is promoted to models/best.json (see the note
// on the retired per-iteration gate below); a periodic round robin across the most recent
// --tournamentRecent checkpoints (capped, not every checkpoint ever saved -- see tournament.js) is
// what actually decides which one deserves to be best. Progress appends to nn/log.txt.
// The benchmark is a ladder SWEEP -- a few games in each (ladder level x search depth) cell -- so
// it reads as a placement rather than a single pass/fail. Each DEPTH keeps its own window and
// retires its own rungs, so the cells tracked form a diagonal band across the grid rather than a
// rectangle (see the windows below). --benchEvery N only runs it on every Nth iteration.
//
// The frontier the sweep finds now also feeds BACK into what selfplay.js trains on (see zpdLevels
// below): each iteration's ladder-opponent pool is biased toward each depth's current frontier --
// its zone of proximal development, the band just past what it can already beat cleanly -- instead
// of a flat default range. A rung well below the frontier is easy money with nothing left to teach;
// one well above it is close to random noise; the frontier itself is exactly where a loss is still
// informative. The sweep also spot-checks a few already-retired rungs per depth (fewer games each --
// a check, not a placement) specifically to catch the failure mode where the net gets sharper
// against one rung at the cost of one it used to have solid; a rung that regresses gets fed back
// into the training pool at extra weight until a later spot-check shows it's recovered.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const gamesPerIter = arg('gamesPerIter', '200');
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
const benchEvery = Math.max(1, +arg('benchEvery', 10));
// The benchmark is a SWEEP, not a single score. "0-12 vs L8" says "weaker than L8" and nothing
// else -- it cannot tell a net that plays like L2 from one that nearly beat L7, which is why four
// consecutive readings of 0%, 9%, 0%, 17% carried no usable signal. Playing a small number of
// games in many cells (a few ladder levels x a few search depths) reads as a PLACEMENT instead:
// each individual cell is noisy, but every depth is backed by all the levels and every level by
// all the depths, and the shape across cells (does depth 3 beat depth 2? where does the win rate
// fall off?) is legible long before any one cell is significant.
const benchLevels = Math.max(1, +arg('benchLevels', 3));      // ladder rungs per depth, per sweep
const benchCellGames = arg('benchCellGames', '3');            // games per (level, depth) cell
// Which depths to sweep. Cost grows ~3.6x PER PLY (measured: 5.6x at depth 2, 20x at depth 3), so
// this is not a free dial -- depth 4 costs ~47x a depth-1 game and depth 5 ~168x, compounded by the
// fact that the deeper rungs are themselves searching brains (L8 is a depth-3 search, ~2.5s/call).
// 1,2,3 is the affordable span; because strength moves along a diagonal (see the windows below),
// measuring the contour at cheap depths tells you where it sits at expensive ones without paying.
const benchDepths = arg('benchDepths', '1,2,3').split(',')
  .map(Number).filter(d => Number.isFinite(d) && d >= 1);
const tournamentEvery = Math.max(1, +arg('tournamentEvery', 10));
// Capped, or this grows every time it fires: ckpt-NNN.json accumulates one file per iteration
// forever, so an uncapped round robin is O(n^2) in how long the run has been going, not a fixed
// cost. --tournamentRecent keeps the field to a fixed-size sliding window (see tournament.js).
const tournamentRecent = arg('tournamentRecent', '12');
// selfplay is embarrassingly parallel — use most of the machine's cores by default (capped: the
// gain flattens and each worker holds its own engine sandbox). --workers 1 to go back to serial.
const workers = arg('workers', String(Math.max(1, Math.min(os.cpus().length - 1, 8))));
// Every round robin, ALSO train a challenger from scratch on all accumulated data and enter it in
// the field. Measured, and the reason this exists: an architecture bake-off at iteration 63 played
// best.json against four fresh 30-epoch nets trained on the same accumulated data, and best.json
// lost to every single one of them -- 9-31, 11-28, 16-24, 7-32, i.e. 27% across 158 decided games.
// It even lost 7-32 to the WORST-performing architecture in that field.
//
// The mechanism is that train.js reloads the FULL dataset every iteration and resumes from
// best.json, so by iteration 63 the incumbent had taken ~370 epochs over the same rows against a
// challenger's 30. That is not accumulated progress, it is accumulated overfitting -- and it was
// invisible on validation mse, which kept looking healthy the whole time because the 10% holdout
// is split by ROW while rows come from games (positions from one game land on both sides of the
// split, so a net that memorises its training games scores well on the val set made of those same
// games). The round robin below is the only instrument here that measures playing strength rather
// than the training objective, so the fix is to put a clean retrain in front of it and let games
// decide. If the incumbent is genuinely ahead, it stays; when it has drifted, the challenger wins
// and tournament.js --promote adopts it automatically -- no manual intervention, and no way for
// this failure to run 60 iterations unnoticed again.
//
// Cost is one train.js run every tournamentEvery iterations (~3 min against selfplay's ~7 min per
// ITERATION), so this is close to free. --scratchEpochs 0 disables it.
const scratchEpochs = arg('scratchEpochs', '30');

const dir = __dirname;
const best = path.join(dir, 'models', 'best.json');
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
// arenas are informational (the gate promotes on resumed-from-best anyway) — a benchmark crash
// must never kill an overnight training loop
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
// benchEvery cycle's worth of "still regressed" signal every time the console gets closed).
const regressedFile = path.join(dir, 'models', '.ladder-regressed');
const readRegressed = () => {
  try { return JSON.parse(fs.readFileSync(regressedFile, 'utf8')); } catch (e) { return {}; }
};
const writeRegressed = r => { try { fs.writeFileSync(regressedFile, JSON.stringify(r) + '\n'); } catch (e) {} };

// Zone-of-proximal-development sampling: instead of selfplay.js's flat default ladder-opponent pool
// (2,3,4,5,6, the same range no matter how strong the net already is), build a pool centred on each
// depth's CURRENT frontier -- win[d]..win[d]+2, the band the sweep says is still undecided for that
// depth. selfplay.js's pick() is a uniform draw over the array it's given, so weighting is just
// repetition: a level appearing 9 times is 9x as likely to be drawn as one appearing once, no change
// needed in selfplay.js itself. Depths are weighted 9:3:1 (roughly the ~3.6x-per-ply decay
// selfplay.js's own nnDepthMix already uses to match search COST, rounded to a plain 3x step) because
// that same skew is how much of selfplay's game volume actually plays at each depth -- most games are
// depth-1, so the depth-1 frontier should dominate the pool, not get diluted by deeper depths' bands
// that most games never touch anyway. Regressed levels (any depth) are folded in at a flat 3x
// weight -- deliberately not scaled by depth, since a rung the net USED to have solid is a more
// urgent gap than a fresh rung it never mastered in the first place.
function zpdLevels(win, regressed) {
  const pool = [];
  const depths = Object.keys(win).map(Number).sort((a, b) => a - b);
  depths.forEach((d, i) => {
    const repeat = Math.max(1, Math.round(9 / Math.pow(3, i)));
    const bottom = Math.max(1, win[d]);
    for (let l = bottom; l <= Math.min(bottom + 2, LADDER_N); l++)
      for (let r = 0; r < repeat; r++) pool.push(l);
  });
  for (const d of Object.keys(regressed))
    for (const l of (regressed[d] || [])) for (let r = 0; r < 3; r++) pool.push(l);
  return pool.length ? pool : null;
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
const statusState = {};
function writeStatus(stage) {
  statusState.stage = stage;
  statusState.updatedAt = new Date().toISOString();
  const md = `# Tau NN training status\n_Last updated: ${statusState.updatedAt}_\n\n` +
    `**Iteration:** ${statusState.iter ?? '-'}\n` +
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
    const git = (args) => execFileSync('git', args.map(q), { cwd: repoRoot, shell: true, encoding: 'utf8' });
    git(['add', 'nn/status.md']);
    try { git(['commit', '-m', 'nn: status update']); } catch (e) { /* nothing changed -- fine */ }
    try { git(['push']); }
    catch (e) {
      try { git(['pull', '--no-edit', '--no-rebase']); git(['push']); }
      catch (e2) { log(`status push skipped (${errText(e2)})`); }
    }
  } catch (e) { log(`WARNING: status write failed (${errText(e)}) — continuing`); }
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

// Resume from the next iteration after the highest completed checkpoint, not always 1 -- a restart
// (closing the window, a crash, a reboot) used to re-target iter001.jsonl, silently stacking a new
// run's data onto the very first one's.
// ckpt-NNN.json is only ever written as an iteration's last step, so the highest one found is the
// last iteration that actually finished end to end.
function nextIter() {
  const modelsDir = path.join(dir, 'models');
  let max = 0;
  if (fs.existsSync(modelsDir))
    for (const f of fs.readdirSync(modelsDir)) {
      const m = /^ckpt-(\d+)\.json$/.exec(f);
      if (m) max = Math.max(max, +m[1]);
    }
  return max + 1;
}
const startIter = nextIter();
if (startIter > 1) log(`resuming at iteration ${startIter} (found checkpoints up to ckpt-${String(startIter - 1).padStart(3, '0')}.json)`);

for (let iter = startIter; ; iter++) {
  // Only bias sampling once there's a model with a real frontier to bias toward -- pre-model, every
  // game is ladder-vs-ladder anyway (see selfplay.js's own kind selection), so there is no "current
  // strength" for a ZPD band to be centred on.
  const dataPool = fs.existsSync(best) ? zpdLevels(readWindows(), readRegressed()) : null;
  log(`iteration ${iter} — selfplay ${gamesPerIter} games (mix ${mix}, ${workers} workers` +
      (dataPool ? `, ZPD-biased levels pool` : '') + ')');
  statusState.iter = iter; statusState.mix = fs.existsSync(best) ? mix : '(no model yet — pure ladder)';
  writeStatus(`selfplay running (${gamesPerIter} games, started ${new Date().toISOString()})`);
  run('selfplay.js', ['--games', gamesPerIter,
    '--out', path.join(dir, 'data', `iter${String(iter).padStart(3, '0')}.jsonl`),
    '--model', best, '--mix', mix, '--workers', workers,
    ...(dataPool ? ['--levels', dataPool.join(',')] : [])]);
  log(`iteration ${iter} — train ${epochs} epochs`);
  run('train.js', ['--epochs', epochs, '--out', fresh,
    ...(fs.existsSync(best) ? ['--resume', best] : [])]);
  writeStatus(`training (${epochs} epochs)`);
  // Always promote. The per-iteration fresh-vs-best gate is gone, and this is not a regression to
  // the old fake gate -- it is deliberate, for three measured reasons:
  //   1. It could not resolve what it was asked to. 24 games at a 55% bar is cleared by two
  //      IDENTICAL nets 27% of the time; real per-iteration gains are a couple of percent. It was
  //      reading noise. (AlphaGo Zero used 400 games for the same 55% threshold; AlphaZero then
  //      dropped the gate entirely and was stronger for it.)
  //   2. Worse, it ratcheted on that noise: best.json is a running maximum over noisy draws, so it
  //      is upward-biased, and a genuinely-equal new net has to beat the luck as well as the
  //      strength. Observed pass rate was 13.5% -- BELOW the 27% two identical nets would manage.
  //   3. Because train.js resumes from best.json, a rejection threw the whole iteration's training
  //      away. Twenty-three iterations without a promotion were twenty-three independent 6-epoch
  //      attempts from the same frozen weights, not accumulated progress.
  // The safety net moves to a periodic round robin over every saved checkpoint (below), which
  // extracts far more signal per game than a 24-game A/B because every model meets every other.
  fs.copyFileSync(fresh, best);
  log(`iteration ${iter} — promoted (no per-iteration gate; round robin every ${tournamentEvery} iterations picks the real best)`);
  statusState.lastGate = `iteration ${iter} — promoted (gate retired; round robin every ${tournamentEvery})`;
  // checkpoint: every iteration's model is kept — play them, watch them, arena old vs new
  const ckpt = path.join(dir, 'models', `ckpt-${String(iter).padStart(3, '0')}.json`);
  fs.copyFileSync(best, ckpt);
  log(`iteration ${iter} — checkpoint saved: ${path.basename(ckpt)}`);
  statusState.lastCheckpoint = `${path.basename(ckpt)} at ${new Date().toISOString()}`;
  if (iter % tournamentEvery === 0) {
    // The from-scratch challenger (see --scratchEpochs above). Trained BEFORE the round robin so it
    // is in the field when the round robin runs, and deliberately without --resume: resuming is the
    // very thing being tested against. The shape is read off best.json rather than left to
    // train.js's default, so that adopting a different architecture (by copying it over best.json)
    // isn't silently undone by a challenger that reverts to 96,96 every tournament.
    if (+scratchEpochs > 0) {
      const scratch = path.join(dir, 'models', 'scratch.json');
      const h = hiddenOfBest();
      log(`iteration ${iter} — training a from-scratch challenger (${scratchEpochs} epochs` +
          (h ? `, --hidden ${h}` : '') + `) to enter in the round robin`);
      writeStatus(`from-scratch challenger training (${scratchEpochs} epochs, started ${new Date().toISOString()})`);
      runSoft('train.js', ['--epochs', scratchEpochs, '--out', scratch, ...(h ? ['--hidden', h] : [])]);
    }
    log(`iteration ${iter} — round robin across the most recent ${tournamentRecent} checkpoints (this is what picks best.json now)`);
    writeStatus(`round robin running (started ${new Date().toISOString()})`);
    runSoft('tournament.js', ['--promote', '--recent', tournamentRecent, '--workers', workers]);
  }
  if (iter % benchEvery === 0) {
    const win = readWindows();
    const spans = {};
    for (const d of benchDepths) {
      const bottom = Math.max(1, Math.min(win[d], LADDER_N - benchLevels + 1));
      spans[d] = [bottom, Math.min(bottom + benchLevels - 1, LADDER_N)];
    }
    const spanNote = benchDepths.map(d => `D${d}:L${spans[d][0]}-L${spans[d][1]}`).join(' ');
    log(`iteration ${iter} — ladder sweep, per-depth windows ${spanNote} x ${benchCellGames} games`);
    writeStatus(`ladder sweep running (${spanNote}, started ${new Date().toISOString()})`);
    const grid = {};
    for (const d of benchDepths)
      for (let lvl = spans[d][0]; lvl <= spans[d][1]; lvl++)
        grid[lvl + ':' + d] = arenaScore(runCapturedSoft('arena.js',
          ['--a', 'nn:0:' + best, '--b', 'L' + lvl, '--games', benchCellGames, '--depth', String(d)]));
    const table = benchDepths.map(d => {
      const cells = [];
      for (let lvl = spans[d][0]; lvl <= spans[d][1]; lvl++) {
        const s = grid[lvl + ':' + d];
        cells.push(`L${lvl} ${s ? s.w + '-' + s.l : '-'}`.padStart(10));
      }
      return `    D${d}` + cells.join('');
    });
    log(`iteration ${iter} — ladder sweep (net's win-loss per cell):\n` + table.join('\n'));
    // Regression spot-check: the sweep above only ever looks at the CURRENT window, so once a rung
    // retires nothing ever re-examines it -- a net that sharpens against, say, L5 at the cost of an
    // L4 it used to have solid would never surface that here, maybe not for iterations, because L4
    // is below the window and simply isn't being asked about. Cheaply re-test the most recently
    // retired rungs per depth (spotCheckGames, far fewer than benchCellGames -- this is a check, not
    // a placement, so one dropped game out of two is already worth a flag) instead of every rung ever
    // retired, for the same reason tournament.js caps its own field with --recent: coverage that grew
    // with the run's whole history would make this more expensive every time it runs, not a fixed
    // cost. Wider (checks rungs the main sweep doesn't touch) but thinner (far fewer games each) --
    // the two trade off, so total spot-check cost stays flat regardless of how far the window has
    // already climbed.
    const spotCheckRecent = Math.max(0, +arg('spotCheckRecent', 3));
    const spotCheckGames = arg('spotCheckGames', '2');
    if (spotCheckRecent > 0) {
      const regressed = readRegressed();
      const notes = [];
      for (const d of benchDepths) {
        const from = Math.max(1, win[d] - spotCheckRecent);
        for (let lvl = from; lvl < win[d]; lvl++) {
          const s = arenaScore(runCapturedSoft('arena.js',
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
        log(`iteration ${iter} — regression spot-check: ` + notes.join(', '));
        writeRegressed(regressed);
      }
    }
    // Retire a rung for THIS DEPTH only -- L1 can be done with at 3-ply while 1-ply still has to
    // fight it. Demanding 100% on two adjacent rungs is what makes a 3-game cell safe: two clean
    // sweeps is ~1.6% by luck for an even matchup, and retiring slightly early costs almost
    // nothing, because a level you always beat has stopped carrying information anyway.
    const swept = (l, d) => { const s = grid[l + ':' + d]; return s && s.w > 0 && s.l === 0; };
    for (const d of benchDepths) {
      const [bottom, top] = spans[d];
      if (bottom + 1 <= top && swept(bottom, d) && swept(bottom + 1, d) &&
          bottom < LADDER_N - benchLevels + 1) {
        win[d] = bottom + 1;
        log(`iteration ${iter} — depth ${d}: L${bottom} retired (${d}-ply swept L${bottom} and ` +
            `L${bottom + 1}); its window moves up to L${bottom + 1}-L${Math.min(bottom + benchLevels, LADDER_N)}`);
      }
    }
    writeWindows(win);
    // The frontier line is the headline: where each depth is currently fighting. Read across it and
    // you are reading the diagonal.
    const frontier = benchDepths.map(d => `${d}ply:L${win[d]}`).join(' ');
    const regressedNow = readRegressed();
    const regressedNote = benchDepths
      .map(d => (regressedNow[d] || []).length ? `D${d}:L${regressedNow[d].join(',L')}` : null)
      .filter(Boolean).join(' ');
    log(`iteration ${iter} — frontier ${frontier}` + (regressedNote ? ` | regressed ${regressedNote}` : ''));
    statusState.lastBenchmark = `iteration ${iter}: frontier ${frontier}` +
      (regressedNote ? ` | regressed ${regressedNote}` : '') + ` — ` +
      table.map(r => r.trim().replace(/\s+/g, ' ')).join(' | ');
  } else {
    const nextBench = Math.ceil((iter + 1) / benchEvery) * benchEvery;
    log(`iteration ${iter} — ladder sweep skipped (next at iteration ${nextBench})`);
  }
  const nextBenchNote = iter % benchEvery === 0 ? '' :
    ` (next run at iteration ${Math.ceil((iter + 1) / benchEvery) * benchEvery})`;
  writeStatus(`iteration ${iter} complete${nextBenchNote}`);
}
