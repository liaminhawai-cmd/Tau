// Continuous multicore Retromine launcher.
//
// Retromine itself is intentionally kept single-process: one seed's ratchet is sequential, but
// separate seed families are independent. This launcher keeps one seed running on every lane and
// immediately starts another when a lane finishes.
//
// Each job writes directly to its own final JSONL file, so progress is visible while the seed is
// still running and survives Ctrl-C or a closed window. A tiny per-job worker copy adds a unique
// prefix to `g` and `fam`; without that, every Retromine process would restart at retro-0-0 and
// train.js would silently group unrelated games from different files as one game.
'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

// Same git plumbing worker.js uses, including its GitHub-Desktop fallback for machines with no git
// on PATH, and its recovery from the "would be overwritten by merge" wedge -- which matters here for
// exactly the reason it matters there: one untracked local file sitting where an incoming tracked
// one wants to land silently kills EVERY subsequent pull, not just the one that hit it.
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
  gitCmd = candidates.find(works) || null;
  return gitCmd;
}
const errText = e => String((e && (e.stderr || e.stdout)) || (e && e.message) || e).trim().split('\n').slice(0, 3).join(' | ');
function git(args) {
  const found = findGit();
  if (!found) throw new Error('no git found');
  return execFileSync(found === 'git' ? 'git' : q(found), args.map(q),
                      { cwd: repoRoot, shell: true, encoding: 'utf8' });
}
function gitSoft(args, what) {
  try { git(args); return true; } catch (e) {
    const raw = String((e && e.stderr) || (e && e.message) || e);
    if (args[0] === 'pull' && /would be overwritten by merge/.test(raw)) {
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
      const start = lines.findIndex(l => /would be overwritten by merge/.test(l));
      const conflicts = [];
      for (let i = start + 1; i < lines.length; i++) {
        if (/^(please|aborting|error:)/i.test(lines[i])) break;
        conflicts.push(lines[i]);
      }
      let moved = 0;
      for (const rel of conflicts) {
        const abs = path.join(repoRoot, rel);
        try { fs.renameSync(abs, `${abs}.local-${Date.now()}`); moved++; } catch (e2) {}
      }
      if (moved) {
        console.log(`  pull blocked by ${moved} local file(s) also present upstream -- moved aside, retrying`);
        try { git(args); return true; } catch (e3) {
          console.log(`  ${what} still failed after moving conflicts aside (${errText(e3)}) -- continuing`);
          return false;
        }
      }
    }
    console.log(`  ${what} failed (${errText(e)}) -- continuing`);
    return false;
  }
}
// Commit+push whatever the lanes have appended so far. Only nn/data is added: models, summaries and
// status files belong to the trainer, and a mining loop racing it for those would just create
// conflicts over files it never authored.
function pushData(tag) {
  if (!gitPushMin || !findGit()) return;
  gitSoft(['pull', '--no-edit'], 'pull before push');
  gitSoft(['add', '-A', 'nn/data'], 'git add');
  try {
    const staged = git(['diff', '--cached', '--stat']).trim();
    if (!staged) return;                      // nothing new since last push
  } catch (e) { return; }
  if (!gitSoft(['commit', '-m', `retromine: ${tag}`], 'commit')) return;
  if (gitSoft(['push'], 'push')) console.log(`  pushed mined rows (${tag})`);
}

const dir = __dirname;
const repoRoot = path.join(dir, '..');
const sourcePath = path.join(dir, 'retromine.js');
// --- git, same shape worker.js uses -------------------------------------------------------------
// WHY the loop needs git at all: retromine writes only to disk. Without this the mined rows never
// leave the machine that made them -- not to the other box, not into anyone else's training run --
// and the loop never picks up a newer elo-summary.json, so its whole strength axis stays frozen at
// whatever the pool believed when the window was opened. A pull per job fixes the second (retromine
// re-reads the summary at every job start, so a fresh pull is enough); a periodic push fixes the first.
//
// --gitPull 0 / --gitPush 0 disable either half. Failures are always soft: a loop that stops mining
// because a push raced with the trainer would be worse than one that quietly retries next cycle.
const gitPullOn = arg('gitPull', '1') !== '0';
const gitPushMin = Math.max(0, +arg('gitPush', 4));
const workers = Math.max(1, +arg('workers',
  String(Math.max(1, Math.min(os.cpus().length - 1, 14)))));
const seedsPerJob = Math.max(1, +arg('seedsPerJob', 1));
const summary = path.resolve(arg('summary', path.join(dir, 'elo-summary.json')));
const maxDepth = Math.max(1, +arg('maxDepth', 2));
const seedBottom = Math.max(2, +arg('seedBottom', 6));
const bigGuns = Math.max(1, +arg('bigGuns', 4));
const ultimateGuns = arg('ultimateGuns', '1');
const probesPerPos = Math.max(2, +arg('probesPerPos', 10));
const topMarginElo = Math.max(0, +arg('topMarginElo', 60));
const randomStartFrac = +arg('randomStartFrac', 0.3);
const maxReplaysPerSeed = Math.max(1, +arg('maxReplaysPerSeed', 400));
const maxPlies = Math.max(1, +arg('maxPlies', 300));
const openingPlies = Math.max(0, +arg('openingPlies', 2));
const retrySeconds = Math.max(1, +arg('retrySeconds', 5));
const outDir = path.resolve(arg('outDir', path.join(dir, 'data')));

if (!fs.existsSync(sourcePath)) {
  console.error(`Missing ${sourcePath}`);
  process.exit(1);
}
if (!fs.existsSync(summary)) {
  console.error(`No rating pool at ${summary}\nRun RANK.bat or a normal training pool cycle first.`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const session = `ratchet-${stamp}-${process.pid.toString(36)}`;
const statusPath = path.join(dir, 'retro-loop-status.json');
const lanes = Array.from({ length: workers }, (_, i) => ({
  id: i + 1, jobs: 0, failures: 0, child: null, startedAt: null, output: null, script: null,
}));
let stopping = false;
const startedAt = new Date().toISOString();

function atomicWrite(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function saveStatus() {
  const snapshot = {
    mode: 'retromine-ratchet-only',
    session,
    startedAt,
    updatedAt: new Date().toISOString(),
    stopping,
    workers,
    seedsPerJob,
    summary,
    outputs: lanes.map(l => ({
      worker: l.id,
      jobsCompleted: l.jobs,
      failures: l.failures,
      active: !!l.child,
      currentJobStartedAt: l.startedAt,
      output: l.output,
      bytes: l.output && fs.existsSync(l.output) ? fs.statSync(l.output).size : 0,
    })),
  };
  try { atomicWrite(statusPath, JSON.stringify(snapshot, null, 2) + '\n'); } catch (_) {}
}

// Build a temporary copy beside retromine.js so its relative require('./engine.js') calls still
// resolve normally. Only two exact lines change: the family/game identifiers gain a job prefix.
// The real retromine.js remains the single source of truth for the algorithm.
function makeWorkerScript(runTag) {
  let src = fs.readFileSync(sourcePath, 'utf8');
  const gameNeedle = '    const gameId = `retro-${fam}-${gameCount++}`;';
  const famNeedle = "                                g: gameId, src: 'retro', fam,";
  if (!src.includes(gameNeedle) || !src.includes(famNeedle)) {
    throw new Error('retromine.js changed: unique-ID injection points were not found');
  }
  src = src.replace(gameNeedle,
    `    const familyId = ${JSON.stringify(runTag)} + '-' + fam;\n` +
    '    const gameId = `retro-${familyId}-${gameCount++}`;');
  src = src.replace(famNeedle,
    "                                g: gameId, src: 'retro', fam: familyId,");
  const workerPath = path.join(dir, `.retromine-worker-${runTag}.js`);
  fs.writeFileSync(workerPath, src);
  return workerPath;
}

function cleanup(lane) {
  if (lane.script) {
    try { fs.unlinkSync(lane.script); } catch (_) {}
    lane.script = null;
  }
}

function launch(lane) {
  if (stopping) return;
  const job = lane.jobs + lane.failures + 1;
  const runTag = `${session}-w${lane.id}-j${job}`;
  lane.startedAt = new Date().toISOString();
  lane.output = path.join(outDir,
    `retro-${session}-w${String(lane.id).padStart(2, '0')}-j${String(job).padStart(5, '0')}.jsonl`);

  try {
    lane.script = makeWorkerScript(runTag);
  } catch (e) {
    lane.failures++;
    lane.startedAt = null;
    console.error(`[w${lane.id}] ${e.message}`);
    saveStatus();
    if (!stopping) setTimeout(() => launch(lane), retrySeconds * 1000);
    return;
  }

  const args = [
    lane.script,
    '--summary', summary,
    '--seeds', String(seedsPerJob),
    '--maxDepth', String(maxDepth),
    '--seedBottom', String(seedBottom),
    '--bigGuns', String(bigGuns),
    '--ultimateGuns', String(ultimateGuns),
    '--probesPerPos', String(probesPerPos),
    '--topMarginElo', String(topMarginElo),
    '--randomStartFrac', String(randomStartFrac),
    '--maxReplaysPerSeed', String(maxReplaysPerSeed),
    '--maxPlies', String(maxPlies),
    '--openingPlies', String(openingPlies),
    '--out', lane.output,
  ];

  // Pull before spawning, not after: retromine reads elo-summary.json once at startup, so the pull
  // has to land before the child exists or the job runs the whole seed against a stale axis. Lane 1
  // only -- 14 lanes each pulling on their own schedule would just be 14 racing pulls of the same
  // commits, and every lane's next job picks the result up anyway.
  if (gitPullOn && lane.id === 1 && findGit()) gitSoft(['pull', '--no-edit'], 'pull');
  console.log(`\n[w${lane.id}] starting ratchet job ${job} -> ${path.basename(lane.output)}`);
  const child = spawn(process.execPath, args, { cwd: dir, stdio: 'inherit', windowsHide: false });
  lane.child = child;
  saveStatus();

  child.on('error', err => {
    lane.failures++;
    lane.child = null;
    lane.startedAt = null;
    cleanup(lane);
    console.error(`[w${lane.id}] failed to start: ${err.message}`);
    saveStatus();
    if (!stopping) setTimeout(() => launch(lane), retrySeconds * 1000);
  });

  child.on('exit', (code, signal) => {
    lane.child = null;
    lane.startedAt = null;
    cleanup(lane);
    if (code === 0) {
      lane.jobs++;
      console.log(`[w${lane.id}] job complete (${lane.jobs} total); relaunching`);
    } else {
      lane.failures++;
      console.error(`[w${lane.id}] exited ${signal || code}; saved rows remain in ${path.basename(lane.output)}`);
    }
    saveStatus();
    if (!stopping) setTimeout(() => launch(lane), code === 0 ? 100 : retrySeconds * 1000);
  });
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: stopping Retromine lanes. Rows already written remain in nn/data.`);
  saveStatus();
  for (const lane of lanes) {
    if (lane.child && !lane.child.killed) {
      try { lane.child.kill('SIGINT'); } catch (_) {}
    }
  }
  setTimeout(() => {
    for (const lane of lanes) cleanup(lane);
    saveStatus();
    process.exit(0);
  }, 1500).unref();
}

process.on('SIGINT', () => stop('Ctrl-C'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('exit', () => { for (const lane of lanes) cleanup(lane); });

console.log(`Tau Retromine ratchet-only loop
  workers: ${workers}
  one complete seed per lane/job
  replay cap: ${maxReplaysPerSeed}
  rating pool: ${summary}
  outputs: ${outDir}
  status: ${statusPath}

Close this window or press Ctrl-C to stop. Retromine appends rows throughout each job.`);
if (findGit()) {
  console.log(`  git: ${gitPullOn ? 'pull before each lane-1 job' : 'pull OFF'}, ` +
              `${gitPushMin ? `push nn/data every ${gitPushMin} min` : 'push OFF'}`);
} else if (gitPullOn || gitPushMin) {
  console.log(`  git: not found on PATH or under GitHub Desktop -- mining locally only`);
}
saveStatus();
// Periodic push, from the supervisor rather than the lanes: one committer means no two processes
// racing to stage the same growing files. Unref'd so it never holds the process open by itself.
if (gitPushMin && findGit()) {
  setInterval(() => pushData(`${lanes.reduce((n, l) => n + l.jobs, 0)} jobs done`),
              gitPushMin * 60 * 1000).unref();
}
for (const lane of lanes) launch(lane);
