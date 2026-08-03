// Game factory for ANY spare machine -- the "actor" half of an actor/learner split. This machine
// only generates training games and pushes them; it never trains, never rates, never promotes.
// The main machine (run.js) stays the single writer for best.json, the Elo pool and status.md,
// which is the one rule that makes a multi-machine setup safe: two writers on the pool would mean
// merging rating JSON over git, and nobody wins that.
//
//   node nn/worker.js [--games 200] [--workers N] [--name mymachine] [--randomStartFrac 0.15]
//
// The loop: pull -> play a chunk of games -> commit -> push -> repeat, forever.
//   - MODEL: whichever of {newest local ckpt-NNN.json, best.json} was actually touched more
//     recently (by mtime, not filename). A checkpoint is preferred when it is genuinely fresh --
//     a frozen numbered snapshot means the mover ids stamped on every row (`ckpt-091@D1`) stay
//     exact even when this machine is a pull or two behind the trainer's latest promotion -- but
//     checkpoints never travel over git, so a worker's local copy can otherwise sit stale for days
//     while best.json keeps moving. See pickPrimaryModel() for the failure this fixes.
//   - OPPONENTS: nn/zpd-pool.json, published by the trainer each batch, so a worker plays the
//     same frontier-centred opponent mix as the main machine instead of selfplay's weak-heavy
//     default. Falls back to a fixed mid-ladder spread if the file hasn't arrived yet.
//   - OUTPUT: nn/data/w-<name>-<stamp>-w<i>.jsonl -- machine name + timestamp + lane, so no two
//     machines (or two runs on one machine) can ever collide on a filename. Which is the entire
//     transport story: append-only files with globally unique names merge trivially in git.
//
// PARALLELISM IS N SEPARATE top-level node processes with --workers 1 each, NOT selfplay.js's
// internal fork(): on one laptop, forked workers ran for 2+ hours -- real games in the console --
// and produced 0 bytes, part files never found anywhere on the drive (see START-laptop.bat's
// original header for the full account). A plain no-fork run worked immediately on the same
// machine. This orchestrator never calls fork(), so it inherits the code path that is known to
// work on machines we don't control.
'use strict';
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSeedPoses } = require('./selfplay.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const dir = __dirname;
const repoRoot = path.join(dir, '..');
const log = m => console.log(`\n=== [${new Date().toISOString()}] ${m}`);

// chunk size: how many games each lane plays before the worker re-pulls and re-picks its model/
// opponent pool. Independent of how often it PUSHES now (see pushEveryMin) -- a chunk used to be
// the push unit too, which meant total silence, no git activity, and no visible progress for
// however long the single slowest lane's games took (a real ladder marathon has run 2500s+ on the
// desktop; 11 lanes waiting on each other multiplies that risk).
const gamesPerChunk = Math.max(1, +arg('games', 200));
// How often to commit+push whatever has accumulated in the currently-growing lane files, on a
// wall-clock timer independent of whether any lane has actually finished -- same shape as run.js's
// own checkEveryMin push of the still-growing self-play batch file. This is what makes "close this
// window any time, pushed games are shared" actually true, instead of only true once in a while.
const pushEveryMin = Math.max(0.5, +arg('pushEveryMin', 4));
// cores-1, capped: each lane is a whole node process holding its own engine sandbox
const workers = Math.max(1, +arg('workers', Math.max(1, Math.min(os.cpus().length - 1, 14))));
// Deliberately far higher than the desktop's: this machine's job is COVERAGE, not the on-policy
// stream. A random start (opening.js randomStartPose) is a legal, well-formed pose drawn uniformly
// from the disc rather than a few plies off the canonical opening, so it reaches shapes self-play's
// own trajectories never produce. That matters more than it sounds: minimax spends most of its
// evaluations on hypothetical positions well off the played line, so a value net that has only ever
// seen on-trajectory shapes is being asked to judge exactly what it was never trained on.
// Note seedPose WINS over a random start when both roll (see selfplay.js), so the realised random
// rate is (1 - seedFrom) x this -- 0.6 here with seedFrom 0.25 gives ~45% random starts, ~25%
// stored real positions, ~30% canonical openings. Rows carry src:'random', so the share this
// actually contributes to the corpus is measurable after the fact rather than assumed.
const randomStartFrac = arg('randomStartFrac', '0.6');
// Fraction of games that start from a STORED mid-game position instead of the standard opening --
// selfplay.js's own --seedFrom. Left unset here until now, which meant each of the `workers`
// separately-spawned selfplay.js LANES (--workers 1 apiece, see the header) fell back to
// selfplay.js's own default and independently re-scanned and re-parsed EVERY file in nn/data to
// build its own 400-position sample -- the exact "every worker re-reading the whole accumulated
// dataset" cost selfplay.js's own internal fork-parent already avoids for ITS children, just not
// for these. nn/data only grows, so the redundant work got slower every day, worker count deep
// (11 of these scans at once on one chunk start), and on a laptop already known to choke on
// concurrent I/O (see the PARALLELISM note above). Sampled ONCE per chunk below instead.
const seedFrac = Math.max(0, Math.min(1, +arg('seedFrom', '0.25')));
// Fraction of CHUNKS that play as a model-variety slot instead of the newest checkpoint/best.json.
// These slot files (nn/models/pool-slot-*.json, plus wide/ultra/deep/l15_value) are refreshed and
// pushed by the desktop's own pool cycle -- refreshModelSlots in run.js -- specifically so a
// worker has more than one architecture's weights to draw on, the same reason the desktop's own
// self-play occasionally does the same (see run.js's pickBatchModel). Minority slice on purpose:
// the newest checkpoint is still the most relevant thing to generate data with.
const modelVarietyFrac = Math.max(0, Math.min(1, +arg('modelVarietyFrac', 0.2)));
// Retrograde miners running continuously alongside the game lanes. This does NOT break the
// actor/learner rule the header sets out: retromine only READS the published rating pool
// (nn/elo-summary.json, which the desktop pushes) and appends to its own data file. It never
// rates, never trains, never promotes, never writes the pool -- so the desktop stays the single
// writer for everything that matters.
// DEFAULT 0, on measured evidence rather than caution. The ladder rungs retromine uses as anchors
// are code (engine.ladderPlanFor), so a worker always has all 11 of them -- that part is fine. The
// problem is the nn end of the axis: only an allowlist of models is ever pushed (best, wide, ultra,
// deep, l15_value, pool-slot-NN), so against the live pool a worker could build an axis of just 14
// brains where the desktop had 45, and every checkpoint/scratch model was missing -- including
// scratch-095@D1 at 268 Elo, one of the strongest things rated. retromine's whole question is "how
// strong does an escape need to be", so a missing ceiling makes it call positions dead that a
// stronger brain might have escaped. Wrong answers, not just fewer of them.
// Kept and wired up rather than deleted because the fix is small if it's ever wanted: push the
// top-rated checkpoint alongside best.json, then --retroWorkers 1 here.
const retroWorkers = Math.max(0, +arg('retroWorkers', 0));
const retroSeeds = arg('retroSeeds', '4');
// machine name from the hostname, sanitised to filename-safe -- zero config on a pile of
// borrowed machines is the point ("run on any machines lying around")
const name = (arg('name', os.hostname()) || 'worker').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'worker';

// --- git plumbing, copied from run.js's battle-tested writeStatus path --------------------------
// shell:true so Windows resolves git the way a typed command would; every arg quoted by hand
// because shell:true joins them with bare spaces; GitHub-Desktop-bundled git probed because that
// is the only git some machines have. All three lessons were paid for on the real desktop -- see
// run.js's writeStatus for the full history.
const q = s => '"' + String(s).replace(/"/g, '\\"') + '"';
let gitCmd;
function findGit() {
  if (gitCmd !== undefined) return gitCmd;
  const works = c => {
    try {
      execFileSync(c === 'git' ? 'git' : q(c), ['--version'],
                   { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return true;
    } catch (e) { return false; }
  };
  const candidates = ['git'];
  try {
    const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
    const ver = f => f.slice(4).split('.').map(Number);
    const apps = fs.readdirSync(base).filter(f => /^app-/.test(f))
      .sort((a, b) => { const va = ver(a), vb = ver(b);
        for (let i = 0; i < 3; i++) if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0);
        return 0; });
    for (const a of apps) candidates.push(path.join(base, a, 'resources', 'app', 'git', 'cmd', 'git.exe'));
  } catch (e) {}
  candidates.push('C:\\Program Files\\Git\\cmd\\git.exe',
                  'C:\\Program Files (x86)\\Git\\cmd\\git.exe');
  gitCmd = candidates.find(works) || null;
  if (gitCmd && gitCmd !== 'git') log(`using git at ${gitCmd}`);
  return gitCmd;
}
const errText = e => String((e && (e.stderr || e.stdout)) || (e && e.message) || e).trim().split('\n').slice(0, 3).join(' | ');
function git(args) {
  const found = findGit();
  if (!found) throw new Error('no git found');
  return execFileSync(found === 'git' ? 'git' : q(found), args.map(q),
                      { cwd: repoRoot, shell: true, encoding: 'utf8' });
}
const gitSoft = (args, what) => {
  try { git(args); return true; } catch (e) {
    // A pull can fail specifically because a LOCAL untracked file sits exactly where an incoming
    // tracked one wants to land -- e.g. someone manually copies nn/models/*.json onto a worker for
    // instant variety, and later the desktop pushes a real wide.json/ultra.json for the first
    // time. git refuses rather than guessing which copy to keep, which is correct of it -- but
    // left alone this wedges EVERY future pull, not just this one (worker.js pulls before every
    // chunk), silently stopping best.json/zpd-pool.json updates along with everything else. Move
    // the conflicting file aside (never delete -- it might be the only copy) and retry once.
    const raw = String((e && e.stderr) || (e && e.message) || e);
    if (args[0] === 'pull' && /would be overwritten by merge/.test(raw)) {
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
      const start = lines.findIndex(l => /would be overwritten by merge/.test(l));
      const conflicts = [];
      for (let i = start + 1; i < lines.length; i++) {
        if (/^(please|aborting|error:)/i.test(lines[i])) break;
        conflicts.push(lines[i]);
      }
      if (conflicts.length) {
        log(`pull blocked by ${conflicts.length} local file(s) also present upstream -- moving ` +
            `aside and retrying: ${conflicts.join(', ')}`);
        let moved = 0;
        for (const rel of conflicts) {
          const abs = path.join(repoRoot, rel);
          try { fs.renameSync(abs, `${abs}.local-${Date.now()}`); moved++; } catch (e2) {}
        }
        if (moved) { try { git(args); return true; } catch (e3) { log(`${what} still failed after moving conflicts aside (${errText(e3)}) — continuing`); return false; } }
      }
    }
    log(`${what} failed (${errText(e)}) — continuing`); return false;
  }
};

// --- what to play with --------------------------------------------------------------------------
function pickPrimaryModel() {
  const best = path.join(dir, 'models', 'best.json');
  let newestCkpt = null, newestCkptTime = -Infinity;
  try {
    for (const f of fs.readdirSync(path.join(dir, 'models'))) {
      if (!/^ckpt-\d+\.json$/.test(f)) continue;
      const p = path.join(dir, 'models', f);
      const mtime = fs.statSync(p).mtimeMs;
      if (mtime > newestCkptTime) { newestCkptTime = mtime; newestCkpt = p; }
    }
  } catch (e) {}
  // Checkpoints never travel over git (nn/.gitignore excludes models/ wholesale -- pushing every
  // one of a desktop's dense, non-delta-friendly checkpoints would bloat repo history forever).
  // That is harmless on the machine actually PRODUCING them each cycle: the highest number is
  // always the genuinely newest file. But a worker that never trains can carry a ckpt-NNN.json
  // from a one-time manual copy that then sits frozen while every pull moves best.json on --
  // "highest number" stops meaning "newest" the moment local and synced diverge. Observed live:
  // a worker stuck playing ckpt-093 for its entire run while the trainer was many promotions past
  // it, because nothing here ever compared the two. Trust mtimes, not the filename, so a stale
  // local copy loses to a freshly-pulled best.json instead of always winning on number alone.
  if (newestCkpt && fs.existsSync(best)) {
    const bestTime = fs.statSync(best).mtimeMs;
    return bestTime > newestCkptTime ? best : newestCkpt;
  }
  if (newestCkpt) return newestCkpt;
  // a clone with no model at all still contributes: selfplay falls back to pure ladder-vs-ladder
  // games when its --model path doesn't exist, and that data is still real data
  return fs.existsSync(best) ? best : path.join(dir, 'models', 'nowhere.json');
}
// Every model-variety slot/architecture file currently on disk, handed to selfplay.js as a POOL
// (see its own header note) so EACH SIDE of EACH nn-involving game rolls independently -- an nnnn
// game can genuinely be two different architectures facing off, not this lane's whole chunk
// switching to one alternate model and still playing it against itself.
function currentModelPool() {
  const candidates = [];
  try {
    for (const f of fs.readdirSync(path.join(dir, 'models'))) {
      if (/^pool-slot-\d+\.json$/.test(f) ||
          ['wide.json', 'ultra.json', 'deep.json', 'l15_value.json'].includes(f))
        candidates.push(path.join(dir, 'models', f));
    }
  } catch (e) {}
  return candidates;
}
function pickLevels() {
  try {
    const z = JSON.parse(fs.readFileSync(path.join(dir, 'zpd-pool.json'), 'utf8'));
    if (Array.isArray(z.levels) && z.levels.length) return z.levels.join(',');
  } catch (e) {}
  return '3,4,5,6,7,8';   // mid-ladder spread until the trainer's published pool arrives
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Commit+push whatever is CURRENTLY on disk in `files` -- called both mid-chunk (on the timer,
// while lanes are still running) and once a chunk finishes. Safe to call on files a live process
// is still appending to: these are append-only streams, never truncated, so a read mid-write just
// sees whatever has been flushed so far and the next call picks up the rest as a new diff -- the
// exact pattern run.js already uses to push its own still-growing self-play batch file.
async function pushProgress(files, label) {
  let rows = 0;
  const present = files.filter(f => fs.existsSync(f));
  for (const f of present) {
    try { rows += fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length; } catch (e) {}
  }
  if (!present.length) { log(`${label}: no data on disk yet`); return; }
  let staged = false;
  for (const f of present) staged = gitSoft(['add', '-f', path.relative(repoRoot, f).replace(/\\/g, '/')], 'add') || staged;
  if (!staged) { log(`${label}: ${rows} rows on disk, nothing new to commit`); return; }
  gitSoft(['commit', '-m', `nn: worker ${name} ${label} (${rows} rows so far)`], 'commit');
  let pushed = false;
  for (const wait of [0, 2000, 4000, 8000, 16000]) {
    if (wait) await sleep(wait);
    gitSoft(['pull', '--no-edit', '--no-rebase'], 'pre-push pull');
    if (gitSoft(['push'], 'push')) { pushed = true; break; }
  }
  log(pushed ? `${label}: ${rows} rows pushed` :
               `${label}: ${rows} rows committed locally — push kept failing, will ride along next time`);
}

// --- one chunk: N lanes running concurrently, pushed on a timer, not on completion --------------
function playChunk(chunk) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const model = pickPrimaryModel();
  const modelPool = currentModelPool();
  const levels = pickLevels();
  const per = Math.max(1, Math.round(gamesPerChunk/workers));
  const files = [];
  const varietyNote = modelPool.length ? `, ${modelPool.length}-model variety pool` : '';
  // Sample ONCE here rather than leaving each lane to scan nn/data for itself -- see seedFrac's
  // own comment above for why that redundant per-lane scan existed and what it cost.
  let seedFile = null, seedNote = '';
  if (seedFrac > 0) {
    const pool = loadSeedPoses(path.join(dir, 'data'), 400);
    if (pool.length >= 50) {
      seedFile = path.join(dir, 'data', `w-${name}-${stamp}.seeds`);
      fs.writeFileSync(seedFile, JSON.stringify(pool));
      seedNote = `, seeding ~${Math.round(seedFrac*100)}% from ${pool.length} stored positions`;
    }
  }
  log(`chunk ${chunk}: ${workers} lanes x ${per} games, model ${path.basename(model)}, levels ${levels}${varietyNote}${seedNote}`);
  const lanes = [];
  for (let i = 0; i < workers; i++) {
    // 1-indexed in the filename to match the [w1]/[w2]/... console tag below -- they used to
    // differ by one (file "w0" printing as "[w1]"), which makes correlating a console line to its
    // file needlessly confusing, exactly when that correlation is what debugging needs.
    const out = path.join(dir, 'data', `w-${name}-${stamp}-w${i + 1}.jsonl`);
    files.push(out);
    lanes.push(new Promise(resolve => {
      // stdout INHERITED, not ignored -- real per-game progress on the console is the whole point
      // right now: it is how "this is genuinely working, just slow" gets told apart from "this is
      // silently stuck," which is exactly the ambiguity a fully silent chunk produced once already.
      // TAU_WORKER tags each lane's lines ([w1], [w2], ...) the same way the desktop's own
      // multi-lane runs are tagged, so 11 interleaved lanes stay readable.
      const ch = spawn('node', [path.join(dir, 'selfplay.js'),
        '--games', String(per), '--workers', '1', '--out', out,
        '--model', model, '--levels', levels, '--randomStartFrac', randomStartFrac,
        '--modelVarietyFrac', String(modelVarietyFrac),
        ...(seedFile ? ['--seedFrom', String(seedFrac), '--seedPool', seedFile] : ['--seedFrom', '0']),
        ...(modelPool.length ? ['--modelPool', modelPool.join(',')] : [])],
        { stdio: ['ignore', 'inherit', 'inherit'],
          env: Object.assign({}, process.env, { TAU_WORKER: String(i + 1) }) });
      ch.on('exit', () => resolve());
      ch.on('error', e => { log(`lane ${i} failed to start (${e.message})`); resolve(); });
    }));
  }
  const done = Promise.all(lanes);
  if (seedFile) done.then(() => { try { fs.unlinkSync(seedFile); } catch (e) {} });
  return { files, done };
}

// --- retrograde mining, on its own clock entirely --------------------------------------------
// Deliberately NOT tied to the chunk loop: a single miner measured 6h40m on the desktop while a
// chunk here runs ~1.5h, so binding the two would mean every chunk boundary either orphaned a
// half-finished miner or blocked waiting on one. Instead each miner restarts itself when it
// exits, and its output file rides along on the ordinary push timer like any lane file.
// Every file this session is kept in the push list rather than just the current one: a miner that
// finished between two pushes still has an unpushed tail, and dropping it would strand those rows.
const retroFiles = [];
function startRetroMiner(i) {
  const summary = path.join(dir, 'elo-summary.json');
  // The pool is the strength axis -- without it retromine exits immediately, so wait for the
  // desktop to publish one rather than respawning in a tight loop against a missing file.
  if (!fs.existsSync(summary)) {
    log(`retro miner ${i + 1}: no nn/elo-summary.json yet (the desktop publishes it) — checking again in 10 min`);
    setTimeout(() => startRetroMiner(i), 10*60000);
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // machine name in the filename for the same reason the lane files carry it: the desktop is
  // mining too, and two machines writing retro-<stamp>.jsonl would collide in git.
  const out = path.join(dir, 'data', `retro-${name}-${stamp}` +
                        (retroWorkers > 1 ? `-${i + 1}` : '') + '.jsonl');
  retroFiles.push(out);
  const ch = spawn('node', [path.join(dir, 'retromine.js'), '--summary', summary,
                            '--seeds', retroSeeds, '--maxReplaysPerSeed', '40', '--out', out],
                   { stdio: ['ignore', 'inherit', 'inherit'] });
  ch.on('exit', code => {
    log(`retro miner ${i + 1} finished (exit ${code}) — starting a fresh one`);
    startRetroMiner(i);
  });
  ch.on('error', e => {
    log(`retro miner ${i + 1} failed to start (${e.message}) — retrying in 10 min`);
    setTimeout(() => startRetroMiner(i), 10*60000);
  });
}

async function main() {
  log(`worker "${name}" up: ${workers} lanes, ${gamesPerChunk} games/chunk` +
      (retroWorkers ? `, ${retroWorkers} retro miner(s)` : '') + `, pushing every ` +
      `~${pushEveryMin} min regardless of how long any single game takes. Close this window any ` +
      `time — everything already pushed is shared, everything on disk is safe for the next run.`);
  for (let i = 0; i < retroWorkers; i++) startRetroMiner(i);
  for (let chunk = 1; ; chunk++) {
    // pull FIRST each cycle: newer checkpoints, newer zpd pool, whatever the trainer promoted
    gitSoft(['pull', '--no-edit', '--no-rebase'], 'pull');
    const { files, done } = playChunk(chunk);
    let finished = false;
    done.then(() => { finished = true; });
    // Push on the wall clock, not on chunk completion. A chunk with one long straggler used to
    // mean total silence -- no console output, no git activity -- for however long that one game
    // took; this bounds the silence to pushEveryMin regardless.
    while (!finished) {
      await Promise.race([sleep(pushEveryMin*60000), done]);
      if (finished) break;
      await pushProgress(files, `chunk ${chunk} (still running)`);
    }
    await pushProgress(files, `chunk ${chunk} complete`);
  }
}

main();
