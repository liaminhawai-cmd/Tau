// What is train.js actually eating? Answers "why did my row count jump" without guessing.
//   node nn/datacheck.js [--data "nn/data/*.jsonl"]
// Uses the SAME file-matching rule as train.js loadData (anchored regex, so iterNNN.jsonl.wN
// shards are excluded) -- if this script and train.js disagree on which files count, that
// difference is itself the bug, so the matching logic is deliberately copied rather than shared.
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const pattern = arg('data', path.join(__dirname, 'data', '*.jsonl'));
const dir = path.dirname(pattern), base = path.basename(pattern);
const rx = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

const files = fs.readdirSync(dir).filter(f => rx.test(f)).sort();
const skipped = fs.readdirSync(dir).filter(f => !rx.test(f));

// A duplicated CORPUS is the thing worth catching: the same position rows present twice under
// different filenames silently double-weights those games in training. Hash whole lines rather
// than comparing files byte-for-byte, so a partial overlap (a file copied then appended to) still
// shows up instead of reading as two unrelated files.
const seen = new Map();          // line hash -> first file that had it
const dupPairs = new Map();      // "fileA -> fileB" -> count of shared rows
let total = 0, tagged = 0, stale = 0;
const perFile = [];

function hash(s) {               // FNV-1a, plenty for dup detection and no crypto import needed
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

for (const f of files) {
  let rows = 0, tag = 0, bad = 0, dupsHere = 0;
  const games = new Set();
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!line) continue;
    rows++;
    let j;
    try { j = JSON.parse(line); } catch (e) { bad++; continue; }
    if (j.g != null) { tag++; games.add(j.g); }
    const h = hash(line);
    if (seen.has(h)) {
      dupsHere++;
      const key = seen.get(h) + '  ->  ' + f;
      dupPairs.set(key, (dupPairs.get(key) || 0) + 1);
    } else seen.set(h, f);
  }
  total += rows; tagged += tag; stale += bad;
  perFile.push({ f, rows, tag, games: games.size, dupsHere });
}

console.log(`pattern: ${pattern}`);
console.log(`${files.length} file(s) matched, ${skipped.length} ignored (shards/other)\n`);
console.log('file'.padEnd(34) + 'rows'.padStart(9) + 'tagged'.padStart(9) + 'games'.padStart(8) + 'dup-rows'.padStart(10));
for (const r of perFile)
  console.log(r.f.padEnd(34) + String(r.rows).padStart(9) + String(r.tag).padStart(9) +
              String(r.games).padStart(8) + (r.dupsHere ? String(r.dupsHere) : '-').padStart(10));

const uniq = seen.size;
console.log('\n' + `total rows: ${total}   unique rows: ${uniq}   duplicated: ${total - uniq}` +
            (total ? `  (${(100*(total - uniq)/total).toFixed(1)}%)` : ''));
console.log(`game-tagged: ${tagged}   unparseable: ${stale}`);

if (dupPairs.size) {
  console.log('\nduplicate row overlap between files (biggest first):');
  [...dupPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .forEach(([k, n]) => console.log('  ' + String(n).padStart(8) + '   ' + k));
  console.log('\nDuplicated rows are trained on twice, which quietly double-weights those games.');
} else {
  console.log('\nNo duplicate rows across files -- the corpus is clean.');
}
