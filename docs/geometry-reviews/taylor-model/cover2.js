// Adaptive cover of a blue stop-angle interval on any blue arm: a cell that fails is retried in the
// modes of modes2.js and halved if those fail too.
//   node cover2.js <bluePivot> <blueDir> <a0> <a1> [degree] [minWidth]
'use strict';
const fs = require('fs'), path = require('path');
const { run2 } = require('./cert2.js');
const { MODES } = require('./modes2.js');
// An attempt that needs more than this many solver passes is given up on and the cell is split. Accepted
// cells use at most about 3,700 (a failing attempt in a mode that carries up to eight branches can otherwise
// run for many minutes before it gives up, and wide cells fail more often than not). A cell is only accepted
// by a run that finished, so the budget can change which cells a cover picks but never what a picked cell
// proves; audit2 re-runs without it.
const MAX_PASSES = +(process.env.MAXPASSES || 8000);
// The same for the number of Taylor-model operations (linear combinations and products): the passes alone do
// not bound the time, because merging several branches after every pass can cost seconds. Accepted cells need
// at most about 2.8 million (30 seconds); a failing attempt is cut off at 3.5 million.
const MAX_OPS = +(process.env.MAXOPS || 3.5e6);

// base: push options applied to every run of the cover (the plain run and every mode); { symRem: true }
// moves the remainders of push amounts into noise symbols (see remToSym in push-tm.js)
function cover(bp, bd, a0, a1, deg = 6, minW = 1e-5, log, base = {}) {
  const sym = base.symRem ? 1 : 0;
  const leaves = [], fails = [], reasons = {};
  let runs = 0;
  const t0 = Date.now();
  function go(a, b) {
    runs++;
    let r = null, err = null;
    try { r = run2(bp, bd, a, b, deg, { push: base, maxPasses: MAX_PASSES, maxOps: MAX_OPS }); } catch (e) { err = e.message; }
    if (r && r.marginLo > 0) { leaves.push({ a, b, m: r.marginLo, hub: r.hubMoveLo, ms: r.ms, branches: 1, mode: 'plain', sym }); return; }
    for (const [mode, maxW, push] of MODES) {
      if (b - a > maxW) continue;
      let r2 = null;
      try { r2 = run2(bp, bd, a, b, deg, { push: { ...base, ...push }, maxPasses: MAX_PASSES, maxOps: MAX_OPS }); } catch (e) { err = err || e.message; }
      if (r2 && r2.marginLo > 0) { leaves.push({ a, b, m: r2.marginLo, hub: r2.hubMoveLo, ms: r2.ms, branches: r2.info.maxBranches || 1, mode, sym }); return; }
    }
    const why = err ? err.replace(/[-\d.e+,]+/g, '#').slice(0, 80) : 'margin not positive';
    reasons[why] = (reasons[why] || 0) + 1;
    if (b - a <= minW) { fails.push({ a, b, why: err || 'margin ' + (r && r.marginLo) }); return; }
    const m = 0.5 * a + 0.5 * b; go(a, m); go(m, b);
  }
  go(a0, a1);
  return { leaves, fails, reasons, runs, seconds: (Date.now() - t0) / 1000 };
}
module.exports = { cover };

if (require.main === module) {
  const [bp, bd, a0, a1] = process.argv.slice(2, 6).map(Number);
  const deg = +(process.argv[6] || 6), minW = +(process.argv[7] || 1e-5);
  const res = cover(bp, bd, a0, a1, deg, minW, undefined, process.env.SYMREM ? { symRem: true } : {});
  const ws = res.leaves.map(l => l.b - l.a).sort((x, y) => x - y);
  const q = p => ws[Math.min(ws.length - 1, Math.floor(p * ws.length))];
  const modes = res.leaves.reduce((m, l) => (m[l.mode] = (m[l.mode] || 0) + 1, m), {});
  console.log(JSON.stringify({
    arm: [bp, bd], interval: [a0, a1], deg, cells: res.leaves.length, failed: res.fails.length, runs: res.runs, seconds: res.seconds,
    width: { min: ws[0], median: q(0.5), max: ws[ws.length - 1] },
    minMargin: Math.min(...res.leaves.map(l => l.m)), minHubMove: Math.min(...res.leaves.map(l => l.hub)),
    modes, splitReasons: res.reasons, fails: res.fails.slice(0, 5),
  }, null, 1));
  const dir = path.join(__dirname, 'results', `arm_${bp}_${bd > 0 ? 'p' : 'm'}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `cover_${a0}_${a1}_d${deg}.json`), JSON.stringify({ leaves: res.leaves, fails: res.fails }));
}
