// Build --dead-batch seeds from nn/data game records, the way --mine picks them:
// a decided game's last row is the winner's pose before the throw; the row 2k+1 before the
// end (index len-2-2k) is the LOSER to move. k=0 is one loser-move before the throw.
// Files are sampled with a seeded shuffle so the seeds are spread over the corpus, not
// clustered in one trainer batch.
'use strict';
const fs = require('fs'), path = require('path');
const DIR = process.argv[2] || 'nn/data';
const OUT = process.argv[3] || 'seeds.jsonl';
const NFILES = +(process.argv[4] || 120);
const PER_FILE = +(process.argv[5] || 6);      // games sampled per file
const KS = (process.argv[6] || '0,1,2').split(',').map(Number);
let SEED = +(process.argv[7] || 20260919);

const rnd = () => { SEED = (SEED * 1103515245 + 12345) & 0x7fffffff; return SEED / 0x7fffffff; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const files = shuffle(fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl'))).slice(0, NFILES);
const seen = new Set(); const out = [];
const keyOf = (p, m) => p.map(x => (+x).toFixed(4)).join(',') + '|' + m;

for (const f of files) {
  let rows;
  try { rows = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
  catch (e) { continue; }
  const byG = new Map();
  for (const r of rows) { if (r.g && r.p) { if (!byG.has(r.g)) byG.set(r.g, []); byG.get(r.g).push(r); } }
  const decided = [...byG.entries()].filter(([, gr]) => gr.length >= 2 && Math.abs(gr[gr.length - 1].z) >= 0.98);
  for (const [g, gr] of shuffle(decided).slice(0, PER_FILE)) {
    for (const k of KS) {
      const i = gr.length - 2 - 2 * k; if (i < 0) continue;
      const r = gr[i]; if (!r.p || r.m == null) continue;
      const key = keyOf(r.p, r.m); if (seen.has(key)) continue; seen.add(key);
      out.push({ p: r.p.map(Number), mover: r.m, k, g, file: f, row: i, len: gr.length });
    }
  }
}
shuffle(out);
fs.writeFileSync(OUT, out.map(o => JSON.stringify(o)).join('\n') + '\n');
const byK = {}; for (const o of out) byK['k=' + o.k] = (byK['k=' + o.k] || 0) + 1;
console.log(`${out.length} seeds from ${files.length} files -> ${OUT}  ${JSON.stringify(byK)}`);
