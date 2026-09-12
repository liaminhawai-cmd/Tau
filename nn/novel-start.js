'use strict';
// Starting positions for the exploration stream, drawn from where the data ISN'T.
//
// Every training row carries the raw pose (`p`, six numbers) and the mover (`m`). Bucketing those
// into a coarse grid over the board -- hub position to the nearest GRID units, rotation to the
// nearest ROT_BINS-th of a turn, per piece, plus whose turn it is -- gives a cheap density map of
// what the net has already seen. A candidate start is a random legal pose (opening.js's
// randomStartPose); it is kept outright when its cell is empty and otherwise kept with
// probability 1/(1+count), so a game starts in an untouched cell whenever one is found and in a
// thin one when not. The rows those games write land in the same index next time, so the sampler
// keeps moving to whatever is emptiest as coverage fills in.
//
// The index is persisted at data/.position-index.json and updated incrementally: a file whose
// size and mtime match the stored entry is not re-read, so a batch pays for the new files only.
// data/ is gitignored and the status push force-adds specific .jsonl files, so this never travels.
//
//   node nn/novel-start.js [--draw 5]      rebuild/update the index, print stats and a few draws
const fs = require('fs');
const path = require('path');
const { randomStartPose } = require('./opening.js');

const GRID = 8;                       // hub units per cell (the reachable hub disc is ~43 units)
const ROT_BINS = 8;                   // 45-degree rotation buckets
const INDEX_NAME = '.position-index.json';
const TAU = 2*Math.PI;

function cellKey(p, m) {
  const q = v => Math.round(v/GRID);
  const r = v => { let a = v % TAU; if (a < 0) a += TAU; return Math.floor(a/TAU*ROT_BINS) % ROT_BINS; };
  return `${q(p[0])},${q(p[1])},${r(p[2])},${q(p[3])},${q(p[4])},${r(p[5])},${m}`;
}

// Rows are written `"p":[..],"m":N` in that order by every producer (selfplay-legacy, arena
// --saveData, retromine), so a regex lifts the pose without parsing the ~90-float feature vector.
// Anything the regex misses falls back to a real parse; anything without a pose is skipped.
const ROW_RX = /"p":\[([^\]]*)\],"m":([01])/;
function scanFile(file, cells) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch (_) { return 0; }
  let rows = 0, at = 0;
  while (at < txt.length) {
    let nl = txt.indexOf('\n', at); if (nl < 0) nl = txt.length;
    const line = txt.slice(at, nl); at = nl + 1;
    if (!line) continue;
    let p = null, m = null;
    const hit = ROW_RX.exec(line);
    if (hit) { p = hit[1].split(',').map(Number); m = +hit[2]; }
    else if (line.includes('"p":')) {
      try { const j = JSON.parse(line); if (j.p && j.p.length === 6 && (j.m === 0 || j.m === 1)) { p = j.p; m = j.m; } } catch (_) {}
    }
    if (!p || p.length !== 6 || !p.every(Number.isFinite)) continue;
    const k = cellKey(p, m);
    cells.set(k, (cells.get(k) || 0) + 1);
    rows++;
  }
  return rows;
}

function loadIndex(dataDir, { log = () => {} } = {}) {
  const file = path.join(dataDir, INDEX_NAME);
  let st = null;
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  if (!st || st.grid !== GRID || st.rotBins !== ROT_BINS || !st.files || !Array.isArray(st.cells)) st = null;
  let names = [];
  try { names = fs.readdirSync(dataDir).filter(f => f.endsWith('.jsonl')).sort(); } catch (_) {}
  const stats = {};
  for (const f of names) { try { const s = fs.statSync(path.join(dataDir, f)); stats[f] = { size: s.size, mtime: s.mtimeMs }; } catch (_) {} }
  // A file that vanished or shrank means counts in the map that no longer exist on disk; the map
  // has no per-file breakdown to subtract, so that is a rebuild. Growth and new files are additive.
  let rebuild = !st;
  if (st) for (const [f, e] of Object.entries(st.files)) {
    const now = stats[f];
    if (!now || now.size < e.size) { rebuild = true; break; }
  }
  const cells = new Map();
  let rows = 0;
  if (!rebuild) { for (const [k, c] of st.cells) cells.set(k, c); rows = st.rows || 0; }
  const todo = names.filter(f => rebuild || !st.files[f] || st.files[f].size !== stats[f].size || st.files[f].mtime !== stats[f].mtime);
  const t0 = Date.now();
  for (const f of todo) rows += scanFile(path.join(dataDir, f), cells);
  if (todo.length) {
    log(`[novel-start] ${rebuild ? 'built' : 'updated'} the position index: ${todo.length} file(s) read, ` +
        `${rows} rows in ${cells.size} cells (${((Date.now() - t0)/1000).toFixed(0)}s)`);
    const out = { grid: GRID, rotBins: ROT_BINS, updated: new Date().toISOString(), rows, files: stats, cells: [...cells] };
    try {
      const tmp = file + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, file);
    } catch (e) { log(`[novel-start] could not save the index (${e.message}); it will be rebuilt next time`); }
  }
  return { cells, rows };
}

// n starts, each {p, m, seen} where seen is how many stored rows share the cell (0 = untouched).
function drawNovelStarts(eng, index, n, { tries = 48 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let best = null;
    for (let t = 0; t < tries; t++) {
      eng.newGame();
      randomStartPose(eng);
      const ps = eng.getG().pieces, m = Math.random() < 0.5 ? 0 : 1;
      const p = [ps[0].x, ps[0].y, ps[0].rot, ps[1].x, ps[1].y, ps[1].rot].map(v => +v.toFixed(4));
      const seen = index.cells.get(cellKey(p, m)) || 0;
      if (!best || seen < best.seen) best = { p, m, seen };
      if (seen === 0 || Math.random() < 1/(1 + seen)) { best = { p, m, seen }; break; }
    }
    out.push(best);
  }
  return out;
}

module.exports = { GRID, ROT_BINS, INDEX_NAME, cellKey, loadIndex, drawNovelStarts };

if (require.main === module) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
  const dataDir = path.resolve(arg('data', path.join(__dirname, 'data')));
  const index = loadIndex(dataDir, { log: console.log });
  const counts = [...index.cells.values()].sort((a, b) => b - a);
  const top = counts.slice(0, 5), singles = counts.filter(c => c === 1).length;
  console.log(`${index.rows} rows in ${index.cells.size} occupied cells; busiest ${top.join('/')}; ${singles} cells hold one row`);
  const n = Math.max(0, +arg('draw', 5));
  if (n) {
    const eng = require('./engine.js').createEngine();
    const t0 = Date.now();
    const starts = drawNovelStarts(eng, index, n);
    console.log(`${n} draw(s) in ${Date.now() - t0}ms:`);
    for (const s of starts) console.log(`  seen ${s.seen}  mover ${s.m}  ${s.p.join(' ')}`);
  }
}
