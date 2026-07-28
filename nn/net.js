// A small MLP with Adam, in plain JS — no installs, CPU is plenty at this size.
// tanh hidden layers, tanh output (value in [-1, 1]), MSE loss.
'use strict';

class MLP {
  constructor(sizes) {          // e.g. [16, 64, 64, 1]
    this.sizes = sizes;
    this.W = []; this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const fanIn = sizes[l], n = sizes[l+1];
      const w = new Float64Array(fanIn*n);
      const s = Math.sqrt(2/(fanIn + n));         // Xavier
      for (let i = 0; i < w.length; i++) w[i] = (Math.random()*2 - 1)*s*1.7;
      this.W.push(w);
      this.b.push(new Float64Array(n));
    }
    this._adam = null;
  }
  forward(x) {                  // returns { out, acts } (acts kept for backprop)
    const acts = [Float64Array.from(x)];
    let a = acts[0];
    for (let l = 0; l < this.W.length; l++) {
      const nIn = this.sizes[l], nOut = this.sizes[l+1];
      const z = new Float64Array(nOut), W = this.W[l], b = this.b[l];
      for (let j = 0; j < nOut; j++) {
        let s = b[j];
        for (let i = 0; i < nIn; i++) s += W[j*nIn + i]*a[i];
        z[j] = Math.tanh(s);
      }
      acts.push(z); a = z;
    }
    return { out: a[0], acts };
  }
  value(x) { return this.forward(x).out; }
  // One Adam step on a minibatch of { x, y [, w] } pairs; returns (weighted) mean squared error.
  // `w` is an optional per-row loss weight, default 1 -- the caller normalises weights to mean 1
  // over the dataset, so the step size stays comparable whether weighting is on or not.
  // `opts.wd` is DECOUPLED weight decay (the AdamW form: shrink the parameter directly by
  // lr*wd*P, not by adding wd*P to the gradient -- folding it into the gradient makes Adam's
  // per-parameter scaling largely cancel the decay, which is the classic L2-with-Adam mistake).
  // Biases are never decayed, standard practice.
  trainBatch(batch, lr, opts) {
    const wd = (opts && opts.wd) || 0;
    if (!this._adam) {
      this._adam = { t: 0, mW: this.W.map(w => new Float64Array(w.length)),
                     vW: this.W.map(w => new Float64Array(w.length)),
                     mB: this.b.map(b => new Float64Array(b.length)),
                     vB: this.b.map(b => new Float64Array(b.length)) };
    }
    const gW = this.W.map(w => new Float64Array(w.length));
    const gB = this.b.map(b => new Float64Array(b.length));
    let mse = 0;
    for (const { x, y, w } of batch) {
      const wt = w === undefined ? 1 : w;
      const { out, acts } = this.forward(x);
      const err = out - y;
      mse += wt*err*err;
      // backprop: delta at output through tanh' = (1 - a^2); the row weight scales the whole
      // gradient, which is exactly weighting the row's term in the loss
      let delta = new Float64Array([2*wt*err*(1 - out*out)]);
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
            nd[i] = s*(1 - aIn[i]*aIn[i]);
          }
          delta = nd;
        }
      }
    }
    const n = batch.length, A = this._adam, b1 = 0.9, b2 = 0.999, eps = 1e-8;
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
    return mse/n;
  }
  toJSON() {
    return { sizes: this.sizes, W: this.W.map(w => [...w]), b: this.b.map(b => [...b]) };
  }
  static fromJSON(j) {
    const m = new MLP(j.sizes);
    j.W.forEach((w, l) => m.W[l].set(w));
    j.b.forEach((b, l) => m.b[l].set(b));
    return m;
  }
}

module.exports = { MLP };
