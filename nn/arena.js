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
const { features } = require('./features.js');
const { MLP } = require('./net.js');
const { nnPlanFor, nnPlanForTimed } = require('./nnai.js');
const { playRandomOpening } = require('./opening.js');

// --saveData turns an evaluation run into a data run as well. Every arena game is a real game with
// a real outcome, so throwing away everything but the win/loss tally wastes the whole run: a
// 200-game ladder benchmark is 200 games of training data that cost the same CPU either way.
// It matters most for exactly the games self-play cannot produce -- run.js draws its ladder
// opponents from the ZPD window (zpdLevels), so rungs above the frontier are never played at all
// and the net has literally never trained on them.
// Schema is selfplay.js's, byte for byte, so train.js needs no changes: f/z/p/m/g, z discounted
// toward 0 the further a position sits from the finish, positions kept only from DECIDED games.
const RUN_TAG = 'arena' + Math.random().toString(36).slice(2, 7) + process.pid.toString(36);

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
  // The policy FILE is part of the brain's identity, not just the fact that it has one. A
  // pointy-vs-flat duel is the same net at the same depth with the same budget on both sides and
  // ONLY the policy differing, so a bare ',P' makes both sides print a byte-identical name and the
  // score line becomes unreadable -- you cannot tell which number belongs to which policy. Same
  // failure the K tag below exists to prevent.
  const pTag = policy
    ? (abCut ? ',P-ab:' : ',P:') + path.basename(policyPath).replace(/\.json$/i, '')
    : '';
  // Shown only when it differs from the default, same reasoning as the D1.5 label above: a
  // keep-4-vs-keep-6 A/B is a same-net comparison, so without this both sides print an identical
  // name and the score line silently compares two things that look like the same brain.
  const kTag = keepForDepth !== 4 ? ',K' + keepForDepth : '';
  if (timeMs) {
    return { name: 'nn(' + path.basename(mp) + ',T' + timeMs + 'ms' + kTag + pTag + ')',
             fn: idx => nnPlanForTimed(eng, net, idx, { temperature, keepForDepth, quiesce, policy, timeMs,
                                                        policyPrune: !!policy && !abCut, abCut: !!abCut }) };
  }
  // Depth is reported as e.g. "D1.5" when quiesce rides on top of a plain depth-1 pass -- matches
  // how the mix names it, and makes a quiesce-vs-plain A/B legible at a glance in the score line
  // instead of two "D1" entries that secretly differ.
  const depthLabel = quiesce ? depth + 0.5 : depth;
  return { name: 'nn(' + path.basename(mp) + (temperature ? ',T' + temperature : '') + (depthLabel > 1 ? ',D' + depthLabel : '') +
           kTag + pTag + ')',
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
  // --keepA/--keepB override per side. This is the width dial: every waypoint across all six arms
  // gets a cheap 1-ply score, but only the top keepForDepth of them get a real opponent search, so
  // candidate #5 can be better than #2 and never be checked. Width is what a search saving can
  // actually buy -- it scales smoothly (15% saved ~= 15% more width), whereas depth only comes in
  // whole plies at 4-6x each, which is why the equal-think-time pruning test went nowhere.
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
  const keepA = +arg('keepA', keepForDepth), keepB = +arg('keepB', keepForDepth);
  const A = makeBrain(arg('a', 'nn'), eng, depthA, keepA, quiesceA, arg('policyA', policy), timeMsA && +timeMsA, abA);
  const B = makeBrain(arg('b', 'L5'), eng, depthB, keepB, quiesceB, arg('policyB', policy), timeMsB && +timeMsB, abB);
  const games = +arg('games', 24);
  // both brains are commonly fully deterministic (nn at temperature 0, or a noise-free ladder
  // level) from the same fixed start -- without a shuffled opening, every game with the same
  // colour assignment would replay bit-for-bit identically, making "games" a repeat count, not a
  // sample size. See opening.js.
  const openingPlies = +arg('openingPlies', 2);

  // --saveData <file>: append training rows as the games are played (see the header note).
  // Appended per game rather than buffered to the end, for the same reason the score log is
  // rewritten per game -- a run that gets killed part-way must keep the games it already played.
  const saveData = arg('saveData', null);
  const discount = +arg('discount', 0.995);
  let dataStream = null, savedRows = 0;
  if (saveData) {
    fs.mkdirSync(path.dirname(saveData), { recursive: true });
    dataStream = fs.createWriteStream(saveData, { flags: 'a' });
    console.log(`saving training rows to ${saveData}`);
  }

  // Mirror the score to disk. Console output used to be the ONLY record a run left, and a console
  // window is a terrible place to keep one: at the "Press any key to continue" prompt EVERY key
  // counts, including the Ctrl+A someone presses to copy the result -- which dismisses the pause
  // and clears the screen, destroying the thing they were reaching for. Two overnight runs were
  // lost exactly that way.
  // Rewritten in full after every game rather than appended once at the end, because the runs
  // worth keeping are the long ones that get killed part-way: a summary that only lands on clean
  // exit would miss precisely the case this exists for. One file per run, named by start time, so
  // two arenas running at once (the trainer machine does this) cannot clobber each other.
  const logDir = arg('logDir', path.join(__dirname, 'arena-logs'));
  const started = new Date();
  const safe = s => String(s).replace(/[^\w.\-]+/g, '_');
  let logPath = null;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    logPath = path.join(logDir,
      `${started.toISOString().slice(0, 19).replace(/[:]/g, '-')}_${safe(A.name)}_vs_${safe(B.name)}.txt`);
  } catch (e) { /* logging must never take down a run */ }
  const header = `started ${started.toISOString()}\ncommand: node ${process.argv.slice(1).join(' ')}\n`;
  const writeLog = body => {
    if (!logPath) return;
    try { fs.writeFileSync(logPath, header + body); } catch (e) { logPath = null; }
  };
  // Written immediately, not left until game 1 finishes: at depth 3 a single game can take 5-8
  // minutes, and a log file that does not exist yet is indistinguishable from one that failed.
  writeLog('STARTING -- no games finished yet\n');
  if (logPath) console.log(`logging to ${logPath}`);

  let aWins = 0, bWins = 0, draws = 0, pliesSum = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const aIsBlue = g % 2 === 0;
    eng.newGame();
    playRandomOpening(eng, openingPlies);
    let plies = 0, nulls = 0;
    const rows = [];
    while (!eng.getG().over && plies < 300) {
      const idx = eng.getG().active;
      const brain = (idx === 0) === aIsBlue ? A : B;
      // Captured BEFORE the move, so the row describes the position the mover actually decided
      // from. `p` is the raw pose: train.js ignores it, but it makes every row re-featurisable if
      // the feature set ever changes again, instead of dying with it (selfplay.js:84).
      if (dataStream) {
        const ps = eng.getG().pieces;
        rows.push({ f: features(eng), m: idx,
                    p: [ps[0].x, ps[0].y, ps[0].rot, ps[1].x, ps[1].y, ps[1].rot] });
      }
      const plan = brain.fn(idx);
      // rows.pop() matches selfplay.js: a null-planned ply never happened, so its row would
      // describe a position nobody moved from.
      if (!plan) { if (dataStream) rows.pop(); nulls++; if (nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
      nulls = 0;
      eng.applyPlan(plan);
      plies++;
    }
    const G = eng.getG();
    pliesSum += plies;
    if (!G.over) draws++;
    else if ((G.winner === 0) === aIsBlue) aWins++;
    else bWins++;
    // Decided games only. A ply-capped shuffle has no outcome to label rows with, and a wedged
    // abandon describes a degenerate stuck state -- selfplay.js excludes both and so does this.
    if (dataStream && G.over) {
      const gameId = RUN_TAG + '-' + g;
      for (let i = 0; i < rows.length; i++) {
        const z = (rows[i].m === G.winner ? 1 : -1)*Math.pow(discount, rows.length - i);
        dataStream.write(JSON.stringify({ f: rows[i].f.map(v => +v.toFixed(5)), z: +z.toFixed(4),
                                          p: rows[i].p.map(v => +v.toFixed(4)), m: rows[i].m,
                                          g: gameId }) + '\n');
        savedRows++;
      }
    }
    process.stdout.write(`\rgame ${g + 1}/${games}: ${A.name} ${aWins} — ${bWins} ${B.name}` +
                         (draws ? ` (${draws} draws)` : '') + '   ');
    // 2 sigma on the decided games, so a partial run can be read honestly the moment it is read.
    // Without it the standing score invites the exact mistake a 6-game 4-2 already caused once.
    const dec = aWins + bWins;
    const band = dec ? 100*Math.sqrt(0.25/dec)*2 : 0;
    writeLog(`IN PROGRESS -- game ${g + 1} of ${games} (${((Date.now() - t0)/1000).toFixed(0)}s)\n` +
             `${A.name} ${aWins} - ${bWins} ${B.name}${draws ? ` (${draws} draws)` : ''}\n` +
             (dec ? `${(100*aWins/dec).toFixed(0)}% of ${dec} decided, 2-sigma +/- ${band.toFixed(0)} points\n` : ''));
  }
  const secs = (Date.now() - t0)/1000;
  const dec = Math.max(1, aWins + bWins);
  const summary = `${A.name} vs ${B.name}: ${aWins}-${bWins}` + (draws ? `-${draws}` : '') +
                  `  (${(100*aWins/dec).toFixed(0)}% of decided, ` +
                  `avg ${(pliesSum/games).toFixed(0)} plies, ${secs.toFixed(0)}s)`;
  console.log('\n' + summary);
  writeLog(`FINISHED ${new Date().toISOString()}\n${summary}\n` +
           `2-sigma +/- ${(100*Math.sqrt(0.25/dec)*2).toFixed(0)} points on ${aWins + bWins} decided games\n` +
           (dataStream ? `${savedRows} training rows -> ${saveData}\n` : ''));
  if (logPath) console.log(`saved to ${logPath}`);
  if (dataStream) { dataStream.end(); console.log(`${savedRows} training rows -> ${saveData}`); }
}

main();
