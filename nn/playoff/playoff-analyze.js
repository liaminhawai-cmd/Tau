'use strict';
const fs = require('fs');
const prefix = process.argv[2] || 'playoff-L8';
const rows = [];
for (const f of fs.readdirSync('.').filter(f => f.startsWith(prefix + '-w') && f.endsWith('.jsonl')))
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l) rows.push(JSON.parse(l));
const movers = process.env.MOVERS ? process.env.MOVERS.split(',') : [...new Set(rows.map(r => r.mover))];
const score = r => r.res === 'win' ? 1 : r.res === 'draw' ? 0.5 : 0;
const byId = new Map();
for (const r of rows) { if (!byId.has(r.id)) byId.set(r.id, {}); byId.get(r.id)[r.mover] = r; }
// only positions where every mover has played, so every comparison is on identical positions
const complete = [...byId.values()].filter(o => movers.every(m => o[m]));
console.log(`${rows.length} games, ${byId.size} positions touched, ${complete.length} complete across ${movers.join(', ')}; opponent ${rows[0] && rows[0].opp}`);
const cellOf = { adv: o => o[movers[0]].cell.split('/')[0], dm: o => o[movers[0]].cell.split('/')[1], advdm: o => o[movers[0]].cell,
                 ply: o => o[movers[0]].ply <= 5 ? 'open' : o[movers[0]].ply <= 15 ? 'middle' : 'late' };
const ord = { losing:0, even:1, winning:2, inner:0, mid:1, outer:2, open:0, middle:1, late:2 };
const sortCells = cs => cs.sort((a, b) => (ord[a.split('/')[0]] - ord[b.split('/')[0]]) || (ord[a.split('/')[1]] - ord[b.split('/')[1]]));
function table(dim) {
  const groups = new Map();
  for (const o of complete) { const c = dim === 'all' ? 'all' : cellOf[dim](o); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(o); }
  console.log('\n## by ' + dim);
  console.log('cell'.padEnd(15) + 'n'.padStart(4) + movers.map(m => m.padStart(12)).join('') + '   L11-minus-best@D1  L11-minus-best@D2');
  for (const c of sortCells([...groups.keys()])) {
    const g = groups.get(c);
    const wr = movers.map(m => g.reduce((s, o) => s + score(o[m]), 0) / g.length);
    const d1 = wr[movers.indexOf('L11')] - wr[movers.indexOf('best@D1')], d2 = wr[movers.indexOf('L11')] - wr[movers.indexOf('best@D2')];
    // paired SE: per-position difference
    const diffs1 = g.map(o => score(o['L11']) - score(o['best@D1'])), diffs2 = g.map(o => score(o['L11']) - score(o['best@D2']));
    const se = d => { const m = d.reduce((a, b) => a + b, 0) / d.length; const v = d.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, d.length - 1); return Math.sqrt(v / d.length); };
    console.log(c.padEnd(15) + String(g.length).padStart(4) + wr.map(w => (100 * w).toFixed(0).padStart(11) + '%').join('') +
                `   ${(100 * d1).toFixed(0).padStart(5)} ± ${(200 * se(diffs1)).toFixed(0)}      ${(100 * d2).toFixed(0).padStart(5)} ± ${(200 * se(diffs2)).toFixed(0)}`);
  }
}
for (const d of ['all', 'adv', 'dm', 'ply', 'advdm']) table(d);
// move agreement at the root
const same = (a, b) => a && b && a.pivotIdx === b.pivotIdx && a.dir === b.dir && Math.abs(Math.abs(a.targetRad) - Math.abs(b.targetRad)) < 5 * Math.PI / 180;
const sameArm = (a, b) => a && b && a.pivotIdx === b.pivotIdx && a.dir === b.dir;
console.log('\n## root move agreement (same arm and within 5 degrees / same arm)');
const pairs = [['L11', 'best@D1'], ['L11', 'best@D2'], ['L8', 'L11'], ['best@D1', 'best@D2'], ['L8', 'best@D1']].filter(([a, b]) => movers.includes(a) && movers.includes(b));
for (const dim of ['all', 'adv', 'dm']) {
  const groups = new Map();
  for (const o of complete) { const c = dim === 'all' ? 'all' : cellOf[dim](o); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(o); }
  for (const c of sortCells([...groups.keys()])) {
    const g = groups.get(c);
    console.log(c.padEnd(10) + String(g.length).padStart(4) + '  ' + pairs.map(([a, b]) => `${a}~${b}: ${(100 * g.filter(o => same(o[a].first, o[b].first)).length / g.length).toFixed(0)}%/${(100 * g.filter(o => sameArm(o[a].first, o[b].first)).length / g.length).toFixed(0)}%`).join('   '));
  }
}
// where they disagree, who did better?
console.log('\n## when L11 and best@D1 choose different moves, outcome of each (paired)');
for (const dim of ['all', 'adv', 'dm']) {
  const groups = new Map();
  for (const o of complete) { if (same(o['L11'].first, o['best@D1'].first)) continue; const c = dim === 'all' ? 'all' : cellOf[dim](o); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(o); }
  for (const c of sortCells([...groups.keys()])) {
    const g = groups.get(c);
    const w = m => (100 * g.reduce((s, o) => s + score(o[m]), 0) / g.length).toFixed(0);
    console.log(`${c.padEnd(10)} n=${String(g.length).padStart(3)}  ` + movers.map(m => `${m} ${w(m)}%`).join('  '));
  }
}
