// Where the narrow cells of arm (2,-) beyond 14.5 degrees sit, against the engine. For each cluster of cells
// under 1e-4 degrees wide, take the first substep of red's reply in which red's hub touches blue's leg, and
// bisect on the float engine the stop angle at which the number of pushes in that substep changes (the hub's
// first push starts to leave red's leg 0 exactly touching blue's leg 0). Prints the angle, the narrowest
// cell of the cluster and whether that cell contains it.   node events-2m.js  ->  results/arm_2_m/events.txt
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { buildEngineSource } = require('../../../nn/engine.js');
const text = fs.readFileSync(path.join(__dirname, '../../../nn/engine.js'), 'utf8');
const open = "vm.runInContext(buildEngineSource() + `", close = "`, sandbox, { filename: 'tau-engine-extract.js' });";
const wrapper = text.slice(text.indexOf(open) + open.length, text.indexOf(close));
let src = buildEngineSource();
const hook = /const hf = Math\.hypot\(nx3, ny3\);[^\n]*/;
if (!hook.test(src)) throw new Error('engine patch failed');
src = src.replace(hook, 'const hf = Math.hypot(nx3, ny3); __L.push(pa.h);');   // the line ends in a comment: replace it whole
const sb = { Math, console, __L: [] }; vm.createContext(sb); vm.runInContext(src + wrapper, sb);
const eng = sb.__exports, L = sb.__L;
const SEED = [-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442], DELTA = 3 * Math.PI / 180 / 8, HUB = 23.095;
// pushes in every substep of red's reply after blue stops at alpha on arm (2,-), and the first substep with a hub push
function replay(alpha) {
  const G = eng.newGame(); const [B, R] = G.pieces;
  B.x = SEED[0]; B.y = SEED[1]; B.rot = SEED[2]; R.x = SEED[3]; R.y = SEED[4]; R.rot = SEED[5]; G.active = 0;
  eng.applyPlanSearch({ pivotIdx: 2, dir: -1, targetRad: alpha * Math.PI / 180 });
  eng.pinFoot(0);
  const n = [0]; let first = 0;
  for (let k = 1; k <= 123 && !G.atLimit; k++) {
    L.length = 0; eng.applySwing(-DELTA); n.push(L.length);
    if (!first && L.some(h => Math.abs(h - HUB) < 1e-9)) first = k;
  }
  return { n, first };
}
const dir = path.join(__dirname, 'results', 'arm_2_m');
const leaves = [];
for (const f of fs.readdirSync(dir)) if (/^cover_.*_d\d+\.json$/.test(f)) leaves.push(...JSON.parse(fs.readFileSync(path.join(dir, f))).leaves);
leaves.sort((p, q) => p.a - q.a);
const narrow = leaves.filter(l => l.a >= 14.5 && l.b - l.a < 1e-4), clusters = [];
for (const l of narrow) { const c = clusters[clusters.length - 1]; if (c && l.a - c[c.length - 1].b < 1e-3) c.push(l); else clusters.push([l]); }
// for each cluster: the earliest substep whose number of pushes differs 2e-5 degrees either side of its
// narrowest cell, the angle where it changes (bisected), the cell that holds that angle, and its distance
// from the narrowest cell
const lines = []; let near = 0, maxDist = 0;
for (const c of clusters) {
  const cell = c.reduce((m, l) => (l.b - l.a < m.b - m.a ? l : m)), mid = (cell.a + cell.b) / 2;
  let lo = mid - 2e-5, hi = mid + 2e-5;
  const rl = replay(lo), rh = replay(hi), first = replay(mid).first;
  let k = 1; while (k < rl.n.length && rl.n[k] === rh.n[k]) k++;
  let line;
  if (k >= rl.n.length) line = `cluster near ${mid.toFixed(6)}: the engine's pushes do not change within 2e-5 degrees`;
  else {
    const nlo = rl.n[k];
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (replay(m).n[k] === nlo) lo = m; else hi = m; }
    const e = (lo + hi) / 2, hold = leaves.find(l => l.a <= e && e <= l.b) || { a: NaN, b: NaN };
    const dist = e < cell.a ? cell.a - e : e > cell.b ? e - cell.b : 0;
    near += hold.b - hold.a < 1e-4; maxDist = Math.max(maxDist, dist);
    line = `substep ${k} (hub first touches at ${first}): pushes ${nlo} -> ${rh.n[k]} at ${e.toFixed(9)}, in cell [${hold.a}, ${hold.b}] (${(hold.b - hold.a).toExponential(2)} wide), ${dist.toExponential(2)} from the narrowest cell [${cell.a}, ${cell.b}] (${(cell.b - cell.a).toExponential(2)})`;
  }
  lines.push(line); console.log(line);
}
lines.push(`TOTAL: ${clusters.length} clusters of cells under 1e-4 degrees; in ${near} the engine changes inside one of the cluster's cells, at most ${maxDist.toExponential(2)} degrees from its narrowest cell`);
console.log(lines[lines.length - 1]);
fs.writeFileSync(path.join(dir, 'events.txt'), lines.join('\n') + '\n');
