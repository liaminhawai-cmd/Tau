'use strict';
// Build a fixed-size training corpus with a CONTROLLED composition of strong-play vs pool games,
// for data-quality ablations ("does training on medalist games beat training on zoo games?").
//
// Every training row already records its provenance: `g` is the game id and `mv` is the face id
// of the mover (e.g. resume-056@D1, L10) -- arena.js and selfplay-legacy.js both stamp it. So a
// game is classified by WHO PLAYED IT, with no schema change and full retroactivity:
//   strong game: a chosen "medalist" model moved in it (--rule any), or both sides were
//                medalists (--rule both -- outcome labels are most reliable there);
//   pool game:   everything else, including rows too old to carry `mv`.
//
// The output is games, never loose rows: the trainer splits train/val by game, so sampling must
// respect game boundaries or the ablation would leak validation games into training.
//
// Fixed-N design: comparing "medalist-only" vs "everything" naively confounds quality with
// volume (the medalist corpus is far smaller). So --share picks the composition and the total is
// capped at what the SCARCER class can support, unless --positions asks for less. Arms built at
// different --share values therefore differ only in composition, not in size.
//
//   node nn/data-slice.js --share 1   --out nn/experiments/x/data-100.jsonl
//   node nn/data-slice.js --share 0.5 --positions 40000 --medalists resume-056,ckpt-159
//
// Medalists default to the current medal holders (nn/medals/medals.json) plus the --top N
// distinct models by pessimistic Elo bound in elo-summary.json -- clean v4 measurements only,
// never the archived pre-reset ratings.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };

const dataGlobDir = path.join(dir, 'data');
const share = Math.max(0, Math.min(1, +arg('share', 1)));
const positionsCap = arg('positions') ? Math.max(1, +arg('positions')) : Infinity;
const rule = arg('rule', 'any') === 'both' ? 'both' : 'any';
const seed = (+arg('seed', 12345)) >>> 0;
const out = arg('out', path.join(dir, 'experiments', `slice-share${share}-${Date.now()}.jsonl`));
const topN = Math.max(0, +arg('top', 6));
const quiet = process.argv.includes('--quiet');

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(items, rnd) { for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } return items; }
const moverModel = mv => { const m = String(mv).match(/^(.*?)(\+P)?@D[1-4]$/); return m ? m[1] : null; }; // L10 etc -> null

function medalistSet() {
  const explicit = String(arg('medalists', '')).split(',').map(s => s.trim()).filter(Boolean);
  if (explicit.length) return new Set(explicit);
  const set = new Set();
  try {
    const med = JSON.parse(fs.readFileSync(require('./machine-id.js').medalsMetaPath(dir), 'utf8'));
    for (const m of Object.values(med.medals || {})) if (m.source) set.add(m.source);
  } catch (e) {}
  // Same ranking publish-medals.js uses: one entry per model at its best pessimistic bound.
  try {
    const sum = JSON.parse(fs.readFileSync(path.join(dir, 'elo-summary.json'), 'utf8'));
    const best = {};
    for (const r of Object.values(sum.players || {})) {
      if (!r || r.kind !== 'nn' || !r.model || !Number.isFinite(+r.eloLo) || (+r.games || 0) < 6) continue;
      const k = path.basename(String(r.model).replace(/\\/g, '/'), '.json');
      if (!best[k] || +r.eloLo > +best[k]) best[k] = +r.eloLo;
    }
    Object.entries(best).sort((a, b) => b[1] - a[1]).slice(0, topN).forEach(([k]) => set.add(k));
  } catch (e) {}
  return set;
}

function main() {
  const medalists = medalistSet();
  if (!medalists.size) { console.error('[slice] no medalists resolved; pass --medalists a,b,c'); process.exitCode = 1; return; }
  if (!quiet) console.log(`[slice] medalists (${rule}): ${[...medalists].sort().join(', ')}`);

  // Group raw LINES by game, per file. Mirrors torch-train-core.py's load_rows filtering: rows
  // without `f` and policy-target rows (arm+bin) are not training data; rows without `g` fall
  // back to the same |z|-drop game-boundary inference so game grouping stays identical.
  const games = new Map();   // key -> {lines:[], movers:Set, hasMv:bool}
  let files = [];
  try { files = fs.readdirSync(dataGlobDir).filter(f => f.endsWith('.jsonl')).sort(); } catch (e) {}
  for (const f of files) {
    let text; try { text = fs.readFileSync(path.join(dataGlobDir, f), 'utf8'); } catch (e) { continue; }
    let inferred = 0, prevAbs = Infinity, cur = null;
    for (const line of text.split('\n')) {
      const s = line.trim(); if (!s) continue;
      let j; try { j = JSON.parse(s); } catch (e) { continue; }
      if (!j.f) continue;
      if (j.arm != null && j.bin != null) continue;
      let g = j.g;
      if (g == null) { const a = Math.abs(+j.z || 0); if (a < prevAbs) cur = `${f}#${++inferred}`; prevAbs = a; g = cur; }
      else prevAbs = Infinity;
      const key = `${f}|${g}`;
      let rec = games.get(key);
      if (!rec) { rec = { lines: [], movers: new Set(), hasMv: false }; games.set(key, rec); }
      rec.lines.push(s);
      if (j.mv != null) { rec.hasMv = true; const m = moverModel(j.mv); if (m) rec.movers.add(m); }
    }
  }

  const strong = [], pool = [];
  for (const rec of games.values()) {
    const named = [...rec.movers];
    const isStrong = rec.hasMv && named.length > 0 &&
      (rule === 'both' ? named.every(m => medalists.has(m)) && named.length >= 2
                       : named.some(m => medalists.has(m)));
    (isStrong ? strong : pool).push(rec);
  }
  const posOf = a => a.reduce((s, r) => s + r.lines.length, 0);
  const strongPos = posOf(strong), poolPos = posOf(pool);
  if (!quiet) console.log(`[slice] corpus: ${strong.length} strong games / ${strongPos} positions; ` +
                          `${pool.length} pool games / ${poolPos} positions`);

  // The scarcer class caps the total so every --share arm can be built at the SAME size.
  const auto = share >= 1 ? strongPos : share <= 0 ? poolPos
             : Math.floor(Math.min(strongPos / share, poolPos / (1 - share)));
  const total = Math.min(auto, positionsCap);
  const wantStrong = Math.round(total * share), wantPool = total - wantStrong;
  if (!total) { console.error('[slice] nothing to select (is the strong corpus empty?)'); process.exitCode = 1; return; }

  const rnd = mulberry32(seed);
  const take = (klass, budget) => {
    const picked = []; let got = 0;
    for (const rec of shuffle(klass.slice(), rnd)) {
      if (got >= budget) break;
      picked.push(rec); got += rec.lines.length;    // whole games only; slight overshoot is fine
    }
    return { picked, got };
  };
  const a = take(strong, wantStrong), b = take(pool, wantPool);
  const all = shuffle([...a.picked, ...b.picked], rnd);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ws = fs.createWriteStream(out);
  let rows = 0;
  for (const rec of all) for (const line of rec.lines) { ws.write(line + '\n'); rows++; }
  ws.end();
  const stats = { out, share, rule, seed, medalists: [...medalists].sort(),
                  corpus: { strongGames: strong.length, strongPos, poolGames: pool.length, poolPos },
                  selected: { strongGames: a.picked.length, strongPos: a.got,
                              poolGames: b.picked.length, poolPos: b.got, rows } };
  fs.writeFileSync(out.replace(/\.jsonl$/i, '') + '.stats.json', JSON.stringify(stats, null, 1));
  console.log(`[slice] wrote ${rows} rows (${a.picked.length} strong + ${b.picked.length} pool games, ` +
              `target share ${share}, actual ${(a.got / Math.max(1, rows)).toFixed(2)}) -> ${out}`);
}
main();
