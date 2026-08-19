'use strict';
// Feature-ceiling probe: is the 94-feature vector the thing capping every net at ~83.5% val
// sign-accuracy? Every capacity from 96x64 to the 2M-weight behemoth converges to the same
// number, which smells like an input-representation ceiling, not a capacity one. Rows have
// always carried the raw pose (`p`: x, y, rot for both pieces) precisely so they could be
// re-featurised later -- so the cheapest possible test is: train the SAME shape, epochs, seed
// and data twice, once on the features alone and once with the z-scored pose appended
// (torch-train-core.py --poseInput), and compare validation curves.
//
//   node nn/experiment-pose.js [--hidden 96,96] [--epochs 12] [--data "nn/data/*.jsonl"] [--seed 12345]
//
// Read the result like this: if +pose clearly beats features-only on val sign-acc, the ceiling
// is representational and feature work is the highest-value direction; if they tie, the ceiling
// is label noise / data, and capacity or feature engineering won't move it. Offline only: a
// pose-input model cannot be played by the live engine yet, so outputs stay in nn/experiments.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const dir = __dirname;
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };

const hidden = arg('hidden', '96,96');
const epochs = String(+arg('epochs', 12));
const seed = String(+arg('seed', 12345));
const dataGlob = arg('data', path.join(dir, 'data', '*.jsonl'));
const name = arg('name', `pose-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`);
const expDir = path.join(dir, 'experiments', name);

function train(label, extra) {
  return new Promise((resolve, reject) => {
    const out = path.join(expDir, `${label}.json`);
    const args = [path.join(dir, 'torch-train-core.py'), '--data', dataGlob, '--hidden', hidden,
                  '--epochs', epochs, '--seed', seed, '--batch', '4096', '--lr', '0.001',
                  '--wd', '0.0001', '--lrDecay', 'cosine', '--out', out, ...extra];
    console.log(`\n$ python ${args.map(a => a.includes(' ') ? JSON.stringify(a) : a).join(' ')}`);
    const ch = spawn('python', args, { cwd: path.join(dir, '..') });
    let buf = '';
    ch.stdout.on('data', d => { buf += d; process.stdout.write(d); });
    ch.stderr.on('data', d => process.stderr.write(d));
    ch.on('error', reject);
    ch.on('exit', code => {
      if (code) return reject(new Error(`${label} trainer exited ${code}`));
      const epochsSeen = [...buf.matchAll(/epoch (\d+)\/\d+: train mse ([\d.]+), val mse ([\d.]+), val sign-acc ([\d.]+)%/g)]
        .map(m => ({ epoch: +m[1], trainMse: +m[2], valMse: +m[3], signAcc: +m[4] }));
      const best = buf.match(/best val mse ([\d.]+)/);
      resolve({ label, out, epochs: epochsSeen, bestValMse: best ? +best[1] : null,
                bestSignAcc: epochsSeen.length ? Math.max(...epochsSeen.map(e => e.signAcc)) : null });
    });
  });
}

async function main() {
  fs.mkdirSync(expDir, { recursive: true });
  console.log(`[pose] ${name}: shape ${hidden}, ${epochs} epochs, seed ${seed}; identical runs +/- pose input`);
  const plain = await train('features-only', []);
  const posed = await train('features-plus-pose', ['--poseInput']);
  const report = { at: new Date().toISOString(), hidden, epochs: +epochs, seed: +seed, data: dataGlob,
                   featuresOnly: plain, featuresPlusPose: posed };
  fs.writeFileSync(path.join(expDir, 'report.json'), JSON.stringify(report, null, 1));
  console.log('\n=== pose-input probe ===');
  for (const r of [plain, posed])
    console.log(`${r.label.padEnd(20)} best val mse ${r.bestValMse}  best sign-acc ${r.bestSignAcc}%`);
  if (plain.bestSignAcc != null && posed.bestSignAcc != null) {
    const d = +(posed.bestSignAcc - plain.bestSignAcc).toFixed(2);
    console.log(d > 0.3 ? `verdict: +pose gains ${d} pts sign-acc -- the feature set is leaving signal on the table; representation work is worth real investment`
              : d < -0.3 ? `verdict: +pose LOSES ${d} pts -- raw pose adds noise at this scale; keep the engineered features`
              : `verdict: within noise (${d} pts) -- the ceiling looks like label noise/data, not representation`);
  }
  console.log(`[pose] report -> ${path.join(expDir, 'report.json')}`);
}
main().catch(e => { console.error('[pose] failed:', e.stack || e.message); process.exitCode = 1; });
