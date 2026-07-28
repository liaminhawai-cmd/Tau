// Is throw-quiescence worth anything? Measures how often the situation it exists for actually
// arises, which is the question that has to be answered BEFORE a win-rate A/B means anything: if
// the top-ranked move essentially never hangs an immediate throw, then quiescence can't help, a
// head-to-head will read 50/50, and that 50/50 says nothing about the idea -- only that it never
// fired. A win-rate test can't distinguish "no effect" from "never triggered"; this can.
//
//   node nn/throwprobe.js [--model models/best.json] [--games 20] [--depth 1] [--opponent L6]
//
// Reports, over real played positions:
//   hangs      how often the move the net WOULD have played lets the opponent throw it next turn
//   rescued    how often a safe alternative existed inside the screened candidates (quiescence
//              changes the pick) -- the actual firing rate
//   stuck      how often every screened candidate hangs (nothing to rescue with; quiescence
//              correctly leaves the ranking alone rather than reaching for a worse move)
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { MLP } = require('./net.js');
const { nnPlanFor, opponentHasThrow } = require('./nnai.js');
const { playRandomOpening } = require('./opening.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const modelPath = arg('model', path.join(__dirname, 'models', 'best.json'));
const games = +arg('games', 20);
const depth = +arg('depth', 1);
const keepForDepth = +arg('keepForDepth', 4);
const opponent = arg('opponent', 'self');   // "self" = nn vs nn, or a ladder level like L6
const maxPlies = +arg('maxPlies', 120);

if (!fs.existsSync(modelPath)) { console.error(`no such model: ${modelPath}`); process.exit(1); }
const eng = createEngine();
const net = MLP.fromJSON(JSON.parse(fs.readFileSync(modelPath, 'utf8')));
const lvlMatch = /^L(\d+)$/i.exec(opponent);
const oppLevel = lvlMatch ? +lvlMatch[1] : null;

console.log(`throw probe: ${path.basename(modelPath)} at depth ${depth}, ${games} games vs ${opponent}\n`);

let moves = 0, hangs = 0, rescued = 0, stuck = 0, ownThrow = 0;
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  eng.newGame();
  playRandomOpening(eng, 2);
  // the net plays blue on even games, red on odd -- same colour-alternation reasoning as arena.js
  const netIsBlue = g % 2 === 0;
  let plies = 0, nulls = 0;
  while (!eng.getG().over && plies < maxPlies) {
    const idx = eng.getG().active;
    const netToMove = (idx === 0) === netIsBlue;
    let plan;
    if (!netToMove && oppLevel !== null) {
      plan = eng.ladderPlanFor(oppLevel - 1, idx);
    } else {
      const snap = eng.takeSnap();
      const restoreHere = () => {
        const gg = eng.getG();
        gg.pieces.forEach((p, i) => { p.x = snap[i].x; p.y = snap[i].y; p.rot = snap[i].rot; });
        gg.turnDir = 0; gg.crossings = 0; gg.atLimit = false; gg.netRad = 0; gg.contact = null;
        gg.pinned = null; gg.pivot = null; gg.active = idx; gg.over = false; gg.winner = null;
      };
      const plain = nnPlanFor(eng, net, idx, { temperature: 0, depth, keepForDepth });
      restoreHere();
      if (plain && netToMove) {
        moves++;
        // A move that wins on the spot is never "hanging" anything -- the game ends first.
        eng.applyPlan(plain);
        const wonNow = eng.getG().over;
        const unsafe = wonNow ? false : opponentHasThrow(eng, idx);
        restoreHere();
        if (wonNow) ownThrow++;
        else if (unsafe) {
          hangs++;
          const quiesced = nnPlanFor(eng, net, idx, { temperature: 0, depth, keepForDepth, quiesce: true });
          restoreHere();
          const changed = quiesced && !(quiesced.pivotIdx === plain.pivotIdx && quiesced.dir === plain.dir &&
                                        Math.abs(quiesced.targetRad - plain.targetRad) < 1e-9);
          if (changed) rescued++; else stuck++;
        }
      }
      plan = plain;
    }
    if (!plan) { nulls++; if (nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
    nulls = 0;
    eng.applyPlan(plan);
    plies++;
  }
  process.stdout.write(`\rgame ${g + 1}/${games}: ${moves} net moves, ${hangs} hang, ${rescued} rescued   `);
}

const pct = (n) => moves ? (100*n/moves).toFixed(1) + '%' : '-';
console.log(`\n\n=== over ${moves} net moves (${((Date.now() - t0)/1000).toFixed(0)}s) ===`);
console.log(`  winning throws played   ${String(ownThrow).padStart(5)}  ${pct(ownThrow).padStart(6)}`);
console.log(`  hangs an immediate throw${String(hangs).padStart(5)}  ${pct(hangs).padStart(6)}   <- how often quiescence has anything to do`);
console.log(`    ...rescued by quiesce ${String(rescued).padStart(5)}  ${pct(rescued).padStart(6)}   <- how often it actually changes the move`);
console.log(`    ...no safe alternative${String(stuck).padStart(5)}  ${pct(stuck).padStart(6)}   <- already lost; nothing to rescue with`);
console.log('');
if (!hangs)
  console.log('VERDICT: the top move never hung an immediate throw. Quiescence cannot help here --\n' +
              'a win-rate A/B would read 50/50 for lack of anything to fire on, not because the idea\n' +
              'is wrong. Whatever is losing these games, it is not one-move throw blindness.');
else if (rescued/moves < 0.005)
  console.log('VERDICT: fires too rarely (<0.5% of moves) to move a win rate measurably. Would need\n' +
              'thousands of games to detect, which is not worth it against cheaper levers.');
else
  console.log('VERDICT: fires often enough to be worth a head-to-head. Run:\n' +
              `  node arena.js --a nn:0:${modelPath} --b nn:0:${modelPath} --depthA ${depth} --quiesceA --depthB ${depth} --games 40`);
