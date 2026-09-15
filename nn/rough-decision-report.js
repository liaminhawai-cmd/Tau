// Paired comparison of the epsilon-blur decision test across rough and smooth positions.
//
// rough-poses.js emits its two sets as MATCHED PAIRS -- rough[i] and smooth[i] sit at the same
// distance from the board centre, from the opponent and from the nearest printed line, and differ
// in how rough the reference net's value surface is there. Comparing two rates and quoting a
// difference of proportions throws that pairing away, which is both wrong (the samples are not
// independent) and weaker than the test the design already paid for.
//
// So: McNemar on the discordant pairs. Of the pairs where exactly one side's move moved under the
// blur, how many were the rough one? Under the null that roughness is irrelevant, that is a coin
// flip, and the exact binomial on the discordant count is the p-value. The angle change gets a
// paired signed-rank test over the same pairs.
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || '.';

// Exact two-sided binomial tail, so a handful of discordant pairs is reported honestly rather than
// pushed through a chi-square approximation that needs counts this test will not always have.
function binomTwoSided(k, n) {
  if (n === 0) return 1;
  const lc = [];
  { let s = 0; lc.push(0); for (let i = 1; i <= n; i++) { s += Math.log(i); lc.push(s); } }
  const lp = i => lc[n] - lc[i] - lc[n - i] - n * Math.LN2;
  const obs = lp(k) + 1e-12;
  let p = 0;
  for (let i = 0; i <= n; i++) if (lp(i) <= obs) p += Math.exp(lp(i));
  return Math.min(1, p);
}

// Wilcoxon signed-rank, normal approximation with a tie correction -- fine at the pair counts here
// and it does not assume the angle differences are anywhere near normal, which they are not.
function signedRank(d) {
  const nz = d.filter(v => v !== 0);
  const n = nz.length;
  if (n < 6) return { n, p: NaN, W: NaN };
  const srt = nz.map(v => ({ a: Math.abs(v), s: Math.sign(v) })).sort((x, y) => x.a - y.a);
  const rank = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i; while (j + 1 < n && srt[j + 1].a === srt[i].a) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) rank[k] = r;
    i = j + 1;
  }
  let W = 0; for (let k = 0; k < n; k++) W += srt[k].s > 0 ? rank[k] : 0;
  const mu = n * (n + 1) / 4, sd = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
  const z = (W - mu) / sd;
  const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  return { n, W, z, p };
}
function erf(x) {
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return y;
}

const runs = {};
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!j.per) continue;
  const [m, cond] = j.tag.split('/');
  (runs[m] = runs[m] || {})[cond] = j;
}

console.log('\nEPSILON-BLUR DECISION TEST -- paired over matched rough/smooth positions');
console.log('Blur the net\'s own evaluator over a crossEps disc, re-run the search, see if the move moves.\n');
console.log('  ' + 'model'.padEnd(12) + 'params'.padStart(9) + '  ' + 'rough'.padStart(11) + '  ' + 'smooth'.padStart(11) +
            '  ' + 'R-only'.padStart(7) + '  ' + 'S-only'.padStart(7) + '  ' + 'p'.padStart(8) +
            '  ' + 'dAng R'.padStart(8) + '  ' + 'dAng S'.padStart(8) + '  ' + 'p(ang)'.padStart(8));

const order = Object.keys(runs).sort((a, b) => (runs[a].ROUGH?.params || 0) - (runs[b].ROUGH?.params || 0));
for (const m of order) {
  const R = runs[m].ROUGH, S = runs[m].SMOOTH;
  if (!R || !S) continue;
  const n = Math.min(R.per.length, S.per.length);
  let b = 0, c = 0;
  const dAng = [];
  for (let i = 0; i < n; i++) {
    const r = R.per[i], s = S.per[i];
    if (r.changed && !s.changed) b++;
    if (!r.changed && s.changed) c++;
    dAng.push(r.dAngleDeg - s.dAngleDeg);
  }
  const p = binomTwoSided(Math.min(b, c), b + c);
  const sr = signedRank(dAng);
  const mR = R.per.reduce((s, x) => s + x.dAngleDeg, 0) / R.per.length;
  const mS = S.per.reduce((s, x) => s + x.dAngleDeg, 0) / S.per.length;
  console.log('  ' + m.padEnd(12) + String(R.params).padStart(9) + '  ' +
    `${R.changed}/${R.n}`.padStart(11) + '  ' + `${S.changed}/${S.n}`.padStart(11) + '  ' +
    String(b).padStart(7) + '  ' + String(c).padStart(7) + '  ' + p.toFixed(4).padStart(8) + '  ' +
    mR.toFixed(2).padStart(8) + '  ' + mS.toFixed(2).padStart(8) + '  ' +
    (Number.isFinite(sr.p) ? sr.p.toFixed(4) : '   -').padStart(8));
}
console.log('\n  R-only / S-only = discordant pairs: the move moved on one side of the pair only.');
console.log('  p      = exact two-sided binomial on those discordant pairs (McNemar).');
console.log('  dAng   = mean |change in stopping angle|, degrees; p(ang) = paired signed-rank.\n');
