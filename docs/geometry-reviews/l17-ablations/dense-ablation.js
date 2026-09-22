'use strict';
// dense-exercise-check.js showed that ablation-matrix.js's fixture (screened-not-dead.jsonl, always
// asking the endangered `mover`) can never exercise the dense check, because dense fires only on a
// candidate the mover's OWN ladderScore3 already claims wins -- and the endangered mover by
// definition rarely has one. dead-points-mined.jsonl asked from 1-mover (the winning side) DOES
// exercise it, on every single position sampled there.
//
// This is the matching ablation-matrix.js run on that corpus/perspective: same component switches,
// same move-vs-L11 and cost comparisons, but now actually measuring what dense contributes, because
// dense has something to do here.
//
// Run: node dense-ablation.js [--n 60] [--json out.json]
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const DEG = 180 / Math.PI;
const eng = require(path.join(ROOT, 'nn/engine.js')).createEngine();

const ROWS = [
  { id: 'L11',            lvl: 11, cfg: null,                                       what: 'baseline' },
  { id: 'L17-all-off',    lvl: 17, cfg: { deadTable: false, deadDense: false, deadGuard: false }, what: 'SELF-TEST: must equal L11' },
  { id: 'L17',             lvl: 17, cfg: null,                                       what: 'shipped: table + dense + guard' },
  { id: 'L17-dense',       lvl: 17, cfg: { deadTable: false, deadGuard: false },      what: 'dense check only' },
  { id: 'L17-table',       lvl: 17, cfg: { deadDense: false, deadGuard: false },      what: 'certificate table only' },
];

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const statKeys = () => Object.keys(eng.DEAD_STATS).filter(k => k.indexOf('nearest') !== 0);
const zeroStats = () => { for (const k of statKeys()) eng.DEAD_STATS[k] = 0; };

function main() {
  const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const N = +argOf('--n', 60);

  const pool = [];
  for (const line of fs.readFileSync(path.join(ROOT, 'docs/dead-regions/dead-points-mined.jsonl'), 'utf8').split('\n')) {
    if (line[0] !== '{') continue;
    const j = JSON.parse(line);
    if (Array.isArray(j.p) && j.p.length === 6 && (j.mover === 0 || j.mover === 1)) pool.push(j);
  }
  const pick = [];
  for (let i = 0; i < Math.min(N, pool.length); i++) pick.push(pool[Math.floor(i * pool.length / Math.min(N, pool.length))]);

  const tag = p => p ? `${p.pivotIdx}${p.dir > 0 ? '+' : '-'}@${(Math.abs(p.targetRad) * DEG).toFixed(4)}` : 'null';
  const out = { checkout: ROOT, corpus: 'dead-points-mined.jsonl', perspective: 'winner (1-mover)', positions: pick.length, rows: [] };
  const plans = {};

  for (const r of ROWS) {
    zeroStats();
    const ms = []; plans[r.id] = [];
    for (const row of pick) {
      const winner = 1 - row.mover;
      eng.newGame(); const g = eng.getG();
      g.pieces.forEach((q, i) => { q.x = row.p[3 * i]; q.y = row.p[3 * i + 1]; q.rot = row.p[3 * i + 2]; });
      g.active = winner;
      g.cornerOpening = [false, false];
      const t0 = process.hrtime.bigint();
      const plan = eng.ladderPlanFor(r.lvl - 1, winner, r.cfg);
      ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
      plans[r.id].push(tag(plan));
    }
    const stats = {}; for (const k of statKeys()) if (eng.DEAD_STATS[k]) stats[k] = eng.DEAD_STATS[k];
    out.rows.push({
      id: r.id, internal: `L${r.lvl}`, what: r.what, cfg: r.cfg,
      meanMs: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2),
      p50Ms: +pct(ms, 0.5).toFixed(2), p95Ms: +pct(ms, 0.95).toFixed(2),
      deadStats: Object.keys(stats).length ? stats : null,
    });
  }

  const base = plans['L11'];
  for (const row of out.rows) {
    const mine = plans[row.id];
    row.movesDifferingFromL11 = mine.reduce((a, v, i) => a + (v === base[i] ? 0 : 1), 0);
    const l11 = out.rows.find(x => x.id === 'L11');
    row.costVsL11 = +(row.meanMs / l11.meanMs).toFixed(2);
  }

  const selfTest = out.rows.find(r => r.id === 'L17-all-off');
  const bad = plans['L17-all-off'].map((v, i) => v === base[i] ? null : { i, l11: base[i], off: v }).filter(Boolean);
  out.selfTest = { passed: bad.length === 0, mismatches: bad.length, examples: bad.slice(0, 5) };
  if (bad.length) { console.error(`SELF-TEST FAILED: ${bad.length} mismatches`); process.exitCode = 1; }

  // The number that actually matters for dense: of L11's claimed forced wins (dense fired), what
  // fraction did the dense test go on to REFUTE (found the opponent has a quiet escape)?
  const l17row = out.rows.find(r => r.id === 'L17');
  const denseRow = out.rows.find(r => r.id === 'L17-dense');
  if (denseRow.deadStats) {
    denseRow.refutationRate = +(denseRow.deadStats.refuted / denseRow.deadStats.dense).toFixed(4);
  }

  const j = argOf('--json', null);
  if (j) { fs.writeFileSync(j, JSON.stringify({ ...out, plans }, null, 1) + '\n'); console.error(`wrote ${j}`); }
  console.log(`\n${pick.length} positions from ${out.corpus} (${out.perspective}), self-test ${out.selfTest.passed ? 'PASSED' : 'FAILED'}\n`);
  const w = (s, n) => String(s).padEnd(n);
  console.log(`${w('row', 16)}${w('moves != L11', 14)}${w('mean ms', 10)}${w('xL11', 7)}counters`);
  for (const r of out.rows) {
    const c = r.deadStats ? Object.entries(r.deadStats).map(([k, v]) => `${k}=${v}`).join(' ') + (r.refutationRate != null ? ` refutationRate=${r.refutationRate}` : '') : '';
    console.log(`${w(r.id, 16)}${w(r.movesDifferingFromL11, 14)}${w(r.meanMs, 10)}${w(r.costVsL11, 7)}${c}`);
  }
}
main();
