// Generate labeled training positions. Every turn records the mover's feature vector; when the
// game ends, every position gets labeled with the outcome from its mover's perspective
// (+1 the mover went on to win, -1 they lost), optionally discounted toward 0 for positions far
// from the end. Sparring is a mix: ladder-vs-ladder games (bulk from the fast levels, a garnish
// of deep ones) and, once a model exists, NN-vs-ladder and NN-vs-NN games with exploration
// temperature so the net sees its own play. Every NN move within a game also comes from one
// randomly-picked search depth for that whole game (--nnDepthMix), mostly cheap 1-ply for volume
// with a rare deeper-searched game to teach the net about positions a greedy pass blunders into.
//
//   node nn/selfplay.js --games 200 --out nn/data/run1.jsonl [--model nn/models/best.json]
//                       [--levels 2,3,4,5,6] [--deep 7,8] [--deepEvery 12] [--discount 0.995]
//                       [--nnDepthMix 1:60,2:30,3:10] [--openingPlies 2]
//                       [--mix nnnn:0.4,nnladder:0.3,ladder:0.3]
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { features } = require('./features.js');
const { MLP } = require('./net.js');
const { DualMLP } = require('./dualnet.js');
const { nnPlanFor } = require('./nnai.js');
const { playRandomOpening, randomStartPose } = require('./opening.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

// Tags every row this PROCESS writes, so train.js can tell which positions came from the same game
// (see the `g` field below). Has to be unique per process, not per worker index: the parallel
// workers write part files that get merged into one iteration file, and train.js then loads EVERY
// iteration file at once -- so a plain "worker 3, game 7" would collide both across workers and
// across iterations, silently fusing unrelated games into one id.
const RUN_TAG = Math.random().toString(36).slice(2, 8) + process.pid.toString(36);

// Reservoir-sample k stored decision points from the accumulated data files -- every row carries
// the raw pose (`p`) and mover (`m`) precisely so positions can be reused later without replaying
// anything. One uniform pass over all rows, O(k) memory, so this stays cheap no matter how many
// iterations have accumulated. Rows without a pose (old formats, synthetic fixtures) are skipped.
function loadSeedPoses(dataDir, k) {
  const pool = [];
  let seen = 0, files = [];
  try { files = fs.readdirSync(dataDir).filter(f => f.endsWith('.jsonl')); } catch (e) { return pool; }
  for (const f of files) {
    let txt;
    try { txt = fs.readFileSync(path.join(dataDir, f), 'utf8'); } catch (e) { continue; }
    for (const line of txt.split('\n')) {
      if (!line) continue;
      try {
        const j = JSON.parse(line);
        if (!j.p || j.p.length !== 6 || (j.m !== 0 && j.m !== 1)) continue;
        seen++;
        if (pool.length < k) pool.push({ p: j.p, m: j.m });
        else { const r = Math.floor(Math.random()*seen); if (r < k) pool[r] = { p: j.p, m: j.m }; }
      } catch (e) {}
    }
  }
  return pool;
}

// --- repetition guard -------------------------------------------------------------------------
// Two brains can lock into a sterile oscillation: measured on batch-008, one L11-vs-L9 game spent
// 5h52m of a worker replaying an exact 4-ply loop 73 times, having reached only 14 distinct
// positions in 300 plies. It ended winner:null, so the entire cost bought no rating signal and no
// usable label. Three of the four capped games in that batch were this shape.
//
// The guard is deliberately NOT a change to Tau's rules -- it is the same kind of data-collection
// abandon the `nulls > 4` wedge check above already performs. A real rules change was considered
// and rejected on evidence: a ban on repeating a pose fires on ~3% of games that ended in a normal
// win, so enforcing it in the engine would alter legitimate play, not just degenerate play.
//
// Contact resets the memory, which is what keeps the guard off real games: two pieces pushing each
// other legitimately revisit positions, and that is a fight, not a stall.
//
// Contact is detected exactly, with no geometry: a turn pins one foot and swings the piece about
// it, so a clean move displaces ONLY the mover. If the opponent's pose also changed, the swing
// drove into them and the contact solver pushed them -- 2 of 6 feet move on a clean swing, 5 of 6
// when there was a push. `g.contact` cannot serve here (clearTurn() nulls it before the next ply),
// but the displacement is right there in the pieces.
//
// This matters more than it sounds: Tau is a contact game -- measured over 20328 recorded moves,
// the opponent is displaced on 66% of them, because the ladder's own plan is to swing TOWARD the
// other piece. An earlier version of this guard approximated contact by leg proximity, badly
// under-counted it, and consequently fired on 32 games that ended in a normal win. With contact
// read off the pose instead, the same dry run over all 1044 games in batch-008 fires on ZERO of
// the 1040 normal games while still catching 3 of the 4 capped ones.
const REP_ROT = 2*Math.PI/180;   // engine's own minMoveDeg: below this is not a distinct move
const REP_HUB = 0.25;            // ~a third of the hub travel one 2-degree swing produces
const PUSH_EPS = 0.01;           // opponent displacement that counts as having been pushed
function samePose(a, b) {
  let dr = Math.abs(a.rot - b.rot) % (2*Math.PI);
  dr = Math.min(dr, 2*Math.PI - dr);
  return dr < REP_ROT && Math.hypot(a.x - b.x, a.y - b.y) < REP_HUB;
}

function playGame(eng, brainA, brainB, maxPlies, openingPlies, seedPose, randomStart, opts) {
  // repeatGuard: how many times a side may re-occupy a pose (with no contact since) before the
  // game is abandoned. This is now a BACKSTOP, not the mechanism: ko lives in the engine (CFG.koRule)
  // and makes the loop illegal in the first place. It still earns its keep for the one case the rule
  // can't cover -- koLegalizePlan scans +-48 degrees of the chosen arc for a legal stopping point and
  // gives up if the whole arc is banned, at which point the banned pose gets played anyway and the
  // stall is back. 0 disables.
  const repeatGuard = Math.max(0, (opts && +opts.repeatGuard) || 0);
  const seenPose = [[], []];
  let lastPose = null, lastMover = -1;
  // One cap, shared: the engine adjudicates at CFG.moveCap (see the komi rule in index.html), and
  // this loop stops at maxPlies. Two different numbers would mean a game cut short by the loop with
  // no result at all, so the caller's cap wins and the engine scores it.
  eng.CFG.moveCap = maxPlies;
  eng.newGame();
  if (seedPose) {
    // Start from a stored mid-game decision point instead of the standard opening (see --seedFrom
    // below). Every data row carries the raw pose (`p`) and whose turn it was (`m`), and a pose
    // that came through the real rules is guaranteed to be a consistent game state -- the one
    // caveat is history that lives outside the pose (the turn-start grace for a foot already
    // parked on a line), which a restore can't reproduce; rare enough to accept.
    const g = eng.getG(), sp = seedPose.p;
    g.pieces[0].x = sp[0]; g.pieces[0].y = sp[1]; g.pieces[0].rot = sp[2];
    g.pieces[1].x = sp[3]; g.pieces[1].y = sp[4]; g.pieces[1].rot = sp[5];
    eng.setActive(seedPose.m);
  } else if (randomStart) {
    // See opening.js's randomStartPose: a legal but otherwise unconstrained pose, not a few real
    // plies away from the canonical start -- for coverage of shapes self-play's own trajectories
    // would never produce (see --randomStartFrac).
    randomStartPose(eng);
    eng.setActive(Math.random() < 0.5 ? 0 : 1);
  } else {
    // Without this, a deterministic-ish ladder pairing (L8-L11 have little to no built-in
    // randomness) replays close to the same line every time it recurs -- "heaps of games" would
    // really be a handful of distinct games repeated, not a genuinely large sample. arena.js and
    // tournament.js already do this for exactly this reason; selfplay.js had quietly skipped it.
    playRandomOpening(eng, openingPlies);
  }
  // Every branch above establishes the position the game really starts from -- a stored decision
  // point, an unconstrained legal pose, or a few random opening plies -- so the ko history is seeded
  // from THAT, not from the canonical opening newGame() left behind. (The random-opening branch
  // plays real turns, so its history is already right; re-seeding it deliberately drops the opening
  // plies too, since a game seeded mid-opening is not being asked to avoid repeating them.)
  eng.koReset();
  const rows = [];
  let plies = 0, nulls = 0, repeated = false;
  while (!eng.getG().over && plies < maxPlies) {
    const idx = eng.getG().active;
    if (repeatGuard > 0) {
      const ps = eng.getG().pieces;
      // Did the PREVIOUS ply push someone? If the side that wasn't moving got displaced, that was
      // contact, and both memories are wiped: revisiting a position after a push is a fight
      // resuming, not a stall repeating.
      if (lastPose) {
        const o = 1 - lastMover;
        if (Math.hypot(ps[o].x - lastPose[o].x, ps[o].y - lastPose[o].y) > PUSH_EPS) {
          seenPose[0].length = 0; seenPose[1].length = 0;
        }
      }
      lastPose = [{ x: ps[0].x, y: ps[0].y }, { x: ps[1].x, y: ps[1].y }];
      lastMover = idx;
      const here = { x: ps[idx].x, y: ps[idx].y, rot: ps[idx].rot };
      const hit = seenPose[idx].find(q => samePose(q, here));
      if (hit) {
        if (++hit.n > repeatGuard) { repeated = true; break; }
      } else seenPose[idx].push({ ...here, n: 1 });
    }
    // The raw pose rides along with the feature vector. Rows used to store ONLY the features, so
    // when the feature set changed every accumulated position died with it (~8 hours of compute the
    // first time). With the position kept, any future feature change is a re-featurise of existing
    // data rather than a fresh collection run. train.js ignores `p`; it is pure insurance.
    const ps = eng.getG().pieces;
    rows.push({ f: features(eng), mover: idx,
                p: [ps[0].x, ps[0].y, ps[0].rot, ps[1].x, ps[1].y, ps[1].rot] });
    const plan = (idx === 0 ? brainA : brainB)(idx);
    if (!plan) {
      rows.pop();
      nulls++;
      if (nulls > 4) break;                        // both wedged — abandon as a draw
      eng.clearTurn(); eng.setActive(1 - idx);
      continue;
    }
    nulls = 0;
    eng.applyPlan(plan);
    plies++;
  }
  const G = eng.getG();
  // capped distinguishes a REAL draw (the ply limit ran out -- a fortress/shuffle stalemate) from
  // a wedged abandon (both sides null-planned; those rows describe a degenerate stuck state and
  // stay excluded from the data, as before).
  // `repeated` is a third outcome alongside a real cap and a wedge abandon: the position cycled with
  // no contact to break it. Reported separately so a run can tell "the brains stalled" apart from
  // "the game genuinely ran long", which the plies count alone cannot distinguish.
  // `adjudicated` is a REAL winner, but one the komi rule scored off the position at the cap rather
  // than one that pushed the other piece off the board -- worth CFG.komiLoss of a win, not all of it.
  return { rows, winner: G.over ? G.winner : null, plies,
           capped: plies >= maxPlies, repeated, adjudicated: !!G.adjudicated };
}

function main() {
  const games = +arg('games', 100);
  const out = arg('out', path.join(__dirname, 'data', 'selfplay.jsonl'));
  const modelPath = arg('model', path.join(__dirname, 'models', 'best.json'));
  const levels = arg('levels', '2,3,4,5,6').split(',').map(Number);   // 1-based ladder levels
  // the deep pool now reaches the top of the ladder: L9-11 search ~every 9° of the real swing, so
  // they find (and punish) the subtle stops that self-play alone can never surface — both sides
  // of an nn-vs-nn game share the same search, so neither can expose the other's blind spots.
  // Deep games are slow (L9-11 are multi-second-per-move brains); deepEvery keeps them a garnish.
  const deep = arg('deep', '7,8,9,10,11').split(',').map(Number);
  const deepEvery = +arg('deepEvery', 12);
  const discount = +arg('discount', 0.995);
  const temperature = +arg('temperature', 0.08);
  // 4, up from 2: these are RANDOM legal plies both sides play before the brains take over, purely
  // so games start from different positions -- not lookahead, and unlike temperature (which noises
  // EVERY move) the play after the scramble stays clean, so labels stay clean. At 2 plies the
  // mostly-deterministic brains still funnelled into repeated trajectories, and duplicated lines
  // in the data quietly multiply the effective epochs on them -- the same overfitting the
  // iteration-63 bake-off caught, fed from the data side. arena.js keeps its own default of 2;
  // this is a data-diversity dial, not an evaluation setting.
  const openingPlies = +arg('openingPlies', 4);
  // This fraction of games starts from a fully random LEGAL pose (see opening.js's
  // randomStartPose) instead of the canonical start -- coverage far outside anything a real
  // trajectory reaches, e.g. a piece hard against the rim with the opponent clear across the
  // board. Small by default: an unconstrained random pose is a much rougher training signal per
  // game than a near-canonical one (it can hand either side an immediate tactical decision no
  // real game would present), so this is a deliberate minority slice, not a replacement for
  // openingPlies. Rows from these games carry src:'random' so the effect can be measured in
  // isolation later rather than taken on faith.
  const randomStartFrac = +arg('randomStartFrac', 0);
  // --eloInbox: append one rating record per CLEAN game to elorank.js's append-only inbox, so a
  // self-play batch contributes to the rating pool instead of only to training data. Every game
  // here already knows both sides' pool ids (see nnIdAt/idA/idB below -- deliberately in elorank's
  // own `wide@D2`/`L7` namespace), and elorank already drains this exact file for the ladder
  // sweep's results, so this is wiring up evidence that was being computed and thrown away: ~1000
  // real games a batch, with real outcomes, that the pool was separately paying arena time to
  // re-answer. Append-only, one line per game, no read-modify-write -- which is precisely the
  // concurrency elorank's own inbox comment says the format is safe under, and it has to be here
  // because N worker processes write it at once.
  //
  // CLEAN means standard opening only. Seeded and random-start games are excluded on purpose and
  // this is the load-bearing filter: a stored decision point can already be won or lost before
  // either side moves, so its outcome measures which side drew the good position, not which brain
  // is stronger -- feeding those in would bias every rating by seat luck. Their training rows are
  // unaffected; only their rating evidence is dropped.
  const eloInbox = arg('eloInbox', null);
  // Extra candidate nets besides --model (the "primary"). Point of this: an nnnn game with BOTH
  // sides tied to the one loaded net is self-play in the narrow sense even when --model itself
  // occasionally points somewhere other than best.json -- both sides still share the exact same
  // weights, just not best.json's. --modelPool gives EACH SIDE of EACH nn-involving game its own
  // independent roll into a wider set, so an nnnn game can genuinely be two DIFFERENT
  // architectures facing off, not one architecture facing itself under an alias.
  const modelPoolPaths = (arg('modelPool', '') || '').split(',').map(s => s.trim()).filter(Boolean);
  // run.js derives one positive sampling weight per frozen candidate from the SAME fitted Elo
  // summary that decides promotion and retirement.  It is intentionally only a bias, not a hard
  // gate: high-ranked, tightly-measured models should shape more of the corpus, while an uncertain
  // entrant must still draw enough ordinary games for the Elo scheduler to resolve it.
  let modelPoolWeights = {};
  try {
    const parsed = JSON.parse(arg('modelPoolWeights', '{}'));
    if (parsed && typeof parsed === 'object') modelPoolWeights = parsed;
  } catch (e) {}
  // Optional per-model depths.  The medal worker uses this because gold/silver/bronze can earn their
  // overall places at DIFFERENT depths.  Without a map, the normal nnDepthMix behavior is unchanged.
  // With one, a sampled model keeps the depth of the rated face that earned its selection instead of
  // borrowing whichever lane happened to pick it.
  let modelPoolDepths = {};
  try {
    const parsed = JSON.parse(arg('modelPoolDepths', '{}'));
    if (parsed && typeof parsed === 'object') modelPoolDepths = parsed;
  } catch (e) {}
  let coverageQueue = [];
  try {
    const parsed = JSON.parse(arg('coverageQueue', '[]'));
    if (Array.isArray(parsed)) coverageQueue = parsed;
  } catch (e) {}
  let coverageA = null, coverageB = null;
  try { coverageA = JSON.parse(arg('coverageA', 'null')); } catch (e) {}
  try { coverageB = JSON.parse(arg('coverageB', 'null')); } catch (e) {}
  const modelVarietyFrac = Math.max(0, Math.min(1, +arg('modelVarietyFrac', 0.2)));
  // The in-game ply cap. Exposed as an arg mostly so tests can force cap-draws cheaply.
  const maxPlies = +arg('maxPlies', 300);
  // --repeatGuard N: abandon a game once a side has re-occupied the same pose N+1 times with no
  // contact in between. Now a backstop behind the engine's ko rule rather than the mechanism (see
  // the guard above playGame) -- on by default at 2, which dry-ran over all 6592 recorded games that
  // ended in a win without firing once, while still catching the stalls. 0 = off.
  const repeatGuard = +arg('repeatGuard', 2);
  // --seedFrom F: this fraction of games starts from a STORED mid-game position (drawn from the
  // accumulated data's `p` poses) instead of the standard opening, with the normal brains playing
  // it out to a real result. Point: outcome labels are cleanest near the end of a game and
  // noisiest in the middle ("who blundered last"), and ordinary games only reach a given mid-game
  // position after spending the plies to get there. Seeding starts play AT such positions, so
  // label-quality games (especially the deep-ladder garnish -- expert play) concentrate exactly
  // where the data is weakest. Stored poses rather than uniform-random ones: they came through the
  // real rules (state bookkeeping consistent), they follow the distribution the net is actually
  // asked about, and they're already on disk. 0 disables; ignored until enough tagged data exists.
  const seedFrom = Math.max(0, Math.min(1, +arg('seedFrom', 0.25)));
  const seedPoolFile = arg('seedPool', null);
  // Real lookahead (nnai.js's `depth`) measurably strengthens play (a same-net depth-2 vs depth-1
  // A/B went 19-5) but costs roughly keepForDepth x per extra ply (measured ~5.6x for depth 2, ~20x
  // for depth 3), so depth 5 everywhere would be a ~300x non-starter for bulk data generation.
  // Picked once per game (not per move) so a game's moves come from one consistent brain strength.
  //
  // Why this leans deep rather than cheap: a capacity probe on 101k real positions showed 3.5x the
  // parameters (64,64 -> 128,128) buying only +0.8 sign-acc, with the WIDE net's train mse no lower
  // than the small one's -- and every configuration tried (5.3k params, 18.6k params, 8 epochs, 27
  // accumulated iterations) landing between 68.8% and 71.0%. A ceiling that ignores capacity and
  // training time that completely is a LABEL ceiling: z is "who won this game", and in mostly-greedy
  // self-play that outcome is too often decided by whoever blundered last rather than by whose
  // position was better. Deeper search is what actually cleans those labels, so it's worth real
  // throughput -- an earlier 1:90,2:8,3:2 split optimised volume, which the probe says is not the
  // binding constraint.
  // Weights decay by 1/3.6 per ply -- deliberately matched to how fast COST grows per ply (5.6x
  // measured at depth 2, 20x at depth 3, i.e. ~3.57x each). Matching the two means every depth
  // bucket costs the same total compute (~1.1 units each, 5.16x overall, only 1.21x the old
  // 60/30/10 mix) while still reaching depth 5 occasionally. A gentler decay inverts that: a 2/3
  // law would put 8% of games at depth 5 and 59% of all compute there.
  const nnDepthMix = arg('nnDepthMix', '1:1,2:0.278,3:0.077,4:0.021,5:0.006').split(',').map(s => {
    const [d, w] = s.split(':').map(Number); return { depth: d, weight: w };
  });
  const pickNnDepth = () => {
    const total = nnDepthMix.reduce((a, b) => a + b.weight, 0);
    let r = Math.random()*total;
    for (const { depth, weight } of nnDepthMix) { r -= weight; if (r <= 0) return depth; }
    return nnDepthMix[0].depth;
  };
  // Once a model exists, these three weights (normalised, needn't sum to 1) decide EACH game
  // independently. Replaces a nested selfRatio coinflip that quietly meant something different from
  // what it sounded like: nn-vs-nn scaled as selfRatio^2 while nn-vs-ladder only scaled as
  // selfRatio*(1-selfRatio), so "selfRatio 0.85" produced 72% nn-vs-nn and a SHRINKING 13%
  // nn-vs-ladder (that term peaks at selfRatio 0.5, not 1) -- not the ~85%-self split the number
  // suggested. Heavy nn-vs-nn is exactly the self-referential-narrowing risk a round robin caught
  // (real playing strength peaked iterations 11-13 and drifted through 14-20 while this ratio sat
  // completely flat at its 0.85 cap the entire time -- ladder brains don't drift with the net, so
  // giving them a real share is what keeps the training data from being graded by the same student
  // whose answers are being checked).
  const mix = arg('mix', 'nnnn:0.4,nnladder:0.3,ladder:0.3').split(',').reduce((o, s) => {
    const [k, v] = s.split(':'); o[k] = +v; return o;
  }, {});
  const mixTotal = mix.nnnn + mix.nnladder + mix.ladder;
  const pickMix = () => {
    let r = Math.random()*mixTotal;
    if ((r -= mix.nnnn) <= 0) return 'nnnn';
    if ((r -= mix.nnladder) <= 0) return 'nnladder';
    return 'ladder';
  };
  const workers = Math.max(1, Math.floor(+arg('workers', 1)));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // Parallel mode: hand games out to a fixed number of concurrent LANES as small tasks, each lane
  // pulling the next one the moment it's free, then stitch every part-file together at the end.
  // NOT a static N/workers split: game length varies hugely (a 6-ply game next to a 274-ply
  // marathon is routine), so a fixed upfront split means whichever lane draws the long ones keeps
  // running alone while every other lane sits idle -- measured directly on a real run: one lane
  // finished its batch in 160s while another was still going at 547s, so for a third of the
  // iteration only 1 of 8 lanes was doing anything. A pull-based pool fixes that: a lane that
  // finishes early immediately grabs the next unplayed game instead of idling.
  if (workers > 1) {
    const { fork } = require('child_process');
    const t0 = Date.now();
    // Sample the seed-pose pool ONCE in the parent and hand workers a small file, instead of every
    // worker re-reading the whole accumulated dataset (which grows forever) just to draw a few
    // hundred poses. Under ~50 usable poses, seeding is skipped for this run -- a tiny pool would
    // just replay the same handful of positions with deterministic ladder brains.
    let seedFile = null;
    if (seedFrom > 0) {
      const pool = loadSeedPoses(path.join(__dirname, 'data'), 400);
      if (pool.length >= 50) {
        seedFile = out + '.seeds';
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(seedFile, JSON.stringify(pool));
        console.log(`seeding ~${Math.round(seedFrom*100)}% of games from ${pool.length} stored positions`);
      }
    }
    // Chunk size per forked task -- 1 by default (finest-grained load balancing, and fork overhead
    // is nothing next to a game that takes tens of seconds to several minutes). Exposed in case a
    // future workload is many very short games, where per-process overhead could actually matter.
    const gamesPerTask = Math.max(1, Math.floor(+arg('gamesPerTask', 1)));
    const childArgs = (n, part, coverA, coverB) => ['--games', String(n), '--out', part, '--model', modelPath,
      '--levels', levels.join(','), '--deep', deep.join(','), '--deepEvery', String(deepEvery),
      '--discount', String(discount), '--temperature', String(temperature),
      '--mix', Object.entries(mix).map(([k, v]) => k + ':' + v).join(','),
      '--openingPlies', String(openingPlies), '--maxPlies', String(maxPlies),
      '--randomStartFrac', String(randomStartFrac), '--repeatGuard', String(repeatGuard),
      ...(seedFile ? ['--seedFrom', String(seedFrom), '--seedPool', seedFile] : ['--seedFrom', '0']),
      '--nnDepthMix', nnDepthMix.map(m => m.depth + ':' + m.weight).join(','),
      ...(modelPoolPaths.length ? ['--modelPool', modelPoolPaths.join(',')] : []),
      '--modelPoolWeights', JSON.stringify(modelPoolWeights),
      '--modelPoolDepths', JSON.stringify(modelPoolDepths),
      ...(coverA ? ['--coverageA', JSON.stringify(coverA)] : []),
      ...(coverB ? ['--coverageB', JSON.stringify(coverB)] : []),
      // Every worker appends to the SAME inbox file. Safe for the reason elorank's own inbox
      // comment gives: one whole line per append, never a read-modify-write.
      ...(eloInbox ? ['--eloInbox', eloInbox] : []),
      '--modelVarietyFrac', String(modelVarietyFrac)];
    let taskIdx = 0;
    // The output stream is opened ONCE, up front, and each task appends to it the moment its own
    // part file lands -- not batched into one merge after every requested game has finished. That
    // merge-at-the-end shape was fine at 30 games (a couple of minutes' difference); it breaks
    // outright for a run.js that now hands this a batch in the hundreds or thousands, since it
    // means NOTHING reaches disk -- no training data, nothing to push -- until the very last of
    // however many thousand games finishes, hours after the first one did. Positions must be
    // available as they're produced, or a big batch stops being "more data, sooner" and becomes
    // "no data for a very long time, then all of it at once."
    const ws = fs.createWriteStream(out, { flags: 'a' });
    let positions = 0, gamesDone = 0;
    // Resolves once the CHILD EXITS, success or failure alike -- same as the old code's plain
    // exit listener. A crashed task just leaves its part file missing/short, tolerated below same
    // as before; one bad game must never hang the whole pool.
    const runTask = (n, laneNum) => new Promise(resolve => {
      const part = out + '.w' + (taskIdx++);
      // Reserve coverage entries when DISPATCHING, not when a game finishes. That makes the first
      // wave cover everyone even with 14 concurrent lanes; two entries share one clean game.
      const coverA = coverageQueue.shift() || null;
      const coverB = coverageQueue.shift() || null;
      try { fs.unlinkSync(part); } catch (e) {}
      const ch = fork(__filename, childArgs(n, part, coverA, coverB),
        { env: Object.assign({}, process.env, { TAU_WORKER: String(laneNum + 1) }) });
      const finish = () => {
        if (fs.existsSync(part)) {
          const d = fs.readFileSync(part, 'utf8');
          ws.write(d); positions += d.split('\n').filter(Boolean).length; gamesDone += n;
          // a transient Windows file lock (antivirus/indexing) on a just-closed part file must
          // never abort this loop -- the data is already safely appended to `out` above, so a
          // leftover .w<n> file is just clutter, not a correctness problem.
          try { fs.unlinkSync(part); }
          catch (e) { console.warn(`warning: couldn't remove temp file ${part} (${e.message}) -- safe to delete by hand`); }
        }
        resolve();
      };
      ch.on('error', finish);
      ch.on('exit', finish);
    });
    const laneCount = Math.min(workers, Math.ceil(games/gamesPerTask));
    async function lane(laneNum) {
      while (remaining > 0) {
        const n = Math.min(gamesPerTask, remaining);
        remaining -= n;
        await runTask(n, laneNum);
      }
    }
    let remaining = games;
    console.log(`running ${games} games across ${laneCount} lane(s), ${gamesPerTask} game(s)/task` +
                (coverageQueue.length ? `; ${coverageQueue.length} first-coverage face(s) queued` : ''));
    Promise.all(Array.from({ length: laneCount }, (_, i) => lane(i))).then(() => {
      if (seedFile) { try { fs.unlinkSync(seedFile); } catch (e) {} }
      ws.end(() => console.log(`all ${games} games done: ${positions} positions -> ${out} ` +
                               `(${((Date.now() - t0)/1000).toFixed(0)}s)`));
    });
    return;
  }

  const TAG = process.env.TAU_WORKER ? `[w${process.env.TAU_WORKER}] ` : '';
  const eng = createEngine();
  let net = null;
  if (fs.existsSync(modelPath)) {
    net = MLP.fromJSON(JSON.parse(fs.readFileSync(modelPath, 'utf8')));
    if (!TAG) console.log('sparring with model:', modelPath);
  }
  const ladderBrain = lvl => idx => eng.ladderPlanFor(lvl - 1, idx);
  const pick = a => a[Math.floor(Math.random()*a.length)];

  // Every candidate net, loaded ONCE up front -- these are ~350KB+ JSON files, and a batch plays
  // thousands of games, so re-parsing one per game would be real, pointless overhead. Index 0 is
  // always the primary (--model); the rest are --modelPool, each independently a candidate for
  // EITHER side of a game.
  const netPool = net ? [{ name: path.basename(modelPath, '.json'), net }] : [];
  for (const p of modelPoolPaths) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      // A dual export is a different object needing a different loader: one shared trunk with 23
      // outputs (value + policy logits) where a value net has one. MLP.fromJSON would accept the
      // weights and quietly play nonsense rather than throw, so the flag the exporter writes is
      // what decides -- the same test elorank.js uses, for the same reason.
      if (raw.dual === true) netPool.push({ name: path.basename(p, '.json'), dual: DualMLP.fromJSON(raw) });
      else netPool.push({ name: path.basename(p, '.json'), net: MLP.fromJSON(raw) });
    } catch (e) {}
  }
  // One independent roll per SIDE (not per game, not per batch).  A complete weight map means
  // run.js has supplied the ONE shared Elo pool: primary best.json and every extra candidate are
  // peers, so every seat is drawn from all of them.  With no map (standalone selfplay and the
  // spare-machine factory), retain the older primary-plus-minority-variety behaviour.
  const pickWeighted = choices => {
    const weights = choices.map(m => {
      const w = +modelPoolWeights[m.name];
      return Number.isFinite(w) && w > 0 ? w : 1;
    });
    let r = Math.random()*weights.reduce((s, w) => s + w, 0);
    for (let i = 0; i < choices.length; i++) { r -= weights[i]; if (r <= 0) return choices[i]; }
    return choices[choices.length - 1];
  };
  const haveSharedWeights = netPool.length > 0 && netPool.every(m => {
    const w = +modelPoolWeights[m.name];
    return Number.isFinite(w) && w > 0;
  });
  const pickNet = haveSharedWeights
    ? () => pickWeighted(netPool)
    : () => (netPool.length > 1 && Math.random() < modelVarietyFrac)
      ? pickWeighted(netPool.slice(1)) : netPool[0];

  // Seed-pose pool: workers get a pre-sampled file from the parent; a direct single-process run
  // samples for itself. Same <50 floor as the parent, same reason.
  let seedPool = [];
  if (seedFrom > 0) {
    if (seedPoolFile) { try { seedPool = JSON.parse(fs.readFileSync(seedPoolFile, 'utf8')); } catch (e) {} }
    else {
      seedPool = loadSeedPoses(path.join(__dirname, 'data'), 400);
      if (seedPool.length < 50) seedPool = [];
      else if (!TAG) console.log(`seeding ~${Math.round(seedFrom*100)}% of games from ${seedPool.length} stored positions`);
    }
  }

  // SYNCHRONOUS appends, not createWriteStream. createWriteStream opens the file asynchronously and
  // flushes on the event loop -- but the game loop below is fully synchronous CPU-bound search that
  // never yields, so the open callback never runs, the file is never even CREATED, and every row
  // sits in memory until the last requested game finishes. Invisible when a caller asks for one
  // game per process (run.js's fork children exit after each game, which drains everything), fatal
  // for worker.js's lanes, which ask for a whole chunk in one process: 11 lanes reported "no data
  // on disk yet" for the entire chunk, and closing the window would have silently thrown away every
  // game played -- while the console promised "finished games are already saved". Sync appends land
  // DURING the loop, which is the only thing that makes incremental progress real here.
  fs.writeFileSync(out, '', { flag: 'a' });     // exists from the start, even before game 1 ends
  let pending = '';
  const ws = {
    write(s) { pending += s; },
    flush() { if (pending) { fs.appendFileSync(out, pending); pending = ''; } },
    end() { this.flush(); },
  };
  let positions = 0, decided = 0, adjudged = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    let brainA, brainB, tag;
    let idA = null, idB = null;
    const useDeep = deepEvery > 0 && g % deepEvery === deepEvery - 1;
    // A fresh independent roll per side, per game -- see pickNet's own note. chosenA and chosenB
    // can land on the same net (most likely, when neither rolls into the pool) or two genuinely
    // different architectures.
    const forcedA = g === 0 && coverageA && netPool.find(m => m.name === coverageA.name);
    const forcedB = g === 0 && coverageB && netPool.find(m => m.name === coverageB.name);
    const chosenA = forcedA || pickNet(), chosenB = forcedB || pickNet();
    // Each side normally draws its own depth from nnDepthMix.  A caller may instead pin a model to
    // the depth of its measured face (medal worker), and first-coverage metadata wins over both so a
    // queued D2 face cannot accidentally come back as yet another D1 game.
    const depthFor = (chosen, cover) => {
      const cd=cover&&+cover.depth;if(Number.isFinite(cd)&&cd>=1)return Math.floor(cd);
      const md=chosen&&+modelPoolDepths[chosen.name];
      return Number.isFinite(md)&&md>=1?Math.floor(md):pickNnDepth();
    };
    const depthA = depthFor(chosenA, forcedA ? coverageA : null);
    const depthB = depthFor(chosenB, forcedB ? coverageB : null);
    // A dual entrant plays as one of the SAME TWO brains elorank.js rates it as: bare (the jointly
    // trained value head alone, directly comparable to an `nn:` net) and +P (also spending its own
    // policy logits on arm ordering under the ab cutoff -- elorank's `ab: true` face). Rolled per
    // side per game so both faces accumulate real games, and the id records which one played:
    // pooling them under one id would destroy the fusion ablation, which is the entire reason a
    // dual file carries two identities instead of one.
    const usePA = !!chosenA.dual && (forcedA ? coverageA.face === 'policy' : Math.random() < 0.5);
    const usePB = !!chosenB.dual && (forcedB ? coverageB.face === 'policy' : Math.random() < 0.5);
    const nnBrainAt = (d, chosen, useP) => chosen.dual
      ? idx => nnPlanFor(eng, null, idx, { temperature, depth: d, dual: chosen.dual,
                                           dualPolicy: !!useP, abCut: !!useP, policyPrune: false })
      : idx => nnPlanFor(eng, chosen.net, idx, { temperature, depth: d });
    const nnTagAt = (d, chosen, useP) =>
      (chosen && chosen.dual ? 'dual' + (useP ? '+P' : '') : 'nn') + (d > 1 ? '(D' + d + ')' : '');
    // The rating-pool id of each side, in the SAME namespace elorank.js uses (`best@D2`, `L7`), so
    // a row can be joined against the pool later. The id is stored rather than the rating itself:
    // ratings are estimates that keep improving, and a row that carries an id picks up every future
    // improvement to its mover's rating for free, where a row carrying a number is frozen at
    // whatever we believed the day it was played. Now carries WHICH net this side actually drew,
    // not just the batch's primary -- a variety pick shows up as "wide@D2", never misattributed.
    const nnIdAt = (d, chosen, useP) => `${chosen.name}${chosen.dual && useP ? '+P' : ''}@D${d}`;
    const coverageGame = !!(forcedA || forcedB);
    const kind = coverageGame ? 'nnnn' : net ? pickMix() : 'ladder';
    if (kind === 'nnnn') {
      brainA = nnBrainAt(depthA, chosenA, usePA); brainB = nnBrainAt(depthB, chosenB, usePB);
      tag = nnTagAt(depthA, chosenA, usePA) + ' vs ' + nnTagAt(depthB, chosenB, usePB);
      idA = nnIdAt(depthA, chosenA, usePA); idB = nnIdAt(depthB, chosenB, usePB);
    } else if (kind === 'nnladder') {
      const lvl = useDeep ? pick(deep) : pick(levels);
      if (Math.random() < 0.5) { brainA = nnBrainAt(depthA, chosenA, usePA); brainB = ladderBrain(lvl); tag = nnTagAt(depthA, chosenA, usePA) + ' vs L' + lvl; idA = nnIdAt(depthA, chosenA, usePA); idB = `L${lvl}`; }
      else { brainA = ladderBrain(lvl); brainB = nnBrainAt(depthA, chosenA, usePA); tag = 'L' + lvl + ' vs ' + nnTagAt(depthA, chosenA, usePA); idA = `L${lvl}`; idB = nnIdAt(depthA, chosenA, usePA); }
    } else {
      // Each SIDE independently rolls whether it draws from the deep pool during a garnish slot,
      // rather than both sides being forced into the same pool -- the old code could only ever
      // produce shallow-vs-shallow or deep-vs-deep, never a deliberately mismatched "L3 vs L10".
      // Cross-tier pairings are exactly the ones the ladder's own spacing checks (see AI_LADDER's
      // history) care about, and they're free here: still one arena.js-cost game either way.
      const sidePool = () => useDeep && Math.random() < 0.5 ? deep : levels;
      const la = pick(sidePool()), lb = pick(sidePool());
      brainA = ladderBrain(la); brainB = ladderBrain(lb); tag = 'L' + la + ' vs L' + lb;
      idA = `L${la}`; idB = `L${lb}`;
    }
    const seedPose = !coverageGame && seedPool.length && Math.random() < seedFrom ? pick(seedPool) : null;
    if (seedPose) tag = 'seeded ' + tag;
    // seedPose wins if both roll -- a stored decision point already IS a real, reachable
    // position, so there's no reason to override it with an unconstrained random one.
    const randomStart = !coverageGame && !seedPose && Math.random() < randomStartFrac;
    if (randomStart) tag = 'random-start ' + tag;
    const { rows, winner, plies, capped, repeated, adjudicated } =
      playGame(eng, brainA, brainB, maxPlies, openingPlies, seedPose, randomStart, { repeatGuard });
    // `g` marks which game a position came from. Without it train.js can only hold out random
    // ROWS, and consecutive positions in one game are near-identical -- so the same game lands on
    // both sides of the split and the val set stops being held-out data at all. Measured
    // consequence: at iteration 63 best.json had better val mse (0.5674) and better sign-acc
    // (70.5%) than a throwaway 5-layer net it then lost to 7-32 in actual games. Validation had
    // been reporting on memorised training games for the whole run.
    const gameId = RUN_TAG + '-' + g;
    // Present only on rows from a non-standard opening, so ordinary games' rows don't grow a
    // field every consumer would otherwise have to ignore. Lets --randomStartFrac's effect be
    // measured in isolation later: filter nn/data/*.jsonl by src before re-running train.js.
    const src = randomStart ? { src: 'random' } : null;
    if (winner !== null) {
      decided++;
      // An adjudicated win (the komi rule scoring the position at the move cap) is a real result but
      // not a whole one -- the call agrees with who would actually have won 74-78% of the time, so it
      // is labelled at CFG.komiLoss of a win. Marked with adj so it stays separable from a piece
      // genuinely going off the board, the same way src marks a non-standard opening.
      const scale = adjudicated ? eng.CFG.komiLoss : 1;
      const adj = adjudicated ? { adj: 1 } : null;
      if (adjudicated) adjudged++;
      for (let i = 0; i < rows.length; i++) {
        const pliesToEnd = rows.length - i;
        const z = scale*(rows[i].mover === winner ? 1 : -1)*Math.pow(discount, pliesToEnd);
        ws.write(JSON.stringify({ f: rows[i].f.map(v => +v.toFixed(5)), z: +z.toFixed(4),
                                  p: rows[i].p.map(v => +v.toFixed(4)), m: rows[i].mover,
                                  g: gameId, ...src, ...adj,
                                  ...(idA ? { mv: rows[i].mover === 0 ? idA : idB } : {}) }) + '\n');
        positions++;
      }
    } else if (capped) {
      // A cap draw is a real result too -- a fortress/shuffle stalemate the net used to never see,
      // so it had no way to learn what "drawish" looks like or to steer toward/away from it.
      // Labelled exactly 0 (a discounted decided label can never be 0, so z === 0 is an unambiguous
      // draw marker -- no format change needed); train.js down-weights these via --drawWeight.
      // Wedged abandons still write nothing.
      for (const r of rows) {
        ws.write(JSON.stringify({ f: r.f.map(v => +v.toFixed(5)), z: 0,
                                  p: r.p.map(v => +v.toFixed(4)), m: r.mover,
                                  g: gameId, ...src,
                                  ...(idA ? { mv: r.mover === 0 ? idA : idB } : {}) }) + '\n');
        positions++;
      }
    }
    // Rating evidence for this game, on elorank's own scale. Only standard-opening games (see
    // --eloInbox above for why seeded/random-start are excluded) and only games that actually
    // resolved -- a wedge abandon has no result to report.
    // The komi convention is elorank's, not a new one: a cap-scored win is KOMI_LOSS of a win plus
    // the remainder as a draw, so fitBT's "wins + draws/2" lands on 0.5 + KOMI_LOSS/2 for the
    // winner. Copied rather than imported because elorank is a CLI, not a module, and the constant
    // must track CFG.komiLoss in index.html either way -- read it from the engine so it cannot
    // silently drift from the rule the games were actually scored under.
    // idA !== idB matters and is easy to miss: an nnnn game usually draws the SAME net at the SAME
    // depth for both sides, and "best@D1 vs best@D1" is a coinflip by construction -- zero rating
    // information, and in a Bradley-Terry fit it lands as a self-loop (both score and games credited
    // to one index), which is weight pulling a rating toward itself rather than evidence. The
    // informative nnnn games are the mismatched ones -- different depth, or different architecture
    // out of the variety pool -- and those still record normally.
    // MIXED nn-vs-ladder games are excluded, and this is the subtle one. Self-play runs its nets at
    // --temperature (0.08 by default) so the corpus sees varied play; elorank rates the same nets as
    // `nn:0:` -- temperature ZERO -- and ladder brains are deterministic in both. So a self-play
    // "nn vs L6" pits a deliberately-noised net against an un-noised opponent and files the result
    // under the SAME pool id elorank uses for that net's best play. Because a batch contributes far
    // more games than an elorank placement does, that id would converge on "this net at temp 0.08"
    // while the promotion gate, the ZPD window and the ladder sweep all read it as temp-0 strength.
    // nn-vs-nn (both noised) and ladder-vs-ladder (neither) are internally consistent, so their
    // relative information is sound and they still record. To include the mixed games too, self-play
    // would have to play that slice at temperature 0.
    const sameNoiseClass = kind === 'nnnn' || kind === 'ladder';
    if (eloInbox && idA && idB && idA !== idB && sameNoiseClass &&
        !seedPose && !randomStart && (winner !== null || capped)) {
      const KL = eng.CFG.komiLoss;
      let rec = null;
      if (winner === null) rec = { w: 0, l: 0, d: 1 };                     // cap draw
      else if (adjudicated) rec = winner === 0 ? { w: KL, l: 0, d: 1 - KL }
                                               : { w: 0, l: KL, d: 1 - KL };
      else rec = winner === 0 ? { w: 1, l: 0, d: 0 } : { w: 0, l: 1, d: 0 };
      // A failed append must never take a self-play batch down with it: the games and their
      // training rows are the expensive part and are already safely written by this point.
      try {
        fs.appendFileSync(eloInbox, JSON.stringify({ a: idA, b: idB, ...rec }) + '\n');
      } catch (e) { /* rating evidence is best-effort; training data is not */ }
    }
    // Flush THIS game's rows before starting the next one. A game at the deep end of the ladder can
    // run for minutes, so batching disk writes buys nothing and costs the whole point of appending.
    ws.flush();
    // Always log the first game, not just every tenth: a lane asked for 18 games used to print
    // nothing at all until game 10, which on slow deep-ladder games reads as a hung process for a
    // very long time -- the exact "is this working or stuck?" ambiguity this output exists to settle.
    if (g === 0 || (g + 1) % 10 === 0 || g === games - 1)
      console.log(`${TAG}game ${g + 1}/${games} (${tag}, ${plies} plies, winner ${winner}) — ` +
                  `${positions} positions, ${((Date.now() - t0)/1000).toFixed(0)}s`);
  }
  ws.end();
  console.log(`${TAG}done: ${decided}/${games} decided games` +
              (adjudged ? ` (${adjudged} of them adjudicated at the cap)` : '') +
              `, ${positions} positions -> ${out}`);
}

// playGame is reused by retromine.js (its "replay forward for real from an arbitrary rewound
// position" IS exactly the seedPose path below -- no separate implementation needed there). The
// guard keeps `node nn/selfplay.js ...` behaving exactly as before: require() alone must not run
// a self-play batch using retromine's own argv.
module.exports = { playGame, loadSeedPoses };
if (require.main === module) main();
