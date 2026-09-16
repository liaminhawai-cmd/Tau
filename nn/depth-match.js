// Does one more ply reliably make the same net stronger?
//
// WHY THIS IS NOT ALREADY KNOWN
// The league rates every (net x depth) pair, but it rates them THROUGH THE POOL: net@D2 and net@D3
// mostly meet different opponents, and their Elos are reconciled by a global fit. That is fine for
// ranking a field and bad for this question, which is a difference between two faces that share
// every weight. The result is a table that contradicts itself -- mutant-004 climbs -100/-30/+31
// across D1/D3/D4 while ckpt-376 falls 143/64 across D1/D2 -- with CIs wide enough to permit both.
// retromine.js's header records the same shape as a "D2-spike/D3-crash" and demotes the depth axis
// because of it.
//
// So: play them directly. Same net file, same weights, same evaluator, same openings, colours
// balanced. The ONLY difference is one ply of search. Whatever comes out is the depth axis's real
// slope, measured rather than inferred.
//
// WHAT TURNS ON IT
// A self-play loop's data can never be better than the strongest player in the loop. Culling and
// Elo-weighted training SELECT among what was generated; they do not generate anything stronger.
// Search depth is the one lever that can produce play above the current champion without first
// training a better net -- so if a ply does not reliably help, the loop has no ceiling-raiser at
// all, and "add a ply to the loser" is unsound as a retromine rung.
'use strict';
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const { createEngine } = require('./engine.js');
const { features } = require('./features.js');
const { nnPlanFor } = require('./nnai.js');
const { loadValueNet } = require('./load-value-net.js');
const { playRandomOpening } = require('./opening.js');

function playGame(eng, evalFn, dA, dB, keep, sweepDeg, aIsBlue, openingPlies, maxPlies) {
  eng.newGame();
  playRandomOpening(eng, openingPlies);
  let plies = 0, nulls = 0;
  while (!eng.getG().over && plies < maxPlies) {
    const idx = eng.getG().active;
    const depth = ((idx === 0) === aIsBlue) ? dA : dB;
    const plan = nnPlanFor(eng, null, idx, { temperature: 0, depth, keepForDepth: keep, evalFn, sweepDeg });
    if (!plan) { if (++nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
    nulls = 0;
    eng.applyPlan(plan);
    plies++;
  }
  const G = eng.getG();
  if (!G.over || G.winner === null) return { r: 0, plies };
  return { r: ((G.winner === 0) === aIsBlue) ? 1 : -1, plies };
}

if (!isMainThread) {
  const { model, dA, dB, keep, sweepDeg, games, seed, openingPlies, maxPlies } = workerData;
  const eng = createEngine();
  eng.CFG.moveCap = maxPlies;
  // The evaluator is nnai.js's own default, unchanged: the net reports for the side to move and the
  // search negates it for the other side, which is plain zero-sum and needs no assumption about the
  // net. (An earlier version of this file tested a "direct" alternative that set g.active to the
  // side being asked about. That discards whose turn it actually is -- a different, wrong question
  // -- and it lost 7-33 at depth 1 for that reason.)
  const net = loadValueNet(model);
  const evalFn = (e, side) => {
    const v = net.value(features(e));
    return e.getG().active === side ? v : -v;
  };
  let aWin = 0, bWin = 0, draw = 0, pliesSum = 0;
  let s = seed >>> 0;
  Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let g = 0; g < games; g++) {
    const aIsBlue = (g % 2 === 0);
    s = (seed + 7919 * (g >> 1)) >>> 0;        // the colour-swapped pair replays one opening
    const { r, plies } = playGame(eng, evalFn, dA, dB, keep, sweepDeg, aIsBlue, openingPlies, maxPlies);
    if (r > 0) aWin++; else if (r < 0) bWin++; else draw++;
    pliesSum += plies;
    parentPort.postMessage({ progress: 1 });
  }
  parentPort.postMessage({ done: true, aWin, bWin, draw, pliesSum });
} else main();

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

function eloCI(w, l, d) {
  const n = w + l + d;
  if (!n) return null;
  const p = (w + 0.5 * d) / n, z = 1.6449;
  const den = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / den;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  const E = q => (q <= 0 ? -Infinity : q >= 1 ? Infinity : -400 * Math.log10(1 / q - 1));
  return { p, elo: E(p), lo: E(Math.max(1e-9, c - half)), hi: E(Math.min(1 - 1e-9, c + half)) };
}

async function main() {
  const model = arg('model', 'nn/models/deep-360.json');
  const pairs = String(arg('pairs', '1v2,2v3,3v4')).split(',').map(p => p.split('v').map(Number));
  const games = +arg('games', 40);
  const keep = +arg('keep', 4);
  const sweepDeg = +arg('sweepDeg', 9);
  const openingPlies = +arg('openingPlies', 2);
  const maxPlies = +arg('maxPlies', 120);
  const threads = Math.max(1, Math.min(+arg('threads', 4), games));

  console.log(`\n=== ONE MORE PLY -- ${model} ===`);
  console.log(`${games} games per pair, colours balanced, ${openingPlies} random opening plies, ` +
              `keep=${keep} sweepDeg=${sweepDeg}\n`);
  console.log('  ' + 'pair'.padStart(6) + '  ' + 'deep-shallow-draw'.padStart(18) +
              '  ' + 'deeper'.padStart(7) + '  ' + 'Elo'.padStart(7) + '  ' + '90% CI'.padStart(16) +
              '  ' + 'plies'.padStart(6) + '  ' + 'secs'.padStart(6));

  for (const [dA, dB] of pairs) {
    const t0 = Date.now();
    const per = Math.ceil(games / threads);
    const chunks = [];
    for (let t = 0; t < threads; t++) {
      const n = Math.min(per, games - t * per);
      if (n > 0) chunks.push({ n, seed: 2000003 + t * 104729 + dA * 31 + dB * 7 });
    }
    let aWin = 0, bWin = 0, draw = 0, pliesSum = 0, done = 0;
    await Promise.all(chunks.map(c => new Promise((res, rej) => {
      // A is the DEEPER side, so a positive Elo always means "the extra ply helped".
      const w = new Worker(__filename, { workerData: { model, dA: Math.max(dA, dB), dB: Math.min(dA, dB),
                                                       keep, sweepDeg, games: c.n, seed: c.seed,
                                                       openingPlies, maxPlies } });
      w.on('message', m => {
        if (m.done) { aWin += m.aWin; bWin += m.bWin; draw += m.draw; pliesSum += m.pliesSum; return; }
        done++;
        process.stdout.write(`\r  D${Math.max(dA,dB)}vD${Math.min(dA,dB)}: ${done}/${games}  ${((Date.now()-t0)/1000).toFixed(0)}s    `);
      });
      w.on('error', rej);
      w.on('exit', c2 => c2 === 0 ? res() : rej(new Error('worker exit ' + c2)));
    })));
    const ci = eloCI(aWin, bWin, draw);
    const n = aWin + bWin + draw;
    console.log('\r  ' + `D${Math.max(dA,dB)}vD${Math.min(dA,dB)}`.padStart(6) +
                '  ' + `${aWin}-${bWin}-${draw}`.padStart(18) +
                '  ' + (100 * ci.p).toFixed(1).padStart(6) + '%' +
                '  ' + (isFinite(ci.elo) ? ci.elo.toFixed(0) : '>>').padStart(7) +
                '  ' + `${isFinite(ci.lo)?ci.lo.toFixed(0):'-inf'}..${isFinite(ci.hi)?ci.hi.toFixed(0):'+inf'}`.padStart(16) +
                '  ' + (pliesSum / n).toFixed(0).padStart(6) + '  ' + ((Date.now()-t0)/1000).toFixed(0).padStart(6));
  }
  console.log('');
}
