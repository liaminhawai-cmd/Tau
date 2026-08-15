// Check that a model exported for net.js actually COMPUTES THE SAME THING it did on the other side.
//
// This exists because the failure mode it catches is invisible. net.js stores each layer's weights
// as a flat array indexed W[j*nIn + i] (j = output, i = input). Hand it a transposed matrix and
// every downstream tool still works: fromJSON accepts it, forward() returns a number in [-1,1],
// arena.js plays a full match and prints a score. The only symptom is that the net is bad, which is
// indistinguishable from a net that trained badly -- so a layout bug can burn days looking like a
// modelling problem. torch-train.py writes a `__probe` block (inputs plus the outputs the exporting
// framework computed for them); this replays those inputs through net.js and compares.
//
//   node nn/verify-torch-export.js nn/models/torch-v1.json
//
// Exit 0 = the JS side reproduces the Python side. Exit 1 = do not use this model.
'use strict';
const fs = require('fs');
const path = require('path');
const { MLP } = require('./net.js');
const { N_FEATURES } = require('./features.js');

const file = process.argv[2];
if (!file) {
  console.error('usage: node nn/verify-torch-export.js <model.json>');
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

// --- shape checks: catch a malformed export before the numbers are even compared ---------------
if (!Array.isArray(doc.sizes) || doc.sizes.length < 2) fail('missing or malformed `sizes`');
if (!Array.isArray(doc.W) || !Array.isArray(doc.b)) fail('missing `W` or `b`');
const fanIns = doc.fanIns || (Array.isArray(doc.sizes) ? doc.sizes.slice(0, -1) : []);
if (!bad) {
  if (doc.sizes[0] !== N_FEATURES)
    fail(`input width is ${doc.sizes[0]}, but this build's feature vector is ${N_FEATURES}`);
  if (doc.sizes[doc.sizes.length - 1] !== 1)
    fail(`output width is ${doc.sizes[doc.sizes.length - 1]}, must be 1 (net.js reads acts[-1][0])`);
  if (!Array.isArray(fanIns) || fanIns.length !== doc.sizes.length - 1)
    fail('missing or malformed `fanIns`');
  if (doc.topology) {
    if (doc.topology.kind !== 'dense-memory-v1') fail(`unknown topology ${doc.topology.kind}`);
    if (!(doc.topology.memoryWidth > 0) || !(doc.topology.residualScale > 0))
      fail('dense-memory topology needs positive memoryWidth and residualScale');
  }
  if (doc.W.length !== doc.sizes.length - 1) fail(`${doc.W.length} weight matrices for ${doc.sizes.length - 1} layers`);
  for (let l = 0; l < doc.W.length && !bad; l++) {
    const want = fanIns[l] * doc.sizes[l + 1];
    if (doc.W[l].length !== want)
      fail(`layer ${l}: ${doc.W[l].length} weights, expected ${want} (= ${fanIns[l]} in x ${doc.sizes[l + 1]} out)`);
    if (doc.b[l].length !== doc.sizes[l + 1])
      fail(`layer ${l}: ${doc.b[l].length} biases, expected ${doc.sizes[l + 1]}`);
  }
}
if (bad) process.exit(1);

// A square layer hides a transpose from the shape check entirely -- 96x96 is the same element
// count either way -- which is exactly why the numeric probe below is the real test, not a nicety.
const square = fanIns.some((s, i) => s === doc.sizes[i + 1]);

const net = MLP.fromJSON(doc);
console.log(`${path.basename(file)}: sizes ${doc.sizes.join(' -> ')}, ` +
            `${doc.W.reduce((n, w) => n + w.length, 0)} weights` +
            `${doc.topology ? `, ${doc.topology.kind} k=${doc.topology.memoryWidth}` : ''} — shape OK`);

// --- the real test: does net.js reproduce the exporter's own outputs? --------------------------
if (!Array.isArray(doc.__probe) || !doc.__probe.length) {
  console.error('\nNo `__probe` block in this file, so the numbers CANNOT be verified.');
  console.error('Shape alone does not catch a transposed layer' + (square ? ' -- and this model has a square layer, where shape can never catch it.' : '.'));
  console.error('Re-export with torch-train.py (it writes __probe automatically).');
  process.exit(1);
}

let worst = 0, worstAt = -1;
doc.__probe.forEach((p, i) => {
  if (!Array.isArray(p.x) || p.x.length !== N_FEATURES) {
    fail(`probe ${i}: input is ${p.x && p.x.length} long, expected ${N_FEATURES}`);
    return;
  }
  const got = net.value(p.x);
  const d = Math.abs(got - p.y);
  if (d > worst) { worst = d; worstAt = i; }
});
if (bad) process.exit(1);

// float32 on the torch side vs float64 here, so exact equality is not the bar; 1e-5 is far tighter
// than any transpose or off-by-one could survive (those move the output by O(0.1-1)).
const TOL = 1e-5;
console.log(`probe: ${doc.__probe.length} reference input(s), worst |JS - exporter| = ${worst.toExponential(2)}` +
            (worstAt >= 0 ? ` (probe ${worstAt})` : ''));

if (worst > TOL) {
  console.error(`\nFAIL: net.js does NOT reproduce the exporter's outputs (tolerance ${TOL}).`);
  console.error('Almost always a weight-layout bug. net.js indexes W[j*nIn + i] with j = OUTPUT,');
  console.error('i = INPUT, i.e. flat output-major -- the same layout as torch\'s nn.Linear.weight');
  console.error('[out_features, in_features], so .flatten() is correct and .T.flatten() is not.');
  console.error('Also check every layer ends in tanh, output layer included.');
  process.exit(1);
}

console.log('\nOK — this model computes the same values in net.js as it did in the exporter.');
console.log('Safe to use:  node nn/arena.js --a nn:0:' + file + ' --b L11 --games 60 --depth 2');
