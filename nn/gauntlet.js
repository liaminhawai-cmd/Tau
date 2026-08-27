'use strict';
// Fixed reference matches for experimental models, OUTSIDE the live league. An experiment arm
// must never enter the shared Elo pool (it would eat the league's measurement budget and the
// roster would adopt it as a face), so this plays a dedicated, identical match set for each
// candidate instead: colour-balanced temp-0 arena games against fixed opponents -- by default
// best.json, L10 and L11, the exact yardsticks the project cares about.
//
//   node nn/gauntlet.js --models nn/experiments/x/arm-1.json,nn/experiments/x/arm-0.json
//                       [--opponents best,L10,L11] [--games 24] [--depths 1,2] [--workers 3]
//                       [--shards 1] [--bar 100] [--out nn/experiments/x/gauntlet.json]
//
// Candidates play at each depth in --depths; an nn opponent plays at the same depth (like for
// like), a ladder opponent plays its native game. Results are the arena's own summary numbers --
// per-opponent scores every arm shares, which is what an ablation needs -- plus, since one match
// set against a fixed opponent is exactly the shape elo.js was written for, that score's Elo
// interval and the call it supports.
//
// --shards splits ONE pairing's games across that many arena processes and sums them at the end.
// A pairing is otherwise a single-threaded process, so without it a 3-opponent run can only ever
// use 3 cores no matter how many the machine has, and the run takes as long as its slowest single
// matchup. Openings are drawn per game (opening.js, off Math.random), not indexed, so shards are
// independent samples of the same match and summing them is the same experiment run wider.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { eloFromScore, fmtElo } = require('./elo.js');
const { createEngine } = require('./engine.js');
const dir = __dirname;
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };

const models = String(arg('models', arg('model', ''))).split(',').map(s => s.trim()).filter(Boolean);
const oppSpecs = String(arg('opponents', 'best,L10,L11')).split(',').map(s => s.trim()).filter(Boolean);
const games = Math.max(2, +arg('games', 24) & ~1);   // even: arena alternates colours per game
const depths = String(arg('depths', '1,2')).split(',').map(Number).filter(d => d >= 1 && d <= 4);
const workers = Math.max(1, +arg('workers', 3));
const shards = Math.max(1, +arg('shards', 1));
// The ship/don't-ship bar, in Elo, because that is the unit the rest of the project decides in and
// because the question a new ladder rung asks is not "did it win" but "is it a whole rung better".
// elo.js's own header puts one rung at ~100 Elo (the shipped rungs sit ~60-180 apart), so that is
// the default: a candidate only +30 on the rung below it is a sideways step, and a ladder that
// stops getting harder is worse than one that stops earlier.
const bar = Number.isFinite(+arg('bar', 100)) ? +arg('bar', 100) : 100;
const openingPlies = Math.max(0, +arg('openingPlies', 4));
const outPath = arg('out', null);

function opponent(spec) {
  if (/^L\d+$/i.test(spec)) return { id: spec.toUpperCase(), spec: spec.toUpperCase(), ladder: true };
  const p = spec === 'best' ? path.join(dir, 'models', 'best.json') : path.resolve(spec);
  return { id: path.basename(p, '.json'), spec: `nn:0:${p}`, ladder: false, path: p };
}

// Split one pairing's games into `shards` chunks, each EVEN. Even is not tidiness: arena alternates
// colours on the game index, so an odd shard hands one side an extra first move and biases exactly
// the number the run exists to measure. Splitting the colour-PAIR count and doubling makes that
// impossible to get wrong, and a shard that would round to zero is dropped rather than played empty.
function splitGames(total, n) {
  const pairs = total/2, q = Math.floor(pairs/n), r = pairs % n, out = [];
  for (let i = 0; i < n; i++) { const p = q + (i < r ? 1 : 0); if (p > 0) out.push(p*2); }
  return out;
}

function jobList() {
  const jobs = [];
  for (const m of models) {
    const mp = path.resolve(m);
    if (!fs.existsSync(mp)) { console.error(`[gauntlet] missing model: ${mp}`); continue; }
    const name = path.basename(mp, '.json');
    for (const d of depths) for (const os of oppSpecs) {
      const o = opponent(os);
      if (!o.ladder && !fs.existsSync(o.path)) { console.error(`[gauntlet] missing opponent: ${o.path}`); continue; }
      for (const g of splitGames(games, shards)) jobs.push({ name, model: mp, depth: d, opp: o, games: g });
    }
  }
  return jobs;
}

function play(job) {
  const args = [path.join(dir, 'arena.js'),
    '--a', `nn:0:${job.model}`, '--depthA', String(job.depth),
    '--b', job.opp.spec, ...(job.opp.ladder ? [] : ['--depthB', String(job.depth)]),
    '--games', String(job.games), '--openingPlies', String(openingPlies),
    '--idA', `${job.name}@D${job.depth}`, '--idB', job.opp.ladder ? job.opp.id : `${job.opp.id}@D${job.depth}`];
  return new Promise(resolve => execFile(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 24 },
    (err, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr);
      // Same summary-line parse elorank-legacy.js relies on. `% of decided` already folds komi
      // wins at their discounted value, so it is the honest single score for a fixed match set.
      const m = [...String(stdout || '').matchAll(/:\s*(\d+)-(\d+)(?:-(\d+))?\s+\((?:komi (\d+)-(\d+), )?(\d+)% of decided/g)];
      if (err || !m.length) { console.error(`[gauntlet] no result: ${job.name}@D${job.depth} vs ${job.opp.id}`); return resolve(null); }
      const q = m.at(-1);
      resolve({ name: job.name, depth: job.depth, opp: job.opp.id, games: job.games,
                w: +q[1], l: +q[2], d: +(q[3] || 0), komiW: +(q[4] || 0), komiL: +(q[5] || 0),
                decidedPct: +q[6] });
    }));
}

// Sum a pairing's shards back into the one match they jointly sampled. The score is rebuilt from
// the merged COUNTS rather than by averaging the shards' `decided%`, because arena prints that to
// the nearest whole percent -- three shards of rounding is most of a game on a 200-game match,
// which is enough to move a borderline lower bound across the bar. komiLoss is read from the engine
// for the same reason: a komi win is worth 0.3 of a win, and guessing it would bias the score.
let kwCache = null;
const komiWinValue = () => (kwCache == null ? (kwCache = 0.5 + createEngine().CFG.komiLoss/2) : kwCache);

function mergeShards(rows) {
  const by = new Map(), kw = komiWinValue();
  for (const r of rows) {
    const k = `${r.name}|${r.depth}|${r.opp}`;
    const m = by.get(k) || { name: r.name, depth: r.depth, opp: r.opp, shards: 0,
                             games: 0, w: 0, l: 0, d: 0, komiW: 0, komiL: 0 };
    m.shards++; m.games += r.games; m.w += r.w; m.l += r.l; m.d += r.d; m.komiW += r.komiW; m.komiL += r.komiL;
    by.set(k, m);
  }
  for (const m of by.values()) {
    m.scoreA = m.w + kw*m.komiW + (1 - kw)*m.komiL;
    m.scoreB = m.l + kw*m.komiL + (1 - kw)*m.komiW;
    m.decided = m.scoreA + m.scoreB;
    // Kept rounded and named as before: experiment-medalist.js tabulates this field.
    m.decidedPct = m.decided ? Math.round(100*m.scoreA/m.decided) : 0;
    m.rating = eloFromScore(m.scoreA, m.scoreB);
  }
  return [...by.values()];
}

// The call is made on the INTERVAL, never the point estimate. That distinction is the whole reason
// this file exists: the live league's medals rank on a bootstrap bound a 6-game face can win by
// luck, and a headline "+400 Elo" whose interval runs from -2 to +560 has repeatedly failed to
// survive real play. A shipped ladder rung has to be provably a rung, so the lower bound carries it.
function call(r) {
  const e = r.rating;
  if (e.elo == null) return { tag: 'NO DATA', text: 'no decided games' };
  if (e.lo > bar)   return { tag: 'CLEAR',    text: `provably +${bar} Elo or better -- ships as a new rung` };
  if (e.lo > 0)     return { tag: 'MARGINAL', text: `provably stronger, but not provably a full +${bar} rung`,
                             needGames: needFor(r, bar) };
  if (e.hi < 0)     return { tag: 'WEAKER',   text: 'provably weaker -- not a rung above this opponent' };
  return { tag: 'UNDECIDED', text: 'interval straddles even; this run cannot tell them apart',
           needGames: needFor(r, bar) };
}

// How many PLAYED games it would take for the lower bound to clear the bar, if the observed score
// held exactly. sigma goes as 1/sqrt(n), so n scales by (sigma_now/sigma_wanted)^2; the decided
// count is then grossed back up by this run's own draw rate, since --games counts played games.
// Returns null when the point estimate is already below the bar -- no sample size fixes that, and
// saying so is more useful than quoting an unreachable number.
function needFor(r, target) {
  const e = r.rating;
  if (e.elo == null || !(e.elo > target)) return null;
  const wanted = (e.elo - target)/2;
  const decidedNeeded = e.n*Math.pow(e.sigma/wanted, 2);
  return Math.ceil(decidedNeeded*(r.games/Math.max(1, e.n))/2)*2;
}

async function main() {
  const jobs = jobList();
  if (!jobs.length) { console.error('[gauntlet] nothing to play; pass --models'); process.exitCode = 1; return; }
  // Count the shards splitGames actually produced, not the requested `shards`: asking for more
  // shards than the game count has colour-pairs yields fewer, and dividing by the request would
  // misreport how many pairings are in flight.
  const perPairing = splitGames(games, shards).length;
  console.log(`[gauntlet] ${jobs.length/perPairing} pairing(s) x ${games} games` +
              (perPairing > 1 ? ` split into ${perPairing} shards each` : '') + `, ${workers} parallel`);
  const results = [];
  let next = 0, done = 0;
  const t0 = Date.now();
  // An ETA from the first shard onward, because the honest game counts this run needs are long
  // enough that "is this 20 minutes or 20 hours" decides whether the settings were sensible -- and
  // the answer should not be a black box until it finishes. Shards are equal-sized by construction,
  // so mean-time-per-finished-shard against the remaining queue is a fair estimate; it is scaled by
  // the lane count because the remaining shards run `workers` at a time, not one after another.
  const eta = () => {
    if (!done) return '';
    const per = (Date.now() - t0)/done, left = Math.ceil((jobs.length - done)/Math.min(workers, jobs.length));
    const mins = per*left/60000;
    return mins < 1 ? '' : `, ~${mins < 90 ? `${Math.round(mins)} min` : `${(mins/60).toFixed(1)} h`} left`;
  };
  const lane = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      console.log(`[gauntlet] ${job.name}@D${job.depth} vs ${job.opp.id} (${job.games} games)...`);
      const r = await play(job);
      done++;
      if (r) { results.push(r); console.log(`[gauntlet]   -> ${r.w}-${r.l}${r.d ? '-' + r.d : ''}` +
        (r.komiW + r.komiL ? ` (komi ${r.komiW}-${r.komiL})` : '') + `, ${r.decidedPct}% of decided` +
        ` [${done}/${jobs.length} shards${eta()}]`); }
    }
  };
  await Promise.all(Array.from({ length: workers }, lane));

  const merged = mergeShards(results);
  console.log('\n=== gauntlet ===');
  console.log('candidate            depth  opponent        W-L-D (komi)   decided%  Elo (2 sigma)         call');
  for (const r of merged.sort((a, b) => a.name.localeCompare(b.name) || a.depth - b.depth || a.opp.localeCompare(b.opp)))
    console.log(`${r.name.padEnd(20)} D${r.depth}     ${r.opp.padEnd(15)} ` +
                `${`${r.w}-${r.l}-${r.d}`.padEnd(9)}${(r.komiW + r.komiL ? `(${r.komiW}-${r.komiL})` : '').padEnd(6)} ` +
                `${String(r.decidedPct).padStart(4)}%     ${fmtElo(r.rating).padEnd(21)} ${call(r).tag}`);
  console.log('');
  for (const r of merged) {
    const c = call(r);
    console.log(`  vs ${r.opp} @D${r.depth}: ${c.tag} -- ${c.text}`);
    if (c.needGames) console.log(`      at this score it would take about ${c.needGames} games (played ${r.games}) to settle it`);
  }
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), games, depths, shards, bar,
                                               results: merged.map(r => ({ ...r, call: call(r).tag })) }, null, 1));
    console.log(`[gauntlet] saved ${outPath}`);
  }
}
main().catch(e => { console.error('[gauntlet] failed:', e.stack || e.message); process.exitCode = 1; });
