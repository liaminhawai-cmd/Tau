// Re-run every proved cell in results/ independently, confirm its bound reproduces, and record
// which program paths it used.  node audit.js [from=2] [to=16.5]  ->  results/audit_<from>_<to>.json
'use strict';
const fs = require('fs'), path = require('path');
const { run } = require('./cert.js');
const from = +(process.argv[2] || 2), to = +(process.argv[3] || 16.5);
const dir = path.join(__dirname, 'results');
const leaves = [];
for (const f of fs.readdirSync(dir)) if (/^cover_.*_d\d+\.json$/.test(f)) leaves.push(...JSON.parse(fs.readFileSync(path.join(dir, f))).leaves);
leaves.sort((p, q) => p.a - q.a);
const cells = leaves.filter(l => l.a >= from && l.b <= to);
const { MODES } = require('./modes.js');
const optsFor = mode => { const m = MODES.find(x => x[0] === mode); return m ? { push: m[2] } : {}; };
const out = []; let mismatches = 0;
const tally = { floor: 0, cap: 0, hubPush: 0, relaxed: 0, branched: 0 };
for (const c of cells) {
  const r = run(c.a, c.b, 6, optsFor(c.mode));
  const i = r.info;
  const rec = { a: c.a, b: c.b, mode: c.mode, margin: r.marginLo, hubMove: r.hubMoveLo, branches: i.maxBranches || 1,
    floor: i.floorUsed || 0, cap: i.capUsed || 0, hubPushes: i.hubPushes || 0, relaxed: i.relaxed, firstContact: i.firstContact };
  if (r.marginLo !== c.m) mismatches++;
  if (rec.floor) tally.floor++; if (rec.cap) tally.cap++; if (rec.hubPushes) tally.hubPush++; if (rec.relaxed) tally.relaxed++; if (rec.branches > 1) tally.branched++;
  out.push(rec);
}
fs.writeFileSync(path.join(dir, `audit_${from}_${to}.json`), JSON.stringify(out));
console.log(JSON.stringify({ cells: cells.length, reproduced: cells.length - mismatches, mismatches,
  cellsUsing: { floor: tally.floor, cap: tally.cap, hubPushes: tally.hubPush, relaxation: tally.relaxed, branches: tally.branched },
  minMargin: Math.min(...out.map(o => o.margin)), minHubMove: Math.min(...out.map(o => o.hubMove)) }, null, 1));
