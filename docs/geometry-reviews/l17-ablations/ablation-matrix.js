'use strict';
// Controlled component tests for internal L17, per the task request's ablation table. This is the
// FIXTURE stage: per-position decisions, component counters and cost. It plays no games and reports
// no Elo -- that is the arena stage, and it should only be paid for on the rows this one shows are
// distinguishable.
//
// Run: node ablation-matrix.js [--n 60] [--split dev] [--json out.json] [--rows a,b,c]
//
// Every row is the SAME rung with options overridden per call (index.html's ladderPlanFor
// `oOverride`, reachable from nn/arena.js as "L17+cfg:..."), never a re-implementation, so a
// difference between rows is a difference in the switched component and nothing else.
//
// The first row is a self-test, not a measurement: with all three components off, ladderPlanDead
// must reduce to ladderPlan3 and therefore play L11's move on every position. If that assertion
// ever fails, no other row in the table means anything and the run aborts.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const DEG = 180 / Math.PI;
const eng = require(path.join(ROOT, 'nn/engine.js')).createEngine();

const ROWS = [
  { id: 'L11',            lvl: 11, cfg: null,                                                     what: 'baseline' },
  { id: 'L17-all-off',    lvl: 17, cfg: { deadTable: false, deadDense: false, deadGuard: false }, what: 'SELF-TEST: must equal L11 exactly' },
  { id: 'L13',            lvl: 13, cfg: null,                                                     what: 'richer opponent replies' },
  { id: 'L17',            lvl: 17, cfg: null,                                                     what: 'shipped: table + dense + guard' },
  { id: 'L17-dense',      lvl: 17, cfg: { deadTable: false, deadGuard: false },                   what: 'dense check only' },
  { id: 'L17-guard',      lvl: 17, cfg: { deadTable: false, deadDense: false },                   what: 'guard only' },
  { id: 'L17-dense+guard',lvl: 17, cfg: { deadTable: false },                                     what: 'both, table off' },
  { id: 'L17-table',      lvl: 17, cfg: { deadDense: false, deadGuard: false },                   what: 'certificate table only' },
  { id: 'L11-eps',        lvl: 11, cfg: { markEps: 1e-9 },                                        what: 'L11 with the dropped stop marks restored' },
  { id: 'L17-eps',        lvl: 17, cfg: { markEps: 1e-9 },                                        what: 'shipped L17, marks restored' },
];

const familyOf = g => {
  if (!g) return '(no id)';
  let m = /^(.*)-j\d+-\d+-\d+$/.exec(g); if (m) return m[1];
  m = /^(.*)-\d+$/.exec(g);              if (m) return m[1];
  return g;
};
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const statKeys = () => Object.keys(eng.DEAD_STATS).filter(k => k.indexOf('nearest') !== 0);
const zeroStats = () => { for (const k of statKeys()) eng.DEAD_STATS[k] = 0; };

function main() {
  const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const N = +argOf('--n', 60), wantSplit = argOf('--split', 'dev');
  const only = argOf('--rows', null);
  const rows = only ? ROWS.filter(r => only.split(',').includes(r.id) || r.id === 'L11' || r.id === 'L17-all-off') : ROWS;
  const splitMap = wantSplit === 'all' ? null
    : JSON.parse(fs.readFileSync(path.join(__dirname, 'frozen-sets.json'), 'utf8')).split;

  const pool = [];
  for (const line of fs.readFileSync(path.join(ROOT, 'docs/dead-regions/screened-not-dead.jsonl'), 'utf8').split('\n')) {
    if (line[0] !== '{') continue;
    const j = JSON.parse(line);
    if (!Array.isArray(j.p) || j.p.length !== 6) continue;
    if (j.mover !== 0 && j.mover !== 1) continue;
    if (splitMap && splitMap[familyOf(j.g)] !== wantSplit) continue;
    pool.push(j);
  }
  const pick = [];
  for (let i = 0; i < Math.min(N, pool.length); i++) pick.push(pool[Math.floor(i * pool.length / Math.min(N, pool.length))]);

  const tag = p => p ? `${p.pivotIdx}${p.dir > 0 ? '+' : '-'}@${(Math.abs(p.targetRad) * DEG).toFixed(4)}` : 'null';
  const out = { checkout: ROOT, split: wantSplit, positions: pick.length, rows: [] };
  const plans = {};

  for (const r of rows) {
    if (!eng.AI_LADDER[r.lvl - 1]) { out.rows.push({ id: r.id, absent: true }); continue; }
    zeroStats();
    const ms = []; plans[r.id] = [];
    for (const row of pick) {
      eng.newGame(); const g = eng.getG();
      g.pieces.forEach((q, i) => { q.x = row.p[3 * i]; q.y = row.p[3 * i + 1]; q.rot = row.p[3 * i + 2]; });
      g.active = row.mover;
      // corner opening pinned OFF: it is a game-start wrapper and its coin would make this run
      // non-deterministic for no benefit
      g.cornerOpening = [false, false];
      const t0 = process.hrtime.bigint();
      const plan = eng.ladderPlanFor(r.lvl - 1, row.mover, r.cfg);
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
    if (row.absent || !base || !plans[row.id]) continue;
    const mine = plans[row.id];
    row.movesDifferingFromL11 = mine.reduce((a, v, i) => a + (v === base[i] ? 0 : 1), 0);
    const l11 = out.rows.find(x => x.id === 'L11');
    if (l11) row.costVsL11 = +(row.meanMs / l11.meanMs).toFixed(2);
  }

  // The self-test. Everything below it is meaningless if this fails.
  const selfTest = out.rows.find(r => r.id === 'L17-all-off');
  if (selfTest && !selfTest.absent) {
    const bad = plans['L17-all-off'].map((v, i) => v === base[i] ? null : { i, l11: base[i], off: v }).filter(Boolean);
    out.selfTest = { passed: bad.length === 0, mismatches: bad.length, examples: bad.slice(0, 5) };
    if (bad.length) {
      console.error(`SELF-TEST FAILED: L17 with all components off differs from L11 on ${bad.length} of ${pick.length} positions`);
      console.error(JSON.stringify(bad.slice(0, 5), null, 2));
      process.exitCode = 1;
    }
  }

  const j = argOf('--json', null);
  if (j) { fs.writeFileSync(j, JSON.stringify({ ...out, plans }, null, 1) + '\n'); console.error(`wrote ${j}`); }
  const w = (s, n) => String(s).padEnd(n);
  console.log(`\n${pick.length} positions, split=${wantSplit}, self-test ${out.selfTest ? (out.selfTest.passed ? 'PASSED' : 'FAILED') : 'n/a'}\n`);
  console.log(`${w('row', 18)}${w('moves != L11', 14)}${w('mean ms', 10)}${w('p50', 9)}${w('p95', 9)}${w('xL11', 7)}counters`);
  for (const r of out.rows) {
    if (r.absent) { console.log(`${w(r.id, 18)}ABSENT from this checkout`); continue; }
    const c = r.deadStats ? Object.entries(r.deadStats).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    console.log(`${w(r.id, 18)}${w(r.movesDifferingFromL11 ?? '-', 14)}${w(r.meanMs, 10)}${w(r.p50Ms, 9)}${w(r.p95Ms, 9)}${w(r.costVsL11 ?? '-', 7)}${c}`);
  }
}
main();
