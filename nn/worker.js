// Game factory for ANY spare machine -- the "actor" half of an actor/learner split. This machine
// only generates training games and pushes them; it never trains, never rates, never promotes.
// The main machine (run.js) stays the single writer for best.json, the Elo pool and status.md,
// which is the one rule that makes a multi-machine setup safe: two writers on the pool would mean
// merging rating JSON over git, and nobody wins that.
//
//   node nn/worker.js [--games 200] [--workers N] [--name mymachine] [--randomStartFrac 0.15]
//
// The loop: pull -> play a chunk of games -> commit -> push -> repeat, forever.
//   - MODEL: the newest ckpt-NNN.json, not best.json. The numbered checkpoint is a frozen
//     snapshot, so the mover ids stamped on every row (`ckpt-091@D1`) stay exact even when this
//     machine is a pull or two behind the trainer's latest promotion. best.json is only the
//     fallback for a clone that has no checkpoints yet.
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

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const dir = __dirname;
const repoRoot = path.join(dir, '..');
const log = m => console.log(`\n=== [${new Date().toISOString()}] ${m}`);

// chunk size per push cycle: small enough that data lands on git every handful of minutes on a
// decent machine, big enough that the commit stream isn't spam
const gamesPerChunk = Math.max(1, +arg('games', 200));
// cores-1, capped: each lane is a whole node process holding its own engine sandbox
const workers = Math.max(1, +arg('workers', Math.max(1, Math.min(os.cpus().length - 1, 14))));
const randomStartFrac = arg('randomStartFrac', '0.15');
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
  try { git(args); return true; } catch (e) { log(`${what} failed (${errText(e)}) — continuing`); return false; }
};

// --- what to play with --------------------------------------------------------------------------
function pickModel() {
  try {
    const ck = fs.readdirSync(path.join(dir, 'models'))
      .filter(f => /^ckpt-\d+\.json$/.test(f))
      .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    if (ck.length) return path.join(dir, 'models', ck[ck.length - 1]);
  } catch (e) {}
  const best = path.join(dir, 'models', 'best.json');
  // a clone with no model at all still contributes: selfplay falls back to pure ladder-vs-ladder
  // games when its --model path doesn't exist, and that data is still real data
  return fs.existsSync(best) ? best : path.join(dir, 'models', 'nowhere.json');
}
function pickLevels() {
  try {
    const z = JSON.parse(fs.readFileSync(path.join(dir, 'zpd-pool.json'), 'utf8'));
    if (Array.isArray(z.levels) && z.levels.length) return z.levels.join(',');
  } catch (e) {}
  return '3,4,5,6,7,8';   // mid-ladder spread until the trainer's published pool arrives
}

// --- one chunk: N lanes -> N files -> one commit ------------------------------------------------
function playChunk() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const model = pickModel();
  const levels = pickLevels();
  const per = Math.max(1, Math.round(gamesPerChunk/workers));
  const files = [];
  log(`chunk: ${workers} lanes x ${per} games, model ${path.basename(model)}, levels ${levels}`);
  const lanes = [];
  for (let i = 0; i < workers; i++) {
    const out = path.join(dir, 'data', `w-${name}-${stamp}-w${i}.jsonl`);
    files.push(out);
    lanes.push(new Promise(resolve => {
      const ch = spawn('node', [path.join(dir, 'selfplay.js'),
        '--games', String(per), '--workers', '1', '--out', out,
        '--model', model, '--levels', levels, '--randomStartFrac', randomStartFrac],
        { stdio: ['ignore', 'ignore', 'inherit'] });
      ch.on('exit', () => resolve());
      ch.on('error', e => { log(`lane ${i} failed to start (${e.message})`); resolve(); });
    }));
  }
  return Promise.all(lanes).then(() => files.filter(f => fs.existsSync(f)));
}

async function main() {
  log(`worker "${name}" up: ${workers} lanes, ${gamesPerChunk} games/chunk, ` +
      `pushing to git after every chunk. Close this window any time — finished games are safe.`);
  for (let chunk = 1; ; chunk++) {
    // pull FIRST each cycle: newer checkpoints, newer zpd pool, whatever the trainer promoted
    gitSoft(['pull', '--no-edit', '--no-rebase'], 'pull');
    const files = await playChunk();
    if (!files.length) {
      log('chunk produced no files — engine or model problem, retrying in 5 min');
      await new Promise(r => setTimeout(r, 5*60000));
      continue;
    }
    let rows = 0;
    for (const f of files) {
      try { rows += fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length; } catch (e) {}
    }
    // -f: nn/.gitignore excludes data/ wholesale; naming files explicitly is the sanctioned
    // exception, same as run.js's artifact pushes
    let staged = false;
    for (const f of files) staged = gitSoft(['add', '-f', path.relative(repoRoot, f).replace(/\\/g, '/')], 'add') || staged;
    if (staged) {
      gitSoft(['commit', '-m', `nn: worker ${name} +${rows} rows (chunk ${chunk})`], 'commit');
      // push with pull-merge retries and backoff -- two machines pushing to one branch WILL race,
      // and losing a race must never lose data (the commit is local; only the push retries)
      let pushed = false;
      for (const wait of [0, 2000, 4000, 8000, 16000]) {
        if (wait) await new Promise(r => setTimeout(r, wait));
        gitSoft(['pull', '--no-edit', '--no-rebase'], 'pre-push pull');
        if (gitSoft(['push'], 'push')) { pushed = true; break; }
      }
      log(pushed ? `chunk ${chunk}: ${rows} rows pushed` :
                   `chunk ${chunk}: ${rows} rows committed locally — push kept failing, will ride along next time`);
    }
  }
}

main();
