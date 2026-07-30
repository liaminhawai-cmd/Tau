// Is the `park` term still worth its weight under the CURRENT crossing rules?
//
// The park term (weight 8 in L10/L11) was motivated by the two-turn double cross: park a foot on a
// line, and next turn it leaves for free so a second foot's crossing rides along -- two lines for one
// crossing (index.html:3020-3026). The departure billing has since narrowed that (index.html:2559-
// 2568, "NO GRACE"): leaving a start line is free ONLY if the foot backs off the side it started on;
// crossing over it is billed like a fresh entry. So parking no longer buys a free trip over the
// parked line, only a free retreat.
//
// This plays the top rung against ITSELF with only the park weight changed, so anything that shows up
// is that one term. Same level, same search, same everything else.
//
//   node nn/parktest.js [--level 11] [--parkA 8] [--parkB 0] [--games 24] [--openingPlies 2]
//
// ladderPlanFor re-reads AI_LADDER[levelIdx] on every call, and engine.js exports the live array, so
// the weight is swapped in place before each side moves rather than needing two engines (which would
// each carry their own game state).
'use strict';
const { createEngine } = require('./engine.js');
const { playRandomOpening } = require('./opening.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function main() {
  const level = +arg('level', 11);
  const games = +arg('games', 24);
  const openingPlies = +arg('openingPlies', 2);
  const eng = createEngine();
  const def = eng.AI_LADDER[level - 1];
  if (!def || !def.w) throw new Error(`L${level} has no weight object to vary`);
  const basePark = def.w.park;
  const parkA = arg('parkA', null) !== null ? +arg('parkA') : basePark;
  const parkB = +arg('parkB', 0);

  console.log(`L${level} park=${parkA} vs L${level} park=${parkB}  (${games} games, ` +
              `openingPlies ${openingPlies}; every other weight identical)`);

  let aWins = 0, bWins = 0, draws = 0, pliesSum = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const aIsBlue = g % 2 === 0;
    eng.newGame();
    playRandomOpening(eng, openingPlies);
    let plies = 0, nulls = 0;
    while (!eng.getG().over && plies < 300) {
      const idx = eng.getG().active;
      const isA = (idx === 0) === aIsBlue;
      def.w.park = isA ? parkA : parkB;      // the only thing that differs between the two sides
      const plan = eng.ladderPlanFor(level - 1, idx);
      if (!plan) { if (++nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
      nulls = 0;
      eng.applyPlan(plan);
      plies++;
    }
    const G = eng.getG();
    pliesSum += plies;
    if (!G.over) draws++;
    else if ((G.winner === 0) === aIsBlue) aWins++;
    else bWins++;
    const dec = aWins + bWins;
    process.stdout.write(`\rgame ${g + 1}/${games}: park${parkA} ${aWins} — ${bWins} park${parkB}` +
                         (draws ? ` (${draws} draws)` : '') +
                         (dec ? `  [${(100*aWins/dec).toFixed(0)}%]` : '') + '   ');
  }
  def.w.park = basePark;
  const dec = aWins + bWins;
  console.log(`\n\npark=${parkA} vs park=${parkB}: ${aWins}-${bWins}` + (draws ? `-${draws}` : '') +
              `  (${dec ? (100*aWins/dec).toFixed(0) : '--'}% of decided, ` +
              `avg ${(pliesSum/games).toFixed(0)} plies, ${((Date.now() - t0)/1000).toFixed(0)}s)`);
  // a rough two-sided read, so the result isn't over-read at this sample size
  if (dec) {
    const sd = Math.sqrt(dec)/2, z = Math.abs(aWins - dec/2)/(sd || 1);
    console.log(`deviation from even: ${z.toFixed(1)} sigma` +
                (z < 1.6 ? '  -- NOT significant, consistent with the term doing nothing' : '  -- worth a closer look'));
  }
}

main();
