'use strict';
// Opus task A/B prerequisite: the equal-time gate, and what a move of each rung actually costs.
//
// Run: node move-cost.js /path/to/a/checkout/with/L17 [--n 60] [--split dev] [--json out]
//
// nn/arena.js's makeBrain returns, for a spec "L<n>", `{ fn: idx => eng.ladderPlanFor(lvl-1, idx) }`
// and never reads its `timeMs` argument. Only the `le:`, `dual:` and `nn:` branches pass a clock to
// nnPlanForTimed. So --timeMs / --timeMsA / --timeMsB / --timeMsLo+Hi are silently inert on a
// ladder rung, and the rung's arena NAME carries no T tag either, so two runs at different clocks
// pool as one brain. This script measures what the fixed searches actually cost instead, which is
// the comparison the task allows in place of a clock-fairness claim.
//
// Rungs are called through ladderPlanRung, not ladderPlanFor: the latter rolls Math.random() for
// the corner opening, which is a game-start wrapper and would make a per-position timing run
// non-deterministic for no benefit.
const fs = require('fs'), path = require('path'), Module = require('module');
const DEG = 180 / Math.PI;
const WANT = ['ladderPlanRung', 'ladderRestore', 'DEAD_STATS', 'HARD_WIN_BONUS', 'HARD_MIN_MOVE_RAD'];

function build(root) {
  const enginePath = path.resolve(root, 'nn/engine.js');
  const indexSrc = fs.readFileSync(path.resolve(root, 'index.html'), 'utf8');
  const has = n => new RegExp(`^(?:function\\s*\\*?|class|const|let)\\s+${n}\\b`, 'm').test(indexSrc);
  const present = WANT.filter(has);
  const src = fs.readFileSync(enginePath, 'utf8')
    .replace('const SEEDS = [', `const SEEDS = [${present.map(n => `'${n}',`).join('')}`)
    .replace('if (cached.key === cacheKey', 'if (false && cached.key === cacheKey')
    .replace('fs.writeFileSync(ENGINE_CACHE_PATH,', 'false && fs.writeFileSync(ENGINE_CACHE_PATH,')
    .replace('__exports = {', `__exports = {${present.map(n => `${n},`).join('')}`);
  const m = new Module(enginePath, module);
  m.filename = enginePath; m.paths = Module._nodeModulePaths(path.dirname(enginePath));
  m._compile(src, enginePath);
  return m.exports.createEngine();
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const familyOf = g => {
  if (!g) return '(no id)';
  let m = /^(.*)-j\d+-\d+-\d+$/.exec(g); if (m) return m[1];
  m = /^(.*)-\d+$/.exec(g);              if (m) return m[1];
  return g;
};

function main() {
  const root = path.resolve(process.argv[2] || process.cwd());
  const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const N = +argOf('--n', 60), wantSplit = argOf('--split', null);
  const E = build(root);
  const splitMap = wantSplit ? JSON.parse(fs.readFileSync(path.join(__dirname, 'frozen-sets.json'), 'utf8')).split : null;

  const rows = [];
  for (const line of fs.readFileSync(path.join(root, 'docs/dead-regions/screened-not-dead.jsonl'), 'utf8').split('\n')) {
    if (line[0] !== '{') continue;
    const j = JSON.parse(line);
    if (!Array.isArray(j.p) || j.p.length !== 6) continue;
    if (j.mover !== 0 && j.mover !== 1) continue;
    if (splitMap && splitMap[familyOf(j.g)] !== wantSplit) continue;
    rows.push(j);
  }
  const pick = [];
  for (let i = 0; i < Math.min(N, rows.length); i++) pick.push(rows[Math.floor(i * rows.length / Math.min(N, rows.length))]);

  const rungs = [];
  for (const n of [11, 13, 17]) {
    const def = E.AI_LADDER[n - 1];
    if (!def) { rungs.push({ internal: `L${n}`, absent: true }); continue; }
    rungs.push({ internal: `L${n}`, kind: def.kind, label: def.label || null, def });
  }

  const out = { checkout: root, split: wantSplit || 'all', positions: pick.length, rungs: [] };
  const plans = {};
  for (const r of rungs) {
    if (r.absent) { out.rungs.push({ internal: r.internal, absent: true }); continue; }
    const ms = []; plans[r.internal] = [];
    if (E.DEAD_STATS) for (const k of Object.keys(E.DEAD_STATS)) if (typeof E.DEAD_STATS[k] === 'number' && k.indexOf('nearest') !== 0) E.DEAD_STATS[k] = 0;
    for (const row of pick) {
      E.newGame(); const g = E.getG();
      g.pieces.forEach((q, i) => { q.x = row.p[3 * i]; q.y = row.p[3 * i + 1]; q.rot = row.p[3 * i + 2]; });
      g.active = row.mover;
      const t0 = process.hrtime.bigint();
      const plan = E.ladderPlanRung(r.def, row.mover);
      const t1 = process.hrtime.bigint();
      ms.push(Number(t1 - t0) / 1e6);
      plans[r.internal].push(plan ? `${plan.pivotIdx}${plan.dir > 0 ? '+' : '-'}@${(Math.abs(plan.targetRad) * DEG).toFixed(3)}` : 'null');
    }
    out.rungs.push({
      internal: r.internal, kind: r.kind, label: r.label,
      totalMs: +ms.reduce((a, b) => a + b, 0).toFixed(1),
      meanMs: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(3),
      p50Ms: +pct(ms, 0.5).toFixed(3), p95Ms: +pct(ms, 0.95).toFixed(3), maxMs: +Math.max(...ms).toFixed(3),
      deadStats: r.kind === 'dead' && E.DEAD_STATS ? { ...E.DEAD_STATS } : null,
    });
  }
  const base = plans['L11'];
  for (const r of out.rungs) {
    if (r.absent || r.internal === 'L11' || !base) continue;
    const mine = plans[r.internal];
    r.movesDifferingFromL11 = mine.reduce((a, v, i) => a + (v === base[i] ? 0 : 1), 0);
    r.moveChangeRate = +(r.movesDifferingFromL11 / mine.length).toFixed(4);
  }
  const l11 = out.rungs.find(r => r.internal === 'L11');
  for (const r of out.rungs) if (!r.absent && l11) r.costVsL11 = +(r.meanMs / l11.meanMs).toFixed(2);

  out.equalTimeGate = {
    ladderBranchReadsTimeMs: false,
    evidence: 'nn/arena.js makeBrain: the /^L(\\d+)/ branch returns fn: idx => eng.ladderPlanFor(lvl-1, idx); ' +
              'timeMs is read only in the le:, dual: and nn: branches (nnPlanForTimed).',
    consequence: '--timeMs / --timeMsA / --timeMsB / --timeMsLo+Hi do not constrain a ladder rung, and the ' +
                 "rung's arena name carries no T tag, so runs at different clocks pool as one brain.",
  };

  const j = argOf('--json', null);
  if (j) { fs.writeFileSync(j, JSON.stringify(out, null, 1) + '\n'); console.error(`wrote ${j}`); }
  console.log(JSON.stringify(out, null, 2));
}
main();
