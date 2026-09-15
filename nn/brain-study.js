// The brain-map study: does a big net's rough value surface carry real structure, or is it detail
// with nothing underneath?
//
// Reads every map brain-map.js wrote for a pose and answers three questions in order.
//
//  A. HOW ROUGH, AND AT WHAT SCALE. Structure function per map, fitted to nugget + A*r^(2H).
//     H near 1 is a smooth field; H near 0 with a big nugget is hash. Also: what fraction of each
//     map's variance lives below crossEps (0.81u), where the rules cannot tell two poses apart.
//
//  B. DO INDEPENDENT NETS AGREE. Band-pass every pair of maps to a scale and correlate. Nets that
//     were trained separately cannot invent matching detail, so correlation at a scale is the
//     evidence that the structure at that scale belongs to the GAME. Falling correlation as the
//     band gets finer is the signature of per-net noise.
//
//  C. DOES THE DETAIL TRACK THE RULES. Same band-pass correlation, but against L11's own eval --
//     a field built out of the actual rule terms. Agreement there means the net's structure is
//     rediscovering board geometry rather than inventing it.
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
const res = +arg('res', 1024);
const outFile = arg('out', 'nn/brain-maps/study-' + pose + '.json');

const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.json') && f.includes(`__${pose}__${res}`))
  .map(f => path.join(dir, f.replace(/\.json$/, '')));
if (!files.length) { console.error(`no ${res}px maps for pose ${pose} in ${dir}`); process.exit(1); }

const maps = files.map(A.loadMap).sort((a, b) => a.meta.params - b.meta.params);
const cell = maps[0].cell, eps = maps[0].meta.crossEps;

console.log(`\n=== BRAIN MAP STUDY -- pose ${pose}, ${res}x${res}, cell ${cell.toFixed(4)}u, ` +
            `crossEps ${eps}u = ${(eps / cell).toFixed(1)} cells ===\n`);

// ---- A. roughness and scale ------------------------------------------------------------------
console.log('A. STRUCTURE FUNCTION   S(r) = nugget + A*r^(2H)');
console.log('   nugget% = share of the map\'s cell-to-cell variance with NO spatial correlation.');
console.log('   belowEps% = share of total variance living at scales under crossEps.\n');
console.log('   ' + 'model'.padEnd(15) + 'params'.padStart(9) + '  ' + 'sd'.padStart(7) +
            '  ' + 'H'.padStart(5) + '  ' + 'nugget%'.padStart(8) + '  ' + 'belowEps%'.padStart(10));

const rows = [];
for (const m of maps) {
  const st = A.stats(m.field);
  const S = A.structureFunction(m.field, m.res, m.cell, { perBin: 45000, nBins: 30 });
  const fit = A.fitNugget(S);
  // S(r) saturates at 2*var for an uncorrelated field, so S(r)/(2*var) is the share of variance
  // already expressed by separation r.
  const atEps = S.reduce((best, p) => Math.abs(p.r - eps) < Math.abs(best.r - eps) ? p : best, S[0]);
  const belowEps = 100 * atEps.S / (2 * st.var);
  const nugPct = fit ? 100 * fit.nugget / (2 * st.var) : NaN;
  rows.push({ tag: m.meta.tag, params: m.meta.params, kind: m.meta.kind, sd: st.sd, var: st.var,
              H: fit && fit.H, nugget: fit && fit.nugget, nuggetPct: nugPct, belowEpsPct: belowEps,
              S: S.map(p => ({ r: +p.r.toFixed(4), S: p.S })), fitRms: fit && fit.rmsLog });
  console.log('   ' + m.meta.tag.padEnd(15) + String(m.meta.params).padStart(9) + '  ' +
              st.sd.toFixed(4).padStart(7) + '  ' + (fit ? fit.H.toFixed(2) : '   - ').padStart(5) +
              '  ' + nugPct.toFixed(2).padStart(8) + '  ' + belowEps.toFixed(2).padStart(10));
}

// ---- B & C. band-pass agreement ---------------------------------------------------------------
// Bands are centred on scales that bracket crossEps, so the table reads as a walk from board-scale
// structure down through the epsilon and out the other side.
const bands = [16, 8, 4, 2, 1.6, 0.81, 0.4].filter(s => s / (2 * cell) >= 0.45);
const banded = new Map();
for (const m of maps)
  banded.set(m.meta.tag, bands.map(s => A.bandpass(m.field, m.res, s / (2 * cell), s / cell)));

const byTag = t => maps.find(m => m.meta.tag === t);
const big = maps.filter(m => m.meta.params > 1e6).map(m => m.meta.tag);
const engine = maps.find(m => m.meta.kind === 'engine');

console.log('\nB. DO INDEPENDENTLY TRAINED NETS SEE THE SAME DETAIL?');
console.log('   Pearson r between band-passed maps, per scale. 1.0 = identical structure.\n');
const pairs = [];
for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) pairs.push([big[i], big[j]]);
// also anchor the biggest net against the smallest, as a floor for what "agreement" looks like
const smallest = maps.filter(m => m.meta.kind !== 'engine')[0];
if (big.length && smallest) pairs.push([big[0], smallest.meta.tag]);

console.log('   ' + 'pair'.padEnd(28) + bands.map(s => (s + 'u').padStart(8)).join(''));
const bandRows = [];
for (const [x, y] of pairs) {
  if (!banded.has(x) || !banded.has(y)) continue;
  const rs = bands.map((_, bi) => { const c = A.correlate(banded.get(x)[bi], banded.get(y)[bi]); return c ? c.r : NaN; });
  bandRows.push({ a: x, b: y, bands, r: rs });
  console.log('   ' + (x + ' vs ' + y).padEnd(28) + rs.map(r => r.toFixed(3).padStart(8)).join(''));
}

let engRows = [];
if (engine) {
  console.log('\nC. DOES THE DETAIL TRACK THE RULES?   (band-passed vs L11\'s own eval)\n');
  console.log('   ' + 'model'.padEnd(28) + bands.map(s => (s + 'u').padStart(8)).join(''));
  for (const m of maps) {
    if (m.meta.kind === 'engine') continue;
    const rs = bands.map((_, bi) => {
      const c = A.correlate(banded.get(m.meta.tag)[bi], banded.get(engine.meta.tag)[bi]);
      return c ? c.r : NaN;
    });
    engRows.push({ model: m.meta.tag, params: m.meta.params, bands, r: rs });
    console.log('   ' + m.meta.tag.padEnd(28) + rs.map(r => r.toFixed(3).padStart(8)).join(''));
  }
}

fs.writeFileSync(outFile, JSON.stringify({ pose, res, cell, crossEps: eps, bands,
                                           structure: rows, agreement: bandRows, vsEngine: engRows }, null, 1));
console.log(`\nwrote ${outFile}\n`);
