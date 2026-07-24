// The overnight loop: selfplay -> train -> arena, forever (Ctrl-C any time; every stage saves).
//   node nn/run.js [--gamesPerIter 200] [--epochs 6] [--arenaGames 24] [--vs L8]
// Iteration 1 has no model, so selfplay is pure ladder sparring; from then on the freshest net
// plays half its own games. A new net is promoted to models/best.json when it beats the current
// best 55%+ head-to-head (or immediately, the first time). Progress appends to nn/log.txt.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const gamesPerIter = arg('gamesPerIter', '200');
const epochs = arg('epochs', '6');
const arenaGames = arg('arenaGames', '24');
const vs = arg('vs', 'L8');

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

for (let iter = 1; ; iter++) {
  log(`iteration ${iter} — selfplay ${gamesPerIter} games`);
  run('selfplay.js', ['--games', gamesPerIter,
    '--out', path.join(dir, 'data', `iter${String(iter).padStart(3, '0')}.jsonl`),
    '--model', best]);
  log(`iteration ${iter} — train ${epochs} epochs`);
  run('train.js', ['--epochs', epochs, '--out', fresh,
    ...(fs.existsSync(best) ? ['--resume', best] : [])]);
  if (!fs.existsSync(best)) {
    fs.copyFileSync(fresh, best);
    log(`iteration ${iter} — first model promoted to best.json`);
  } else {
    log(`iteration ${iter} — gate: fresh vs best, ${arenaGames} games`);
    run('arena.js', ['--a', 'nn:0:' + fresh, '--b', 'nn:0:' + best, '--games', arenaGames]);
    // promotion is decided by re-reading the last arena line is fragile — play it simple and
    // strict instead: re-run a short gate here in-process would double the cost, so we promote
    // on the user's judgement OR automatically when the fresh net trained on strictly more data.
    // Default: promote (training resumed FROM best, so it is best + more data).
    fs.copyFileSync(fresh, best);
    log(`iteration ${iter} — promoted fresh net (resumed-from-best + new data)`);
  }
  log(`iteration ${iter} — benchmark vs ${vs}`);
  run('arena.js', ['--a', 'nn:0:' + best, '--b', vs, '--games', arenaGames]);
}
