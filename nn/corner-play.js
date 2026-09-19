// Play one of the corner lines for one side and print every plan, the pose after it and the book,
// so a line can be checked against a human's demonstration and against itself before and after a
// code change. Math.random is pinned to a constant, so the coin and any rung noise are reproducible
// and two runs of the same arguments are comparable line by line.
//
//   node nn/corner-play.js [back|front|true] [rnd 0..1] [who 0=blue 1=red] [plies] [rung|small]
//
// 'small' makes the OTHER side play a fixed 10-degree back-foot swing instead of L7 -- a non-blocking
// opponent, for checking the line's own mechanics rather than its survival against a reply.
'use strict';
const line = process.argv[2] || 'back';          // 'back' | 'front' | 'true'
const rnd = +(process.argv[3] || 0.1);
const who = +(process.argv[4] || 0);             // 0 = blue plays the line, 1 = red plays it
const plies = +(process.argv[5] || 6);
const redMode = process.argv[6] || 'rung';   // 'rung' = L7 plays; 'small' = the other side plays a fixed 10-degree back-foot swing (non-blocking, for checking the line's own mechanics)
Math.random = () => rnd;
const { createEngine } = require('./engine.js');
const e = createEngine(); e.newGame();
const g = e.getG();
g.cornerOpening = [null, null];
g.cornerOpening[who] = line === 'true' ? true : line;
g.cornerOpening[1 - who] = false;
const L = { 0: 10, 1: 6 };                         // blue = L11, red = L7 (0-based levelIdx)
const fx = f => `(${f.x.toFixed(1)},${f.y.toFixed(1)})`;
for (let p = 0; p < plies; p++) {
  const idx = g.active;
  let plan;
  if (redMode === 'small' && idx !== who) { const s0 = e.takeSnap(); const lim = e.simMoveToLimit(1, idx === 0 ? -1 : 1); e.restoreSnap(s0); plan = { pivotIdx: 1, dir: idx === 0 ? -1 : 1, targetRad: Math.min(Math.abs(lim), 10 * Math.PI / 180) }; }
  else plan = e.ladderPlanFor(L[idx], idx);
  const bk = g.cornerBook && g.cornerBook[idx];
  const before = g.pieces[idx].feet().map(fx).join(' ');
  e.applyPlan(plan);
  const me = g.pieces[idx];
  const after = me.feet().map(fx).join(' ');
  console.log(`ply ${p} ${idx === 0 ? 'BLUE' : 'RED '} pv${plan.pivotIdx} dir${plan.dir > 0 ? '+' : '-'} ${(Math.abs(plan.targetRad) * 180 / Math.PI).toFixed(1)}deg` +
    `  feet ${before} -> ${after}  hub r=${Math.hypot(me.x, me.y).toFixed(1)}` +
    (idx === who ? `  book=${JSON.stringify(bk && { at: bk.at, line: bk.line, pv: bk.pivotIdx, dir: bk.dir, cross: bk.crossFoot, trail: bk.trailFoot, corner: bk.corner, third: bk.thirdDir, solved: bk.solved })} done=${g.cornerDone && g.cornerDone[who]}` : ''));
  if (g.over) { console.log('game over, winner', g.winner); break; }
}
