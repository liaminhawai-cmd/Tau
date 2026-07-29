// Which of the inputs is a trained net actually leaning on? Sums the absolute weight magnitude
// flowing OUT of each input neuron into the first hidden layer -- a blunt but standard saliency
// proxy: an input the net has learned to ignore ends up with small weights on every connection out
// of it, one it leans on tends to have at least some large ones. Not a substitute for a real
// ablation study, but cheap and revealing at a glance.
//
//   node nn/feature-importance.js models/best.json [--top 20]
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const modelPath = process.argv[2];
const top = +arg('top', 25);
if (!modelPath || modelPath.startsWith('--')) {
  console.error('usage: node nn/feature-importance.js <model.json> [--top 25]');
  process.exit(1);
}

const j = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
if (!j.sizes || !j.W || !j.W[0]) { console.error('not a valid net JSON (missing sizes/W)'); process.exit(1); }
const nIn = j.sizes[0], nOut = j.sizes[1];
if (nIn !== 94 && nIn !== 88 && nIn !== 82)
  console.warn(`warning: this net takes ${nIn} inputs -- the names below assume the current features.js layout and may not line up`);
if (nIn === 82)
  console.warn(`note: 82-input net (pre-L11-parity feature set) -- block D names don't apply`);
if (nIn === 88)
  console.warn(`note: 88-input net (pre-per-foot-zone feature set) -- the last 6 block D names don't apply`);

// Names in the exact push order features.js builds them, so index i here IS input i.
const NAMES = [
  // Block A -- 16, canonicalized piece-relative geometry
  'A: my hub distance', 'A: my orientation cos', 'A: my orientation sin',
  'A: opp hub X (my frame)', 'A: opp hub Y (my frame)', 'A: opp orientation cos', 'A: opp orientation sin',
  'A: hub-to-hub distance',
  'A: my foot 1 (outer) dist', 'A: my foot 2 (mid) dist', 'A: my foot 3 (inner) dist',
  'A: opp foot 1 (outer) dist', 'A: opp foot 2 (mid) dist', 'A: opp foot 3 (inner) dist',
  'A: my rim margin', 'A: opp rim margin',
];
// Block B -- 30, 5 numbers x 6 feet (my outer/mid/inner, then opp outer/mid/inner)
const bSub = ['ring1 dist', 'ring2 dist', 'side-arc dist', 'parked indicator', 'nearest intersection'];
const bFeet = ['my foot1 (outer)', 'my foot2 (mid)', 'my foot3 (inner)', 'opp foot1 (outer)', 'opp foot2 (mid)', 'opp foot3 (inner)'];
for (const f of bFeet) for (const s of bSub) NAMES.push(`B: ${f} ${s}`);
// Block C -- 36, 3 numbers x 3 pivots x 2 dirs x 2 pieces (me, opp)
const cSub = ['1st crossing angle', '2nd crossing angle', 'rim-out angle'];
for (const who of ['me', 'opp'])
  for (let pv = 0; pv < 3; pv++)
    for (const dir of ['+', '-'])
      for (const s of cSub) NAMES.push(`C: ${who} pivot${pv} dir${dir} ${s}`);
// Block D -- 12 L11-parity terms
NAMES.push('D: my zone score (sum)', 'D: opp zone score (sum)',
           'D: my foot1 (outer) zone', 'D: my foot2 (mid) zone', 'D: my foot3 (inner) zone',
           'D: opp foot1 (outer) zone', 'D: opp foot2 (mid) zone', 'D: opp foot3 (inner) zone',
           'D: my line freedom', 'D: opp line freedom',
           'D: triangle angle (mine)', 'D: triangle angle (opp)');

const scores = new Array(nIn).fill(0);
const W = j.W[0]; // flattened [nOut][nIn], row-major per net.js: W[j*nIn+i]
for (let jn = 0; jn < nOut; jn++)
  for (let i = 0; i < nIn; i++)
    scores[i] += Math.abs(W[jn * nIn + i] || 0);

const ranked = scores.map((s, i) => ({ i, s, name: NAMES[i] || `input ${i}` }))
  .sort((a, b) => b.s - a.s);

console.log(`${path.basename(modelPath)}: ${nIn} inputs -> ${nOut} first-layer units\n`);
console.log(`top ${Math.min(top, ranked.length)} by summed |outgoing weight|:`);
const maxS = ranked[0].s;
for (const r of ranked.slice(0, top)) {
  const bar = '#'.repeat(Math.max(1, Math.round(30 * r.s / maxS)));
  console.log(`  ${String(r.i).padStart(2)}  ${r.s.toFixed(3).padStart(7)}  ${bar.padEnd(30)}  ${r.name}`);
}

// Block-level summary: which of A/B/C is carrying the most total weight, and on average per input
// (raw totals would just favour whichever block has more inputs -- block C has more than 2x
// block A's count, so total alone isn't a fair comparison).
const blocks = { A: [0, 16], B: [16, 46], C: [46, 82], D: [82, 94] };
console.log('\nby block (total and mean |outgoing weight| per input):');
for (const [name, [lo, hi]] of Object.entries(blocks)) {
  if (hi > nIn) continue;
  const slice = scores.slice(lo, hi);
  const total = slice.reduce((a, b) => a + b, 0);
  console.log(`  ${name}: total ${total.toFixed(2)}, mean ${(total/slice.length).toFixed(3)} (${slice.length} inputs)`);
}
