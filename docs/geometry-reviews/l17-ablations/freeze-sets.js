'use strict';
// Opus task A, step 5: freeze a development set and a held-out set, grouped by source game rather
// than by row, so that nearby variants of one position cannot straddle the split.
//
// Run: node freeze-sets.js /path/to/a/checkout/with/the/corpora [--dev 0.3] [--out dir]
//
// Grouping. A corpus row's `g` is a position id, not a game id: `<game>-j<job>-<a>-<b>` for the
// retro-ratchet miner and `<game>-<ply>` for the older short ids. Rows from one game are the same
// trajectory a few plies apart, so they are near-duplicates for any test of stop coverage. The
// family key strips the position part and keeps the game.
//
// The split is by family and is deterministic: families are hashed with a fixed salt and assigned
// by hash, so the same corpora always produce the same split and no family is ever divided. The
// family holding the published 2-degree witness is forced into development, as the task requires.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const SALT = 'tau-l13-l17-stop-audit-2026-09-21';
const WITNESS_GAME = 'retro-ratchet-20260918073412-de8-w1';   // docs/geometry-reviews/l11-stop-audit
const SOURCES = [
  { file: 'docs/dead-regions/screened-not-dead.jsonl', role: 'not-certified-dead (escape / unresolved)' },
  { file: 'docs/dead-regions/dead-points-mined.jsonl', role: 'certified dead points' },
];

function familyOf(g) {
  if (!g) return '(no id)';
  let m = /^(.*)-j\d+-\d+-\d+$/.exec(g); if (m) return m[1];
  m = /^(.*)-\d+$/.exec(g);              if (m) return m[1];
  return g;
}
const bucket = fam => parseInt(crypto.createHash('sha256').update(SALT + '\0' + fam).digest('hex').slice(0, 8), 16) / 0x100000000;

function main() {
  const root = path.resolve(process.argv[2] || process.cwd());
  const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const devFrac = +argOf('--dev', 0.3);
  const outDir = path.resolve(argOf('--out', path.dirname(process.argv[1])));

  const families = new Map();   // family -> { rows, bySource }
  const manifest = { salt: SALT, devFraction: devFrac, witnessFamily: WITNESS_GAME, sources: [] };
  for (const s of SOURCES) {
    const p = path.join(root, s.file);
    const text = fs.readFileSync(p, 'utf8');
    let n = 0;
    for (const line of text.split('\n')) {
      if (line[0] !== '{') continue;
      const j = JSON.parse(line);
      if (!Array.isArray(j.p) || j.p.length !== 6) continue;
      n++;
      const fam = familyOf(j.g);
      if (!families.has(fam)) families.set(fam, { rows: 0, bySource: {} });
      const e = families.get(fam);
      e.rows++; e.bySource[s.file] = (e.bySource[s.file] || 0) + 1;
    }
    manifest.sources.push({ ...s, rows: n, sha256: crypto.createHash('sha256').update(text).digest('hex') });
  }

  const keys = [...families.keys()].sort();
  const split = {};
  let devRows = 0, heldRows = 0;
  for (const fam of keys) {
    const isDev = fam === WITNESS_GAME || bucket(fam) < devFrac;
    split[fam] = isDev ? 'dev' : 'held-out';
    if (isDev) devRows += families.get(fam).rows; else heldRows += families.get(fam).rows;
  }
  if (split[WITNESS_GAME] === undefined)
    throw new Error(`the witness family ${WITNESS_GAME} is not in these corpora -- wrong checkout?`);

  manifest.families = keys.length;
  manifest.devFamilies = keys.filter(k => split[k] === 'dev').length;
  manifest.heldFamilies = keys.length - manifest.devFamilies;
  manifest.devRows = devRows;
  manifest.heldRows = heldRows;
  manifest.witnessForcedIntoDev = bucket(WITNESS_GAME) >= devFrac;
  manifest.split = split;

  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'frozen-sets.json');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 1) + '\n');
  const { split: _s, ...head } = manifest;
  console.log(JSON.stringify(head, null, 2));
  console.error(`wrote ${out}`);
}
main();
