'use strict';
// Freeze the corpus the architecture expedition trains and validates on.
//
// torch-train-core keeps the NEWEST files up to a byte budget, and the league writes new self-play
// files continuously, so the file set changes underneath a long run. That matters more than it
// sounds: split_and_weight builds its validation set by shuffling list(by_game.keys()) with the
// seed and taking 10%. The seed pins the RNG, not the LIST -- change which files are read and the
// same seed produces a completely different partition. The expedition's "fixed validation split
// seed 43043" line was therefore promising something it could not deliver.
//
// It showed up exactly as you would expect. peak-bulge-plain read `569 of 1671 files` for eight
// straight chunks and set a new peak on every one of them; the ninth chunk read `579 of 1672` and
// its val MSE jumped 0.00915 the wrong way, more than any single chunk had ever gained. Three
// chunks later patience fired on a shape that had never stopped improving. Across shapes it is
// worse: the split-change swings (0.009 to 0.019) are larger than the gaps between the shapes
// (0.007 to 0.009), so the ranking was reporting which corpus era a shape happened to be measured
// in rather than which architecture is better.
//
// So: copy the current working set once, into a directory the league never writes to, and let
// wild-mint train every shape against that. Same rows, same order, same 10% held out, for every
// chunk of every shape.
//
//   node nn/freeze-arch-data.js [--budgetMB 815] [--force]
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const src = path.join(dir, 'data');
const dst = path.join(dir, 'data-arch-frozen');
const statePath = path.join(dir, 'models', '.wild-mint-state.json');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
// The trainer's own auto budget on this box: min(2048, max(256, RAM_MB / 20)) = 814.5 MB at 15.9 GB.
const budgetMB = Math.max(1, +arg('budgetMB', 815));

if (fs.existsSync(dst) && !force) {
  const man = (() => { try { return JSON.parse(fs.readFileSync(path.join(dst, '.manifest.json'), 'utf8')); } catch (_) { return null; } })();
  console.log(`[freeze] a snapshot already exists at ${path.relative(process.cwd(), dst)}`);
  if (man) console.log(`[freeze] ${man.files} files, ${(man.bytes / (1 << 20)).toFixed(1)} MB, frozen ${man.created}`);
  console.log('[freeze] Leaving it alone -- every shape must sit the SAME paper, so re-freezing');
  console.log('[freeze] mid-expedition would invalidate the shapes already finished.');
  console.log('[freeze] Pass --force only when deliberately starting the comparison over.');
  process.exit(0);
}

// Same selection as cap_files in torch-train-core.py: newest first by (mtime, basename), greedily
// kept while the running total fits, and the newest file is always kept even if it alone is over.
let listed = [];
try {
  listed = fs.readdirSync(src)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => { const p = path.join(src, f); const st = fs.statSync(p); return { name: f, path: p, mtime: st.mtimeMs, size: st.size }; });
} catch (e) { console.error(`[freeze] cannot read ${src}: ${e.message}`); process.exit(1); }
if (!listed.length) { console.error(`[freeze] no .jsonl files in ${src}`); process.exit(1); }

listed.sort((a, b) => (b.mtime - a.mtime) || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
const budgetBytes = Math.round(budgetMB * (1 << 20));
const keep = [];
let kept = 0, dropped = 0;
for (const f of listed) {
  if (!keep.length || kept + f.size <= budgetBytes) { keep.push(f); kept += f.size; }
  else dropped += f.size;
}

console.log(`[freeze] ${listed.length} files in nn/data; keeping the newest ${keep.length} ` +
            `(${(kept / (1 << 20)).toFixed(1)} MB, leaving ${(dropped / (1 << 20)).toFixed(1)} MB of older data out)`);

if (force && fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
let done = 0;
for (const f of keep) {
  fs.copyFileSync(f.path, path.join(dst, f.name));
  if (++done % 50 === 0) process.stdout.write(`\r[freeze] copied ${done}/${keep.length}`);
}
process.stdout.write(`\r[freeze] copied ${done}/${keep.length}\n`);
fs.writeFileSync(path.join(dst, '.manifest.json'), JSON.stringify({
  created: new Date().toISOString(), budgetMB, files: keep.length, bytes: kept,
  names: keep.map(f => f.name),
}, null, 1));

// A new corpus is a new exam, so every peak-* result measured against the old one is void. Clear
// them so the expedition retrains them rather than skipping them as "already complete". The eight
// original wild-* shapes are left alone deliberately: they are not part of this comparison, and
// redoing them would cost ~900 epochs of GPU for numbers nobody is going to read.
try {
  const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const gone = Object.keys(s.shapes || {}).filter(k => k.startsWith('peak-'));
  for (const k of gone) delete s.shapes[k];
  if (gone.length) {
    const t = `${statePath}.tmp-${process.pid}`;
    fs.writeFileSync(t, JSON.stringify(s, null, 2)); fs.renameSync(t, statePath);
    console.log(`[freeze] cleared ${gone.length} peak-* result(s) so they retrain on the frozen corpus:`);
    for (const k of gone) console.log(`  ${k}`);
  } else console.log('[freeze] no peak-* results in the expedition state; nothing to clear');
} catch (_) { console.log('[freeze] no expedition state yet; nothing to clear'); }

console.log(`\n[freeze] done. nn/data-arch-frozen is now the expedition's fixed corpus.`);
console.log(`[freeze] Run ARCH-EXPEDITION.bat and every shape will sit the same paper.`);
