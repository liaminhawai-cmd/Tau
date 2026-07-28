// Head-to-head evaluation. Brains: L1..L11 (ladder levels) or nn[:temperature][:modelPath].
//   node nn/arena.js --a nn --b L8 --games 24 [--openingPlies 2]
//   node nn/arena.js --a nn:0.2 --b nn:0.2:nn/models/prev.json --games 24
// Colors alternate every game so first-move effects wash out. When both brains are deterministic
// (temperature 0, or a ladder level with no noise), --openingPlies forces that many random legal
// opening plies before either brain moves, so "games" are actually distinct positions rather than
// the same 2 deterministic lines (one per colour) replayed over and over -- see opening.js.
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { MLP } = require('./net.js');
const { nnPlanFor } = require('./nnai.js');
const { playRandomOpening } = require('./opening.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function makeBrain(spec, eng, depth, keepForDepth) {
  const m = /^L(\d+)$/i.exec(spec);
  if (m) {
    const lvl = +m[1];
    if (lvl < 1 || lvl > eng.AI_LADDER.length) throw new Error('no such ladder level: ' + spec);
    return { name: 'L' + lvl, fn: idx => eng.ladderPlanFor(lvl - 1, idx) };
  }
  const parts = spec.split(':');
  if (parts[0] !== 'nn') throw new Error('unknown brain: ' + spec);
  const temperature = parts[1] ? +parts[1] : 0;
  // everything after the second colon is the model path — REJOINED, because Windows absolute
  // paths contain a colon themselves (nn:0:C:\Users\...\best.json)
  const mp = parts.length > 2 ? parts.slice(2).join(':') : path.join(__dirname, 'models', 'value.json');
  const net = MLP.fromJSON(JSON.parse(fs.readFileSync(mp, 'utf8')));
  return { name: 'nn(' + path.basename(mp) + (temperature ? ',T' + temperature : '') + (depth > 1 ? ',D' + depth : '') + ')',
           fn: idx => nnPlanFor(eng, net, idx, { temperature, depth, keepForDepth }) };
}

function main() {
  const eng = createEngine();
  // depth applies to any nn brain in the match (both --a and --b if both are nn) -- see nnai.js's
  // depth option. Costs roughly keepForDepth x as long per nn move, so keep games modest at depth 2+.
  const depth = +arg('depth', 1);
  const keepForDepth = +arg('keepForDepth', 4);
  const A = makeBrain(arg('a', 'nn'), eng, depth, keepForDepth);
  const B = makeBrain(arg('b', 'L5'), eng, depth, keepForDepth);
  const games = +arg('games', 24);
  // both brains are commonly fully deterministic (nn at temperature 0, or a noise-free ladder
  // level) from the same fixed start -- without a shuffled opening, every game with the same
  // colour assignment would replay bit-for-bit identically, making "games" a repeat count, not a
  // sample size. See opening.js.
  const openingPlies = +arg('openingPlies', 2);
  let aWins = 0, bWins = 0, draws = 0, pliesSum = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const aIsBlue = g % 2 === 0;
    eng.newGame();
    playRandomOpening(eng, openingPlies);
    let plies = 0, nulls = 0;
    while (!eng.getG().over && plies < 300) {
      const idx = eng.getG().active;
      const brain = (idx === 0) === aIsBlue ? A : B;
      const plan = brain.fn(idx);
      if (!plan) { nulls++; if (nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
      nulls = 0;
      eng.applyPlan(plan);
      plies++;
    }
    const G = eng.getG();
    pliesSum += plies;
    if (!G.over) draws++;
    else if ((G.winner === 0) === aIsBlue) aWins++;
    else bWins++;
    process.stdout.write(`\rgame ${g + 1}/${games}: ${A.name} ${aWins} — ${bWins} ${B.name}` +
                         (draws ? ` (${draws} draws)` : '') + '   ');
  }
  const secs = (Date.now() - t0)/1000;
  console.log(`\n${A.name} vs ${B.name}: ${aWins}-${bWins}` + (draws ? `-${draws}` : '') +
              `  (${(100*aWins/Math.max(1, aWins + bWins)).toFixed(0)}% of decided, ` +
              `avg ${(pliesSum/games).toFixed(0)} plies, ${secs.toFixed(0)}s)`);
}

main();
