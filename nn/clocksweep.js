// Read the per-game records arena.js's --resultsJsonl writes and bin them BY THINK TIME.
//
// The whole reason the clock is randomised is that a pooled win rate over mixed budgets is the
// average of a structure, not the structure. Iterative deepening banks only WHOLE plies and one
// more ply costs 4-6x, so a search saving of ~35% (what policy pruning measures) is worth ~1.5x
// effective time: never a ply by itself, but decisive when the clock already sits just short of
// one. Averaged over budgets that lands near 50% whether the effect is "nothing anywhere" or
// "a real win in the ~quarter of budgets where it tips over a boundary" -- two very different
// findings that a single number cannot tell apart. Binning separates them.
//
// Bins are log-spaced for the same reason the draw is log-uniform: boundaries are multiplicative.
//
//   node nn/clocksweep.js nn/data/clocksweep-prune-DESKTOP.jsonl [--bins 6]
'use strict';
const fs = require('fs');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const files = process.argv.slice(2).filter(a => !a.startsWith('--') &&
  !['--bins'].includes(process.argv[process.argv.indexOf(a) - 1]));
if (!files.length) {
  console.error('usage: node nn/clocksweep.js <results.jsonl> [more.jsonl ...] [--bins 6]');
  process.exit(1);
}
const nBins = Math.max(2, +arg('bins', 6));

const games = [];
for (const f of files) {
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); }
  catch (e) { console.error(`could not read ${f}: ${e.message}`); continue; }
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    try {
      const g = JSON.parse(line);
      if (g.timeMs == null) continue;   // a fixed-clock run has nothing to bin
      games.push(g);
    } catch (e) {}
  }
}
if (!games.length) {
  console.error('no games with a per-game clock found (was the run started with --timeMsLo/--timeMsHi?)');
  process.exit(1);
}

const lo = Math.min(...games.map(g => g.timeMs)), hi = Math.max(...games.map(g => g.timeMs));
const lLo = Math.log(lo), lHi = Math.log(hi || 1);
const width = (lHi - lLo) / nBins || 1;
const bins = Array.from({ length: nBins }, () => ({ a: 0, b: 0, d: 0, lo: Infinity, hi: -Infinity }));
for (const g of games) {
  let k = Math.floor((Math.log(g.timeMs) - lLo) / width);
  if (k >= nBins) k = nBins - 1;
  if (k < 0) k = 0;
  const bin = bins[k];
  bin.lo = Math.min(bin.lo, g.timeMs); bin.hi = Math.max(bin.hi, g.timeMs);
  if (g.outcome === 'A') bin.a++; else if (g.outcome === 'B') bin.b++; else bin.d++;
}

const pct = (w, dec) => dec ? (100*w/dec).toFixed(0).padStart(3) : '  -';
// Same 2-sigma convention every other verdict in this project uses, so a bin can be read with the
// same eye as an arena summary -- and so a bin that merely LOOKS like a peak is visibly not one.
const band = dec => dec ? (100*Math.sqrt(0.25/dec)*2).toFixed(0) : '-';

console.log(`${games.length} games across ${files.length} file(s), clock ${lo}-${hi}ms\n`);
console.log('  clock range        A(policy)  B(none)  draws   A win%   2-sigma');
console.log('  ' + '-'.repeat(62));
let totA = 0, totB = 0, totD = 0;
for (const bin of bins) {
  const dec = bin.a + bin.b;
  totA += bin.a; totB += bin.b; totD += bin.d;
  const range = bin.lo === Infinity ? '(empty)' : `${bin.lo}-${bin.hi}ms`;
  console.log(`  ${range.padEnd(18)} ${String(bin.a).padStart(6)} ${String(bin.b).padStart(8)} ` +
              `${String(bin.d).padStart(6)}   ${pct(bin.a, dec)}%   +/- ${band(dec).padStart(3)}`);
}
console.log('  ' + '-'.repeat(62));
const dec = totA + totB;
console.log(`  ${'POOLED'.padEnd(18)} ${String(totA).padStart(6)} ${String(totB).padStart(8)} ` +
            `${String(totD).padStart(6)}   ${pct(totA, dec)}%   +/- ${band(dec).padStart(3)}`);
console.log();
// State the shape of the answer rather than leaving it to the eye: the interesting outcome here is
// "flat near 50 everywhere" vs "one band clearly above", and those look similar in a table.
const usable = bins.filter(b => b.a + b.b >= 8);
if (usable.length < 2) {
  console.log('Not enough games per bin to compare bands yet (want 8+ decided in at least two bins).');
} else {
  const rate = b => b.a/(b.a + b.b);
  const best = usable.reduce((m, b) => rate(b) > rate(m) ? b : m);
  const worst = usable.reduce((m, b) => rate(b) < rate(m) ? b : m);
  const bDec = best.a + best.b, wDec = worst.a + worst.b;
  const bLo = 100*rate(best) - 100*Math.sqrt(0.25/bDec)*2;
  const wHi = 100*rate(worst) + 100*Math.sqrt(0.25/wDec)*2;
  console.log(`Best bin  ${best.lo}-${best.hi}ms: ${(100*rate(best)).toFixed(0)}% on ${bDec} decided`);
  console.log(`Worst bin ${worst.lo}-${worst.hi}ms: ${(100*rate(worst)).toFixed(0)}% on ${wDec} decided`);
  if (bLo > wHi) {
    console.log(`\nThe best bin's 2-sigma floor (${bLo.toFixed(0)}%) clears the worst bin's ceiling ` +
                `(${wHi.toFixed(0)}%) -- the effect genuinely depends on the clock, which is exactly ` +
                `what a single fixed-clock run would have averaged away.`);
  } else {
    console.log(`\nBands still overlap (best floor ${bLo.toFixed(0)}% vs worst ceiling ${wHi.toFixed(0)}%), ` +
                `so this does not yet show a clock-dependent effect -- it is consistent with either ` +
                `a flat null or a real band that needs more games per bin.`);
  }
}
