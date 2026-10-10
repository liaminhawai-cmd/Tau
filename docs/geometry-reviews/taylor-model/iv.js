// Interval arithmetic with outward rounding.
//
// JS floating point gives correctly rounded + - * / and sqrt (IEEE 754, round to nearest), so a
// computed value is within half an ulp of the exact one. dn()/up() move a computed value outward by
// at least one ulp (|x| * 2^-52 is at least one ulp of x), which therefore encloses the exact value.
// Math.sin / Math.cos are not required to be correctly rounded; V8's are fdlibm ports (error under
// one ulp), and they get two outward steps here.
'use strict';
const EPS = 2.220446049250313e-16;   // 2^-52
const TINY = 5e-324;
const dn = x => x - (Math.abs(x) * EPS + TINY);
const up = x => x + (Math.abs(x) * EPS + TINY);

// pi lies strictly between Math.PI and the next double up
const PI_LO = Math.PI, PI_HI = 3.1415926535897936;

const I = (lo, hi = lo) => [lo, hi];
const add = (a, b) => [dn(a[0] + b[0]), up(a[1] + b[1])];
const sub = (a, b) => [dn(a[0] - b[1]), up(a[1] - b[0])];
const neg = a => [-a[1], -a[0]];
function mul(a, b) {
  const p1 = a[0] * b[0], p2 = a[0] * b[1], p3 = a[1] * b[0], p4 = a[1] * b[1];
  return [dn(Math.min(p1, p2, p3, p4)), up(Math.max(p1, p2, p3, p4))];
}
function div(a, b) {
  if (b[0] <= 0 && b[1] >= 0) throw new Error('interval division by an interval containing 0');
  const q1 = a[0] / b[0], q2 = a[0] / b[1], q3 = a[1] / b[0], q4 = a[1] / b[1];
  return [dn(Math.min(q1, q2, q3, q4)), up(Math.max(q1, q2, q3, q4))];
}
function sqrt(a) {
  if (a[1] < 0) throw new Error('sqrt of a negative interval');
  return [a[0] <= 0 ? 0 : Math.max(0, dn(Math.sqrt(a[0]))), up(Math.sqrt(a[1]))];
}
function sqr(a) {
  const l = a[0] * a[0], h = a[1] * a[1];
  if (a[0] >= 0) return [dn(l), up(h)];
  if (a[1] <= 0) return [dn(h), up(l)];
  return [0, up(Math.max(l, h))];
}
const hull = (a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
const mid = a => 0.5 * a[0] + 0.5 * a[1];
const rad = a => up(Math.max(a[1] - mid(a), mid(a) - a[0]));
const mag = a => Math.max(Math.abs(a[0]), Math.abs(a[1]));
const scale = (a, k) => mul(a, [k, k]);

// cos / sin of an interval: endpoint values, widened, plus any extremum the interval might contain.
// k*pi is tested against the interval using both ends of the pi enclosure, so a critical point is
// never missed.
function maybeContainsMultiple(a, step) {
  // does [a0, a1] possibly contain k*step for some integer k (step given as [lo, hi], positive)?
  const kLo = Math.floor(a[0] / step[1]) - 1, kHi = Math.ceil(a[1] / step[0]) + 1;
  for (let k = kLo; k <= kHi; k++) {
    const pLo = k >= 0 ? k * step[0] : k * step[1], pHi = k >= 0 ? k * step[1] : k * step[0];
    if (up(pHi) >= a[0] && dn(pLo) <= a[1]) return k;
  }
  return null;
}
function trigEnds(f, a) {
  const v0 = f(a[0]), v1 = f(a[1]);
  return [dn(dn(Math.min(v0, v1))), up(up(Math.max(v0, v1)))];
}
function cos(a) {
  if (a[1] - a[0] > 3) return [-1, 1];
  let r = trigEnds(Math.cos, a);
  // maxima at 2k*pi, minima at (2k+1)*pi
  const twoPi = [2 * PI_LO, 2 * PI_HI];
  if (maybeContainsMultiple(a, twoPi) !== null) r[1] = 1;
  if (maybeContainsMultiple([a[0] - PI_HI, a[1] - PI_LO], twoPi) !== null) r[0] = -1;
  return [Math.max(-1, r[0]), Math.min(1, r[1])];
}
function sin(a) {
  // sin x = cos(x - pi/2)
  if (a[1] - a[0] > 3) return [-1, 1];
  let r = trigEnds(Math.sin, a);
  const twoPi = [2 * PI_LO, 2 * PI_HI];
  // maxima at pi/2 + 2k pi, minima at -pi/2 + 2k pi
  if (maybeContainsMultiple([a[0] - PI_HI / 2, a[1] - PI_LO / 2], twoPi) !== null) r[1] = 1;
  if (maybeContainsMultiple([a[0] + PI_LO / 2, a[1] + PI_HI / 2], twoPi) !== null) r[0] = -1;
  return [Math.max(-1, r[0]), Math.min(1, r[1])];
}

module.exports = { EPS, dn, up, PI_LO, PI_HI, I, add, sub, neg, mul, div, sqrt, sqr, hull, mid, rad, mag, scale, cos, sin };
