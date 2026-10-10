// Figure: for each of blue's six arms, the stop angles where red's (0,-) reply has been SAMPLED to
// throw (light bar) and where it has been PROVED by Taylor-model cells (solid bar).
//   node figure2.js   ->  results/six-arms.svg
'use strict';
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, 'results');
// limit: the largest target the engine's plan application executes in full (six-arms/blue-limits.js)
const ARMS = [
  { bp: 0, bd: -1, limit: 63.692659668 }, { bp: 0, bd: 1, limit: 44.343482055 }, { bp: 1, bd: -1, limit: 16.826501816 },
  { bp: 1, bd: 1, limit: 14.788562189 }, { bp: 2, bd: -1, limit: 15.975495885 }, { bp: 2, bd: 1, limit: 4.996359600 },
];
const tag = a => `${a.bp}_${a.bd > 0 ? 'p' : 'm'}`;
const name = a => `(${a.bp},${a.bd > 0 ? '+' : '−'})`;

function proved(a) {
  const dir = path.join(R, `arm_${tag(a)}`);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^cover_.*_d\d+\.json$/.test(f)).map(f => path.join(dir, f)) : [];
  // arm (1,-) was first proved by the earlier pipeline, whose cells sit directly in results/
  if (!files.length && a.bp === 1 && a.bd < 0) for (const f of fs.readdirSync(R)) if (/^cover_.*_d6\.json$/.test(f)) files.push(path.join(R, f));
  const leaves = [];
  for (const f of files) leaves.push(...JSON.parse(fs.readFileSync(f)).leaves);
  leaves.sort((p, q) => p.a - q.a);
  const runs = [];
  for (const l of leaves) {
    if (runs.length && runs[runs.length - 1].b === l.a) { runs[runs.length - 1].b = l.b; runs[runs.length - 1].cells++; runs[runs.length - 1].m = Math.min(runs[runs.length - 1].m, l.m); }
    else runs.push({ a: l.a, b: l.b, cells: 1, m: l.m });
  }
  return { runs, cells: leaves.length, minMargin: leaves.length ? Math.min(...leaves.map(l => l.m)) : null };
}
function sampled(a) {
  // every 0.01 degrees up to the 3-degree-call limit, then every 0.001 degrees from there to the engine's limit
  const rows = [];
  for (const name of [`red-0m-0.01deg_b${a.bp}_${a.bd}.csv`, `red-0m-ext-0.001deg_b${a.bp}_${a.bd}.csv`]) {
    const f = path.join(__dirname, 'six-arms', 'data', name);
    if (fs.existsSync(f)) rows.push(...fs.readFileSync(f, 'utf8').trim().split('\n').slice(1).map(r => r.split(',').map(Number)));
  }
  return { n: rows.length, min: Math.min(...rows.map(r => r[3])) };
}

const W = 960, L = 118, Rm = 24, rowH = 62, top = 100, H = top + ARMS.length * rowH + 64, X1 = 64;
const x = deg => L + (deg - 2) / (X1 - 2) * (W - L - Rm);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Red's (0,−) reply against every blue move: sampled and proved</title>
<desc id="d">One row per blue arm, stop angle on the horizontal axis. A light bar is the range sampled with the engine, with red's reply throwing at every stop. A solid bar is the part covered by proved Taylor-model cells.</desc>
<style>
  svg { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --grid:#e6e5e1; --s1:#2a78d6; --light:#b7d3f6; }
  @media (prefers-color-scheme: dark) { svg { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --grid:#33332f; --s1:#3987e5; --light:#254a78; } }
  .bg{fill:var(--surface)} .t1{font:600 18px system-ui,sans-serif;fill:var(--ink)} .t2{font:13px system-ui,sans-serif;fill:var(--ink2)}
  .ax{font:12px system-ui,sans-serif;fill:var(--ink2)} .arm{font:600 14px system-ui,sans-serif;fill:var(--ink)} .grid{stroke:var(--grid);stroke-width:1}
  .samp{fill:var(--light)} .prov{fill:var(--s1)}
</style>
<rect class="bg" width="${W}" height="${H}"/>
<text class="t1" x="${L}" y="34">Red's (0,−) reply against every blue move</text>
<text class="t2" x="${L}" y="56">Light bar: sampled (every 0.01°, every 0.001° near the end), red throws at every stop. Solid bar: proved by Taylor-model cells.</text>
`;
for (let g = 4; g <= 64; g += 4) svg += `<line class="grid" x1="${x(g).toFixed(1)}" x2="${x(g).toFixed(1)}" y1="${top - 10}" y2="${top + ARMS.length * rowH - 14}"/><text class="ax" x="${x(g).toFixed(1)}" y="${top + ARMS.length * rowH + 4}" text-anchor="middle">${g}°</text>\n`;
ARMS.forEach((a, i) => {
  const y = top + i * rowH, p = proved(a), s = sampled(a);
  svg += `<text class="arm" x="${L - 12}" y="${y + 18}" text-anchor="end">blue ${name(a)}</text>\n`;
  svg += `<rect class="samp" x="${x(2).toFixed(1)}" y="${y + 4}" width="${(x(a.limit) - x(2)).toFixed(1)}" height="14" rx="3"><title>${esc(`sampled ${s.n.toLocaleString('en')} stops, smallest margin ${s.min.toFixed(3)}u`)}</title></rect>\n`;
  for (const r of p.runs) svg += `<rect class="prov" x="${x(r.a).toFixed(1)}" y="${y + 4}" width="${Math.max(1, x(r.b) - x(r.a)).toFixed(1)}" height="14" rx="3"><title>${esc(`proved ${r.a.toFixed(3)}° to ${r.b.toFixed(3)}°: ${r.cells} cells, smallest margin ${r.m.toFixed(3)}u`)}</title></rect>\n`;
  const pc = p.runs.reduce((t, r) => t + (r.b - r.a), 0), full = a.limit - 2;
  const label = p.cells ? `proved ${(100 * pc / full).toFixed(0)}% (${p.cells.toLocaleString('en')} cells, margin ≥ ${p.minMargin.toFixed(2)}u)` : 'not yet proved';
  svg += `<text class="t2" x="${x(2).toFixed(1)}" y="${y + 36}">${esc(label)}; sampled ${s.n.toLocaleString('en')} stops, margin ≥ ${s.min.toFixed(2)}u</text>\n`;
});
svg += `<text class="ax" x="${(L + W - Rm) / 2}" y="${H - 10}" text-anchor="middle">blue's stop angle α (degrees)</text>\n</svg>\n`;
fs.writeFileSync(path.join(R, 'six-arms.svg'), svg);
console.log('wrote results/six-arms.svg');
