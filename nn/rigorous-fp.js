'use strict';
// Outward-rounded interval arithmetic for the leaf's analytic enclosures.
//
// WHAT THIS IS. Every operation widens both ends by a bound on the distance between the true
// real-arithmetic result and the double the hardware returned:
//   * +, -, *, /, sqrt are correctly rounded by IEEE 754, so the true result sits within one ulp
//     of the returned double, and ulp(x) <= |x| * 2^-52 (denormals covered by the 5e-324 floor).
//     The widening k = |x| * 2^-50 (4 ulp) absorbs both that ulp and the rounding of the widening
//     subtraction itself (whose own error is <= ulp(2|x|) <= |x|*2^-51 = k/2), so
//     dn(x) = x - k <= true <= x + k = up(x) holds by construction.
//   * cos, sin, and any value derived through them (pt(), dnT, upT) additionally carry the AXIOM
//     below.
//
// AXIOM (libm accuracy -- this module's one unproved premise): the platform libm evaluates cos
// and sin to within 4 ulp of the true value. The self-test (this file's main) checks the axiom
// empirically against a double-double reference over hundreds of thousands of angles and reports
// the worst observed error; dnT/upT widen by 8 ulp, twice the axiom, to absorb it with margin.
// Replacing this axiom with a proven correctly-rounded implementation (CRlibm-style) is the last
// step to a machine-verified leaf; the honest claim until then is: outward-rounded arithmetic
// under an explicit, tested libm-accuracy axiom. See docs/geometry-reviews/response-cover-proof-status.md.
//
// WHAT THIS IS NOT. It does not enclose the REPLICA sweep (the engine trajectory stays
// falsification-tested); it encloses the ANALYTIC layers -- exact reply boxes, clearance margins,
// feature walls -- whose real-arithmetic derivations already exist. Intervals are [lo, hi] pairs,
// the same shape as throw-cert.js's.

const W = Math.pow(2, -50);                    // 4 ulp of widening per rounded endpoint
const MINF = 4 * 5e-324;                       // denormal coverage
const wf = x => Math.max(Math.abs(x) * W, MINF);
const dn = x => x - wf(x);                     // correctly-rounded ops: one widening
const up = x => x + wf(x);
const dnT = x => x - 2 * wf(x);               // transcendental-tainted values: two widenings
const upT = x => x + 2 * wf(x);

const exact = x => [x, x];
const pt = x => [dnT(x), upT(x)];              // a double computed through cos/sin -> point interval
const addI = (a, b) => [dn(a[0] + b[0]), up(a[1] + b[1])];
const subI = (a, b) => [dn(a[0] - b[1]), up(a[1] - b[0])];
const mulI = (a, b) => { const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]; return [dn(Math.min(...p)), up(Math.max(...p))]; };
const scaleI = (a, k) => (k >= 0 ? [dn(a[0] * k), up(a[1] * k)] : [dn(a[1] * k), up(a[0] * k)]);
const negI = a => [dn(-a[1]), up(-a[0])];
const sqI = a => (a[0] >= 0 ? [dn(a[0] * a[0]), up(a[1] * a[1])] : a[1] <= 0 ? [dn(a[1] * a[1]), up(a[0] * a[0])] : [dn(0), up(Math.max(a[0] * a[0], a[1] * a[1]))]);
const divPosI = (a, b) => { if (!(b[0] > 0)) throw new Error('divPosI: denominator must be positive'); return [dn(a[0] / b[1]), up(a[1] / b[0])]; };
const divI = (a, b) => { if (b[0] <= 0 && b[1] >= 0) throw new Error('divI: denominator contains 0'); return mulI(a, [dn(1 / b[1]), up(1 / b[0])]); };
const sqrtI = a => { if (a[0] < 0) throw new Error('sqrtI of a negative interval'); return (a[0] === 0 && a[1] === 0) ? [0, 0] : [a[0] <= 0 ? 0 : dn(Math.sqrt(a[0])), up(Math.sqrt(a[1]))]; };
const hull = (a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
const isect = (a, b) => [Math.max(a[0], b[0]), Math.min(a[1], b[1])];
const wid = a => a[1] - a[0];
const max0 = a => [Math.max(0, a[0]), Math.max(0, a[1])];
// cos over an angle interval: endpoint evaluations (two widenings each) plus the exact +-1 at any
// full turn inside the interval -- the extremal values 1 and -1 are attained exactly, so they
// carry no error. Mirrors throw-cert.js's cosRange construction.
function cosI(a) {
  const lo = a[0], hi = a[1], c0 = pt(Math.cos(lo)), c1 = pt(Math.cos(hi));
  let mn = Math.min(c0[0], c1[0]), mx = Math.max(c0[1], c1[1]);
  for (let k = Math.ceil(lo / (2 * Math.PI)); 2 * Math.PI * k <= hi; k++) mx = Math.max(mx, 1);
  for (let k = Math.ceil((lo - Math.PI) / (2 * Math.PI)); Math.PI + 2 * Math.PI * k <= hi; k++) mn = Math.min(mn, -1);
  return [mn, mx];
}
function sinI(a) { return cosI([a[0] - Math.PI / 2, a[1] - Math.PI / 2]); }

// ---- double-double reference arithmetic (about 106 bits), for the self-test ----
function twoSum(a, b) { const s = a + b, bb = s - a; return [s, (a - (s - bb)) + (b - bb)]; }
const SPLITTER = 134217729; // 2^27 + 1
function splitV(x) { const t = SPLITTER * x, hi = t - (t - x); return [hi, x - hi]; }
function twoProd(a, b) { const p = a * b, ah = splitV(a)[0], al = splitV(a)[1], bh = splitV(b)[0], bl = splitV(b)[1]; return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl]; }
function norm2(p) { return twoSum(p[0], p[1]); }
function ddAdd(A, B) { const s1 = twoSum(A[0], B[0]), s2 = twoSum(A[1], B[1]), s3 = twoSum(s1[1], s2[0]), h = twoSum(s1[0], s3[0]); return norm2([h[0], h[1] + s2[1] + s3[1]]); }
function ddNeg(A) { return [-A[0], -A[1]]; }
function ddMul(A, B) { const p = twoProd(A[0], B[0]); return norm2([p[0], p[1] + A[0] * B[1] + A[1] * B[0]]); }
function ddScale(A, k) { return norm2([A[0] * k, A[1] * k]); }
function ddDiv(A, B) { const q1 = A[0] / B[0]; const r = ddAdd(A, ddNeg(ddMul([q1, 0], B))); return norm2([q1, r[0] / B[0]]); }
function ddSqrt(A) { if (!(A[0] > 0)) return [0, 0]; let y = [Math.sqrt(A[0]), 0];
  for (let i = 0; i < 2; i++) y = ddScale(ddAdd(y, ddDiv(A, y)), 0.5);
  return y; }
// pi to 106 bits: hi = Math.PI, lo = the true remainder pi - Math.PI
const PI_DD = [Math.PI, 1.2246467991473531772e-16];
// reduce x to r in [-pi/4, pi/4] and the octant k with x = k*(pi/2) + r
function ddModPi2(x) {
  const half = ddScale(PI_DD, 0.5);
  const q = ddDiv(x, half);
  const k = Math.round(q[0]);
  return { k: ((k % 4) + 4) % 4, r: ddAdd(x, ddNeg(ddMul(half, [k, 0]))) };
}
// Taylor in dd for |r| <= pi/4 + eps; 15 terms put the truncation error far below 1e-30. The
// reference's own accuracy is ~1-2 ulp (inexact scale factors), which the report acknowledges.
function ddSinSmall(r) { let term = r, sum = r; const r2 = ddMul(r, r);
  for (let n = 1; n <= 15; n++) { term = ddScale(ddMul(term, r2), -1 / ((2 * n) * (2 * n + 1))); sum = ddAdd(sum, term); if (Math.abs(term[0]) < 1e-40) break; }
  return sum; }
function ddCosSmall(r) { let term = [1, 0], sum = [1, 0]; const r2 = ddMul(r, r);
  for (let n = 1; n <= 15; n++) { term = ddScale(ddMul(term, r2), -1 / ((2 * n - 1) * (2 * n))); sum = ddAdd(sum, term); if (Math.abs(term[0]) < 1e-40) break; }
  return sum; }
function ddSin(x) { const m = ddModPi2(x), s = ddSinSmall(m.r), c = ddCosSmall(m.r);
  return m.k === 0 ? s : m.k === 1 ? c : m.k === 2 ? ddNeg(s) : ddNeg(c); }
function ddCos(x) { const m = ddModPi2(x), s = ddSinSmall(m.r), c = ddCosSmall(m.r);
  return m.k === 0 ? c : m.k === 1 ? ddNeg(s) : m.k === 2 ? ddNeg(c) : s; }

// The self-test: (1) CONTAINMENT -- every interval operation must contain the double-double
// reference value of the true operation on the same inputs (degenerate and sampled interior
// cases); (2) the AXIOM check -- Math.sin/Math.cos must stay within 4 ulp of the dd reference,
// which is the premise dnT/upT's 8-ulp widening exists to absorb.
function selfTest(n) {
  n = n || 200000; let fails = 0, worstSin = 0, worstCos = 0;
  const ulpOf = v => Math.max(Math.abs(v) * Math.pow(2, -52), 5e-324);
  const ok = (iv, ddv) => { const v = ddv[0] + ddv[1]; return v >= iv[0] && v <= iv[1]; };
  for (let i = 0; i < n; i++) {
    const a = (Math.random() * 2 - 1) * 4, b = (Math.random() * 2 - 1) * 4;
    if (!ok(addI(exact(a), exact(b)), ddAdd([a, 0], [b, 0]))) fails++;
    if (!ok(subI(exact(a), exact(b)), ddAdd([a, 0], ddNeg([b, 0])))) fails++;
    if (!ok(mulI(exact(a), exact(b)), ddMul([a, 0], [b, 0]))) fails++;
    if (Math.abs(b) > 1e-3 && !ok(divI(exact(a), exact(b)), ddDiv([a, 0], [b, 0]))) fails++;
    if (a !== 0 && !ok(sqrtI(exact(Math.abs(a))), ddSqrt([Math.abs(a), 0]))) fails++;
    // non-degenerate intervals: sampled interior points must stay contained
    const A = [Math.min(a, a + 0.3), Math.max(a, a + 0.3)], B = [Math.min(b, b + 0.2), Math.max(b, b + 0.2)];
    const iv = mulI(A, B);
    for (let t = 0; t < 2; t++) {
      const u = A[0] + Math.random() * (A[1] - A[0]), v = B[0] + Math.random() * (B[1] - B[0]);
      if (!ok(iv, ddMul([u, 0], [v, 0]))) fails++;
    }
    // cosI over an angle interval: every sampled interior angle's true cos contained
    const th0 = (Math.random() * 2 - 1) * 3, th1 = th0 + Math.random() * 2;
    const civ = cosI([th0, th1]);
    for (let t = 0; t < 3; t++) {
      const th = th0 + Math.random() * (th1 - th0), ddv = ddCos([th, 0]);
      if (ddv[0] + ddv[1] < civ[0] || ddv[0] + ddv[1] > civ[1]) fails++;
    }
    // the AXIOM: Math.sin/cos vs the dd reference, in ulp of the result
    const x = (Math.random() * 2 - 1) * 4;
    const vs = ddSin([x, 0]), vc = ddCos([x, 0]), ts = Math.sin(x), tc = Math.cos(x);
    if (!ok(pt(ts), [vs[0] + vs[1], 0])) fails++;
    if (!ok(pt(tc), [vc[0] + vc[1], 0])) fails++;
    worstSin = Math.max(worstSin, Math.abs(ts - (vs[0] + vs[1])) / ulpOf(vs[0] || ts));
    worstCos = Math.max(worstCos, Math.abs(tc - (vc[0] + vc[1])) / ulpOf(vc[0] || tc));
  }
  return { n, fails, worstSin, worstCos };
}

if (require.main === module) {
  const t0 = Date.now();
  const r = selfTest(+(process.argv[2] || 200000));
  console.log(`rigorous-fp self-test: ${r.n} cases, ${r.fails} containment failures`);
  console.log(`  Math.sin worst error ${r.worstSin.toFixed(2)} ulp, Math.cos ${r.worstCos.toFixed(2)} ulp vs the dd reference (reference itself good to ~1-2 ulp; the axiom assumes <= 4, dnT/upT widen by 8)`);
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  const pass = r.fails === 0 && r.worstSin <= 4.5 && r.worstCos <= 4.5;
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
}
module.exports = { W, wf, dn, up, dnT, upT, exact, pt, addI, subI, mulI, scaleI, negI, sqI, divI, divPosI, sqrtI, hull, isect, wid, max0, cosI, sinI, selfTest };