'use strict';
// Human wins over the trained nets, from every client, into nn/data.
//
// The game (index.html -- web, Steam, mobile all run it) posts every game a human wins against a
// net rung to Supabase's ladder_wins table (WebPrototype/server/ladder_wins_migration.sql): the
// pose each turn started from and who moved, the same turn list PLAY-LEAGUE saves. This pulls the
// new ones, writes them as training rows in the schema human-league.js's finish() writes -- features,
// discounted result, pose, mover -- to nn/data/web-<machine>.jsonl, and deletes what it pulled from
// the table. git is the copy that lasts; the table only holds games not yet fetched.
//
// The trainer reads every nn/data/*.jsonl, so nothing else changes for these rows to be trained on.
// run.js calls pullWebGames() on its scheduler and pushes the file with its other artefacts; run it
// by hand with
//
//   node nn/pull-web-games.js            (PULL-WEB-GAMES.bat)
//
// Reading the table needs the project's service-role key (Supabase dashboard: Project Settings ->
// API keys). It is a secret that bypasses every row-level rule, so it lives ONLY on the training
// machine: the SUPABASE_SERVICE_KEY environment variable, or the file nn/.supabase-service-key
// (gitignored). Never in index.html, never committed. Without it this does nothing.
//
// Only one machine should pull: whichever does deletes the rows it took.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const machine = require('./machine-id.js');
const { createEngine } = require('./engine.js');
const { features } = require('./features.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lwjanmztbtfipsyfrcwg.supabase.co';
const KEY_FILE = path.join(dir, '.supabase-service-key');
const STATE_FILE = path.join(dir, '.web-games-state.json');   // { lastId }: never write a game twice
const DATA = path.join(dir, 'data', `web-${machine.machineId(dir)}.jsonl`);
const DISCOUNT = 0.995;   // arena.js's own result discount, as human-league.js uses
const PAGE = 200;

function serviceKey() {
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY.trim();
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim() || null; } catch (e) { return null; }
}
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return { lastId: 0 }; } }

let eng = null;
function setPose(p, m) {   // human-league.js's setPose
  eng.newGame();
  const g = eng.getG();
  g.pieces.forEach((pc, k) => { pc.x = +p[3*k]; pc.y = +p[3*k + 1]; pc.rot = +p[3*k + 2]; });
  g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
  g.pinned = null; g.pivot = null; g.over = false; g.winner = null;
  eng.setActive(m);
}
const r4 = v => +(+v).toFixed(4);

// One won game -> its rows, or null if it does not hold together. The server already checked each
// turn's shape; this checks the game: sides alternate, every number is finite, and the winner
// (the human, colour) moved in it.
function rowsFor(w) {
  const turns = w.turns, human = w.colour, n = Array.isArray(turns) ? turns.length : 0;
  if (n < 2 || (human !== 0 && human !== 1)) return null;
  for (let i = 0; i < n; i++) {
    const t = turns[i];
    if (!t || (t.m !== 0 && t.m !== 1) || !Array.isArray(t.pose) || t.pose.length !== 6 || !t.pose.every(Number.isFinite)) return null;
    if (i && t.m === turns[i - 1].m) return null;
  }
  if (!turns.some(t => t.m === human)) return null;
  eng ||= createEngine();
  const out = [], gid = `web-${w.id}`;
  for (let i = 0; i < n; i++) {
    const t = turns[i];
    setPose(t.pose, t.m);
    const z = (t.m === human ? 1 : -1)*Math.pow(DISCOUNT, n - i);
    out.push(JSON.stringify({ f: features(eng).map(v => +v.toFixed(5)), z: r4(z), p: t.pose.map(r4), m: t.m, g: gid,
                              mv: t.m === human ? 'human:web' : `L${w.level}`, src: 'web' }));
  }
  return out;
}

async function api(key, method, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ladder_wins?${query}`,
                          { method, headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`${method} ladder_wins: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return method === 'GET' ? res.json() : null;
}

// Returns { games, rows, file } -- file is the repo-relative path to push when rows were written --
// or { skipped } when there is no key.
async function pullWebGames(log = console.log) {
  const key = serviceKey();
  if (!key) return { skipped: 'no service key (SUPABASE_SERVICE_KEY or nn/.supabase-service-key)' };
  const state = readState();
  let games = 0, rows = 0, rejected = 0;
  for (;;) {
    const page = await api(key, 'GET', `select=id,level,colour,turns,client&id=gt.${state.lastId}&order=id.asc&limit=${PAGE}`);
    if (!page.length) break;
    const out = [];
    for (const w of page) {
      const r = rowsFor(w);
      if (r) { out.push(...r); games++; } else rejected++;
    }
    // Rows on disk and the cursor moved BEFORE anything is deleted: a crash in between leaves the
    // games in the table, and the cursor keeps the next pull from writing them a second time.
    if (out.length) { fs.mkdirSync(path.dirname(DATA), { recursive: true }); fs.appendFileSync(DATA, out.join('\n') + '\n'); }
    rows += out.length;
    state.lastId = page[page.length - 1].id;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    if (page.length < PAGE) break;
  }
  if (state.lastId) {
    try { await api(key, 'DELETE', `id=lte.${state.lastId}`); }
    catch (e) { log(`web games: pulled, but could not clear them from Supabase (${e.message}) -- will retry next pull`); }
  }
  if (games || rejected) log(`web games: ${games} human win(s) -> ${rows} rows in ${path.relative(path.join(dir, '..'), DATA)}` +
                             (rejected ? `; ${rejected} rejected as malformed` : ''));
  return { games, rows, file: rows ? path.relative(path.join(dir, '..'), DATA).replace(/\\/g, '/') : null };
}

module.exports = { pullWebGames, rowsFor };

if (require.main === module) {
  pullWebGames().then(r => {
    if (r.skipped) { console.log(`Nothing pulled: ${r.skipped}.`); process.exitCode = 1; }
    else if (!r.games) console.log('No new web wins.');
    else console.log(`Done. The trainer reads ${r.file} on its next pass; commit it (git add -f) to share it.`);
  }).catch(e => { console.error(e.message); process.exitCode = 1; });
}
