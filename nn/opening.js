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

// A position no sequence of legal moves from the canonical start would plausibly reach: each
// piece's hub is drawn uniformly from the disc that keeps every one of its feet on the board
// (radius edgeU minus footR minus the same edgeEps margin the engine itself uses), rotation
// uniform, then the pair is rejection-sampled on hub separation until the two pieces cannot be
// touching. This is deliberately a SUFFICIENT, not exact, legality check: real leg-to-leg contact
// is a tube-vs-tube distance the engine computes during a swing, and reimplementing that exactly
// here risks silently producing an illegal starting pose (which would poison training data far
// more quietly than a rejected sample ever could). The margin trades a bit of coverage right at
// the legal boundary for never being wrong about it -- measured empirically at ~26% acceptance per
// draw, so the retry loop below settles in a handful of tries almost always.
//
// The point of this (as opposed to playRandomOpening's few real plies from the fixed start) is
// coverage FAR from anything self-play's own trajectories would ever produce -- a piece parked
// hard against the rim with the opponent clear across the board is not a shape any real game
// passes through, but it's a shape the value net still has to score sensibly if it's ever asked
// to. See selfplay.js's --randomStartFrac.
function randomStartPose(eng) {
  const CFG = eng.CFG;
  const hubR = CFG.edgeU - CFG.footR - CFG.edgeEps;
  const minSep = 2*CFG.footR + 4*CFG.legRadius;   // extra margin beyond the bare sufficient bound
  const draw = () => {
    const r = hubR*Math.sqrt(Math.random()), a = Math.random()*2*Math.PI;   // uniform IN the disc, not on it
    return { x: r*Math.cos(a), y: r*Math.sin(a), rot: Math.random()*2*Math.PI };
  };
  let blue, red;
  for (let tries = 0; tries < 500; tries++) {
    blue = draw(); red = draw();
    if (Math.hypot(blue.x - red.x, blue.y - red.y) >= minSep) break;
  }
  const g = eng.getG();
  g.pieces[0].x = blue.x; g.pieces[0].y = blue.y; g.pieces[0].rot = blue.rot;
  g.pieces[1].x = red.x; g.pieces[1].y = red.y; g.pieces[1].rot = red.rot;
  g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
}

module.exports = { randomOpeningPlan, playRandomOpening, randomStartPose };
