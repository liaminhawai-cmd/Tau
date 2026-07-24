// Head-to-head evaluation. Brains: L1..L11 (ladder levels) or nn[:temperature][:modelPath].
//   node nn/arena.js --a nn --b L8 --games 24
//   node nn/arena.js --a nn:0.2 --b nn:0.2:nn/models/prev.json --games 24
// Colors alternate every game so first-move effects wash out.
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { MLP } = require('./net.js');
const { nnPlanFor } = require('./nnai.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function makeBrain(spec, eng) {
  const m = /^L(\d+)$/i.exec(spec);
  if (m) {
    const lvl = +m[1];
    if (lvl < 1 || lvl > eng.AI_LADDER.length) throw new Error('no such ladder level: ' + spec);
    return { name: 'L' + lvl, fn: idx => eng.ladderPlanFor(lvl - 1, idx) };
  }
  const parts = spec.split(':');
  if (parts[0] !== 'nn') throw new Error('unknown brain: ' + spec);
  const temperature = parts[1] ? +parts[1] : 0;
  const mp = parts[2] || path.join(__dirname, 'models', 'value.json');
  const net = MLP.fromJSON(JSON.parse(fs.readFileSync(mp, 'utf8')));
  return { name: 'nn(' + path.basename(mp) + (temperature ? ',T' + temperature : '') + ')',
           fn: idx => nnPlanFor(eng, net, idx, { temperature }) };
}

function main() {
  const eng = createEngine();
  const A = makeBrain(arg('a', 'nn'), eng);
  const B = makeBrain(arg('b', 'L5'), eng);
  const games = +arg('games', 24);
  let aWins = 0, bWins = 0, draws = 0, pliesSum = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const aIsBlue = g % 2 === 0;
    eng.newGame();
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
