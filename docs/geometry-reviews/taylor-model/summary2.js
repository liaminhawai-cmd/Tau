// Merge the cover files of one blue arm in results/arm_<pivot>_<m|p>/ and check they tile a range of
// stop angles.   node summary2.js <bluePivot> <blueDir> [from] [to]
'use strict';
const fs = require('fs'), path = require('path');
const [bp, bd] = process.argv.slice(2, 4).map(Number);
const dir = path.join(__dirname, 'results', `arm_${bp}_${bd > 0 ? 'p' : 'm'}`);
const files = fs.readdirSync(dir).filter(f => /^cover_.*_d\d+\.json$/.test(f));
const all = []; const fails = [];
for (const f of files) { const j = JSON.parse(fs.readFileSync(path.join(dir, f))); all.push(...j.leaves); fails.push(...j.fails); }
all.sort((p, q) => p.a - q.a);
const from = process.argv[4] !== undefined ? +process.argv[4] : (all.length ? all[0].a : 0);
const to = process.argv[5] !== undefined ? +process.argv[5] : (all.length ? all[all.length - 1].b : 0);
const leaves = all.filter(l => l.a >= from && l.b <= to);
const gaps = [];
if (!leaves.length || leaves[0].a !== from) gaps.push([from, leaves.length ? leaves[0].a : to]);
for (let i = 1; i < leaves.length; i++) if (leaves[i].a !== leaves[i - 1].b) gaps.push([leaves[i - 1].b, leaves[i].a]);
if (leaves.length && leaves[leaves.length - 1].b !== to) gaps.push([leaves[leaves.length - 1].b, to]);
const ws = leaves.map(l => l.b - l.a);
const modes = leaves.reduce((m, l) => (m[l.mode] = (m[l.mode] || 0) + 1, m), {});
const w = leaves.reduce((m, l) => (l.m < m.m ? l : m), leaves[0]);
console.log(JSON.stringify({
  arm: [bp, bd], range: [from, to], files: files.length, tiled: gaps.length === 0 && fails.length === 0, gaps, failedCells: fails.length,
  cells: leaves.length, widest: Math.max(...ws), narrowest: Math.min(...ws), minMargin: w.m, minMarginCell: [w.a, w.b],
  minHubMove: Math.min(...leaves.map(l => l.hub)), modes, seconds: leaves.reduce((s, l) => s + l.ms / 1000, 0),
}, null, 1));
