// Adaptive cover of a defender interval by Taylor-model cells: a cell that fails is retried with
// separate branches, and halved if that fails too.
//   node cover.js <a0> <a1> [degree] [minWidth]
'use strict';
const { run } = require('./cert.js');
const [a0, a1] = process.argv.slice(2, 4).map(Number);
const deg = +(process.argv[4] || 6), minW = +(process.argv[5] || 1e-5);
const leaves = [], fails = []; const reasons = {};
let tStart = Date.now(), runs = 0;
function cover(a, b) {
  runs++;
  let r = null, err = null;
  try { r = run(a, b, deg, {}); } catch (e) { err = e.message; }
  if (r && r.marginLo > 0) { leaves.push({ a, b, m: r.marginLo, hub: r.hubMoveLo, ms: r.ms, branches: 1 }); return; }
  // retry keeping genuinely different outcomes as separate branches
  let r2 = null;
  try { r2 = run(a, b, deg, { push: { branch: true, branchStraddle: false, tolHull: 1e-7, maxBranches: 8 } }); } catch (e) {}
  if (r2 && r2.marginLo > 0) { leaves.push({ a, b, m: r2.marginLo, hub: r2.hubMoveLo, ms: r2.ms, branches: r2.info.maxBranches || 1 }); return; }
  const why = err ? err.replace(/[-\d.e+,]+/g, '#').slice(0, 70) : 'margin not positive';
  reasons[why] = (reasons[why] || 0) + 1;
  if (b - a <= minW) { fails.push({ a, b, why: err || 'margin ' + (r && r.marginLo) }); return; }
  const m = 0.5 * a + 0.5 * b; cover(a, m); cover(m, b);
}
cover(a0, a1);
const ws = leaves.map(l => l.b - l.a).sort((x, y) => x - y);
const q = p => ws[Math.min(ws.length - 1, Math.floor(p * ws.length))];
console.log(JSON.stringify({
  interval: [a0, a1], deg, cells: leaves.length, failed: fails.length, runs, seconds: (Date.now() - tStart) / 1000,
  width: { min: ws[0], median: q(0.5), max: ws[ws.length - 1] },
  minMargin: Math.min(...leaves.map(l => l.m)), minHubMove: Math.min(...leaves.map(l => l.hub)), branchCells: leaves.filter(l => l.branches > 1).length, maxBranches: Math.max(...leaves.map(l => l.branches)),
  splitReasons: reasons, fails: fails.slice(0, 5),
}, null, 1));
require('fs').writeFileSync(require('path').join(__dirname, 'results', `cover_${a0}_${a1}_d${deg}.json`), JSON.stringify({ leaves, fails }));
