'use strict';
// Deletes model files nothing will use again, so nn/models stops growing without bound (it had
// reached 1,522 files and 28.5 GB on the desktop, and every roster sync reads the directory).
//
//   node nn/prune-models.js                         # dry run: what would go, and the space it frees
//   node nn/prune-models.js --apply                 # delete them
//   node nn/prune-models.js --apply --everyHours 6  # keep running (league-trainer.js starts this)
//
// Two reasons to delete, either one enough:
//
// REDUNDANT: older than the newest --keepNewest (12) of its line -- resume-NNN, ckpt-NNN, scratch-NNN,
// each variant lineage (ultra-m13-NNN, deep-m11-NNN, ...), dual-pop-NNN -- and at least --minAgeHours
// (48) old, whatever its rating. The training data is all kept, and a line's newer models, trained on
// more of it, usually beat its older ones; an old model the league still wants is seated and so kept
// below. This is where the space is: the resume/ckpt line alone is hundreds of 44 MB nets.
//
// PROVEN WEAK: any age, any family. Not the elastic cull's verdict -- that takes a face's SEAT on as
// little as two games and relies on "the model FILE survives on disk either way" (evolution-
// roster.js). This refits the whole results store (elo-results.json, every id ever rated) and needs
// EVERY face the model has played to sit confidently below the median of today's standing field:
// Bradley-Terry rating plus --z standard errors (1.28: 90% one-sided per face), with at least
// --minMatches matches on its best-measured face, and never an undefeated face (the cull reinstates
// those). Unmeasured is not weak.
//
// Never deleted, for either reason:
//   - anything seated in the roster's face pools (active, trial or waiting, at any depth);
//   - any model named in a live state file: the dual/mutant populations and their lineage roots,
//     lineage champions, committee members, medals, every machine's standing summary (history logs,
//     the results store and the gate's cell cache are skipped -- they name everything ever played);
//   - byte-for-byte twins of an alias, pool slot or medal (seed-population.js would re-import them,
//     and the gate finds best.json's checkpoint by its bytes);
//   - the newest file of each plainly numbered family: run.js numbers resume-NNN as the highest file
//     on disk plus one, so deleting the newest would hand its name, and its ratings, to the next net;
//   - the aliases themselves (best.json, value.json, ...), pool slots, backups and partial files.
// Every deletion is appended to models/.pruned.jsonl with the reason and evidence behind it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const dir = path.resolve(arg('dir', __dirname));
const modelsDir = path.join(dir, 'models');
const apply = process.argv.includes('--apply');
const everyHours = Math.max(0, +arg('everyHours', 0));
const firstDelayMin = Math.max(0, +arg('firstDelayMin', everyHours ? 10 : 0));
const Z = Math.max(0, +arg('z', 1.28));
const MIN_MATCHES = Math.max(1, +arg('minMatches', 4));
// 12, not 10: tournament.js fields the newest --tournamentRecent (12) checkpoints. 0 turns this rule off.
const KEEP_NEWEST = Math.max(0, +arg('keepNewest', 12));
const MIN_AGE_MS = Math.max(0, +arg('minAgeHours', 48)) * 3600000;
const MIN_FIELD = 10;
// A model's line and its place in it: resume-452 -> resume #452, ultra-m13-532 -> ultra-m13 #532,
// dual-pop-056-e40 -> dual-pop #56. Names without a trailing serial (seed-deep, wild shapes) have none.
const lineOf = name => { const m = /^([A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z][A-Za-z0-9_]*)*)-(\d+)(?:-e\d+)?$/.exec(name); return m ? { line: m[1], serial: +m[2] } : null; };

const ALIASES = new Set(['best.json', 'value.json', 'scratch.json', 'wide.json', 'ultra.json', 'deep.json',
  'l15_value.json', 'policy-joint-base.json', 'dual.json', 'policy.json', 'policy-fight.json']);
const neverCandidate = f => ALIASES.has(f) || /^pool-slot-\d+\.json$/.test(f) || /^best\./.test(f) ||
  /^dual-startup-probe-/.test(f) || /\.partial\.json$/.test(f) || f.startsWith('.');
const faceModel = id => String(id).replace(/(\+P)?@D[1-4]$/, '');
const isLadder = id => /^L\d+(\+corner)?$/.test(id);
const readJSON = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const listFiles = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name); } catch (e) { return []; } };

// Bradley-Terry over the whole store, seedElo as one-match priors: the same MM fit as
// elorank-legacy.js's fitBT and torch-train-dual.py's fit_store. Also each face's matches, whether
// it has ever been beaten, and a standard error from the Fisher information of the matches it played.
function fitStore(store) {
  const seed = store.seedElo || {}, ids = new Set(Object.keys(seed)), pairs = [];
  for (const [key, r] of Object.entries(store.results || {})) {
    const z = key.indexOf('|'); if (z < 1) continue;
    const w = +r.w || 0, l = +r.l || 0, d = +r.d || 0; if (w + l + d <= 0) continue;
    const a = key.slice(0, z), b = key.slice(z + 1); ids.add(a); ids.add(b); pairs.push([a, b, w, l, d]);
  }
  const order = [...ids].sort(), ix = new Map(order.map((id, i) => [id, i])), n = order.length;
  const wins = new Float64Array(n), matches = new Float64Array(n), beaten = new Uint8Array(n), edges = [];
  for (const [a, b, w, l, d] of pairs) {
    const i = ix.get(a), j = ix.get(b);
    wins[i] += w + d / 2; wins[j] += l + d / 2; matches[i] += w + l + d; matches[j] += w + l + d;
    if (l > 0 || d > 0) beaten[i] = 1;
    if (w > 0 || d > 0) beaten[j] = 1;
    edges.push([i, j, w + l + d]);
  }
  const W = Math.max(0.01, +store.seedWeightMatches || 1);
  let p = Float64Array.from(order, id => Math.pow(10, (+seed[id] || 0) / 400));
  const prior = Float64Array.from(p, q => W * q / (q + 1));
  for (let it = 0; it < 300; it++) {
    const den = Float64Array.from(p, v => W / (v + 1));
    for (const [i, j, m] of edges) { const q = m / Math.max(1e-12, p[i] + p[j]); den[i] += q; den[j] += q; }
    const nxt = Float64Array.from(p, (_, i) => (wins[i] + prior[i]) / Math.max(1e-12, den[i]));
    let delta = 0; for (let i = 0; i < n; i++) delta = Math.max(delta, Math.abs(nxt[i] - p[i]));
    p = nxt; if (delta < 1e-8) break;
  }
  const c = Math.pow(Math.log(10) / 400, 2), info = new Float64Array(n);
  for (const [i, j, m] of edges) { const q = p[i] / (p[i] + p[j]), f = m * q * (1 - q) * c; info[i] += f; info[j] += f; }
  const out = new Map();
  for (let i = 0; i < n; i++) out.set(order[i], { elo: 400 * Math.log10(Math.max(p[i], 1e-12)),
    se: info[i] > 0 ? 1 / Math.sqrt(info[i]) : Infinity, matches: matches[i], beaten: !!beaten[i] });
  return out;
}

// Every model-ish name a state file mentions, however it spells it: a bare name, a path, a face id,
// or a committee id with its members in brackets.
function namesIn(text, into) {
  for (const t of text.match(/[A-Za-z][A-Za-z0-9_.+@\[\],-]*/g) || []) {
    for (const part of [t, ...t.split(/[\[\],]/)]) {
      const name = faceModel(part.replace(/\.json$/, ''));
      if (/^[A-Za-z]/.test(name)) into.add(name);
    }
  }
}

function protectedNames(files) {
  const keep = new Set(), why = new Map();
  const mark = (name, reason) => { if (!keep.has(name)) { keep.add(name); why.set(name, reason); } };

  const roster = readJSON(path.join(modelsDir, '.evolution-roster.json')) || {};
  for (const pool of Object.values(roster.facePools || {}))
    for (const id of [...(pool.active || []), ...(pool.waiting || []), ...(pool.trial ? [pool.trial] : [])])
      mark(faceModel(typeof id === 'string' ? id : id && id.id), 'seated');

  // State files that name live models. The roster is handled above (its `latest` and `retired`
  // name everything it has ever seen), and so does the roster's model-meta cache. Records of past
  // games would protect everything ever played:
  // history logs, the results store, and the gate's cell cache (promotion-gate.js is handed its
  // panel by run.js; the cache only saves replaying a cell it has already played).
  const skip = f => f === '.evolution-roster.json' || f === '.pruned.jsonl' || f === '.model-meta-cache.json' || /history/i.test(f) ||
    f === 'elo-results.json' || f === '.gate-panel-cache.json' || !/\.(json|jsonl)$/.test(f);
  const stateFiles = [
    ...listFiles(modelsDir).filter(f => f.startsWith('.') && !skip(f)).map(f => path.join(modelsDir, f)),
    ...listFiles(dir).filter(f => !skip(f)).map(f => path.join(dir, f)),
  ];
  // Committees and policy entrants are model files that name other models (their members, their
  // value and policy halves). They are small; weight files are not read for this.
  for (const f of listFiles(modelsDir)) {
    if (f.startsWith('.') || !f.endsWith('.json')) continue;
    const p = path.join(modelsDir, f);
    try {
      if (fs.statSync(p).size > 4 << 20) continue;
      const text = fs.readFileSync(p, 'utf8');
      if (text.includes('"committee"') || text.includes('"policyEntrant"')) stateFiles.push(p);
    } catch (e) {}
  }
  const medalsDir = path.join(dir, 'medals');
  for (const m of fs.existsSync(medalsDir) ? fs.readdirSync(medalsDir, { withFileTypes: true }) : [])
    if (m.isDirectory()) stateFiles.push(...listFiles(path.join(medalsDir, m.name)).map(f => path.join(medalsDir, m.name, f)));
    else stateFiles.push(path.join(medalsDir, m.name));
  for (const p of stateFiles) {
    let st; try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.size > 4 << 20) continue;
    let text; try { text = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }
    const found = new Set(); namesIn(text, found);
    for (const name of found) mark(name, `named in ${path.relative(dir, p)}`);
  }

  // The newest of every plainly numbered family (resume-454, ckpt-533, scratch-041, ...), so no name
  // is reused. Names whose prefix already carries a number (ultra-m13-532, dual-pop-056-e40) come
  // from counters run.js persists, not from the files on disk.
  const newest = new Map();
  for (const f of files) {
    const m = /^([A-Za-z_-]+)(\d+)$/.exec(f.replace(/\.json$/, '')); if (!m) continue;
    const cur = newest.get(m[1]); if (!cur || +m[2] > cur.n) newest.set(m[1], { n: +m[2], name: m[1] + m[2] });
  }
  for (const { name } of newest.values()) mark(name, 'newest of its numbered family');
  return { keep, why };
}

// Byte-for-byte twins of a copy that outlives the prune. seed-population.js re-imports, under a new
// unrated name, any medal or models/ file whose bytes the roster can no longer see -- so deleting
// the twin of one would only buy a re-import and a fresh measurement. The sources are exactly what
// it reads: every medal directory machine-id.js lists (each machine's, and the legacy flat files
// published before machines had names), and the models/ files this never deletes itself (aliases,
// pool slots, best.* backups).
function twinsOfAliases(files) {
  const refs = listFiles(modelsDir).filter(f => f.endsWith('.json') && !f.startsWith('.') && neverCandidate(f)).map(f => path.join(modelsDir, f));
  for (const m of require('./machine-id.js').medalDirs(dir))
    refs.push(...listFiles(m.dir).filter(f => f.endsWith('.json') && f !== 'medals.json' && f !== 'elo-summary.json').map(f => path.join(m.dir, f)));
  const bySize = new Map();
  for (const p of refs) { try { const s = fs.statSync(p).size; (bySize.get(s) || bySize.set(s, []).get(s)).push(p); } catch (e) {} }
  const hash = p => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
  const refHashes = new Map(), twins = new Set();
  for (const f of files) {
    const p = path.join(modelsDir, f); let size; try { size = fs.statSync(p).size; } catch (e) { continue; }
    const same = bySize.get(size); if (!same) continue;
    const h = hash(p);
    for (const r of same) { if (!refHashes.has(r)) refHashes.set(r, hash(r)); if (refHashes.get(r) === h) { twins.add(f.replace(/\.json$/, '')); break; } }
  }
  return twins;
}

function pass() {
  const t0 = Date.now();
  const store = readJSON(path.join(dir, 'elo-results.json'));
  const summary = readJSON(require('./machine-id.js').summaryPath(dir));
  if (!store || !summary) { console.log('[prune] no results store or standing summary yet -- nothing judged'); return; }
  const fit = fitStore(store);

  const field = Object.entries(summary.players || {}).filter(([id]) => !isLadder(id) && fit.has(id)).map(([id]) => fit.get(id).elo).sort((a, b) => a - b);
  if (field.length < MIN_FIELD) { console.log(`[prune] only ${field.length} standing faces rated -- too few to judge against, skipping`); return; }
  const bar = field[Math.floor(field.length / 2)];

  const faces = new Map();
  for (const [id, r] of fit) { if (isLadder(id)) continue; const m = faceModel(id); (faces.get(m) || faces.set(m, []).get(m)).push({ id, ...r }); }

  const files = listFiles(modelsDir).filter(f => f.endsWith('.json') && !neverCandidate(f));
  const { keep, why } = protectedNames(files);
  const twins = twinsOfAliases(files.filter(f => !keep.has(f.replace(/\.json$/, ''))));

  // Each line's files, newest first.
  const lines = new Map(), place = new Map();
  for (const f of files) { const l = lineOf(f.replace(/\.json$/, '')); if (l) (lines.get(l.line) || lines.set(l.line, []).get(l.line)).push({ f, serial: l.serial }); }
  for (const [line, xs] of lines) { xs.sort((a, b) => b.serial - a.serial); xs.forEach((x, i) => place.set(x.f, { line, rank: i + 1 })); }

  const doomed = [], kept = { protected: 0, undefeated: 0, unmeasured: 0, notWeak: 0, unrated: 0 };
  for (const f of files) {
    const name = f.replace(/\.json$/, '');
    if (keep.has(name) || twins.has(name)) { kept.protected++; continue; }
    let st; try { st = fs.statSync(path.join(modelsDir, f)); } catch (e) { continue; }
    const at = place.get(f);
    if (KEEP_NEWEST && at && at.rank > KEEP_NEWEST && t0 - st.mtimeMs >= MIN_AGE_MS) {
      doomed.push({ file: f, bytes: st.size, reason: 'redundant', line: at.line, rank: at.rank }); continue;
    }
    const played = (faces.get(name) || []).filter(x => x.matches > 0);
    if (!played.length) { kept.unrated++; continue; }
    if (played.some(x => !x.beaten)) { kept.undefeated++; continue; }
    if (Math.max(...played.map(x => x.matches)) < MIN_MATCHES) { kept.unmeasured++; continue; }
    const upper = Math.max(...played.map(x => x.elo + Z * x.se));
    if (upper >= bar) { kept.notWeak++; continue; }
    const best = played.reduce((a, b) => (a.elo + Z * a.se >= b.elo + Z * b.se ? a : b));
    doomed.push({ file: f, bytes: st.size, reason: 'weak', upper, best: { id: best.id, elo: best.elo, se: best.se, matches: best.matches }, faces: played.length });
  }

  const gb = b => (b / 2**30).toFixed(2);
  const total = doomed.reduce((a, d) => a + d.bytes, 0);
  const nOf = r => doomed.filter(d => d.reason === r).length;
  const head = `[prune] redundant: past the newest ${KEEP_NEWEST} of its line and ${MIN_AGE_MS / 3600000}h+ old; weak: every played ` +
    `face's rating + ${Z} SE below the field median (${bar.toFixed(0)} Elo over ${field.length} standing faces), ${MIN_MATCHES}+ matches`;
  const keptLine = `kept ${files.length - doomed.length} of ${files.length} (protected ${kept.protected}, undefeated ${kept.undefeated}, ` +
    `under ${MIN_MATCHES} matches ${kept.unmeasured}, not proven weak ${kept.notWeak}, never rated ${kept.unrated})`;
  const describe = d => d.reason === 'redundant' ? `redundant: #${d.rank} newest of ${d.line}` :
    `weak: strongest face ${d.best.id} ${d.best.elo.toFixed(0)} +/- ${d.best.se.toFixed(0)} over ${d.best.matches} matches (upper ${d.upper.toFixed(0)})`;
  if (!apply) {
    console.log(`${head}\n[prune] DRY RUN -- would delete ${nOf('redundant')} redundant + ${nOf('weak')} proven-weak model(s), ${gb(total)} GB; ${keptLine}`);
    const reasons = {};
    for (const f of files) { const n = f.replace(/\.json$/, ''); const r = keep.has(n) ? why.get(n) : twins.has(n) ? 'twin of an alias, slot or medal' : null; if (r) reasons[r] = (reasons[r] || 0) + 1; }
    console.log('[prune] protected because: ' + Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join('; '));
    for (const d of doomed.sort((a, b) => b.bytes - a.bytes).slice(0, +arg('show', 25)))
      console.log(`  ${d.file.padEnd(40)} ${(d.bytes / 2**20).toFixed(1).padStart(7)} MB  ${describe(d)}`);
    return;
  }
  let freed = 0;
  const deleted = { redundant: 0, weak: 0 };
  const log = fs.openSync(path.join(modelsDir, '.pruned.jsonl'), 'a');
  try {
    for (const d of doomed) {
      try { fs.unlinkSync(path.join(modelsDir, d.file)); } catch (e) { continue; }   // in use or already gone
      deleted[d.reason]++; freed += d.bytes;
      fs.writeSync(log, JSON.stringify({ at: new Date().toISOString(), ...d, ...(d.reason === 'weak' ? { bar, z: Z } : { keepNewest: KEEP_NEWEST }) }) + '\n');
    }
  } finally { fs.closeSync(log); }
  console.log(`${head}\n[prune] deleted ${deleted.redundant} redundant + ${deleted.weak} proven-weak model(s), freed ${gb(freed)} GB; ` +
              `${keptLine} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

function loop() {
  try { pass(); } catch (e) { console.log(`[prune] pass failed: ${e.message} -- trying again in ${everyHours}h`); }
  setTimeout(loop, everyHours * 3600000);
}

if (everyHours > 0) setTimeout(loop, firstDelayMin * 60000);
else pass();
