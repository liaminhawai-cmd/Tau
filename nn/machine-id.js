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

module.exports = { machineId, setMachineId, medalRoot, myMedalDir, medalDirs, medalsMetaPath, sanitize };

if (require.main === module) {
  const dir = __dirname, a = process.argv.slice(2);
  const i = a.indexOf('--set');
  if (i >= 0) console.log(setMachineId(dir, a[i + 1]));
  else if (a.includes('--medaldir')) console.log(myMedalDir(dir));
  else console.log(machineId(dir));
}
