// The policy head: same 94 canonical input features as the value net (features.js), but instead of
// scoring the position it predicts the MOVE a strong mover plays from it -- two softmax groups over
// one shared tanh trunk:
//   arms:  6 logits, sorted-slot pivot (0..2, outermost first) x canonical direction (see
//          features.moveFrame -- raw foot labels and world directions are exactly the symmetries
//          the input features already quotient away, so outputs must live in the same frame)
//   bins:  N_BINS logits over |swing angle|, uniform up to the 170-degree safety cap
// Factored rather than joint (6+N outputs, not 6*N): the arm choice and how far to swing are
// nearly independent decisions, and 6*N joint cells would spread the same data 6x thinner.
//
// Structurally a sibling of net.js's MLP (same layout, same Adam, same JSON shape) with two
// differences that make it a classifier instead of a regressor: the FINAL layer is linear (softmax
// needs raw logits; tanh would squash them into [-1,1] and cap the confidence the net can express),
// and training minimises cross-entropy, whose output delta is the famously clean softmax(z) - onehot.
'use strict';

const N_BINS = 16;
const CAP_RAD = 170*Math.PI/180;
const N_ARMS = 6;

function armIndex(slot, canonDir) { return slot*2 + (canonDir > 0 ? 0 : 1); }
function binIndex(rad) {
  const a = Math.min(Math.abs(rad), CAP_RAD - 1e-9);
  return Math.floor(a/CAP_RAD*N_BINS);
}
function binCenter(bin) { return (bin + 0.5)*CAP_RAD/N_BINS; }

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
  constructor(sizes) {                 // e.g. [94, 96, 64, 22] -- last MUST be N_ARMS + N_BINS
    if (sizes[sizes.length - 1] !== N_ARMS + N_BINS)
      throw new Error(`policy output layer must be ${N_ARMS + N_BINS} (${N_ARMS} arms + ${N_BINS} bins)`);
    this.sizes = sizes;
    this.W = []; this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const fanIn = sizes[l], n = sizes[l+1];
      const w = new Float64Array(fanIn*n);
      const s = Math.sqrt(2/(fanIn + n));
      for (let i = 0; i < w.length; i++) w[i] = (Math.random()*2 - 1)*s*1.7;
      this.W.push(w);
      this.b.push(new Float64Array(n));
    }
    this._adam = null;
  }
  forward(x) {                         // returns { z (raw logits), acts }
    const acts = [Float64Array.from(x)];
    let a = acts[0];
    const L = this.W.length;
    for (let l = 0; l < L; l++) {
      const nIn = this.sizes[l], nOut = this.sizes[l+1];
      const z = new Float64Array(nOut), W = this.W[l], b = this.b[l];
      for (let j = 0; j < nOut; j++) {
        let s = b[j];
        for (let i = 0; i < nIn; i++) s += W[j*nIn + i]*a[i];
        z[j] = l < L - 1 ? Math.tanh(s) : s;      // linear output layer -- these are logits
      }
      acts.push(z); a = z;
    }
    return { z: a, acts };
  }
  // Move distribution for a position: { arms: p(6), bins: p(N_BINS) }
  predict(x) {
    const { z } = this.forward(x);
    return { arms: softmax(z, 0, N_ARMS), bins: softmax(z, N_ARMS, N_ARMS + N_BINS) };
  }
  // Accumulate this batch's gradients INTO gW/gB and return the weighted cross-entropy SUM.
  // Deliberately additive and un-normalised: the caller owns the buffers and the division, which
  // is what lets train-policy.js's parallel path give each worker its own gradient slot, have
  // every worker accumulate its shard of one batch, then sum the slots and divide once. Split out
  // of trainBatch so the serial and parallel paths run byte-identical math instead of two copies
  // that can drift.
  accumGrads(batch, gW, gB) {
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
    return { policy: true, sizes: this.sizes, W: this.W.map(w => [...w]), b: this.b.map(b => [...b]) };
  }
  static fromJSON(j) {
    const m = new PolicyMLP(j.sizes);
    j.W.forEach((w, l) => m.W[l].set(w));
    j.b.forEach((b, l) => m.b[l].set(b));
    return m;
  }
}

module.exports = { PolicyMLP, N_ARMS, N_BINS, CAP_RAD, armIndex, binIndex, binCenter };
