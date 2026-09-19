// Read the d1..d6 transects from brain-depth.js and answer one question: does looking further ahead
// make the value surface rougher?
//
// WHY EVERYTHING HERE IS NORMALISED
// The raw structure function is not comparable across depths. A d1 L11 root value sits around +15
// with a spread of a couple of points; a d2 value sits around -30 with a different spread, because
// deeper search changes the units of the answer as well as its shape. S(r) scales with the square
// of the field, so an unnormalised table would rank depths by how loud they are, not how rough.
// Every statistic below is therefore either scale-free by construction (the log-log SLOPE, which is
// invariant under S -> cS) or divided by the field's own variance.
//
// THE THREE STATISTICS, AND WHAT EACH WOULD LOOK LIKE IF SEARCH ADDED STRUCTURE
//   p(r), the local log-log slope.  p ~ 2 smooth, 0 < p < 2 rough (H = p/2), p ~ 1 the signature of
//     isolated jump discontinuities. The leaf evaluators in BRAIN-MAP-REPORT.md all sit at ~1.0,
//     inherited from the feature encoding. If deeper search adds genuine game structure, p should
//     FALL below that as d grows.
//   belowEps, S(crossEps)/(2*var). The share of the surface's total variation that lives below the
//     separation the rules can resolve at all. Structure the rules cannot see is structure no
//     player can use; if this GROWS with depth, deeper search is manufacturing detail in a band
//     where two poses are the same pose.
//   jumps/u, the density of large adjacent-sample steps. The most direct reading of "how often does
//     one more ply flip the verdict": every time the principal variation switches lines, the root
//     value steps. A threshold on the ROBUST spread of the steps (median |step|) rather than the
//     mean keeps a single big jump from raising the bar that defines a jump.
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
const span = arg('span', '2');
const tag = arg('tag', 'L11');
const outFile = arg('out', `nn/brain-maps/depth-study-${tag}-${pose}.json`);

const re = new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-d(\\d+)__${pose}__T${span}__\\d+\\.json$`);
const found = fs.readdirSync(dir).map(f => ({ f, m: re.exec(f) })).filter(x => x.m);
if (!found.length) { console.error(`no depth transects for tag ${tag}, pose ${pose}, span ${span} in ${dir}`); process.exit(1); }

const sets = found.map(x => JSON.parse(fs.readFileSync(path.join(dir, x.f), 'utf8')))
                  .sort((a, b) => a.depth - b.depth);
const eps = sets[0].crossEps;

// The largest lag the structure function reaches: a quarter of a line, since a lag longer than that
// has too few pairs on a short line to estimate. Worth printing next to crossEps, because on a 2u
// line rMax lands BELOW it -- every separation measured here is finer than the rules can resolve,
// and a column labelled "at crossEps" would silently be reporting the nearest lag instead.
const rMax = 0.25 * (sets[0].samples - 1) * sets[0].spacing;
console.log(`\n=== DEPTH STUDY -- ${tag}, pose ${pose}, span ${span}u ===`);
console.log(`spacing ${sets[0].spacing.toExponential(3)}u   lags ${sets[0].spacing.toFixed(4)}..${rMax.toFixed(4)}u   ` +
            `crossEps ${eps}u   keep=${sets[0].keep} sweepDeg=${sets[0].sweepDeg}`);
console.log(rMax < eps
  ? `every separation measured is finer than crossEps -- this is the sub-resolution band\n`
  : `crossEps sits inside the measured band\n`);

// Sliding-window least squares in log space, same instrument as brain-transect-study.js so the
// numbers here sit on the same scale as the leaf-eval numbers in the report.
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

// One straight-line fit over the whole measured band: the headline exponent, with a residual so a
// curve that is not a power law at all cannot be quoted as though it were one.
function globalSlope(S) {
  const L = S.map(p => [Math.log(p.r), Math.log(p.S)]);
  const mx = L.reduce((s, p) => s + p[0], 0) / L.length;
  const my = L.reduce((s, p) => s + p[1], 0) / L.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of L) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return { slope: sxy / sxx, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : NaN };
}

// Density of verdict flips. The threshold is 4x the MEDIAN absolute step, which on a smooth ramp
// catches nothing and on a staircase catches every riser.
function jumpDensity(traces, spacing) {
  const steps = [];
  for (const v of traces) for (let i = 1; i < v.length; i++) steps.push(Math.abs(v[i] - v[i - 1]));
  if (!steps.length) return { perU: 0, med: 0, n: 0 };
  const med = steps.slice().sort((a, b) => a - b)[steps.length >> 1];
  const thr = 4 * med;
  const n = steps.filter(s => s > thr).length;
  return { perU: n / (steps.length * spacing), med, thr, n, of: steps.length };
}

const rows = [];
console.log('  ' + 'depth'.padStart(5) + '  ' + 'lines'.padStart(5) + '  ' + 'sd'.padStart(9) +
            '  ' + 'slope(fit)'.padStart(10) + '  ' + 'r2'.padStart(5) +
            '  ' + 'p@rMax'.padStart(7) + '  ' + 'p(min)'.padStart(7) +
            '  ' + 'var<rMax%'.padStart(10) + '  ' + 'jumps/u'.padStart(8));
for (const t of sets) {
  const traces = t.traces.map(a => Float64Array.from(a));
  const S = A.transectStructure(traces, t.spacing, 0.25);
  const V = A.traceVariance(traces);
  const sl = localSlopes(S);
  const G = globalSlope(S);
  const atTop = sl[sl.length - 1];                 // the coarsest lag measured, i.e. r = rMax
  const Stop = S[S.length - 1];
  const pmin = sl.reduce((b, p) => (p.slope < b.slope ? p : b), sl[0]);
  const J = jumpDensity(traces, t.spacing);
  const belowTop = 100 * Stop.S / (2 * V.var);
  rows.push({ depth: t.depth, lines: t.lines, sd: Math.sqrt(V.var), fit: G.slope, r2: G.r2,
              rMax, pAtRMax: atTop.slope, pMin: pmin.slope, pMinR: pmin.r, belowRMax: belowTop,
              jumpsPerU: J.perU, medStep: J.med, seconds: t.seconds,
              S: S.map(p => ({ r: p.r, S: p.S, norm: p.S / (2 * V.var) })),
              slopes: sl });
  console.log('  ' + String(t.depth).padStart(5) + '  ' + String(t.lines).padStart(5) +
              '  ' + Math.sqrt(V.var).toExponential(2).padStart(9) +
              '  ' + G.slope.toFixed(3).padStart(10) + '  ' + G.r2.toFixed(3).padStart(5) +
              '  ' + atTop.slope.toFixed(2).padStart(7) + '  ' + pmin.slope.toFixed(2).padStart(7) +
              '  ' + belowTop.toFixed(1).padStart(10) + '  ' + J.perU.toFixed(2).padStart(8));
}

// Normalised S(r): the curve that actually settles the question. Reading DOWN a column shows what
// one more ply does to the share of the surface's variation living at that separation.
console.log(`\n  S(r)/(2*var) -- share of the field's variation below separation r`);
const rs = rows[0].S.map(p => p.r);
console.log('     ' + 'r (u)'.padStart(8) + rows.map(r => `   d${r.depth}`.padStart(8)).join(''));
for (let i = 0; i < rs.length; i++) {
  if (i % 2 && i !== rs.length - 1) continue;
  const mark = Math.abs(rs[i] - eps) < (rows[0].S[1].r - rows[0].S[0].r) / 2 ? ' <- crossEps' : '';
  console.log('     ' + rs[i].toFixed(4).padStart(8) +
              rows.map(r => (r.S[i] ? r.S[i].norm.toFixed(4) : '-').padStart(8)).join('') + mark);
}

console.log(`\n  local slope p(r)`);
console.log('     ' + 'r (u)'.padStart(8) + rows.map(r => `   d${r.depth}`.padStart(8)).join(''));
for (let i = 0; i < rows[0].slopes.length; i++) {
  if (i % 2 && i !== rows[0].slopes.length - 1) continue;
  console.log('     ' + rows[0].slopes[i].r.toFixed(4).padStart(8) +
              rows.map(r => (r.slopes[i] ? r.slopes[i].slope.toFixed(2) : '-').padStart(8)).join(''));
}

fs.writeFileSync(outFile, JSON.stringify({ tag, pose, span, crossEps: eps, rows }, null, 1));
console.log(`\n  -> ${outFile}`);
