'use strict';
// Methodological check: ablation-matrix.js always asks "what would the tested/endangered `mover`
// play", using docs/dead-regions/screened-not-dead.jsonl. In that corpus `mover` is the escaping or
// unresolved side by construction (see its header), never the side with a winning continuation --
// so ladderScore3's own forced-win threshold (score >= HARD_WIN_BONUS/2) can essentially never be
// met by that mover's candidates, and L17's dense check (which fires ONLY on a claimed forced win)
// is untestable on that corpus. This script asks the OTHER question: at a position where the mover
// is CERTIFIED DEAD (dead-points-mined.jsonl), what does the WINNING side (1-mover) play, and does
// its own local ladderScore3 see enough of a win to trigger dense at all?
//
// Run: node dense-exercise-check.js [--n 60]
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const eng = require(path.join(ROOT, 'nn/engine.js')).createEngine();

function main() {
  const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const N = +argOf('--n', 60);
  const pool = [];
  for (const line of fs.readFileSync(path.join(ROOT, 'docs/dead-regions/dead-points-mined.jsonl'), 'utf8').split('\n')) {
    if (line[0] !== '{') continue;
    const j = JSON.parse(line);
    if (Array.isArray(j.p) && j.p.length === 6 && (j.mover === 0 || j.mover === 1)) pool.push(j);
  }
  const pick = [];
  for (let i = 0; i < Math.min(N, pool.length); i++) pick.push(pool[Math.floor(i * pool.length / Math.min(N, pool.length))]);

  const L17 = eng.AI_LADDER[16];
  let denseCount = 0, confirmedCount = 0, refutedCount = 0, claimedWinCount = 0;
  for (const k of Object.keys(eng.DEAD_STATS)) if (typeof eng.DEAD_STATS[k] === 'number') eng.DEAD_STATS[k] = 0;

  const rows = [];
  for (const row of pick) {
    const winner = 1 - row.mover;   // the certified-dead mover's opponent: the winning side
    eng.newGame(); const g = eng.getG();
    g.pieces.forEach((q, i) => { q.x = row.p[3 * i]; q.y = row.p[3 * i + 1]; q.rot = row.p[3 * i + 2]; });
    g.active = winner;
    g.cornerOpening = [false, false];
    const before = { ...eng.DEAD_STATS };
    eng.ladderPlanFor(16, winner, null);
    const denseDelta = eng.DEAD_STATS.dense - before.dense;
    if (denseDelta > 0) { denseCount++; claimedWinCount++; }
    confirmedCount = eng.DEAD_STATS.confirmed;
    refutedCount = eng.DEAD_STATS.refuted;
    rows.push({ g: row.g, k: row.k, mover: row.mover, winnerToMove: winner, denseFiredHere: denseDelta > 0 });
  }
  console.log(JSON.stringify({
    corpus: 'dead-points-mined.jsonl', perspective: 'winner (1-mover)', positions: pick.length,
    positionsWhereDenseFired: denseCount,
    totalDenseStat: eng.DEAD_STATS.dense, confirmed: eng.DEAD_STATS.confirmed, refuted: eng.DEAD_STATS.refuted,
    interpretation: denseCount > 0
      ? 'dense DOES fire when the mover asked-for is the winning side -- confirms the corpus-shape explanation'
      : 'dense still does not fire even from the winning side -- a different explanation is needed',
  }, null, 2));
}
main();
