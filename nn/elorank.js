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
const pairWeight = (a, b) => (SIDE_COST(a) + SIDE_COST(b))*gamesPerPair;
let doneWeight = 0, startedAt = 0;
const fmtDur = s => s >= 3600 ? `${(s/3600).toFixed(1)}h` : `${Math.round(s/60)}m`;

function playPair(a, b) {
  return new Promise(resolve => {
    const args = [path.join(dir, 'arena.js'), '--a', a.spec, '--b', b.spec,
                  '--games', String(gamesPerPair), '--openingPlies', String(openingPlies)];
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
      store.results[keyOf(a, b)] = { w, l, d };
      fs.writeFileSync(outPath, JSON.stringify(store, null, 1));   // checkpoint every pair
      doneWeight += pairWeight(a, b);
      // Pace is measured from actual wall time, which already accounts for however many lanes are
      // running -- so this self-corrects if the cost model above is wrong, which it will be.
      const elapsed = (Date.now() - startedAt)/1000;
      const eta = doneWeight > 0 ? (totalWeight - doneWeight)*(elapsed/doneWeight) : 0;
      console.log(`  ${a.label} vs ${b.label}: ${w}-${l}${d ? '-' + d : ''}` +
                  `   [${Math.round(100*doneWeight/totalWeight)}%, ~${fmtDur(eta)} left]`);
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

function report() {
  const ids = players.map(p => p.id);
  const elo = fitBT(ids, store.results);
  const byId = Object.fromEntries(players.map(p => [p.id, p]));
  const ladderElos = players.filter(p => p.kind === 'ladder').map(p => ({ level: p.level, elo: elo[p.id] }));
  // played-game counts, so a rank resting on almost no evidence is visible as such
  const played = {};
  for (const [key, r] of Object.entries(store.results)) {
    const [a, b] = key.split('|'); const t = r.w + r.l + (r.d || 0);
    played[a] = (played[a] || 0) + t; played[b] = (played[b] || 0) + t;
  }
  const rows = players.map(p => {
    const e = elo[p.id];
    const rk = p.kind === 'nn' ? rankOf(e, ladderElos) : { rank: p.level, edge: null };
    return { p, elo: e, rank: rk.rank, edge: rk.edge, games: played[p.id] || 0 };
  }).sort((a, b) => a.elo - b.elo);

  console.log(`\n=== fitted ranking (${Object.keys(store.results).length} pairs, ` +
              `${Object.values(store.results).reduce((s, r) => s + r.w + r.l + (r.d || 0), 0)} games) ===`);
  console.log('  rating  rank    games  brain');
  for (const r of rows)
    console.log(`  ${String(Math.round(r.elo)).padStart(6)}  ${r.p.kind === 'nn' ? (r.edge ? (r.edge === 'above' ? '>' : '<') + String(r.rank).padStart(4) : r.rank.toFixed(2).padStart(5)) : '  -  '}  ` +
                `${String(r.games).padStart(5)}  ${r.p.label}`);

  const specs = rows.filter(r => r.p.kind === 'nn' && !r.edge)
    .map(r => `${r.p.model}@${r.rank.toFixed(2)}:${r.p.depth}`);
  console.log(`\n=== paste into retromine.js ===\n--ensemble ${specs.join(',')}\n`);
  const above = rows.filter(r => r.p.kind === 'nn' && r.edge === 'above');
  if (above.length)
    console.log(`(${above.map(r => r.p.label).join(', ')} rated above L${LADDER_N} -- ` +
                `no rung to interpolate against, so left out of the spec rather than given a made-up rank)`);
  fs.writeFileSync(outPath, JSON.stringify(store, null, 1));
}

async function main() {
  if (refitOnly) { report(); return; }
  let allPairs = buildPairs();
  // --budgetHours: drop the LOWEST-VALUE brains until the estimated run fits the time available.
  // Checkpoints go first and the named architectures last, because the named ones are the whole
  // reason for ranking (they are the candidates for retromine's interleaved rungs) while adjacent
  // checkpoints are near-duplicates of each other -- dropping one costs almost no coverage of the
  // strength space, which is what this is actually mapping.
  // Trimming the FIELD rather than the games-per-pair is deliberate: Bradley-Terry pools evidence
  // across the whole graph, so more players with fewer games each beats fewer players with more,
  // and the field is what determines how much of the strength range gets covered at all.
  if (budgetHours > 0) {
    const isNamed = p => p.kind === 'ladder' ||
      /^(best|wide|ultra|deep|l15_value|scratch)$/.test(path.basename(p.model || '', '.json'));
    const est = () => buildPairs().reduce((t, [a, b]) => t + pairWeight(a, b), 0)*SEC_PER_WEIGHT/workers/3600;
    let guard = 0;
    while (est() > budgetHours && guard++ < 100) {
      // drop the checkpoint whose depth-family is largest, newest-first among droppables
      const droppable = players.filter(p => p.kind === 'nn' && !isNamed(p));
      const victims = droppable.length ? droppable : players.filter(p => p.kind === 'nn' && p.depth === 3);
      if (!victims.length) break;
      const drop = victims[victims.length - 1].model;
      for (let i = players.length - 1; i >= 0; i--) if (players[i].model === drop) players.splice(i, 1);
      console.log(`  budget: dropped ${path.basename(drop)} (est ${est().toFixed(1)}h vs ${budgetHours}h budget)`);
    }
    allPairs = buildPairs();
  }
  const total = allPairs.length;
  totalWeight = allPairs.reduce((t, [a, b]) => t + pairWeight(a, b), 0);
  const pairs = allPairs.filter(([a, b]) => !store.results[keyOf(a, b)] && !store.results[keyOf(b, a)]);
  doneWeight = totalWeight - pairs.reduce((t, [a, b]) => t + pairWeight(a, b), 0);
  console.log(`elorank: ${players.length} brains, ${total} pairs, ${gamesPerPair} games/pair ` +
              `(${total*gamesPerPair} games total), ${workers} at a time`);
  console.log(`  rough estimate: ${fmtDur(totalWeight*SEC_PER_WEIGHT/workers)} ` +
              `(refined from real pace once pairs start landing)`);
  if (pairs.length < total) console.log(`resuming: ${total - pairs.length} pairs already stored`);
  if (dryRun) { console.log('(--dryrun: nothing played)'); return; }
  startedAt = Date.now();
  let next = 0;
  const lane = async () => { while (next < pairs.length) { const [a, b] = pairs[next++]; await playPair(a, b); } };
  await Promise.all(Array.from({ length: Math.min(workers, pairs.length) }, lane));
  report();
}

main();
