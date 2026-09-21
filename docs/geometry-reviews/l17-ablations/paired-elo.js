'use strict';
// A paired-opening interval, with the OPENING PAIR as the resampling unit.
//
// Run: node paired-elo.js <results.jsonl> [more.jsonl ...] [--boots 4000] [--komi 0.5]
//
// The arena's own printed "+/- Elo" comes from nn/elo.js's eloFromScore on the raw GAME count, and
// it has no idea the games are paired. With --openings in play, games 2i and 2i+1 are the SAME
// opening with the seats swapped, so they are one observation, not two: resampling games would
// count each opening twice and report an interval roughly sqrt(2) too tight. This resamples pairs.
//
// A pair's score for A is the mean of its two games on the 0..1 scale, so a 1-1 split -- A wins as
// blue, B wins as blue -- scores 0.5 and says "this opening did not separate them", which is the
// honest reading. Draws score 0.5 each. Adjudicated games are INCLUDED and counted separately, and
// the komi weight is applied to them because a game the cap decided is a real but partial result
// (nn/arena.js's own kw). Nothing is silently dropped.
const fs = require('fs'), path = require('path');
const { eloFromScore } = require(path.join(__dirname, '../../../nn/elo.js'));

function main() {
  const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const boots = +argOf('--boots', 4000), komi = +argOf('--komi', 0.5);
  const files = process.argv.slice(2).filter(a => !a.startsWith('--') && !/^[\d.]+$/.test(a));
  if (!files.length) { console.error('usage: node paired-elo.js <results.jsonl> [...]'); process.exit(2); }

  const games = [];
  for (const f of files) for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (typeof j.game !== 'number' || !j.outcome) continue;
    games.push({ ...j, file: f });
  }
  games.sort((a, b) => a.file === b.file ? a.game - b.game : (a.file < b.file ? -1 : 1));

  // score for A, 0..1, with the cap-decided games weighted the way the arena weights them
  const kw = 0.5 + komi / 2;
  const scoreOf = g => {
    if (g.outcome === 'draw') return 0.5;
    const won = g.outcome === 'A';
    if (g.adjudicated) return won ? kw : 1 - kw;
    return won ? 1 : 0;
  };

  // pair by (file, floor(game/2)) -- exactly how nn/arena.js assigns openings when --openings is on
  const pairs = new Map();
  for (const g of games) {
    const k = `${g.file}#${Math.floor(g.game / 2)}`;
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(g);
  }
  const units = [...pairs.entries()].map(([k, gs]) => ({
    key: k, n: gs.length, score: gs.reduce((a, g) => a + scoreOf(g), 0) / gs.length,
    seatsBothWays: new Set(gs.map(g => g.aIsBlue)).size === 2,
  }));
  const unpaired = units.filter(u => u.n !== 2).length;
  const seatIncomplete = units.filter(u => u.n === 2 && !u.seatsBothWays).length;

  // Haldane-Anscombe at the UNIT level, matching nn/elo.js's (w+0.5)/(n+1): a clean sweep of the
  // openings is real evidence but not infinite evidence, and an unsmoothed sweep prints a number
  // that is an artifact of the clamp rather than a rating.
  const smooth = (sum, n) => (sum + 0.5) / (n + 1);
  const toElo = p => {
    const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
    return 400 * Math.log10(q / (1 - q));
  };
  const sumOf = us => us.reduce((a, u) => a + u.score, 0);
  const point = smooth(sumOf(units), units.length);

  // bootstrap over PAIRS
  const draws = [];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let b = 0; b < boots; b++) {
    let s = 0;
    for (let i = 0; i < units.length; i++) s += units[Math.floor(rnd() * units.length)].score;
    draws.push(smooth(s, units.length));
  }
  draws.sort((a, b) => a - b);
  const lo = draws[Math.floor(0.025 * draws.length)], hi = draws[Math.min(draws.length - 1, Math.floor(0.975 * draws.length))];

  // what the arena would have printed, for contrast: per-GAME, ignoring the pairing
  const aw = games.filter(g => g.outcome === 'A' && !g.adjudicated).length;
  const bw = games.filter(g => g.outcome === 'B' && !g.adjudicated).length;
  const naive = eloFromScore(aw, bw);

  const out = {
    files, games: games.length, openingPairs: units.length,
    unpairedUnits: unpaired, pairsMissingASeatSwap: seatIncomplete,
    draws: games.filter(g => g.outcome === 'draw').length,
    adjudicated: games.filter(g => g.adjudicated).length,
    matchDefinition: 'one unit = one opening played twice with the seats swapped; a unit scores the mean of its two games on 0..1; cap-decided games weighted ' + kw + ' / ' + (1 - kw),
    rawScoreForA: +(sumOf(units) / units.length).toFixed(4),
    smoothedScoreForA: +point.toFixed(4),
    elo: +toElo(point).toFixed(1),
    ci95: [+toElo(lo).toFixed(1), +toElo(hi).toFixed(1)],
    bootstrapUnit: 'opening pair', boots,
    arenaWouldPrint: { fromDecidedGamesOnly: `${aw}-${bw}`, elo: naive.elo == null ? null : +naive.elo.toFixed(1),
                       plusMinus2Sigma: naive.sigma == null ? null : +(2 * naive.sigma).toFixed(1),
                       note: 'per-game, pairing ignored -- shown only for contrast' },
  };
  if (unpaired) out.WARNING = `${unpaired} unit(s) do not have exactly 2 games -- was --openings used, and did the run finish?`;
  console.log(JSON.stringify(out, null, 2));
}
main();
