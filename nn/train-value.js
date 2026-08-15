'use strict';

// One entry point for every ordinary Tau value-net birth.
// Desktop: PyTorch/CUDA, large batches, verified net.js export.
// CPU-only machine or failed CUDA run: the established train.js path.
// Both backends write a disposable partial first, so a killed/failed train never replaces a
// standing model with a corrupt file.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const original = process.argv.slice(2);

function arg(name, fallback = null) {
  const i = original.indexOf('--' + name);
  return i >= 0 && i + 1 < original.length ? original[i + 1] : fallback;
}
function withOut(args, out) {
  const next = args.slice(), i = next.indexOf('--out');
  if (i >= 0) next.splice(i, 2, '--out', out);
  else next.push('--out', out);
  return next;
}
function hiddenOf(file) {
  if (!file) return null;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(j.sizes) && j.sizes.length > 2 ? j.sizes.slice(1, -1).join(',') : null;
  } catch (_) { return null; }
}
function topologyOf(file) {
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).topology || null; }
  catch (_) { return null; }
}
function run(cmd, args, label) {
  return new Promise((resolve, reject) => {
    console.log('\n$ ' + cmd + ' ' + args.join(' '));
    const ch = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    ch.on('error', reject);
    ch.on('exit', code => code === 0 ? resolve() : reject(new Error(label + ' exited ' + code)));
  });
}
function cudaAvailable() {
  try {
    return spawnSync('python', ['-c',
      'import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)'],
      { cwd: ROOT, stdio: 'ignore' }).status === 0;
  } catch (_) { return false; }
}
function validateValueNet(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(j.sizes) || j.sizes.length < 3 || +j.sizes[j.sizes.length - 1] !== 1 ||
      !Array.isArray(j.W) || !Array.isArray(j.b))
    throw new Error('trainer produced an invalid value-net JSON');
}

async function main() {
  const out = path.resolve(ROOT, arg('out', path.join('nn', 'models', 'value.json')));
  const partial = out.replace(/\.json$/i, '') + '.partial.json';
  try { fs.unlinkSync(partial); } catch (_) {}
  fs.mkdirSync(path.dirname(out), { recursive: true });

  let trained = false;
  const resume = arg('resume');
  const structured = topologyOf(resume);
  if (cudaAvailable()) {
    const hidden = arg('hidden') || hiddenOf(resume) || '96,96';
    const torchArgs = [
      path.join('nn', 'torch-train.py'),
      '--epochs', arg('epochs', '8'),
      '--hidden', hidden,
      '--out', partial,
      '--batch', arg('batch', '4096'),
      '--lr', arg('lr', '0.001'),
      '--wd', arg('wd', '0.0001'),
      '--seed', arg('seed', '12345'),
      '--gameWeight', arg('gameWeight', 'sqrt'),
      '--drawWeight', arg('drawWeight', '0.25'),
      '--familyWeight', arg('familyWeight', 'sqrt'),
      '--lrDecay', arg('lrDecay', 'cosine'),
      '--device', 'cuda',
      ...(resume ? ['--resume', resume] : []),
    ];
    console.log('[value-train] backend torch-cuda (batch ' + arg('batch', '4096') +
                '), export must verify before it enters the pool');
    try {
      await run('python', torchArgs, 'torch value trainer');
      await run('node', [path.join('nn', 'verify-torch-export.js'), partial],
                'torch export verification');
      trained = true;
    } catch (e) {
      console.warn('[value-train] CUDA path failed (' + e.message +
                   '); falling back to the JavaScript CPU trainer');
      try { fs.unlinkSync(partial); } catch (_) {}
    }
  }

  if (!trained) {
    if (structured)
      throw new Error(`checkpoint topology ${structured.kind} requires the verified PyTorch path; refusing an incompatible CPU fallback`);
    console.log('[value-train] backend js-cpu');
    await run('node', [path.join('nn', 'train.js'), ...withOut(original, partial)],
              'JavaScript value trainer');
    validateValueNet(partial);
  }

  // The partial is complete and, for Torch, numerically verified against net.js. A same-directory
  // rename is the only operation allowed to replace the requested standing filename.
  fs.renameSync(partial, out);
  console.log('[value-train] READY -> ' + out);
}

main().catch(e => {
  console.error('[value-train] FAILED: ' + e.message);
  process.exitCode = 1;
});
