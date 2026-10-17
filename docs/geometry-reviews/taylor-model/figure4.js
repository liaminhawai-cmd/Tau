// The outcome field on the board. Every point is where blue's worst foot ends after red's (0,-) reply, for
// one blue stop angle on one of its six arms (every 0.05 degrees, from the engine); the thin curves are
// where blue's hub stands after its own reply. The solid circle is the rim, the dashed one the rim plus the
// engine's 0.5u tolerance: past it the piece is off. Every point lies outside.
//   node figure4.js   ->  results/outcome-field.svg
'use strict';
const fs = require('fs'), path = require('path');
const { createEngine } = require(path.join(__dirname, '../../../nn/engine.js'));
const eng = createEngine();
const CFG = eng.CFG, EDGE = CFG.edgeU + CFG.edgeEps, RIM = CFG.edgeU;
const SEED = [-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442];
const STEP3 = 3 * Math.PI / 180, DELTA = STEP3 / 8, R = CFG.footR;
const ARMS = [
  { bp: 0, bd: -1, B: 63.692659668, col: '#2a78d6', dcol: '#3987e5' }, { bp: 0, bd: 1, B: 44.343482055, col: '#d95f0e', dcol: '#f08a3c' },
  { bp: 1, bd: -1, B: 16.826501816, col: '#1b9e77', dcol: '#3cc79c' }, { bp: 1, bd: 1, B: 14.788562189, col: '#7570b3', dcol: '#a29bdc' },
  { bp: 2, bd: -1, B: 15.975495885, col: '#c0392b', dcol: '#ee6b5c' }, { bp: 2, bd: 1, B: 4.996359600, col: '#8c6d00', dcol: '#d4b000' },
];
const name = a => `(${a.bp},${a.bd > 0 ? '+' : '−'})`;
function play(bp, bd, alphaDeg) {
  const G = eng.newGame(); const [B, Rd] = G.pieces;
  B.x = SEED[0]; B.y = SEED[1]; B.rot = SEED[2]; Rd.x = SEED[3]; Rd.y = SEED[4]; Rd.rot = SEED[5]; G.active = 0;
  eng.applyPlanSearch({ pivotIdx: bp, dir: bd, targetRad: alphaDeg * Math.PI / 180 });
  const hub = { x: B.x, y: B.y };
  eng.pinFoot(0);
  for (let k = 0; k < 123 && !G.atLimit; k++) eng.applySwing(-DELTA);
  const feet = B.feet(), worst = feet.reduce((m, f) => (Math.hypot(f.x, f.y) > Math.hypot(m.x, m.y) ? f : m));
  return { hub, worst };
}
const data = ARMS.map(a => {
  const pts = [];
  for (let al = 2; al < a.B; al += 0.05) pts.push({ al, ...play(a.bp, a.bd, al) });
  pts.push({ al: a.B, ...play(a.bp, a.bd, a.B - 1e-6) });
  return pts;
});
// view: the region the action is in (the dots, the hub curves and the two start tripods), with the rim through it
const tri = (x, y, rot) => [0, 1, 2].map(j => [x + R * Math.cos(rot + j * 2 * Math.PI / 3), y + R * Math.sin(rot + j * 2 * Math.PI / 3)]);
const xs = [], ys = [];
for (const pts of data) for (const p of pts) { xs.push(p.worst.x, p.hub.x); ys.push(p.worst.y, p.hub.y); }
for (const [x, y, rot] of [[SEED[0], SEED[1], SEED[2]], [SEED[3], SEED[4], SEED[5]]]) for (const f of tri(x, y, rot)) { xs.push(f[0]); ys.push(f[1]); }
const PAD = 6, x0v = Math.min(...xs) - PAD, x1v = Math.max(...xs) + PAD, y0v = Math.min(...ys) - PAD, y1v = Math.max(...ys) + PAD;
const SW = 760, M = 24, scale = (SW - 2 * M) / (x1v - x0v), SH = Math.round((y1v - y0v) * scale + 2 * M + 70);
const S = SW;
const X = v => M + (v - x0v) * scale, Y = v => 70 + (y1v - v) * scale;
const LEG = 96;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH + LEG}" width="${SW}" height="${SH + LEG}" role="img" aria-labelledby="t d">
<title id="t">Where blue ends after red's reply, for every blue move</title>
<desc id="d">The board with its rim, the start positions of blue and red, and for each of blue's six arms and each stop angle a point where blue's worst foot ends after red's (0,−) reply. All points lie outside the rim.</desc>
<style>
  svg { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --grid:#e6e5e1; --rim:#0b0b0b; --seedb:#2a78d6; --seedr:#c0392b; }
  @media (prefers-color-scheme: dark) { svg { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --grid:#33332f; --rim:#ffffff; --seedb:#3987e5; --seedr:#ee6b5c; } }
  .bg{fill:var(--surface)} .t1{font:600 18px system-ui,sans-serif;fill:var(--ink)} .t2{font:13px system-ui,sans-serif;fill:var(--ink2)}
  .ax{font:11px system-ui,sans-serif;fill:var(--ink2)} .rim{fill:none;stroke:var(--rim);stroke-width:1.6} .tol{fill:none;stroke:var(--rim);stroke-width:1;stroke-dasharray:4 3}
  .ring{fill:none;stroke:var(--grid);stroke-width:1} .seedb{fill:none;stroke:var(--seedb);stroke-width:1.6} .seedr{fill:none;stroke:var(--seedr);stroke-width:1.6}
  .lab{font:600 12px system-ui,sans-serif}
`;
ARMS.forEach((a, i) => { svg += `  .c${i}{fill:${a.col}} .h${i}{fill:none;stroke:${a.col};stroke-width:1;opacity:.55}\n`; });
svg += `  @media (prefers-color-scheme: dark) {\n`;
ARMS.forEach((a, i) => { svg += `    .c${i}{fill:${a.dcol}} .h${i}{stroke:${a.dcol}}\n`; });
svg += `  }\n</style>\n<rect class="bg" width="${SW}" height="${SH + LEG}"/>
<text class="t1" x="${M}" y="28">Where blue ends after red's reply, for every blue move</text>
<text class="t2" x="${M}" y="50">Each dot: blue's worst foot after red's (0,−) reply, one dot per 0.05° of blue's stop angle on each arm.</text>
`;
svg += `<clipPath id="v"><rect x="0" y="62" width="${SW}" height="${SH - 62}"/></clipPath><g clip-path="url(#v)">\n`;
for (const r of CFG.rings) svg += `<circle class="ring" cx="${X(0)}" cy="${Y(0)}" r="${(r * scale).toFixed(1)}"/>\n`;
svg += `<circle class="rim" cx="${X(0)}" cy="${Y(0)}" r="${(RIM * scale).toFixed(1)}"><title>rim, radius ${RIM}</title></circle>\n`;
svg += `<circle class="tol" cx="${X(0)}" cy="${Y(0)}" r="${(EDGE * scale).toFixed(1)}"><title>rim plus the engine's 0.5u tolerance: past this a foot is off</title></circle>\n`;
data.forEach((pts, i) => { svg += `<polyline class="h${i}" points="${pts.map(p => `${X(p.hub.x).toFixed(1)},${Y(p.hub.y).toFixed(1)}`).join(' ')}"/>\n`; });
for (const [x, y, rot, cls] of [[SEED[0], SEED[1], SEED[2], 'seedb'], [SEED[3], SEED[4], SEED[5], 'seedr']]) {
  const f = tri(x, y, rot);
  svg += `<polygon class="${cls}" points="${f.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/><circle class="${cls}" cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="3"/>\n`;
}
svg += `</g>\n`;
svg += `<text class="lab" x="${X(SEED[0]) - 8}" y="${Y(SEED[1]) + 30}" style="fill:var(--seedb)">blue</text><text class="lab" x="${X(SEED[3]) + 8}" y="${Y(SEED[4]) - 8}" style="fill:var(--seedr)">red</text>\n`;
data.forEach((pts, i) => { for (const p of pts) svg += `<circle class="c${i}" cx="${X(p.worst.x).toFixed(1)}" cy="${Y(p.worst.y).toFixed(1)}" r="2.3"/>\n`; });
// legend
ARMS.forEach((a, i) => { const x = M + (i % 2) * 360, y = SH + 8 + Math.floor(i / 2) * 20; svg += `<circle class="c${i}" cx="${x + 5}" cy="${y - 4}" r="4"/><text class="ax" x="${x + 16}" y="${y}">blue arm ${name(a)}: ${data[i].length} stops, 2° to ${a.B.toFixed(2)}°</text>\n`; });
svg += `<text class="ax" x="${M}" y="${SH + 80}">Thin curves: blue's hub after its own reply. Circles: the board's two printed rings, the rim (solid) and the rim plus 0.5u (dashed).</text>\n</svg>\n`;
fs.writeFileSync(path.join(__dirname, 'results', 'outcome-field.svg'), svg);
let inside = 0, total = 0;
for (const pts of data) for (const p of pts) { total++; if (Math.hypot(p.worst.x, p.worst.y) <= EDGE) inside++; }
console.log(`wrote results/outcome-field.svg: ${total} points, ${inside} inside the rim tolerance`);
