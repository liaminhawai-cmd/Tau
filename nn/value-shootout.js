'use strict';

// Small, deliberately non-production shootout for comparing the two value-net training paths.
// It preserves any existing generic option-24/39 outputs by reading the hidden shape from `sizes`,
// trains only whichever requested shape/framework files are missing, then runs all four Torch x JS
// pairings through the SAME arena.js/nnai.js search at one fixed depth.
//
// Defaults mirror the menu recipes rather than pretending the trainers are identical:
//   JS:    train.js, 8 epochs
//   Torch: torch-train.py, 40 epochs
// That makes this answer "which recipe produced the stronger weights?", not a controlled optimizer
// benchmark. It is just a handy A/B toy, which is exactly what the menu option is for.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODELS = path.join(__dirname, 'models');
const HOST = os.hostname();

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function normShape(s) {
  return String(s || '').split(',').map(x => x.trim()).filter(Boolean).join(',');
}
function shapeTag(s) {
  return normShape(s).replace(/,/g, 'x');
}
function hiddenFromModel(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(j.sizes) || j.sizes.length < 3) return null;
    return j.sizes.slice(1, -1).join(',');
  } catch (_) { return null; }
}
function copyIfUseful(src, kind, requested) {
  if (!fs.existsSync(src)) return;
  const hidden = hiddenFromModel(src);
  if (!hidden) {
    console.log(`Could not read shape from ${path.relative(ROOT, src)}; leaving it untouched.`);
    return;
  }
  if (!requested.includes(hidden)) {
    console.log(`Existing ${kind} generic is shape ${hidden}; requested ${requested.join(' / ')}, so leaving it untouched.`);
    return;
  }
  const dest = modelPath(kind, hidden);
  if (fs.existsSync(dest)) {
    console.log(`Already archived ${kind} ${hidden}: ${path.relative(ROOT, dest)}`);
    return;
  }
  fs.copyFileSync(src, dest);
  console.log(`Preserved existing ${kind} ${hidden} -> ${path.relative(ROOT, dest)}`);
}
function modelPath(kind, hidden) {
  return path.join(MODELS, `shootout-${kind}-${shapeTag(hidden)}-${HOST}.json`);
}
function run(cmd, args, label) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (r.error) {
    console.error(`${label} could not start: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`${label} failed with exit code ${r.status}.`);
    process.exit(r.status || 1);
  }
}

const shapeA = normShape(arg('shapeA', '96,96'));
const shapeB = normShape(arg('shapeB', '208'));
const shapes = [...new Set([shapeA, shapeB])];
if (shapes.length !== 2) {
  console.error('Choose two different shapes, e.g. --shapeA 96,96 --shapeB 208');
  process.exit(1);
}
const games = Math.max(1, +arg('games', 30));
const depth = Math.max(1, +arg('depth', 2));
const jsEpochs = Math.max(1, +arg('jsEpochs', 8));
const torchEpochs = Math.max(1, +arg('torchEpochs', 40));
const trainMissing = arg('trainMissing', '1') !== '0';

fs.mkdirSync(MODELS, { recursive: true });

console.log('Tau value-net four-combo shootout');
console.log(`Shapes: ${shapeA} and ${shapeB}`);
console.log(`Arena: ${games} games per pairing, depth ${depth}`);
console.log(`Recipes: JS ${jsEpochs} epochs; Torch ${torchEpochs} epochs`);
console.log('No winner is promoted and arena games are not added to training data.');

// Rescue the menu's old single-name outputs before creating anything new. If 208 overwrote 96,
// only 208 can be rescued; the missing 96 is retrained below.
copyIfUseful(path.join(MODELS, `torch-${HOST}.json`), 'torch', shapes);
copyIfUseful(path.join(MODELS, 'value.json'), 'js', shapes);

for (const hidden of shapes) {
  const torchOut = modelPath('torch', hidden);
  const jsOut = modelPath('js', hidden);

  if (!fs.existsSync(torchOut)) {
    if (!trainMissing) {
      console.error(`Missing ${path.relative(ROOT, torchOut)} (rerun without --trainMissing 0 to create it).`);
      process.exit(1);
    }
    run('python', [
      path.join('nn', 'torch-train.py'), '--hidden', hidden, '--epochs', String(torchEpochs),
      '--out', torchOut
    ], `TRAIN TORCH ${hidden}`);
    run('node', [path.join('nn', 'verify-torch-export.js'), torchOut], `VERIFY TORCH ${hidden}`);
  }

  if (!fs.existsSync(jsOut)) {
    if (!trainMissing) {
      console.error(`Missing ${path.relative(ROOT, jsOut)} (rerun without --trainMissing 0 to create it).`);
      process.exit(1);
    }
    run('node', [
      path.join('nn', 'train.js'), '--hidden', hidden, '--epochs', String(jsEpochs), '--out', jsOut
    ], `TRAIN JS ${hidden}`);
  }
}

console.log('\n============================================================');
console.log('FOUR CROSS-FRAMEWORK MATCHUPS');
console.log('============================================================');

for (const tShape of shapes) {
  for (const jShape of shapes) {
    const torchFile = modelPath('torch', tShape);
    const jsFile = modelPath('js', jShape);
    run('node', [
      path.join('nn', 'arena.js'),
      '--a', `nn:0:${torchFile}`,
      '--b', `nn:0:${jsFile}`,
      '--games', String(games),
      '--depth', String(depth)
    ], `TORCH ${tShape} vs JS ${jShape}`);
  }
}

console.log('\n=== shootout complete ===');
console.log('The four arena results are also in nn/arena-logs/.');
console.log('The shape-specific model files stay under nn/models/ so rerunning does not retrain them.');
