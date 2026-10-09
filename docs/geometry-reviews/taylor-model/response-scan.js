// Empirical witness discovery only: sample the upper Target1 stop-angle range and
// try each fixed red arm. This is not an interval proof; its role is to choose candidate
// response patches for subsequent cover2.js runs.
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require(path.join(__dirname, '../../../nn/engine.js'));
const { fromEnv } = require('./problem.js');

const eng = createEngine();
const pr = fromEnv();
if (pr.firstMover !== 0) throw new Error('scan expects blue to move first');
const SEED = [pr.seed.blue.x, pr.seed.blue.y, pr.seed.blue.rot, pr.seed.red.x, pr.seed.red.y, pr.seed.red.rot];
const EDGE = eng.CFG.edgeU + eng.CFG.edgeEps;
const STEP3 = 3 * Math.PI / 180;
const DELTA = STEP3 / 8;
const [a0 = 9.73, a1 = 14.33, step = 0.1, bp = 2, bd = 1] = process.argv.slice(2).map(Number);

function angles(from, to, h) {
  const out = [];
  for (let i = 0; from + i * h < to - 1e-10; i++) out.push(Number((from + i * h).toFixed(8)));
  if (!out.length || Math.abs(out[out.length - 1] - to) > 1e-8) out.push(to);
  return out;
}
function marginOf(piece) {
  return Math.max(...piece.feet().map(f => Math.hypot(f.x, f.y))) - EDGE;
}
function simulate(alpha, pivot, dir) {
  const G = eng.newGame();
  const [B, R] = G.pieces;
  B.x = SEED[0]; B.y = SEED[1]; B.rot = SEED[2];
  R.x = SEED[3]; R.y = SEED[4]; R.rot = SEED[5];
  G.active = pr.firstMover;
  eng.applyPlanSearch({ pivotIdx: bp, dir: bd, targetRad: alpha * Math.PI / 180 });
  const reached = Math.abs(G.pieces[0].rot - SEED[2]) * 180 / Math.PI;
  const blueAtLimit = !!G.atLimit;
  const blueWon = !!G.over;
  if (blueAtLimit || blueWon || Math.abs(reached - alpha) > 1e-6) {
    return { alpha, pivot, dir, reached, blueAtLimit, blueWon, legalTarget: false, wins: false, k: 0, margin: marginOf(B) };
  }
  eng.pinFoot(pivot);
  let k = 0, lastMargin = marginOf(B);
  while (k < pr.kRed && !G.atLimit && !G.over) {
    eng.applySwing(dir * DELTA);
    k++;
    lastMargin = marginOf(B);
    // Count only a move that was legal or one that ended the game by throwing Blue.
    if (lastMargin > 0 && (G.over || !G.atLimit)) {
      return { alpha, pivot, dir, reached, blueAtLimit: false, blueWon: false, legalTarget: true, wins: true, k, margin: lastMargin, gameOver: !!G.over };
    }
  }
  return { alpha, pivot, dir, reached, blueAtLimit: false, blueWon: false, legalTarget: true, wins: false, k, margin: lastMargin, redAtLimit: !!G.atLimit, gameOver: !!G.over };
}

const stops = angles(a0, a1, step);
const rows = [];
const winnerTally = {};
for (const alpha of stops) {
  const outcomes = [];
  for (let pivot = 0; pivot < 3; pivot++) for (const dir of [-1, 1]) outcomes.push(simulate(alpha, pivot, dir));
  const legal = outcomes.filter(x => x.legalTarget);
  const winners = outcomes.filter(x => x.legalTarget && x.wins);
  for (const w of winners) {
    const k = `${w.pivot},${w.dir > 0 ? '+' : '-'}`;
    winnerTally[k] = (winnerTally[k] || 0) + 1;
  }
  rows.push({
    alpha,
    blueTargetLegal: legal.length === outcomes.length,
    blueWonImmediately: outcomes.some(x => x.blueWon),
    winners: winners.map(({pivot,dir,k,margin}) => ({pivot,dir,k,margin})),
    outcomes
  });
}
const uncovered = rows.filter(r => r.blueTargetLegal && !r.blueWonImmediately && !r.winners.length).map(r => r.alpha);
const validCount = rows.filter(r => r.blueTargetLegal && !r.blueWonImmediately).length;
const summary = { problem: pr.name, blueArm:[bp,bd], interval:[a0,a1], step, gridPoints:stops.length, validBlueStops:validCount,
  sampledCovered:rows.filter(r => r.blueTargetLegal && (r.blueWonImmediately || r.winners.length)).length,
  uncovered, winnerTally, interpretation:'Empirical discovery only; not a certificate for angles between samples.', rows };
fs.writeFileSync(path.join(__dirname, 'target1-response-scan.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({problem:summary.problem,blueArm:summary.blueArm,interval:summary.interval,step,gridPoints:summary.gridPoints,validBlueStops:summary.validBlueStops,sampledCovered:summary.sampledCovered,uncovered:summary.uncovered,winnerTally,interpretation:summary.interpretation},null,2));
