// The top rung's value nets, read off disk for Node.
//
// In the browser these arrive by fetch (see committeeLoadNet in index.html); the sandbox engine has
// no fetch, so the same compact export -- <name>.meta.json plus a Float32LE <name>.bin, written by
// export-committee-net.js -- is read straight from committee/ here. The unpack order MUST stay in
// step with committeeLoadNet's: all W layers, then all b layers.
//
// Injecting into eng.AI_LADDER is enough to make the committee rung playable offline: AI_LADDER is
// the very array the extracted engine runs on, and committeePlanGen only reaches for fetch when
// def._nets is still unset. So arena.js can point a brain at the committee rung and get exactly the
// move the shipped game would play -- which is the only way a claim about its strength is worth
// anything.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'committee');

function loadCommitteeNet(name) {
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, name + '.meta.json'), 'utf8'));
  const raw = fs.readFileSync(path.join(DIR, name + '.bin'));
  // Node hands back a Buffer over a pooled ArrayBuffer, hence the explicit offset/length.
  const flat = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const sizes = meta.sizes, fanIns = meta.fanIns, layers = sizes.length - 1;
  const W = [], b = [];
  let at = 0;
  for (let l = 0; l < layers; l++) { const n = fanIns[l] * sizes[l + 1]; W.push(Array.from(flat.subarray(at, at + n))); at += n; }
  for (let l = 0; l < layers; l++) { const n = sizes[l + 1]; b.push(Array.from(flat.subarray(at, at + n))); at += n; }
  return { sizes, fanIns, topology: meta.topology, W, b };
}

// Fills in every lazily-fetched net the ladder declares, for every rung that declares one. Both the
// committee rung and the plain net rung name their weights the same way (a `nets` list of committee/
// basenames), so one walk covers both and a future rung that adds weights needs no change here.
function equipLadderNets(eng) {
  const cache = new Map();
  const get = n => { if (!cache.has(n)) cache.set(n, loadCommitteeNet(n)); return cache.get(n); };
  for (const def of eng.AI_LADDER) {
    if (!def || !def.nets || def._nets) continue;
    // markCheapNet is what tells the Committee which members it can afford to run a look-ahead walk
    // with. The browser tags them as the fetch resolves; do the same here, or every member looks
    // expensive offline and the arena measures a Committee that never walks.
    def._nets = def.nets.map(get).map(n => (eng.markCheapNet ? eng.markCheapNet(n) : n));
  }
  return eng;
}

module.exports = { loadCommitteeNet, equipLadderNets };
