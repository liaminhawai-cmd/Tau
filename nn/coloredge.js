// Does moving SECOND win? arena.js deliberately alternates colours every game so first-move
// effects wash out, and reports by brain -- which means a systematic colour advantage is exactly
// the thing it cannot see. This runs the same brain on both sides with colours PINNED and counts
// wins by colour instead.
//
//   node nn/coloredge.js --model nn/models/best.json --games 24
//   node nn/coloredge.js --model nn/models/best.json --depthBlue 3 --depthRed 1 --games 12
//   node nn/coloredge.js --model nn/models/best.json --openingPlies 0 --temperature 0.05 --games 24
//
// --openingPlies 0 plays the REAL fixed start (the position every actual game begins from). At
// temperature 0 that is one deterministic game replayed N times, so pair it with a temperature to
// get distinct games; with openingPlies > 0 the shuffled start supplies the variety instead and
// temperature 0 is fine. Both questions are worth asking and they are not the same question:
// "is red favoured from the true opening" vs "is red favoured in general".
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

function main() {
  const eng = createEngine();
  const mp = arg('model', path.join(__dirname, 'models', 'best.json'));
  const net = MLP.fromJSON(JSON.parse(fs.readFileSync(mp, 'utf8')));
  const depth = +arg('depth', 1);
  const depthBlue = +arg('depthBlue', depth), depthRed = +arg('depthRed', depth);
  const temperature = +arg('temperature', 0);
  const games = +arg('games', 24);
  const openingPlies = +arg('openingPlies', 2);
  const keepForDepth = +arg('keepForDepth', 4);
  const quiesce = process.argv.includes('--quiesce');

  if (!openingPlies && !temperature)
    console.log('WARNING: openingPlies 0 with temperature 0 is ONE deterministic game replayed ' +
                games + ' times -- add --temperature to get distinct games.\n');

  let blue = 0, red = 0, draws = 0, pliesSum = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    eng.newGame();
    if (openingPlies) playRandomOpening(eng, openingPlies);
    let plies = 0, nulls = 0;
    while (!eng.getG().over && plies < 300) {
      const idx = eng.getG().active;                       // 0 = blue, 1 = red, never swapped
      const plan = nnPlanFor(eng, net, idx,
        { temperature, depth: idx === 0 ? depthBlue : depthRed, keepForDepth, quiesce });
      if (!plan) { nulls++; if (nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
      nulls = 0;
      eng.applyPlan(plan);
      plies++;
    }
    const G = eng.getG();
    pliesSum += plies;
    if (!G.over) draws++;
    else if (G.winner === 0) blue++;
    else red++;
    process.stdout.write(`\rgame ${g + 1}/${games}: blue ${blue} — red ${red}` +
                         (draws ? ` (${draws} draws)` : '') + '   ');
  }
  const dec = blue + red, secs = (Date.now() - t0)/1000;
  console.log(`\n\nblue(D${depthBlue}) ${blue} — ${red} red(D${depthRed})` + (draws ? `, ${draws} draws` : ''));
  if (dec) {
    const pct = 100*red/dec;
    // Standard error on a proportion; 2 sigma is the rough "is this real" bar. Printed rather than
    // left to the reader because at these sample sizes the eyeball answer is usually wrong.
    const se = 100*Math.sqrt(0.25/dec);
    console.log(`red wins ${pct.toFixed(0)}% of ${dec} decided (±${(2*se).toFixed(0)}% at 2 sigma)`);
    console.log(Math.abs(pct - 50) > 2*se
      ? '=> colour advantage looks REAL at this sample size'
      : '=> consistent with no colour advantage; needs more games to separate');
  }
  console.log(`avg ${(pliesSum/games).toFixed(0)} plies, ${secs.toFixed(0)}s`);
}

main();
