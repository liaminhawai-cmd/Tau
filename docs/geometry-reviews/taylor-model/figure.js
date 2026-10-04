// Figure: the proved cells across a range of defender angles (results/*.json), with the engine's
// own margin sampled for reference.  node figure.js [from=2] [to=16.5]  ->  results/arm-cover.svg
'use strict';
const fs = require('fs'), path = require('path');
const from = +(process.argv[2] || 2), to = +(process.argv[3] || 16.5);
const dir = path.join(__dirname, 'results');
const leaves = [];
for (const f of fs.readdirSync(dir)) if (/^cover_.*_d\d+\.json$/.test(f)) leaves.push(...JSON.parse(fs.readFileSync(path.join(dir, f))).leaves);
leaves.sort((p, q) => p.a - q.a);
const cells = leaves.filter(l => l.a >= from && l.b <= to);

// the engine's margin for red's (0,-) reply, sampled every 0.01 degree
const { createEngine } = require(path.join(__dirname, '../../../nn/engine.js'));
const eng = createEngine();
const S = [-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442];
const samples = [];
for (let a = from; a <= to + 1e-9; a += 0.01) {
  const G = eng.newGame(); const [B, R] = G.pieces;
  B.x = S[0]; B.y = S[1]; B.rot = S[2]; R.x = S[3]; R.y = S[4]; R.rot = S[5]; G.active = 0;
  eng.applyPlanSearch({ pivotIdx: 1, dir: -1, targetRad: a * Math.PI / 180 });
  eng.pinFoot(0); let g = 0; while (!G.atLimit && g++ < 400) eng.applySwing(-3 * Math.PI / 180);
  samples.push([a, Math.max(...G.pieces[0].feet().map(f => Math.hypot(f.x, f.y))) - 67.167]);
}

let maxGap = 0;
for (const [a, m] of samples) { const c = cells.find(c => c.a <= a && a <= c.b); if (c) maxGap = Math.max(maxGap, m - c.m); }
const W = 960, H = 624, L = 72, Rm = 28, T = 116;
const A = { top: T, h: 270 }, Bp = { top: T + 270 + 64, h: 130 };
const x = a => L + (a - from) / (to - from) * (W - L - Rm);
const yMax = 4.5, yA = m => A.top + A.h - m / yMax * A.h;
const wMin = 0.001, wMax = 0.5, yB = w => Bp.top + Bp.h - Math.log10(w / wMin) / Math.log10(wMax / wMin) * Bp.h;
const f3 = v => v.toFixed(1);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
let s = '';
s += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Proved throw margin across blue's arm (1,−)</title>
<desc id="d">${cells.length} proved cells tile ${from} to ${to} degrees; each cell's lower bound on red's throw margin is drawn as a step, with the engine's margin sampled every 0.01 degree for reference. A lower panel shows each cell's width on a log scale.</desc>
<style>
  svg { --surface: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --muted: #8a8984; --grid: #e6e5e1; --s1: #2a78d6; --s2: #eb6834; --ref: #a3a29d; }
  @media (prefers-color-scheme: dark) { svg { --surface: #1a1a19; --ink: #ffffff; --ink2: #c3c2b7; --muted: #8f8e86; --grid: #33332f; --s1: #3987e5; --s2: #d95926; --ref: #6f6e68; } }
  .bg { fill: var(--surface); } .t1 { font: 600 18px system-ui, sans-serif; fill: var(--ink); }
  .t2 { font: 13px system-ui, sans-serif; fill: var(--ink2); } .ax { font: 12px system-ui, sans-serif; fill: var(--ink2); }
  .lab { font: 600 12px system-ui, sans-serif; fill: var(--ink2); } .grid { stroke: var(--grid); stroke-width: 1; }
  .base { stroke: var(--ink2); stroke-width: 1; } .ref { fill: none; stroke: var(--ref); stroke-width: 1.5; }
  .proved { stroke: var(--s1); stroke-width: 2; stroke-linecap: round; } .c1 { fill: var(--s1); } .c2 { fill: var(--s2); }
  .gpt { stroke: var(--ink2); stroke-width: 1.5; stroke-dasharray: 5 4; }
</style>
<rect class="bg" width="${W}" height="${H}"/>
<text class="t1" x="${L}" y="34">Proved throw margin across blue's arm (1,−)</text>
<text class="t2" x="${L}" y="56">Brief 6 seed, red replies (0,−) to its limit. ${cells.length} proved cells tile ${from}°–${to}°. Each cell's lower bound sits within ${maxGap.toFixed(3)}u of the</text>\n<text class="t2" x="${L}" y="74">engine's margin sampled every 0.01° (the gray line, almost entirely hidden under the blue).</text>
`;
// panel A: grid, axes
for (let m = 0; m <= 4; m++) s += `<line class="grid" x1="${L}" x2="${W - Rm}" y1="${f3(yA(m))}" y2="${f3(yA(m))}"/><text class="ax" x="${L - 8}" y="${f3(yA(m) + 4)}" text-anchor="end">${m}</text>\n`;
s += `<line class="base" x1="${L}" x2="${W - Rm}" y1="${f3(yA(0))}" y2="${f3(yA(0))}"/>`;
s += `<text class="lab" x="${L}" y="${A.top - 10}">Margin past the board edge (u) — above 0 means blue's foot goes off</text>\n`;
// engine samples
s += `<polyline class="ref" points="${samples.map(([a, m]) => `${f3(x(a))},${f3(yA(m))}`).join(' ')}"/>\n`;
// proved steps
for (const c of cells) s += `<line class="proved" x1="${f3(x(c.a))}" x2="${f3(Math.max(x(c.b), x(c.a) + 0.6))}" y1="${f3(yA(c.m))}" y2="${f3(yA(c.m))}"><title>${esc(`${c.a.toFixed(5)}°–${c.b.toFixed(5)}°: margin ≥ ${c.m.toFixed(4)}u${c.branches > 1 ? `, ${c.branches} branches` : ''}`)}</title></line>\n`;
// legend A (direct labels at the right end)
const lastS = samples[samples.length - 1];
s += `<line class="proved" x1="${W - Rm - 250}" x2="${W - Rm - 226}" y1="${A.top + 18}" y2="${A.top + 18}"/><text class="ax" x="${W - Rm - 220}" y="${A.top + 22}">proved lower bound, per cell</text>`;
s += `<line class="ref" x1="${W - Rm - 250}" x2="${W - Rm - 226}" y1="${A.top + 38}" y2="${A.top + 38}"/><text class="ax" x="${W - Rm - 220}" y="${A.top + 42}">engine margin, every 0.01°</text>\n`;
void lastS;
// panel B: cell widths, log scale
for (const w of [0.001, 0.01, 0.1]) s += `<line class="grid" x1="${L}" x2="${W - Rm}" y1="${f3(yB(w))}" y2="${f3(yB(w))}"/><text class="ax" x="${L - 8}" y="${f3(yB(w) + 4)}" text-anchor="end">${w}°</text>\n`;
s += `<text class="lab" x="${L}" y="${Bp.top - 10}">Cell width (log scale)</text>\n`;
for (const c of cells) {
  const x0 = x(c.a) + 1, x1 = Math.max(x(c.b) - 1, x0 + 0.8), y0 = yB(c.b - c.a);
  s += `<rect class="${c.branches > 1 ? 'c2' : 'c1'}" x="${f3(x0)}" y="${f3(y0)}" width="${f3(x1 - x0)}" height="${f3(Bp.top + Bp.h - y0)}" rx="1"><title>${esc(`${c.a.toFixed(5)}°–${c.b.toFixed(5)}°: width ${(c.b - c.a).toFixed(5)}°${c.branches > 1 ? `, ${c.branches} branches` : ''}`)}</title></rect>\n`;
}
s += `<line class="base" x1="${L}" x2="${W - Rm}" y1="${f3(Bp.top + Bp.h)}" y2="${f3(Bp.top + Bp.h)}"/>`;
const gptW = 1 / 240;
s += `<line class="gpt" x1="${L}" x2="${W - Rm}" y1="${f3(yB(gptW))}" y2="${f3(yB(gptW))}"/>`;
s += `<rect class="c1" x="${W - Rm - 250}" y="${Bp.top - 26}" width="12" height="10" rx="1"/><text class="ax" x="${W - Rm - 233}" y="${Bp.top - 17}">one branch</text>`;
s += `<rect class="c2" x="${W - Rm - 160}" y="${Bp.top - 26}" width="12" height="10" rx="1"/><text class="ax" x="${W - Rm - 143}" y="${Bp.top - 17}">separate branches</text>`;
s += `<line class="gpt" x1="${W - Rm - 470}" x2="${W - Rm - 446}" y1="${Bp.top - 21}" y2="${Bp.top - 21}"/><text class="ax" x="${W - Rm - 440}" y="${Bp.top - 17}">ARM1's average cell, 8°–9°</text>\n`;
// shared x axis
for (let a = Math.ceil(from); a <= to; a++) s += `<line class="grid" x1="${f3(x(a))}" x2="${f3(x(a))}" y1="${Bp.top + Bp.h}" y2="${Bp.top + Bp.h + 5}"/><text class="ax" x="${f3(x(a))}" y="${Bp.top + Bp.h + 20}" text-anchor="middle">${a}°</text>\n`;
s += `<text class="lab" x="${(L + W - Rm) / 2}" y="${H - 12}" text-anchor="middle">Blue's stop angle α on arm (1,−)</text>\n</svg>\n`;
fs.writeFileSync(path.join(dir, 'arm-cover.svg'), s);
console.log(`wrote results/arm-cover.svg: ${cells.length} cells, ${samples.length} engine samples`);
