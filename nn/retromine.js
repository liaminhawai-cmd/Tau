// Mine "the true point of no return": play a weak-vs-weak seed game, then walk backward through it
// asking, at each position, HOW STRONG the loser has to be to turn it around. Every replay is
// logged as a real, decided game -- exactly the training signal a net that "doesn't pull the
// trigger" is missing, since a finish it actually botched shows up here as a position where a
// stronger version of the loser converts and it didn't.
//
//   node nn/retromine.js [--seeds 20] [--summary nn/elo-summary.json] [--maxDepth 2]
//                        [--seedBottom 6] [--bigGuns 4] [--probesPerPos 10]
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
//     ask the top of the pool directly. If THAT fails, the position is dead as far as anything we
//     have can tell: record it, step back one more ply, and let the same occupant try again there.
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
const { playGame } = require('./selfplay.js');
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
  const probesPerPos = Math.max(2, +arg('probesPerPos', 10));
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
      pool.push({ id, elo: v.elo || 0, name: id,
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
      pool.push({ id, elo: v.elo || 0, name: id,
                  fn: idx => nnPlanFor(eng, net, idx, { depth: v.depth || 1 }) });
    }
  }
  pool.sort((a, b) => a.elo - b.elo);
  if (pool.length < 4) {
    console.error(`only ${pool.length} rated brains in ${summaryPath} -- not enough of an axis to ` +
                  `search. Let the pool accumulate first.`);
    process.exit(1);
  }

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
    if (seed.winner === null) continue;   // capped/wedged seed -- nothing to search

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
      if (floor[0] >= pool.length - 1 && floor[1] >= pool.length - 1) break;
      const point = seed.rows[seed.rows.length - rewind];
      const seedPose = { p: point.p, m: point.mover };
      const defender = 1 - climber;
      // the defender holds its own current strength throughout this search -- the question being
      // asked is "how weak a brain suffices to beat THIS defender from here", so moving both at
      // once would make the answer uninterpretable
      const def = pool[floor[defender]];

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
        const cand = pool[i];
        const brainA = climber === 0 ? cand.fn : def.fn;
        const idBlue = climber === 0 ? cand.id : def.id;
        const idRed = climber === 0 ? def.id : cand.id;
        const result = playGame(eng, brainA, climber === 0 ? def.fn : cand.fn,
                                maxPlies, 0, seedPose, false);
        replays++; probes++;
        if (result.winner === null) continue;   // capped/wedged -- tells us nothing either way
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
        // nothing in the pool escaped: this position is dead as far as we can measure. The seat
        // KEEPS its earned strength -- the ratchet does not slip on a dead position -- and one
        // ply earlier the same occupant gets the first try again.
        deadAt.push({ rewind, side: climber });
        deadFound++;
        rewind++;
        seatBeatenHere = false;     // fresh position: the occupant has not lost from HERE
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
