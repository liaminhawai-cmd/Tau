// Audit one arm on several cores: cut its cells into ranges with about the same number of cells and run
// audit2.js on each at once.   node audit-parallel.js <bluePivot> <blueDir> [parts=4] [degree=4]
// Writes results/arm_X/audit_<from>_<to>.{json,out} per range, as audit2.js does on its own.
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const [bp, bd] = process.argv.slice(2, 4).map(Number);
const parts = +(process.argv[4] || 4), deg = +(process.argv[5] || 4);
const dir = path.join(__dirname, 'results', `arm_${bp}_${bd > 0 ? 'p' : 'm'}`);
const leaves = [];
for (const f of fs.readdirSync(dir)) if (/^cover_.*_d\d+\.json$/.test(f)) leaves.push(...JSON.parse(fs.readFileSync(path.join(dir, f))).leaves);
leaves.sort((p, q) => p.a - q.a);
// a cell with a mode costs more than a plain one; weight by the time the cover recorded for it
const w = leaves.map(l => Math.max(l.ms || 1, 1)), total = w.reduce((s, x) => s + x, 0);
const cuts = [leaves[0].a]; let acc = 0;
for (let i = 0; i < leaves.length && cuts.length < parts; i++) { acc += w[i]; if (acc >= total * cuts.length / parts) cuts.push(leaves[i].b); }
cuts.push(leaves[leaves.length - 1].b);
const ranges = []; for (let i = 0; i + 1 < cuts.length; i++) if (cuts[i + 1] > cuts[i]) ranges.push([cuts[i], cuts[i + 1]]);
console.log(`arm (${bp},${bd}): ${leaves.length} cells in ${ranges.length} ranges: ${ranges.map(r => `[${r[0]}, ${r[1]}]`).join(' ')}`);
let running = ranges.length, bad = 0;
for (const [a, b] of ranges) {
  const out = fs.openSync(path.join(dir, `audit_${a}_${b}.out`), 'w');
  const ch = spawn('node', [path.join(__dirname, 'audit2.js'), String(bp), String(bd), String(a), String(b), String(deg)], { stdio: ['ignore', out, out] });
  ch.on('exit', code => { if (code) bad++; if (--running === 0) { console.log(bad ? `${bad} range(s) failed` : 'all ranges audited'); process.exit(bad ? 1 : 0); } });
}
