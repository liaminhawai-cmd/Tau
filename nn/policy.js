// Policy heads over the same 94 canonical inputs as the value net. Two encodings remain readable:
//
// LEGACY FACTORED (22 outputs): two independent softmax groups over one shared tanh trunk:
//   arms:  6 logits, sorted-slot pivot (0..2, outermost first) x canonical direction (see
//          features.moveFrame -- raw foot labels and world directions are exactly the symmetries
//          the input features already quotient away, so outputs must live in the same frame)
//   bins:  N_BINS logits over |swing angle|, uniform up to the 170-degree safety cap
// JOINT SIGNED (96 outputs): one softmax over
//   centre/left/right pivot x clockwise/anticlockwise x 16 swing-distance bins.
// This is the new experiment. Distance is conditional on the exact pivot and direction instead of
// pretending that the same global distance distribution applies to all six ways to move. Existing
// 22-output policy and dual checkpoints keep their original behaviour and remain loadable.
//
// Structurally a sibling of net.js's MLP (same layout, same Adam, same JSON shape) with two
// differences that make it a classifier instead of a regressor: the FINAL layer is linear (softmax
// needs raw logits; tanh would squash them into [-1,1] and cap the confidence the net can express),
// and training minimises cross-entropy, whose output delta is the famously clean softmax(z) - onehot.
'use strict';

const N_BINS = 16;
const CAP_RAD = 170*Math.PI/180;
const N_ARMS = 6;
const N_LEGS = 3;
const SIGNED_BINS = N_BINS*2;
const N_ACTIONS = N_LEGS*SIGNED_BINS;
const JOINT_ENCODING = 'centre-left-right-signed32-v1';

function armIndex(slot, canonDir) { return slot*2 + (canonDir > 0 ? 0 : 1); }
function binIndex(rad) {
  const a = Math.min(Math.abs(rad), CAP_RAD - 1e-9);
  return Math.floor(a/CAP_RAD*N_BINS);
}
function binCenter(bin) { return (bin + 0.5)*CAP_RAD/N_BINS; }
function actionIndex(leg, canonDir, rad) {
  if (leg < 0 || leg >= N_LEGS) throw new Error(`joint-policy leg out of range: ${leg}`);
  return leg*SIGNED_BINS + (canonDir > 0 ? 0 : N_BINS) + binIndex(rad);
}
function decodeAction(action) {
  if (action < 0 || action >= N_ACTIONS) throw new Error(`joint-policy action out of range: ${action}`);
  const leg = Math.floor(action/SIGNED_BINS), within = action%SIGNED_BINS;
  return { leg, canonDir: within < N_BINS ? 1 : -1, bin: within%N_BINS };
}

function softmax(z, from, to) {
  let mx = -Infinity;
  for (let i = from; i < to; i++) if (z[i] > mx) mx = z[i];
  let s = 0;
  const p = new Float64Array(to - from);
  for (let i = from; i < to; i++) { p[i - from] = Math.exp(z[i] - mx); s += p[i - from]; }
  for (let i = 0; i < p.length; i++) p[i] /= s;
  return p;
}

class PolicyMLP {
  constructor(sizes, topology=null, fanIns=null, policyEncoding=null) {
    const out = sizes[sizes.length - 1];
    if (out !== N_ARMS + N_BINS && out !== N_ACTIONS)
      throw new Error(`policy output layer must be ${N_ARMS + N_BINS} (legacy) or ${N_ACTIONS} (joint)`);
    this.sizes = sizes;
    this.policyEncoding = policyEncoding || (out === N_ACTIONS ? JOINT_ENCODING : 'factored-arm-bin-v1');
    this.topology = topology || null;
    const structured = this.topology && ['dense-memory-v1','pairwise-memory-v1'].includes(this.topology.kind);
    if (!fanIns && structured) {
      const k=+this.topology.memoryWidth||0;
      fanIns=sizes.slice(0,-1).map((n,l)=>n+k*Math.max(0,l-1));
    }
    this.fanIns = fanIns || sizes.slice(0, -1);
    if (this.fanIns.length !== sizes.length - 1)
      throw new Error(`fanIns has ${this.fanIns.length} entries for ${sizes.length - 1} layers`);
    this.W = []; this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const fanIn = this.fanIns[l], n = sizes[l+1];
      const w = new Float64Array(fanIn*n);
      const s = Math.sqrt(2/(fanIn + n));
      for (let i = 0; i < w.length; i++) w[i] = (Math.random()*2 - 1)*s*1.7;
      this.W.push(w);
      this.b.push(new Float64Array(n));
    }
    // Pairwise-memory is a low-rank skip graph: every non-adjacent hidden source gets its own
    // tiny learned message for every later destination. Adjacent layers already have the full
    // ordinary matrix, so duplicating them as four-neuron skips would add parameters but no new
    // route. Arrays are indexed [targetLayer][sourceHiddenLayer].
    this.skipW = []; this.skipB = [];
    if (this.topology && this.topology.kind === 'pairwise-memory-v1') {
      const k = +this.topology.memoryWidth || 0;
      if (k < 1) throw new Error('pairwise policy memoryWidth must be positive');
      for (let l = 0; l < sizes.length - 1; l++) {
        const sw = [], sb = [];
        for (let s = 0; s < l - 1; s++) {
          const nIn = sizes[s+1], w = new Float64Array(k*nIn);
          const scale = Math.sqrt(2/(nIn + k));
          for (let i = 0; i < w.length; i++) w[i] = (Math.random()*2 - 1)*scale*1.7;
          sw.push(w); sb.push(new Float64Array(k));
        }
        this.skipW.push(sw); this.skipB.push(sb);
      }
    }
    this._adam = null;
  }
  forward(x) {                         // returns { z (raw logits), acts }
    const acts = [Float64Array.from(x)];
    let a = acts[0];
    const L = this.W.length;
    const dense = this.topology && this.topology.kind === 'dense-memory-v1';
    const pairwise = this.topology && this.topology.kind === 'pairwise-memory-v1';
    const memoryWidth = (dense || pairwise) ? (+this.topology.memoryWidth || 0) : 0;
    const residualScale = (dense || pairwise) ? (+this.topology.residualScale || 0) : 0;
    const memories = [];
    const history = [];
    for (let l = 0; l < L; l++) {
      let aIn = a;
      if (dense && l > 0) {
        const earlier = memories.slice(0, -1);
        aIn = new Float64Array(a.length + earlier.length*memoryWidth);
        aIn.set(a); let off = a.length;
        for (const m of earlier) { aIn.set(m, off); off += memoryWidth; }
      } else if (pairwise && l > 1) {
        const earlier = history.slice(0, -1), messages = [];
        for (let s = 0; s < earlier.length; s++) {
          const src = earlier[s], P = this.skipW[l][s], pb = this.skipB[l][s];
          const m = new Float64Array(memoryWidth);
          for (let j = 0; j < memoryWidth; j++) {
            let sum = pb[j];
            for (let i = 0; i < src.length; i++) sum += P[j*src.length+i]*src[i];
            m[j] = Math.tanh(sum);
          }
          messages.push(m);
        }
        aIn = new Float64Array(a.length + messages.length*memoryWidth);
        aIn.set(a); let off = a.length;
        for (const m of messages) { aIn.set(m, off); off += memoryWidth; }
      }
      const nIn = this.fanIns[l], nOut = this.sizes[l+1];
      if (aIn.length !== nIn) throw new Error(`policy layer ${l} input ${aIn.length}, expected ${nIn}`);
      const z = new Float64Array(nOut), W = this.W[l], b = this.b[l];
      for (let j = 0; j < nOut; j++) {
        let s = b[j];
        for (let i = 0; i < nIn; i++) s += W[j*nIn + i]*aIn[i];
        if (l === L - 1) z[j] = s;                // raw logits
        else {
          const branch = Math.tanh(s);
          z[j] = (dense || pairwise) && l > 0 ? a[j] + residualScale*branch : branch;
        }
      }
      if (dense && l < L - 1) memories.push(z.slice(0, memoryWidth));
      if (pairwise && l < L - 1) history.push(z);
      acts.push(z); a = z;
    }
    return { z: a, acts };
  }
  // Legacy -> {arms, bins}. Joint -> {actions, arms}; the six arm values are marginals retained
  // for safe arm ordering, while `actions` scores the actual signed-distance candidates.
  predict(x) {
    const { z } = this.forward(x);
    if (z.length === N_ACTIONS) {
      const actions = softmax(z, 0, N_ACTIONS), arms = new Float64Array(N_ARMS);
      for (let a = 0; a < N_ACTIONS; a++) {
        const { leg, canonDir } = decodeAction(a);
        arms[armIndex(leg, canonDir)] += actions[a];
      }
      return { actions, arms, encoding: JOINT_ENCODING };
    }
    return { arms: softmax(z, 0, N_ARMS), bins: softmax(z, N_ARMS, N_ARMS + N_BINS) };
  }
  // Accumulate this batch's gradients INTO gW/gB and return the weighted cross-entropy SUM.
  // Deliberately additive and un-normalised: the caller owns the buffers and the division, which
  // is what lets train-policy.js's parallel path give each worker its own gradient slot, have
  // every worker accumulate its shard of one batch, then sum the slots and divide once. Split out
  // of trainBatch so the serial and parallel paths run byte-identical math instead of two copies
  // that can drift.
  accumGrads(batch, gW, gB) {
    if (this.sizes[this.sizes.length - 1] === N_ACTIONS)
      throw new Error('joint/dense policy training is PyTorch-only; use torch-train-joint-policy.py');
    let ce = 0;
    for (const { x, arm, bin, w } of batch) {
      const wt = w === undefined ? 1 : w;
      const { z, acts } = this.forward(x);
      const pa = softmax(z, 0, N_ARMS), pb = softmax(z, N_ARMS, N_ARMS + N_BINS);
      ce += wt*(-Math.log(Math.max(pa[arm], 1e-12)) - Math.log(Math.max(pb[bin], 1e-12)));
      // output delta: softmax minus one-hot, per group -- the whole reason CE + softmax pairs up
      let delta = new Float64Array(N_ARMS + N_BINS);
      for (let i = 0; i < N_ARMS; i++) delta[i] = wt*(pa[i] - (i === arm ? 1 : 0));
      for (let i = 0; i < N_BINS; i++) delta[N_ARMS + i] = wt*(pb[i] - (i === bin ? 1 : 0));
      for (let l = this.W.length - 1; l >= 0; l--) {
        const nIn = this.sizes[l], nOut = this.sizes[l+1];
        const aIn = acts[l], W = this.W[l];
        for (let j = 0; j < nOut; j++) {
          gB[l][j] += delta[j];
          for (let i = 0; i < nIn; i++) gW[l][j*nIn + i] += delta[j]*aIn[i];
        }
        if (l > 0) {
          const nd = new Float64Array(nIn);
          for (let i = 0; i < nIn; i++) {
            let s = 0;
            for (let j = 0; j < nOut; j++) s += W[j*nIn + i]*delta[j];
            nd[i] = s*(1 - aIn[i]*aIn[i]);         // hidden layers are tanh, same as net.js
          }
          delta = nd;
        }
      }
    }
    return ce;
  }
  // One Adam step from already-accumulated gradients over `n` samples. Adam state lives here on
  // whichever thread owns the net -- in the parallel path that is the main thread only, so the
  // moment estimates are never split across workers.
  applyAdam(gW, gB, n, lr, opts) {
    const wd = (opts && opts.wd) || 0;
    if (!this._adam) {
      this._adam = { t: 0, mW: this.W.map(w => new Float64Array(w.length)),
                     vW: this.W.map(w => new Float64Array(w.length)),
                     mB: this.b.map(b => new Float64Array(b.length)),
                     vB: this.b.map(b => new Float64Array(b.length)) };
    }
    const A = this._adam, b1 = 0.9, b2 = 0.999, eps = 1e-8;
    A.t++;
    const corr = Math.sqrt(1 - Math.pow(b2, A.t))/(1 - Math.pow(b1, A.t));
    const step = (P, Gd, M, V, decay) => {
      for (let i = 0; i < P.length; i++) {
        const g = Gd[i]/n;
        M[i] = b1*M[i] + (1 - b1)*g;
        V[i] = b2*V[i] + (1 - b2)*g*g;
        P[i] -= lr*corr*M[i]/(Math.sqrt(V[i]) + eps) + (decay ? lr*wd*P[i] : 0);
      }
    };
    for (let l = 0; l < this.W.length; l++) {
      step(this.W[l], gW[l], A.mW[l], A.vW[l], wd > 0);
      step(this.b[l], gB[l], A.mB[l], A.vB[l], false);
    }
  }
  // One Adam step on a minibatch of { x, arm, bin [, w] }; returns mean cross-entropy.
  trainBatch(batch, lr, opts) {
    const gW = this.W.map(w => new Float64Array(w.length));
    const gB = this.b.map(b => new Float64Array(b.length));
    const ce = this.accumGrads(batch, gW, gB);
    this.applyAdam(gW, gB, batch.length, lr, opts);
    return ce/batch.length;
  }
  // Point this net's parameters at an existing (typically Shared) ArrayBuffer instead of its own
  // freshly-allocated ones, laid out as every W matrix in layer order followed by every bias
  // vector. Lets a worker thread run forward/accumGrads against the SAME memory the main thread
  // updates, so a training step costs one barrier rather than a full copy of the weights out and
  // the gradients back. Returns the number of Float64 slots the layout needs, so a caller can size
  // the buffer with paramCount() before allocating.
  static paramCount(sizes) {
    let n = 0;
    for (let l = 0; l < sizes.length - 1; l++) n += sizes[l]*sizes[l+1] + sizes[l+1];
    return n;
  }
  useSharedParams(buffer, byteOffset) {
    let off = (byteOffset || 0)/8;
    this.W = []; this.b = [];
    for (let l = 0; l < this.sizes.length - 1; l++) {
      const n = this.sizes[l]*this.sizes[l+1];
      this.W.push(new Float64Array(buffer, off*8, n)); off += n;
    }
    for (let l = 0; l < this.sizes.length - 1; l++) {
      const n = this.sizes[l+1];
      this.b.push(new Float64Array(buffer, off*8, n)); off += n;
    }
    this._adam = null;   // moment estimates must not survive a parameter-storage swap
    return this;
  }
  toJSON() {
    const j = { policy: true, policyEncoding: this.policyEncoding, sizes: this.sizes,
                W: this.W.map(w => [...w]), b: this.b.map(b => [...b]) };
    if (this.topology) { j.topology = this.topology; j.fanIns = this.fanIns; }
    if (this.topology && this.topology.kind === 'pairwise-memory-v1') {
      j.skipW = this.skipW.map(row => row.map(w => [...w]));
      j.skipB = this.skipB.map(row => row.map(b => [...b]));
    }
    return j;
  }
  static fromJSON(j) {
    const m = new PolicyMLP(j.sizes, j.topology || null, j.fanIns || null, j.policyEncoding || null);
    j.W.forEach((w, l) => m.W[l].set(w));
    j.b.forEach((b, l) => m.b[l].set(b));
    if (j.topology && j.topology.kind === 'pairwise-memory-v1') {
      if (!Array.isArray(j.skipW) || !Array.isArray(j.skipB))
        throw new Error('pairwise policy checkpoint is missing skip weights');
      for (let l = 0; l < m.skipW.length; l++) for (let s = 0; s < m.skipW[l].length; s++) {
        const w = j.skipW[l] && j.skipW[l][s], b = j.skipB[l] && j.skipB[l][s];
        if (!w || w.length !== m.skipW[l][s].length || !b || b.length !== m.skipB[l][s].length)
          throw new Error(`pairwise policy skip ${s}->${l} shape mismatch`);
        m.skipW[l][s].set(w); m.skipB[l][s].set(b);
      }
    }
    return m;
  }
}

module.exports = { PolicyMLP, N_ARMS, N_BINS, CAP_RAD, N_LEGS, SIGNED_BINS, N_ACTIONS,
                   JOINT_ENCODING, armIndex, binIndex, binCenter, actionIndex, decodeAction };
