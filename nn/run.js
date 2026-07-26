// The overnight loop: selfplay -> train -> arena, forever (Ctrl-C any time; every stage saves).
//   node nn/run.js [--gamesPerIter 200] [--epochs 6] [--arenaGames 24] [--vs L8] [--benchEvery 3]
// Iteration 1 has no model, so selfplay is pure ladder sparring; from then on the freshest net
// plays half its own games. A new net is promoted to models/best.json when it beats the current
// best 55%+ head-to-head (or immediately, the first time). Progress appends to nn/log.txt.
// The vs-L8 benchmark is pure readout (it never affects promotion, and best.json is already saved
// by the time it runs) but is easily the priciest stage per iteration -- 30-55+ minutes against 24
// games' worth of deep search, versus single-digit minutes for everything else combined. --benchEvery
// N only runs it on every Nth iteration; the skipped ones cost nothing.
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
const arenaGames = arg('arenaGames', '24');
const vs = arg('vs', 'L8');
// The vs-L8 benchmark is pure readout -- it never affects promotion -- but it is by far the most
// expensive stage, and the thin-leg / no-grace rules made it worse: games run several times longer
// AND L8 is a multi-second-per-move brain, so a 24-game bench that already took ~1 hour can now run
// to 2-3. At ~5-7 minutes per training iteration that would spend most of a session measuring
// instead of learning. Rarer (every 10th iteration) and shorter (12 games) keeps it a sanity check
// rather than the main cost. --benchEvery 1 --benchGames 24 restores the old behaviour.
const benchEvery = Math.max(1, +arg('benchEvery', 10));
const benchGames = arg('benchGames', '12');
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
// gate needs the arena's result, not just its exit code — capture stdout (still echoed below) and
// pull the final "aWins-bWins" summary line arena.js prints out of it.
const GATE_THRESHOLD = 0.55;
const runCaptured = (script, args) => {
  console.log(`\n$ node nn/${script} ${args.join(' ')}`);
  const out = execFileSync('node', [path.join(dir, script), ...args], { encoding: 'utf8' });
  process.stdout.write(out);
  return out;
};

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
    runSoft('tournament.js', ['--promote']);
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
  run('selfplay.js', ['--games', gamesPerIter,
    '--out', path.join(dir, 'data', `iter${String(iter).padStart(3, '0')}.jsonl`),
    '--model', best, '--selfRatio', String(selfRatio), '--workers', workers]);
  log(`iteration ${iter} — train ${epochs} epochs`);
  run('train.js', ['--epochs', epochs, '--out', fresh,
    ...(fs.existsSync(best) ? ['--resume', best] : [])]);
  if (!fs.existsSync(best)) {
    fs.copyFileSync(fresh, best);
    log(`iteration ${iter} — first model promoted to best.json`);
  } else {
    log(`iteration ${iter} — gate: fresh vs best, ${arenaGames} games`);
    let stdout = '';
    try { stdout = runCaptured('arena.js', ['--a', 'nn:0:' + fresh, '--b', 'nn:0:' + best, '--games', arenaGames]); }
    catch (e) { log(`WARNING: gate arena failed (${e.message}) — promoting anyway (fail-open)`); }
    // arena.js's final line looks like "nn(value.json) vs nn(best.json): 7-17  (29% of decided, ...)"
    // -- pull the LAST "aWins-bWins" pair out of the captured output (earlier numbers are the live
    // per-game running tally, which uses the same "N-M" shape).
    const matches = [...stdout.matchAll(/:\s*(\d+)-(\d+)(?:-\d+)?\s+\(/g)];
    const last = matches[matches.length - 1];
    const freshWins = last ? +last[1] : 0, bestWins = last ? +last[2] : 0;
    const decided = freshWins + bestWins;
    if (!last || !decided) {
      fs.copyFileSync(fresh, best);
      log(`iteration ${iter} — gate: couldn't read a result — promoted anyway (fail-open)`);
    } else if (freshWins/decided >= GATE_THRESHOLD) {
      fs.copyFileSync(fresh, best);
      log(`iteration ${iter} — gate: fresh ${freshWins}-${bestWins} best ` +
          `(${(100*freshWins/decided).toFixed(0)}%) — promoted`);
    } else {
      log(`iteration ${iter} — gate: fresh ${freshWins}-${bestWins} best ` +
          `(${(100*freshWins/decided).toFixed(0)}%) — held, best.json unchanged ` +
          `(this iteration's data is still on disk and feeds the next attempt)`);
    }
  }
  // checkpoint: every iteration's model is kept — play them, watch them, arena old vs new
  const ckpt = path.join(dir, 'models', `ckpt-${String(iter).padStart(3, '0')}.json`);
  fs.copyFileSync(best, ckpt);
  log(`iteration ${iter} — checkpoint saved: ${path.basename(ckpt)}`);
  if (iter % benchEvery === 0) {
    log(`iteration ${iter} — benchmark vs ${vs}`);
    runSoft('arena.js', ['--a', 'nn:0:' + best, '--b', vs, '--games', benchGames]);
  } else {
    log(`iteration ${iter} — benchmark vs ${vs} skipped (next at iteration ${Math.ceil((iter + 1) / benchEvery) * benchEvery})`);
  }
}
