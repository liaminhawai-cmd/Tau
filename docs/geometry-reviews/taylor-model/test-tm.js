// Randomised soundness test of the Taylor-model operations. A clean-run CI check does not require the historical result corpus; cover/audit/containment generate their own Target1 outputs. For random models (degree-N polynomials in t,
// two noise symbols, an interval remainder), every operation's result is compared with the same operation
// done in plain doubles on sampled members of the inputs: each sampled value must lie inside the result's
// enclosure at that t. This catches a wrong bound, a dropped term or a sign error; it does not prove the
// bounds are valid for every input, which is why the cover's own checks (audit, containment) sit on top.
//   node test-tm.js [cases=300] [samples=200] [degree=4]
'use strict';
const { TM, setDegree, newSym, getN } = require('./tm.js');
const cases = +(process.argv[2] || 300), samples = +(process.argv[3] || 200), deg = +(process.argv[4] || 4);
setDegree(deg);
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const uni = (a, b) => a + (b - a) * rnd();

const S1 = newSym(), S2 = newSym();
// a random model with a constant term in [c0lo, c0hi] and small higher terms
function randomTM(c0lo, c0hi, scale) {
  const N = getN(), m = new TM();
  m.c[0] = uni(c0lo, c0hi);
  for (let k = 1; k <= N; k++) m.c[k] = uni(-1, 1) * scale / (1 + 2 * k);
  for (const s of [S1, S2]) if (rnd() < 0.7) { const p = new Float64Array(N + 1); for (let k = 0; k <= N; k++) p[k] = uni(-1, 1) * scale * 0.3 / (1 + k); m.s.set(s, p); }
  const r = scale * 0.05 * rnd();
  m.lo = -r * rnd(); m.hi = r * rnd();
  return m;
}
// a sample of the model: a value at (t, e1, e2, r), with the symbols and t shared between the inputs of one test
function sampleAt(m, t, e, rr) {
  const ev = p => { let v = 0; for (let k = getN(); k >= 0; k--) v = v * t + p[k]; return v; };
  let v = ev(m.c);
  for (const [s, p] of m.s) v += ev(p) * e[s];
  return v + m.lo + (m.hi - m.lo) * rr;
}

const ops = {
  add: { n: 2, tm: (a, b) => a.add(b), f: (x, y) => x + y },
  sub: { n: 2, tm: (a, b) => a.sub(b), f: (x, y) => x - y },
  mul: { n: 2, tm: (a, b) => a.mul(b), f: (x, y) => x * y },
  mulWide: { n: 2, tm: (a, b) => a.mul(b), f: (x, y) => x * y, scale: 3 },
  sqr: { n: 1, tm: a => a.sqr(), f: x => x * x },
  scale: { n: 1, tm: a => a.scale(-0.7312), f: x => -0.7312 * x },
  addC: { n: 1, tm: a => a.addC(1.37), f: x => x + 1.37 },
  neg: { n: 1, tm: a => a.neg(), f: x => -x },
  sqrt: { n: 1, tm: a => a.sqrt(), f: x => Math.sqrt(x), pos: true },
  inv: { n: 1, tm: a => a.inv(), f: x => 1 / x, pos: true },
  div: { n: 2, tm: (a, b) => a.div(b), f: (x, y) => x / y, posB: true },
  cos: { n: 1, tm: a => a.cos(), f: x => Math.cos(x), scale: 0.5 },
  sin: { n: 1, tm: a => a.sin(), f: x => Math.sin(x), scale: 0.5 },
  cosWide: { n: 1, tm: a => a.cos(), f: x => Math.cos(x), scale: 2, c0: [-3, 3] },
  sqrOfSum: { n: 2, tm: (a, b) => a.sqr().add(b.sqr()).sqrt(), f: (x, y) => Math.sqrt(x * x + y * y), posAny: true },
};

let failed = 0;
for (const [name, op] of Object.entries(ops)) {
  let worst = 0, run = 0, skipped = 0;
  for (let c = 0; c < cases; c++) {
    const sc = (op.scale || 1) * (0.01 + 0.5 * rnd());
    const c0 = op.c0 || (op.pos ? [2, 4] : [-2, 2]);
    const A = randomTM(c0[0], c0[1], sc), B = randomTM(op.posB ? 2 : (op.pos ? 2 : -2), op.posB ? 4 : (op.pos ? 4 : 2), sc);
    let out;
    try { out = op.tm(A, B); } catch (e) { skipped++; continue; }
    run++;
    for (let s = 0; s < samples; s++) {
      const t = uni(-1, 1), e = { [S1]: uni(-1, 1), [S2]: uni(-1, 1) };
      const x = sampleAt(A, t, e, rnd()), y = sampleAt(B, t, e, rnd());
      const v = op.n === 2 ? op.f(x, y) : op.f(x);
      const R = out.at(t);
      const viol = Math.max(R[0] - v, v - R[1], 0) - 8 * 2.2e-16 * Math.max(1, Math.abs(v));
      if (viol > worst) worst = viol;
    }
  }
  const ok = worst <= 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(8)} ${run} models (${skipped} refused), ${run * samples} samples, worst excess ${worst.toExponential(2)}`);
}

// ---- the helpers push-tm.js builds on the operations ----
const P = require('./push-tm.js');
function checkHelper(name, build, fn) {
  let worst = 0, run = 0;
  for (let c = 0; c < cases; c++) {
    const sc = 0.01 + 0.5 * rnd();
    const input = build(sc), out = fn(input);
    run++;
    for (let s = 0; s < samples; s++) {
      const t = uni(-1, 1), e = { [S1]: uni(-1, 1), [S2]: uni(-1, 1) };
      for (const [key, m] of Object.entries(input)) {
        const v = sampleAt(m, t, e, rnd()), R = out[key].at(t);
        const viol = Math.max(R[0] - v, v - R[1], 0) - 8 * 2.2e-16 * Math.max(1, Math.abs(v));
        if (viol > worst) worst = viol;
      }
    }
  }
  const ok = worst <= 0; if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(8)} ${run} states, ${run * samples} samples, worst excess ${worst.toExponential(2)}`);
}
// remToSym: the same set with the remainder moved into a noise symbol
checkHelper('remToSym', sc => ({ v: randomTM(-2, 2, sc) }), i => ({ v: P.remToSym(i.v) }));
// fold: three coordinates re-expressed in three fresh symbols (each coordinate must stay enclosed; the
// joint set is not tested here)
checkHelper('fold', sc => ({ x: randomTM(-30, 30, sc), y: randomTM(-30, 30, sc), rot: randomTM(0, 3, sc * 0.02) }), i => P.fold(i));
checkHelper('foldKeep', sc => ({ x: randomTM(-30, 30, sc), y: randomTM(-30, 30, sc), rot: randomTM(0, 3, sc * 0.02) }), i => P.fold(i, new Set([S1])));

console.log(failed ? `${failed} check(s) FAILED` : 'all checks sound on the sampled cases');
process.exit(failed ? 1 : 0);
