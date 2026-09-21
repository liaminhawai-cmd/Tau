'use strict';
// One worktree, six writers, no coordination -- until this file.
//
// run.js pushes status and artefacts, retroloop.js pushes mined rows, value-league.js pushes league
// results, policyloop.js and policyfight.js push arena games, worker.js pulls. Each is a separate
// OS process on its own timer, each carries its own copy of the same findGit/git/gitSoft helpers,
// and every one of them drives the SAME .git directory through add -> commit -> push. Nothing ever
// made them take turns. Git itself only locks individual ref and index updates, which is far less
// than a multi-step sequence needs: the window between one process's `commit` and its `push` is
// wide open for another process to commit on top, and the window during a slow `fetch` is wide open
// for a second fetch to write the same .git/FETCH_HEAD.
//
// Observed live, all three on the training box:
//   fatal: not something we can merge in .git/FETCH_HEAD: ne-ratchet-loop'
//     -- a truncated ref name with a stray quote: two fetches interleaved inside one FETCH_HEAD.
//   fetch updated the current branch head ... Cannot fast-forward your working tree
//     -- a fetch landed on the branch a second process had checked out mid-operation.
//   ! [rejected] ... fetch first
//     -- routine, but it triggers a pull+push retry that is itself another collision opportunity,
//        so a busy repo generates more collisions the busier it gets.
//
// The fix is a plain advisory lock, held across the WHOLE sequence rather than per git call, taken
// by every process that mutates the repo. Requirements it has to meet, in the order they bit:
//
//   Cross-process, not in-process. These are separate `node` invocations, so a module-level mutex
//   would not see the other five. The lock is a file, created with the 'wx' flag -- one atomic
//   O_CREAT|O_EXCL syscall that either creates or fails, with no check-then-act gap to race in.
//
//   Synchronous. Every caller is built on execFileSync inside straight-line code. An async lock
//   would mean rewriting all six call sites; Atomics.wait on a SharedArrayBuffer sleeps the thread
//   without burning a core, which is what lets the waiting stay sync.
//
//   Self-healing. A process killed mid-push (Ctrl-C ends these runs routinely) leaves the file
//   behind, and a stale lock that blocks the repo forever is worse than the collisions it prevents.
//   The holder records pid, host and time: a dead pid on this host is broken immediately, and any
//   lock past staleMs is broken regardless of what it claims, so an unknown host cannot wedge us.
//
//   Soft. Failures here must never take down a training run -- the callers all treat git as
//   best-effort and retry on their next tick. Timing out throws a tagged error (code EGITLOCK)
//   that the existing catch at each site logs and continues past.
//
// Not covered, deliberately: a second MACHINE pushing the same branch. That is a different problem
// with a different fix (per-machine filenames, machine-id.js) and no local lock can touch it.
const fs = require('fs');
const path = require('path');
const os = require('os');

// Atomics.wait blocks this thread for the timeout and returns 'timed-out' -- nothing ever notifies
// this buffer. It is just the only way to sleep without spinning in synchronous Node.
const PARK = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = ms => { try { Atomics.wait(PARK, 0, 0, Math.max(1, ms)); } catch (e) {} };

const DISABLED = process.env.TAU_GIT_LOCK === '0';
const DEFAULT_WAIT_MS = 120000;   // a slow push on this repo runs well over a minute; see log.txt
const DEFAULT_STALE_MS = 900000;  // 15 min: longer than any real sequence, short enough to recover

// Depth per lock file, so a locked helper calling another locked helper in the same process does
// not deadlock against itself.
const held = new Map();

function lockFileFor(repoRoot) {
  // Inside .git by preference: never tracked, never matched by an `add -Af` pathspec, and it goes
  // away with the clone. A linked worktree or submodule has .git as a FILE pointing elsewhere, in
  // which case fall back to a dotfile at the root.
  const gitDir = path.join(repoRoot, '.git');
  try { if (fs.statSync(gitDir).isDirectory()) return path.join(gitDir, 'tau-git.lock'); } catch (e) {}
  return path.join(repoRoot, '.tau-git.lock');
}

// EPERM means the pid exists but belongs to another user -- alive for our purposes. ESRCH means no
// such process. Only meaningful for a pid on THIS host; pids from elsewhere are aged out instead.
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readHolder(lockFile) {
  try {
    const raw = fs.readFileSync(lockFile, 'utf8');
    const h = JSON.parse(raw);
    if (h && typeof h === 'object') return h;
  } catch (e) {
    // Corrupt or half-written (the writer died between create and write): fall back to the file's
    // own mtime so it can still age out rather than blocking forever.
    try { return { at: fs.statSync(lockFile).mtimeMs, pid: 0, host: null, what: '(unreadable)' }; }
    catch (e2) {}
  }
  return null;
}

function breakIfStale(lockFile, staleMs) {
  const h = readHolder(lockFile);
  if (!h) return false;                                    // vanished on its own -- retry the create
  const age = Date.now() - (Number(h.at) || 0);
  const deadHere = h.host === os.hostname() && !alive(Number(h.pid));
  if (!deadHere && age < staleMs) return false;
  // Both waiters may decide to break at the same moment; that is fine, because the unlink is
  // followed by the same atomic create and exactly one of them can win it.
  try { fs.unlinkSync(lockFile); } catch (e) { return false; }
  return { age, deadHere, holder: h };
}

// Acquisition is one small state machine so the sync and async drivers below can share it
// byte-for-byte. Returning 'wait' rather than sleeping in here is what lets the async driver yield
// to its event loop where the sync one parks the thread.
function makeAcquirer(lockFile, what, staleMs, deadline, onWait) {
  let announced = false, backoff = 50;
  return {
    get backoff() { return backoff; },
    step() {
      try {
        const fd = fs.openSync(lockFile, 'wx');            // atomic O_CREAT|O_EXCL
        try {
          fs.writeSync(fd, JSON.stringify({
            pid: process.pid, host: os.hostname(), what: String(what || 'git'), at: Date.now(),
          }));
        } finally { fs.closeSync(fd); }
        held.set(lockFile, 1);
        return 'got';
      } catch (e) {
        // Cannot even attempt the lock (read-only .git, permissions). Serialising is an
        // optimisation; refusing to do the git work at all would be a regression.
        if (e.code !== 'EEXIST') return 'unlockable';
      }
      const broke = breakIfStale(lockFile, staleMs);
      if (broke) {
        if (onWait) onWait(`broke a stale git lock held by ${broke.holder.what} ` +
                           `(pid ${broke.holder.pid}, ${Math.round(broke.age / 1000)}s old` +
                           `${broke.deadHere ? ', process gone' : ''})`);
        return 'retry';
      }
      if (Date.now() >= deadline) return 'timeout';
      if (onWait && !announced) {
        announced = true;
        const h = readHolder(lockFile) || {};
        onWait(`waiting for the git lock (held by ${h.what || 'another process'}, pid ${h.pid || '?'})`);
      }
      backoff = Math.min(1000, Math.round(backoff * 1.7));  // quick at first, then out of the way
      return 'wait';
    },
  };
}

function busyError(lockFile) {
  const h = readHolder(lockFile) || {};
  return Object.assign(
    new Error(`git busy: ${h.what || 'another process'} has held the repo lock for ` +
              `${Math.round((Date.now() - (Number(h.at) || Date.now())) / 1000)}s`),
    { code: 'EGITLOCK' });
}

function release(lockFile) {
  held.set(lockFile, 0);
  try { fs.unlinkSync(lockFile); } catch (e) {}
}

function reentrant(lockFile, fn) {
  held.set(lockFile, held.get(lockFile) + 1);
  try { return fn(); } finally { held.set(lockFile, held.get(lockFile) - 1); }
}

// Run `fn` with the repo's git lock held. Returns whatever `fn` returns. Throws EGITLOCK if the
// lock cannot be taken within waitMs -- callers are expected to log and skip, not to retry here.
// `fn` MUST be synchronous: the lock is released when fn returns, so handing this an async function
// would release it the moment the first await was reached. Use withGitLockAsync for those.
function withGitLock(repoRoot, what, fn, opts) {
  if (DISABLED || typeof fn !== 'function') return fn();
  const o = opts || {};
  const staleMs = o.staleMs == null ? DEFAULT_STALE_MS : o.staleMs;
  const lockFile = lockFileFor(repoRoot);
  if (held.get(lockFile)) return reentrant(lockFile, fn);   // already ours -- do not self-deadlock

  const deadline = Date.now() + (o.waitMs == null ? DEFAULT_WAIT_MS : o.waitMs);
  const acq = makeAcquirer(lockFile, what, staleMs, deadline,
                           typeof o.onWait === 'function' ? o.onWait : null);
  for (;;) {
    const r = acq.step();
    if (r === 'got') break;
    if (r === 'unlockable') return fn();
    if (r === 'timeout') throw busyError(lockFile);
    if (r === 'wait') sleepSync(acq.backoff);
  }
  try { return fn(); } finally { release(lockFile); }
}

// Same contract, for callers whose sequence contains an await -- policyloop.js backs its push off
// between retries, and the lock has to outlive those awaits or it guards nothing. Waiting yields to
// the event loop here instead of parking the thread.
async function withGitLockAsync(repoRoot, what, fn, opts) {
  if (DISABLED || typeof fn !== 'function') return fn();
  const o = opts || {};
  const staleMs = o.staleMs == null ? DEFAULT_STALE_MS : o.staleMs;
  const lockFile = lockFileFor(repoRoot);
  if (held.get(lockFile)) {
    held.set(lockFile, held.get(lockFile) + 1);
    try { return await fn(); } finally { held.set(lockFile, held.get(lockFile) - 1); }
  }

  const deadline = Date.now() + (o.waitMs == null ? DEFAULT_WAIT_MS : o.waitMs);
  const acq = makeAcquirer(lockFile, what, staleMs, deadline,
                           typeof o.onWait === 'function' ? o.onWait : null);
  for (;;) {
    const r = acq.step();
    if (r === 'got') break;
    if (r === 'unlockable') return fn();
    if (r === 'timeout') throw busyError(lockFile);
    if (r === 'wait') await new Promise(res => setTimeout(res, acq.backoff));
  }
  try { return await fn(); } finally { release(lockFile); }
}

const isBusy = e => !!(e && e.code === 'EGITLOCK');

module.exports = { withGitLock, withGitLockAsync, isBusy, lockFileFor };
