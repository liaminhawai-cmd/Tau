// Dual-head net: ONE shared tanh trunk feeding two outputs at once -- a value scalar (tanh, same
// convention as net.js's MLP) and N_ARMS+N_BINS policy logits (linear, same convention as
// policy.js's PolicyMLP) -- trained jointly on the GPU in torch-train-dual.py from
// policy-targets.jsonl, which already carries BOTH a value target `z` and a policy target
// `arm`/`bin` for the same position (see policy-targets.js's header for how those are mined).
//
// The payoff this exists to test: a search node that wants a leaf score AND a move prior today
// pays for two full forward passes (net.js's MLP.value() + policy.js's PolicyMLP.predict()) --
// nnai.js's `dual`/`dualPolicy` options and arena.js's `dual:` brain spend one instead. Whether the
// JOINT training objective helps, hurts, or is a wash for either head relative to training them
// separately is an open, measured-not-assumed question -- see torch-train-dual.py's header.
//
// Inference only -- nothing here computes a gradient; training happens on the GPU in
// torch-train-dual.py. This is the exact flat, output-major layout net.js's own header explains
// (torch.nn.Linear.weight is already [out_features, in_features], so .flatten() is lossless).
'use strict';
const { N_ARMS, N_BINS } = require('./policy.js');

function softmax(z, from, to) {
  let mx = -Infinity;
  for (let i = from; i < to; i++) if (z[i] > mx) mx = z[i];
  let s = 0;
  const p = new Float64Array(to - from);
  for (let i = from; i < to; i++) { p[i - from] = Math.exp(z[i] - mx); s += p[i - from]; }
  for (let i = 0; i < p.length; i++) p[i] /= s;
  return p;
}

const OUT = 1 + N_ARMS + N_BINS;   // slot 0 = value, 1..6 = arm logits, 7..22 = bin logits

class DualMLP {
  constructor(sizes) {              // e.g. [94, 96, 96, 23] -- last MUST be 1 + N_ARMS + N_BINS
    if (sizes[sizes.length - 1] !== OUT)
      throw new Error(`dual net output layer must be ${OUT} (1 value + ${N_ARMS} arms + ${N_BINS} bins)`);
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
  }
  // Same per-layer tanh trunk as net.js/policy.js, except the FINAL layer is a SPLIT activation:
  // slot 0 (value) is tanh'd exactly like net.js's output; slots 1..22 (policy logits) stay linear,
  // exactly like policy.js's output -- softmax needs raw logits, tanh would cap the confidence the
  // net can express. One layer, two conventions, because it is one net with two heads.
  forward(x) {
    const acts = [Float64Array.from(x)];
    let a = acts[0];
    const L = this.W.length;
    for (let l = 0; l < L; l++) {
      const nIn = this.sizes[l], nOut = this.sizes[l+1];
      const z = new Float64Array(nOut), W = this.W[l], b = this.b[l];
      const last = l === L - 1;
      for (let j = 0; j < nOut; j++) {
        let s = b[j];
        for (let i = 0; i < nIn; i++) s += W[j*nIn + i]*a[i];
        z[j] = (!last || j === 0) ? Math.tanh(s) : s;
      }
      acts.push(z); a = z;
    }
    return { z: a, acts };
  }
  // Leaf-score-only accessor, so a dual net can stand in anywhere net.js's MLP.value() is called
  // (e.g. nnai.js's default evalFn when no explicit one is given).
  value(x) { return this.forward(x).z[0]; }
  // { value, arms: p(6), bins: p(16) } -- same shape as policy.js's PolicyMLP.predict() for the
  // arms/bins pair, so nnai.js's arm-ordering code treats a dual net as a drop-in policy source
  // (see the `dualPolicy` option there).
  predict(x) {
    const { z } = this.forward(x);
    return { value: z[0], arms: softmax(z, 1, 1 + N_ARMS), bins: softmax(z, 1 + N_ARMS, OUT) };
  }
  toJSON() {
    return { dual: true, sizes: this.sizes, W: this.W.map(w => [...w]), b: this.b.map(b => [...b]) };
  }
  static fromJSON(j) {
    if (!j.dual) throw new Error('not a dual-head net export (missing `dual: true`)');
    const m = new DualMLP(j.sizes);
    j.W.forEach((w, l) => m.W[l].set(w));
    j.b.forEach((b, l) => m.b[l].set(b));
    return m;
  }
}

module.exports = { DualMLP, OUT };
