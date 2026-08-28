'use strict';
// Give a fresh clone a starting population. A clone gets whatever git carries and nothing else --
// nn/.gitignore excludes data/ and models/ wholesale, and only named exceptions are force-added --
// and every one of those exceptions is INVISIBLE to the roster: evolution-roster's
// stableModelEntries excludes the five aliases (best/wide/ultra/deep/l15_value) and the ten
// pool-slot files by name. The medal aliases are real trained checkpoints but live in nn/medals/,
// which the roster never scans at all.
//
// Net effect, measured on a clean clone: the repo carries 20 distinct networks and the roster sees
// ZERO. A second machine starting the trainer therefore has to breed everything from nothing, which
// is not what "start from what's in the repo" means to anyone.
//
// This copies each distinct network across under a name the roster does see.
//
//   node nn/seed-population.js [--dry]
//
// Idempotent: anything already in the population is left alone, so it is safe before every launch.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const evo = require('./evolution-roster.js');
const mach = require('./machine-id.js');
const dir = __dirname;
const modelDir = path.join(dir, 'models');
const dry = process.argv.includes('--dry');

// The roster's OWN directory scan, exported rather than reimplemented here. A copy of that filter
// looked harmless and was not: it excluded by name only, while the real one also requires the file
// to parse as a usable model -- so the copy counted nn/models/.evolution-roster.json, the roster's
// own state file, as a member of the population it was reporting on. Asking the roster is the only
// way this cannot drift from what the roster actually sees.
const faceEntries = () => evo.stableModelEntries(dir);
// A source has to BE a model. nn/models/ is not only models: the roster keeps its own state as
// .evolution-roster.json right there, and copying that as a network is exactly the kind of silent
// nonsense a name-only filter waves through. modelMeta is the roster's own usability test.
const isModel = p => { try { return evo.modelMeta(p).usable; } catch (_) { return false; } };
// [tier, variant, provenance]. Tier: gold beats silver beats bronze, and anything unrecognised
// sorts last. Variant: a global medal outranks a per-depth one (gold.json over gold-d2.json) --
// the global bound is the one the medal ranking is actually made on. Provenance: a named machine
// outranks the legacy flat layout, whose medals predate machines having names at all.
const TIERS = ['gold', 'silver', 'bronze'];
function medalRank(m, file) {
  const base = path.basename(file, '.json');
  const tier = TIERS.findIndex(t => base === t || base.startsWith(t + '-'));
  return [tier < 0 ? TIERS.length : tier, /-d\d+$/.test(base) ? 1 : 0, m.id === 'legacy' ? 1 : 0];
}

const sha = p => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
const log = s => console.log(`[seed] ${s}`);
const ls = d => { try { return fs.readdirSync(d); } catch (_) { return []; } };

function main() {
  // EVERY machine's medals, not just this one's. That is what makes a second trainer worth running:
  // each box publishes its own gold/silver/bronze under its own name, and each box imports all of
  // them, so the top few from any training run anywhere end up in every population. A model that
  // crosses arrives UNRATED -- the rating store is local and untracked -- so it gets measured afresh
  // against the local field rather than inheriting the claim that made it a medallist. That is the
  // valuable half: it is independent replication, and it is how a 6-game 400-Elo gold was caught
  // reading -92 on 58 games.
  const sources = [], medalSources = [];
  for (const m of mach.medalDirs(dir)) {
    let meta = {}, published = '';
    try {
      const mj = JSON.parse(fs.readFileSync(path.join(m.dir, 'medals.json'), 'utf8'));
      meta = mj.medals || {};
      // The publish date, folded into the seed name (aug25) so the population reads as a history:
      // seed-laptop-gold-ckpt500-aug25 next to seed-laptop-gold-ckpt541-aug28 says at a glance that
      // laptop's gold moved on, and to what. The date is a LABEL, not identity -- identity is the
      // content hash, which is what lets a net demoted from gold to silver keep its original name
      // instead of re-entering as a "new" model every time its medal changes.
      const d = new Date(mj.updated || 0);
      if (+d > 0) published = '-' + d.toLocaleString('en', { month: 'short' }).toLowerCase() + d.getUTCDate();
    } catch (_) {}
    for (const f of ls(m.dir).sort()) {
      if (!f.endsWith('.json') || f === 'medals.json' || f === 'elo-summary.json') continue;   // metadata, not weights
      const p = path.join(m.dir, f);
      if (!isModel(p)) continue;
      // Named for where it came from AND what it was: a medal names the checkpoint it was copied
      // from (gold -> wide-m1-118), which outlives the alias rotating away from it, and the machine
      // prefix keeps two boxes' golds apart even when neither knows about the other.
      // The source is stripped of its own `seed-` prefix: a medal won by a previously-seeded model
      // would otherwise compound into seed-legacy-gold-seed-pool-slot-08 and get worse on every hop
      // between machines.
      const src = meta[path.basename(f, '.json')];
      const lineage = src && src.source ? '-' + String(src.source).replace(/^seed-/, '') : '';
      medalSources.push({ file: p, label: `${m.id}/${f}`, rank: medalRank(m, f),
                          name: `seed-${m.id}-${path.basename(f, '.json')}${lineage}${published}` });
    }
  }
  // Best claim first. The dedup below keeps whichever copy of a network it meets FIRST and skips
  // the rest, so this ordering decides the name the surviving face carries -- and unsorted, that
  // was alphabetical: a machine whose gold and bronze were the same net seeded it as "bronze",
  // and a net one machine called silver beat another machine's gold purely on the machine name
  // sorting earlier. Ranking by medal tier means the one face that survives is labelled with the
  // strongest claim anyone made for it, which is the only label worth keeping.
  medalSources.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] ||
                              a.rank[2] - b.rank[2] || a.label.localeCompare(b.label));
  sources.push(...medalSources);
  const alreadyFace = new Set(faceEntries().map(e => e.file));
  for (const f of ls(modelDir).sort()) {
    if (!f.endsWith('.json') || alreadyFace.has(f)) continue;   // already a face: nothing to seed
    if (!isModel(path.join(modelDir, f))) continue;
    sources.push({ file: path.join(modelDir, f), label: f, name: `seed-${path.basename(f, '.json')}` });
  }
  if (!sources.length) { log('nothing to seed from -- pull first'); return; }

  // Dedup by CONTENT against what the roster can ALREADY see. Two distinctions matter here and both
  // were got wrong first time round. Only a real FACE counts as already-present: a network sitting
  // in best.json or pool-slot-02.json is invisible to the roster, so treating it as covered would
  // leave it out of the population -- the exact bug this file exists to fix. And matching on content
  // rather than name is not tidiness: as shipped, medals/silver.json and medals/bronze.json are
  // byte-identical to each other AND to best.json, and the league rated that one network as two
  // faces 21 Elo apart on 34 and 22 games. Seeding it three times would rebuild that fiction here,
  // spend real compute measuring a network against itself, and feed the medal ranking a difference
  // known to be exactly zero.
  const faces = new Map();
  for (const e of faceEntries()) {
    try { faces.set(sha(e.path), e.file); } catch (_) {}
  }

  let added = 0, dup = 0, present = 0;
  const seeded = new Map();
  const taken = new Set(ls(modelDir));
  for (const s of sources) {
    let h; try { h = sha(s.file); } catch (_) { log(`unreadable: ${s.label}`); continue; }
    if (faces.has(h))  { present++; log(`${s.label} is already in the population as ${faces.get(h)}`); continue; }
    if (seeded.has(h)) { dup++;     log(`${s.label} is byte-identical to ${seeded.get(h)} -- skipped`); continue; }
    // Always `seed-`-prefixed, so it can never collide with an alias or the pool-slot pattern.
    // A name already taken by DIFFERENT content gets a content suffix rather than overwriting it:
    // one machine's gold-d1 can be a different net from one publish to the next, and quietly
    // swapping the weights under a name the league has already rated would make that face a moving
    // target -- the exact bug elorank snapshots its whole field to avoid.
    let name = `${s.name}.json`;
    if (taken.has(name)) name = `${s.name}-${h.slice(0, 6)}.json`;
    taken.add(name);
    if (!dry) fs.copyFileSync(s.file, path.join(modelDir, name));
    seeded.set(h, name);
    added++;
    log(`${dry ? 'would copy ' : ''}${s.label} -> models/${name}`);
  }

  // Counted, not assumed: --dry copies nothing, so reading the directory back would report the
  // population as unchanged and imply the seeding had failed.
  const now = faceEntries().length + (dry ? added : 0);
  log(`${added} seeded, ${dup} duplicate(s) skipped, ${present} already present ` +
      `(this machine is "${mach.machineId(dir)}")`);
  log(`population the roster ${dry ? 'would see' : 'sees'}: ${now} model(s)`);
  if (!now) log('WARNING: still zero -- the trainer would have to breed from nothing');
}
main();
