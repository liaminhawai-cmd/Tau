// Re-run every proved cell of one blue arm independently, in the mode that proved it, and confirm its
// bound reproduces exactly; record which program paths each cell used.
//   node audit2.js <bluePivot> <blueDir> [from] [to] [degree]   ->  results/arm_X/audit_<from>_<to>.json
'use strict';
const fs = require('fs'), path = require('path');
const { run2 } = require('./cert2.js');
const { MODES } = require('./modes2.js');
const [bp, bd] = process.argv.slice(2, 4).map(Number);
const dir = path.join(__dirname, 'results', `arm_${bp}_${bd > 0 ? 'p' : 'm'}`);
const leaves = [];
for (const f of fs.readdirSync(dir)) if (/^cover_.*_d\d+\.json$/.test(f)) leaves.push(...JSON.parse(fs.readFileSync(path.join(dir, f))).leaves);
leaves.sort((p, q) => p.a - q.a);
const from = process.argv[4] !== undefined ? +process.argv[4] : leaves[0].a, to = process.argv[5] !== undefined ? +process.argv[5] : leaves[leaves.length - 1].b;
const deg = +(process.argv[6] || 4);
const cells = leaves.filter(l => l.a >= from && l.b <= to);
// a cell is re-run in the model that proved it: the mode's options, and symRem if the cover used it
const optsFor = (mode, sym) => { const m = MODES.find(x => x[0] === mode); return { push: { ...(sym ? { symRem: true } : {}), ...(m ? m[2] : {}) } }; };
const out = []; let mismatches = 0;
const tally = { floor: 0, cap: 0, hubPush: 0, hubHub: 0, relaxed: 0, branched: 0, straddle: 0 };
for (const c of cells) {
  const r = run2(bp, bd, c.a, c.b, deg, optsFor(c.mode, c.sym)), i = r.info;
  const rec = { a: c.a, b: c.b, mode: c.mode, sym: c.sym || 0, margin: r.marginLo, hubMove: r.hubMoveLo, branches: i.maxBranches || 1, regimes: r.regimes, redBranches: r.redBranches,
    floor: i.floorUsed || 0, cap: i.capUsed || 0, hubPushes: i.hubPushes || 0, hubHub: i.hubHubPushes || 0, relaxed: i.relaxed, straddle: i.straddleSplits || 0, aPushes: r.aPushes };
  if (r.marginLo !== c.m) mismatches++;
  for (const [k, key] of [['floor', 'floor'], ['cap', 'cap'], ['hubPush', 'hubPushes'], ['hubHub', 'hubHub'], ['relaxed', 'relaxed'], ['straddle', 'straddle']]) if (rec[key]) tally[k]++;
  if (rec.branches > 1) tally.branched++;
  out.push(rec);
}
fs.writeFileSync(path.join(dir, `audit_${from}_${to}.json`), JSON.stringify(out));
console.log(JSON.stringify({ arm: [bp, bd], cells: cells.length, reproduced: cells.length - mismatches, mismatches,
  cellsUsing: tally, minMargin: Math.min(...out.map(o => o.margin)), minHubMove: Math.min(...out.map(o => o.hubMove)) }, null, 1));
