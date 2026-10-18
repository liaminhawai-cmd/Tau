// Merge the band covers in results/ and check they tile a whole range of defender angles.
//   node summary.js [from=2] [to=16.5]
'use strict';
const fs = require('fs'), path = require('path');
const from = +(process.argv[2] || 2), to = +(process.argv[3] || 16.5);
const dir = path.join(__dirname, 'results');
const bands = [];
for (const f of fs.readdirSync(dir)) {
  const m = f.match(/^cover_([\d.]+)_([\d.]+)_d(\d+)\.json$/);
  if (!m) continue;
  const { leaves, fails } = JSON.parse(fs.readFileSync(path.join(dir, f)));
  bands.push({ a: +m[1], b: +m[2], deg: +m[3], leaves, fails });
}
bands.sort((p, q) => p.a - q.a);
const leaves = bands.flatMap(b => b.leaves).filter(l => l.a >= from && l.b <= to).sort((p, q) => p.a - q.a);
const fails = bands.flatMap(b => b.fails);
let gaps = [];
if (!leaves.length || leaves[0].a !== from) gaps.push([from, leaves.length ? leaves[0].a : to]);
for (let i = 1; i < leaves.length; i++) if (leaves[i].a !== leaves[i - 1].b) gaps.push([leaves[i - 1].b, leaves[i].a]);
if (leaves.length && leaves[leaves.length - 1].b !== to) gaps.push([leaves[leaves.length - 1].b, to]);
const ws = leaves.map(l => l.b - l.a);
const row = (name, L, F) => ({
  range: name, cells: L.length, failed: F.length,
  widest: Math.max(...L.map(l => l.b - l.a)), minMargin: Math.min(...L.map(l => l.m)),
  minHubMove: Math.min(...L.map(l => l.hub)), branchCells: L.filter(l => l.branches > 1).length,
});
console.log(JSON.stringify({
  range: [from, to], tiled: gaps.length === 0 && fails.length === 0, gaps, failedCells: fails,
  total: row(`${from}-${to}`, leaves, fails),
  bands: bands.map(b => row(`${b.a}-${b.b}`, b.leaves, b.fails)),
  narrowest: Math.min(...ws),
  minMarginCell: leaves.reduce((m, l) => (l.m < m.m ? l : m), leaves[0]),
}, null, 1));
