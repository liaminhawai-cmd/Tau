// The overnight loop: selfplay -> train -> arena, forever (Ctrl-C any time; every stage saves).
//   node nn/run.js [--gamesPerIter 30] [--epochs 6] [--benchEvery 10] [--benchLevels 4]
//                  [--benchCellGames 3] [--benchDeepUntil 4] [--tournamentEvery 10]
//                  [--tournamentRecent 12]
// Iteration 1 has no model, so selfplay is pure ladder sparring; from then on the freshest net
// plays most of its own games. Every iteration's net is promoted to models/best.json (see the note
// on the retired per-iteration gate below); a periodic round robin across the most recent
// --tournamentRecent checkpoints (capped, not every checkpoint ever saved -- see tournament.js) is
// what actually decides which one deserves to be best. Progress appends to nn/log.txt.
// The benchmark is a ladder SWEEP -- a few games in each (ladder level x search depth) cell -- so
// it reads as a placement rather than a single pass/fail, and the bottom rung retires once the net
// sweeps it. --benchEvery N only runs it on every Nth iteration; the skipped ones cost nothing.
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
const benchEvery = Math.max(1, +arg('benchEvery', 10));
// The benchmark is a SWEEP, not a single score. "0-12 vs L8" says "weaker than L8" and nothing
// else -- it cannot tell a net that plays like L2 from one that nearly beat L7, which is why four
// consecutive readings of 0%, 9%, 0%, 17% carried no usable signal. Playing a small number of
// games in many cells (a few ladder levels x a few search depths) reads as a PLACEMENT instead:
// each individual cell is noisy, but every depth is backed by all the levels and every level by
// all the depths, and the shape across cells (does depth 3 beat depth 2? where does the win rate
// fall off?) is legible long before any one cell is significant.
const benchLevels = Math.max(1, +arg('benchLevels', 4));      // ladder rungs per sweep
const benchCellGames = arg('benchCellGames', '3');            // games per (level, depth) cell
// Search depth costs ~3.6x per ply and high ladder rungs are multi-second-per-move brains, so the
// full depth range is only affordable while the window sits low. It narrows as the window climbs.
const benchDeepUntil = Math.max(1, +arg('benchDeepUntil', 4));
const tournamentEvery = Math.max(1, +arg('tournamentEvery', 10));
// Capped, or this grows every time it fires: ckpt-NNN.json accumulates one file per iteration
// forever, so an uncapped round robin is O(n^2) in how long the run has been going, not a fixed
// cost. --tournamentRecent keeps the field to a fixed-size sliding window (see tournament.js).
const tournamentRecent = arg('tournamentRecent', '12');
// selfplay is embarrassingly parallel — use most of the machine's cores by default (capped: the
// gain flattens and each worker holds its own engine sandbox). --workers 1 to go back to serial.
const workers = arg('workers', String(Math.max(1, Math.min(os.cpus().length - 1, 8))));

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

// How many rungs the ladder actually has, read from the game itself rather than hardcoded so the
// sweep can't walk off the end if a level is ever added or removed.
let LADDER_N = 11;
try { LADDER_N = require('./engine.js').createEngine().AI_LADDER.length; } catch (e) {}

// The sweep's bottom rung, persisted: this loop gets restarted constantly (closing the window, a
// reboot, a code pull), and a window that resets to L1 every time would spend its benchmark budget
// re-proving levels that were retired hours ago.
const windowFile = path.join(dir, 'models', '.ladder-window');
const readWindow = () => {
  try { const n = +fs.readFileSync(windowFile, 'utf8').trim(); if (n >= 1) return n; } catch (e) {}
  return 1;
};
const writeWindow = n => { try { fs.writeFileSync(windowFile, String(n) + '\n'); } catch (e) {} };

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
    `**selfRatio:** ${statusState.selfRatio ?? '-'}\n\n` +
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
// (closing the window, a crash, a reboot) used to reset the selfRatio ramp back to its iteration-1
// value AND re-target iter001.jsonl, silently stacking a new run's data onto the very first one's.
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
  // the self-play ramp: bootstrap on ladder games, then hand the curriculum to the net itself
  const selfRatio = fs.existsSync(best) ? Math.min(0.85, 0.25 + 0.1*(iter - 1)) : 0;
  log(`iteration ${iter} — selfplay ${gamesPerIter} games (selfRatio ${selfRatio.toFixed(2)}, ${workers} workers)`);
  statusState.iter = iter; statusState.selfRatio = selfRatio.toFixed(2);
  writeStatus(`selfplay running (${gamesPerIter} games, started ${new Date().toISOString()})`);
  run('selfplay.js', ['--games', gamesPerIter,
    '--out', path.join(dir, 'data', `iter${String(iter).padStart(3, '0')}.jsonl`),
    '--model', best, '--selfRatio', String(selfRatio), '--workers', workers]);
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
    log(`iteration ${iter} — round robin across the most recent ${tournamentRecent} checkpoints (this is what picks best.json now)`);
    writeStatus(`round robin running (started ${new Date().toISOString()})`);
    runSoft('tournament.js', ['--promote', '--recent', tournamentRecent, '--workers', workers]);
  }
  if (iter % benchEvery === 0) {
    const bottom = Math.max(1, Math.min(readWindow(), LADDER_N - benchLevels + 1));
    const top = Math.min(bottom + benchLevels - 1, LADDER_N);
    const depths = bottom <= benchDeepUntil ? [1, 2, 3, 4] : [1, 2, 3];
    log(`iteration ${iter} — ladder sweep L${bottom}-L${top} x ${depths.length} depths x ${benchCellGames} games`);
    writeStatus(`ladder sweep L${bottom}-L${top} running (started ${new Date().toISOString()})`);
    const grid = {};
    for (let lvl = bottom; lvl <= top; lvl++)
      for (const d of depths)
        grid[lvl + ':' + d] = arenaScore(runCapturedSoft('arena.js',
          ['--a', 'nn:0:' + best, '--b', 'L' + lvl, '--games', benchCellGames, '--depth', String(d)]));
    const table = ['         ' + depths.map(d => ('D' + d).padStart(8)).join('')];
    for (let lvl = bottom; lvl <= top; lvl++)
      table.push(('L' + lvl).padStart(6) + '   ' + depths.map(d => {
        const s = grid[lvl + ':' + d];
        return (s ? `${s.w}-${s.l}` : '-').padStart(8);
      }).join(''));
    log(`iteration ${iter} — ladder sweep (net's win-loss per cell):\n` + table.join('\n'));
    // Retire the bottom rung once even the SHALLOWEST search sweeps it and the rung above clean.
    // Judging on 1-ply is the conservative choice -- a level only a deep search beats is still
    // telling you something, so it stays. Demanding 100% is what makes a 3-game cell safe: two
    // clean sweeps is ~1.6% by luck for an even matchup, and retiring a level slightly early costs
    // almost nothing, because a level you always beat has stopped carrying information anyway.
    const swept = l => { const s = grid[l + ':1']; return s && s.w > 0 && s.l === 0; };
    if (bottom + 1 <= top && swept(bottom) && swept(bottom + 1) && bottom < LADDER_N - benchLevels + 1) {
      writeWindow(bottom + 1);
      log(`iteration ${iter} — L${bottom} retired (1-ply swept L${bottom} and L${bottom + 1}); ` +
          `window moves up to L${bottom + 1}-L${Math.min(bottom + benchLevels, LADDER_N)}`);
    }
    statusState.lastBenchmark = `iteration ${iter}: ladder sweep L${bottom}-L${top} — ` +
      table.slice(1).map(r => r.trim().replace(/\s+/g, ' ')).join(' | ');
  } else {
    const nextBench = Math.ceil((iter + 1) / benchEvery) * benchEvery;
    log(`iteration ${iter} — ladder sweep skipped (next at iteration ${nextBench})`);
  }
  const nextBenchNote = iter % benchEvery === 0 ? '' :
    ` (next run at iteration ${Math.ceil((iter + 1) / benchEvery) * benchEvery})`;
  writeStatus(`iteration ${iter} complete${nextBenchNote}`);
}
