'use strict';
// Parole. An elastic-cull retirement is PERMANENT: reconcile() counts a retired face as "known",
// so the mint never offers it a seat again -- not even once the pool it died in has recovered.
//
// That is the right default for a face the league actually measured and rejected. It is the wrong
// one for a face swept out by a bucket-wide accident, and the D2/D3 wipeout was exactly that: while
// the cull weighted depth buckets by MEAN cost, a D2 face carried ~1080x the per-face hazard of a
// D1 face and a D3 face ~3900x, so anything living up there was retired for being RARE rather than
// for being weak. Policy entrants took the worst of it -- candidateFaces() gives them no D1 face at
// all, so D2/D3 was the only place they could ever live.
//
// Freeing a face leaves it neither active nor retired, which is what makes the mint see its model
// file as unseen and offer it the next free seat. Its s.latest reading is deliberately kept: the
// admission queue sorts on modelScore, so a paroled face re-enters ranked on what it already showed
// instead of behind every unrated newcomer.
const fs = require('fs');
const path = require('path');
const { atomicWrite } = require('./atomic-write.js');
const evo = require('./evolution-roster.js');

const dir = __dirname;
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const dry = process.argv.includes('--dry');
const pattern = String(arg('like', arg('face', ''))).trim();
const statePath = path.join(dir, 'models', '.evolution-roster.json');
const trunk = id => String(id).replace(/(\+P)?@D[1-4]$/, '');

if (!pattern) {
  console.error('[parole] usage: node nn/parole.js --like <substring of the face or model name> [--dry]');
  process.exit(1);
}

let s;
try { s = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
catch (_) { console.error(`[parole] no roster state at ${statePath}`); process.exit(1); }
if (!s.facePools) { console.error('[parole] roster has no face pools yet; nothing to parole'); process.exit(1); }

const usable = new Set(evo.stableModelEntries(dir).map(e => e.name));
const needle = pattern.toLowerCase();
const freed = [];

for (const depth of Object.keys(s.facePools)) {
  const pool = s.facePools[depth];
  if (!pool || !pool.retired) continue;
  for (const id of Object.keys(pool.retired)) {
    if (!id.toLowerCase().includes(needle)) continue;
    const r = pool.retired[id] || {};
    freed.push({ depth, id, reason: r.reason || '?', elo: r.elo, games: r.games, present: usable.has(trunk(id)) });
    if (!dry) delete pool.retired[id];
  }
}

if (!freed.length) {
  console.log(`[parole] nothing retired matches "${pattern}"`);
  const live = [];
  for (const depth of Object.keys(s.facePools))
    for (const id of (s.facePools[depth].active || []))
      if (id.toLowerCase().includes(needle)) live.push(`${id} (${depth}, already seated)`);
  if (live.length) console.log('[parole] but these are already in the league:\n  ' + live.join('\n  '));
  process.exit(0);
}

console.log(`[parole] ${dry ? 'would free' : 'freed'} ${freed.length} face(s) matching "${pattern}":`);
for (const f of freed) {
  const rating = Number.isFinite(+f.elo) ? `${Math.round(+f.elo)} Elo over ${+f.games || 0} games` : 'never rated';
  console.log(`  ${f.id.padEnd(46)} ${String(f.reason).padEnd(14)} ${rating}${f.present ? '' : '   [MODEL FILE MISSING -- cannot be re-minted]'}`);
}

const missing = freed.filter(f => !f.present);
if (missing.length) {
  const names = [...new Set(missing.map(f => trunk(f.id)))];
  console.log(`\n[parole] ${names.length} model file(s) are gone or unusable, so freeing them changes nothing:`);
  for (const n of names) console.log(`  models/${n}.json`);
  console.log('  (a policy entrant also needs both its valueFile and policyFile present to load)');
}

if (dry) { console.log('\n[parole] --dry: roster not written'); process.exit(0); }

atomicWrite(statePath, JSON.stringify(s, null, 1));
console.log(`\n[parole] roster written. The mint offers seats strongest-first and stops at the admission`);
console.log(`[parole] ceiling, so a paroled face takes the next opening rather than displacing anyone.`);
