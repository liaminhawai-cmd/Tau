// Head-to-head evaluation. Brains: L1..L11 (ladder levels) or nn[:temperature][:modelPath].
//   node nn/arena.js --a nn --b L8 --games 24 [--openingPlies 2]
//   node nn/arena.js --a nn:0.2 --b nn:0.2:nn/models/prev.json --games 24
//   node nn/arena.js --a nn:0:models/best.json --b nn:0:models/best.json --depthA 1 --quiesceA --depthB 1
//     (same net both sides -- isolates what quiescence alone is worth over plain depth 1)
// Colors alternate every game so first-move effects wash out. When both brains are deterministic
// (temperature 0, or a ladder level with no noise), --openingPlies forces that many random legal
// opening plies before either brain moves, so "games" are actually distinct positions rather than
// the same 2 deterministic lines (one per colour) replayed over and over -- see opening.js.
// --depth/--quiesce set both sides; --depthA/--depthB/--quiesceA/--quiesceB override per side --
// needed for a same-net A/B like the one above, which a single shared --depth can't express.
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { MLP } = require('./net.js');
const { nnPlanFor, nnPlanForTimed } = require('./nnai.js');
const { playRandomOpening } = require('./opening.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

// timeMs (if given) switches this brain to nnPlanForTimed's iterative deepening instead of a fixed
// --depth -- THIS is the fair test for a policy head, not a fixed-depth A/B. Pruning can only see a
// subset of what full search sees, so at equal depth it can tie or lose but never win; its entire
// payoff is that each depth costs less, which only shows up as "how far did it get in the same
// clock time". Equal depth checks the policy isn't blind; equal time checks whether it's worth
// having at all.
// abCut picks WHICH use of the policy is being tested: with it, the policy orders arms and a
// recursive search stops once it has refuted the candidate (never blind -- no cutoff means every
// arm is still swept); without it, the policy hard-prunes to its top arms, the original wiring.
// Default stays pruning so the existing menu A/Bs keep testing what they say they test.
function makeBrain(spec, eng, depth, keepForDepth, quiesce, policyPath, timeMs, abCut) {
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
  const policy = policyPath
    ? require('./policy.js').PolicyMLP.fromJSON(JSON.parse(fs.readFileSync(policyPath, 'utf8')))
    : null;
  const pTag = policy ? (abCut ? ',P-ab' : ',P') : '';
  if (timeMs) {
    return { name: 'nn(' + path.basename(mp) + ',T' + timeMs + 'ms' + pTag + ')',
             fn: idx => nnPlanForTimed(eng, net, idx, { temperature, keepForDepth, quiesce, policy, timeMs,
                                                        policyPrune: !!policy && !abCut, abCut: !!abCut }) };
  }
  // Depth is reported as e.g. "D1.5" when quiesce rides on top of a plain depth-1 pass -- matches
  // how the mix names it, and makes a quiesce-vs-plain A/B legible at a glance in the score line
  // instead of two "D1" entries that secretly differ.
  const depthLabel = quiesce ? depth + 0.5 : depth;
  return { name: 'nn(' + path.basename(mp) + (temperature ? ',T' + temperature : '') + (depthLabel > 1 ? ',D' + depthLabel : '') +
           pTag + ')',
           fn: idx => nnPlanFor(eng, net, idx, { temperature, depth, keepForDepth, quiesce, policy,
                                                 policyPrune: !!policy && !abCut, abCut: !!abCut }) };
}

function main() {
  const eng = createEngine();
  // --depth is the shared default; --depthA/--depthB (and --quiesceA/--quiesceB) override it per
  // side. Needed for exactly the comparison a fractional-depth question wants to ask -- "does
  // quiescence on top of depth 1 beat plain depth 1" is a same-net A/B, which a single --depth
  // applied to both sides can't express at all. --quiesce sets both sides at once, same as --depth.
  const depth = +arg('depth', 1);
  const keepForDepth = +arg('keepForDepth', 4);
  const quiesce = process.argv.includes('--quiesce');
  const depthA = +arg('depthA', depth), depthB = +arg('depthB', depth);
  const quiesceA = process.argv.includes('--quiesceA') || quiesce;
  const quiesceB = process.argv.includes('--quiesceB') || quiesce;
  // --policy sets both sides; --policyA/--policyB override per side (an A/B of policy pruning vs
  // none on the same net needs per-side control, same reason --depthA/--depthB exist)
  const policy = arg('policy', null);
  // --timeMs sets both sides to equal-clock-time iterative deepening instead of a fixed depth;
  // --timeMsA/--timeMsB override per side (same reason every other per-side flag exists here).
  const timeMs = arg('timeMs', null);
  const timeMsA = arg('timeMsA', timeMs), timeMsB = arg('timeMsB', timeMs);
  // --ab switches a policy side from hard pruning to ordering+cutoff; --abA/--abB per side, so a
  // policy can be pitted against ITSELF used the other way -- the only comparison that isolates
  // which use of the policy is better, rather than whether having one helps at all.
  const ab = process.argv.includes('--ab');
  const abA = process.argv.includes('--abA') || ab, abB = process.argv.includes('--abB') || ab;
  const A = makeBrain(arg('a', 'nn'), eng, depthA, keepForDepth, quiesceA, arg('policyA', policy), timeMsA && +timeMsA, abA);
  const B = makeBrain(arg('b', 'L5'), eng, depthB, keepForDepth, quiesceB, arg('policyB', policy), timeMsB && +timeMsB, abB);
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
