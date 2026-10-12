// Reachability check for the subnormal-underflow defect in tm.js's scale / lin / mul (found by the Copilot
// audit; see results/target1/FINDINGS-AND-TODO.md). Those routines take their rounding-error bound from the
// already-rounded product, so a product of two nonzero coefficients that rounds to zero (below ~1e-323) adds
// no error. This wraps scale, lin and mul, runs real certificate cells, and records the smallest |a*b| over
// every nonzero coefficient product formed, plus how many were below 2^-1022 (the normal range).
// Evidence on the cells run, not a proof over every accepted cell.
//   node check-underflow-reach.js '[{"bp":2,"bd":1,"a0":3,"a1":3.01,"problem":"target1"}, ...]'
// Wrap TM.scale / TM.lin / TM.mul: before each call, find the smallest |a*b| over every coefficient product the
// call will form with both factors nonzero. Flag any below 2^-1022 (subnormal or zero result).
const path = require('path'); const W = __dirname; process.chdir(W);
const { TM } = require(path.join(W, 'tm.js'));
const NORM = 2.2250738585072014e-308;
const st = { scale: 0, lin: 0, mul: 0, flagged: 0, minProd: Infinity, minCoef: Infinity };
const coefs = m => { const out = [...m.c]; for (const p of m.s.values()) out.push(...p); return out; };
const note = (a, b) => { if (a === 0 || b === 0) return; const p = Math.abs(a) * Math.abs(b); if (p < st.minProd) st.minProd = p; if (p < NORM) st.flagged++; };
const track = m => { for (const v of coefs(m)) if (v !== 0 && Math.abs(v) < st.minCoef) st.minCoef = Math.abs(v); };
const oScale = TM.prototype.scale, oMul = TM.prototype.mul, oLin = TM.lin;
TM.prototype.scale = function (k) { st.scale++; for (const v of coefs(this)) note(k, v); track(this); return oScale.call(this, k); };
TM.lin = function (A, ka, B, kb) { st.lin++; for (const v of coefs(A)) note(ka, v); for (const v of coefs(B)) note(kb, v); track(A); track(B); return oLin.call(TM, A, ka, B, kb); };
TM.prototype.mul = function (B) { st.mul++; const a = [...this.c], b = [...B.c];
  for (const x of a) for (const y of b) note(x, y);
  for (const p of B.s.values()) for (const x of a) for (const y of p) note(x, y);
  for (const p of this.s.values()) for (const x of p) for (const y of b) note(x, y);
  track(this); track(B); return oMul.call(this, B); };
const { run2 } = require(path.join(W, 'cert2.js'));
for (const j of JSON.parse(process.argv[2])) {
  let r; try { r = run2(j.bp, j.bd, j.a0, j.a1, 4, { push: { symRem: true, vertexDedup: true, ...(j.mode || {}) }, problem: j.problem }); } catch (e) { r = { error: e.message.slice(0, 50) }; }
  console.log(JSON.stringify({ p: j.problem || 'brief6', arm: [j.bp, j.bd], cell: [j.a0, j.a1], margin: r.marginLo, err: r.error }));
}
console.log(JSON.stringify(st));
