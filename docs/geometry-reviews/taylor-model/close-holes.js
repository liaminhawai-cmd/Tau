// Close the holes left in one arm's tiling: for each gap between proved cells, cover it again with a much
// smaller minimum cell width, first in the standard model and, for whatever is still open, with remToSym,
// then with remToSym and a hub resting on a leg vertex counted once (vertexDedup).
// Each pass writes its own cover file, so summary2 / audit2 see the new cells and nothing already proved
// is touched.   node close-holes.js <bluePivot> <blueDir> [degree=4] [minW=1e-9] [from] [to]
// With from/to only the gaps inside [from, to] are covered (the rest of the arm may still be in progress).
'use strict';
const fs = require('fs'), path = require('path');
const { cover } = require('./cover2.js');
const [bp, bd] = process.argv.slice(2, 4).map(Number);
const deg = +(process.argv[4] || 4), minW = +(process.argv[5] || 1e-9);
const lo = process.argv[6] !== undefined ? +process.argv[6] : -Infinity, hi = process.argv[7] !== undefined ? +process.argv[7] : Infinity;
const dir = path.join(__dirname, 'results', `arm_${bp}_${bd > 0 ? 'p' : 'm'}`);

function gaps() {
  const leaves = [];
  for (const f of fs.readdirSync(dir)) if (/^cover_.*_d\d+\.json$/.test(f)) leaves.push(...JSON.parse(fs.readFileSync(path.join(dir, f))).leaves);
  leaves.sort((p, q) => p.a - q.a);
  const out = [];
  for (let i = 1; i < leaves.length; i++) if (leaves[i].a !== leaves[i - 1].b) out.push([leaves[i - 1].b, leaves[i].a]);
  return out.filter(g => g[0] >= lo && g[1] <= hi);
}
let open = gaps();
console.log(`arm (${bp},${bd}): ${open.length} gap(s): ${open.map(g => `[${g[0]}, ${g[1]}]`).join(' ')}`);
for (const base of [{}, { symRem: true }, { symRem: true, vertexDedup: true }]) {
  const next = [];
  for (const [g0, g1] of open) {
    const res = cover(bp, bd, g0, g1, deg, minW, undefined, base);
    const tag = base.vertexDedup ? 'sym+vtx' : base.symRem ? 'sym' : 'std';
    console.log(`  [${g0}, ${g1}] ${tag}: ${res.leaves.length} cells, ${res.fails.length} failed, ${res.seconds}s`);
    // keep a pass's cells only if they tile the whole gap; otherwise keep nothing from it and try the next model
    if (!res.fails.length) {
      fs.writeFileSync(path.join(dir, `cover_${g0}_${g1}_d${deg}.json`), JSON.stringify({ leaves: res.leaves, fails: [] }));
    } else next.push([g0, g1]);
  }
  open = next;
  if (!open.length) break;
}
console.log(open.length ? `still open: ${open.map(g => `[${g[0]}, ${g[1]}]`).join(' ')}` : 'all holes closed');
process.exit(open.length ? 1 : 0);
