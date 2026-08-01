// Rank every brain we have -- ladder rungs AND neural nets at several search depths -- on ONE
// scale, so retromine.js's interleaved strength ladder can be built from measurement instead of
// guesswork. Output is a fractional rank per net ("wide.json at depth 2 plays like L4.6"), plus a
// ready-to-paste --ensemble string.
//
//   node nn/elorank.js [--games 4] [--depths 1,2,3] [--levels 1,2,3,4,5,6,7,8,9,10,11]
//                      [--models a.json,b.json] [--spread 6] [--workers N]
//                      [--out nn/elo-results.json] [--saveData nn/data/elo.jsonl] [--refit]
//
// WHY ELO AND NOT A FULL ROUND ROBIN. A full matrix over ~20 brains is 190 pairs; at the depth-3
// game costs measured in this project (5-8 minutes each) that is days, and most of those cells are
// foregone anyway (L1 vs best-at-D3 tells you nothing you didn't know). Bradley-Terry only needs
// the comparison GRAPH to be connected -- ratings propagate transitively, so a well-chosen sparse
// subset yields the same global ordering for a fraction of the games. The pairing below is built
// for exactly that connectivity (see buildPairs).
//
// PRECISION IS DELIBERATELY LOW. These brains are spiky and non-transitive -- today's data has the
// same net beating L8 and losing to L7 in the same sweep -- so chasing tight confidence intervals
// on any single pairing is wasted compute. A single-number summary that is roughly right across
// the whole field is what the interleaved ladder actually needs; being half a rung off costs
// almost nothing there, while being unranked costs the whole design.
//
// LADDER RUNGS ARE THE ANCHOR. Fitting nets alone would give a self-consistent scale with no
// meaning ("net A is 120 Elo above net B" -- above WHAT?). Including L1..L11 as ordinary players,
// with adjacent-rung pairs to pin the chain, makes the fitted ladder Elos a measured yardstick and
// every net's rank a simple interpolation against it. That also handles the ladder's own uneven
// spacing correctly: rungs are NOT assumed equally spaced, they are measured.
//
// Raw per-pair results are checkpointed to --out after every pair, so a run that is interrupted
// (or a machine that gets closed) resumes where it stopped instead of replaying. --refit skips
// playing entirely and just re-runs the fit over whatever is already stored.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const dir = __dirname;
const modelsDir = path.join(dir, 'models');
const gamesPerPair = Math.max(1, +arg('games', 4));
// The ladder is the YARDSTICK -- every net's rank is an interpolation against it -- so it has to
// be pinned harder than the things being measured, not the same or less. It was the same, and a
// mid-run fit showed exactly what that costs: the rungs every net plays (the spread below) had
// 30-56 games each while the rungs in between had 2-4 from their adjacent pair alone, and the
// fitted ladder came out NON-MONOTONIC -- L9 and L10 below L8, L7 below L10. Interpolating a
// fractional rank against an out-of-order yardstick produces confident nonsense.
const ladderGames = Math.max(1, +arg('ladderGames', gamesPerPair*3));
const depths = (arg('depths', '1,2,3') || '').split(',').map(Number).filter(d => d >= 1);
const levels = (arg('levels', '') || '').split(',').map(Number).filter(n => n >= 1);
// Each arena.js is single-threaded, so this IS the core count in use -- a fixed default would
// leave most of a big machine idle. Auto-detect the same way run.js does (leave one core for
// everything else; Node counts hyperthreads as cores so this is not literally one-per-physical).
const os = require('os');
const workers = Math.max(1, +arg('workers', Math.max(1, Math.min(os.cpus().length - 1, 14))));
const outPath = arg('out', path.join(dir, 'elo-results.json'));
const saveData = arg('saveData', null);
const refitOnly = process.argv.includes('--refit');
const spread = Math.max(0, +arg('spread', 6));
// 4, matching selfplay.js rather than arena.js's evaluation default of 2. arena.js keeps 2 because
// it is an evaluation tool, but these games are ALSO training data (--saveData), and selfplay.js
// raised its own default to 4 for precisely that reason: at 2 plies the mostly-deterministic
// brains still funnel into repeated trajectories, and duplicated lines quietly multiply the
// effective epochs on them. Costs nothing for ranking -- both sides face the same scramble.
const openingPlies = +arg('openingPlies', 4);
// Fully random legal poses (opening.js's randomStartPose), OFF by default here on purpose. It
// would deepen the data further, but it changes what the ranking MEASURES: the ladder rungs were
// built and tuned for play from real positions, so rating them largely on arbitrary poses would
// be scoring them at a job they were never designed for, and the resulting ranks would be a worse
// yardstick for retromine.js than the ones we have now. Worth turning on (0.15-0.25) only if the
// data matters more than the ranking on a given run.
const randomStartFrac = +arg('randomStartFrac', 0);
// Target wall-clock hours. The field is trimmed to fit rather than the accuracy dialled down --
// see the note at the trimming site. 0 disables (play the whole field).
const budgetHours = +arg('budgetHours', 0);
// Print the field, pair count and time estimate, then exit without playing anything -- for
// choosing --games/--spread/--budgetHours before committing hours to a run.
const dryRun = process.argv.includes('--dryrun');
// Seconds of wall time per unit of pairWeight, from this project's measured game times. Only ever
// used for the up-front estimate and budget trimming; the live ETA measures real pace instead, so
// being wrong here costs a rough first guess and nothing more.
const SEC_PER_WEIGHT = 55;
let totalWeight = 0;

// --- who is in the field ----------------------------------------------------------------------
function discoverModels() {
  const explicit = (arg('models', '') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (explicit.length) return explicit;
  let files = [];
  try { files = fs.readdirSync(modelsDir); } catch (e) { return []; }
  const pick = [];
  // The named, hand-built architectures are the whole point of the exercise -- always in if present.
  for (const n of ['best.json', 'wide.json', 'ultra.json', 'deep.json', 'l15_value.json', 'scratch.json'])
    if (files.includes(n)) pick.push(path.join(modelsDir, n));
  // Plus an evenly-spaced sample of checkpoints, oldest to newest, to trace the lineage's own
  // progression rather than only its endpoint. Evenly spaced (not the most recent N) because the
  // interesting comparison is across the whole run, and adjacent checkpoints are near-identical.
  const ck = files.filter(f => /^ckpt-\d+\.json$/.test(f))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  if (spread > 0 && ck.length) {
    const step = Math.max(1, Math.floor(ck.length/spread));
    for (let i = 0; i < ck.length && pick.length < 40; i += step) pick.push(path.join(modelsDir, ck[i]));
    const last = path.join(modelsDir, ck[ck.length - 1]);
    if (!pick.includes(last)) pick.push(last);
  }
  return pick;
}

// Snapshot every model before rating it. best.json, value.json and scratch.json are all REWRITTEN
// while the trainer runs -- resume-train overwrites best/value on its own clock, a round robin
// overwrites scratch and promotes over best -- so rating them by path would attribute games played
// against several different nets to a single player id, which is not a noisy measurement but a
// meaningless one. Copying first freezes the field for the whole run, which also makes it safe to
// train and rank at the same time.
// Taken ONCE and reused on resume (the directory's existence is the marker): re-snapshotting on a
// resumed run would swap the nets underneath results already stored against them.
function snapshotModels(paths) {
  const snapDir = path.join(modelsDir, '.elo-snapshot');
  const fresh = !fs.existsSync(snapDir);
  try {
    fs.mkdirSync(snapDir, { recursive: true });
    const out = [];
    for (const p of paths) {
      const dest = path.join(snapDir, path.basename(p));
      if (fresh || !fs.existsSync(dest)) fs.copyFileSync(p, dest);
      out.push(dest);
    }
    if (fresh) console.log(`snapshotted ${out.length} models to ${snapDir} (field frozen for this run)`);
    else console.log(`reusing existing snapshot in ${snapDir} (${out.length} models)`);
    return out;
  } catch (e) {
    console.error(`WARNING: could not snapshot models (${e.message}) -- rating live files, so do ` +
                  `NOT run the trainer at the same time`);
    return paths;
  }
}

const players = [];   // { id, kind:'ladder'|'nn', spec, depth, label }
let LADDER_N = 11;
try { LADDER_N = require('./engine.js').createEngine().AI_LADDER.length; } catch (e) {}
const useLevels = levels.length ? levels.filter(l => l <= LADDER_N) : Array.from({ length: LADDER_N }, (_, i) => i + 1);
for (const l of useLevels)
  players.push({ id: `L${l}`, kind: 'ladder', spec: `L${l}`, level: l, label: `L${l}` });
for (const m of snapshotModels(discoverModels()))
  for (const d of depths)
    players.push({ id: `${path.basename(m, '.json')}@D${d}`, kind: 'nn', spec: `nn:0:${m}`,
                   depth: d, model: m, label: `${path.basename(m, '.json')} D${d}` });

// --- which pairs to play ------------------------------------------------------------------------
// Connectivity, not coverage. Three groups, each earning its cost:
//   1. adjacent ladder rungs -- pins the ladder chain itself, so the yardstick has real spacing
//      rather than an assumed-uniform one;
//   2. every net against a SPREAD of rungs -- this is what ties nets to the ladder scale at all,
//      and a spread (rather than one rung) keeps a net whose true strength is far from the chosen
//      rung from being pinned by a foregone 12-0;
//   3. a sample of net-vs-net pairs -- cross-links the nets to each other so the fit isn't relying
//      solely on paths that route through the ladder.
function buildPairs() {
  const pairs = [];
  const add = (a, b) => { if (a && b && a.id !== b.id) pairs.push([a.id, b.id]); };
  const byId = Object.fromEntries(players.map(p => [p.id, p]));
  const ladder = players.filter(p => p.kind === 'ladder');
  const nets = players.filter(p => p.kind === 'nn');
  for (let i = 0; i + 1 < ladder.length; i++) add(ladder[i], ladder[i + 1]);
  // Skip-one pairs as well as adjacent ones. A pure chain is a single path: one badly-estimated
  // rung in the middle distorts every rank on the far side of it, because there is no other
  // route between the two halves. Cross-links make the yardstick's own spacing over-determined
  // instead of just-determined.
  for (let i = 0; i + 2 < ladder.length; i++) add(ladder[i], ladder[i + 2]);
  const rungSpread = ladder.length >= 4
    ? [ladder[0], ladder[Math.floor(ladder.length/3)], ladder[Math.floor(2*ladder.length/3)], ladder[ladder.length - 1]]
    : ladder;
  // Rung-major, NOT net-major: every net gets its first ladder pairing before any net gets its
  // second. Net-major would finish one net's whole spread before starting the next, so an early
  // --refit (which is the intended way to use this -- a full run is many hours) would rank the
  // first few nets well and leave the rest with no games at all. This way a partial fit covers
  // the whole field at once and simply sharpens as more pairs land.
  for (const r of rungSpread) for (const n of nets) add(n, r);
  // net-vs-net: each net linked to a couple of others, deterministically (index-offset rather than
  // random) so a resumed run rebuilds the identical pair list and its stored results still apply.
  for (let i = 0; i < nets.length; i++) {
    add(nets[i], nets[(i + 1) % nets.length]);
    if (nets.length > 3) add(nets[i], nets[(i + Math.floor(nets.length/2)) % nets.length]);
  }
  const seen = new Set(), uniq = [];
  for (const [a, b] of pairs) {
    const key = a < b ? a + '|' + b : b + '|' + a;
    if (seen.has(key)) continue;
    seen.add(key); uniq.push([byId[a], byId[b]]);
  }
  return uniq;
}

// --- playing ------------------------------------------------------------------------------------
const store = (() => {
  try { return JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) { return { results: {} }; }
})();
store.results = store.results || {};
const keyOf = (a, b) => `${a.id}|${b.id}`;

// Rough relative cost of a pair, used for the ETA and for --budgetHours trimming. Calibrated from
// this project's own measured game times rather than guessed: a depth-3 game against L11 ran
// ~645s where depth-1 against L6 ran ~21s, a spread of ~30x, so treating pairs as equal-cost (as
// a naive "N pairs remaining" progress bar would) is off by more than an order of magnitude and
// would make any estimate useless. Both sides move every ply, so the per-side costs add.
const SIDE_COST = p => {
  if (p.kind === 'ladder') return p.level <= 5 ? 1 : p.level <= 7 ? 2 : p.level <= 9 ? 4 : 5;
  return p.depth >= 3 ? 4 : p.depth === 2 ? 2.5 : 1;
};
const pairWeight = (a, b) => (SIDE_COST(a) + SIDE_COST(b))*
  ((a.kind === 'ladder' && b.kind === 'ladder') ? ladderGames : gamesPerPair);
let doneWeight = 0, startedAt = 0;
const fmtDur = s => s >= 3600 ? `${(s/3600).toFixed(1)}h` : `${Math.round(s/60)}m`;

function playPair(a, b) {
  return new Promise(resolve => {
    // ladder-vs-ladder pairs are the yardstick: more games each, and they are also among the
    // cheapest games on the board at the low rungs, so this costs far less than it sounds
    const bothLadder = a.kind === 'ladder' && b.kind === 'ladder';
    const n = bothLadder ? ladderGames : gamesPerPair;
    const args = [path.join(dir, 'arena.js'), '--a', a.spec, '--b', b.spec,
                  '--games', String(n), '--openingPlies', String(openingPlies)];
    if (randomStartFrac > 0) args.push('--randomStartFrac', String(randomStartFrac));
    if (a.kind === 'nn') args.push('--depthA', String(a.depth));
    if (b.kind === 'nn') args.push('--depthB', String(b.depth));
    if (saveData) args.push('--saveData', saveData);
    execFile('node', args, { encoding: 'utf8', maxBuffer: 1 << 24 }, (err, stdout) => {
      // Same parse arena.js's own callers use: the LAST "N-M (" on the line, since the per-game
      // running tally has the identical shape.
      const m = [...String(stdout || '').matchAll(/:\s*(\d+)-(\d+)(?:-(\d+))?\s+\(/g)];
      if (!m.length) { console.log(`  ! no result for ${a.label} vs ${b.label}`); return resolve(); }
      const last = m[m.length - 1];
      const w = +last[1], l = +last[2], d = +(last[3] || 0);
      record(a, b, w, l, d);
      fs.writeFileSync(outPath, JSON.stringify(store, null, 1));   // checkpoint every pair
      // No fixed pair list to measure progress against anymore, so report what actually matters:
      // how well covered the least-measured brain is, and how much of the time budget is left.
      const gs = gamesOf(), least = Math.min(...players.map(p => gs[p.id] || 0));
      const elapsedMin = (Date.now() - startedAt)/60000;
      const leftNote = budgetHours > 0
        ? `~${fmtDur(Math.max(0, budgetHours*3600 - elapsedMin*60))} left`
        : `${Math.round(elapsedMin)}m elapsed`;
      const conf = Number.isFinite(globalThis.__lastWorst)
        ? `, worst rank CI +-${globalThis.__lastWorst.toFixed(2)}` : '';
      console.log(`  ${a.label} vs ${b.label}: ${w}-${l}${d ? '-' + d : ''}` +
                  `   [min games ${least}${conf}, ${leftNote}]`);
      resolve();
    });
  });
}

// --- Bradley-Terry fit ---------------------------------------------------------------------------
// Minorization-maximization (Zermelo's algorithm): the standard MLE for pairwise-comparison
// strengths. Draws count half a win each way, which is the usual BT treatment and matches how
// arena.js reports "decided" anyway. A small prior (see below) keeps an undefeated or winless
// brain from running off to infinite rating, which WILL happen here -- L1 vs a strong net at
// depth 3 is a realistic 0-4.
function fitBT(ids, results) {
  const idx = Object.fromEntries(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const wins = Array(n).fill(0);
  const games = Array.from({ length: n }, () => Array(n).fill(0));
  for (const [key, r] of Object.entries(results)) {
    const [ai, bi] = key.split('|');
    if (!(ai in idx) || !(bi in idx)) continue;
    const i = idx[ai], j = idx[bi];
    const total = r.w + r.l + (r.d || 0);
    if (!total) continue;
    wins[i] += r.w + (r.d || 0)/2;
    wins[j] += r.l + (r.d || 0)/2;
    games[i][j] += total; games[j][i] += total;
  }
  // prior: half a win and half a loss against a phantom average opponent, for every player
  const PRIOR = 1.0;
  let p = Array(n).fill(1);
  for (let iter = 0; iter < 500; iter++) {
    const next = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let denom = PRIOR/(p[i] + 1);
      for (let j = 0; j < n; j++) if (games[i][j]) denom += games[i][j]/(p[i] + p[j]);
      next[i] = (wins[i] + PRIOR/2)/Math.max(denom, 1e-12);
    }
    const geo = Math.exp(next.reduce((a, v) => a + Math.log(Math.max(v, 1e-12)), 0)/n);
    for (let i = 0; i < n; i++) next[i] /= geo;      // normalise, BT is scale-invariant
    let delta = 0;
    for (let i = 0; i < n; i++) delta = Math.max(delta, Math.abs(next[i] - p[i]));
    p = next;
    if (delta < 1e-9) break;
  }
  const elo = {};
  ids.forEach((id, i) => { elo[id] = 400*Math.log10(Math.max(p[i], 1e-12)); });
  return elo;
}

// Where does this net's Elo fall among the fitted LADDER Elos? Linear interpolation between the
// two rungs it sits between; clamped (and flagged) outside the ladder's own range, since a net
// stronger than L11 has no rung to interpolate against and extrapolating a rank there would be
// inventing precision that doesn't exist.
function rankOf(eloVal, ladderElos) {
  const pts = ladderElos.slice().sort((a, b) => a.elo - b.elo);
  if (pts.length < 2) return { rank: NaN, edge: 'noscale' };
  if (eloVal <= pts[0].elo) return { rank: pts[0].level, edge: 'below' };
  if (eloVal >= pts[pts.length - 1].elo) return { rank: pts[pts.length - 1].level, edge: 'above' };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (eloVal >= a.elo && eloVal <= b.elo) {
      const t = (eloVal - a.elo)/Math.max(b.elo - a.elo, 1e-9);
      return { rank: a.level + t*(b.level - a.level), edge: null };
    }
  }
  return { rank: pts[pts.length - 1].level, edge: 'above' };
}

// Confidence intervals by nonparametric bootstrap: for each matchup, resample its n games with
// replacement from the outcomes actually observed, refit, and recompute every net's rank. The
// spread across resamples IS the uncertainty -- no analytic variance to derive or get wrong, and it
// propagates through the whole pipeline (fit, yardstick selection, interpolation) rather than just
// the fit, which matters because a wobbling ladder moves every rank that interpolates against it.
//
// Reported on the RANK scale, not Elo, because that is the scale the answer is consumed on: "L4.6
// give or take 0.3 rungs" is directly actionable for retromine's ensemble, where "±47 Elo" needs
// converting before it means anything.
//
// Resamples where the bootstrapped ladder comes out non-monotonic are skipped for rank purposes
// (the yardstick is unusable in those draws) and counted, since a high skip rate is itself the
// signal that the ladder is not yet pinned.
function bootstrapRanks(B) {
  const ids = players.map(p => p.id);
  const nets = players.filter(p => p.kind === 'nn');
  const samples = Object.fromEntries(nets.map(p => [p.id, []]));
  let skipped = 0;
  const entries = Object.entries(store.results);
  for (let b = 0; b < B; b++) {
    const res = {};
    for (const [key, r] of entries) {
      const n = r.w + r.l + (r.d || 0);
      if (!n) continue;
      let w = 0, l = 0, d = 0;
      for (let i = 0; i < n; i++) {
        const u = Math.random()*n;
        if (u < r.w) w++; else if (u < r.w + r.l) l++; else d++;
      }
      res[key] = { w, l, d };
    }
    const elo = fitBT(ids, res);
    const g = {};
    for (const [key, r] of entries) {
      const [x, y] = key.split('|'); const t = r.w + r.l + (r.d || 0);
      g[x] = (g[x] || 0) + t; g[y] = (g[y] || 0) + t;
    }
    const rungs = players.filter(p => p.kind === 'ladder')
      .map(p => ({ level: p.level, elo: elo[p.id], games: g[p.id] || 0 }))
      .sort((a, c) => a.level - c.level)
      .filter(r => r.games >= 6);
    const scale = [];
    for (const r of rungs) if (!scale.length || r.elo > scale[scale.length - 1].elo) scale.push(r);
    if (scale.length < 2) { skipped++; continue; }
    for (const p of nets) {
      const rk = rankOf(elo[p.id], scale);
      if (Number.isFinite(rk.rank) && !rk.edge) samples[p.id].push(rk.rank);
    }
  }
  const out = {};
  for (const p of nets) {
    const v = samples[p.id].sort((a, c) => a - c);
    out[p.id] = v.length >= 10
      ? { lo: v[Math.floor(0.05*v.length)], hi: v[Math.floor(0.95*v.length)], n: v.length }
      : { lo: NaN, hi: NaN, n: v.length };
  }
  return { ci: out, skipped, B };
}

// Half-width of the widest rank interval among nets that have one -- the single number the
// stopping rule watches. Infinity while any net still has no usable interval at all, so a run can
// never stop early just because some brain has too little data to have an opinion about.
function worstRankHalfWidth(ci) {
  let worst = 0, anyMissing = false;
  for (const p of players) {
    if (p.kind !== 'nn') continue;
    const c = ci[p.id];
    if (!c || !Number.isFinite(c.lo)) {
      // a brain with almost no games legitimately has no interval yet; one with plenty that still
      // has none means the yardstick is the problem, and either way we are not done
      anyMissing = true; continue;
    }
    worst = Math.max(worst, (c.hi - c.lo)/2);
  }
  return anyMissing ? Infinity : worst;
}

function report() {
  const ids = players.map(p => p.id);
  const elo = fitBT(ids, store.results);
  const byId = Object.fromEntries(players.map(p => [p.id, p]));
  // played-game counts, so a rank resting on almost no evidence is visible as such
  const played = {};
  for (const [key, r] of Object.entries(store.results)) {
    const [a, b] = key.split('|'); const t = r.w + r.l + (r.d || 0);
    played[a] = (played[a] || 0) + t; played[b] = (played[b] || 0) + t;
  }
  // Only rungs with real evidence behind them may serve as the yardstick, and only if they come out
  // in the right ORDER. A rung with a handful of games sits near the prior, and a mid-run fit
  // produced a ladder with L9 and L10 below L8 -- interpolating against that yields a precise-looking
  // rank derived from an inverted scale. Rungs that break monotonicity are dropped from the yardstick
  // (not from the report) and named, since a genuinely out-of-order ladder is itself worth knowing.
  const MIN_RUNG_GAMES = 6;
  const rungsAll = players.filter(p => p.kind === 'ladder')
    .map(p => ({ level: p.level, elo: elo[p.id], games: played[p.id] || 0 }))
    .sort((a, b) => a.level - b.level);
  const wellPlayed = rungsAll.filter(r => r.games >= MIN_RUNG_GAMES);
  const ladderElos = [], droppedRungs = [];
  for (const r of wellPlayed) {
    if (ladderElos.length && r.elo <= ladderElos[ladderElos.length - 1].elo) { droppedRungs.push(r); continue; }
    ladderElos.push(r);
  }
  const thinRungs = rungsAll.filter(r => r.games < MIN_RUNG_GAMES);
  const rows = players.map(p => {
    const e = elo[p.id];
    const rk = p.kind === 'nn' ? rankOf(e, ladderElos) : { rank: p.level, edge: null };
    return { p, elo: e, rank: rk.rank, edge: rk.edge, games: played[p.id] || 0 };
  }).sort((a, b) => a.elo - b.elo);

  console.log(`\n=== fitted ranking (${Object.keys(store.results).length} pairs, ` +
              `${Object.values(store.results).reduce((s, r) => s + r.w + r.l + (r.d || 0), 0)} games) ===`);
  // A brain with no games has no measured rating -- it sits wherever the regularising prior put it,
  // which is a real number that looks exactly like a measurement and is not one. This matters most
  // for --refit part-way through a run, when most of the field legitimately has nothing yet: shown
  // as "?" and kept out of the spec, so a ladder is never built on invented ranks. MIN_GAMES is
  // above zero for the same reason at one remove -- a single 2-game pair pins a brain barely better
  // than the prior does.
  const MIN_GAMES = 4;
  const boot = bootstrapRanks(+arg('bootstrap', 150));
  console.log('  rating  rank    90% CI          games  brain');
  for (const r of rows) {
    const thin = r.games < MIN_GAMES;
    const rankCell = r.p.kind !== 'nn' ? '  -  '
      : thin || r.edge === 'noscale' || !Number.isFinite(r.rank) ? '    ?'
      : r.edge ? (r.edge === 'above' ? '>' : '<') + String(r.rank).padStart(4)
      : r.rank.toFixed(2).padStart(5);
    const c = boot.ci[r.p.id];
    const ciCell = r.p.kind !== 'nn' ? '              '
      : (c && Number.isFinite(c.lo)) ? `L${c.lo.toFixed(1)} - L${c.hi.toFixed(1)}`.padStart(14)
      : '(not yet)'.padStart(14);
    console.log(`  ${String(Math.round(r.elo)).padStart(6)}  ${rankCell}  ${ciCell}  ` +
                `${String(r.games).padStart(5)}  ${r.p.label}${thin ? '  (too few games)' : ''}`);
  }
  if (boot.skipped)
    console.log(`\n(${boot.skipped}/${boot.B} bootstrap resamples had an unusable ladder and were ` +
                `skipped -- a high share here means the yardstick still needs games, not the nets)`);

  if (thinRungs.length)
    console.log(`\n(yardstick: L${thinRungs.map(r => r.level).join(', L')} have under ${MIN_RUNG_GAMES} ` +
                `games and are not used for interpolation yet)`);
  if (droppedRungs.length)
    console.log(`(yardstick: L${droppedRungs.map(r => r.level).join(', L')} rated BELOW a lower rung -- ` +
                `excluded from interpolation. Either they need more games, or the ladder really is ` +
                `out of order there, which is worth knowing either way.)`);
  if (ladderElos.length < 2)
    console.log(`(too few usable rungs to interpolate any rank yet -- let the ladder pairs finish)`);

  const specs = rows.filter(r => r.p.kind === 'nn' && !r.edge && r.games >= MIN_GAMES)
    .map(r => `${r.p.model}@${r.rank.toFixed(2)}:${r.p.depth}`);
  const thinCount = rows.filter(r => r.p.kind === 'nn' && r.games < MIN_GAMES).length;
  if (thinCount) console.log(`\n(${thinCount} brains have fewer than ${MIN_GAMES} games and are left ` +
                             `unranked -- re-run --refit later, or let the run finish)`);
  console.log(`\n=== paste into retromine.js ===\n--ensemble ${specs.join(',')}\n`);
  const above = rows.filter(r => r.p.kind === 'nn' && r.edge === 'above');
  if (above.length)
    console.log(`(${above.map(r => r.p.label).join(', ')} rated above L${LADDER_N} -- ` +
                `no rung to interpolate against, so left out of the spec rather than given a made-up rank)`);
  // Deliberately does NOT write outPath. playPair already checkpoints after every pair, so there is
  // nothing here to save -- and writing would be actively destructive in the --refit case, which is
  // meant to be run in a second window WHILE a ranking run is going: it loads the results file at
  // startup, so writing its now-stale copy back would erase every pair that landed in between.
}

// Results can now accumulate across MANY pairings of the same two brains, so merge rather than
// overwrite -- the adaptive scheduler below deliberately revisits an informative matchup.
function record(a, b, w, l, d) {
  const k = keyOf(a, b), prev = store.results[k] || { w: 0, l: 0, d: 0 };
  store.results[k] = { w: prev.w + w, l: prev.l + l, d: (prev.d || 0) + d };
}

const gamesOf = () => {
  const n = {};
  for (const [key, r] of Object.entries(store.results)) {
    const [a, b] = key.split('|'); const t = r.w + r.l + (r.d || 0);
    n[a] = (n[a] || 0) + t; n[b] = (n[b] || 0) + t;
  }
  return n;
};
const pairGamesOf = () => {
  const n = {};
  for (const [key, r] of Object.entries(store.results)) {
    const [a, b] = key.split('|'); const t = r.w + r.l + (r.d || 0);
    const k = a < b ? a + '|' + b : b + '|' + a;
    n[k] = (n[k] || 0) + t;
  }
  return n;
};

// Pick the most informative matchup available right now.
//
// A pairing's information content peaks when its outcome is genuinely uncertain. A 50/50 matchup
// carries about a bit; a foregone one carries almost nothing -- and the fixed pair list this
// replaces spent roughly a quarter of its budget on exactly that, ~40 pairs of 2-0 against L1 and
// L4 which told us only what we already knew. Three terms, multiplied:
//
//   closeness  the BT win probability implied by the current ratings, folded to peak at 50/50.
//              This is the whole point: play the games whose result we cannot predict.
//   need       favours brains with few games. Uncertainty in a rating falls roughly as 1/sqrt(n),
//              so the marginal value of a game is much higher for a brain with 2 than with 20.
//   novelty    damps pairs already played a lot. Repeating one matchup narrows that edge's error
//              bar while leaving the rest of the graph untouched, and BT needs the GRAPH.
//
// Ladder-vs-ladder pairs get a boost until the yardstick is pinned, because every net's rank is an
// interpolation against it -- an unpinned ladder makes every other measurement uninterpretable
// (which is exactly what a mid-run fit showed: L9 and L10 rating below L8).
function pickPair(elo, inFlight) {
  const g = gamesOf(), pg = pairGamesOf();
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const k = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
      if (inFlight.has(k)) continue;
      const bothLadder = a.kind === 'ladder' && b.kind === 'ladder';
      // only ADJACENT-ish ladder pairs are worth playing; L1 vs L11 is as foregone as it gets
      if (bothLadder && Math.abs(a.level - b.level) > 2) continue;
      const pExp = 1/(1 + Math.pow(10, ((elo[b.id] || 0) - (elo[a.id] || 0))/400));
      const closeness = 4*pExp*(1 - pExp);              // 1.0 at even, ->0 at foregone
      const need = 1/Math.sqrt(1 + (g[a.id] || 0)) + 1/Math.sqrt(1 + (g[b.id] || 0));
      const novelty = 1/(1 + (pg[k] || 0)/gamesPerPair);
      const ladderBoost = bothLadder && Math.min(g[a.id] || 0, g[b.id] || 0) < ladderGames ? 3 : 1;
      const score = (0.15 + closeness)*need*novelty*ladderBoost;
      if (score > bestScore) { bestScore = score; best = [a, b]; }
    }
  }
  return best;
}

async function main() {
  if (refitOnly) { report(); return; }
  const targetGames = Math.max(1, +arg('targetGames', 12));
  // Stop when every net's rank is known to within this many rungs (90% interval half-width).
  // A rank is used to slot a brain between ladder rungs, so +-0.5 rungs is the point past which
  // extra precision buys nothing downstream -- it already identifies which gap the brain sits in.
  // 0 disables, leaving time/coverage as the only stops.
  const rankTolerance = +arg('rankTolerance', 0.5);
  console.log(`elorank: ${players.length} brains, ${workers} lanes, ` +
              `adaptive pairing (closest-rated first), ${gamesPerPair} games per matchup`);
  console.log(`  stops when every net's rank is known to +-${rankTolerance} rungs (90% CI)` +
              (budgetHours > 0 ? `, or at ${budgetHours}h` : '') + `, whichever comes first`);
  const already = Object.keys(store.results).length;
  if (already) console.log(`resuming: ${already} matchups already stored`);
  if (dryRun) { console.log('(--dryrun: nothing played)'); return; }

  startedAt = Date.now();
  const inFlight = new Set();
  let stop = false, checksSinceBoot = 0;
  const outOfTime = () => budgetHours > 0 && (Date.now() - startedAt)/3600000 >= budgetHours;

  const lane = async () => {
    for (;;) {
      if (stop || outOfTime()) return;
      const g = gamesOf();
      if (players.every(p => (g[p.id] || 0) >= targetGames)) { stop = true; return; }
      // Confidence check, but only once there is enough data for the answer to be meaningful --
      // bootstrapping a nearly-empty store would report absurd precision on brains that have simply
      // never been separated. Checked on a cadence rather than every pair: it costs ~1s against
      // games that take minutes, but there is no reason to pay it on every single result.
      if (rankTolerance > 0 && checksSinceBoot++ >= workers &&
          players.every(p => (g[p.id] || 0) >= 6)) {
        checksSinceBoot = 0;
        const { ci } = bootstrapRanks(80);
        const worst = worstRankHalfWidth(ci);
        globalThis.__lastWorst = worst;
        if (worst <= rankTolerance) {
          console.log(`\nevery net's rank now known to +-${worst.toFixed(2)} rungs ` +
                      `(target ${rankTolerance}) -- stopping`);
          stop = true; return;
        }
      }
      // refit before every pick: BT over this many players is milliseconds, and a stale rating is
      // exactly what would send a lane off to play a foregone matchup.
      const elo = fitBT(players.map(p => p.id), store.results);
      const pick = pickPair(elo, inFlight);
      if (!pick) return;
      const [a, b] = pick;
      const k = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
      inFlight.add(k);
      try { await playPair(a, b); } finally { inFlight.delete(k); }
    }
  };
  await Promise.all(Array.from({ length: workers }, lane));
  const mins = ((Date.now() - startedAt)/60000).toFixed(0);
  console.log(`\nplayed for ${mins}m` + (outOfTime() ? ' (time budget reached)' : ' (coverage target reached)'));
  report();
}

main();
