// Mine "the true point of no return": play a weak-vs-weak seed game, then walk backward through it
// asking, at each position, HOW STRONG the loser has to be to turn it around. Every replay is
// logged as a real, decided game -- exactly the training signal a net that "doesn't pull the
// trigger" is missing, since a finish it actually botched shows up here as a position where a
// stronger version of the loser converts and it didn't.
//
//   node nn/retromine.js [--seeds 20] [--seedLevel 1] [--ceiling 11]
//                        [--model nn/models/best.json] [--ensemble wide.json@4.5,ultra.json@6.5]
//                        [--randomStartFrac 0.3] [--maxReplaysPerSeed 60]
//                        [--out nn/data/retro.jsonl]
//
// THE CLIMBING RULE
//
//   `rewind` = how many plies back from the game's end. At each position, the side that lost there
//   climbs the WHOLE strength ladder from its current rung upward -- L2, then L3, then L4, ... to
//   --ceiling -- replaying the position for real at each rung (both sides genuinely deciding every
//   move, not replaying old choices) and logging each attempt as its own game. The climb stops the
//   moment one of them wins.
//     - Nobody escapes, even at the ceiling: this position is dead as far as anything we have can
//       tell. Record the boundary, step back one more ply, and start climbing again there.
//     - Someone escapes at rung T: the position was not dead after all. Hand the problem to the
//       OTHER side at this same position -- they now climb from their own current rung to try to
//       beat the escape. If they can't, step back a ply and continue.
//
//   Exhausting the strength axis at each position before touching the rewind axis is what makes
//   the output meaningful. The alternative (bump the loser one rung, then immediately step back)
//   entangles the two axes: tiers carry forward as rewind grows, so by five plies back you are
//   also five rungs up, and a boundary found there cannot be attributed to depth-in-game rather
//   than to strength. Climbing fully at each position instead yields a well-defined scalar per
//   position -- the minimum rung that escapes it -- and a monotone difficulty curve as you rewind.
//   It costs more replays per position, but those replays ARE the data this exists to produce.
//
// THE STRENGTH LADDER is ladder rungs L1..L<ceiling> with NN models interleaved at their measured
// rank: --ensemble wide.json@4.5 slots that net between L4 and L5. This matters because the climb
// treats the rung index as a real strength ordering -- an NN dropped in at the wrong rank would
// make "the minimum rung that escapes" meaningless. --model (default best.json) is appended at the
// ceiling if given no explicit rank, so the current champion is always the last thing tried.
// A single deterministic brain can fail to find an escape that exists, so a mined "dead" verdict
// means "nothing on this ladder found a way out", never a proof that none exists.
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
  const seedLevel = Math.max(1, +arg('seedLevel', 1));
  const ceiling = Math.max(seedLevel, +arg('ceiling', 11));
  const randomStartFrac = +arg('randomStartFrac', 0.3);
  const maxReplaysPerSeed = Math.max(1, +arg('maxReplaysPerSeed', 60));
  const maxPlies = +arg('maxPlies', 300);
  const openingPlies = +arg('openingPlies', 2);
  const out = arg('out', path.join(__dirname, 'data', 'retro.jsonl'));

  const eng = createEngine();
  const LADDER_N = eng.AI_LADDER.length;
  if (ceiling > LADDER_N) {
    console.error(`--ceiling ${ceiling} exceeds the ladder's own top rung (L${LADDER_N})`);
    process.exit(1);
  }

  // Build the interleaved strength ladder. Ladder rungs sit at integer ranks; each --ensemble
  // entry sits at whatever rank it was given (path@rank), so a net measured as "between L4 and L5"
  // goes in at 4.5 and the climb reaches it in the right order. Depth for NN brains is scaled to
  // rank and capped at 3 -- deeper is the multi-hour-per-game territory measured elsewhere in this
  // project, not affordable inside a mining loop.
  const nnDepthFor = rank => Math.min(3, Math.max(1, Math.ceil(rank/4)));
  const rungs = [];
  for (let l = 1; l <= ceiling; l++)
    rungs.push({ rank: l, name: 'L' + l, fn: idx => eng.ladderPlanFor(l - 1, idx) });
  const specs = (arg('ensemble', '') || '').split(',').map(s => s.trim()).filter(Boolean);
  const modelPath = arg('model', path.join(__dirname, 'models', 'best.json'));
  if (fs.existsSync(modelPath) && !specs.some(s => s.split('@')[0] === modelPath))
    specs.push(`${modelPath}@${ceiling}`);   // champion tried last unless explicitly ranked
  for (const spec of specs) {
    const at = spec.lastIndexOf('@');
    const p = at > 0 ? spec.slice(0, at) : spec;
    const rank = at > 0 ? +spec.slice(at + 1) : ceiling;
    if (!fs.existsSync(p)) { console.error(`skipping --ensemble entry, not found: ${p}`); continue; }
    if (!Number.isFinite(rank)) { console.error(`skipping --ensemble entry, bad rank: ${spec}`); continue; }
    const net = MLP.fromJSON(JSON.parse(fs.readFileSync(p, 'utf8')));
    const d = nnDepthFor(rank);
    rungs.push({ rank, name: `${path.basename(p, '.json')}(D${d})`,
                 fn: idx => nnPlanFor(eng, net, idx, { depth: d }) });
  }
  rungs.sort((a, b) => a.rank - b.rank);
  // Index of the first rung strictly above a given rank -- where a climb resumes from.
  const firstAbove = rank => { const i = rungs.findIndex(r => r.rank > rank); return i < 0 ? rungs.length : i; };

  const ws = fs.createWriteStream(out, { flags: 'a' });
  let famCount = 0, gameCount = 0, positions = 0, deadFound = 0;
  const discount = 0.995;
  // Same row schema selfplay.js writes (f, z, p, m, g) so train.js and policy-targets.js consume
  // this file with no changes, plus src:'retro' for later ablation and fam to trace every replay
  // back to the seed game it descends from.
  function writeGame(rows, winner, fam) {
    const gameId = `retro-${fam}-${gameCount++}`;
    for (let i = 0; i < rows.length; i++) {
      const z = (rows[i].mover === winner ? 1 : -1)*Math.pow(discount, rows.length - i);
      ws.write(JSON.stringify({ f: rows[i].f.map(v => +v.toFixed(5)), z: +z.toFixed(4),
                                p: rows[i].p.map(v => +v.toFixed(4)), m: rows[i].mover,
                                g: gameId, src: 'retro', fam }) + '\n');
      positions++;
    }
  }

  console.log(`retromine: ${seeds} seeds, L${seedLevel} start, ceiling L${ceiling}\n` +
              `  strength ladder: ${rungs.map(r => `${r.name}@${r.rank}`).join(' -> ')}\n` +
              `  -> ${out}`);

  for (let s = 0; s < seeds; s++) {
    const seedBrain = idx => eng.ladderPlanFor(seedLevel - 1, idx);
    const seed = playGame(eng, seedBrain, seedBrain, maxPlies, openingPlies, null,
                          Math.random() < randomStartFrac);
    if (seed.winner === null) continue;   // capped/wedged seed -- nothing to climb

    const fam = famCount++;
    // Per-side rank on the interleaved ladder. Climbs monotonically: a side that needed L6 to
    // escape one position doesn't go back to L2 at the next one.
    const rank = [seedLevel, seedLevel];
    let rewind = 1, climber = 1 - seed.winner, replays = 0;
    const deadAt = [];

    while (replays < maxReplaysPerSeed && rewind <= seed.rows.length) {
      const point = seed.rows[seed.rows.length - rewind];
      const seedPose = { p: point.p, m: point.mover };
      const defender = 1 - climber;
      // the defender holds its own current rung throughout this climb -- the question being asked
      // is "how strong must the climber be to beat THIS defender from here", so moving both at
      // once would make the answer uninterpretable.
      const defRung = rungs[Math.max(0, firstAbove(rank[defender]) - 1)];
      let escaped = null;

      for (let i = firstAbove(rank[climber]); i < rungs.length; i++) {
        if (replays >= maxReplaysPerSeed) break;
        const cand = rungs[i];
        const brainA = climber === 0 ? cand.fn : defRung.fn;
        const brainB = climber === 0 ? defRung.fn : cand.fn;
        const result = playGame(eng, brainA, brainB, maxPlies, seedPose ? 0 : openingPlies, seedPose, false);
        replays++;
        if (result.winner === null) continue;   // capped/wedged -- tells us nothing either way
        writeGame(result.rows, result.winner, fam);
        rank[climber] = cand.rank;              // this side has now been tried at this strength
        if (result.winner === climber) { escaped = cand; break; }
      }

      if (escaped) {
        // not dead after all -- hand the problem to the other side at this SAME position
        climber = defender;
      } else {
        // nothing on the ladder escaped: this position is dead as far as we can measure
        deadAt.push({ rewind, rank: rank[climber], side: climber });
        deadFound++;
        rewind++;
        rank[climber] = seedLevel;   // fresh position, fresh climb for this side
      }
    }
    if (deadAt.length) {
      const d = deadAt[deadAt.length - 1];
      console.log(`seed ${fam}: dead at ${d.rewind} plies from the end for ` +
                  `${d.side === 0 ? 'blue' : 'red'} (nothing up to L${ceiling} escaped), ` +
                  `${replays} replays, ${gameCount} games logged so far`);
    }
  }
  ws.end(() => console.log(`retromine done: ${famCount} seed families, ${deadFound} dead positions, ` +
                           `${gameCount} games, ${positions} positions -> ${out}`));
}

main();
