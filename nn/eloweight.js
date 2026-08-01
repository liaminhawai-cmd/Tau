// Turn the standing rating pool (nn/elo-summary.json) into per-row TRAINING weights, keyed by the
// `mv` field selfplay.js / arena.js now stamp on every row: the pool id of the brain that made the
// move (`L7`, `ckpt-091@D2`).
//
// Why weight at TRAIN time instead of stamping a rating into the row at generation time: ratings
// are estimates that keep improving as the pool accumulates games. A row carrying an id picks up
// every future improvement to its mover's rating for free; a row carrying a number is frozen at
// whatever the pool believed the day the game was played. Same reason the row stores the raw pose
// and not just the features.
//
// The weight is a logistic in Elo, centred at the pool's median and floored:
//
//   w(elo) = floor + (1 - floor) / (1 + 10^((median - elo)/scale))
//
//   - strong movers approach 1, weak movers approach `floor` -- never 0, because weak movers'
//     moves still describe the reachable position distribution (train-policy.js's own header:
//     "the arm distribution needs to see them"), and because most of the corpus is ladder games
//     whose information would otherwise be discarded wholesale rather than discounted.
//   - a mover with NO rating gets exactly the median weight: unknown is "ordinary", not weak.
//     This also covers every row written before `mv` existed, so old data keeps its say.
//
// best.json is a moving target the pool deliberately never rates (the trainer snapshots it to
// ckpt-NNN before placement), so rows stamped best@Dk resolve to the NEWEST rated ckpt at that
// depth. Approximate -- best drifts between checkpoints -- but the approximation lives here at
// lookup time, not frozen into the data.
'use strict';
const fs = require('fs');

function makeEloWeighter(summaryPath, opts) {
  const scale = (opts && opts.scale) || 250;
  const floor = (opts && opts.floor) != null ? opts.floor : 0.25;
  const neutral = floor + (1 - floor)/2;
  let players = null;
  try { players = JSON.parse(fs.readFileSync(summaryPath, 'utf8')).players || null; } catch (e) {}
  if (!players || !Object.keys(players).length)
    return { enabled: false, note: `no ratings at ${summaryPath} -- all rows weighted 1`, weight: () => 1 };

  const elo = {};
  for (const [id, v] of Object.entries(players))
    if ((v.games || 0) >= 4) elo[id] = v.elo || 0;   // same MIN_GAMES bar elorank's report uses
  const rated = Object.values(elo).sort((a, b) => a - b);
  if (!rated.length)
    return { enabled: false, note: `no brain in ${summaryPath} has 4+ games yet -- all rows weighted 1`, weight: () => 1 };
  const mid = rated[Math.floor(rated.length/2)];

  const newestCkpt = {};   // per depth: which ckpt-NNN stands in for the live best.json
  for (const id of Object.keys(elo)) {
    const m = /^ckpt-(\d+)@D(\d+)$/.exec(id);
    if (m && (!newestCkpt[m[2]] || +m[1] > newestCkpt[m[2]].n)) newestCkpt[m[2]] = { n: +m[1], id };
  }
  const resolve = id => {
    if (elo[id] != null) return id;
    const m = /^best@D(\d+)$/.exec(id);
    return m && newestCkpt[m[1]] ? newestCkpt[m[1]].id : null;
  };

  return {
    enabled: true,
    note: `${rated.length} rated brains, median ${Math.round(mid)} Elo, ` +
          `weights ${floor.toFixed(2)}..1.00 (scale ${scale})`,
    weight: id => {
      const r = id ? resolve(id) : null;
      return r ? floor + (1 - floor)/(1 + Math.pow(10, (mid - elo[r])/scale)) : neutral;
    },
  };
}

module.exports = { makeEloWeighter };
