// Gradient worker for train-policy.js's parallel path. One of these per lane; each owns a slice
// of every minibatch and its own gradient slot, and never touches Adam -- the main thread sums the
// slots and takes the single optimiser step, so the moment estimates stay in one place and the
// result is mathematically identical to the serial path regardless of lane count.
//
// Everything big is a SharedArrayBuffer: the feature matrix (the whole point -- 466k x 94 doubles
// is ~350MB, far too much to hand to each lane), the parameters, and the per-lane gradient slots.
// So a training step moves no data at all; it is a barrier, a read of shared weights, and a write
// into a private slot of shared gradient memory.
//
// Protocol, per batch (CTRL is an Int32Array):
//   CTRL[0] generation -- main increments it to publish a new batch, lanes wait on it
//   CTRL[1] batch length in rows
//   CTRL[2] lanes still working -- each lane decrements when done; main waits for zero
//   CTRL[3] quit flag
// Main only writes parameters while every lane is parked on CTRL[0], so the read of PARAMS below
// never races an update: the barrier at CTRL[2] is what separates "all gradients written" from
// "parameters changed".
'use strict';
const { parentPort, workerData } = require('worker_threads');
const { PolicyMLP, N_ARMS, N_BINS } = require('./policy.js');
const { N_FEATURES } = require('./features.js');

const { sizes, lane, lanes, sabs } = workerData;
const CTRL = new Int32Array(sabs.ctrl);
const IDX = new Int32Array(sabs.idx);
const X = new Float64Array(sabs.x);
const ARM = new Int32Array(sabs.arm);
const BIN = new Int32Array(sabs.bin);
const WT = new Float64Array(sabs.wt);
const CE = new Float64Array(sabs.ce);

const nParams = PolicyMLP.paramCount(sizes);
const net = new PolicyMLP(sizes).useSharedParams(sabs.params, 0);
// This lane's own gradient slot -- never shared with another lane, so no atomics needed on it.
const GRAD = new Float64Array(sabs.grads, lane*nParams*8, nParams);
// Views over that slot shaped like the net's own W/b, so accumGrads can write straight into it.
const gW = [], gB = [];
{
  let off = 0;
  for (let l = 0; l < sizes.length - 1; l++) {
    const n = sizes[l]*sizes[l+1];
    gW.push(new Float64Array(sabs.grads, (lane*nParams + off)*8, n)); off += n;
  }
  for (let l = 0; l < sizes.length - 1; l++) {
    const n = sizes[l+1];
    gB.push(new Float64Array(sabs.grads, (lane*nParams + off)*8, n)); off += n;
  }
}

const batch = [];
let seenGen = 0;

for (;;) {
  // Park until main publishes a new generation. The value re-check after waking matters: Atomics
  // .wait can return "not-equal" immediately if main already moved on, and spurious wakeups are
  // permitted, so the generation counter -- not the wake itself -- is what says work is ready.
  while (Atomics.load(CTRL, 0) === seenGen) {
    if (Atomics.load(CTRL, 3)) { process.exit(0); }
    Atomics.wait(CTRL, 0, seenGen, 50);
  }
  seenGen = Atomics.load(CTRL, 0);
  if (Atomics.load(CTRL, 3)) break;

  const batchLen = Atomics.load(CTRL, 1);
  // Contiguous split of the batch; the last lane absorbs the remainder, so every row is covered
  // exactly once for any batchLen/lanes combination (including batchLen < lanes, where the early
  // lanes simply get nothing and fall through to the barrier).
  const lo = Math.floor(lane*batchLen/lanes);
  const hi = Math.floor((lane + 1)*batchLen/lanes);

  GRAD.fill(0);
  batch.length = 0;
  for (let i = lo; i < hi; i++) {
    const r = IDX[i];
    // subarray, not slice: a view into the shared feature matrix, no per-row copy.
    batch.push({ x: X.subarray(r*N_FEATURES, (r + 1)*N_FEATURES), arm: ARM[r], bin: BIN[r], w: WT[r] });
  }
  CE[lane] = batch.length ? net.accumGrads(batch, gW, gB) : 0;

  // Publish this lane's completion last, after every gradient write above, so main summing the
  // slots after the barrier is guaranteed to see finished work.
  Atomics.sub(CTRL, 2, 1);
  Atomics.notify(CTRL, 2);
}

if (parentPort) parentPort.close();
