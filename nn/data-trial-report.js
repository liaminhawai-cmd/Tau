'use strict';
// How the data-amount trial is going: nets trained on ALL of the corpus vs its NEWEST 25%.
//
//   node nn/data-trial-report.js
//
// train-value.js alternates every kind of birth (resume, mutant, scratch, each variant lineage)
// between the two arms and torch-train-core.py logs each run to nn/data-trial.jsonl. This joins
// that log with the league: each net's best rated face (6+ games) from this machine's Elo summary,
// or, for a net the cull has already retired, the Elo it had when it went (evolution roster).
//
// Read it by kind, not just overall: a resume from best.json and a 30-epoch scratch net are
// different animals, and the arms only alternate within a kind. Validation error is NOT comparable
// between arms -- each arm validates on its own slice of games -- so only league Elo is shown.
const fs = require('fs');
const path = require('path');
const dir = __dirname;

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }
const faceModel = id => String(id).replace(/(\+P)?@D[1-9]$/, '');

let mid = null;
try { mid = require('./machine-id.js').machineId(dir); } catch (e) {}
const summary = (mid && readJson(path.join(dir, `elo-summary-${mid}.json`))) || readJson(path.join(dir, 'elo-summary.json')) || {};
const live = {};
for (const [id, r] of Object.entries(summary.players || {})) {
  if (r.kind !== 'nn' || r.elo == null || (r.games || 0) < 6 || !r.model) continue;
  const name = String(r.model).replace(/\\/g, '/').split('/').pop().replace(/\.json$/, '');
  if (!live[name] || r.elo > live[name].elo) live[name] = { elo: r.elo, face: id, games: r.games, retired: false };
}
const roster = readJson(path.join(dir, 'models', '.evolution-roster.json')) || {};
const retired = {};
for (const pool of Object.values(roster.facePools || {})) {
  for (const [id, rec] of Object.entries((pool && pool.retired) || {})) {
    if (!rec || rec.elo == null || (rec.games || 0) < 6) continue;
    const name = faceModel(id);
    if (!retired[name] || rec.elo > retired[name].elo) retired[name] = { elo: rec.elo, face: id, games: rec.games, retired: true };
  }
}

const runs = [];
try {
  for (const l of fs.readFileSync(path.join(dir, 'data-trial.jsonl'), 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { runs.push(JSON.parse(l)); } catch (e) {}
  }
} catch (e) {}
if (!runs.length) { console.log('No trial runs yet (nn/data-trial.jsonl is empty). Each new net adds one.'); process.exit(0); }

const kindOf = m => m.replace(/-\d+$/, '');
const rows = runs.map(r => ({ ...r, kind: kindOf(r.model), rating: live[r.model] || retired[r.model] || null }));
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const fmt = (a) => a.length ? `${mean(a).toFixed(0).padStart(5)} mean Elo over ${a.length} rated` : '    - no rated nets yet';

console.log(`Data trial: ${rows.length} nets trained (${rows.filter(r => r.arm === 'all').length} all data, ` +
            `${rows.filter(r => r.arm === 'newest25').length} newest 25%)\n`);
for (const kind of [...new Set(rows.map(r => r.kind))].sort()) {
  console.log(kind);
  for (const arm of ['all', 'newest25']) {
    const these = rows.filter(r => r.kind === kind && r.arm === arm);
    if (!these.length) continue;
    const elos = these.filter(r => r.rating).map(r => r.rating.elo);
    console.log(`  ${arm.padEnd(9)} ${fmt(elos)}   ` +
                these.map(r => `${r.model}${r.rating ? ` ${Math.round(r.rating.elo)}${r.rating.retired ? 'r' : ''}` : ' ?'}`).join(', '));
  }
}
const all = rows.filter(r => r.arm === 'all' && r.rating).map(r => r.rating.elo);
const n25 = rows.filter(r => r.arm === 'newest25' && r.rating).map(r => r.rating.elo);
console.log(`\noverall   all data ${fmt(all)}\n          newest25 ${fmt(n25)}`);
console.log('\n(r = retired by the cull; ? = not rated on 6+ games yet. Elo is each net\'s best face.)');
