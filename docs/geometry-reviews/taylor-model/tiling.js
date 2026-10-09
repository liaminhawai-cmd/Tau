// Do a problem's accepted cells tile [a0, a1] exactly? Reads every cover_*_d<deg>.json in the problem's
// arm directory, keeps the cells inside [a0, a1], and checks that they start at a0, end at a1 and meet
// end to start with equal binary64 endpoints (no hole, no overlap), and that every margin is positive.
//   PROBLEM=<name> node tiling.js <bluePivot> <blueDir> <a0> <a1>
'use strict';
const fs = require('fs'), path = require('path');
const { fromEnv, armResultsDir } = require('./problem.js');

const [bp, bd, a0, a1] = process.argv.slice(2, 6).map(Number);
const pr = fromEnv(), dir = armResultsDir(pr, bp, bd);
const cells = [];
for (const f of fs.readdirSync(dir)) if (/^cover_.*_d\d+\.json$/.test(f))
  for (const l of JSON.parse(fs.readFileSync(path.join(dir, f))).leaves) cells.push({ ...l, file: f });
const inside = cells.filter(c => c.a >= a0 && c.b <= a1).sort((p, q) => p.a - q.a || p.b - q.b);
const problems = [];
if (!inside.length) problems.push('no cells');
else {
  if (inside[0].a !== a0) problems.push(`starts at ${inside[0].a}, not ${a0}`);
  if (inside[inside.length - 1].b !== a1) problems.push(`ends at ${inside[inside.length - 1].b}, not ${a1}`);
  for (let i = 1; i < inside.length; i++) if (inside[i].a !== inside[i - 1].b)
    problems.push(`${inside[i].a > inside[i - 1].b ? 'hole' : 'overlap'} between ${inside[i - 1].b} and ${inside[i].a}`);
}
const bad = inside.filter(c => !(c.m > 0));
if (bad.length) problems.push(`${bad.length} cells without a positive margin`);
console.log(JSON.stringify({ problem: pr.name, arm: [bp, bd], range: [a0, a1], cells: inside.length,
  tiled: problems.length === 0, problems: problems.slice(0, 10), minMargin: Math.min(...inside.map(c => c.m)),
  minHub: Math.min(...inside.map(c => c.hub)), files: [...new Set(inside.map(c => c.file))] }));
