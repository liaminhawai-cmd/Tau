'use strict';
// The live-ladder gauntlet: every new net plays every rung the shipped game has.
//
//   node nn/rung-gauntlet.js --queue            (what run.js starts: every new model not played yet)
//   node nn/rung-gauntlet.js --net nn/models/resume-684.json [--depth 2]
//
// WHY: the league pairs by score, so a rung rated -200 almost never meets a net rated +270, and the
// one way the ladder still beats the top nets (L9 = menu rung 10, as Blue, every medal net, 13 Oct)
// never shows up anywhere. This plays the rungs on purpose.
//
// THE RULE (the user's): each face is played with the net as RED first -- Red is the side every
// net-vs-rung loss so far has come from. A Red win counts the face as beaten. A Red loss or draw
// also gets the BLUE game, so the record says whether it was a split or a full loss. A net that
// beats every face as Red then confirms every face as Blue too (rare, so cheap); a clean sweep makes
// it a candidate for a NEW top rung at the depth it played: weights exported to
// nn/ladder-candidates/<name>-D<d>.{bin,meta.json}, and appending the rung is a reviewed PR against
// the game. Nets that fall short just carry on in the league, rated by Elo as before.
//
// TOP DOWN (the user's, 20 Oct): faces are played from the top rung down, and the run stops at the
// first face the net does not beat as Red (after its Blue game, for the split-or-full-loss record).
// A pass needs every face anyway, so the rungs below a loss cost an hour per net and decide nothing.
//
// FACES: the rungs are the SHIPPED game's, read from a checkout of main (--live, default a git
// worktree at ../../Tau-live next to this checkout, created and refreshed automatically): its
// index.html for the brains and RUNG_TO_AI_LADDER for which menu rung is which, its committee/ for
// the net rungs' weights. Rungs from L7 up flip a corner-opening coin in the app (unless marked
// noCorner), so each of those is two faces here with the coin pinned, as the league does.
// The net itself is loaded and searched with THIS checkout's net.js/nnai.js, so it plays exactly as
// it does in the league; features.js is the same file in both.
//
// Every decided game is also written as training rows to nn/data/gauntlet-<day>.jsonl (selfplay's
// schema), so these games teach the nets the very lines they lose. Results: nn/rung-gauntlet.jsonl.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const dir = __dirname;
function arg(name, dflt) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; }
const has = name => process.argv.includes('--' + name);
const log = m => console.log(`[gauntlet] ${m}`);

// ---- the live checkout ----------------------------------------------------------------------
function ensureLive(live) {
  const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  git(['fetch', '-q', 'origin', 'main'], dir);
  if (!fs.existsSync(path.join(live, 'index.html'))) {
    const r = git(['worktree', 'add', '--detach', live, 'origin/main'], dir);
    if (r.status !== 0) throw new Error('could not create the live checkout at ' + live + ': ' + (r.stderr || '').trim());
    log(`created the live-game checkout at ${live}`);
  } else {
    const r = git(['checkout', '-q', '--detach', 'origin/main'], live);
    if (r.status !== 0) log(`could not refresh ${live} (${(r.stderr || '').trim()}); using it as it is`);
  }
}

function loadLive(live) {
  const eng = require(path.join(live, 'nn', 'engine.js')).createEngine();
  const html = fs.readFileSync(path.join(live, 'index.html'), 'utf8');
  const m = /RUNG_TO_AI_LADDER\s*=\s*\[([^\]]+)\]/.exec(html);
  if (!m) throw new Error('the live index.html has no RUNG_TO_AI_LADDER');
  const map = m[1].split(',').map(s => +s.trim());
  if (eng.AI_LADDER.some(d => d && d.nets)) require(path.join(live, 'nn', 'committee-nets.js')).equipLadderNets(eng);
  const minCorner = +((/CORNER_OPENING_MIN_LEVEL\s*=\s*(\d+)/.exec(html) || [])[1] || 7);
  const faces = [];
  map.forEach((li, r) => {
    const def = eng.AI_LADDER[li];
    const coin = !def.noCorner && li + 1 >= minCorner;
    faces.push({ rung: r + 1, li, corner: false, id: `R${r + 1}` });
    if (coin) faces.push({ rung: r + 1, li, corner: true, id: `R${r + 1}+corner` });
  });
  return { eng, map, faces, html };
}

// ---- one game ---------------------------------------------------------------------------------
function playGame(eng, face, netFn, netIsBlue, rowsOut, gameId, netId) {
  const { features } = require('./features.js');
  eng.CFG.moveCap = 300;
  eng.newGame();
  const rows = [];
  let plies = 0, nulls = 0;
  while (!eng.getG().over && plies < 300) {
    const G = eng.getG(), idx = G.active, netMoves = (idx === 0) === netIsBlue;
    const ps = G.pieces;
    rows.push({ f: features(eng), m: idx, p: [ps[0].x, ps[0].y, ps[0].rot, ps[1].x, ps[1].y, ps[1].rot] });
    let plan;
    if (netMoves) plan = netFn(idx);
    else { (G.cornerOpening || (G.cornerOpening = [null, null]))[idx] = face.corner; plan = eng.ladderPlanFor(face.li, idx); }
    if (!plan) { rows.pop(); if (++nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
    nulls = 0;
    eng.applyPlan(plan);
    plies++;
  }
  const G = eng.getG();
  const decided = G.over && G.winner !== null;
  const netWon = decided && ((G.winner === 0) === netIsBlue);
  if (decided && rowsOut) {
    const scale = G.adjudicated ? eng.CFG.komiLoss : 1;
    for (let i = 0; i < rows.length; i++) {
      const z = scale * (rows[i].m === G.winner ? 1 : -1) * Math.pow(0.995, rows.length - i);
      const mv = (rows[i].m === 0) === netIsBlue ? netId : face.id;
      rowsOut.push(JSON.stringify({ f: rows[i].f.map(v => +v.toFixed(5)), z: +z.toFixed(4),
        p: rows[i].p.map(v => +v.toFixed(4)), m: rows[i].m, g: gameId, mv, src: 'gauntlet',
        ...(G.adjudicated ? { adj: 1 } : {}) }));
    }
  }
  return { result: !decided ? 'draw' : netWon ? 'win' : 'loss', plies, adjudicated: !!G.adjudicated };
}

// ---- one net ----------------------------------------------------------------------------------
function runNet(live, netPath, depth, opts = {}) {
  const { MLP } = require('./net.js');
  const { nnPlanFor } = require('./nnai.js');
  const name = opts.name || path.basename(netPath).replace(/\.json$/i, '');
  const j = JSON.parse(fs.readFileSync(netPath, 'utf8'));
  if (j.policy || j.dual || /^dual/.test(name)) { log(`${name}: dual nets are not played yet; skipped`); return null; }
  const net = MLP.fromJSON(j);
  const hash = crypto.createHash('sha1').update(fs.readFileSync(netPath)).digest('hex').slice(0, 16);
  const key = `${hash}|${live.map.join(',')}|D${depth}`;
  const donePath = path.join(dir, 'rung-gauntlet-done.json');
  let done = {}; try { done = JSON.parse(fs.readFileSync(donePath, 'utf8')); } catch (e) {}
  if (done[key]) { log(`${name}@D${depth}: already played this ladder (${done[key].name}); skipped`); return null; }

  const { eng, faces } = live;
  const netFn = idx => nnPlanFor(eng, net, idx, { depth, temperature: 0, keepForDepth: 4 });
  const netId = `${name}@D${depth}`;
  const rows = [];
  const tag = 'gauntlet-' + hash.slice(0, 6) + '-D' + depth;
  const t0 = Date.now();
  const rec = [];
  let g = 0;
  let stoppedAt = null;
  for (const face of [...faces].reverse()) {
    const red = playGame(eng, face, netFn, false, rows, `${tag}-${g++}`, netId);
    const r = { face: face.id, rung: face.rung, red: red.result };
    if (red.result !== 'win') r.blue = playGame(eng, face, netFn, true, rows, `${tag}-${g++}`, netId).result;
    rec.push(r);
    if (red.result !== 'win') { stoppedAt = face.id; break; }
  }
  let pass = !stoppedAt && rec.every(r => r.red === 'win');
  if (pass) {                     // a candidate: confirm every face as Blue too before calling it
    for (const r of rec) {
      const face = faces.find(f => f.id === r.face);
      r.blue = playGame(eng, face, netFn, true, rows, `${tag}-${g++}`, netId).result;
    }
    pass = rec.every(r => r.blue === 'win');
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  const lost = rec.filter(r => r.red !== 'win');
  const out = { at: new Date().toISOString(), model: name, depth, hash, ladder: live.map, games: g, secs, pass, order: 'top-down', ...(stoppedAt ? { stoppedAt } : {}), faces: rec };
  fs.appendFileSync(path.join(dir, 'rung-gauntlet.jsonl'), JSON.stringify(out) + '\n');
  if (rows.length) {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    fs.appendFileSync(path.join(dir, 'data', `gauntlet-${os.hostname().toLowerCase()}-${day}.jsonl`), rows.join('\n') + '\n');
  }
  done[key] = { name: netId, at: out.at, pass };
  fs.writeFileSync(donePath, JSON.stringify(done, null, 1));
  log(`${netId}: ${rec.length - lost.length}/${faces.length} faces beaten as Red from the top in ${g} games, ${secs}s` +
      (lost.length ? ` -- stopped: lost as Red to ${lost.map(r => `${r.face}${r.blue === 'win' ? ' (won as Blue)' : r.blue === 'loss' ? ' (lost as Blue too)' : ' (drew as Blue)'}`).join(', ')}` : '') +
      (pass ? ' -- CLEAN SWEEP: candidate for a new top rung' : ''));
  if (pass) {
    const base = path.join(dir, 'ladder-candidates', `${name}-D${depth}`);
    const r = spawnSync(process.execPath, [path.join(dir, 'export-committee-net.js'), netPath, base], { encoding: 'utf8' });
    if (r.status !== 0) log('export failed: ' + (r.stderr || '').split('\n')[0]);
  }
  return out;
}

// ---- the queue: every recent model that has not played this ladder yet ------------------------
function queue() {
  const md = path.join(dir, 'models');
  // dotfiles are the trainer's bookkeeping (.pool-cycle.json etc.), and the bare names (value, deep,
  // ultra, scratch ...) are aliases of numbered models that get played under their own names
  const skip = /^\.|^(best|ckpt-|pool-slot|committee|dual|policy|lfx-games)|\.partial\.json$|\.pre-|^[a-z_]+\.json$/i;
  const maxAgeH = +arg('maxAgeHours', 48);
  if (!fs.existsSync(md)) return [];
  return fs.readdirSync(md).filter(f => f.endsWith('.json') && !skip.test(f))
    .map(f => ({ f: path.join(md, f), t: fs.statSync(path.join(md, f)).mtimeMs }))
    .filter(x => Date.now() - x.t < maxAgeH * 3600e3)
    .sort((a, b) => b.t - a.t).map(x => x.f);
}

function main() {
  const live = path.resolve(arg('live', path.join(dir, '..', '..', 'Tau-live')));
  const depth = +arg('depth', 2);
  const lock = path.join(dir, '.rung-gauntlet.lock');
  if (has('queue')) {
    try {                         // one gauntlet at a time; a lock whose process is gone (a reboot) or untouched for 3h is dead
      const st = fs.statSync(lock);
      const pid = +fs.readFileSync(lock, 'utf8');
      let alive = false; try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
      if (alive && Date.now() - st.mtimeMs < 3 * 3600e3) { log('another gauntlet is running; leaving the queue to it'); return; }
    } catch (e) {}
    fs.writeFileSync(lock, String(process.pid));
  }
  try {
    if (!has('noUpdate')) ensureLive(live);
    const L = loadLive(live);
    log(`live ladder: ${L.map.length} rungs, ${L.faces.length} faces (${L.faces.filter(f => f.corner).length} corner-opening) from ${live}`);
    if (!has('queue')) { runNet(L, path.resolve(arg('net', path.join(dir, 'models', 'best.json'))), depth); return; }
    // re-read the queue after every net so models minted while this runs are picked up newest-first,
    // instead of waiting for a later pool cycle (whose own start found this run's lock and stood down)
    const tried = new Set();
    for (;;) {
      const n = queue().find(f => !tried.has(f));
      if (!n) break;
      tried.add(n);
      try { fs.utimesSync(lock, new Date(), new Date()); runNet(L, n, depth); }
      catch (e) { log(`${path.basename(n)}: ${e.message}`); }
    }
  } catch (e) { log('stopped: ' + e.message); process.exitCode = 1;
  } finally { if (has('queue')) try { fs.unlinkSync(lock); } catch (e) {} }
}

module.exports = { runNet, loadLive };
if (require.main === module) main();
