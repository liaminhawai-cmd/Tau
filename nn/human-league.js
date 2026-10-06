'use strict';
// You, in the league. Serves the game on this machine with a League panel bolted on
// (human-league-client.js), and plays the AI side of every game with the league's own brain for
// that face -- arena.js's makeBrain, temperature 0, the same search the league rates -- so a game
// against resume-605@D2 here is a game against the player the league calls resume-605@D2.
//
//   node nn/human-league.js [--name liam] [--port 8765] [--noOpen]      (PLAY-LEAGUE.bat)
//
// You are only in the league while you play: nothing schedules you. "Next game" picks the face
// nearest your rating (or the one you chose) and your game jumps the queue -- this process runs
// above normal priority, so the opponent thinks ahead of the league's own matches.
//
// Every finished game is real league evidence and real training data:
//   - nn/human-results.jsonl gets one line per game; elorank-legacy.js folds it into the official
//     ratings at its next pass, where you appear as human:<name>. Games where you took a move back
//     are rated as human:<name>+undo instead, so your own rating stays a clean measurement while
//     the take-back games still say how strong you-plus-rewinds is.
//   - nn/data/human-<machine>.jsonl gets the positions, in the same row schema as every league
//     game (features, result, pose, mover, the AI's search score), so training picks them up.
//     With take-backs a game is a tree: every line you finished is saved -- the last one in full,
//     each earlier one from the move where it left the last one -- so a loss you rewound out of
//     still teaches what happens after the move you took back, and the line that beat the face
//     teaches the whole way.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const dir = __dirname, root = path.join(dir, '..');
const clean = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 24);
let userName = ''; try { userName = os.userInfo().username; } catch (e) {}
const NAME = clean(arg('name', process.env.TAU_PLAYER || userName)) || 'me';
const HUMAN = `human:${NAME}`, HUMAN_UNDO = `${HUMAN}+undo`;
const PORT = +arg('port', 8770);   // the live ladder sits on 8765
const RESULTS = path.join(dir, 'human-results.jsonl');
const SESSIONS = path.join(dir, 'human-sessions');
const machine = require('./machine-id.js');
const DATA = path.join(dir, 'data', `human-${machine.machineId(dir)}.jsonl`);
const summaryFile = machine.summaryFile(dir);
const DISCOUNT = 0.995;   // arena.js's own result discount, so these rows read like every other game

const { createEngine } = require('./engine.js');
const { features } = require('./features.js');
const { planScore } = require('./nnai.js');
const { makeBrain } = require('./arena.js');
const eng = createEngine();

try { os.setPriority(0, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch (e) {}

// ---------- the league as it stands ----------
let sumCache = { mtime: 0, players: {} };
function summary() {
  try {
    const st = fs.statSync(summaryFile);
    if (st.mtimeMs !== sumCache.mtime) sumCache = { mtime: st.mtimeMs, players: JSON.parse(fs.readFileSync(summaryFile, 'utf8')).players || {} };
  } catch (e) {}
  return sumCache.players;
}
const faceRe = /^(.*?)(\+P)?@D(\d)$/;
function faces() {
  const out = [];
  for (const [id, r] of Object.entries(summary())) {
    if ((r.kind !== 'nn' && r.kind !== 'committee') || !Number.isFinite(+r.elo)) continue;
    const m = faceRe.exec(id);
    if (!m || !fs.existsSync(path.join(dir, 'models', m[1] + '.json'))) continue;
    out.push({ id, elo: Math.round(+r.elo), games: +r.games || 0, depth: +m[3], kind: r.kind === 'committee' ? 'committee' : (r.brain || 'nn') });
  }
  return out.sort((a, b) => b.elo - a.elo);
}
function readResults() {
  const out = [];
  try {
    for (const l of fs.readFileSync(RESULTS, 'utf8').split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch (e) {} }
  } catch (e) {}
  return out;
}
// Your rating right now, before the league's next pass makes it official: the one number that best
// explains your results against the faces' ratings at the time you played them, starting from one
// drawn game against the middle of the field so a first win or loss cannot run off to infinity.
function provisional(id, fieldMid) {
  const games = readResults().filter(r => r.human === id && Number.isFinite(+r.faceElo));
  const obs = games.map(r => ({ opp: +r.faceElo, s: (+r.w || 0) + 0.5*(+r.d || 0), n: (+r.w || 0) + (+r.l || 0) + (+r.d || 0) })).filter(o => o.n > 0);
  obs.push({ opp: fieldMid, s: 0.5, n: 1 });
  let x = fieldMid;
  for (let it = 0; it < 100; it++) {
    let g = 0, h = 0;
    for (const o of obs) { const p = 1/(1 + Math.pow(10, (o.opp - x)/400)); g += o.s - o.n*p; h += o.n*p*(1 - p); }
    const step = Math.max(-200, Math.min(200, (g/Math.max(h, 1e-9))*400/Math.LN10));
    x += step;
    if (Math.abs(step) < 0.01) break;
  }
  const w = games.reduce((a, r) => a + (+r.w || 0), 0), l = games.reduce((a, r) => a + (+r.l || 0), 0), d = games.reduce((a, r) => a + (+r.d || 0), 0);
  return { elo: Math.round(x), games: games.length, w, l, d };
}
function me() {
  const fs_ = faces(), elos = fs_.map(f => f.elo).sort((a, b) => a - b), mid = elos.length ? elos[elos.length >> 1] : 0;
  const s = summary(), off = id => s[id] && Number.isFinite(+s[id].elo) ? { elo: Math.round(+s[id].elo), games: +s[id].games || 0 } : null;
  // Matchmaking follows the rating of the way you last played: after a game with take-backs it
  // matches on you+undo, after a clean one on you.
  const last = readResults().filter(r => r.human === HUMAN || r.human === HUMAN_UNDO).pop();
  const clean = provisional(HUMAN, mid), undo = provisional(HUMAN_UNDO, mid);
  const matchOn = last && last.human === HUMAN_UNDO ? 'undo' : 'clean';
  return { name: NAME, id: HUMAN, provisional: clean, official: off(HUMAN), matchOn,
           matchElo: matchOn === 'undo' ? undo.elo : clean.elo,
           undo: { id: HUMAN_UNDO, provisional: undo, official: off(HUMAN_UNDO) } };
}
// The face to play next: the three nearest your rating, never the one you just played if there is a
// choice, picked at random among them so the same position is not served every time.
function suggest(rating, last) {
  const fs_ = faces();
  if (!fs_.length) return null;
  let pool = fs_.slice().sort((a, b) => Math.abs(a.elo - rating) - Math.abs(b.elo - rating)).slice(0, 4);
  if (pool.length > 1) pool = pool.filter(f => f.id !== last);
  return pool.slice(0, 3)[Math.floor(Math.random()*Math.min(3, pool.length))].id;
}

// ---------- the league's brain for a face ----------
// The same mapping elorank-legacy.js's facePlayer makes from a face id to arena flags.
const brains = new Map();
function brainFor(id) {
  if (brains.has(id)) { const b = brains.get(id); brains.delete(id); brains.set(id, b); return b; }
  const m = faceRe.exec(id);
  if (!m) throw new Error('not a face id: ' + id);
  const name = m[1], plus = !!m[2], depth = +m[3], model = path.join(dir, 'models', name + '.json');
  const j = JSON.parse(fs.readFileSync(model, 'utf8'));
  const mk = (spec, d, policyPath = null, ab = false, dualPolicy = false) =>
    makeBrain(spec, eng, d, 4, false, policyPath, null, ab, 3, 1, 3, false, dualPolicy, true);
  let b;
  if (j.committee === true) b = mk(j.spec, +j.depth || depth);
  else if (j.policyEntrant === true) b = mk(`nn:0:${path.resolve(path.dirname(model), j.valueFile || '')}`, depth, path.resolve(path.dirname(model), j.policyFile || ''), true);
  else if (j.dual === true) b = mk(`dual:0:${model}`, depth, null, plus, plus);
  else b = mk(`nn:0:${model}`, depth);
  b.faceDepth = depth;
  brains.set(id, b);
  while (brains.size > 4) brains.delete(brains.keys().next().value);
  return b;
}
function setPose(p, m) {
  eng.newGame();
  const g = eng.getG();
  g.pieces.forEach((pc, k) => { pc.x = +p[3*k]; pc.y = +p[3*k + 1]; pc.rot = +p[3*k + 2]; });
  g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
  g.pinned = null; g.pivot = null; g.over = false; g.winner = null;
  eng.setActive(m);
}
function move(face, pose, active) {
  const b = brainFor(face), t0 = Date.now();
  setPose(pose, active);
  const plan = b.fn(active);
  const sc = plan && b.scored ? planScore(plan, b.depth || b.faceDepth) : null;
  return { plan: plan ? { pivotIdx: plan.pivotIdx, dir: plan.dir, targetRad: plan.targetRad } : null,
           ...(sc || {}), ms: Date.now() - t0 };
}

// ---------- finished games -> league evidence + training rows ----------
const sessFile = id => path.join(SESSIONS, clean(id) + '.json');
const r4 = v => +(+v).toFixed(4);
function saveLine(body) {
  fs.mkdirSync(SESSIONS, { recursive: true });
  let s = null;
  try { s = JSON.parse(fs.readFileSync(sessFile(body.session), 'utf8')); } catch (e) {}
  s ||= { session: body.session, face: body.face, faceElo: body.faceElo, humanSide: body.humanSide, started: new Date().toISOString(), lines: [] };
  s.lines.push({ turns: body.turns, winner: body.winner, adjudicated: !!body.adjudicated, undo: !!body.undo, at: new Date().toISOString() });
  s.undo = s.undo || !!body.undo;
  fs.writeFileSync(sessFile(body.session), JSON.stringify(s));
}
const sameTurn = (a, b) => a && b && a.m === b.m && a.pose.every((v, k) => Math.abs(v - b.pose[k]) < 1e-3);
function finish(sessionId) {
  let s;
  try { s = JSON.parse(fs.readFileSync(sessFile(sessionId), 'utf8')); } catch (e) { return null; }
  const lines = (s.lines || []).filter(l => Array.isArray(l.turns) && l.turns.length);
  try { fs.unlinkSync(sessFile(sessionId)); } catch (e) {}
  if (!lines.length) return null;
  const final = lines[lines.length - 1], rated = s.undo ? HUMAN_UNDO : HUMAN, ai = 1 - s.humanSide;
  const komi = eng.CFG.komiLoss;
  // Rows: the last line in full, every earlier one from where it left the last one.
  const out = [];
  lines.forEach((line, k) => {
    if (line.winner == null) return;                    // a level finish has no result to learn
    let from = 0;
    if (line !== final) while (from < line.turns.length && sameTurn(line.turns[from], final.turns[from])) from++;
    const scale = line.adjudicated ? komi : 1, n = line.turns.length, gid = `human-${clean(s.session)}-${k}`;
    for (let i = from; i < n; i++) {
      const t = line.turns[i];
      setPose(t.pose, t.m);
      const z = scale*(t.m === line.winner ? 1 : -1)*Math.pow(DISCOUNT, n - i);
      const human = t.m === s.humanSide;
      out.push(JSON.stringify({ f: features(eng).map(v => +v.toFixed(5)), z: r4(z), p: t.pose.map(r4), m: t.m, g: gid,
                                mv: human ? rated : s.face, src: 'human', ...(line.adjudicated ? { adj: 1 } : {}),
                                ...(!human && t.sv != null ? { sv: t.sv, svd: t.svd } : {}) }));
    }
  });
  if (out.length) { fs.mkdirSync(path.dirname(DATA), { recursive: true }); fs.appendFileSync(DATA, out.join('\n') + '\n'); }
  // The rating: the line you finished on, one game. A finish on the move cap is a draw in the
  // league's own match scoring (arena counts komi wins apart from wins), so it is one here too.
  const won = !final.adjudicated && final.winner === s.humanSide, lost = !final.adjudicated && final.winner === ai;
  const rec = { id: s.session, human: rated, face: s.face, faceElo: s.faceElo, w: won ? 1 : 0, l: lost ? 1 : 0, d: won || lost ? 0 : 1,
                humanSide: s.humanSide, plies: final.turns.length, lines: lines.length, rows: out.length, adjudicated: !!final.adjudicated,
                at: new Date().toISOString() };
  fs.appendFileSync(RESULTS, JSON.stringify(rec) + '\n');
  console.log(`[league] ${rated} vs ${s.face}: ${won ? 'won' : lost ? 'lost' : 'drew'}` +
              `${lines.length > 1 ? ` (${lines.length} lines with take-backs)` : ''}; ${out.length} training rows`);
  return rec;
}
// A session left open by a closed tab or a crash is finished on the next start, so a game you won
// is never lost to the browser going away.
function finishLeftovers() {
  let files = []; try { files = fs.readdirSync(SESSIONS).filter(f => f.endsWith('.json')); } catch (e) {}
  for (const f of files) finish(f.slice(0, -5));
}

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
                '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
                '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 8e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); req.on('error', reject);
  });
}
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  try {
    if (u.pathname === '/league/state') {
      const m = me();
      return send(res, 200, { me: m, faces: faces(), suggested: suggest(m.matchElo, u.searchParams.get('last')) });
    }
    if (u.pathname === '/league/move' && req.method === 'POST') {
      const b = await readBody(req);
      return send(res, 200, move(String(b.face), b.pose, +b.active));
    }
    if (u.pathname === '/league/line' && req.method === 'POST') { saveLine(await readBody(req)); return send(res, 200, { ok: true }); }
    if (u.pathname === '/league/finish' && req.method === 'POST') {
      const b = await readBody(req);
      return send(res, 200, { result: finish(String(b.session || '')), me: me() });
    }
    if (u.pathname === '/league-client.js') return send(res, 200, fs.readFileSync(path.join(dir, 'human-league-client.js')), TYPES['.js']);
    // The site's service worker caches GETs; here it would serve a stale /league/state. This one
    // takes its place and removes itself, so every request on this origin goes to this server.
    if (u.pathname === '/sw.js') return send(res, 200, "self.addEventListener('install',()=>self.skipWaiting());" +
                                                    "self.addEventListener('activate',()=>self.registration.unregister());", TYPES['.js']);
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found', 'text/plain');
    if (path.basename(file) === 'index.html' && path.dirname(file) === root) {
      const html = fs.readFileSync(file, 'utf8').replace(/<\/body>(?![\s\S]*<\/body>)/, '<script src="/league-client.js"></script>\n</body>');
      return send(res, 200, html, TYPES['.html']);
    }
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  } catch (e) {
    console.error('[league] ' + req.method + ' ' + u.pathname + ' failed: ' + e.message);
    return send(res, 500, { error: e.message });
  }
});

if (require.main === module) {
  finishLeftovers();
  // Next free port if this one is taken (a second copy, or anything else on it).
  let port = PORT;
  server.on('error', e => {
    if (e.code === 'EADDRINUSE' && port < PORT + 10) { port++; server.listen(port, '127.0.0.1'); return; }
    console.error('[league] cannot start: ' + e.message); process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1');
  server.on('listening', () => {
    const url = `http://127.0.0.1:${port}/index.html#league`;
    const m = me();
    console.log(`[league] you are ${HUMAN} (provisional ${m.provisional.elo} over ${m.provisional.games} game(s)` +
                (m.official ? `, official ${m.official.elo}` : '') + `); ${faces().length} faces to play`);
    console.log(`[league] open ${url} -- leave this window open while you play; close it when you are done`);
    if (!process.argv.includes('--noOpen')) {
      if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], () => {});
      else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => {});
    }
  });
}
module.exports = { finish, saveLine, move, faces, provisional, suggest, HUMAN, HUMAN_UNDO };
