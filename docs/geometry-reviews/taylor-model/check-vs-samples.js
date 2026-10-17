// Every proved cell bound must sit below what the engine does. For every sampled stop of every arm, find
// the cell that covers it and compare: the engine's margin (blue's worst foot past the rim after red's
// (0,-) reply of 123 substeps, the reply the cells model; six-arms/samples123.js) must be at least the
// cell's proved lower bound. One violation would mean an unsound cell.
// A sampled target beyond the engine's largest executed target B is not played in full: the engine stops at
// the last legal substep, which is the play for that final angle. Those samples are compared with the cell
// that covers the angle blue actually reached.
//   node check-vs-samples.js
'use strict';
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, 'results'), D = path.join(__dirname, 'six-arms', 'data');
const ARMS = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]];
// six-arms/blue-limits.js: the largest target the engine executes in full, per arm
const B = { '0,-1': 63.692659668, '0,1': 44.343482055, '1,-1': 16.826501816, '1,1': 14.788562189, '2,-1': 15.975495885, '2,1': 4.996359600 };
let allViol = 0, allN = 0, allGap = 0, allGapAt = '', allSampled = 0, allBeyond = 0, allBeyondViol = 0, allShort = 0, allMin = Infinity, allTight = Infinity;
for (const [bp, bd] of ARMS) {
  const dir = path.join(R, `arm_${bp}_${bd > 0 ? 'p' : 'm'}`);
  const leaves = [];
  for (const f of fs.readdirSync(dir).filter(f => /^cover_.*_d\d+\.json$/.test(f))) leaves.push(...JSON.parse(fs.readFileSync(path.join(dir, f))).leaves);
  leaves.sort((p, q) => p.a - q.a);
  const rows = fs.readFileSync(path.join(D, `red-0m-123_b${bp}_${bd}.csv`), 'utf8').trim().split('\n').slice(1)
    .map(r => { const v = r.split(',').map(Number); return { a: v[0], reached: v[1], k: v[2], margin: v[3] }; });
  const find = a => {   // binary search for the leaf with a <= alpha <= b
    let lo = 0, hi = leaves.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (a < leaves[m].a) hi = m - 1; else if (a > leaves[m].b) lo = m + 1; else return leaves[m]; }
    return null;
  };
  let n = 0, uncovered = 0, viol = 0, tightest = Infinity, tightA = null, widest = 0, widestA = null, beyond = 0, beyondViol = 0, short = 0, minM = Infinity;
  for (const r of rows) {
    if (r.k !== 123) { short++; console.log(`  arm (${bp},${bd}) target ${r.a}: red stopped after ${r.k} substeps`); continue; }
    minM = Math.min(minM, r.margin);
    if (r.a > B[`${bp},${bd}`]) {
      const c = find(r.reached);
      beyond++;
      if (!(r.reached < B[`${bp},${bd}`]) || !c || r.margin - c.m < -1e-9) { beyondViol++; console.log(`  arm (${bp},${bd}) target ${r.a.toFixed(4)} reached ${r.reached.toFixed(6)}: ${c ? `engine margin ${r.margin.toFixed(4)}, cell bound ${c.m.toFixed(4)}` : 'no cell'}`); }
      continue;
    }
    const cell = find(r.a);
    if (!cell) { uncovered++; continue; }
    n++;
    const slack = r.margin - cell.m;
    if (slack < tightest) { tightest = slack; tightA = r.a; }
    if (slack > widest) { widest = slack; widestA = r.a; }
    if (slack < -1e-9) viol++;
  }
  allViol += viol; allN += n; allSampled += rows.length; allTight = Math.min(allTight, tightest); allBeyond += beyond; allBeyondViol += beyondViol; allShort += short; allMin = Math.min(allMin, minM);
  if (widest > allGap) { allGap = widest; allGapAt = `arm (${bp},${bd > 0 ? '+' : '−'}) at ${widestA.toFixed(2)}°`; }
  console.log(`arm (${bp},${bd > 0 ? '+' : '−'}): ${rows.length} sampled stops, ${n} inside proved cells${uncovered ? ` (${uncovered} not covered)` : ''}, ${viol} below their cell's bound; closest approach ${n ? tightest.toExponential(1) + 'u at ' + tightA.toFixed(3) + '°' : '–'}; bound furthest below the engine: ${n ? widest.toFixed(2) + 'u at ' + widestA.toFixed(2) + '°' : '–'}; ${beyond} targets beyond B compared at the angle reached, ${beyondViol} below; smallest engine margin ${minM.toFixed(4)}u`);
}
console.log(`TOTAL ${allSampled} sampled stops, ${allN} inside proved cells, ${allViol} violations, closest approach ${allTight.toExponential(1)}u; the largest distance between a proved bound and the engine's margin is ${allGap.toFixed(2)}u, ${allGapAt}; ${allBeyond} targets beyond B, compared at the angle reached: ${allBeyondViol} below; ${allShort} replies cut short; smallest engine margin ${allMin.toFixed(4)}u`);
process.exit(allViol || allBeyondViol || allShort ? 1 : 0);
