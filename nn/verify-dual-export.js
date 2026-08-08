// Check that a dual-head model exported for dualnet.js actually COMPUTES THE SAME THING it did on
// the training side. Same failure mode, same fix as verify-torch-export.js (read that file's header
// first) -- a transposed weight matrix loads fine, forward() returns numbers in the right RANGE,
// arena.js plays a full match and prints a score, and the only symptom is that the net is bad,
// indistinguishable from a net that trained badly. torch-train-dual.py writes a `__probe` block
// (inputs plus the FULL 23-wide raw output vector it computed for them, value included); this
// replays those inputs through dualnet.js and compares every component.
//
//   node nn/verify-dual-export.js nn/models/dual-v1.json
//
// Exit 0 = the JS side reproduces the Python side. Exit 1 = do not use this model.
'use strict';
const fs = require('fs');
const path = require('path');
const { DualMLP, OUT } = require('./dualnet.js');
const { N_FEATURES } = require('./features.js');
const { N_ARMS, N_BINS } = require('./policy.js');

const file = process.argv[2];
if (!file) {
  console.error('usage: node nn/verify-dual-export.js <model.json>');
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(1);
}

let bad = 0;
const fail = m => { console.error('FAIL: ' + m); bad++; };

if (!doc.dual) fail('missing `dual: true` -- this is not a dual-head export (use verify-torch-export.js for a plain value net)');
if (!Array.isArray(doc.sizes) || doc.sizes.length < 2) fail('missing or malformed `sizes`');
if (!Array.isArray(doc.W) || !Array.isArray(doc.b)) fail('missing `W` or `b`');
if (!bad) {
  if (doc.sizes[0] !== N_FEATURES)
    fail(`input width is ${doc.sizes[0]}, but this build's feature vector is ${N_FEATURES}`);
  if (doc.sizes[doc.sizes.length - 1] !== OUT)
    fail(`output width is ${doc.sizes[doc.sizes.length - 1]}, must be ${OUT} ` +
         `(1 value + ${N_ARMS} arms + ${N_BINS} bins)`);
  if (doc.W.length !== doc.sizes.length - 1) fail(`${doc.W.length} weight matrices for ${doc.sizes.length - 1} layers`);
  for (let l = 0; l < doc.W.length && !bad; l++) {
    const want = doc.sizes[l] * doc.sizes[l + 1];
    if (doc.W[l].length !== want)
      fail(`layer ${l}: ${doc.W[l].length} weights, expected ${want} (= ${doc.sizes[l]} in x ${doc.sizes[l + 1]} out)`);
    if (doc.b[l].length !== doc.sizes[l + 1])
      fail(`layer ${l}: ${doc.b[l].length} biases, expected ${doc.sizes[l + 1]}`);
  }
}
if (bad) process.exit(1);

const square = doc.sizes.slice(0, -1).some((s, i) => s === doc.sizes[i + 1]);

const net = DualMLP.fromJSON(doc);
console.log(`${path.basename(file)}: sizes ${doc.sizes.join(' -> ')}, ` +
            `${doc.W.reduce((n, w) => n + w.length, 0)} weights — shape OK`);

if (!Array.isArray(doc.__probe) || !doc.__probe.length) {
  console.error('\nNo `__probe` block in this file, so the numbers CANNOT be verified.');
  console.error('Shape alone does not catch a transposed layer' + (square ? ' -- and this model has a square layer, where shape can never catch it.' : '.'));
  console.error('Re-export with torch-train-dual.py (it writes __probe automatically).');
  process.exit(1);
}

let worst = 0, worstAt = -1, worstSlot = -1;
doc.__probe.forEach((p, i) => {
  if (!Array.isArray(p.x) || p.x.length !== N_FEATURES) {
    fail(`probe ${i}: input is ${p.x && p.x.length} long, expected ${N_FEATURES}`);
    return;
  }
  if (!Array.isArray(p.y) || p.y.length !== OUT) {
    fail(`probe ${i}: reference output is ${p.y && p.y.length} long, expected ${OUT}`);
    return;
  }
  const { z: got } = net.forward(p.x);
  for (let s = 0; s < OUT; s++) {
    const d = Math.abs(got[s] - p.y[s]);
    if (d > worst) { worst = d; worstAt = i; worstSlot = s; }
  }
});
if (bad) process.exit(1);

const TOL = 1e-5;
const slotName = s => s === 0 ? 'value' : s <= N_ARMS ? `arm logit ${s - 1}` : `bin logit ${s - 1 - N_ARMS}`;
console.log(`probe: ${doc.__probe.length} reference input(s), worst |JS - exporter| = ${worst.toExponential(2)}` +
            (worstAt >= 0 ? ` (probe ${worstAt}, ${slotName(worstSlot)})` : ''));

if (worst > TOL) {
  console.error(`\nFAIL: dualnet.js does NOT reproduce the exporter's outputs (tolerance ${TOL}).`);
  console.error('Almost always a weight-layout bug (see net.js\'s header) or the final layer\'s split');
  console.error('activation going wrong -- slot 0 (value) must be tanh\'d, slots 1.. (policy logits)');
  console.error('must stay raw. Check torch-train-dual.py\'s DualNet.forward() against dualnet.js\'s.');
  process.exit(1);
}

console.log('\nOK — this model computes the same values in dualnet.js as it did in the exporter.');
console.log('Safe to use:  node nn/arena.js --a dual:0:' + file + ' --b L11 --games 60 --depth 2');
