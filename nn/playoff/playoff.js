'use strict';
// Play a sampled position out with each mover brain against a fixed opponent; record the outcome
// and the mover's first move for the position-type analysis, AND every ply as a training row in
// selfplay.js/arena.js's own schema (f/z/p/m/g/mv[/adj]), so the same run doubles as data
// generation. Training rows land in a sibling file next to the results file: out.jsonl gets
// out.data.jsonl.  node playoff.js positions.jsonl out.jsonl workerIdx nWorkers
const fs = require('fs');
const { createEngine, makeBrain, loadPose, features } = require('./brains.js');
const [,, posFile, outFile, wi, nw] = process.argv;
const W = +wi || 0, N = +nw || 1;
const MOVERS = (process.env.MOVERS || 'L11,L8,best@D1,best@D2').split(',');
const OPP = process.env.OPP || 'best@D1';
const DISCOUNT = +(process.env.DISCOUNT || 0.995);
const dataFile = outFile.replace(/\.jsonl$/, '') + '.data.jsonl';
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
const data = { write: s => fs.appendFileSync(dataFile, s), end: () => {} };
let savedRows = 0;
function play(pos, moverSpec) {
  const mover = brains[moverSpec], opp = brains[OPP];
  loadPose(eng, pos.pose, pos.active, pos.plies);
  const me = pos.active;
  let plies = 0, nulls = 0, first = null;
  const rows = [];
  const t0 = Date.now();
  while (!eng.getG().over && plies < MAXPLIES - (pos.plies || 0)) {
    const idx = eng.getG().active;
    const b = idx === me ? mover : opp;
    // Captured BEFORE the move, same as arena.js/selfplay.js: the row describes the position the
    // mover actually decided from, not the position it left behind. `p` is the raw pose, kept for
    // the same reason selfplay.js keeps it -- re-featurisable if the feature set ever changes.
    const ps = eng.getG().pieces;
    rows.push({ f: features(eng), m: idx, p: [ps[0].x, ps[0].y, ps[0].rot, ps[1].x, ps[1].y, ps[1].rot] });
    const plan = b.fn(idx);
    if (!plan) { rows.pop(); nulls++; if (nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
    nulls = 0;
    if (plies === 0) first = { pivotIdx: plan.pivotIdx, dir: plan.dir, targetRad: +plan.targetRad.toFixed(4) };
    eng.applyPlan(plan);
    plies++;
  }
  const G = eng.getG();
  let res;
  if (!G.over || G.winner === null) res = 'draw';
  else res = G.winner === me ? 'win' : 'loss';
  // Decided games only, same rule as arena.js: a ply-capped shuffle has no outcome to label with.
  if (G.over && G.winner !== null) {
    const gameId = 'playoff-' + pos.id + '-' + moverSpec;
    const scale = G.adjudicated ? eng.CFG.komiLoss : 1;
    const adj = G.adjudicated ? { adj: 1 } : null;
    for (let i = 0; i < rows.length; i++) {
      const z = scale * (rows[i].m === G.winner ? 1 : -1) * Math.pow(DISCOUNT, rows.length - i);
      const mv = rows[i].m === me ? moverSpec : OPP;
      data.write(JSON.stringify({ f: rows[i].f.map(v => +v.toFixed(5)), z: +z.toFixed(4),
                                  p: rows[i].p.map(v => +v.toFixed(4)), m: rows[i].m,
                                  g: gameId, mv, ...adj }) + '\n');
      savedRows++;
    }
  }
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
    process.stderr.write(`[w${W}] ${i + 1}/${positions.length} ${m} ${r.res} ${r.plies}p ${r.ms}ms (${savedRows} rows saved)\n`);
  }
}
out.end();
data.end();
