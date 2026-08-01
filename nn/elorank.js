// Rank every brain we have -- ladder rungs AND neural nets at several search depths -- on ONE
// scale, so retromine.js's interleaved strength ladder can be built from measurement instead of
// guesswork. Output is a fractional rank per net ("wide.json at depth 2 plays like L4.6"), plus a
// ready-to-paste --ensemble string.
//
//   node nn/elorank.js [--games 4] [--depths 1,2,3] [--levels 1,2,3,4,5,6,7,8,9,10,11]
//                      [--models a.json,b.json] [--spread 6] [--workers 6]
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
const workers = Math.max(1, +arg('workers', 6));
const outPath = arg('out', path.join(dir, 'elo-results.json'));
const saveData = arg('saveData', null);
const refitOnly = process.argv.includes('--refit');
const spread = Math.max(0, +arg('spread', 6));

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

const players = [];   // { id, kind:'ladder'|'nn', spec, depth, label }
let LADDER_N = 11;
try { LADDER_N = require('./engine.js').createEngine().AI_LADDER.length; } catch (e) {}
const useLevels = levels.length ? levels.filter(l => l <= LADDER_N) : Array.from({ length: LADDER_N }, (_, i) => i + 1);
for (const l of useLevels)
  players.push({ id: `L${l}`, kind: 'ladder', spec: `L${l}`, level: l, label: `L${l}` });
for (const m of discoverModels())
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
  for (const n of nets) for (const r of rungSpread) add(n, r);
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

function playPair(a, b) {
  return new Promise(resolve => {
    const args = [path.join(dir, 'arena.js'), '--a', a.spec, '--b', b.spec,
                  '--games', String(gamesPerPair), '--openingPlies', '2'];
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
      console.log(`  ${a.label} vs ${b.label}: ${w}-${l}${d ? '-' + d : ''}`);
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
  const pairs = buildPairs().filter(([a, b]) => !store.results[keyOf(a, b)] && !store.results[keyOf(b, a)]);
  const total = buildPairs().length;
  console.log(`elorank: ${players.length} brains, ${total} pairs, ${gamesPerPair} games/pair ` +
              `(${total*gamesPerPair} games total), ${workers} at a time`);
  if (pairs.length < total) console.log(`resuming: ${total - pairs.length} pairs already stored`);
  let next = 0;
  const lane = async () => { while (next < pairs.length) { const [a, b] = pairs[next++]; await playPair(a, b); } };
  await Promise.all(Array.from({ length: Math.min(workers, pairs.length) }, lane));
  report();
}

main();
