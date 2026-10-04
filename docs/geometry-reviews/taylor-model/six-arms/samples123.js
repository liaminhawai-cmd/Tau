// The engine at every sampled stop of one blue arm, with red's reply exactly as the proof has it: arm (0,-),
// 123 substeps of 0.375 degrees (46.125 degrees). arms.js swings red on to its own limit instead, which is
// further at many stops, so its margins are not the ones the cells bound.
//   node samples123.js <bluePivot> <blueDir>   ->  data/red-0m-123_b<pivot>_<dir>.csv
// Columns: target alpha, the angle blue's plan application actually reached, red substeps played, margin of
// blue's worst foot past the edge after red's reply.
'use strict';
const fs = require('fs'), path = require('path');
const { createEngine } = require(path.join(__dirname, '../../../../nn/engine.js'));
const eng = createEngine();
const EDGE = eng.CFG.edgeU + eng.CFG.edgeEps;
const SEED = [-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442], DELTA = 3 * Math.PI / 180 / 8, K_RED = 123;
const [bp, bd] = process.argv.slice(2, 4).map(Number);
const D = path.join(__dirname, 'data');
const alphas = [];
for (const name of [`red-0m-0.01deg_b${bp}_${bd}.csv`, `red-0m-ext-0.001deg_b${bp}_${bd}.csv`]) {
  const f = path.join(D, name);
  if (fs.existsSync(f)) for (const r of fs.readFileSync(f, 'utf8').trim().split('\n').slice(1)) alphas.push(+r.split(',')[0]);
}
const out = ['alpha,reached,redSubsteps,margin123'];
for (const a of alphas) {
  const G = eng.newGame(); const [B, R] = G.pieces;
  B.x = SEED[0]; B.y = SEED[1]; B.rot = SEED[2]; R.x = SEED[3]; R.y = SEED[4]; R.rot = SEED[5]; G.active = 0;
  eng.applyPlanSearch({ pivotIdx: bp, dir: bd, targetRad: a * Math.PI / 180 });
  if (G.over) { out.push(`${a},,0,`); continue; }
  const reached = Math.abs(G.pieces[0].rot - SEED[2]) * 180 / Math.PI;
  eng.pinFoot(0);
  let k = 0;
  while (k < K_RED && !G.atLimit) { eng.applySwing(-DELTA); k++; }
  const margin = Math.max(...G.pieces[0].feet().map(f => Math.hypot(f.x, f.y))) - EDGE;
  out.push(`${a},${reached},${k},${margin}`);
}
fs.writeFileSync(path.join(D, `red-0m-123_b${bp}_${bd}.csv`), out.join('\n') + '\n');
console.log(`arm (${bp},${bd}): ${alphas.length} stops`);
