'use strict';
// Astra's Brief 5 region criterion, at the smallest scale that is useful: a REPLY GAP.
//
// forced-win.js certifies a reply interval by finding ONE arc that covers it. 136 of the 1306
// screened seeds failed for exactly that reason -- "no single arc certifies the gap ... the throw
// changes arm here" -- and the failure is the method's, not necessarily the position's. Brief 5's
// answer: do not demand one arc. Cover the victim's legal replies with FINITELY MANY patches, each
// carrying its own verified winning response. Overlap is allowed. An arm change inside the gap then
// becomes a patch boundary instead of a refusal.
//
// This walks a gap at fixed stops and records, at each one, which attacker arms throw. If every
// sampled stop has a winner the gap is COVERED, and the number of maximal constant-arm runs is the
// number of patches the cover needs.
//
//   node nn/gap-cover.js <screened.jsonl> <out.jsonl> [stopsPerGap=25]
//
// SAMPLED, NOT PROVED. A dense sample in which every stop has a winning response is evidence that
// the gap is covered; it is not a theorem about the whole interval. Turning a run into a proof
// needs the endpoint margins and enclosure bounds Brief 5 section 5 asks for. What this DOES settle
// is whether the single-arc refusal was hiding a real escape or just an arm change.
const fs = require('fs');
const F = require('./forced-win.js');
const DEG = Math.PI / 180;
const [, , inPath, outPath, nArg] = process.argv;
const N = Math.max(3, +(nArg || 25));

const WHY = /reply \((\d),(-?\d)\) ([\d.]+)-([\d.]+)deg/;
const rows = fs.readFileSync(inPath, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => JSON.parse(l))
  .filter(r => r.status === 'unresolved' && WHY.test(String(r.why || '')));
console.log(`${rows.length} unresolved gaps, ${N} stops each`);

const rnd = Math.random;
let covered = 0, single = 0, escaped = 0, uncovered = 0;
for (const r of rows) {
  const m = WHY.exec(r.why), pv = +m[1], dir = +m[2], lo = +m[3], hi = +m[4];
  const pieces = [{ x: r.p[0], y: r.p[1], rot: r.p[2] }, { x: r.p[3], y: r.p[4], rot: r.p[5] }];
  const attacker = 1 - r.mover;
  const stops = [], armsAt = [];
  let victimThrew = null, gapCovered = true;
  Math.random = () => 1;                       // 1-degree calls + final remainder, as verify-dead does
  for (let i = 0; i < N; i++) {
    const deg = lo === hi ? lo : lo + (hi - lo) * i / (N - 1);
    const g = F.load(pieces, r.mover);
    if (F.dragTo(g, attacker, dir, deg * DEG, 1)) { victimThrew = deg; gapCovered = false; break; }
    const after = g.pieces.map(p => ({ x: p.x, y: p.y, rot: p.rot }));
    const hit = F.ARMS.filter(([apv, adir]) => F.sweepThrows(after, attacker, apv, adir))
                      .map(([a, b]) => `${a},${b}`);
    if (!hit.length) { gapCovered = false; stops.push(deg); armsAt.push([]); break; }
    stops.push(deg); armsAt.push(hit);
  }
  Math.random = rnd;
  // patches = maximal runs over which one arm keeps winning (greedy: hold an arm while it still wins)
  let patches = 0, held = null;
  for (const hit of armsAt) { if (!held || !hit.includes(held)) { patches++; held = hit[0]; } }
  const allArms = armsAt.length ? armsAt.reduce((a, h) => a.filter(x => h.includes(x)), armsAt[0]) : [];
  const status = victimThrew !== null ? 'reply-throws-attacker' : gapCovered ? 'covered' : 'gap-uncovered';
  if (status === 'covered') { covered++; if (allArms.length) single++; }
  else if (status === 'reply-throws-attacker') escaped++; else uncovered++;
  fs.appendFileSync(outPath, JSON.stringify({
    p: r.p, mover: r.mover, g: r.g, reply: [pv, dir], gapDeg: [lo, hi], stops: stops.length,
    status, patches: status === 'covered' ? patches : null,
    oneArmCoversAll: allArms.length ? allArms[0] : null, victimThrewAt: victimThrew,
  }) + '\n');
}
console.log(`covered ${covered}/${rows.length}  (of which ${single} by a SINGLE arm)`);
console.log(`gap-uncovered ${uncovered}, reply throws the attacker ${escaped}`);
