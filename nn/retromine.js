// Mine "the true point of no return": play a weak-vs-weak seed game, then walk backward through it
// asking, at each position, HOW STRONG the loser has to be to turn it around. Every replay is
// logged as a real, decided game -- exactly the training signal a net that "doesn't pull the
// trigger" is missing, since a finish it actually botched shows up here as a position where a
// stronger version of the loser converts and it didn't.
//
//   node nn/retromine.js [--seeds 20] [--summary nn/elo-summary.json] [--maxDepth 2]
//                        [--seedBottom 6] [--bigGuns 4] [--ultimateGuns 1] [--probesPerPos 10]
//                        [--randomStartFrac 0.3] [--maxReplaysPerSeed 60]
//                        [--out nn/data/retro.jsonl]
//
// THE STRENGTH AXIS is the standing rating pool (elo-summary.json), not a hand-assembled ladder.
// Every rated brain -- ladder rungs and (net x depth) pairs alike -- is a candidate escaper, sorted
// by measured Elo. This replaces the old --ensemble "path@rank" spec, which asked a human to paste
// in ranks the pool already knows, and it gets granular for free: every model the trainer ever
// places is another rung on this axis. D3+ entries are excluded by default (--maxDepth): a depth-3
// game runs ~20x a depth-1 game, which is measurement-session territory, not mining-loop territory.
//
// THE SEARCH at each rewound position is a bisection over that axis, not a rung-by-rung climb.
// A linear climb from the bottom pays one game per rung and the pool keeps growing rungs; the
// bisection pays ~log2(pool) games for the same answer: the LOWEST-rated brain that can escape.
//   - the seat's CURRENT occupant tries first (unless its loss at this exact position is what
//     brought us here) -- rolling back a ply usually makes a position easier, and "does it STILL
//     lose from here?" is the question the whole design asks before any climbing starts
//   - it still loses -> bisect above it: probe midway to the top of the pool, jump up on failure,
//     narrow down on escape, until the gap closes on the lowest escaper
//   - `--bigGuns` straight failures with no escape found -> stop bisecting hopeless territory and
//     ask the top of the D1/D2 pool directly. If THAT fails too, one last resort before calling it
//     dead: --ultimateGuns, whichever ALREADY-MEASURED brain at ANY depth is the single highest
//     Elo in the whole summary. This used to mean "the same weights, one ply deeper" on the
//     assumption that more search helps -- real data killed that assumption: a live refit showed
//     ultra D2 at 509 and ultra D3 at 144, l15_value D2 at 397 and D3 at -46, and that D2-spike/
//     D3-crash shape recurring across most of the pool, not the isolated case it first looked
//     like. Reaching one ply deeper on the SAME net can hand back something WORSE than what just
//     lost. Asking "what's genuinely strongest, at any cost tier" costs nothing extra to compute
//     (the Elo is already measured -- no new games needed to know it) and can't make that mistake.
//     It only fires at the exact moment the D1/D2 pool's own top has just lost, which by
//     construction should be rare, so the cost of a possibly-expensive D3 brain lands on the
//     hardest handful of positions instead of everywhere. If EVEN THAT fails, the position is
//     dead as far as anything we have can tell: record it, step back one more ply, and let the
//     same occupant try again there.
// THE RATCHET (the design's actual name): each seat's strength only ever moves UP during a seed.
// An escape puts the escaper in that seat for the rest of the walk backward -- a side that needed
// a 1666-rated brain to get out of one position does not hand the seat back to the 500 it started
// as at the next -- and a dead position does NOT slip it back down either. The other side then
// gets the same upgrade path (its seat just started losing, so IT bisects for a counter), and the
// seed ends when both seats have ratcheted to the top of the pool: top-vs-top with nothing left
// to climb means the escape question has no move left in it -- "11 vs 11, no more rollbacks".

//
// Every probe game is a real, decided, logged game (src:'retro', fam) in selfplay's row schema,
// with `mv` stamped from the pool ids so eloweight.js can weight these rows like any others. The
// "wasted" probes of an unlucky bisection are not waste: those games ARE the data.
//
// A single deterministic brain can fail to find an escape that exists, so a mined "dead" verdict
// means "nothing in the pool found a way out", never a proof that none exists.
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { MLP } = require('./net.js');
// selfplay.js is now an "evolution" CLI wrapper (spawns selfplay-legacy.js as a subprocess and
// exports nothing) -- it stopped exporting playGame when it took on that role, which broke this
// require silently (destructuring undefined gives undefined, not a load error) until retromine
// actually tried to CALL it and crashed with "playGame is not a function" on the first game of
// every job. playGame itself still lives, unchanged, in selfplay-legacy.js -- go straight there.
const { playGame } = require('./selfplay-legacy.js');
const { nnPlanFor } = require('./nnai.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function main() {
  const seeds = +arg('seeds', 20);
  const summaryPath = arg('summary', path.join(__dirname, 'elo-summary.json'));
  const maxDepth = Math.max(1, +arg('maxDepth', 2));
  const seedBottom = Math.max(2, +arg('seedBottom', 6));
  const bigGuns = Math.max(1, +arg('bigGuns', 4));
  // See the header note above -- --ultimateGuns 0 disables the escape hatch entirely (routine
  // dead verdicts only ever look as deep as maxDepth).
  const useUltimateGuns = arg('ultimateGuns', '1') !== '0';
  const probesPerPos = Math.max(2, +arg('probesPerPos', 10));
  // "How close to the top do we call it?" A seat within this many Elo of the axis top counts as
  // AT the top for the purposes of ending a seed. The last few entries of the axis are packed
  // (~40-60 Elo apart -- 55/45 matchups), so forcing both seats to grind through them literally
  // buys coinflip results, not information; the ratchet's answer is already known to within the
  // margin. 0 restores the strict both-seats-at-the-literal-top behaviour.
  const topMarginElo = Math.max(0, +arg('topMarginElo', 60));
  // WILDCARDS: brains tried before a position is written off as dead, REGARDLESS of where they sit
  // on the Elo axis. The bisection above finds "the lowest-rated brain that can escape", which is
  // only the right question if escape-ability rises monotonically with rating -- and it does not.
  // index.html says so in its own words about the top of the ladder: "the ladder top is a STYLE
  // cycle, not a strict ranking -- L10's territory style preys on L9 but has a hole a human's style
  // walks through." A brute, aggressive brain finds escapes a subtle one never looks for.
  // That matters here because of how the bisection narrows: every failed probe does
  // `lo = Math.max(lo, i)`, permanently abandoning everything BELOW that index. So a low-rated
  // stylistic escaper is never asked, and the position gets logged `dead` when an escape existed --
  // the most expensive error this miner can make, since "unescapable" is exactly the training
  // signal it exists to produce.
  // Only fires when the position is otherwise about to be called dead, so the cost is bounded to
  // the hard positions, same as the ultimateGuns hatch. Empty string disables.
  const wildcardIds = arg('wildcards', 'L2,L1').split(',').map(s => s.trim()).filter(Boolean);
  const randomStartFrac = +arg('randomStartFrac', 0.3);
  const maxReplaysPerSeed = Math.max(1, +arg('maxReplaysPerSeed', 60));
  const maxPlies = +arg('maxPlies', 300);
  const openingPlies = +arg('openingPlies', 2);
  const out = arg('out', path.join(__dirname, 'data', 'retro.jsonl'));

  const eng = createEngine();

  // --- build the strength axis from the pool ----------------------------------------------------
  let summary;
  try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch (e) {
    console.error(`no rating pool at ${summaryPath} -- run the trainer's pool cycle or RANK.bat ` +
                  `first (the pool IS the strength axis now; there is nothing to climb without it)`);
    process.exit(1);
  }
  const pool = [];
  for (const [id, v] of Object.entries(summary.players || {})) {
    if (v.kind === 'ladder') {
      if ((v.games || 0) < 1) continue;   // an unplayed rung has a default 0 rating, not a place
      pool.push({ id, elo: v.elo || 0, name: id, kind: 'ladder',
                  fn: idx => eng.ladderPlanFor(v.level - 1, idx) });
    } else if (v.kind === 'nn') {
      if ((v.games || 0) < 4 || (v.depth || 1) > maxDepth) continue;
      // summaries written by elorank point at its .elo-snapshot copies; fall back to the live
      // models dir if a snapshot has been cleaned up since
      let mp = v.model;
      if (!mp || !fs.existsSync(mp)) mp = path.join(__dirname, 'models', path.basename(v.model || (id.split('@')[0] + '.json')));
      if (!fs.existsSync(mp)) continue;
      let net;
      try { net = MLP.fromJSON(JSON.parse(fs.readFileSync(mp, 'utf8'))); } catch (e) { continue; }
      // net and depth kept on the entry itself, not just closed over by fn -- keeping the raw
      // net around (rather than only fn) is what lets the ultimate-guns escape hatch below load
      // and reuse weights without a second, separate model-loading pass.
      pool.push({ id, elo: v.elo || 0, name: id, kind: 'nn', net, depth: v.depth || 1,
                  fn: idx => nnPlanFor(eng, net, idx, { depth: v.depth || 1 }) });
    }
  }
  pool.sort((a, b) => a.elo - b.elo);
  if (pool.length < 4) {
    console.error(`only ${pool.length} rated brains in ${summaryPath} -- not enough of an axis to ` +
                  `search. Let the pool accumulate first.`);
    process.exit(1);
  }

  const topEntry = pool[pool.length - 1];
  // The escape hatch: whichever ALREADY-MEASURED brain, at ANY depth, is genuinely the single
  // highest Elo in the whole summary -- not the D1/D2 pool's own top reached one ply deeper (see
  // the header note for why that assumption doesn't hold here). Scanning the summary directly,
  // not `pool`, is what lets this reach D3+ entries the ordinary pool excludes by --maxDepth.
  // Costs nothing extra to determine: the Elo is already measured, no new games needed to know it.
  let globalBest = null;
  for (const [id, v] of Object.entries(summary.players || {})) {
    if (v.kind !== 'nn' || (v.games || 0) < 4) continue;
    if (!globalBest || (v.elo || 0) > globalBest.elo) globalBest = { id, ...v };
  }
  // Skip it if the global best turns out to just BE the pool's own top -- replaying the exact
  // same weights at the exact same depth against a position they just lost is not a second
  // opinion, it is the same opinion again.
  const ultimateGuns = (useUltimateGuns && globalBest && globalBest.id !== topEntry.id)
    ? (() => {
        let mp = globalBest.model;
        if (!mp || !fs.existsSync(mp))
          mp = path.join(__dirname, 'models', path.basename(globalBest.model || (globalBest.id.split('@')[0] + '.json')));
        if (!fs.existsSync(mp)) return null;
        let gnet;
        try { gnet = MLP.fromJSON(JSON.parse(fs.readFileSync(mp, 'utf8'))); } catch (e) { return null; }
        return { id: globalBest.id, elo: globalBest.elo || 0,
                fn: idx => nnPlanFor(eng, gnet, idx, { depth: globalBest.depth || 1 }) };
      })()
    : null;
  // floor[] values are allowed to reach pool.length (one past the ordinary top) to mean "proven at
  // the ultimateGuns tier" -- this resolves that sentinel to an actual playable brain everywhere a
  // pool index gets turned into one, instead of every call site needing its own bounds check.
  const brainAt = i => i < pool.length ? pool[i] : ultimateGuns;
  const axisTop = ultimateGuns ? pool.length : pool.length - 1;
  // The index a seat must reach for its climb to be called over: the lowest axis entry within
  // --topMarginElo of the top. Only the SEED-TERMINATION guard uses this -- the escape search
  // itself still probes all the way up (and through the guns), so a genuinely stronger escaper is
  // still found and recorded; the margin just stops the seed from re-litigating coinflips between
  // near-equal top entries after both seats are already there.
  let calledTop = axisTop;
  for (let i = 0; i < pool.length; i++)
    if (topEntry.elo - pool[i].elo <= topMarginElo) { calledTop = Math.min(calledTop, i); break; }
  if (calledTop < pool.length - 1)
    console.log(`  seats call it at ${pool[calledTop].name} (${Math.round(pool[calledTop].elo)} Elo, ` +
                `within ${topMarginElo} of ${topEntry.name}) -- the last ` +
                `${pool.length - 1 - calledTop} rung(s) are coinflip territory`);
  if (ultimateGuns)
    console.log(`  escape hatch armed: ${ultimateGuns.id} (${Math.round(ultimateGuns.elo)} Elo) if ` +
                `${topEntry.name} (the top of the ordinary D${maxDepth}-capped axis) fails`);
  // Resolve wildcards against the pool the axis was actually built from, so a typo or a brain that
  // isn't rated yet is reported now rather than silently never firing all night.
  const wildcards = [];
  for (const id of wildcardIds) {
    const hit = pool.find(p => p.id === id);
    if (hit) wildcards.push(hit);
    else console.log(`  (wildcard "${id}" is not in the rated pool -- skipping it)`);
  }
  if (wildcards.length)
    console.log(`  wildcards armed: ${wildcards.map(w => `${w.id}@${Math.round(w.elo)}`).join(', ')} ` +
                `-- tried before any position is called dead, regardless of axis position`);

  const ws = fs.createWriteStream(out, { flags: 'a' });
  let famCount = 0, gameCount = 0, positions = 0, deadFound = 0;
  const discount = 0.995;
  // Same row schema selfplay.js writes (f, z, p, m, g) so train.js and policy-targets.js consume
  // this file with no changes, plus src:'retro' for ablation, fam to trace every replay back to
  // its seed game, and mv so these rows join the pool like any others.
  function writeGame(rows, winner, fam, idBlue, idRed) {
    const gameId = `retro-${fam}-${gameCount++}`;
    for (let i = 0; i < rows.length; i++) {
      const z = (rows[i].mover === winner ? 1 : -1)*Math.pow(discount, rows.length - i);
      ws.write(JSON.stringify({ f: rows[i].f.map(v => +v.toFixed(5)), z: +z.toFixed(4),
                                p: rows[i].p.map(v => +v.toFixed(4)), m: rows[i].mover,
                                g: gameId, src: 'retro', fam,
                                mv: rows[i].mover === 0 ? idBlue : idRed }) + '\n');
      positions++;
    }
  }

  console.log(`retromine: ${seeds} seeds over a ${pool.length}-brain axis ` +
              `(${Math.round(pool[0].elo)}..${Math.round(pool[pool.length - 1].elo)} Elo)\n` +
              `  ${pool.map(r => `${r.name}@${Math.round(r.elo)}`).join(' -> ')}\n` +
              `  -> ${out}`);

  for (let s = 0; s < seeds; s++) {
    // Two ADJACENT low-rated brains, so the seed game is even (someone genuinely outplays someone,
    // rather than a foregone squash) and weak (the endings weak play produces are the ones the net
    // actually reaches and botches).
    // ...and strictly below the top: a seed side that starts AT the top of the pool has nothing
    // above it to climb to, so every rewind would print a vacuous "dead" without playing a game
    // (exactly what a 4-brain smoke-test pool produced).
    const si = Math.floor(Math.random()*Math.max(1, Math.min(seedBottom, pool.length - 2)));
    const seedA = pool[si], seedB = pool[si + 1];
    const seed = playGame(eng, seedA.fn, seedB.fn, maxPlies, openingPlies, null,
                          Math.random() < randomStartFrac);
    // capped/wedged seed -- nothing to search. An adjudicated seed counts as capped here: the komi
    // rule's call agrees with who would really have won about three times in four, which is a fine
    // training label but far too soft to hang a whole rewind search off ("who lost this, and where").
    if (seed.winner === null || seed.adjudicated) continue;

    const fam = famCount++;
    writeGame(seed.rows, seed.winner, fam, seedA.id, seedB.id);
    // per-side floor: index into `pool` of the brain currently occupying this side's seat. The
    // ratchet: it moves up on escapes and never moves back down for the rest of the seed.
    const floor = [si, si + 1];
    // whether the current climber's occupant already lost from the CURRENT position (the seed
    // game itself for the very first search, or the escape that just flipped the roles) -- if so
    // its seat test would replay a known loss, so the search starts above it instead
    let seatBeatenHere = true;
    let rewind = 1, climber = 1 - seed.winner, replays = 0;
    const deadAt = [];

    while (replays < maxReplaysPerSeed && rewind <= seed.rows.length) {
      // both seats at the top of the pool: nothing left for either side to climb, so the escape
      // question is out of moves -- the seed is mined out ("11 vs 11 -- no more rollbacks to do")
      if (floor[0] >= calledTop && floor[1] >= calledTop) break;
      const point = seed.rows[seed.rows.length - rewind];
      const seedPose = { p: point.p, m: point.mover };
      const defender = 1 - climber;
      // the defender holds its own current strength throughout this search -- the question being
      // asked is "how weak a brain suffices to beat THIS defender from here", so moving both at
      // once would make the answer uninterpretable
      const def = brainAt(floor[defender]);

      // --- find the lowest escaper -------------------------------------------------------------
      let lo = floor[climber];        // strongest index known (or assumed) to fail from here
      let found = -1;                 // lowest index known to escape
      let fails = 0, probes = 0, testedSeat = seatBeatenHere;
      while (probes < probesPerPos && replays < maxReplaysPerSeed) {
        let i;
        if (!testedSeat) {
          // the seat's current occupant tries first: after a rewind the position just got easier,
          // and if it escapes at its existing strength the ratchet correctly does not move
          i = lo; testedSeat = true;
        } else if (found < 0) {
          if (lo >= pool.length - 1) break;                     // even the top failed: dead
          i = fails >= bigGuns ? pool.length - 1               // big guns: settle it now
            : Math.max(lo + 1, Math.ceil((lo + pool.length - 1)/2));
        } else {
          if (found - lo <= 1) break;                           // converged on the boundary
          i = (lo + found) >> 1;
        }
        const cand = brainAt(i);
        const brainA = climber === 0 ? cand.fn : def.fn;
        const idBlue = climber === 0 ? cand.id : def.id;
        const idRed = climber === 0 ? def.id : cand.id;
        const result = playGame(eng, brainA, climber === 0 ? def.fn : cand.fn,
                                maxPlies, 0, seedPose, false);
        replays++; probes++;
        // capped/wedged/adjudicated -- tells us nothing either way (see the seed check above)
        if (result.winner === null || result.adjudicated) continue;
        writeGame(result.rows, result.winner, fam, idBlue, idRed);
        if (result.winner === climber) found = i;
        else { lo = Math.max(lo, i); fails++; }
      }

      if (found >= 0) {
        // not dead after all -- the ratchet clicks (or holds, if the seat escaped at its existing
        // strength) and the OTHER side now gets the same upgrade path at this same position: its
        // seat just started losing here, which is exactly the condition that starts a climb
        floor[climber] = Math.max(floor[climber], found);
        climber = defender;
        seatBeatenHere = true;      // the new climber's occupant just lost this very game
      } else if (probes === 0) {
        // the climber is already AT the top of the pool with its loss here already on record --
        // nothing above it to try, and the top-vs-top guard above ends the seed if both are maxed
        break;
      } else {
        // Nothing in the ordinary pool escaped. One more thing to try before calling this dead:
        // the SAME top-of-axis weights, one ply deeper -- guarded by floor[climber] < pool.length
        // so a seat that has already been proven (or disproven) at this tier here is not retried.
        let escapedViaGuns = false;
        if (ultimateGuns && floor[climber] < pool.length && replays < maxReplaysPerSeed) {
          const brainA = climber === 0 ? ultimateGuns.fn : def.fn;
          const idBlue = climber === 0 ? ultimateGuns.id : def.id;
          const idRed = climber === 0 ? def.id : ultimateGuns.id;
          const result = playGame(eng, brainA, climber === 0 ? def.fn : ultimateGuns.fn,
                                  maxPlies, 0, seedPose, false);
          replays++;
          if (result.winner !== null && !result.adjudicated) {
            writeGame(result.rows, result.winner, fam, idBlue, idRed);
            if (result.winner === climber) {
              escapedViaGuns = true;
              floor[climber] = pool.length;
              console.log(`  seed ${fam}, ${rewind} plies from the end: ${ultimateGuns.id} escaped ` +
                          `where ${topEntry.name} (the top of the ordinary axis) couldn't`);
            }
          }
        }
        if (escapedViaGuns) {
          // exactly the ordinary-escape path: the ratchet clicks at the deepest tier, and the
          // other side gets the same upgrade path at this same position
          climber = defender;
          seatBeatenHere = true;
        } else {
          // Last chance before calling it dead: the wildcards, whatever their rating. The bisection
          // abandoned everything below its last failed probe, so a brute/erratic brain that would
          // have barged out of here has not actually been asked. Cheap (one game each) and only on
          // positions already headed for a dead verdict.
          let escapedViaWild = false;
          for (const wc of wildcards) {
            if (replays >= maxReplaysPerSeed) break;
            const brainA = climber === 0 ? wc.fn : def.fn;
            const idBlue = climber === 0 ? wc.id : def.id;
            const idRed  = climber === 0 ? def.id : wc.id;
            const result = playGame(eng, brainA, climber === 0 ? def.fn : wc.fn,
                                    maxPlies, 0, seedPose, false);
            replays++;
            if (result.winner === null || result.adjudicated) continue;
            writeGame(result.rows, result.winner, fam, idBlue, idRed);
            if (result.winner === climber) {
              escapedViaWild = true;
              console.log(`  seed ${fam}, ${rewind} plies from the end: WILDCARD ${wc.id} ` +
                          `(${Math.round(wc.elo)} Elo) escaped where the axis top failed`);
              break;
            }
          }
          if (escapedViaWild) {
            // A wildcard escape says the position is alive, not that the seat is now only as strong
            // as the wildcard -- floor[] must never slip down, so it is deliberately left untouched
            // here (unlike the ordinary and guns escapes, which raise it).
            climber = defender;
            seatBeatenHere = true;
          } else {
            // nothing at any depth we're willing to pay for escaped: this position is dead as far
            // as we can measure. The seat KEEPS its earned strength -- the ratchet does not slip on
            // a dead position -- and one ply earlier the same occupant gets the first try again.
            deadAt.push({ rewind, side: climber, triedGuns: !!ultimateGuns });
            deadFound++;
            rewind++;
            seatBeatenHere = false;   // fresh position: the occupant has not lost from HERE
          }
        }
      }
    }
    if (deadAt.length) {
      const d = deadAt[deadAt.length - 1];
      console.log(`seed ${fam}: dead at ${d.rewind} plies from the end for ` +
                  `${d.side === 0 ? 'blue' : 'red'} (nothing in the pool escaped), ` +
                  `${replays} replays, ${gameCount} games logged so far`);
    }
  }
  ws.end(() => console.log(`retromine done: ${famCount} seed families, ${deadFound} dead positions, ` +
                           `${gameCount} games, ${positions} positions -> ${out}`));
}

main();
