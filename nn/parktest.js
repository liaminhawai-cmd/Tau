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
//   node nn/parktest.js [--level 11] [--parkA 8] [--parkB 0] [--games 150] [--workers 8]
//
// ladderPlanFor re-reads AI_LADDER[levelIdx] on every call, and engine.js exports the live array, so
// the weight is swapped in place before each side moves rather than needing two engines (which would
// each carry their own game state).
//
// SAMPLE SIZE MATTERS HERE. A rung-sized effect is ~63%, which at 24 games lands around 15-9 -- about
// 1.2 sigma, i.e. indistinguishable from noise. Resolving "worth a little" from "worth nothing" needs
// ~150 games. Both sides are deep-search brains (L10/L11 run ~3s a move and mirror matches run long),
// so that is hours single-threaded: --workers forks one process per core, same pattern as
// selfplay.js/tournament.js, since the games are fully independent.
'use strict';
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const { createEngine } = require('./engine.js');
const { playRandomOpening } = require('./opening.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

// Play `count` games whose global indices are gStart, gStart+1, ... The global index sets the colour
// assignment, so a worker's slice keeps the same blue/red balance the serial run would have had.
function playSlice(eng, def, level, parkA, parkB, openingPlies, gStart, count, onGame) {
  let aWins = 0, bWins = 0, draws = 0, pliesSum = 0;
  for (let n = 0; n < count; n++) {
    const g = gStart + n;
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
    if (onGame) onGame(aWins, bWins, draws, n + 1);
  }
  return { aWins, bWins, draws, pliesSum };
}

function report(parkA, parkB, aWins, bWins, draws, pliesSum, games, t0) {
  const dec = aWins + bWins;
  console.log(`\n\npark=${parkA} vs park=${parkB}: ${aWins}-${bWins}` + (draws ? `-${draws}` : '') +
              `  (${dec ? (100*aWins/dec).toFixed(0) : '--'}% of decided, ` +
              `avg ${(pliesSum/games).toFixed(0)} plies, ${((Date.now() - t0)/1000).toFixed(0)}s)`);
  // a rough two-sided read, so the result isn't over-read at this sample size
  if (dec) {
    const sd = Math.sqrt(dec)/2, z = Math.abs(aWins - dec/2)/(sd || 1);
    console.log(`deviation from even: ${z.toFixed(1)} sigma` +
                (z < 1.6 ? '  -- NOT significant, consistent with the term doing nothing' : '  -- worth a closer look'));
    if (dec < 100) console.log(`note: ${dec} decided games only resolves a large effect; ~150 for a rung-sized one`);
  }
}

function main() {
  const level = +arg('level', 11);
  const games = +arg('games', 150);
  const openingPlies = +arg('openingPlies', 2);
  const eng = createEngine();
  const def = eng.AI_LADDER[level - 1];
  if (!def || !def.w) throw new Error(`L${level} has no weight object to vary`);
  const basePark = def.w.park;
  const parkA = arg('parkA', null) !== null ? +arg('parkA') : basePark;
  const parkB = +arg('parkB', 0);

  // ---- worker mode: play an assigned contiguous slice, write the tally, exit ----
  const workerIndex = arg('workerIndex', null);
  if (workerIndex !== null) {
    const gStart = +arg('gStart', 0), count = +arg('count', 0);
    const r = playSlice(eng, def, level, parkA, parkB, openingPlies, gStart, count, null);
    fs.writeFileSync(arg('out', ''), JSON.stringify(r));
    return;
  }

  const workers = Math.max(1, Math.min(+arg('workers', 1), games));
  console.log(`L${level} park=${parkA} vs L${level} park=${parkB}  (${games} games, ` +
              `openingPlies ${openingPlies}, ${workers} worker${workers > 1 ? 's' : ''}; ` +
              `every other weight identical)`);
  const t0 = Date.now();

  if (workers > 1) {
    const tmpBase = path.join(__dirname, `.parktest-tmp-${process.pid}-`);
    let live = workers, aWins = 0, bWins = 0, draws = 0, pliesSum = 0;
    // contiguous slices, each starting at an even global index so every worker keeps the
    // alternating colour assignment rather than skewing one side's share of blue
    const base = Math.floor(games/workers), extra = games % workers;
    let cursor = 0;
    for (let w = 0; w < workers; w++) {
      const count = base + (w < extra ? 1 : 0);
      const gStart = cursor; cursor += count;
      const out = tmpBase + w + '.json';
      const ch = fork(__filename, ['--level', String(level), '--parkA', String(parkA),
        '--parkB', String(parkB), '--openingPlies', String(openingPlies),
        '--workerIndex', String(w), '--gStart', String(gStart), '--count', String(count), '--out', out]);
      ch.on('exit', () => {
        try {
          const r = JSON.parse(fs.readFileSync(out, 'utf8'));
          aWins += r.aWins; bWins += r.bWins; draws += r.draws; pliesSum += r.pliesSum;
        } catch (e) { console.warn(`warning: worker ${w} produced no usable result (${e.message})`); }
        try { fs.unlinkSync(out); } catch (e) {}
        console.log(`worker ${w + 1}/${workers} done — running total ${aWins}-${bWins}`);
        if (--live === 0) { def.w.park = basePark; report(parkA, parkB, aWins, bWins, draws, pliesSum, games, t0); }
      });
    }
    return;
  }

  const r = playSlice(eng, def, level, parkA, parkB, openingPlies, 0, games,
    (aw, bw, dr, done) => {
      const dec = aw + bw;
      process.stdout.write(`\rgame ${done}/${games}: park${parkA} ${aw} — ${bw} park${parkB}` +
                           (dr ? ` (${dr} draws)` : '') +
                           (dec ? `  [${(100*aw/dec).toFixed(0)}%]` : '') + '   ');
    });
  def.w.park = basePark;
  report(parkA, parkB, r.aWins, r.bWins, r.draws, r.pliesSum, games, t0);
}

main();
