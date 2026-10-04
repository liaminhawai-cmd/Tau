// Sample one blue arm of the Brief 6 seed: for each blue stop angle alpha, every red reply.
//   node arms.js <bluePivot> <blueDir> <stepDeg> [reds] > out.csv     reds: 'all' (default) or e.g. '0,-1'
// Columns: alpha, blueOver (blue's reply threw red: immediate win), pushedRed (red's pose changed),
// then for each red arm (q,e): final margin of blue's worst foot past the edge, the maximum of that
// margin over the swing (red may stop early), red's legal limit in degrees.
'use strict';
const { createEngine } = require(require('path').join(__dirname, '../../../../nn/engine.js'));
const eng = createEngine();
const EDGE = eng.CFG.edgeU + eng.CFG.edgeEps;
const SEED = [-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442];
const STEP = 3 * Math.PI / 180;
const ALL = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]];
const REDS = (process.argv[5] && process.argv[5] !== 'all') ? process.argv[5].split(';').map(x => x.split(',').map(Number)) : ALL;
const ARMS = REDS;

function setSeed(active) {
  const G = eng.newGame(); const [b, r] = G.pieces;
  b.x = SEED[0]; b.y = SEED[1]; b.rot = SEED[2]; r.x = SEED[3]; r.y = SEED[4]; r.rot = SEED[5];
  G.active = active; return G;
}
const worst = G => Math.max(...G.pieces[0].feet().map(f => Math.hypot(f.x, f.y))) - EDGE;

function limitOf(piece, pivot, dir) {
  const G = setSeed(piece); eng.pinFoot(pivot);
  let g = 0; while (!G.atLimit && g++ < 400) eng.applySwing(dir * STEP);
  return { deg: Math.abs(G.netRad) * 180 / Math.PI, reason: G.limitReason };
}

function at(alpha, bp, bd) {
  const G = setSeed(0);
  const red0 = G.pieces[1].x + ',' + G.pieces[1].y + ',' + G.pieces[1].rot;
  eng.applyPlanSearch({ pivotIdx: bp, dir: bd, targetRad: alpha * Math.PI / 180 });
  if (G.over) return { over: true };
  const r = G.pieces[1];
  const pushed = (r.x + ',' + r.y + ',' + r.rot) !== red0;
  const row = [];
  for (const [q, e] of ARMS) {
    const H = setSeed(0);
    eng.applyPlanSearch({ pivotIdx: bp, dir: bd, targetRad: alpha * Math.PI / 180 });
    eng.pinFoot(q);
    let g = 0, mx = -Infinity;
    while (!H.atLimit && g++ < 400) { eng.applySwing(e * STEP); mx = Math.max(mx, worst(H)); }
    row.push(worst(H), mx, Math.abs(H.netRad) * 180 / Math.PI);
  }
  return { over: false, pushed, row };
}

const [bp, bd, step] = process.argv.slice(2, 5).map(Number);
const lim = limitOf(0, bp, bd);
process.stderr.write(`blue arm (${bp},${bd}): limit ${lim.deg.toFixed(4)} deg (${lim.reason})\n`);
const hdr = ['alpha', 'blueOver', 'pushedRed'];
for (const [q, e] of ARMS) { const k = `${q}${e < 0 ? 'm' : 'p'}`; hdr.push(`m${k}`, `x${k}`, `l${k}`); }
console.log(hdr.join(','));
const stops = [];
for (let a = 2; a < lim.deg; a += step) stops.push(a);
stops.push(lim.deg);
for (const a of stops) {
  const r = at(a, bp, bd);
  console.log(r.over ? [a, 1, 1, ...ARMS.flatMap(() => ['', '', ''])].join(',') : [a, 0, r.pushed ? 1 : 0, ...r.row].join(','));
}
