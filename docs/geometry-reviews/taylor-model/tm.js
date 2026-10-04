// Taylor models in one variable t in [-1, 1], with affine noise symbols.
//
// A model stands for the set of functions
//     q(t) = P0(t) + sum_j Pj(t) * e_j + r,     t in [-1,1], e_j in [-1,1], r in [lo, hi]
// P0 and the Pj are polynomials of degree <= N with double coefficients. The guarantee is
// pointwise: for every t the true value equals q(t) for SOME choice of the e_j and r. Every
// operation keeps that guarantee: truncated high-order terms, products of two noise symbols,
// floating-point rounding of every coefficient and every Lagrange remainder are bounded and added
// to [lo, hi] with outward rounding. Noise symbols carry errors whose DIRECTION matters (so a later
// projection can cancel them); the interval part [lo, hi] carries the rest.
'use strict';
const iv = require('./iv.js');
const { dn, up } = iv;
const U = 1.1102230246251565e-16;   // 2^-53: half an ulp, relative

let N = 6;            // polynomial degree in t
let KSUB = 16;        // subintervals for tight range bounds
let symCount = 0;
const setDegree = n => { N = n; };
const newSym = () => ++symCount;

// sum of |coefficients|, rounded up (a bound on |p(t)| for |t| <= 1)
function norm1(p) {
  let s = 0;
  for (let k = 0; k < p.length; k++) s += Math.abs(p[k]);
  return s === 0 ? 0 : up(s * (1 + (p.length + 2) * U));
}

class TM {
  constructor(c, s, lo, hi) {
    this.c = c || new Float64Array(N + 1);
    this.s = s || new Map();
    this.lo = lo || 0; this.hi = hi || 0;
  }
  static const(v) { const m = new TM(); m.c[0] = v; return m; }
  static constI(a) {           // an interval constant [a0, a1]
    const m = new TM(); const md = iv.mid(a); m.c[0] = md;
    m.lo = dn(a[0] - md); m.hi = up(a[1] - md);
    if (m.lo > 0) m.lo = 0; if (m.hi < 0) m.hi = 0;
    return m;
  }
  static linearI(c0, c1) {      // c0 + c1 * t with interval coefficients
    const m = TM.constI(c0); const md = iv.mid(c1); m.c[1] = md;
    const r = iv.rad(c1); m.lo = dn(m.lo - r); m.hi = up(m.hi + r);
    return m;
  }
  clone() {
    const s = new Map(); for (const [k, p] of this.s) s.set(k, Float64Array.from(p));
    return new TM(Float64Array.from(this.c), s, this.lo, this.hi);
  }
  isConst() { if (this.s.size) return false; for (let k = 1; k <= N; k++) if (this.c[k] !== 0) return false; return true; }
  symMag() { let m = 0, n = 0; for (const p of this.s.values()) { m += norm1(p); n++; } return m === 0 ? 0 : up(m * (1 + (n + 2) * U)); }
  // |P0(t) + sum Pj e_j| bound, without the interval part
  polyMag() { return up(norm1(this.c) + this.symMag()); }
  remMag() { return Math.max(Math.abs(this.lo), Math.abs(this.hi)); }
  widen(e) { this.lo = dn(this.lo - e); this.hi = up(this.hi + e); return this; }
  addRem(a) { this.lo = dn(this.lo + a[0]); this.hi = up(this.hi + a[1]); return this; }

  // ---- linear operations ----
  static lin(A, ka, B, kb) {    // ka*A + kb*B, ka and kb exact doubles
    const out = new TM(); let err = 0;
    for (let k = 0; k <= N; k++) { const v = ka * A.c[k] + kb * B.c[k]; out.c[k] = v; err += Math.abs(v) + Math.abs(ka * A.c[k]) + Math.abs(kb * B.c[k]); }
    const keys = new Set([...A.s.keys(), ...B.s.keys()]);
    for (const j of keys) {
      const pa = A.s.get(j), pb = B.s.get(j), p = new Float64Array(N + 1);
      for (let k = 0; k <= N; k++) {
        const a = pa ? ka * pa[k] : 0, b = pb ? kb * pb[k] : 0, v = a + b;
        p[k] = v; err += Math.abs(v) + Math.abs(a) + Math.abs(b);
      }
      out.s.set(j, p);
    }
    // two roundings per coefficient at most (a scaled product, then the sum)
    err = up(err * 2 * U * (1 + 1e-10));
    const ra = iv.scale([A.lo, A.hi], ka), rb = iv.scale([B.lo, B.hi], kb);
    out.lo = dn(ra[0] + rb[0] - err); out.hi = up(ra[1] + rb[1] + err);
    return out;
  }
  add(B) { return TM.lin(this, 1, B, 1); }
  sub(B) { return TM.lin(this, 1, B, -1); }
  neg() { const o = this.clone(); for (let k = 0; k <= N; k++) o.c[k] = -o.c[k]; for (const p of o.s.values()) for (let k = 0; k <= N; k++) p[k] = -p[k]; o.lo = -this.hi; o.hi = -this.lo; return o; }
  scale(k) {
    const out = new TM(); let err = 0;
    for (let i = 0; i <= N; i++) { const v = k * this.c[i]; out.c[i] = v; err += Math.abs(v); }
    for (const [j, p] of this.s) { const q = new Float64Array(N + 1); for (let i = 0; i <= N; i++) { const v = k * p[i]; q[i] = v; err += Math.abs(v); } out.s.set(j, q); }
    err = up(err * 2 * U * (1 + 1e-10));
    const r = iv.scale([this.lo, this.hi], k);
    out.lo = dn(r[0] - err); out.hi = up(r[1] + err);
    return out;
  }
  scaleI(a) {                    // multiply by an interval constant
    const md = iv.mid(a), r = iv.rad(a);
    const o = this.scale(md);
    if (r > 0) o.widen(up(r * up(this.polyMag() + this.remMag())));
    return o;
  }
  addC(v) { const o = this.clone(); const s = o.c[0] + v; const e = up(Math.abs(s) * U); o.c[0] = s; o.widen(e); return o; }
  addI(a) { return this.add(TM.constI(a)); }

  // ---- multiplication ----
  mul(B) {
    const A = this;
    if (B.isConst() && B.lo === 0 && B.hi === 0) return A.scale(B.c[0]);
    if (A.isConst() && A.lo === 0 && A.hi === 0) return B.scale(A.c[0]);
    const out = new TM();
    let bound = 0;      // truncation + rounding, symmetric
    const pm = (a, b, dst) => {
      // dst += a*b truncated to degree N; returns the error bound of this product
      let tr = 0, abs = 0;
      for (let i = 0; i <= N; i++) {
        const ai = a[i]; if (ai === 0) continue;
        for (let j = 0; j <= N; j++) {
          const bj = b[j]; if (bj === 0) continue;
          const v = ai * bj;
          if (i + j <= N) { dst[i + j] += v; abs += Math.abs(v) + Math.abs(dst[i + j]); }
          else tr += Math.abs(v);
        }
      }
      return tr * (1 + 4 * N * U) + abs * 2 * U * (1 + 1e-10);
    };
    bound += pm(A.c, B.c, out.c);
    const keys = new Set([...A.s.keys(), ...B.s.keys()]);
    for (const j of keys) {
      const p = new Float64Array(N + 1);
      const pa = A.s.get(j), pb = B.s.get(j);
      if (pb) bound += pm(A.c, pb, p);
      if (pa) bound += pm(pa, B.c, p);
      out.s.set(j, p);
    }
    // products of two noise symbols
    const sa = A.symMag(), sb = B.symMag();
    bound += sa * sb;
    // the interval parts
    const ma = up(norm1(A.c) + sa), mb = up(norm1(B.c) + sb);
    // A = a + rA, B = b + rB:  AB = ab + a rB + rA b + rA rB
    const rr = iv.add(iv.add(iv.mul([A.lo, A.hi], [-mb, mb]), iv.mul([-ma, ma], [B.lo, B.hi])), iv.mul([A.lo, A.hi], [B.lo, B.hi]));
    bound = up(bound * (1 + 1e-10));
    out.lo = dn(rr[0] - bound); out.hi = up(rr[1] + bound);
    return out;
  }
  sqr() { return this.mul(this); }

  // ---- ranges ----
  // range of P0 over t in [-1, 1], by subdivision and the mean-value form, in interval arithmetic
  polyRange(p) {
    p = p || this.c;
    let deg = N; while (deg > 0 && p[deg] === 0) deg--;
    if (deg === 0) return [p[0], p[0]];
    const dp = new Float64Array(deg);
    for (let k = 1; k <= deg; k++) dp[k - 1] = k * p[k];   // exact for small k (k*p is a double times a small int; rounding handled below)
    const horner = (q, d, x) => {          // interval Horner on [x0, x1]
      let r = [q[d], q[d]];
      for (let k = d - 1; k >= 0; k--) r = iv.add(iv.mul(r, x), [q[k], q[k]]);
      return r;
    };
    // derivative coefficients may have rounded (k * p[k]); widen each by an ulp
    const dpI = Array.from(dp, v => [dn(v), up(v)]);
    const hornerI = (x) => { let r = dpI[deg - 1]; for (let k = deg - 2; k >= 0; k--) r = iv.add(iv.mul(r, x), dpI[k]); return r; };
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < KSUB; i++) {
      const a = -1 + 2 * i / KSUB, b = -1 + 2 * (i + 1) / KSUB, m = 0.5 * (a + b), h = 0.5 * (b - a);
      const pm = horner(p, deg, [m, m]);
      const d = hornerI([a, b]);
      const r = iv.add(pm, iv.mul(d, [-h, h]));
      // the plain Horner enclosure is also valid; take the intersection
      const r2 = horner(p, deg, [a, b]);
      lo = Math.min(lo, Math.max(r[0], r2[0])); hi = Math.max(hi, Math.min(r[1], r2[1]));
    }
    return [lo, hi];
  }
  range() {
    const pr = this.polyRange(), sm = this.symMag();
    return [dn(dn(pr[0] - sm) + this.lo), up(up(pr[1] + sm) + this.hi)];
  }
  rangeCrude() {
    let v = 0; for (let k = 1; k <= N; k++) v += Math.abs(this.c[k]);
    v = up(up(v * (1 + (N + 2) * U)) + this.symMag());
    return [dn(dn(this.c[0] - v) + this.lo), up(up(this.c[0] + v) + this.hi)];
  }
  // value enclosure at a given t (used by the containment checks)
  at(t) {
    const ev = p => { let r = [p[N], p[N]]; for (let k = N - 1; k >= 0; k--) r = iv.add(iv.mul(r, [t, t]), [p[k], p[k]]); return r; };
    let r = ev(this.c);
    for (const p of this.s.values()) { const v = ev(p); const m = iv.mag(v); r = iv.add(r, [-m, m]); }
    return iv.add(r, [this.lo, this.hi]);
  }

  // ---- elementary functions, by Taylor expansion about the constant coefficient ----
  // coef(k) gives the k-th Taylor coefficient (an interval) at x0; lag(X, h) bounds the Lagrange
  // remainder |f^(n+1)(xi)/(n+1)!| * h^(n+1) for xi in X.
  compose(coef, lag, order) {
    const x0 = this.c[0];
    const H = this.clone(); H.c[0] = 0;
    const X = this.range();
    const Hr = [dn(X[0] - x0), up(X[1] - x0)];
    const h = Math.max(Math.abs(Hr[0]), Math.abs(Hr[1]));
    let res = TM.constI(coef(order));
    for (let k = order - 1; k >= 0; k--) res = res.mul(H).add(TM.constI(coef(k)));
    const L = lag(X, h);
    return res.widen(L);
  }
  sqrt(order = N + 2) {
    const X = this.range(); if (X[0] <= 0) throw new Error('sqrt: range not positive ' + X);
    const x0 = this.c[0];
    const cf = [iv.sqrt([x0, x0])];
    for (let k = 1; k <= order; k++) cf.push(iv.div(iv.mul(cf[k - 1], [0.5 - (k - 1), 0.5 - (k - 1)]), iv.mul([k, k], [x0, x0])));
    return this.compose(k => cf[k], (Xr, h) => {
      // |binom(1/2, n+1)| * xi^(1/2-n-1) * h^(n+1), worst at the smallest xi
      let b = [1, 1]; for (let k = 0; k <= order; k++) b = iv.div(iv.mul(b, [Math.abs(0.5 - k), Math.abs(0.5 - k)]), [k + 1, k + 1]);
      const xm = Xr[0];
      const p = iv.mul(iv.sqrt([xm, xm]), [1, 1]);
      let v = iv.div(p, iv.mul([xm, xm], [1, 1]));            // xi^(-1/2)
      for (let k = 1; k <= order; k++) v = iv.div(v, [xm, xm]); // xi^(1/2 - order - 1)
      let hp = [1, 1]; for (let k = 0; k <= order; k++) hp = iv.mul(hp, [h, h]);
      return iv.mul(iv.mul(b, v), hp)[1];
    }, order);
  }
  inv(order = N + 2) {
    const X = this.range(); if (X[0] <= 0 && X[1] >= 0) throw new Error('inv: range contains 0 ' + X);
    const x0 = this.c[0];
    const cf = [iv.div([1, 1], [x0, x0])];
    for (let k = 1; k <= order; k++) cf.push(iv.neg(iv.div(cf[k - 1], [x0, x0])));
    return this.compose(k => cf[k], (Xr, h) => {
      const m = Math.min(Math.abs(Xr[0]), Math.abs(Xr[1]));
      let v = [1, 1]; for (let k = 0; k <= order + 1; k++) v = iv.div(v, [m, m]);
      let hp = [1, 1]; for (let k = 0; k <= order; k++) hp = iv.mul(hp, [h, h]);
      return iv.mul(v, hp)[1];
    }, order);
  }
  div(B) { return this.mul(B.inv()); }
  trig(which, order = N + 2) {   // which: 'cos' or 'sin'
    const x0 = this.c[0];
    const c = iv.cos([x0, x0]), s = iv.sin([x0, x0]);
    // derivatives of cos: cos, -sin, -cos, sin, ...; of sin: sin, cos, -sin, -cos, ...
    const cyc = which === 'cos' ? [c, iv.neg(s), iv.neg(c), s] : [s, c, iv.neg(s), iv.neg(c)];
    const cf = []; let fact = [1, 1];
    for (let k = 0; k <= order; k++) { if (k > 0) fact = iv.mul(fact, [k, k]); cf.push(iv.div(cyc[k % 4], fact)); }
    return this.compose(k => cf[k], (Xr, h) => {
      let f = [1, 1]; for (let k = 1; k <= order + 1; k++) f = iv.mul(f, [k, k]);
      let hp = [1, 1]; for (let k = 0; k <= order; k++) hp = iv.mul(hp, [h, h]);
      return iv.div(hp, f)[1];
    }, order);
  }
  cos() { return this.trig('cos'); }
  sin() { return this.trig('sin'); }
}

module.exports = { TM, setDegree, newSym, norm1, getN: () => N, setKsub: k => { KSUB = k; } };
