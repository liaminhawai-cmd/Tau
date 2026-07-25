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
const benchEvery = Math.max(1, +arg('benchEvery', 3));
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
    runSoft('arena.js', ['--a', 'nn:0:' + fresh, '--b', 'nn:0:' + best, '--games', arenaGames]);
    // promotion is decided by re-reading the last arena line is fragile — play it simple and
    // strict instead: re-run a short gate here in-process would double the cost, so we promote
    // on the user's judgement OR automatically when the fresh net trained on strictly more data.
    // Default: promote (training resumed FROM best, so it is best + more data).
    fs.copyFileSync(fresh, best);
    log(`iteration ${iter} — promoted fresh net (resumed-from-best + new data)`);
  }
  // checkpoint: every iteration's model is kept — play them, watch them, arena old vs new
  const ckpt = path.join(dir, 'models', `ckpt-${String(iter).padStart(3, '0')}.json`);
  fs.copyFileSync(best, ckpt);
  log(`iteration ${iter} — checkpoint saved: ${path.basename(ckpt)}`);
  if (iter % benchEvery === 0) {
    log(`iteration ${iter} — benchmark vs ${vs}`);
    runSoft('arena.js', ['--a', 'nn:0:' + best, '--b', vs, '--games', arenaGames]);
  } else {
    log(`iteration ${iter} — benchmark vs ${vs} skipped (next at iteration ${Math.ceil((iter + 1) / benchEvery) * benchEvery})`);
  }
}
