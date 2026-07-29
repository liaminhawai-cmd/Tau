// One-shot, self-deciding migration to WHATEVER width features.js currently builds (imported as
// N_FEATURES below, never hardcoded here) -- this file has already carried one feature-set bump
// (82->88) and now a second (88->94) unchanged, since every step just compares stored widths
// against N_FEATURES rather than assuming a specific number. GO.bat runs this before anything
// else; it works out for itself what still needs doing, so running it twice -- or on a machine
// that already migrated -- is a fast no-op. All the decision logic lives here in node rather than
// in batch, where it can actually be tested.
//
//   node nn/migrate88.js [--initialEpochs 30] [--hidden 96,64,48]
//
// Steps, each skipped when already done:
//   1. data/*.jsonl rows at the wrong width  -> refeaturize.js (rebuilds from stored poses;
//      originals go to data/backup-pre<oldWidth>/)
//   2. models/*.json at the wrong input width -> moved to models/archive-pre<oldWidth>/ wholesale.
//      They cannot be loaded by the new code on purpose (train.js exits loudly on a width
//      mismatch), and anything left behind would poison tournaments silently: net.js's forward
//      pass reads the first sizes[0] entries of whatever vector it's handed, so a narrower
//      checkpoint fed wider features "works" and plays garbage. The dotfiles (.ladder-window,
//      .ladder-regressed, .tournament-done) stay: the frontier was earned against the ladder, not
//      against a feature set, and losing it would restart the sweep from L1. If the fresh net
//      turns out weaker than the frontier assumes, the sweep just loses cells for a cycle and the
//      regression spot-check feeds the misses back into the training pool -- self-correcting.
//   3. no valid models/best.json -> train one from scratch on ALL accumulated (now re-featurised)
//      data. 30 epochs, the same budget every scratch challenger gets -- which twice beat the
//      whole accumulated lineage in round robins, so this is not a weak starting point.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { N_FEATURES } = require('./features.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const initialEpochs = arg('initialEpochs', '30');
const hidden = arg('hidden', '96,64,48');
const dir = __dirname;
// overridable mostly so the migration can be exercised against a scratch copy in tests
const dataDir = arg('data', path.join(dir, 'data'));
const modelsDir = arg('models', path.join(dir, 'models'));

const run = (script, args) => {
  console.log(`\n$ node nn/${script} ${args.join(' ')}`);
  execFileSync('node', [path.join(dir, script), ...args], { stdio: 'inherit' });
};

console.log(`migrate88: current feature set is ${N_FEATURES} wide`);

// ---- 1. data ----
let dataFiles = [];
try { dataFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.jsonl')); } catch (e) {}
let needRefeat = false;
for (const f of dataFiles) {
  // sample the first parseable row of each file -- widths are uniform within a file
  const txt = fs.readFileSync(path.join(dataDir, f), 'utf8');
  const nl = txt.indexOf('\n');
  const line = nl > 0 ? txt.slice(0, nl) : txt;
  try {
    const j = JSON.parse(line);
    if (j.f && j.f.length !== N_FEATURES) { needRefeat = true; break; }
  } catch (e) {}
}
if (needRefeat) {
  console.log('\n[1/3] data rows are at the old width -- re-featurising from stored poses');
  run('refeaturize.js', ['--data', dataDir]);
} else {
  console.log(`[1/3] data: ${dataFiles.length} file(s) already at width ${N_FEATURES} (or no data) -- nothing to do`);
}

// ---- 2. models ----
const widthOf = p => {
  try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return j.sizes ? j.sizes[0] : null; }
  catch (e) { return null; }
};
let modelFiles = [];
try { modelFiles = fs.readdirSync(modelsDir).filter(f => f.endsWith('.json')); } catch (e) {}
const stale = modelFiles.filter(f => {
  const w = widthOf(path.join(modelsDir, f));
  return w !== null && w !== N_FEATURES;
});
if (stale.length) {
  const staleWidth = widthOf(path.join(modelsDir, stale[0]));
  const archive = path.join(modelsDir, `archive-pre${staleWidth}`);
  fs.mkdirSync(archive, { recursive: true });
  for (const f of stale) fs.renameSync(path.join(modelsDir, f), path.join(archive, f));
  console.log(`[2/3] models: moved ${stale.length} incompatible net(s) (width ${staleWidth}) to ${path.basename(archive)}/`);
  // .archtest-winner points at an archived model now -- drop it so laddertest falls back cleanly
  try { fs.unlinkSync(path.join(modelsDir, '.archtest-winner')); } catch (e) {}
} else {
  console.log(`[2/3] models: nothing incompatible found -- nothing to do`);
}

// ---- 3. initial best.json ----
const bestPath = path.join(modelsDir, 'best.json');
const bestOk = fs.existsSync(bestPath) && widthOf(bestPath) === N_FEATURES;
let rows = 0;
for (const f of dataFiles) {
  try { rows += fs.readFileSync(path.join(dataDir, f), 'utf8').split('\n').filter(Boolean).length; } catch (e) {}
  if (rows > 500) break;
}
if (bestOk) {
  console.log('[3/3] best.json: already valid at the current width -- nothing to do');
} else if (rows <= 500) {
  console.log('[3/3] best.json: not enough data to train one -- run.js will start with pure ladder selfplay, as on a fresh machine');
} else {
  console.log(`\n[3/3] training an initial best.json from scratch on all accumulated data (${initialEpochs} epochs, --hidden ${hidden})`);
  fs.mkdirSync(modelsDir, { recursive: true });
  run('train.js', ['--data', path.join(dataDir, '*.jsonl'), '--epochs', initialEpochs, '--hidden', hidden, '--out', bestPath]);
}

console.log('\nmigrate88: done');
