// arena.js's gate/benchmark and tournament.js's round robin pit two fully-deterministic brains
// (nn at temperature 0, or a noise-free ladder level like L8) against each other from the exact
// same fixed starting position -- so without this, "24 games" or "12 games/pair" is really just 2
// distinct games (one per starting colour) replayed N times over, and a result like 24-0 or 0-24
// is 2 bits of information dressed up as a percentage. A couple of forced random opening plies
// (same "pick a random legal swing" shape the ladder's own noise fallback uses) give every game a
// genuinely different midgame to start the real brains from, so a win rate actually means something.
'use strict';

function randomOpeningPlan(eng) {
  const snap = eng.takeSnap();
  const restore = () => {
    const g = eng.getG();
    g.pieces.forEach((p, i) => { p.x = snap[i].x; p.y = snap[i].y; p.rot = snap[i].rot; });
    g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
  };
  for (let tries = 0; tries < 8; tries++) {
    const pv = Math.floor(Math.random()*3), dir = Math.random() < 0.5 ? 1 : -1;
    const lim = eng.simMoveToLimit(pv, dir);
    restore();
    if (Math.abs(lim) < 2*Math.PI/180) continue;
    return { pivotIdx: pv, dir, targetRad: lim*(0.3 + Math.random()*0.6) };
  }
  return null;
}

// one forced ply per side by default, so both colours start from a shuffled position
function playRandomOpening(eng, plies) {
  for (let i = 0; i < plies; i++) {
    const plan = randomOpeningPlan(eng);
    if (plan) eng.applyPlan(plan);
  }
}

module.exports = { randomOpeningPlan, playRandomOpening };
