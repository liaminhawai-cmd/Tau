// The scale question, answered on 1-D traces.
//
// A tanh MLP is an analytic function. Zoom in far enough and EVERY net here is perfectly smooth --
// so "is this net fractal?" as a yes/no question has a trivial answer (no) and a useless one.
// The question worth asking is about a RANGE: over which separations does the value surface behave
// rough, and does that range reach up into the separations the game can actually tell apart?
//
// The instrument is the local log-log slope of the structure function, p(r) = d log S / d log r:
//     p ~ 2   the field is locally smooth -- differentiable, a gradient means something
//     0 < p < 2  rough at this scale, like fractional Brownian motion with H = p/2
//     p ~ 0   white hash -- neighbouring samples are unrelated
// The scale where p climbs back to 2 is that net's SMOOTHNESS FLOOR: below it, the net is just a
// smooth function; above it, the map genuinely has detail. Comparing each net's floor to crossEps
// (0.81u, below which two poses are the same pose to the rules) is the whole test:
//
//     floor well below crossEps  ->  the net carries real detail at scales the rules resolve
//     floor above crossEps       ->  the roughness lives where the rules cannot see it
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./map-analyze.js');

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const dir = arg('dir', 'nn/brain-maps');
const pose = arg('pose', 'swing1');
const span = arg('span', 'full');
const outFile = arg('out', `nn/brain-maps/transect-study-${pose}-${span}.json`);

const files = fs.readdirSync(dir).filter(f => f.includes(`__${pose}__T${span}__`) && f.endsWith('.json'));
if (!files.length) { console.error(`no transects for pose ${pose} span ${span} in ${dir}`); process.exit(1); }

const sets = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
                  .sort((a, b) => a.params - b.params);
const eps = sets[0].crossEps;

console.log(`\n=== TRANSECT STUDY -- pose ${pose}, span ${span} ===`);
console.log(`spacing ${sets[0].spacing.toExponential(3)}u   crossEps ${eps}u = ` +
            `${(eps / sets[0].spacing).toFixed(0)} samples\n`);

// Local slope by least squares over a sliding window in log-log, so a single noisy bin cannot
// swing it the way a two-point finite difference would.
function localSlopes(S, win = 7) {
  const L = S.map(p => ({ x: Math.log(p.r), y: Math.log(p.S), r: p.r }));
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const a = Math.max(0, i - (win >> 1)), b = Math.min(L.length, a + win);
    const w = L.slice(a, b);
    if (w.length < 3) continue;
    const mx = w.reduce((s, p) => s + p.x, 0) / w.length;
    const my = w.reduce((s, p) => s + p.y, 0) / w.length;
    let sxy = 0, sxx = 0;
    for (const p of w) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; }
    out.push({ r: L[i].r, slope: sxx > 0 ? sxy / sxx : NaN });
  }
  return out;
}

console.log('   ' + 'model'.padEnd(15) + 'params'.padStart(9) + '  ' + 'sd'.padStart(8) +
            '  ' + 'floor(p=1.9)'.padStart(13) + '  ' + 'p@eps'.padStart(6) +
            '  ' + 'belowEps%'.padStart(10));
const rows = [];
for (const t of sets) {
  const traces = t.traces.map(a => Float64Array.from(a));
  const S = A.transectStructure(traces, t.spacing, 0.25);
  const V = A.traceVariance(traces);
  const sl = localSlopes(S);

  // Smoothness floor: the largest r below which the slope has settled at ~2. Walking DOWN from the
  // coarse end and taking the first scale where it is still rough gives the top of the smooth band.
  let floor = null;
  for (let i = sl.length - 1; i >= 0; i--) if (sl[i].slope < 1.9) { floor = sl[i].r; break; }
  const atEps = sl.reduce((b, p) => Math.abs(p.r - eps) < Math.abs(b.r - eps) ? p : b, sl[0]);
  const Seps = S.reduce((b, p) => Math.abs(p.r - eps) < Math.abs(b.r - eps) ? p : b, S[0]);
  const belowEps = 100 * Seps.S / (2 * V.var);

  rows.push({ tag: t.tag, params: t.params, sd: Math.sqrt(V.var), floor,
              slopeAtEps: atEps.slope, belowEpsPct: belowEps,
              S: S.filter((_, i) => i % 3 === 0).map(p => ({ r: +p.r.toPrecision(4), S: p.S })),
              slopes: sl.filter((_, i) => i % 3 === 0).map(p => ({ r: +p.r.toPrecision(4), p: +p.slope.toFixed(3) })) });
  console.log('   ' + t.tag.padEnd(15) + String(t.params).padStart(9) + '  ' +
              Math.sqrt(V.var).toFixed(4).padStart(8) + '  ' +
              (floor === null ? 'smooth everywhere' : floor.toPrecision(3) + 'u').padStart(13) + '  ' +
              atEps.slope.toFixed(2).padStart(6) + '  ' + belowEps.toFixed(3).padStart(10));
}

console.log('\n   floor(p=1.9) = coarsest scale still rough; below it the net is a smooth function.');
console.log(`   p@eps        = local slope at crossEps (${eps}u). 2 = smooth there, <2 = rough there.`);
console.log('   belowEps%    = share of the trace variance expressed by separations under crossEps.\n');

fs.writeFileSync(outFile, JSON.stringify({ pose, span, crossEps: eps, spacing: sets[0].spacing, rows }, null, 1));
console.log(`wrote ${outFile}\n`);
