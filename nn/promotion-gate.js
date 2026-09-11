'use strict';
// The best.json promotion gate: a DIRECT match against the incumbent, played here, not a comparison
// of two positions in the shared Elo pool.
//
// Why the pool cannot decide this. Every ckpt-* file from 168 to 281 was a byte copy of best.json,
// and the league rated those identical weights anywhere from -301 to +64 Elo -- that spread is the
// pool's noise floor at 4-90 games a face, and a 6-epoch resume of best.json sits inside it. The old
// gate asked a challenger's LOWER rank bound to clear the incumbent's UPPER bound, taken from the
// luckiest of its copies; with ~15 copies in the pool that bar sat at +180..+320 Elo, and it rose
// every cycle as another copy was minted. No incremental improvement can clear a bar like that, so
// best.json stopped moving at cycle 168 and every cycle since has said "keeping best.json".
//
// A head-to-head is the efficient use of the same games: 80 colour-balanced games between the two
// nets resolve about +/-80 Elo on the DIFFERENCE, where the same 80 games spread over a 90-face pool
// resolve nothing. The call is on the interval's lower bound -- provably stronger, not merely ahead
// -- which is the same standard gauntlet.js applies to a ladder rung, and it is what keeps the
// noise-ratchet closed: a lucky 6-game streak cannot promote, and neither can a tie.
//
// Games are played by arena.js exactly as gauntlet.js plays them, and every position is saved as
// training data (--saveData), so the gate is not a tax on the game stream -- it IS game stream.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { eloFromScore, fmtElo } = require('./elo.js');
const { createEngine } = require('./engine.js');
const dir = __dirname;

let kwCache = null;
const komiWinValue = () => (kwCache == null ? (kwCache = 0.5 + createEngine().CFG.komiLoss/2) : kwCache);

// Split one match's games into `n` chunks, each EVEN: arena alternates colours on the game index,
// so an odd shard hands one side an extra first move and biases exactly the number being measured.
function splitGames(total, n) {
  const pairs = Math.max(1, Math.floor(total/2)), q = Math.floor(pairs/n), r = pairs % n, out = [];
  for (let i = 0; i < n; i++) { const p = q + (i < r ? 1 : 0); if (p > 0) out.push(p*2); }
  return out;
}

function playShard(job) {
  const args = [path.join(dir, 'arena.js'),
    '--a', `nn:0:${job.path}`, '--depthA', String(job.depth),
    '--b', `nn:0:${job.incumbent}`, '--depthB', String(job.depth),
    '--games', String(job.games), '--openingPlies', String(job.openingPlies),
    '--idA', `${job.name}@D${job.depth}`, '--idB', `${path.basename(job.incumbent, '.json')}@D${job.depth}`];
  if (job.saveData) args.push('--saveData', job.saveData);
  return new Promise(resolve => execFile(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 24 },
    (err, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr);
      // Same summary-line parse gauntlet.js uses. `% of decided` folds komi wins at their
      // discounted value; the counts are what get merged across shards.
      const m = [...String(stdout || '').matchAll(/:\s*(\d+)-(\d+)(?:-(\d+))?\s+\((?:komi (\d+)-(\d+), )?(\d+)% of decided/g)];
      if (err || !m.length) return resolve(null);
      const q = m.at(-1);
      resolve({ w: +q[1], l: +q[2], d: +(q[3] || 0), komiW: +(q[4] || 0), komiL: +(q[5] || 0), games: job.games });
    }));
}

// Play every candidate against the incumbent. `candidates` are model file paths; `lanes` arena
// processes run at once and each candidate's games are sharded across the lanes that are free for
// it, so four candidates on six lanes finish in about the time of one 80-game match.
async function runGate(opts) {
  const {
    incumbent, candidates, games = 80, lanes = 4, depth = 1, openingPlies = 4,
    dataPrefix = null, log = console.log,
  } = opts;
  const cands = [...new Set(candidates)].filter(p => p && fs.existsSync(p) && p !== incumbent);
  if (!cands.length || !fs.existsSync(incumbent)) return { results: [], played: 0 };
  const shards = Math.max(1, Math.floor(lanes/cands.length));
  const jobs = [];
  cands.forEach((p, ci) => {
    const name = path.basename(p, '.json');
    splitGames(games, shards).forEach((g, si) => jobs.push({
      name, path: p, incumbent, depth, games: g, openingPlies,
      saveData: dataPrefix ? `${dataPrefix}-${String(ci).padStart(2, '0')}-${si}.jsonl` : null,
    }));
  });
  log(`gate: ${cands.length} candidate(s) x ${games} games vs ${path.basename(incumbent, '.json')} ` +
      `at D${depth}, ${jobs.length} match(es) on ${Math.min(lanes, jobs.length)} lane(s)`);
  const rows = [];
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const r = await playShard(job);
      if (r) rows.push({ ...r, name: job.name, path: job.path });
      else log(`gate: no result for ${job.name} (${job.games} games) -- arena produced no summary`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, jobs.length) }, lane));

  const kw = komiWinValue(), by = new Map();
  for (const r of rows) {
    const m = by.get(r.name) || { name: r.name, path: r.path, games: 0, w: 0, l: 0, d: 0, komiW: 0, komiL: 0 };
    m.games += r.games; m.w += r.w; m.l += r.l; m.d += r.d; m.komiW += r.komiW; m.komiL += r.komiL;
    by.set(r.name, m);
  }
  const results = [];
  for (const m of by.values()) {
    const scoreA = m.w + kw*m.komiW + (1 - kw)*m.komiL;
    const scoreB = m.l + kw*m.komiL + (1 - kw)*m.komiW;
    results.push({ ...m, scoreA, scoreB, rating: eloFromScore(scoreA, scoreB) });
  }
  // Candidates that produced no rows at all still get a line, so a silent arena failure is visible.
  for (const p of cands) if (!by.has(path.basename(p, '.json')))
    results.push({ name: path.basename(p, '.json'), path: p, games: 0, w: 0, l: 0, d: 0, komiW: 0, komiL: 0,
                   scoreA: 0, scoreB: 0, rating: eloFromScore(0, 0) });
  results.sort((a, b) => (b.rating.lo ?? -Infinity) - (a.rating.lo ?? -Infinity));
  return { results, played: rows.reduce((a, r) => a + r.games, 0) };
}

// "provably stronger than the incumbent by more than `margin`" -- the lower bound carries it.
function clears(result, margin = 0) {
  const e = result && result.rating;
  return !!(e && e.elo != null && e.lo > margin);
}

function describe(result, margin = 0) {
  const e = result.rating;
  const score = `${result.w}-${result.l}${result.d ? '-' + result.d : ''}` +
    (result.komiW + result.komiL ? ` (komi ${result.komiW}-${result.komiL})` : '');
  const call = e.elo == null ? 'no data' : clears(result, margin) ? 'CLEARS' : e.hi < 0 ? 'weaker' : 'undecided';
  const inc = result.incumbent ? ` vs ${result.incumbent.name}'s ${result.incumbent.w}-${result.incumbent.l}${result.incumbent.d ? '-' + result.incumbent.d : ''} on the same panel` : '';
  return `${result.name}: ${score}${inc}, ${fmtElo(e)} -- ${call}`;
}


// ---------- The panel gate (true-start era) ----------
// Every game now starts from the true start, and every brain here is deterministic -- nets at
// temperature 0, ladder rungs without noise -- so a candidate-vs-incumbent match has exactly two
// distinct games, one per colour. Eighty of them would replay those two forty times. The
// measurement instead spreads over a PANEL: the candidate and the incumbent each play the same
// panel members, both colours each, and the comparison is PAIRED -- per member, the candidate's
// score fraction minus the incumbent's -- so the panel's own strength cancels out. The interval
// is a bootstrap over panel members, expressed in Elo the same way eloFromScore does it, and the
// call is still the lower bound: provably stronger against the same field, not merely ahead.
//
// Deterministic games are cacheable: a (player, member, depth) cell is played once and kept in
// .gate-panel-cache.json, so the incumbent's side of the panel costs nothing after its first
// cycle and a standing candidate that is re-gated every cycle costs nothing after its first.
//
// panel: [{ id, spec, depth? }] -- arena --b specs ('L11', 'nn:0:<path>' with depth).
const PANEL_CACHE = path.join(dir, '.gate-panel-cache.json');
function readCache() { try { return JSON.parse(fs.readFileSync(PANEL_CACHE, 'utf8')); } catch (e) { return {}; } }
function writeCache(c) {
  const tmp = PANEL_CACHE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 1)); fs.renameSync(tmp, PANEL_CACHE);
}
function playCell(job) {
  const args = [path.join(dir, 'arena.js'),
    '--a', `nn:0:${job.path}`, '--depthA', String(job.depth),
    '--b', job.member.spec, '--games', '2', '--openingPlies', '0',
    '--idA', `${job.name}@D${job.depth}`, '--idB', job.member.id];
  if (job.member.depth) args.push('--depthB', String(job.member.depth));
  if (job.saveData) args.push('--saveData', job.saveData);
  return new Promise(resolve => execFile(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 24 },
    (err, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr);
      const m = [...String(stdout || '').matchAll(/:\s*(\d+)-(\d+)(?:-(\d+))?\s+\((?:komi (\d+)-(\d+), )?(\d+)% of decided/g)];
      if (err || !m.length) return resolve(null);
      const q = m.at(-1);
      resolve({ w: +q[1], l: +q[2], d: +(q[3] || 0), komiW: +(q[4] || 0), komiL: +(q[5] || 0) });
    }));
}
// A cell's score fraction for the player: decided games only, komi wins at their discounted value;
// a cell that was all draws (or never resolved) says 0.5 -- no information either way.
function cellFrac(c, kw) {
  if (!c) return 0.5;
  const sa = c.w + kw*c.komiW + (1 - kw)*c.komiL, sb = c.l + kw*c.komiL + (1 - kw)*c.komiW;
  return sa + sb > 0 ? sa/(sa + sb) : 0.5;
}
const logit = p => 400*Math.log10(p/(1 - p));
// Paired comparison over panel members: Elo of the candidate's field score minus the incumbent's,
// Haldane-corrected, with a 2-sigma-equivalent bootstrap interval over members.
function pairedElo(fc, fi, boots) {
  const n = fc.length;
  if (!n) return { elo: null, sigma: null, lo: null, hi: null, n: 0, verdict: 'no data yet' };
  const diff = (c, i) => { const m = c.length; const pc = (c.reduce((a, b) => a + b, 0) + 0.5)/(m + 1), pi = (i.reduce((a, b) => a + b, 0) + 0.5)/(m + 1); return logit(pc) - logit(pi); };
  const elo = diff(fc, fi), draws = [];
  let seed = 0x9e3779b9;
  const rnd = () => { seed = (seed*1664525 + 1013904223) >>> 0; return seed/4294967296; };
  for (let b = 0; b < (boots || 400); b++) {
    const c = [], i = [];
    for (let k = 0; k < n; k++) { const j = Math.floor(rnd()*n); c.push(fc[j]); i.push(fi[j]); }
    draws.push(diff(c, i));
  }
  draws.sort((x, y) => x - y);
  const lo = draws[Math.floor(0.025*draws.length)], hi = draws[Math.min(draws.length - 1, Math.floor(0.975*draws.length))];
  const sigma = (hi - lo)/4;
  return { elo, sigma, lo, hi, n, verdict: lo > 0 ? 'beats' : hi < 0 ? 'loses' : 'undecided' };
}
async function runPanelGate(opts) {
  const { incumbent, candidates, panel, lanes = 4, depth = 1, dataPrefix = null, log = console.log } = opts;
  const cands = [...new Set(candidates)].filter(p => p && fs.existsSync(p) && p !== incumbent);
  if (!cands.length || !fs.existsSync(incumbent) || !panel || !panel.length) return { results: [], played: 0 };
  const cache = readCache(), kw = komiWinValue();
  const players = [{ name: path.basename(incumbent, '.json'), path: incumbent, inc: true },
                   ...cands.map(p => ({ name: path.basename(p, '.json'), path: p, inc: false }))];
  const jobs = [];
  players.forEach((pl, pi) => panel.forEach((member, mi) => {
    const key = `${pl.name}@D${depth}|${member.id}`;
    if (cache[key]) return;
    jobs.push({ name: pl.name, path: pl.path, depth, member, key,
                saveData: dataPrefix ? `${dataPrefix}-${String(pi).padStart(2, '0')}-${String(mi).padStart(2, '0')}.jsonl` : null });
  }));
  log(`gate: ${cands.length} candidate(s) vs ${path.basename(incumbent, '.json')} over a ${panel.length}-member panel ` +
      `at D${depth}: ${jobs.length} cell(s) to play (${players.length*panel.length - jobs.length} cached), ${Math.min(lanes, jobs.length) || 0} lane(s)`);
  let next = 0, played = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const r = await playCell(job);
      if (r) { cache[job.key] = r; played += 2; writeCache(cache); }
      else log(`gate: no result for ${job.name} vs ${job.member.id} -- arena produced no summary`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, jobs.length) }, lane));
  const incName = players[0].name;
  const results = [];
  for (const pl of players.slice(1)) {
    const fc = [], fi = [], tot = { games: 0, w: 0, l: 0, d: 0, komiW: 0, komiL: 0 }, inc = { games: 0, w: 0, l: 0, d: 0, komiW: 0, komiL: 0 };
    for (const member of panel) {
      const c = cache[`${pl.name}@D${depth}|${member.id}`], i = cache[`${incName}@D${depth}|${member.id}`];
      if (!c || !i) continue;   // a member both sides have played is a pair; anything else is dropped
      fc.push(cellFrac(c, kw)); fi.push(cellFrac(i, kw));
      for (const [t, x] of [[tot, c], [inc, i]]) { t.games += 2; t.w += x.w; t.l += x.l; t.d += x.d; t.komiW += x.komiW; t.komiL += x.komiL; }
    }
    results.push({ name: pl.name, path: pl.path, ...tot, incumbent: { name: incName, ...inc },
                   scoreA: fc.reduce((a, b) => a + b, 0), scoreB: fi.reduce((a, b) => a + b, 0), rating: pairedElo(fc, fi) });
  }
  results.sort((a, b) => (b.rating.lo ?? -Infinity) - (a.rating.lo ?? -Infinity));
  return { results, played };
}

module.exports = { runGate, runPanelGate, pairedElo, clears, describe, splitGames };
