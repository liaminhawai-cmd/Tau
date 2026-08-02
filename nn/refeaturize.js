// Rebuild every data row's feature vector from its stored pose, after a feature-set change.
//
//   node nn/refeaturize.js [--data nn/data] [--dry]
//
// This is the payoff for the `p` field: every row selfplay has ever written carries the raw pose
// (both pieces' x/y/rot) and whose turn it was (`m`), precisely so that a feature change means
// re-featurising existing data instead of throwing away weeks of accumulated games (which is what
// happened the FIRST time the feature set changed, before `p` existed). No physics replay needed:
// restore the pose, call features(), keep everything else about the row (z label, game id, mover,
// the pose itself) unchanged.
//
// Safety: each file is written to <name>.tmp first, the original is MOVED to data/backup-preNN/
// (NN = the old width, detected per file), and only then does the tmp take the original's place --
// a crash mid-run leaves originals recoverable. Idempotent: rows already at the current width are
// recomputed anyway (deterministic, same result), so rerunning is harmless. Rows with no pose
// cannot be migrated and are dropped with a count -- only ancient pre-`p` rows qualify, and any
// left in circulation would crash training loudly anyway (train.js's stale-data check).
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { features, N_FEATURES } = require('./features.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const dataDir = arg('data', path.join(__dirname, 'data'));
const dry = process.argv.includes('--dry');
const eng = createEngine();

const restoreTo = (p, m) => {
  eng.newGame();
  const g = eng.getG();
  g.pieces[0].x = p[0]; g.pieces[0].y = p[1]; g.pieces[0].rot = p[2];
  g.pieces[1].x = p[3]; g.pieces[1].y = p[4]; g.pieces[1].rot = p[5];
  eng.setActive(m);
};

let files = [];
try { files = fs.readdirSync(dataDir).filter(f => f.endsWith('.jsonl')); } catch (e) {
  console.error(`cannot read ${dataDir}: ${e.message}`); process.exit(1);
}
if (!files.length) { console.log(`no .jsonl files in ${dataDir} — nothing to do`); process.exit(0); }

console.log(`re-featurising ${files.length} file(s) in ${dataDir} to ${N_FEATURES} features` + (dry ? ' (dry run)' : ''));
const t0 = Date.now();
let totalRows = 0, migrated = 0, dropped = 0, already = 0;
for (const f of files) {
  const full = path.join(dataDir, f);
  const outLines = [];
  let fileDropped = 0, oldWidth = null;
  for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
    if (!line) continue;
    totalRows++;
    let j;
    try { j = JSON.parse(line); } catch (e) { fileDropped++; dropped++; continue; }
    if (!j.p || j.p.length !== 6 || (j.m !== 0 && j.m !== 1)) { fileDropped++; dropped++; continue; }
    if (oldWidth === null && j.f) oldWidth = j.f.length;
    if (j.f && j.f.length === N_FEATURES) already++;
    restoreTo(j.p, j.m);
    const nf = features(eng);
    // carry the row's metadata through: a re-featurise changes f, nothing else. These were being
    // dropped, which silently cost every downstream filter that reads them -- mv (which brain played
    // the move, used by the Elo/lineage work), src (non-standard opening) and adj (a result the komi
    // rule scored at the move cap rather than a piece going off the board).
    outLines.push(JSON.stringify({ f: nf.map(v => +v.toFixed(5)), z: j.z,
                                   p: j.p, m: j.m, ...(j.g != null ? { g: j.g } : {}),
                                   ...(j.src != null ? { src: j.src } : {}),
                                   ...(j.adj != null ? { adj: j.adj } : {}),
                                   ...(j.mv != null ? { mv: j.mv } : {}) }));
    migrated++;
  }
  if (dry) {
    console.log(`  ${f}: ${outLines.length} rows would migrate (${oldWidth} -> ${N_FEATURES})` +
                (fileDropped ? `, ${fileDropped} dropped (no pose)` : ''));
    continue;
  }
  // tmp -> move original into backup -> tmp takes its place; the backup dir is named for the OLD
  // width so successive migrations don't overwrite each other's backups
  const backupDir = path.join(dataDir, `backup-pre${oldWidth || 'unknown'}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const tmp = full + '.tmp';
  fs.writeFileSync(tmp, outLines.join('\n') + (outLines.length ? '\n' : ''));
  fs.renameSync(full, path.join(backupDir, f));
  fs.renameSync(tmp, full);
  console.log(`  ${f}: ${outLines.length} rows (${oldWidth} -> ${N_FEATURES})` +
              (fileDropped ? `, ${fileDropped} dropped (no pose)` : ''));
}
console.log(`\ndone: ${migrated}/${totalRows} rows migrated, ${dropped} dropped, ` +
            `${already} were already ${N_FEATURES}-wide (${((Date.now() - t0)/1000).toFixed(0)}s)`);
if (!dry) console.log(`originals moved to ${path.join(dataDir, 'backup-pre*')} — delete once training looks healthy`);
