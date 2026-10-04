// Six panels, one per blue arm: how far past the rim blue's worst foot ends after red's (0,-) reply of 123
// substeps, against blue's stop angle. The line is what the engine gives at sampled stops (every 0.01
// degrees, every 0.001 near the end; six-arms/samples123.js); the filled steps are the proved lower bounds of
// the Taylor-model cells. Anything above zero is a throw.
//   node figure3.js   ->  results/margins.svg
'use strict';
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, 'results');
const ARMS = [
  { bp: 0, bd: -1, limit: 63.692659668 }, { bp: 0, bd: 1, limit: 44.343482055 }, { bp: 1, bd: -1, limit: 16.826501816 },
  { bp: 1, bd: 1, limit: 14.788562189 }, { bp: 2, bd: -1, limit: 15.975495885 }, { bp: 2, bd: 1, limit: 4.996359600 },
];
const tag = a => `${a.bp}_${a.bd > 0 ? 'p' : 'm'}`;
const name = a => `(${a.bp},${a.bd > 0 ? '+' : '−'})`;

function cells(a) {
  const dir = path.join(R, `arm_${tag(a)}`);
  let files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^cover_.*_d\d+\.json$/.test(f)).map(f => path.join(dir, f)) : [];
  if (!files.length && a.bp === 1 && a.bd < 0) files = fs.readdirSync(R).filter(f => /^cover_.*_d6\.json$/.test(f)).map(f => path.join(R, f));
  const leaves = [];
  for (const f of files) leaves.push(...JSON.parse(fs.readFileSync(f)).leaves);
  return leaves.sort((p, q) => p.a - q.a);
}
// targets up to the arm's limit only: beyond it the engine plays a shorter move (see check-vs-samples.js)
function sampled(a) {
  const f = path.join(__dirname, 'six-arms', 'data', `red-0m-123_b${a.bp}_${a.bd}.csv`);
  return fs.readFileSync(f, 'utf8').trim().split('\n').slice(1).map(r => r.split(',').map(Number))
    .filter(v => v[0] <= a.limit).map(v => [v[0], v[3]]).sort((p, q) => p[0] - q[0]);
}

const PW = 440, PH = 190, ML = 52, MR = 14, MT = 34, MB = 38, GX = 26, GY = 30, COLS = 2;
const W = ML + COLS * PW + (COLS - 1) * GX + MR, rowsN = Math.ceil(ARMS.length / COLS), H = 64 + MT + (rowsN - 1) * (PH + MT + MB + GY) + PH + MB;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">How far past the rim red's reply throws blue, for every blue move</title>
<desc id="d">Six panels, one per blue arm. The horizontal axis is blue's stop angle, the vertical axis is how far blue's worst foot ends beyond the rim after red's (0,−) reply of 123 substeps. A thin line is the engine at sampled stops; filled steps are proved lower bounds from Taylor-model cells. Every value is above zero.</desc>
<style>
  svg { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --grid:#e6e5e1; --line:#2a78d6; --fill:#b7d3f6; }
  @media (prefers-color-scheme: dark) { svg { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --grid:#33332f; --line:#3987e5; --fill:#254a78; } }
  .bg{fill:var(--surface)} .t1{font:600 18px system-ui,sans-serif;fill:var(--ink)} .t2{font:13px system-ui,sans-serif;fill:var(--ink2)}
  .ax{font:11px system-ui,sans-serif;fill:var(--ink2)} .pt{font:600 13px system-ui,sans-serif;fill:var(--ink)} .grid{stroke:var(--grid);stroke-width:1}
  .line{fill:none;stroke:var(--line);stroke-width:1.2} .fill{fill:var(--fill)}
</style>
<rect class="bg" width="${W}" height="${H}"/>
<text class="t1" x="${ML}" y="28">How far past the rim red's reply throws blue</text>
<text class="t2" x="${ML}" y="48">Blue's worst foot, in board units beyond the rim, after red's (0,−) reply of 123 substeps. Line: engine samples. Steps: proved lower bounds.</text>
`;
ARMS.forEach((a, i) => {
  const col = i % COLS, row = Math.floor(i / COLS);
  const x0 = ML + col * (PW + GX), y0 = 64 + MT + row * (PH + MT + MB + GY);
  const cs = cells(a), sm = sampled(a);
  const xmax = a.limit, ymaxRaw = Math.max(...sm.map(r => r[1]), ...cs.map(c => c.m), 1);
  const ymax = Math.ceil(ymaxRaw / 5) * 5 || 5;
  const X = v => x0 + (v - 2) / (xmax - 2) * PW, Y = v => y0 + PH - Math.max(0, v) / ymax * PH;
  svg += `<text class="pt" x="${x0}" y="${y0 - 12}">blue ${name(a)}: ${cs.length ? `${cs.length.toLocaleString('en')} cells, proved margin ≥ ${Math.min(...cs.map(c => c.m)).toFixed(2)}` : 'not yet proved'}</text>\n`;
  for (let g = 0; g <= ymax; g += ymax / 5) svg += `<line class="grid" x1="${x0}" x2="${x0 + PW}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}"/><text class="ax" x="${x0 - 6}" y="${(Y(g) + 4).toFixed(1)}" text-anchor="end">${+g.toFixed(1)}</text>\n`;
  const step = xmax > 30 ? 10 : (xmax > 8 ? 2 : 1);
  for (let g = Math.ceil(2 / step) * step; g <= xmax; g += step) svg += `<text class="ax" x="${X(g).toFixed(1)}" y="${y0 + PH + 16}" text-anchor="middle">${g}°</text>\n`;
  if (cs.length) {
    let d = `M ${X(cs[0].a).toFixed(1)} ${Y(0).toFixed(1)}`;
    for (const c of cs) d += ` L ${X(c.a).toFixed(1)} ${Y(c.m).toFixed(1)} L ${X(Math.min(c.b, xmax)).toFixed(1)} ${Y(c.m).toFixed(1)}`;
    d += ` L ${X(Math.min(cs[cs.length - 1].b, xmax)).toFixed(1)} ${Y(0).toFixed(1)} Z`;
    svg += `<path class="fill" d="${d}"><title>${esc(`proved lower bound, ${cs.length} cells`)}</title></path>\n`;
  }
  if (sm.length) svg += `<polyline class="line" points="${sm.filter((r, k) => k % Math.ceil(sm.length / 700) === 0).map(r => `${X(r[0]).toFixed(1)},${Y(r[1]).toFixed(1)}`).join(' ')}"/>\n`;
  svg += `<line class="grid" x1="${x0}" x2="${x0 + PW}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" style="stroke-width:1.6"/>\n`;
  svg += `<text class="ax" x="${x0 + PW / 2}" y="${y0 + PH + 32}" text-anchor="middle">blue's stop angle</text>\n`;
});
svg += '</svg>\n';
fs.writeFileSync(path.join(R, 'margins.svg'), svg);
console.log('wrote results/margins.svg');
