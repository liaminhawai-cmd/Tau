// Does the net's broken compass actually cost games, and does it cost more the deeper you search?
//
// THE DEFECT, RESTATED
// nnai.js's default leaf evaluator gets the OPPONENT's view of a position by negating the net's
// own output:
//     const v = net.value(features(e));  return e.getG().active === side ? v : -v;
// That is only valid if the net is antisymmetric -- if asking "how good for blue" and "how good for
// red" about one board gives answers that sum to zero. Measured over real game positions it does
// not: corr(v(blue), -v(red)) is 0.37-0.51 for the value nets, against 0.87 for ladderEval, and the
// mean |v(blue) + v(red)| exceeds the whole spread of v. A quarter of positions are scored as good
// for BOTH sides at once.
//
// WHY THE DEPTH TREND IS THE MEASUREMENT, NOT THE ABSOLUTE
// At depth 1 both evaluators are internally consistent -- one ranks candidates by -v(opponent view),
// the other by +v(mover's view). Those are different rankings, so they will not draw, but neither is
// COMPOSING anything: a single uniform negation cannot make a search contradict itself. At depth 2+
// the negating version adds up values that came from the mover's view on one ply and the negated
// opponent's view on the next, and for a net whose two views correlate at 0.4 those are close to
// different functions. So the prediction is not "direct wins" -- it is "direct's margin GROWS with
// depth". A flat margin across D1/D2/D3 means the compass is not what makes deep search misbehave.
//
// WHY DIRECT STARTS BEHIND, AND WHY THAT IS NOT THE ANSWER
// Every net in the pool was BRED under the negating evaluator: the league that selected it ranked
// its moves by -v(opponent view) for the model's whole existence. Asking it to play by +v(mover's
// view) instead is a distribution shift, and it loses games for that reason alone, with or without
// a composition bug. A first run at depth 1 has direct losing 1-7. So the LEVEL says nothing; only
// the slope across depth does. Read the table as: how much of direct's deficit closes per ply.
//
// The two brains differ in exactly one expression. Same net file, same weights, same search, same
// keepForDepth, same sweep, same openings, colours balanced.
'use strict';
const os = require('os');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const { createEngine } = require('./engine.js');
const { features } = require('./features.js');
const { nnPlanFor } = require('./nnai.js');
const { loadValueNet } = require('./load-value-net.js');
const { playRandomOpening } = require('./opening.js');

// NEGATE: what nnai.js does today. Reads the position as it stands -- whoever is to move -- and
// flips the sign when that is not the side being asked about.
const makeNegate = net => (e, side) => {
  const v = net.value(features(e));
  return e.getG().active === side ? v : -v;
};
// DIRECT: ask the net about `side` itself. features() is built relative to whoever is to move, so
// setting active to `side` and reading the output unnegated is the same question asked honestly.
// Nothing here depends on the net being antisymmetric.
const makeDirect = net => (e, side) => {
  const g = e.getG(), keep = g.active;
  g.active = side;
  const v = net.value(features(e));
  g.active = keep;
  return v;
};

function playGame(eng, evalA, evalB, depth, keep, sweepDeg, aIsBlue, openingPlies, maxPlies) {
  eng.newGame();
  playRandomOpening(eng, openingPlies);
  let plies = 0, nulls = 0;
  while (!eng.getG().over && plies < maxPlies) {
    const idx = eng.getG().active;
    const evalFn = ((idx === 0) === aIsBlue) ? evalA : evalB;
    const plan = nnPlanFor(eng, null, idx, { temperature: 0, depth, keepForDepth: keep,
                                             evalFn, sweepDeg });
    if (!plan) { if (++nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
    nulls = 0;
    eng.applyPlan(plan);
    plies++;
  }
  const G = eng.getG();
  if (!G.over || G.winner === null) return { r: 0, plies };          // draw
  return { r: ((G.winner === 0) === aIsBlue) ? 1 : -1, plies };
}

if (!isMainThread) {
  const { model, depth, keep, sweepDeg, games, seed, openingPlies, maxPlies } = workerData;
  const eng = createEngine();
  eng.CFG.moveCap = maxPlies;
  const net = loadValueNet(model);
  const evalNeg = makeNegate(net), evalDir = makeDirect(net);
  let dirWin = 0, negWin = 0, draw = 0, pliesSum = 0;
  // Math.random drives playRandomOpening; seeding it per worker keeps the openings distinct
  // between workers and the pairs of games identical across the colour swap.
  let s = seed >>> 0;
  Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let g = 0; g < games; g++) {
    // Colours alternate, and the SAME opening seed is reused for the pair so the two halves of a
    // colour-balanced pair are the same position played from both sides.
    const aIsBlue = (g % 2 === 0);
    s = (seed + 7919 * (g >> 1)) >>> 0;
    // A is always DIRECT; aIsBlue decides which colour it holds.
    const { r, plies } = playGame(eng, evalDir, evalNeg, depth, keep, sweepDeg, aIsBlue, openingPlies, maxPlies);
    if (r > 0) dirWin++; else if (r < 0) negWin++; else draw++;
    pliesSum += plies;
    parentPort.postMessage({ progress: 1 });
  }
  parentPort.postMessage({ done: true, dirWin, negWin, draw, pliesSum });
} else main();

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

// Wilson interval on the score rate, then the usual Elo transform, so a 20-game result reports as
// the wide band it is rather than as a number.
function eloCI(w, l, d) {
  const n = w + l + d;
  if (!n) return null;
  const p = (w + 0.5 * d) / n, z = 1.6449;                       // 90%
  const den = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / den;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  const E = q => (q <= 0 ? -Infinity : q >= 1 ? Infinity : -400 * Math.log10(1 / q - 1));
  return { p, elo: E(p), lo: E(Math.max(1e-9, c - half)), hi: E(Math.min(1 - 1e-9, c + half)) };
}

async function main() {
  const model = arg('model', 'nn/models/deep-360.json');
  const depths = String(arg('depths', '1,2,3')).split(',').map(Number);
  const games = +arg('games', 40);
  const keep = +arg('keep', 4);
  const sweepDeg = +arg('sweepDeg', 9);
  const openingPlies = +arg('openingPlies', 2);
  const maxPlies = +arg('maxPlies', 120);
  const threads = Math.max(1, Math.min(+arg('threads', 4), games));

  console.log(`\n=== DIRECT vs NEGATE -- ${model} ===`);
  console.log(`${games} games per depth, colours balanced, ${openingPlies} random opening plies, ` +
              `keep=${keep} sweepDeg=${sweepDeg}\n`);
  console.log('  ' + 'depth'.padStart(5) + '  ' + 'direct-negate-draw'.padStart(19) +
              '  ' + 'score'.padStart(7) + '  ' + 'Elo'.padStart(7) + '  ' + '90% CI'.padStart(16) +
              '  ' + 'avg plies'.padStart(9) + '  ' + 'secs'.padStart(6));

  const rows = [];
  for (const depth of depths) {
    const t0 = Date.now();
    const per = Math.ceil(games / threads);
    const chunks = [];
    for (let t = 0; t < threads; t++) {
      const n = Math.min(per, games - t * per);
      if (n > 0) chunks.push({ n, seed: 1000003 + t * 104729 + depth * 31 });
    }
    let dirWin = 0, negWin = 0, draw = 0, pliesSum = 0, done = 0;
    await Promise.all(chunks.map(c => new Promise((res, rej) => {
      const w = new Worker(__filename, { workerData: { model, depth, keep, sweepDeg,
                                                       games: c.n, seed: c.seed, openingPlies, maxPlies } });
      w.on('message', m => {
        if (m.done) { dirWin += m.dirWin; negWin += m.negWin; draw += m.draw; pliesSum += m.pliesSum; return; }
        done++;
        process.stdout.write(`\r  d${depth}: ${done}/${games} games  ${((Date.now()-t0)/1000).toFixed(0)}s    `);
      });
      w.on('error', rej);
      w.on('exit', c2 => c2 === 0 ? res() : rej(new Error('worker exit ' + c2)));
    })));
    const ci = eloCI(dirWin, negWin, draw);
    const secs = (Date.now() - t0) / 1000;
    const n = dirWin + negWin + draw;
    console.log('\r  ' + String(depth).padStart(5) + '  ' + `${dirWin}-${negWin}-${draw}`.padStart(19) +
                '  ' + (100 * ci.p).toFixed(1).padStart(6) + '%' +
                '  ' + (isFinite(ci.elo) ? ci.elo.toFixed(0) : '>>').padStart(7) +
                '  ' + `${isFinite(ci.lo)?ci.lo.toFixed(0):'-inf'}..${isFinite(ci.hi)?ci.hi.toFixed(0):'+inf'}`.padStart(16) +
                '  ' + (pliesSum / n).toFixed(0).padStart(9) + '  ' + secs.toFixed(0).padStart(6));
    rows.push({ depth, dirWin, negWin, draw, elo: ci.elo, lo: ci.lo, hi: ci.hi });
  }
  console.log('\n  The claim under test is the TREND: if the negate-the-output shortcut is what makes');
  console.log('  deep net search misbehave, direct\'s margin should grow from d1 to d3. A flat margin');
  console.log('  means the compass is not the problem and the depth crash is something else.\n');
}
