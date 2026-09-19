'use strict';
// node nn/ladder-deep-check.js [--poses n] [--seed n]
//
// index.html has three copies of one search: ladderPlan3 (the p3 rungs, depth 3), ladderPlan4 (L12a,
// depth 4) and ladderPlanDeep (L12c, depth 5), the last being the first two with the nesting as a
// parameter. Only the general one can be checked against something, so this does that: with L11's
// weights and options it plays ladderPlanDeep at depth 3 against ladderPlan3, and at depth 4 against
// ladderPlan4, on real positions, and reports the depth-5 cost beside them. Exits 1 on any
// disagreement. Run it after touching any of the three.
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const NPOSE = +opt('--poses', 12);
let seed = +opt('--seed', 99); const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const NN = __dirname;
const eng = require(path.join(NN, 'engine.js')).createEngine();
const L11 = eng.AI_LADDER[10];
if (!L11 || L11.kind !== 'p3') { console.error('AI_LADDER[10] is not the p3 rung this check calibrates on'); process.exit(2); }

// temporary rungs, appended so the real ones keep their numbers; each pair is the same search
// written out and generalised, so the two must pick the same move
const at = def => (eng.AI_LADDER.push(def), eng.AI_LADDER.length - 1);
const PAIRS = [3, 4].map(depth => ({
  depth,
  ref: at({ kind: depth === 3 ? 'p3' : 'p4', w: L11.w, o: { ...L11.o, depth } }),
  gen: at({ kind: 'p5', w: L11.w, o: { ...L11.o, depth } }),
}));
const D5 = at({ kind: 'p5', w: L11.w, o: { ...L11.o, depth: 5 } });

const files = fs.readdirSync(path.join(NN, 'data')).filter(f => /^(batch|retro|league).*\.jsonl$/.test(f)).sort();
if (!files.length) { console.error('no nn/data/*.jsonl game files to draw positions from'); process.exit(2); }
const poses = [];
while (poses.length < NPOSE) {
  const f = files[Math.floor(rnd() * files.length)];
  const L = fs.readFileSync(path.join(NN, 'data', f), 'utf8').split('\n').filter(l => l[0] === '{');
  const r = JSON.parse(L[Math.floor(rnd() * L.length)]); if (r.p && r.p.length === 6) poses.push(r.p);
}
const plan = (lvl, p, idx) => {
  eng.newGame(); const g = eng.getG();
  g.pieces.forEach((q, i) => { q.x = p[i * 3]; q.y = p[i * 3 + 1]; q.rot = p[i * 3 + 2]; });
  g.active = idx; g.cornerOpening = [false, false];   // the corner wrapper is not what is under test
  const t = process.hrtime.bigint();
  return { p: eng.ladderPlanFor(lvl, idx), ms: Number(process.hrtime.bigint() - t) / 1e6 };
};
let bad = 0, n = 0; const cost = { 3: 0, 4: 0, 5: 0 };
for (const p of poses) for (const idx of [0, 1]) {
  n++;
  for (const { depth, ref, gen } of PAIRS) {
    const a = plan(ref, p, idx), b = plan(gen, p, idx);
    cost[depth] += a.ms;
    const ja = JSON.stringify(a.p), jb = JSON.stringify(b.p);
    if (ja !== jb) { bad++; if (bad <= 5) console.log(`DIFF depth ${depth}`, JSON.stringify(p), idx, ja, jb); }
  }
  cost[5] += plan(D5, p, idx).ms;
}
const per = d => (cost[d] / n).toFixed(0);
console.log(`${n} positions: ${bad} disagreements between ladderPlanDeep and the written-out searches`);
console.log(`cost per move: depth 3 ${per(3)} ms, depth 4 ${per(4)} ms (${(cost[4] / cost[3]).toFixed(1)}x), depth 5 ${per(5)} ms (${(cost[5] / cost[3]).toFixed(1)}x depth 3, ${(cost[5] / cost[4]).toFixed(1)}x depth 4)`);
console.log(bad ? 'FAIL' : 'OK: the general search matches both written-out ones');
process.exit(bad ? 1 : 0);
