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
//   bulge-plain-200x40 / bulge-dense40-200x40
//                  200-40-200-40-200: two hard pinches in an otherwise wide trunk. Same shape
//                  twice, once plain and once with dense-memory packets that route around the
//                  pinches. Every bottleneck we have measured so far was UNBYPASSED, so the two
//                  hypotheses -- "narrow layers lose information" and "narrow layers lose
//                  information they have no way around" -- have never been separated. These twins
//                  separate them: if the plain one sinks and the dense one does not, the pinch was
//                  never the problem, the dead end was.
//
//   mem-k04 / k16 / k40 / k120 / k40-noresid  (--only memory, NOT in the default set)
//                  Five ablations of the production dense-memory recipe, which is 10x400 with
//                  k=40 and residualScale 0.2 -- best.json and half the pool are exactly this.
//                  Two questions it has never been possible to answer:
//                    how WIDE should the packet be? We have two dense-memory models and they
//                      differ in k AND in message type, so neither says anything about k alone.
//                      k04/k16/k40/k120 hold everything else fixed and sweep only the width.
//                    is it the packets at all? Every dense-memory net bundles packets with a
//                      residual trunk. k40-noresid keeps the packets and drops the trunk, so if
//                      it holds up the packets were doing the work, and if it collapses they
//                      never were. k40 is the shared control for both questions.
//
//   node nn/mint-oddballs.js [--epochs 10] [--only pancake,tower,ab,bulge] [--only memory]
const path = require('path');
const { spawn } = require('child_process');
const dir = __dirname;
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const epochs = String(+arg('epochs', 10));
const only = String(arg('only', 'pancake,tower,ab,bulge')).split(',').map(s => s.trim());

// The production dense-memory shape: best.json and half the live pool are this exact trunk, which
// is what makes an ablation of it worth anything -- the answer transfers to models already racing.
const TRUNK = Array(10).fill(400).join(',');

const MINTS = [
  { key: 'pancake', out: 'pancake-1024.json',  extra: ['--hidden', '1024'] },
  { key: 'tower',   out: 'tower-8x24.json',    extra: ['--hidden', '24,24,24,24,24,24,24,24'] },
  { key: 'ab',      out: 'ab-flat-96x96.json', extra: ['--hidden', '96,96', '--eloWeight', 'off'] },
  { key: 'ab',      out: 'ab-elo-96x96.json',  extra: ['--hidden', '96,96', '--eloWeight', 'logistic'] },
  // Identical geometry, identical seed; the ONLY difference is whether the pinches have a bypass.
  { key: 'bulge',   out: 'bulge-plain-200x40.json',
    extra: ['--hidden', '200,40,200,40,200', '--topology', 'plain'] },
  { key: 'bulge',   out: 'bulge-dense40-200x40.json',
    extra: ['--hidden', '200,40,200,40,200', '--topology', 'dense-memory',
            '--memoryWidth', '40', '--residualScale', '0.2'] },
  // Ablations of the production recipe. Same trunk, same seed, same epochs as each other; the
  // only moving part is named in the filename. k40 IS the production recipe, so it is the control
  // for the k sweep and for the residual question at once.
  ...[4, 16, 40, 120].map(k => ({
    key: 'memory', out: `mem-k${String(k).padStart(3, '0')}-10x400.json`,
    extra: ['--hidden', TRUNK, '--topology', 'dense-memory',
            '--memoryWidth', String(k), '--residualScale', '0.2'],
  })),
  { key: 'memory',  out: 'mem-k040-noresid-10x400.json',
    extra: ['--hidden', TRUNK, '--topology', 'dense-memory',
            '--memoryWidth', '40', '--residualScale', '0'] },
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
