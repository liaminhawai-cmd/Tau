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
const { playRandomOpening, randomStartPose } = require('./opening.js');

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
function makeBrain(spec, eng, depth, keepForDepth, quiesce, policyPath, timeMs, abCut, policyArms) {
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
    // timeMs may be a number OR a live {ms} box shared by both sides -- the randomised-clock mode
    // below rewrites that box between games, so the brain has to read it per move rather than
    // close over a fixed number.
    const tm = () => (typeof timeMs === 'object' ? timeMs.ms : timeMs);
    const tTag = typeof timeMs === 'object' ? 'Trand' : 'T' + timeMs + 'ms';
    // arm count rides in the name: every pooled result so far silently used the default of 3, and
    // a score line that doesn't say which is a score line that can't be compared to another run.
    const aTag = (policy && !abCut && policyArms) ? ',A' + policyArms : '';
    return { name: 'nn(' + path.basename(mp) + ',' + tTag + kTag + pTag + aTag + ')',
             fn: idx => nnPlanForTimed(eng, net, idx, { temperature, keepForDepth, quiesce, policy,
                                                        timeMs: tm(), policyArms,
                                                        policyPrune: !!policy && !abCut, abCut: !!abCut }) };
  }
  // Depth is reported as e.g. "D1.5" when quiesce rides on top of a plain depth-1 pass -- matches
  // how the mix names it, and makes a quiesce-vs-plain A/B legible at a glance in the score line
  // instead of two "D1" entries that secretly differ.
  const depthLabel = quiesce ? depth + 0.5 : depth;
  const aTagD = (policy && !abCut && policyArms) ? ',A' + policyArms : '';
  return { name: 'nn(' + path.basename(mp) + (temperature ? ',T' + temperature : '') + (depthLabel > 1 ? ',D' + depthLabel : '') +
           kTag + pTag + aTagD + ')',
           fn: idx => nnPlanFor(eng, net, idx, { temperature, depth, keepForDepth, quiesce, policy, policyArms,
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
  // --timeMsLo/--timeMsHi: instead of one fixed clock, draw a fresh think time per GAME and give
  // BOTH sides the same one. Point: iterative deepening only banks WHOLE plies, and one more ply
  // costs 4-6x, so whether a search saving converts into strength depends entirely on where the
  // budget happens to sit relative to the next ply boundary. A saving of ~35% (what policy pruning
  // measures) is worth ~1.5x effective time -- never a whole ply on its own, but enough to tip the
  // search over the edge when the clock already sits just short of one. At a single fixed clock a
  // run is stuck in one regime forever and reports the average of a structure it never reveals;
  // sampling across budgets separates "never helps" from "helps in the band where it banks a ply".
  // Drawn LOG-uniformly because ply boundaries are multiplicative -- uniform-in-milliseconds would
  // put most draws in the top octave and barely probe the short clocks at all.
  const timeMsLo = arg('timeMsLo', null), timeMsHi = arg('timeMsHi', null);
  const clock = (timeMsLo && timeMsHi)
    ? { ms: +timeMsLo, lo: +timeMsLo, hi: +timeMsHi }
    : null;
  const drawClock = () => {
    if (!clock) return null;
    const l = Math.log(clock.lo), h = Math.log(clock.hi);
    clock.ms = Math.round(Math.exp(l + Math.random()*(h - l)));
    return clock.ms;
  };
  const timeMsA = clock || arg('timeMsA', timeMs), timeMsB = clock || arg('timeMsB', timeMs);
  // --ab switches a policy side from hard pruning to ordering+cutoff; --abA/--abB per side, so a
  // policy can be pitted against ITSELF used the other way -- the only comparison that isolates
  // which use of the policy is better, rather than whether having one helps at all.
  const ab = process.argv.includes('--ab');
  const abA = process.argv.includes('--abA') || ab, abB = process.argv.includes('--abB') || ab;
  const keepA = +arg('keepA', keepForDepth), keepB = +arg('keepB', keepForDepth);
  // the clock box passes through as-is; a plain --timeMs string still becomes a number
  // --policyArms: how many of the 6 arms a PRUNING side keeps in the recursive opponent search.
  // Exposed because it is the single dial that decides whether pruning can buy a ply at all, and
  // it was previously reachable only by editing nnai.js's default of 3. Pruning applies at every
  // recursive level, so the saving compounds with depth: keeping 3 is 42% at depth 2 but 69% at
  // depth 3, and keeping 2 is 83% at depth 3 and 94% at depth 4. One more ply costs 4-6x, so
  // keeping 3 never reaches it below depth 4 while keeping 2 clears it at depth 3 -- which is why
  // a fixed default of 3 could look like "pruning structurally cannot pay" when it was really
  // "this arm count cannot pay at this depth". No effect on an --ab side, which orders rather
  // than deletes.
  const policyArms = +arg('policyArms', 3);
  const policyArmsA = +arg('policyArmsA', policyArms), policyArmsB = +arg('policyArmsB', policyArms);
  const asClock = t => (t && typeof t === 'object' ? t : t && +t);
  const A = makeBrain(arg('a', 'nn'), eng, depthA, keepA, quiesceA, arg('policyA', policy), asClock(timeMsA), abA, policyArmsA);
  const B = makeBrain(arg('b', 'L5'), eng, depthB, keepB, quiesceB, arg('policyB', policy), asClock(timeMsB), abB, policyArmsB);
  const games = +arg('games', 24);
  // both brains are commonly fully deterministic (nn at temperature 0, or a noise-free ladder
  // level) from the same fixed start -- without a shuffled opening, every game with the same
  // colour assignment would replay bit-for-bit identically, making "games" a repeat count, not a
  // sample size. See opening.js.
  const openingPlies = +arg('openingPlies', 2);
  const randomStartFrac = +arg('randomStartFrac', 0);

  // --saveData <file>: append training rows as the games are played (see the header note).
  // Appended per game rather than buffered to the end, for the same reason the score log is
  // rewritten per game -- a run that gets killed part-way must keep the games it already played.
  const saveData = arg('saveData', null);
  const discount = +arg('discount', 0.995);
  // The in-game ply cap, kept in step with the engine's own so a game that runs out of plies gets
  // SCORED by the komi rule rather than silently abandoned by this loop. Exposed for the same reason
  // selfplay.js exposes it: forcing a cap cheaply is the only way to test the scoring path.
  const maxPlies = +arg('maxPlies', 300);
  eng.CFG.moveCap = maxPlies;   // one cap: the engine scores it, this loop just stops looping
  // --resultsJsonl <file>: one line per game (clock, outcome, plies). Separate from --saveData,
  // which writes POSITION rows for training; this writes GAME rows for analysis.
  const resultsPath = arg('resultsJsonl', null);
  let resultsStream = null;
  if (resultsPath) {
    fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
    resultsStream = fs.createWriteStream(resultsPath, { flags: 'a' });
    console.log(`saving per-game results to ${resultsPath}`);
  }
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

  // Rating-pool ids for the two sides, so saved rows can be joined against the pool at TRAIN time
  // (see selfplay.js for why the id and not the rating is what gets stored). elorank.js passes its
  // own ids; a hand-run arena falls back to the brain names, which are at least descriptive.
  const idA = arg('idA', A.name), idB = arg('idB', B.name);
  // Komi wins are tallied APART from outright ones. A game the komi rule scored at the move cap is
  // a real result but worth CFG.komiLoss of a win, not all of it -- the call agrees with who would
  // actually have won 74-78% of the time -- so it must not sit in the same bucket as pushing a piece
  // off the board. Kept out of the W-L-D triple entirely rather than folded into draws: the three
  // callers that scrape that triple (run.js, elorank.js, policyloop.js) each read the komi split
  // separately and weight it, and any reader that does not simply ignores these games, which is the
  // safest way to be wrong about 0.4% of games.
  let aWins = 0, bWins = 0, draws = 0, aKomi = 0, bKomi = 0, pliesSum = 0;
  // A komi win is worth komiLoss of a win, which on the 0..1 scale a rating fit uses means the
  // winner takes 0.5 + komiLoss/2 and the loser the rest -- komiLoss of the way from a draw to a
  // win, exactly the same mapping the training label uses (z = +-komiLoss on a -1..1 scale).
  const kw = 0.5 + eng.CFG.komiLoss/2;
  const scores = (aw, bw, ak, bk) => ({ a: aw + kw*ak + (1 - kw)*bk,
                                        b: bw + kw*bk + (1 - kw)*ak });
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const aIsBlue = g % 2 === 0;
    eng.newGame();
    // --randomStartFrac: this fraction of games starts from a fully random LEGAL pose instead of
    // the canonical start (see opening.js's randomStartPose). Off by default -- for evaluation a
    // shared canonical start is what makes two brains comparable -- but available because arena
    // games become training data whenever --saveData is on, and that data wants coverage of
    // shapes no real trajectory reaches.
    // Fresh clock per game, both sides matched (see --timeMsLo/--timeMsHi above).
    const gameMs = drawClock();
    const randomStart = Math.random() < randomStartFrac;
    if (randomStart) { randomStartPose(eng); eng.setActive(Math.random() < 0.5 ? 0 : 1); }
    else playRandomOpening(eng, openingPlies);
    let plies = 0, nulls = 0;
    const rows = [];
    while (!eng.getG().over && plies < maxPlies) {
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
    const aWon = (G.winner === 0) === aIsBlue;
    if (!G.over) draws++;
    else if (G.winner === null) draws++;              // adjudicated dead level -- a true draw
    else if (G.adjudicated) { if (aWon) aKomi++; else bKomi++; }
    else if (aWon) aWins++;
    else bWins++;
    // One machine-readable line per game. The point of a randomised clock is to BIN by it
    // afterwards -- a pooled win rate over mixed budgets is exactly the average that hides the
    // structure the randomisation exists to expose -- and that needs the per-game clock stored
    // next to the per-game outcome, which no other output here carries.
    if (resultsStream) {
      const outcome = (!G.over || G.winner === null) ? 'draw' : (aWon ? 'A' : 'B');
      resultsStream.write(JSON.stringify({
        game: g, timeMs: gameMs, outcome, adjudicated: !!G.adjudicated,
        plies, aIsBlue, randomStart,
      }) + '\n');
    }
    // Decided games only. A ply-capped shuffle has no outcome to label rows with, and a wedged
    // abandon describes a degenerate stuck state -- selfplay.js excludes both and so does this.
    if (dataStream && G.over && G.winner !== null) {
      const gameId = RUN_TAG + '-' + g;
      // Same labelling as selfplay.js: a komi win is scaled to CFG.komiLoss of a win and marked
      // with adj, so it stays separable from a piece genuinely going off the board.
      const scale = G.adjudicated ? eng.CFG.komiLoss : 1;
      const adj = G.adjudicated ? { adj: 1 } : null;
      for (let i = 0; i < rows.length; i++) {
        const z = scale*(rows[i].m === G.winner ? 1 : -1)*Math.pow(discount, rows.length - i);
        // `m` is the mover's SIDE; aIsBlue says which brain held side 0 this game.
        const mv = (rows[i].m === 0) === aIsBlue ? idA : idB;
        dataStream.write(JSON.stringify({ f: rows[i].f.map(v => +v.toFixed(5)), z: +z.toFixed(4),
                                          p: rows[i].p.map(v => +v.toFixed(4)), m: rows[i].m,
                                          g: gameId, mv, ...adj,
                                          ...(randomStart ? { src: 'random' } : {}) }) + '\n');
        savedRows++;
      }
    }
    process.stdout.write(`\rgame ${g + 1}/${games}: ${A.name} ${aWins} — ${bWins} ${B.name}` +
                         (aKomi + bKomi ? ` (komi ${aKomi}-${bKomi})` : '') +
                         (draws ? ` (${draws} draws)` : '') + '   ');
    // 2 sigma on the decided games, so a partial run can be read honestly the moment it is read.
    // Without it the standing score invites the exact mistake a 6-game 4-2 already caused once.
    const s = scores(aWins, bWins, aKomi, bKomi), dec = s.a + s.b;
    const band = dec ? 100*Math.sqrt(0.25/dec)*2 : 0;
    writeLog(`IN PROGRESS -- game ${g + 1} of ${games} (${((Date.now() - t0)/1000).toFixed(0)}s)\n` +
             `${A.name} ${aWins} - ${bWins} ${B.name}` +
             (aKomi + bKomi ? ` (komi ${aKomi}-${bKomi})` : '') + `${draws ? ` (${draws} draws)` : ''}\n` +
             (dec ? `${(100*s.a/dec).toFixed(0)}% of ${dec.toFixed(1)} decided, 2-sigma +/- ${band.toFixed(0)} points\n` : ''));
  }
  const secs = (Date.now() - t0)/1000;
  const s = scores(aWins, bWins, aKomi, bKomi), dec = Math.max(1, s.a + s.b);
  // The W-L(-D) triple stays outright games only, and the komi split rides in its own field: the
  // three scrapers of this line each fold it in at komiLoss, and anything else ignores it.
  const summary = `${A.name} vs ${B.name}: ${aWins}-${bWins}` + (draws ? `-${draws}` : '') +
                  `  (${aKomi + bKomi ? `komi ${aKomi}-${bKomi}, ` : ''}` +
                  `${(100*s.a/dec).toFixed(0)}% of decided, ` +
                  `avg ${(pliesSum/games).toFixed(0)} plies, ${secs.toFixed(0)}s)`;
  console.log('\n' + summary);
  writeLog(`FINISHED ${new Date().toISOString()}\n${summary}\n` +
           `2-sigma +/- ${(100*Math.sqrt(0.25/dec)*2).toFixed(0)} points on ${dec.toFixed(1)} decided games` +
           (aKomi + bKomi ? ` (${aKomi + bKomi} of them scored at the cap, worth ${eng.CFG.komiLoss} each)` : '') + `\n` +
           (dataStream ? `${savedRows} training rows -> ${saveData}\n` : ''));
  if (logPath) console.log(`saved to ${logPath}`);
  if (dataStream) { dataStream.end(); console.log(`${savedRows} training rows -> ${saveData}`); }
}

main();
