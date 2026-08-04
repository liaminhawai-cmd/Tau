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

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const dir = __dirname;
const sourcePath = path.join(dir, 'retromine.js');
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
saveStatus();
for (const lane of lanes) launch(lane);
