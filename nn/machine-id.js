'use strict';
// Which machine is this, and where do its medals live.
//
// Every machine training on this repo publishes gold/silver/bronze to the SAME three filenames and
// pushes them to the same branch, so a second trainer does not add to the medal set -- it overwrites
// it, and whichever machine pushed last is the only one whose findings survive. The same is true of
// medals.json and the medal-annotated elo-summary.json beside them. Filing each machine's medals
// under its own name is what turns that clobber into an accumulation: nn/medals/<machine>/gold.json
// is only ever written by <machine>, so every machine's best work is preserved and every machine can
// seed from every other machine's.
//
//   node nn/machine-id.js                 -> print this machine's id
//   node nn/machine-id.js --medaldir      -> print this machine's medal directory
//   node nn/machine-id.js --set <name>    -> name this machine (sanitised), print the result
//
// The id lives in nn/.machine-id, which is gitignored on purpose: it is the one file that must
// differ between clones, so committing it would hand every machine the same identity and rebuild
// the collision this exists to remove.
const fs = require('fs');
const path = require('path');
const os = require('os');

const ID_FILE = '.machine-id';
// Lowercase, and only characters that are safe in a path, a git pathspec and a model filename --
// these ids end up in all three. A Windows hostname like PW0DV6B4 survives as pw0dv6b4; something
// typed with spaces or punctuation is folded to dashes rather than rejected, because a first-run
// prompt is the wrong place to argue about a name.
const sanitize = s => String(s == null ? '' : s).trim().toLowerCase()
  .replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 40);

function idPath(dir) { return path.join(dir, ID_FILE); }

// TAU_MACHINE wins over the file so a test (or a second checkout on one box) can take an identity
// without writing to the working tree.
function machineId(dir) {
  const env = sanitize(process.env.TAU_MACHINE);
  if (env) return env;
  try { const v = sanitize(fs.readFileSync(idPath(dir), 'utf8')); if (v) return v; } catch (_) {}
  const derived = sanitize(os.hostname()) || 'machine';
  // Best-effort: a read-only tree still gets a stable id for this process, it just re-derives it
  // next time. Failing the caller over an identity file would take down the trainer for nothing.
  try { fs.writeFileSync(idPath(dir), derived + '\n'); } catch (_) {}
  return derived;
}

function setMachineId(dir, name) {
  const v = sanitize(name);
  if (!v) return machineId(dir);
  fs.writeFileSync(idPath(dir), v + '\n');
  return v;
}

const medalRoot = dir => path.join(dir, 'medals');
const myMedalDir = dir => path.join(medalRoot(dir), machineId(dir));

// Every medal directory in the repo, this machine's included, plus the legacy flat layout last.
// The flat files are the medals published before machines had names; they are still real trained
// checkpoints and git still carries them, so they stay importable even though nothing writes them
// any more. `id` is what a caller should use to label anything derived from that directory.
function medalDirs(dir) {
  const root = medalRoot(dir), out = [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(root, e.name);
    try { if (fs.readdirSync(p).some(f => f.endsWith('.json'))) out.push({ id: e.name, dir: p }); } catch (_) {}
  }
  if (entries.some(e => e.isFile() && e.name.endsWith('.json'))) out.push({ id: 'legacy', dir: root });
  return out;
}

// Where a LOCAL reader should look for "the current medal holders" -- this machine's, falling back
// to the legacy flat file so a clone that has not published yet still resolves to something real.
function medalsMetaPath(dir) {
  const mine = path.join(myMedalDir(dir), 'medals.json');
  if (fs.existsSync(mine)) return mine;
  return path.join(medalRoot(dir), 'medals.json');
}

// The published rating summary. The medals' collision one level up, and worse: every machine
// derives its own elo-summary.json from its own elo-results.json (which .gitignore keeps local on
// purpose, for the independent re-measurement a second trainer exists to provide), then writes and
// pushes that derivation under the one shared name. So on a two-machine branch the file is not a
// summary, it is a race -- and unlike the medals it is a TRACKED file both sides rewrite every
// rating checkpoint, so the losing machine's next pull aborts with "Your local changes to the
// following files would be overwritten by merge" and takes the whole data sync down with it.
// Observed live on pw0dv6b4: six aborted pulls, five skipped status pushes and one refused
// fast-forward in a single session, every one of them naming this file. Naming it per machine is
// what turns that race back into an accumulation.
const summaryFile = dir => path.join(dir, `elo-summary-${machineId(dir)}.json`);
// Where a READER should look: this machine's summary, falling back to the pre-naming shared file so
// a clone that has not rated anything yet still resolves to something real (and so the summaries
// already in git history stay readable).
function summaryPath(dir) {
  const mine = summaryFile(dir);
  if (fs.existsSync(mine)) return mine;
  return path.join(dir, 'elo-summary.json');
}

// Self-play batch files are the same shared-name problem in the data directory: run.js numbers them
// from the highest batch-NNN.jsonl on disk, so two machines independently produce a batch-107 and
// git is handed two different files claiming one path. New batches carry the machine id. The
// counter's pattern still matches the un-prefixed legacy names, so numbering continues from the
// existing history instead of restarting at 1 and colliding with all of it.
const batchName = (dir, num) => `batch-${machineId(dir)}-${String(num).padStart(3, '0')}.jsonl`;
const BATCH_RX = /^batch-(?:[a-z0-9._-]+-)?(\d+)\.jsonl$/;

module.exports = { machineId, setMachineId, medalRoot, myMedalDir, medalDirs, medalsMetaPath, sanitize,
  summaryFile, summaryPath, batchName, BATCH_RX };

if (require.main === module) {
  const dir = __dirname, a = process.argv.slice(2);
  const i = a.indexOf('--set');
  if (i >= 0) console.log(setMachineId(dir, a[i + 1]));
  else if (a.includes('--medaldir')) console.log(myMedalDir(dir));
  else console.log(machineId(dir));
}
