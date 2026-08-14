// Rank every brain we have -- ladder rungs AND neural nets at several search depths -- on ONE
// scale, so retromine.js's interleaved strength ladder can be built from measurement instead of
// guesswork. Output is a fractional rank per net ("wide.json at depth 2 plays like L4.6"), plus a
// live table; retromine.js reads the JSON summary directly for its strength axis.
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

// Atomic save: write to a temp file beside the target, then rename over it. A rename is a single
// filesystem operation -- interrupted, it either fully lands or doesn't happen at all -- where a
// direct writeFileSync/copyFileSync can be caught mid-flight and leave the target truncated. That
// gap is real here: this console gets closed at will (START.bat's whole design), including mid-save
// of the results file, and a truncated elo-results.json is worse than a merely-stale one -- the
// load path below treats "corrupt" the same as "doesn't exist yet" and would silently discard the
// entire rating history, not just the update in flight.
function atomicWrite(destPath, data) {
  const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, destPath);
}
function atomicCopy(srcPath, destPath) {
  const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(srcPath, tmp);
  fs.renameSync(tmp, destPath);
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
// What a game the komi rule scored at the move cap is worth, as a fraction of a win. Must track
// CFG.komiLoss in index.html. Recorded as KOMI_LOSS of a win plus the remainder as a draw, so
// fitBT's "wins + draws/2" lands on 0.5 + KOMI_LOSS/2 for the winner -- and w/l/d become
// fractional, which every consumer here sums or ratios rather than counting.
const KOMI_LOSS = 0.3;
// Print the field, pair count and time estimate, then exit without playing anything -- for
// choosing --games/--spread/--budgetHours before committing hours to a run.
const dryRun = process.argv.includes('--dryrun');
// --focus a.json,b.json: only play matchups involving these models. This is what makes a standing
// rating POOL cheap. Placing one new checkpoint does not need the field replayed against itself --
// every other brain's rating is already known and does not move -- it needs a handful of games
// against opponents near its own strength. A round robin re-answers questions it answered last
// time; this answers only the new one.
const focusRaw = (arg('focus', '') || '').split(',').map(x => x.trim()).filter(Boolean);
const focusPaths = focusRaw.map(x => path.basename(x, '.json'));
// --summary: write the fitted ratings out as JSON so another process (run.js) can read them
// without re-deriving anything or parsing console output.
const summaryPath = arg('summary', null);
// --focusPairs 0 keeps everything else about focus mode (the named models join the field, the
// stopping rules track them) but lifts the pairing restriction, so the adaptive scheduler spends
// the budget wherever the ratings are least certain across the WHOLE pool. This is the
// "granularity pass": run it now and then and the pool's older members keep slowly sharpening
// instead of being frozen at whatever precision their placement run reached.
const focusPairsOnly = arg('focusPairs', '1') !== '0';
// --anchorShare: minimum fraction of each NET's games that should be against ladder rungs. A
// QUOTA, deliberately, rather than a fixed boost: the pool gains nets forever while the ladder
// stays 11 rungs, so any constant preference dilutes toward zero as the pool grows -- which is
// exactly when it is needed most. Two rots are being prevented at once. In the saved training
// data, nn-vs-nn games teach "how to beat nets like me" and self-play drifts into a style cycle;
// the rungs are fixed, varied, non-learning opponents that keep style honest. And in the fit,
// net ratings only mean anything because they are tethered to the anchor rungs -- an nn cloud that
// mostly plays itself stays internally consistent while floating loose against the scale.
const anchorShare = Math.min(0.9, Math.max(0, +arg('anchorShare', 0.3)));
// Most compute should improve the competitive frontier, but never set weak models' probability to
// zero: they still need enough evidence to be retired honestly. 0.15 = a 15% exploration floor.
const strengthExplore = Math.min(0.9, Math.max(0.01, +arg('strengthExplore', 0.15)));
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
  // Frozen dual entrants are a separate lineage from best.json. The registry is the authoritative
  // SMALL active field: retired files remain in elo-results.json as historical evidence, but do not
  // consume fresh games forever. This is also what makes a restarted manual rank discover the same
  // four dual trunks even when run.js did not provide --focus.
  let keepDual = [], haveDualRegistry = false;
  try {
    const pop = JSON.parse(fs.readFileSync(path.join(modelsDir, '.dual-pop.json'), 'utf8'));
    if (Array.isArray(pop.active)) {
      haveDualRegistry = true;
      keepDual = pop.active.map(m => m && m.file).filter(f => f && files.includes(f));
    }
  } catch (e) {}
  // Upgrade compatibility: before the first new trainer cycle writes a registry, keep a tiny sample
  // of the legacy control/mutant field. run.js imports the best measured four into the registry; a
  // standalone elorank run uses newest four as a bounded fallback rather than resurrecting all 40.
  if (!haveDualRegistry) keepDual = files
    .filter(f => /^dual-(?:(?:control|mut)-\d+-e\d+|pop-\d+-e\d+)\.json$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(-4);
  for (const f of keepDual) pick.push(path.join(modelsDir, f));
  // Anything named by --focus joins the field unconditionally. Focus only restricts which PAIRS get
  // played; a model that is focused but not discovered would be silently rated zero games, which is
  // exactly the failure mode for the from-scratch challenger (scratch-091.json matches none of the
  // patterns above) -- the run would look healthy and simply never measure the thing it was for.
  for (const f of focusRaw) {
    const abs = path.isAbsolute(f) ? f : path.resolve(f);
    if (fs.existsSync(abs) && !pick.some(q => path.resolve(q) === abs)) pick.push(abs);
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
      if (fresh || !fs.existsSync(dest)) atomicCopy(p, dest);
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
function isDualModel(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).dual === true; }
  catch (e) { return false; }
}
let LADDER_N = 11;
try { LADDER_N = require('./engine.js').createEngine().AI_LADDER.length; } catch (e) {}
const useLevels = levels.length ? levels.filter(l => l <= LADDER_N) : Array.from({ length: LADDER_N }, (_, i) => i + 1);
for (const l of useLevels)
  players.push({ id: `L${l}`, kind: 'ladder', spec: `L${l}`, level: l, label: `L${l}` });
for (const m of snapshotModels(discoverModels())) for (const d of depths) {
  const name = path.basename(m, '.json');
  if (!isDualModel(m)) {
    players.push({ id: `${name}@D${d}`, kind: 'nn', spec: `nn:0:${m}`,
                   depth: d, model: m, label: `${name} D${d}` });
  } else {
    // One frozen dual file is two rated search identities. Bare measures the jointly-trained value
    // head; +P spends its own policy logits on ordering/cutoff. Same weights, same depth, one flag
    // apart -- the clean fusion ablation the old nn-only pool could not represent.
    players.push({ id: `${name}@D${d}`, kind: 'nn', brain: 'dual', spec: `dual:0:${m}`,
                   depth: d, model: m, label: `${name} D${d}` });
    players.push({ id: `${name}+P@D${d}`, kind: 'nn', brain: 'dual', spec: `dual:0:${m}`,
                   depth: d, model: m, dualPolicy: true, ab: true, label: `${name}+policy D${d}` });
  }
}

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

// --- the inbox: results played elsewhere, merged in here ------------------------------------------
// run.js's ladder sweep plays real rated games (a checkpoint at a fixed depth against ladder rungs)
// but used to throw the win/loss away, keeping only its frontier window -- so hours of arena games
// contributed training rows and ZERO rating information, while the pool separately paid to answer
// the same question. They belong on the same scale as everything else.
// They arrive through an append-only JSONL inbox rather than being written straight into
// elo-results.json, and that is not incidental: since the scheduler became non-blocking, the bench
// cycle and the pool cycle deliberately run CONCURRENTLY (separate lock keys). Two writers on
// elo-results.json would silently lose whichever update landed second -- elorank checkpoints the
// whole store after every pair, so a stale in-memory copy written back would erase the other's
// work. An append-only file has one writer per line and no read-modify-write, so it is safe under
// exactly that concurrency. Drained and truncated here, at the single point that owns the store.
const inboxPath = arg('inbox', path.join(dir, 'elo-inbox.jsonl'));
(function drainInbox() {
  let txt;
  try { txt = fs.readFileSync(inboxPath, 'utf8'); } catch (e) { return; }   // no inbox is the normal case
  let merged = 0, skipped = 0;
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (!r.a || !r.b) { skipped++; continue; }
      const k = `${r.a}|${r.b}`, prev = store.results[k] || { w: 0, l: 0, d: 0 };
      store.results[k] = { w: prev.w + (+r.w || 0), l: prev.l + (+r.l || 0), d: (prev.d || 0) + (+r.d || 0) };
      merged++;
    } catch (e) { skipped++; }
  }
  if (merged) {
    // Truncate only AFTER the merged store is safely on disk, so a crash in between re-merges the
    // inbox next run rather than losing it. Double-counting a few games is recoverable; silently
    // dropping results is not.
    atomicWrite(outPath, JSON.stringify(store, null, 1));
    try { fs.unlinkSync(inboxPath); } catch (e) {}
    console.log(`merged ${merged} result line(s) from ${path.basename(inboxPath)}` +
                (skipped ? ` (${skipped} unreadable, left out)` : ''));
  }
})();

// --- bounding the FIELD (which is not the same as bounding the POOL) -----------------------------
// The pool is append-only and uncapped: once a model has a rating it keeps it forever, on the same
// scale, at a cost of one line of JSON. Nothing is ever retired from it.
// What has to be bounded is the field for ANY ONE RUN. The adaptive scheduler divides a fixed
// budget among eligible players and its need term is 1/sqrt(1+games), so with 200 checkpoints
// eligible it spends the budget re-measuring history instead of placing the new net. Trimming is
// not a loss of information either: the information in a game peaks at an even matchup and falls to
// ~0 for a foregone one, so a game against a brain 400 Elo away is close to free of content no
// matter how many such brains are available to play.
// --focusField N therefore keeps the N nn opponents nearest the focus models in rating. Ladder
// rungs are NEVER trimmed -- they are the anchor that stops a self-referential pool inflating, they
// are code rather than files so they cannot go stale, and the low rungs are the cheapest games on
// the board.
const focusField = Math.max(0, +arg('focusField', 8));
if (focusPaths.length && focusPairsOnly && focusField > 0) {
  const nnPlayers = players.filter(p => p.kind === 'nn');
  const isFocus = p => focusPaths.includes(path.basename(p.model, '.json'));
  const others = nnPlayers.filter(p => !isFocus(p));
  if (others.length > focusField) {
    const prior = fitBT(players.map(p => p.id), store.results);
    // A brand-new checkpoint has no prior rating -- it is a copy of best.json, so the strongest
    // rated net in the pool is a far better guess for where it will land than 0 (which is the
    // ladder's low end and would pick the weakest opponents in the field).
    const rated = others.filter(p => (prior[p.id] || 0) !== 0);
    const fallback = rated.length ? Math.max(...rated.map(p => prior[p.id])) : 0;
    const anchors = nnPlayers.filter(isFocus).map(p => prior[p.id] || fallback);
    const dist = p => Math.min(...anchors.map(a => Math.abs((prior[p.id] || 0) - a)));
    const keep = new Set(others.sort((x, y) => dist(x) - dist(y)).slice(0, focusField).map(p => p.id));
    for (let i = players.length - 1; i >= 0; i--)
      if (players[i].kind === 'nn' && !isFocus(players[i]) && !keep.has(players[i].id))
        players.splice(i, 1);
    console.log(`focus mode: ${players.filter(p => p.kind === 'nn' && isFocus(p)).length} model(s) ` +
                `being placed against the ${keep.size} nearest-rated of ${others.length} pool ` +
                `members, plus all ${players.filter(p => p.kind === 'ladder').length} ladder rungs`);
  }
}

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
let consecutiveFailures = 0, stopAll = false;
const FAIL_LIMIT = 8;
const fmtDur = s => s >= 3600 ? `${(s/3600).toFixed(1)}h` : `${Math.round(s/60)}m`;

function playPair(a, b) {
  return new Promise(resolve => {
    // ladder-vs-ladder pairs are the yardstick: more games each, and they are also among the
    // cheapest games on the board at the low rungs, so this costs far less than it sounds
    const bothLadder = a.kind === 'ladder' && b.kind === 'ladder';
    const n = bothLadder ? ladderGames : gamesPerPair;
    const args = [path.join(dir, 'arena.js'), '--a', a.spec, '--b', b.spec,
                  '--games', String(n), '--openingPlies', String(openingPlies),
                  // so every row these games save knows which rated brain played it
                  '--idA', a.id, '--idB', b.id];
    if (randomStartFrac > 0) args.push('--randomStartFrac', String(randomStartFrac));
    if (a.kind === 'nn') args.push('--depthA', String(a.depth));
    if (b.kind === 'nn') args.push('--depthB', String(b.depth));
    if (a.dualPolicy) args.push('--dualPolicyA');
    if (b.dualPolicy) args.push('--dualPolicyB');
    if (a.ab) args.push('--abA');
    if (b.ab) args.push('--abB');
    if (saveData) args.push('--saveData', saveData);
    execFile('node', args, { encoding: 'utf8', maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      // Same parse arena.js's own callers use: the LAST "N-M (" on the line, since the per-game
      // running tally has the identical shape.
      const m = [...String(stdout || '').matchAll(/:\s*(\d+)-(\d+)(?:-(\d+))?\s+\(/g)];
      if (!m.length) {
        // Report WHY, once. A misconfigured setup and a slow one look identical without this, and
        // the scheduler will happily re-pick the same broken pair until the whole budget is gone --
        // which is exactly what a first end-to-end run did: 40 lines of "no result" and an empty
        // ranking, with the actual ENOENT thrown away because `err` was never read.
        const why = String(stderr || (err && err.message) || '').trim().split('\n')
          .filter(Boolean).slice(-2).join(' | ');
        console.log(`  ! no result for ${a.label} vs ${b.label}` + (why ? `: ${why}` : ''));
        if (++consecutiveFailures >= FAIL_LIMIT) {
          console.error(`\n${consecutiveFailures} games in a row produced no result -- arena.js is ` +
                        `failing, not the brains. Stopping rather than burning the budget.`);
          stopAll = true;
        }
        return resolve();
      }
      consecutiveFailures = 0;
      const last = m[m.length - 1];
      // Games the komi rule scored at the move cap come back in their own "(komi A-B, ...)" field,
      // not in the W-L-D triple. They are worth KOMI_LOSS of a win: the winner takes
      // 0.5 + KOMI_LOSS/2 of the point and the loser the rest, which is what fitBT's "wins + draws/2"
      // then works out to. Rating a cap-scored game as a whole win would let a 74%-accurate call move
      // a brain as far as pushing a piece off the board does.
      const kk = [...String(stdout || '').matchAll(/\(komi (\d+)-(\d+)/g)];
      const kA = kk.length ? +kk[kk.length - 1][1] : 0, kB = kk.length ? +kk[kk.length - 1][2] : 0;
      const w = +last[1] + KOMI_LOSS*kA, l = +last[2] + KOMI_LOSS*kB;
      const d = +(last[3] || 0) + (1 - KOMI_LOSS)*(kA + kB);
      record(a, b, w, l, d);
      atomicWrite(outPath, JSON.stringify(store, null, 1));   // checkpoint every pair
      // No fixed pair list to measure progress against anymore, so report what actually matters:
      // how well covered the least-measured brain is, and how much of the time budget is left.
      const gs = gamesOf(), least = Math.round(Math.min(...players.map(p => gs[p.id] || 0)));
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
      // n can be fractional now (a komi win is recorded as 0.3 of a win and 0.7 of a draw), so the
      // resample draws a whole number of games while keeping the fractional weights as the odds.
      const N = Math.max(1, Math.round(n));
      let w = 0, l = 0, d = 0;
      for (let i = 0; i < N; i++) {
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
      // A draw above/below the measured ladder is still evidence.  It is censored,
      // not invalid: retaining the edge lets the CI say ">L10" rather than
      // silently conditioning on only the draws that happened to land inside.
      if (Number.isFinite(rk.rank)) samples[p.id].push(rk);
    }
  }
  const out = {};
  for (const p of nets) {
    const order = r => r.rank + (r.edge === 'above' ? 0.5 : r.edge === 'below' ? -0.5 : 0);
    const v = samples[p.id].sort((a, c) => order(a) - order(c));
    if (v.length >= 10) {
      const lo = v[Math.floor(0.05*v.length)], hi = v[Math.floor(0.95*v.length)];
      out[p.id] = { lo:lo.rank, hi:hi.rank, loEdge:lo.edge || null, hiEdge:hi.edge || null, n:v.length };
    } else out[p.id] = { lo:NaN, hi:NaN, loEdge:null, hiEdge:null, n:v.length };
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
    // when focusing, only the models being placed have to reach the tolerance -- the rest of the
    // pool is not being measured this run and its intervals are whatever they already were
    if (focusPaths.length && focusPairsOnly && !focusPaths.includes(path.basename(p.model, '.json'))) continue;
    const c = ci[p.id];
    if (!c || !Number.isFinite(c.lo) || c.loEdge || c.hiEdge) {
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
    // rounded for display only: a komi win is recorded as 0.3 of a win plus 0.7 of a draw, so these
    // totals are fractional by construction even though each one still counts as exactly one game
    return { p, elo: e, rank: rk.rank, edge: rk.edge, games: Math.round(played[p.id] || 0) };
  }).sort((a, b) => a.elo - b.elo);

  console.log(`\n=== fitted ranking (${Object.keys(store.results).length} pairs, ` +
              `${Math.round(Object.values(store.results).reduce((s, r) => s + r.w + r.l + (r.d || 0), 0))} games) ===`);
  // A brain with no games has no measured rating -- it sits wherever the regularising prior put it,
  // which is a real number that looks exactly like a measurement and is not one. This matters most
  // for --refit part-way through a run, when most of the field legitimately has nothing yet: shown
  // as "?" and kept out of the spec, so a ladder is never built on invented ranks. MIN_GAMES is
  // above zero for the same reason at one remove -- a single 2-game pair pins a brain barely better
  // than the prior does.
  const MIN_GAMES = 4;
  const boot = bootstrapRanks(+arg('bootstrap', 150));
  // Ladder rungs render BOLD + UNDERLINED so the fixed yardstick is visually separable from the
  // ever-growing crowd of nets at a glance. Only when stdout is a real console: piped or captured
  // output (run.js's logs, redirects to a file) gets plain text, because the escape bytes would
  // land in the log as literal garbage. Windows 10+ conhost renders both codes; on the one
  // machine this project runs on, that's a given.
  const tty = process.stdout.isTTY;
  const rung = s => tty ? `\x1b[1m\x1b[4m${s}\x1b[0m` : s;
  console.log('  rating  rank    90% CI          games  brain');
  for (const r of rows) {
    const thin = r.games < MIN_GAMES;
    const rankCell = r.p.kind !== 'nn' ? '  -  '
      : thin || r.edge === 'noscale' || !Number.isFinite(r.rank) ? '    ?'
      : r.edge ? (r.edge === 'above' ? '>' : '<') + String(r.rank).padStart(4)
      : r.rank.toFixed(2).padStart(5);
    const c = boot.ci[r.p.id];
    const ciBound = (v, edge) => edge === 'above' ? `>L${v.toFixed(1)}`
      : edge === 'below' ? `<L${v.toFixed(1)}` : `L${v.toFixed(1)}`;
    const ciCell = r.p.kind !== 'nn' ? '              '
      : (c && Number.isFinite(c.lo)) ? `${ciBound(c.lo,c.loEdge)} - ${ciBound(c.hi,c.hiEdge)}`.padStart(14)
      : '(not yet)'.padStart(14);
    // the whole line is built and padded FIRST, then wrapped -- escape codes inside the padding
    // arithmetic would throw every column off by the width of the invisible bytes
    const line = `  ${String(Math.round(r.elo)).padStart(6)}  ${rankCell}  ${ciCell}  ` +
                 `${String(r.games).padStart(5)}  ${r.p.label}${thin ? '  (too few games)' : ''}`;
    console.log(r.p.kind === 'ladder' ? rung(line) : line);
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

  // Machine-readable ratings for whatever else needs them (run.js's promotion gate reads this
  // rather than parsing the table above, so a formatting change can never silently break it).
  // Keyed by player id, which is basename+depth and therefore stable across snapshot copies and
  // across runs -- that stability is what lets a pool accumulate over a whole training run.
  if (summaryPath) {
    const out = { updated: new Date().toISOString(), players: {} };
    for (const r of rows) {
      const c = boot.ci[r.p.id];
      out.players[r.p.id] = {
        kind: r.p.kind, elo: +r.elo.toFixed(1), games: r.games,
        ...(r.p.kind === 'nn' ? {
          model: r.p.model, depth: r.p.depth, brain: r.p.brain || 'nn',
          dualPolicy: !!r.p.dualPolicy,
          rank: Number.isFinite(r.rank) && !r.edge ? +r.rank.toFixed(2) : null,
          rankLo: c && Number.isFinite(c.lo) ? +c.lo.toFixed(2) : null,
          rankHi: c && Number.isFinite(c.hi) ? +c.hi.toFixed(2) : null,
          rankLoEdge: c && c.loEdge ? c.loEdge : null,
          rankHiEdge: c && c.hiEdge ? c.hiEdge : null,
        } : { level: r.p.level }),
      };
    }
    try {
      atomicWrite(summaryPath, JSON.stringify(out, null, 1));
      console.log(`\nratings written to ${summaryPath}`);
    } catch (e) { console.error(`could not write ${summaryPath} (${e.message})`); }
  }

  const thinCount = rows.filter(r => r.p.kind === 'nn' && r.games < MIN_GAMES).length;
  if (thinCount) console.log(`\n(${thinCount} brains have fewer than ${MIN_GAMES} games and are left ` +
                             `unranked -- re-run --refit later, or let the run finish)`);
  // No more "paste into retromine" footer: retromine.js reads the summary written above directly
  // and builds its strength axis from it, so there is nothing left to hand-carry between the two.
  const above = rows.filter(r => r.p.kind === 'nn' && r.edge === 'above');
  // named after the top rung ACTUALLY USABLE in this fit, not L<LADDER_N>: on a partial-ladder run
  // (--levels 1,2,3) the old wording claimed "above L11" for nets that had merely cleared L3
  const topUsable = ladderElos.length ? ladderElos[ladderElos.length - 1].level : LADDER_N;
  if (above.length)
    console.log(`\n(${above.map(r => r.p.label).join(', ')} rated above L${topUsable}, the top rung in ` +
                `this fit -- no rung to interpolate a ladder rank against, so rank shows ">"; ` +
                `their Elo is still exact)`);
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
// games each NET has played against ladder rungs (rungs' own ids all match L<n>)
const ladderGamesOf = () => {
  const isRung = id => /^L\d+$/.test(id);
  const n = {};
  for (const [key, r] of Object.entries(store.results)) {
    const [a, b] = key.split('|'); const t = r.w + r.l + (r.d || 0);
    if (isRung(a) !== isRung(b)) { const net = isRung(a) ? b : a; n[net] = (n[net] || 0) + t; }
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
let lastCI = null;      // most recent bootstrapped rank intervals, refreshed on a cadence in lane()

// How little is known about this brain, 0..1, where 1 is "no usable opinion at all". The measured
// 90% rank interval is the real quantity; game COUNT is only a proxy for it, and a biased one --
// twelve games against a hopeless opponent are twelve foregone results that barely move the
// interval, yet 1/sqrt(n) would call that brain well measured and stop scheduling it.
// A missing interval (NaN) is the normal reading rather than an error, and covers two cases that
// both genuinely deserve maximum uncertainty: a brain with no games at all, and one rated clean off
// the top of the ladder -- bootstrapRanks only keeps resamples where a net interpolates INSIDE the
// rung scale, so a net stronger than the last rung collects too few samples to have an interval
// (which is why the chart prints ">" for those). Those are exactly the nets most worth more games,
// and a product that propagated NaN would instead drop them silently: NaN fails every comparison,
// so such a pair could never win the argmax below.
const UNC_REF = 1.0;         // rank half-width in rungs that already counts as fully uncertain
const UNC_FLOOR = 0.05;      // a settled brain is still pickable when it is the only legal partner
function uncertaintyOf(p, g) {
  if (p.kind !== 'nn') return 1;                     // rungs are the scale itself, never "done"
  if (!(g[p.id] > 0)) return 1;
  const c = lastCI && lastCI[p.id];
  if (!c || !Number.isFinite(c.lo) || !Number.isFinite(c.hi)) return 1;
  return Math.max(UNC_FLOOR, Math.min(1, ((c.hi - c.lo)/2)/UNC_REF));
}

function pickPair(elo, inFlight) {
  const g = gamesOf(), pg = pairGamesOf(), lg = ladderGamesOf();
  const netElos = players.filter(p=>p.kind==='nn').map(p=>elo[p.id]).filter(Number.isFinite);
  const minE = netElos.length ? Math.min(...netElos) : 0;
  const maxE = netElos.length ? Math.max(...netElos) : 0;
  const span = Math.max(1, maxE-minE);
  // Where this brain sits in the field, 0..1. Elo, NOT the interpolated rank: rankOf clamps and
  // flags anything past the last rung, so rank is undefined for exactly the brains at the top of
  // the field and a rank-based term would go blind right where the interesting nets are.
  // An unrated brain needs no special case: fitBT's regularising prior already leaves it at elo ~0,
  // which on this pool measures out at position 0.448 of the net range against a median of 0.47 --
  // the middle, as it should be. What was wrong was SQUARING it. The square turned that honest
  // middle into 0.32, i.e. it ranked every brand-new entrant near the bottom of a field it had not
  // yet played a single game against, and then used that invented weakness to deprioritise it.
  const standing = p => p.kind !== 'nn' ? 1 :
    strengthExplore + (1-strengthExplore)*Math.max(0, Math.min(1, ((elo[p.id]||0)-minE)/span));
  // One priority function, multiplicative in the two things that matter:
  //   uncertain + strong  -> could be the next champion and nobody knows yet: play these most
  //   confident + strong  }  one half of the question is already settled: worth some games
  //   uncertain + weak    }
  //   confident + weak    -> a known-weak brain with a tight interval: almost never
  // A sum would order those four tiers identically but would never let the last one fall away, since
  // a confidently weak brain would keep banking its uncertainty points forever. The PRODUCT is what
  // makes "almost never" actually rare (~130x between the top and bottom tiers here).
  // Uncertainty adds across the pair -- one game informs both endpoints, so the value is the sum of
  // what each side stands to learn -- while standing is a geometric mean, because a game is only
  // worth watching if BOTH brains are worth watching.
  // The geometric mean is for net-vs-net only. A rung scores standing 1 by definition, so folding it
  // into a sqrt would read as sqrt(standing(net)) and quietly halve the rank signal on exactly the
  // pairs that carry it -- every net-vs-rung anchor game. Measured on the tier simulation: with the
  // sqrt applied throughout, a confidently-strong net drew fewer games than an uncertain weak one;
  // taking the net's own standing on mixed pairs puts the tiers back in the intended order.
  const priority = (a, b) => (uncertaintyOf(a, g) + uncertaintyOf(b, g))*
    (a.kind === 'nn' && b.kind === 'nn' ? Math.sqrt(standing(a)*standing(b))
                                        : standing(a.kind === 'nn' ? a : b));
  // Hard floor, not a preference: while any brain in the field has never played, every pick must
  // involve one. 1/sqrt(1+n) made a first game only ~40% more attractive than a second, which a
  // cheap well-matched pair between two established brains could and did outbid -- so a new entrant
  // could sit at zero games while the pool re-measured what it already knew. Tracked as a separate
  // argmax rather than a filter so it can never deadlock: if no legal pair touches an unplayed
  // brain (a lone rung with no partner within two levels, say), the ordinary best still stands.
  let best = null, bestScore = -Infinity;
  let bestNew = null, bestNewScore = -Infinity;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const k = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
      if (inFlight.has(k)) continue;
      // In focus mode every matchup must involve a focus model -- the rest of the pool is being
      // used as a measuring stick, not re-measured.
      if (focusPaths.length && focusPairsOnly) {
        const inFocus = q => q.kind === 'nn' && focusPaths.includes(path.basename(q.model, '.json'));
        // ...with one exception: an UNDER-MEASURED ladder pair still gets played. The rungs are the
        // scale, and a rank is only as good as the yardstick it is read against -- on a fresh pool
        // there is no chain yet, so pure focus pairing would place the new net against rungs whose
        // own spacing is unknown and emit "?" for everything. Self-limiting: it stops as soon as
        // both rungs have their games, so on an established pool this costs nothing and every
        // subsequent game goes to the model being placed.
        const thinLadder = a.kind === 'ladder' && b.kind === 'ladder' &&
          Math.min(g[a.id] || 0, g[b.id] || 0) < ladderGames;
        if (!inFocus(a) && !inFocus(b) && !thinLadder) continue;
      }
      const bothLadder = a.kind === 'ladder' && b.kind === 'ladder';
      // only ADJACENT-ish ladder pairs are worth playing; L1 vs L11 is as foregone as it gets
      if (bothLadder && Math.abs(a.level - b.level) > 2) continue;
      const pExp = 1/(1 + Math.pow(10, ((elo[b.id] || 0) - (elo[a.id] || 0))/400));
      const closeness = 4*pExp*(1 - pExp);              // 1.0 at even, ->0 at foregone
      const novelty = 1/(1 + (pg[k] || 0)/gamesPerPair);
      const ladderBoost = bothLadder && Math.min(g[a.id] || 0, g[b.id] || 0) < ladderGames ? 3 : 1;
      // net-vs-rung pairs jump the queue while the net is under its anchor quota (<= so a brand-new
      // net starts with rung games rather than earning them later); once the share is banked the
      // boost vanishes and pure information-seeking resumes. 4x outweighs the closeness gap even
      // for a net a few hundred Elo past L11 -- by design, since those are the nets drifting
      // furthest from the anchor.
      const mixed = (a.kind === 'ladder') !== (b.kind === 'ladder');
      let anchorBoost = 1;
      if (mixed && anchorShare > 0) {
        const net = a.kind === 'nn' ? a : b;
        if ((lg[net.id] || 0) <= anchorShare*(g[net.id] || 0)) anchorBoost = 4;
      }
      // Optimise information per CPU minute, not merely per completed game. Uncertain D3 still gets
      // scheduled, but it must justify the ~20x D1 cost instead of silently eating the whole box.
      const cpuCost = Math.sqrt(SIDE_COST(a)+SIDE_COST(b));
      const score = (0.15 + closeness)*priority(a, b)*novelty*ladderBoost*anchorBoost/cpuCost;
      if (score > bestScore) { bestScore = score; best = [a, b]; }
      if ((!(g[a.id] > 0) || !(g[b.id] > 0)) && score > bestNewScore) {
        bestNewScore = score; bestNew = [a, b];
      }
    }
  }
  return bestNew || best;
}

async function main() {
  if (refitOnly) { report(); return; }
  const targetGames = Math.max(1, +arg('targetGames', 12));
  // Stop when every net's rank is known to within this many rungs (90% interval half-width).
  // A rank is used to slot a brain between ladder rungs, so +-0.5 rungs is the point past which
  // extra precision buys nothing downstream -- it already identifies which gap the brain sits in.
  // 0 disables, leaving time/coverage as the only stops.
  const rankTolerance = +arg('rankTolerance', 0.5);
  console.log(`elorank: ${players.length} brains, ${workers} lanes, adaptive pairing ` +
              `(close rating + uncertainty + strength/exploration + CPU cost), ${gamesPerPair} games per matchup`);
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
      if (stop || stopAll || outOfTime()) return;
      const g = gamesOf();
      const mustCover = focusPaths.length && focusPairsOnly
        ? players.filter(p => p.kind === 'nn' && focusPaths.includes(path.basename(p.model, '.json')))
        : players;
      if (mustCover.length && mustCover.every(p => (g[p.id] || 0) >= targetGames)) { stop = true; return; }
      // Confidence check, but only once there is enough data for the answer to be meaningful --
      // bootstrapping a nearly-empty store would report absurd precision on brains that have simply
      // never been separated. Checked on a cadence rather than every pair: it costs ~1s against
      // games that take minutes, but there is no reason to pay it on every single result.
      // The intervals now drive BOTH the stopping rule and the pairing priority, so refresh them
      // whenever ANY brain has real data rather than only once every brain does -- otherwise the
      // scheduler runs on flat maximum uncertainty for the whole early phase, which is precisely
      // when the new entrants it is supposed to be placing are arriving. The stop check keeps its
      // stricter gate: an early stop must not be trusted to a bootstrap over a nearly-empty store.
      if (checksSinceBoot++ >= workers && players.some(p => (g[p.id] || 0) >= 6)) {
        checksSinceBoot = 0;
        const { ci } = bootstrapRanks(80);
        lastCI = ci;
        if (rankTolerance > 0 && mustCover.every(p => (g[p.id] || 0) >= 6)) {
          const worst = worstRankHalfWidth(ci);
          globalThis.__lastWorst = worst;
          if (worst <= rankTolerance) {
            console.log(`\nevery net's rank now known to +-${worst.toFixed(2)} rungs ` +
                        `(target ${rankTolerance}) -- stopping`);
            stop = true; return;
          }
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
