// Promote the current local policy-mutant.json to become policy-champ.json -- the same file
// operation policyloop.js's own adoption step performs when a mutant wins its automated
// champ-vs-mutant tournament (see that file's "ADOPTION IS A CHEAP, REVERSIBLE HILL-CLIMB STEP"
// comment), just triggered by a human after a manual arena test instead of the loop's own
// 6-games-per-cycle tournament. Exists because a mutant sitting in policy-mutant.json is one
// mint+train cycle away from being silently overwritten -- the loop reuses that exact filename for
// every new shape it tries next, whether or not the previous occupant was ever fought or even
// looked at. Observed live: a desktop mutant that beat the champion 16-8 in a manual same-net,
// same-clock test would have been gone within the hour, replaced by cycle 5's untested shape.
//
// Always backs up the outgoing champion first (reversible, same philosophy as the loop's own
// adoption) and derives the promoted net's own hidden shape from its weight-matrix sizes rather
// than trusting anything external, so this is correct standalone, run any time after whatever
// cycle actually trained the file, on either machine, without the loop's own in-memory state.
//
//   node nn/promote-mutant.js [--epochs 20]
'use strict';
const fs = require('fs');
const path = require('path');
const { PolicyMLP } = require('./policy.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const modelsDir = path.join(__dirname, 'models');
const mutantPath = path.join(modelsDir, 'policy-mutant.json');
const champPath = path.join(modelsDir, 'policy-champ.json');
// Same record file policyloop.js's setChampRecord/champRecord read and write -- writing it here
// with the SAME shape means the next automated cycle sees a champion whose record already matches
// (same shape, same epoch count) and skips straight to training a new mutant, instead of treating
// this hand-promoted file as "no completion record (training was interrupted)" and retraining it
// from scratch for no reason.
const champShapeFile = path.join(modelsDir, '.policy-champ-shape');
// Matches train-policy.js's and policyloop.js's own --epochs default; override if you promoted a
// mutant trained with a non-default epoch count.
const epochs = +arg('epochs', 20);

if (!fs.existsSync(mutantPath)) {
  console.error(`${mutantPath} not found -- nothing to promote.`);
  process.exit(1);
}

let sizes;
try {
  const j = JSON.parse(fs.readFileSync(mutantPath, 'utf8'));
  PolicyMLP.fromJSON(j);   // throws on anything that isn't actually a loadable policy net
  sizes = j.sizes;
} catch (e) {
  console.error(`${mutantPath} did not load as a policy net (${e.message}) -- not promoting.`);
  process.exit(1);
}
// sizes is [inputWidth, ...hidden layers..., N_ARMS+N_BINS] (policy.js's own PolicyMLP comment) --
// strip the fixed input/output ends to recover the --hidden shape string everything else uses.
const shape = sizes.slice(1, -1).join(',');

if (fs.existsSync(champPath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(modelsDir, `policy-champ-backup-${stamp}.json`);
  fs.copyFileSync(champPath, backupPath);
  console.log(`backed up outgoing champion -> ${path.relative(process.cwd(), backupPath)}`);
} else {
  console.log('no existing policy-champ.json -- nothing to back up, this is the first champion');
}

fs.copyFileSync(mutantPath, champPath);
fs.writeFileSync(champShapeFile,
  JSON.stringify({ shape, cycle: 'manual', epochs, at: new Date().toISOString() }));
console.log(`promoted policy-mutant.json -> policy-champ.json (shape ${shape}, ${epochs} epochs recorded)`);
console.log('policyloop.js will train its next mutant FROM this shape, and will not retrain this');
console.log('champion itself unless a future --epochs differs from the value recorded here.');
