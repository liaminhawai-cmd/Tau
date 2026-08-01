// Print the standing rating pool from its published snapshot (nn/elo-summary.json) rather than
// refitting locally. Point: elo-summary.json rides along on every status push, so any machine
// that has pulled recently has a copy -- but nn/elo-results.json (the raw per-pair store elorank
// refits from) never gets pushed at all, so a worker machine that has never run elorank locally
// has no way to --refit even though a real, current pool exists elsewhere. This is the fallback
// for exactly that machine: same table shape as elorank.js's own report(), just read from the
// artifact instead of recomputed from raw results.
//
//   node nn/showranks.js [--summary nn/elo-summary.json]
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const summaryPath = arg('summary', path.join(__dirname, 'elo-summary.json'));
let summary;
try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); }
catch (e) {
  console.error(`no rating pool snapshot at ${summaryPath} -- run RANK.bat, let the trainer's ` +
                `pool cycle fire, or pull to get whatever the trainer has already published`);
  process.exit(1);
}

const rows = Object.entries(summary.players || {}).map(([id, v]) => ({ id, ...v }));
rows.sort((a, b) => (b.elo || 0) - (a.elo || 0));

// Same bold+underline TTY styling as elorank.js's own live table, for the same reason: the ladder
// rungs are the fixed yardstick inside an ever-growing crowd of nets, and marking them visually
// makes the anchor points readable at a glance instead of just another row.
const tty = process.stdout.isTTY;
const rung = s => tty ? `\x1b[1m\x1b[4m${s}\x1b[0m` : s;

const ageMin = summary.updated ? Math.round((Date.now() - new Date(summary.updated).getTime())/60000) : null;
console.log(`=== rating pool snapshot ` +
            (ageMin === null ? '(age unknown)' : ageMin < 2 ? '(just now)' : `(${ageMin} min old)`) +
            ` -- ${summaryPath} ===`);
console.log('  rating  rank    90% CI          games  brain');
for (const r of rows) {
  const rankCell = r.kind !== 'nn' ? '  -  '
    : r.rank === null || r.rank === undefined ? '    ?'
    : r.rank.toFixed(2).padStart(5);
  const ciCell = r.kind !== 'nn' ? '              '
    : (r.rankLo != null && r.rankHi != null) ? `L${r.rankLo.toFixed(1)} - L${r.rankHi.toFixed(1)}`.padStart(14)
    : '(none)'.padStart(14);
  const label = r.kind === 'ladder' ? `L${r.level}` :
    `${path.basename(r.model || r.id, '.json')} D${r.depth}`;
  const line = `  ${String(Math.round(r.elo || 0)).padStart(6)}  ${rankCell}  ${ciCell}  ` +
               `${String(r.games || 0).padStart(5)}  ${label}`;
  console.log(r.kind === 'ladder' ? rung(line) : line);
}
console.log(`\n(snapshot only -- for a live refit against the raw results, run this on the ` +
            `machine that has nn/elo-results.json, or run --refit there directly)`);
