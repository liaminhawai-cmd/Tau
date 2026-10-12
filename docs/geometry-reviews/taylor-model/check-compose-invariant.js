// Checks the invariant that tm.js's sqrt/inv/sin/cos rely on but do not state: when TM.compose expands a
// model about its constant coefficient x0, (1) x0 lies inside the model's range X and (2) the remainder
// interval [lo, hi] contains 0. Then every Lagrange point xi (between x0 and a point of X) lies in X, which is
// the domain the remainder bounds (sqrt: smallest xi = X[0]; inv: smallest |xi|) are taken over. If x0 were
// outside X those bounds would be taken over the wrong domain. TM.const / constI / the arithmetic keep
// lo <= 0 <= hi by construction; this runs real certificate cells with the assertion inside compose and
// counts violations. It is evidence on the cells run, not a proof of the invariant.
//   node check-compose-invariant.js ['[{"bp":..,"bd":..,"a0":..,"a1":..,"problem":"target1"}, ...]']
// Run cert2 cells with an assertion inside TM.compose: the Taylor centre x0 lies in the model's range X,
// and the remainder interval contains 0 (so Lagrange xi, which lies between x0 and points of X, stays in X).
const path = require('path');
const tmPath = path.join(__dirname, 'tm.js');
const T = require(tmPath);
const proto = T.TM.prototype, orig = proto.compose;
const st = { calls: 0, centreOutside: 0, remNoZero: 0, worstGap: 0 };
proto.compose = function (coef, lag, order) {
  st.calls++;
  const X = this.range(), x0 = this.c[0];
  if (!(this.lo <= 0 && this.hi >= 0)) st.remNoZero++;
  if (x0 < X[0] || x0 > X[1]) { st.centreOutside++; st.worstGap = Math.max(st.worstGap, X[0] - x0, x0 - X[1]); }
  return orig.call(this, coef, lag, order);
};
process.chdir(__dirname);
const { run2 } = require(path.join(__dirname, 'cert2.js'));
const DEFAULT_JOBS = JSON.stringify([
  { bp: 2, bd: 1, a0: 3, a1: 3.01 }, { bp: 0, bd: -1, a0: 30, a1: 30.01 },
  { bp: 2, bd: 1, a0: 2.4, a1: 2.41, problem: 'target1' }, { bp: 2, bd: 1, a0: 12, a1: 12.02, problem: 'target1-red2plus' },
  { bp: 1, bd: -1, a0: 25, a1: 25.01, problem: 'target1-b1m-hi' }, { bp: 1, bd: 1, a0: 14, a1: 14.01, problem: 'target1-b1p' },
  { bp: 0, bd: 1, a0: 20, a1: 20.01, problem: 'target1-b0p' }, { bp: 2, bd: -1, a0: 15.24, a1: 15.25, problem: 'target1-b2m-lo' }]);
const jobs = JSON.parse(process.argv[2] || DEFAULT_JOBS);
for (const j of jobs) {
  const r = (() => { try { return run2(j.bp, j.bd, j.a0, j.a1, 4, { push: { symRem: true, vertexDedup: true }, problem: j.problem }); } catch (e) { return { error: e.message.slice(0, 60) }; } })();
  console.log(JSON.stringify({ job: j.problem || 'brief6', arm: [j.bp, j.bd], cell: [j.a0, j.a1], margin: r.marginLo, err: r.error }));
}
console.log(JSON.stringify(st));
if (st.centreOutside || st.remNoZero) { console.error('INVARIANT VIOLATED'); process.exit(1); }
