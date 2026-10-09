// Determine each of the six blue swing-family endpoints for the Target1 seed.
// This is engine-domain discovery, not a proof: each long request follows the exact shipped
// plan/substep schedule and reports the angle where the engine stops (atLimit / gameOver).
'use strict';
const path = require('path');
const { createEngine } = require(path.join(__dirname, '../../../nn/engine.js'));
const { fromEnv } = require('./problem.js');

const eng = createEngine();
const pr = fromEnv();
const seed = pr.seed;
const step3 = 3 * Math.PI / 180;
const requestDeg = +(process.argv[2] || 180);
if (pr.firstMover !== 0) throw new Error('domain scan assumes Blue moves first');

function makeGame() {
  const G = eng.newGame();
  const [B, R] = G.pieces;
  B.x=seed.blue.x; B.y=seed.blue.y; B.rot=seed.blue.rot;
  R.x=seed.red.x; R.y=seed.red.y; R.rot=seed.red.rot;
  G.active=pr.firstMover;
  return G;
}
function trace(pivot, dir) {
  const G = makeGame();
  const before = Math.abs(G.netRad || 0);
  eng.pinFoot(pivot);
  const target = requestDeg * Math.PI / 180;
  let guard=0, calls=0;
  while (!G.atLimit && !G.over && Math.abs(G.netRad) < target && guard++ < 5000) {
    const rem = target - Math.abs(G.netRad);
    eng.applySwing(dir * Math.min(step3, rem));
    calls++;
  }
  const radians = Math.abs(G.netRad || 0);
  return {
    blueArm:[pivot,dir],
    requestedDeg:requestDeg,
    reachedDeg:radians * 180 / Math.PI,
    stoppedBy:G.over ? 'game-over' : G.atLimit ? 'atLimit' : guard >= 5000 ? 'guard' : 'requested-angle',
    atLimit:!!G.atLimit,
    gameOver:!!G.over,
    calls,
    remainingToRequestDeg:Math.max(0,requestDeg-radians*180/Math.PI),
    endPose:{x:G.pieces[0].x,y:G.pieces[0].y,rot:G.pieces[0].rot},
    redPose:{x:G.pieces[1].x,y:G.pieces[1].y,rot:G.pieces[1].rot}
  };
}
const result={problem:pr.name,seed:pr.seed,requestDeg,arms:[]};
for(let pivot=0;pivot<3;pivot++) for(const dir of [-1,1]) result.arms.push(trace(pivot,dir));
console.log(JSON.stringify(result,null,2));
