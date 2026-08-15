'use strict';
// A shape check cannot catch transposed matrices, a tanh accidentally applied to logits, or a
// dense-memory packet wired to the wrong layer. Compare JS raw logits with probes produced by the
// exact PyTorch model before any checkpoint is allowed into an arena.
const fs = require('fs');
const path = require('path');
const { PolicyMLP, N_ACTIONS, JOINT_ENCODING, actionIndex, decodeAction } = require('./policy.js');

const file = process.argv[2];
if (!file) throw new Error('usage: node nn/verify-joint-policy-export.js MODEL.json');
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
if (j.policy !== true || j.policyEncoding !== JOINT_ENCODING)
  throw new Error(`not a ${JOINT_ENCODING} policy`);
if (!Array.isArray(j.sizes) || j.sizes[j.sizes.length - 1] !== N_ACTIONS)
  throw new Error(`joint policy must have ${N_ACTIONS} outputs`);
const fanIns = j.fanIns || j.sizes.slice(0, -1);
if (fanIns.length !== j.sizes.length - 1) throw new Error('fanIns/layer count mismatch');
for (let l = 0; l < fanIns.length; l++) {
  const want = fanIns[l]*j.sizes[l+1];
  if (!j.W[l] || j.W[l].length !== want || !j.b[l] || j.b[l].length !== j.sizes[l+1])
    throw new Error(`layer ${l} shape mismatch`);
}
const net = PolicyMLP.fromJSON(j);
const probes = j.__probe || [];
if (!probes.length) throw new Error('no PyTorch reference probes embedded');
let worst = 0, worstProbe = -1, worstSlot = -1;
for (let p = 0; p < probes.length; p++) {
  const got = net.forward(probes[p].x).z, want = probes[p].y;
  if (got.length !== want.length) throw new Error(`probe ${p} width mismatch`);
  for (let i = 0; i < got.length; i++) {
    const d = Math.abs(got[i] - want[i]);
    if (d > worst) { worst = d; worstProbe = p; worstSlot = i; }
  }
}
if (worst > 1e-4) throw new Error(`JS/PyTorch mismatch ${worst} at probe ${worstProbe}, slot ${worstSlot}`);
for (let leg = 0; leg < 3; leg++) for (const dir of [1, -1]) for (let bin = 0; bin < 16; bin++) {
  const rad = (bin + .5)*(170*Math.PI/180)/16;
  const a = actionIndex(leg, dir, rad), d = decodeAction(a);
  if (d.leg !== leg || d.canonDir !== dir || d.bin !== bin) throw new Error('action codec round-trip failed');
}
const pred = net.predict(probes[0].x);
const sum = pred.actions.reduce((a,b)=>a+b,0);
if (Math.abs(sum - 1) > 1e-9 || pred.arms.length !== 6)
  throw new Error('joint softmax/marginal prediction invalid');
console.log(`${path.basename(file)}: ${j.sizes.join(' -> ')}, ${j.policyEncoding}`);
console.log(`probe: ${probes.length} reference input(s), worst |JS - torch| = ${worst.toExponential(2)}`);
console.log('OK — export, dense-memory wiring, raw logits, softmax and action codec verified.');
