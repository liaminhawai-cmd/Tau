// Narrow the cells of a cover where the witness swing's legality is not shown, so legal-red can show it.
// A wide cell's red enclosure can be wider than red's per-substep motion, and then legal-red cannot see a
// contact window's radius move monotonically (or an episode's contact as certain). Halves have tighter
// enclosures. Each failing cell is split in two, each half is proved again by cover2's cover() (which
// splits further if the margin needs it and records the options that proved it), and legality is
// checked on the new cells, recursively down to a minimum width. The cover file is rewritten with the
// refined cells in place of their parents; `legalRefined` records every replacement and `legalFails`
// every cell whose legality is still not shown.
//   PROBLEM=<name> SYMREM=1 VTX=1 node legal-refine.js <bluePivot> <blueDir> <cover file> [degree=4] [minWidth=1e-4]
'use strict';
const fs = require('fs');
const { cover } = require('./cover2.js');
const { checkCell } = require('./legal-red.js');

const [bp, bd] = process.argv.slice(2, 4).map(Number);
const file = process.argv[4];
const deg = +(process.argv[5] || 4), minW = +(process.argv[6] || 1e-4);
const base = { ...(process.env.SYMREM ? { symRem: true } : {}), ...(process.env.VTX ? { vertexDedup: true } : {}) };
const data = JSON.parse(fs.readFileSync(file));
const refined = data.legalRefined || [], legalFails = [], marginFails = [];

function legal(c) {
  try { return checkCell(bp, bd, c.a, c.b, deg, c.mode, c.sym, c.vtx); }
  catch (e) { return { ok: false, why: 'model stopped: ' + e.message.slice(0, 100) }; }
}
// the cells that replace cell c, every one with its legality shown (or recorded as not shown at minW)
function refine(c, why) {
  if (c.b - c.a <= minW) { legalFails.push({ a: c.a, b: c.b, why }); return [c]; }
  const m = 0.5 * c.a + 0.5 * c.b, out = [];
  for (const [a, b] of [[c.a, m], [m, c.b]]) {
    const res = cover(bp, bd, a, b, deg, 1e-5, undefined, base);
    marginFails.push(...res.fails);
    for (const leaf of res.leaves) {
      const v = legal(leaf);
      if (v.ok) out.push(leaf); else out.push(...refine(leaf, v.why));
    }
  }
  return out;
}

const leaves = [];
let checked = 0;
for (const c of data.leaves) {
  checked++;
  const v = legal(c);
  if (v.ok) { leaves.push(c); continue; }
  const repl = refine(c, v.why);
  refined.push({ a: c.a, b: c.b, why: v.why, into: repl.length });
  leaves.push(...repl);
}
leaves.sort((p, q) => p.a - q.a);
data.leaves = leaves;
data.fails = (data.fails || []).concat(marginFails);
data.legalRefined = refined;
fs.writeFileSync(file, JSON.stringify(data));
console.log(JSON.stringify({ file, checked, refinedCells: refined.length, cellsNow: leaves.length, legalFails, marginFails: marginFails.length, minMargin: Math.min(...leaves.map(l => l.m)) }, null, 1));
