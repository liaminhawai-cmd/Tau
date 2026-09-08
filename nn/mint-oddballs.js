'use strict';
// Mint a small batch of deliberately weird one-off entrants into nn/models, where the open
// league auto-admits them. Everything here is a bet on a DIFFERENT axis than the usual
// wide/deep lineage steps, because same-data shape siblings keep converging to the same
// ~83.5% sign-accuracy -- the interesting variance is elsewhere:
//
//   pancake-1024   one enormous single hidden layer: maximum memorisation, zero hierarchy.
//                  If it hangs with the mid-field, depth is buying little on these features.
//   tower-8x24     eight narrow layers: maximum hierarchy, minimum width. The opposite probe.
//   ab-flat-96x96 / ab-elo-96x96
//                  byte-identical recipes except --eloWeight off/on: a LIVE A/B of the new
//                  Elo-weighted corpus, judged by the league itself rather than by val MSE.
//                  Whichever twin ends higher is direct evidence about the weighting.
//
//   node nn/mint-oddballs.js [--epochs 10] [--only pancake,tower,ab]
const path = require('path');
const { spawn } = require('child_process');
const dir = __dirname;
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const epochs = String(+arg('epochs', 10));
const only = String(arg('only', 'pancake,tower,ab')).split(',').map(s => s.trim());

const MINTS = [
  { key: 'pancake', out: 'pancake-1024.json',  extra: ['--hidden', '1024'] },
  { key: 'tower',   out: 'tower-8x24.json',    extra: ['--hidden', '24,24,24,24,24,24,24,24'] },
  { key: 'ab',      out: 'ab-flat-96x96.json', extra: ['--hidden', '96,96', '--eloWeight', 'off'] },
  { key: 'ab',      out: 'ab-elo-96x96.json',  extra: ['--hidden', '96,96', '--eloWeight', 'logistic'] },
];

function run(args) {
  return new Promise((ok, bad) => {
    console.log(`\n$ node nn/train-value.js ${args.join(' ')}`);
    const ch = spawn(process.execPath, [path.join(dir, 'train-value.js'), ...args], { stdio: 'inherit' });
    ch.on('error', bad);
    ch.on('exit', c => c === 0 ? ok() : bad(new Error(`train exited ${c}`)));
  });
}

(async () => {
  for (const m of MINTS.filter(m => only.includes(m.key))) {
    await run(['--epochs', epochs, '--seed', '12345',
               '--out', path.join(dir, 'models', m.out), ...m.extra]);
    console.log(`[oddball] ${m.out} minted; the league admits it automatically`);
  }
})().catch(e => { console.error('[oddball] failed:', e.message); process.exitCode = 1; });
