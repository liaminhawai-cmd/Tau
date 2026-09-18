'use strict';
// Play a sampled position out with each mover brain against a fixed opponent; record the outcome
// and the mover's first move.  node playoff.js positions.jsonl out.jsonl workerIdx nWorkers
const fs = require('fs');
const { createEngine, makeBrain, loadPose } = require('./brains.js');
const [,, posFile, outFile, wi, nw] = process.argv;
const W = +wi || 0, N = +nw || 1;
const MOVERS = (process.env.MOVERS || 'L11,L8,best@D1,best@D2').split(',');
const OPP = process.env.OPP || 'best@D1';
const eng = createEngine();
eng.newGame();
const MAXPLIES = 300;
eng.CFG.moveCap = MAXPLIES;
const brains = {};
for (const s of MOVERS.concat([OPP])) brains[s] = brains[s] || makeBrain(eng, s);
const positions = fs.readFileSync(posFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const done = new Set();
try { for (const l of fs.readFileSync(outFile, 'utf8').split('\n')) if (l) { const r = JSON.parse(l); done.add(r.id + '|' + r.mover); } } catch (_) {}
const out = { write: s => fs.appendFileSync(outFile, s), end: () => {} };
function play(pos, moverSpec) {
  const mover = brains[moverSpec], opp = brains[OPP];
  loadPose(eng, pos.pose, pos.active, pos.plies);
  const me = pos.active;
  let plies = 0, nulls = 0, first = null;
  const t0 = Date.now();
  while (!eng.getG().over && plies < MAXPLIES - (pos.plies || 0)) {
    const idx = eng.getG().active;
    const b = idx === me ? mover : opp;
    const plan = b.fn(idx);
    if (!plan) { nulls++; if (nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
    nulls = 0;
    if (plies === 0) first = { pivotIdx: plan.pivotIdx, dir: plan.dir, targetRad: +plan.targetRad.toFixed(4) };
    eng.applyPlan(plan);
    plies++;
  }
  const G = eng.getG();
  let res;
  if (!G.over || G.winner === null) res = 'draw';
  else res = G.winner === me ? 'win' : 'loss';
  return { id: pos.id, mover: moverSpec, opp: OPP, res, adj: !!G.adjudicated, plies, first, ms: Date.now() - t0 };
}
let k = 0;
for (let i = 0; i < positions.length; i++) {
  if (i % N !== W) continue;
  const pos = positions[i];
  for (const m of MOVERS) {
    if (done.has(pos.id + '|' + m)) continue;
    const r = play(pos, m);
    out.write(JSON.stringify({ ...r, cell: pos.cell, adv: pos.adv, dm: pos.dm, ply: pos.plies, srcfam: pos.fam }) + '\n');
    k++;
    process.stderr.write(`[w${W}] ${i + 1}/${positions.length} ${m} ${r.res} ${r.plies}p ${r.ms}ms\n`);
  }
}
out.end();
