// Containment check on a spread of proved cells of one arm: for each band of stop angles, the cell with
// the smallest margin, the widest cell, and one cell of every retry mode used in the band. Each cell is
// re-run in the model that proved it and the float engine is replayed at sample angles inside it
// (contain2.js); the engine's blue pose after every red substep must lie inside the model.
//   node contain-sample.js <bluePivot> <blueDir> [bandDeg=8] [samples=7]   ->  results/arm_X/containment.txt
'use strict';
const fs = require('fs'), path = require('path');
const { containment } = require('./contain2.js');
const [bp, bd] = process.argv.slice(2, 4).map(Number);
const band = +(process.argv[4] || 8), ns = +(process.argv[5] || 7);
const dir = path.join(__dirname, 'results', `arm_${bp}_${bd > 0 ? 'p' : 'm'}`);
const leaves = [];
for (const f of fs.readdirSync(dir)) if (/^cover_.*_d\d+\.json$/.test(f)) leaves.push(...JSON.parse(fs.readFileSync(path.join(dir, f))).leaves);
leaves.sort((p, q) => p.a - q.a);
const lo = leaves[0].a, hi = leaves[leaves.length - 1].b;
const picked = new Map();
const pick = (c, why) => { const k = c.a + ':' + c.b; if (!picked.has(k)) picked.set(k, { c, why }); };
for (let b0 = lo; b0 < hi; b0 += band) {
  const cs = leaves.filter(l => l.a >= b0 && l.b <= b0 + band);
  if (!cs.length) continue;
  pick(cs.reduce((m, l) => (l.m < m.m ? l : m)), 'weakest');
  pick(cs.reduce((m, l) => (l.b - l.a > m.b - m.a ? l : m)), 'widest');
  for (const mode of new Set(cs.map(l => l.mode))) pick(cs.find(l => l.mode === mode), mode);
}
const lines = []; let comparisons = 0, outside = 0, stopped = 0;
for (const { c, why } of picked.values()) {
  process.env.SYMREM = c.sym ? '1' : '';
  let line;
  try {
    const r = containment(bp, bd, c.a, c.b, c.mode, ns, +(process.env.DEG || 4));
    comparisons += r.checks; outside += r.fails;
    line = `arm (${bp},${bd}) cell [${c.a}, ${c.b}] ${c.mode}${c.sym ? '+sym' : ''} (${why}): margin >= ${r.margin.toFixed(5)}; ${r.checks} comparisons at ${ns} angles, ${r.fails} outside; worst excess ${r.worst.toExponential(2)}${r.bad.length ? ' | ' + r.bad.join(' ; ') : ''}`;
  } catch (e) { stopped++; line = `arm (${bp},${bd}) cell [${c.a}, ${c.b}] ${c.mode}${c.sym ? '+sym' : ''} (${why}): model stopped: ${e.message.slice(0, 120)}`; }
  lines.push(line); console.log(line);
}
lines.push(`TOTAL: ${picked.size} cells, ${comparisons} comparisons, ${outside} outside, ${stopped} stopped`);
console.log(lines[lines.length - 1]);
fs.writeFileSync(path.join(dir, `containment${process.env.TAG ? '_' + process.env.TAG : ''}.txt`), lines.join('\n') + '\n');
