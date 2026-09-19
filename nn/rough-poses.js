// Turn a brain map into two matched sets of starting positions: where the big net's surface is
// ROUGH, and where it is SMOOTH.
//
// This is the behavioural half of the study. Sections A-C of brain-study.js ask whether the fine
// structure in a big net's map is self-consistent and rule-shaped; they cannot say whether it is
// WORTH anything. That is a question about games: if the roughness is real knowledge, the big net
// should beat a smooth net by MORE when the game starts somewhere its map is rough.
//
// THE CONFOUND, AND THE MATCHING THAT KILLS IT
// Rough cells are not scattered at random. They cluster near printed lines and near the opponent --
// exactly the tactically sharp places where ANY stronger brain does better. A naive rough-vs-smooth
// split would therefore measure "sharp positions" and report it as "roughness pays", and the result
// would look great and mean nothing. So every rough cell drawn here is paired with a smooth cell
// matched on the three things that make a position sharp:
//     distance from board centre, distance to the opponent's hub, distance to the nearest line.
// After matching, the two sets differ in the big net's roughness and as little else as possible.
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const A = require('./map-analyze.js');

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const mapBase = arg('map', 'nn/brain-maps/best__swing1__1024');
const nPoses = +arg('n', 64);
const outDir = arg('out', 'nn/brain-maps');
const minSepU = +arg('minSep', 3.0);   // keep chosen cells from piling into one blob

const m = A.loadMap(mapBase);
const { res, cell } = m, meta = m.meta;
const eng = createEngine();
const CFG = eng.CFG;

// Roughness at the epsilon scale: the map minus its own crossEps-blurred self. Anything this
// picks up is structure finer than the distance at which the rules stop distinguishing poses.
const sigma = meta.crossEps / cell;
const rough = A.roughness(m.field, res, sigma);

// Distance from a hub position to the nearest printed line, over the piece's three feet -- the same
// ring/side-arc geometry features.js block B uses.
function lineDist(x, y, rot) {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const a = rot + i * 2 * Math.PI / 3;
    const fx = x + Math.cos(a) * CFG.footR, fy = y + Math.sin(a) * CFG.footR;
    const fr = Math.hypot(fx, fy);
    for (const R of CFG.rings) best = Math.min(best, Math.abs(fr - R));
    for (const arc of CFG.sideArcs) {
      const dx = fx - arc.cx, dy = fy - arc.cy;
      const deg = Math.atan2(dy, dx) * 180 / Math.PI;
      if (eng.angInSpan(deg, arc.a0, arc.a1)) best = Math.min(best, Math.abs(Math.hypot(dx, dy) - arc.r));
    }
  }
  return best;
}

const E = meta.extent, op = meta.opponent, meRot = meta.meRot;
const axis = i => -E + (i + 0.5) * (2 * E / res);

const cells = [];
for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
  const v = rough[j * res + i];
  if (!Number.isFinite(v)) continue;
  const x = axis(i), y = axis(j);
  cells.push({ x, y, rough: Math.abs(v),
               rc: Math.hypot(x, y), rop: Math.hypot(x - op.x, y - op.y), rl: lineDist(x, y, meRot) });
}
cells.sort((a, b) => b.rough - a.rough);

const hi = cells.slice(0, Math.floor(cells.length * 0.10));          // roughest decile
const lo = cells.slice(Math.floor(cells.length * 0.60));             // the smooth 40%
console.log(`${cells.length} live cells; roughness |v| median ${cells[cells.length >> 1].rough.toExponential(2)}, ` +
            `p90 ${hi[hi.length - 1].rough.toExponential(2)}`);

// Greedy spatially-spread draw from the rough decile.
const far = (c, chosen) => chosen.every(o => Math.hypot(c.x - o.x, c.y - o.y) >= minSepU);
const roughSet = [];
for (const c of hi) { if (roughSet.length >= nPoses) break; if (far(c, roughSet)) roughSet.push(c); }

// For each rough pick, the smooth cell closest to it in (centre, opponent, line) space.
//
// The three coordinates are STANDARDISED before the distance is taken. They are all in board units,
// so a raw Euclidean distance looks fair, but their spreads are not remotely comparable -- distance
// to the nearest line lives in a couple of units while distance to the opponent spans eighty. Left
// raw, the match is decided almost entirely by the two wide coordinates and drifts on the narrow
// one, which is the worst possible outcome here: line proximity is exactly the confound this
// matching exists to remove, because near-line is where the surface gets rough in the first place.
const sd = k => {
  const all = cells.map(c => c[k]);
  const m = all.reduce((s, v) => s + v, 0) / all.length;
  return Math.sqrt(all.reduce((s, v) => s + (v - m) ** 2, 0) / all.length) || 1;
};
const W = { rc: 1 / sd('rc'), rop: 1 / sd('rop'), rl: 1 / sd('rl') };
const used = new Set();
const smoothSet = [];
for (const r of roughSet) {
  let best = null, bi = -1;
  for (let i = 0; i < lo.length; i++) {
    if (used.has(i)) continue;
    const c = lo[i];
    const d = ((c.rc - r.rc) * W.rc) ** 2 + ((c.rop - r.rop) * W.rop) ** 2 + ((c.rl - r.rl) * W.rl) ** 2;
    if (best === null || d < best) { best = d; bi = i; }
  }
  if (bi >= 0) { used.add(bi); smoothSet.push(lo[bi]); }
}

// How much of the roughness is simply "near a printed line"? Reported because it is the mechanism
// behind the confound above, and worth knowing in its own right.
{
  const n = cells.length;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (const c of cells) {
    const x = Math.min(c.rl, 5), y = Math.log(c.rough + 1e-9);
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const cov = sxy / n - (sx / n) * (sy / n);
  const r = cov / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2));
  console.log(`roughness vs distance-to-nearest-line (clamped 5u): r = ${r.toFixed(3)}`);
}

const mean = (a, k) => a.reduce((s, c) => s + c[k], 0) / a.length;
console.log(`\nmatched ${roughSet.length} rough / ${smoothSet.length} smooth`);
console.log('              ' + ['rough'.padStart(9), 'smooth'.padStart(9)].join(''));
for (const [label, k] of [['roughness', 'rough'], ['r(centre)', 'rc'], ['r(opp)', 'rop'], ['d(line)', 'rl']])
  console.log('  ' + label.padEnd(12) + mean(roughSet, k).toFixed(3).padStart(9) + mean(smoothSet, k).toFixed(3).padStart(9));

// The mover is the side to move in the map's pose; the opponent sits where the map froze it.
const toPose = c => meta.active === 1
  ? { blue: { x: op.x, y: op.y, rot: op.rot }, red: { x: c.x, y: c.y, rot: meRot }, active: 1 }
  : { blue: { x: c.x, y: c.y, rot: meRot }, red: { x: op.x, y: op.y, rot: op.rot }, active: 0 };

const tag = path.basename(mapBase);
for (const [name, set] of [['rough', roughSet], ['smooth', smoothSet]]) {
  const f = path.join(outDir, `poses-${name}-${tag}.json`);
  fs.writeFileSync(f, JSON.stringify(set.map(toPose), null, 1));
  console.log(`  ${set.length} poses -> ${f}`);
}
