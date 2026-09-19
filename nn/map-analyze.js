// Measure a brain map instead of eyeballing it.
//
// THE QUESTION
// Big nets draw visibly rougher value surfaces than small ones. Two things look identical to the
// eye and are opposite in meaning: real fine structure (the net has learned something that varies
// on a small scale) and noise (the net's output jitters cell-to-cell for no reason). This file
// separates them three ways.
//
// 1. THE NUGGET. The structure function S(r) = <(V(p+d) - V(p))^2> over pairs at separation r.
//    A field that is genuinely smooth-but-detailed has S(r) -> 0 as r -> 0: nearby cells agree.
//    A field with per-cell noise of variance s^2 has S(r) -> 2s^2 instead -- a floor that survives
//    to r = 0. Geostatistics calls that floor the nugget, and fitting S(r) = nugget + A*r^(2H)
//    reads the noise fraction straight off the map. This is the single most decisive number here.
//
// 2. THE EPSILON LINE. The engine's own crossEps is 0.81 units: two poses closer than that are the
//    same pose as far as the rules are concerned. Structure below 0.81u therefore cannot encode a
//    rules difference, whatever it encodes. So we report how much of each map's variance lives
//    below that scale.
//
// 3. AGREEMENT BETWEEN INDEPENDENT NETS. Two separately-trained nets cannot hallucinate the SAME
//    noise. Band-pass both maps to a scale and correlate them: agreement at a scale means the
//    structure at that scale is a property of the game, not of the net. This is the test that can
//    actually promote "rough" to "real", and it is the reason the ladder includes two independent
//    2M-param nets rather than one.
'use strict';
const fs = require('fs');
const path = require('path');

function loadMap(base) {
  const meta = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
  const buf = fs.readFileSync(base + '.bin');
  const field = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  if (field.length !== meta.res * meta.res)
    throw new Error(`${base}: ${field.length} cells for res ${meta.res}`);
  return { meta, field, res: meta.res, cell: meta.cell };
}

// ---- normalised convolution: a Gaussian blur that ignores masked-out cells -------------------
// The board is a disc inside a square, so a third of every map is NaN. A plain blur would bleed
// those holes inward as if they were zeros; dividing the blurred field by the blurred mask instead
// makes each output cell the weighted mean of the LIVE neighbours only.
function gaussKernel(sigmaCells) {
  const rad = Math.max(1, Math.ceil(3 * sigmaCells));
  const k = new Float64Array(2 * rad + 1);
  let s = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-i * i / (2 * sigmaCells * sigmaCells)); k[i + rad] = v; s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return { k, rad };
}

// Exact separable Gaussian. Cost is O(res^2 * sigma), which is fine while the kernel is small --
// and the small-sigma bands are the ones the study actually turns on, so those stay exact.
function blurExact(field, res, sigmaCells) {
  const { k, rad } = gaussKernel(sigmaCells);
  const tn = new Float64Array(res * res), td = new Float64Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    let n = 0, d = 0;
    for (let t = -rad; t <= rad; t++) {
      const ii = i + t; if (ii < 0 || ii >= res) continue;
      const u = field[j * res + ii];
      if (Number.isFinite(u)) { n += k[t + rad] * u; d += k[t + rad]; }
    }
    tn[j * res + i] = n; td[j * res + i] = d;
  }
  const out = new Float64Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    let n = 0, d = 0;
    for (let t = -rad; t <= rad; t++) {
      const jj = j + t; if (jj < 0 || jj >= res) continue;
      n += k[t + rad] * tn[jj * res + i]; d += k[t + rad] * td[jj * res + i];
    }
    out[j * res + i] = Number.isFinite(field[j * res + i]) && d > 1e-9 ? n / d : NaN;
  }
  return out;
}

// Three box passes per axis approximate a Gaussian closely (central limit), at O(res^2) per pass
// regardless of sigma -- which is what makes the board-scale bands affordable at all. The mask is
// carried as a second running sum and divided out only at the very end, so this stays a normalised
// convolution rather than letting the NaN ring bleed inward.
function boxPass(num, den, res, radius) {
  const w = 2 * radius + 1;
  const on = new Float64Array(num.length), od = new Float64Array(den.length);
  for (let j = 0; j < res; j++) {
    const row = j * res;
    let sn = 0, sd = 0;
    for (let i = 0; i <= radius && i < res; i++) { sn += num[row + i]; sd += den[row + i]; }
    for (let i = 0; i < res; i++) {
      on[row + i] = sn; od[row + i] = sd;
      const add = i + radius + 1, drop = i - radius;
      if (add < res) { sn += num[row + add]; sd += den[row + add]; }
      if (drop >= 0) { sn -= num[row + drop]; sd -= den[row + drop]; }
    }
  }
  for (let i = 0; i < res; i++) {
    let sn = 0, sd = 0;
    for (let j = 0; j <= radius && j < res; j++) { sn += on[j * res + i]; sd += od[j * res + i]; }
    for (let j = 0; j < res; j++) {
      num[j * res + i] = sn; den[j * res + i] = sd;
      const add = j + radius + 1, drop = j - radius;
      if (add < res) { sn += on[add * res + i]; sd += od[add * res + i]; }
      if (drop >= 0) { sn -= on[drop * res + i]; sd -= od[drop * res + i]; }
    }
  }
  void w;
}

function blurBox(field, res, sigmaCells) {
  const radius = Math.max(1, Math.round(Math.sqrt(Math.max(1, 12 * sigmaCells * sigmaCells / 3 + 1)) / 2));
  const num = new Float64Array(res * res), den = new Float64Array(res * res);
  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    if (Number.isFinite(v)) { num[i] = v; den[i] = 1; }
  }
  for (let p = 0; p < 3; p++) boxPass(num, den, res, radius);
  const out = new Float64Array(res * res);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.isFinite(field[i]) && den[i] > 1e-9 ? num[i] / den[i] : NaN;
  return out;
}

// Exact below a small kernel, box-approximated above it. The crossover is generous enough that
// every band at or under a couple of crossEps is computed exactly.
const BLUR_EXACT_MAX_SIGMA = 12;
function blur(field, res, sigmaCells) {
  return sigmaCells <= BLUR_EXACT_MAX_SIGMA
    ? blurExact(field, res, sigmaCells)
    : blurBox(field, res, sigmaCells);
}

// Difference of Gaussians: what the field does between two scales and nowhere else.
function bandpass(field, res, sigLo, sigHi) {
  const a = blur(field, res, sigLo), b = blur(field, res, sigHi);
  const out = new Float64Array(res * res);
  for (let i = 0; i < out.length; i++) out[i] = a[i] - b[i];
  return out;
}

// ---- structure function ----------------------------------------------------------------------
// Sampled rather than exhaustive: a 1024^2 map has 5e11 pairs, and a few hundred thousand random
// ones per bin pin S(r) to well under a percent, which is far finer than anything concluded here.
function structureFunction(field, res, cell, opts = {}) {
  const nBins = opts.nBins || 28;
  const perBin = opts.perBin || 60000;
  const rMin = 1, rMax = res * 0.35;          // in cells; beyond ~a third of the box, pairs run out of board
  const bins = [];
  for (let b = 0; b < nBins; b++)
    bins.push(rMin * Math.pow(rMax / rMin, b / (nBins - 1)));

  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const out = [];
  for (const rCells of bins) {
    let sum = 0, n = 0, tries = 0;
    const maxTries = perBin * 40;
    while (n < perBin && tries < maxTries) {
      tries++;
      const i = (rnd() * res) | 0, j = (rnd() * res) | 0;
      const a = field[j * res + i];
      if (!Number.isFinite(a)) continue;
      const th = rnd() * 2 * Math.PI;
      const i2 = Math.round(i + rCells * Math.cos(th)), j2 = Math.round(j + rCells * Math.sin(th));
      if (i2 < 0 || i2 >= res || j2 < 0 || j2 >= res) continue;
      const b = field[j2 * res + i2];
      if (!Number.isFinite(b)) continue;
      const d = a - b; sum += d * d; n++;
    }
    if (n > 200) out.push({ r: rCells * cell, rCells, S: sum / n, n });
  }
  return out;
}

// Fit S(r) = nugget + A * r^(2H) by a coarse grid over H and nugget, least squares in log space.
// A direct linear fit would let a big-r point dominate; log residuals weight the decades evenly,
// which is the whole point of asking about scale behaviour.
function fitNugget(S) {
  if (S.length < 6) return null;
  const pts = S.filter(p => p.S > 0);
  let best = null;
  const Smax = Math.max(...pts.map(p => p.S));
  for (let hi = 0; hi <= 60; hi++) {
    const H = 0.05 + hi * (1.5 - 0.05) / 60;
    for (let ni = 0; ni <= 80; ni++) {
      const nug = Smax * (ni / 80) * 0.999;
      // best A in log space is the geometric mean of (S - nug)/r^2H over the points above the floor
      let acc = 0, m = 0;
      for (const p of pts) {
        const ex = p.S - nug;
        if (ex <= 1e-12) continue;
        acc += Math.log(ex) - 2 * H * Math.log(p.r); m++;
      }
      if (m < 4) continue;
      const A = Math.exp(acc / m);
      let err = 0;
      for (const p of pts) {
        const pred = nug + A * Math.pow(p.r, 2 * H);
        const d = Math.log(p.S) - Math.log(pred); err += d * d;
      }
      err /= pts.length;
      if (!best || err < best.err) best = { nugget: nug, A, H, err, rmsLog: Math.sqrt(err) };
    }
  }
  return best;
}

function stats(f) {
  let n = 0, s = 0, ss = 0;
  for (const v of f) if (Number.isFinite(v)) { n++; s += v; ss += v * v; }
  const mean = s / n;
  return { n, mean, var: ss / n - mean * mean, sd: Math.sqrt(Math.max(0, ss / n - mean * mean)) };
}

function correlate(a, b) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
  }
  if (n < 100) return null;
  const cov = sab / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
  return { r: cov / Math.sqrt(va * vb), n };
}


// ---- structure function from 1-D transects ----------------------------------------------------
// Uniform spacing makes this exact rather than sampled: for lag k, EVERY pair separated by k*h on
// every line contributes. That is what lets a few dozen lines resolve small r better than a 2-D map
// with a hundred times the evaluations.
function transectStructure(traces, spacing, maxLagFrac = 0.25) {
  if (!traces.length) return [];
  const N = traces[0].length;
  const maxK = Math.max(1, Math.floor(N * maxLagFrac));
  const sum = new Float64Array(maxK + 1), cnt = new Float64Array(maxK + 1);
  for (const v of traces) {
    for (let k = 1; k <= maxK; k++) {
      let s = 0;
      for (let i = 0; i + k < N; i++) { const d = v[i + k] - v[i]; s += d * d; }
      sum[k] += s; cnt[k] += N - k;
    }
  }
  const out = [];
  for (let k = 1; k <= maxK; k++)
    if (cnt[k] > 0) out.push({ r: k * spacing, k, S: sum[k] / cnt[k], n: cnt[k] });
  return out;
}

// Variance of the traces themselves -- the ceiling S(r) saturates toward, so "fraction of the
// field's variance that lives below scale r" is S(r)/(2*var).
function traceVariance(traces) {
  let n = 0, s = 0, ss = 0;
  for (const v of traces) for (const x of v) { n++; s += x; ss += x * x; }
  const m = s / n;
  return { n, mean: m, var: ss / n - m * m };
}

// Roughness field: how far each cell sits from the smooth version of its own neighbourhood.
// Used to pick where to START GAMES -- "rough spots" are where the big net claims to see something
// the smooth nets do not, so they are where its extra capacity should pay off if it is real.
function roughness(field, res, sigmaCells) {
  const sm = blur(field, res, sigmaCells);
  const out = new Float64Array(res * res);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.isFinite(field[i]) && Number.isFinite(sm[i]) ? field[i] - sm[i] : NaN;
  return out;
}

module.exports = { loadMap, blur, blurExact, blurBox, bandpass, structureFunction, transectStructure,
                   traceVariance, roughness, fitNugget, stats, correlate };
