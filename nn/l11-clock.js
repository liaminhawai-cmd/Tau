// Measures L11's own per-move think time ON THIS MACHINE, so leL11-vs-L11 comparisons can give
// leL11 a fixed clock matched to what L11 itself actually spends, instead of a number picked by
// eye or borrowed from a different, unrelated machine. L11's own search is unclocked (fixed depth
// 3, maxCands 28), so "L11's think time" isn't written down anywhere -- it has to be measured, and
// it has to be measured HERE, since a laptop and a desktop do not take the same wall-clock time for
// the same fixed-depth search.
//
// Median, not mean: a first pass (6 moves, one machine) found 2.8-4.2s on most moves but 17-18s on
// two of them -- whatever drives that (branch-heavy positions, more candidates surviving pruning,
// something else) is real and worth knowing about, but a mean built from n=6 with two such outliers
// would hand leL11 a budget dominated by rare expensive positions rather than a typical move. The
// median is what "L11's normal think time" actually means in the sentence that motivated this file.
'use strict';
const fs = require('fs');
const { createEngine } = require('./engine.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const targetMoves = +arg('moves', 30);
const outPath = arg('out', null);
const eng = createEngine();
const times = [];

while (times.length < targetMoves) {
  eng.newGame();
  let guard = 0;
  while (!eng.getG().over && times.length < targetMoves && guard++ < 200) {
    const G = eng.getG();
    const t0 = Date.now();
    const plan = eng.ladderPlanFor(10, G.active);   // L11, same call the real ladder rung makes
    times.push(Date.now() - t0);
    if (!plan) break;
    eng.applyPlan(plan);
  }
}

times.sort((a, b) => a - b);
const pct = p => times[Math.min(times.length - 1, Math.floor(p * times.length))];
const median = pct(0.5);
console.log(`L11 think time on this machine, n=${times.length}: ` +
            `min ${times[0]}ms  p25 ${pct(0.25)}ms  median ${median}ms  p75 ${pct(0.75)}ms  max ${times[times.length - 1]}ms`);

if (outPath) fs.writeFileSync(outPath, String(median));
