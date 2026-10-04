// Every proved cell bound must sit below what the engine does. For every sampled stop of every arm, find
// the cell that covers it and compare: the engine's margin (blue's worst foot past the rim after red's
// (0,-) reply) must be at least the cell's proved lower bound. One violation would mean an unsound cell.
//   node check-vs-samples.js
'use strict';
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, 'results'), D = path.join(__dirname, 'six-arms', 'data');
const ARMS = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]];
let allViol = 0, allN = 0;
for (const [bp, bd] of ARMS) {
  const dir = path.join(R, `arm_${bp}_${bd > 0 ? 'p' : 'm'}`);
  let files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^cover_.*_d\d+\.json$/.test(f)).map(f => path.join(dir, f)) : [];
  if (!files.length && bp === 1 && bd < 0) files = fs.readdirSync(R).filter(f => /^cover_.*_d6\.json$/.test(f)).map(f => path.join(R, f));
  const leaves = [];
  for (const f of files) leaves.push(...JSON.parse(fs.readFileSync(f)).leaves);
  leaves.sort((p, q) => p.a - q.a);
  const rows = [];
  for (const name of [`red-0m-0.01deg_b${bp}_${bd}.csv`, `red-0m-ext-0.001deg_b${bp}_${bd}.csv`]) {
    const f = path.join(D, name);
    if (fs.existsSync(f)) for (const r of fs.readFileSync(f, 'utf8').trim().split('\n').slice(1)) { const v = r.split(',').map(Number); rows.push({ a: v[0], margin: v[3] }); }
  }
  let n = 0, uncovered = 0, viol = 0, tightest = Infinity, tightA = null;
  for (const r of rows) {
    // binary search for the leaf with a <= alpha <= b
    let lo = 0, hi = leaves.length - 1, cell = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (r.a < leaves[m].a) hi = m - 1; else if (r.a > leaves[m].b) lo = m + 1; else { cell = leaves[m]; break; } }
    if (!cell) { uncovered++; continue; }
    n++;
    const slack = r.margin - cell.m;
    if (slack < tightest) { tightest = slack; tightA = r.a; }
    if (slack < -1e-9) viol++;
  }
  allViol += viol; allN += n;
  console.log(`arm (${bp},${bd > 0 ? '+' : '−'}): ${rows.length} sampled stops, ${n} inside proved cells${uncovered ? ` (${uncovered} not yet covered)` : ''}, ${viol} below their cell's bound; closest approach ${n ? tightest.toFixed(4) + 'u at ' + tightA.toFixed(3) + '°' : '–'}`);
}
console.log(`TOTAL ${allN} comparisons, ${allViol} violations`);
process.exit(allViol ? 1 : 0);
