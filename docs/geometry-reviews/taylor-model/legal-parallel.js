// legal-red.js on several cores: cut an arm's cells into ranges of about equal cost, run one legal-red.js
// per range, and merge their summaries into results/arm_X/legal.out (the file status.js reads).
//   node legal-parallel.js <bluePivot> <blueDir> [parts=4] [degree=4]
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const [bp, bd] = process.argv.slice(2, 4).map(Number);
const parts = +(process.argv[4] || 4), deg = +(process.argv[5] || 4);
const dir = path.join(__dirname, 'results', `arm_${bp}_${bd > 0 ? 'p' : 'm'}`);
const leaves = [];
for (const f of fs.readdirSync(dir)) if (/^cover_.*_d\d+\.json$/.test(f)) leaves.push(...JSON.parse(fs.readFileSync(path.join(dir, f))).leaves);
leaves.sort((p, q) => p.a - q.a);
const cuts = [leaves[0].a];
for (let k = 1; k < parts; k++) cuts.push(leaves[Math.floor(leaves.length * k / parts)].a);
cuts.push(leaves[leaves.length - 1].b);
const ranges = []; for (let i = 0; i + 1 < cuts.length; i++) if (cuts[i + 1] > cuts[i]) ranges.push([cuts[i], cuts[i + 1]]);
console.log(`arm (${bp},${bd}): ${leaves.length} cells in ${ranges.length} ranges: ${ranges.map(r => `[${r[0]}, ${r[1]}]`).join(' ')}`);
const outs = []; let running = ranges.length;
for (const [a, b] of ranges) {
  const file = path.join(dir, `legal_${a}_${b}.out`); outs.push(file);
  const fd = fs.openSync(file, 'w');
  const ch = spawn('node', [path.join(__dirname, 'legal-red.js'), String(bp), String(bd), String(a), String(b), String(deg)], { stdio: ['ignore', fd, fd] });
  ch.on('exit', () => {
    if (--running) return;
    const sum = { arm: [bp, bd], range: [leaves[0].a, leaves[leaves.length - 1].b], cells: 0, legalCells: 0, notShown: 0, stopped: 0, pivotAtBandEdge: [], crossingKinds: {}, smallestClearanceOfOtherPairs: Infinity, firstBad: [] };
    for (const f of outs) {
      const t = fs.readFileSync(f, 'utf8'); let o;
      try { o = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch (e) { console.log('could not read ' + f); process.exit(1); }
      sum.cells += o.cells; sum.legalCells += o.legalCells; sum.notShown += o.notShown; sum.stopped += o.stopped;
      sum.pivotAtBandEdge.push(...o.pivotAtBandEdge); sum.firstBad.push(...o.firstBad);
      for (const [k, v] of Object.entries(o.crossingKinds)) sum.crossingKinds[k] = (sum.crossingKinds[k] || 0) + v;
      sum.smallestClearanceOfOtherPairs = Math.min(sum.smallestClearanceOfOtherPairs, o.smallestClearanceOfOtherPairs);
    }
    fs.writeFileSync(path.join(dir, 'legal.out'), JSON.stringify(sum, null, 1) + '\n');
    console.log(JSON.stringify({ cells: sum.cells, legalCells: sum.legalCells, notShown: sum.notShown, stopped: sum.stopped, pivotAtBandEdge: sum.pivotAtBandEdge.length, crossingKinds: sum.crossingKinds, clearance: sum.smallestClearanceOfOtherPairs }));
  });
}
