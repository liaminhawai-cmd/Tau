// Round robin for the top rung: which way of running the Committee is actually strongest?
//
//   node nn/l13-roundrobin.js [--workers N] [--only L13,L13-d2,...] [--saveData file.jsonl]
//
// Every brain plays every other brain twice -- once as Blue, once as Red -- from the real starting
// position, the way the game plays them. The brains are deterministic except for one coin: from
// rung 7 up, each flips one at the start of a game to decide whether to open in the corner. That
// coin is SEEDED here from the pairing and the colours, so a run is exactly repeatable and a result
// can be replayed. Nothing here touches the live league, the Elo pool or any model file.
//
// The brains:
//   L10, L11          the menu's Level 10 and 11, as shipped
//   L13-old           the Committee as it was before the throw check (the vote alone)
//   L13               the Committee as shipped: the vote, then "does this move hand them a throw?"
//   L13-d2, L13-d3    the Committee searching: each net picks its own favourite move, each net
//                     answers each as the opponent would, (at d3, each net answers THOSE again),
//                     every leaf judged by the whole Committee's pooled vote. Worst-case reply wins.
//                     See committeePlanDeep in index.html.
//   Champion-d1..d3   the strongest single net (Level 12's), searching 1, 2 and 3 plies
//
// d3 is slow: seconds a move, where the others take a fraction of one. The games are spread over
// every core but one, heaviest first, so the long ones start straight away.
//
// Writes a table to the console and to nn/arena-logs/, and -- with --saveData -- every position of
// every decided game as training rows in exactly arena.js's --saveData format (f/z/p/m/g/mv), so
// train.js reads them with no changes.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { fork } = require('child_process');

const ALL_BRAINS = ['L10', 'L11', 'L13-old', 'L13', 'L13-d2', 'L13-d3', 'Champion-d1', 'Champion-d2', 'Champion-d3'];
// Rough relative cost per move, only used to start the slow games first.
const COST = { 'L13-d3': 40, 'L13-d2': 12, 'Champion-d3': 10, 'Champion-d2': 3, 'L13': 2, 'L13-old': 2 };
const MAX_PLIES = 300, DISCOUNT = 0.995;

function arg(name, dflt) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; }

// A small seeded generator, so the corner coin lands the same way every time a pairing is played.
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function seedOf(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------------------------------------------------------------- worker: plays one game at a time
function worker() {
  const { createEngine } = require('./engine.js');
  const { features } = require('./features.js');
  const { MLP } = require('./net.js');
  const { nnPlanFor } = require('./nnai.js');
  const { loadCommitteeNet, equipLadderNets } = require('./committee-nets.js');
  const eng = createEngine();
  // The shipped Committee is AI_LADDER[14]; the variants are copies of it with a flag, appended so
  // no existing index moves. They share its nets (equipLadderNets loads each file once).
  const COMMITTEE = 14;
  const base = eng.AI_LADDER[COMMITTEE];
  if (!base || base.kind !== 'committee') throw new Error('AI_LADDER[14] is not the Committee any more -- update this script');
  const variant = o => { eng.AI_LADDER.push(Object.assign({}, base, { o: Object.assign({}, base.o || {}, o), _nets: null })); return eng.AI_LADDER.length - 1; };
  const idxOld = variant({ noSafety: true }), idxD2 = variant({ deep: 2 }), idxD3 = variant({ deep: 3 });
  equipLadderNets(eng);
  let champ = null;
  const champion = () => champ || (champ = MLP.fromJSON(loadCommitteeNet('champion')));
  // Player levels map to AI_LADDER through the game's own RUNG_TO_AI_LADDER: Level 10 -> 8, 11 -> 9.
  const BRAIN = {
    'L10': idx => eng.ladderPlanFor(8, idx),
    'L11': idx => eng.ladderPlanFor(9, idx),
    'L13': idx => eng.ladderPlanFor(COMMITTEE, idx),
    'L13-old': idx => eng.ladderPlanFor(idxOld, idx),
    'L13-d2': idx => eng.ladderPlanFor(idxD2, idx),
    'L13-d3': idx => eng.ladderPlanFor(idxD3, idx),
    'Champion-d1': idx => nnPlanFor(eng, champion(), idx, { temperature: 0, depth: 1, keepForDepth: 4 }),
    'Champion-d2': idx => nnPlanFor(eng, champion(), idx, { temperature: 0, depth: 2, keepForDepth: 4 }),
    'Champion-d3': idx => nnPlanFor(eng, champion(), idx, { temperature: 0, depth: 3, keepForDepth: 4 }),
  };
  process.on('message', job => {
    if (job === 'stop') process.exit(0);
    const { a, b, aIsBlue, save } = job;
    Math.random = mulberry32(seedOf(a + '|' + b + '|' + aIsBlue));   // the engine shares this Math
    eng.newGame();
    const rows = [], ms = { A: 0, B: 0 }, moves = { A: 0, B: 0 };
    let plies = 0, nulls = 0;
    while (!eng.getG().over && plies < MAX_PLIES) {
      const idx = eng.getG().active, isA = (idx === 0) === aIsBlue, who = isA ? 'A' : 'B';
      if (save) { const ps = eng.getG().pieces;
        rows.push({ f: features(eng), m: idx, p: [ps[0].x, ps[0].y, ps[0].rot, ps[1].x, ps[1].y, ps[1].rot] }); }
      const t0 = Date.now();
      const plan = BRAIN[isA ? a : b](idx);
      ms[who] += Date.now() - t0; moves[who]++;
      if (!plan) { if (save) rows.pop(); if (++nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
      nulls = 0; eng.applyPlan(plan); plies++;
    }
    const G = eng.getG();
    const winnerIsA = G.over && G.winner !== null ? (G.winner === 0) === aIsBlue : null;
    let out = [];
    if (save && G.over && G.winner !== null) {
      const scale = G.adjudicated ? eng.CFG.komiLoss : 1, gameId = 'l13rr-' + seedOf(a + b + aIsBlue + Date.now()).toString(36);
      out = rows.map((r, i) => Object.assign({
        f: r.f.map(v => +v.toFixed(5)), z: +(scale*(r.m === G.winner ? 1 : -1)*Math.pow(DISCOUNT, rows.length - i)).toFixed(4),
        p: r.p.map(v => +v.toFixed(4)), m: r.m, g: gameId, mv: (r.m === 0) === aIsBlue ? a : b,
      }, G.adjudicated ? { adj: 1 } : {}));
    }
    process.send({ job, winnerIsA, adjudicated: !!G.adjudicated, plies, ms, moves, komiLoss: eng.CFG.komiLoss, rows: out });
  });
  process.send('ready');
}

// ---------------------------------------------------------------- master: deals games, keeps score
function master() {
  const only = arg('only', null);
  const brains = only ? only.split(',').map(s => s.trim()) : ALL_BRAINS;
  for (const b of brains) if (!ALL_BRAINS.includes(b)) { console.error('unknown brain: ' + b + '  (know: ' + ALL_BRAINS.join(', ') + ')'); process.exit(1); }
  const saveData = arg('saveData', null);
  const nWorkers = Math.max(1, +arg('workers', Math.max(1, os.cpus().length - 1)));
  const jobs = [];
  for (let i = 0; i < brains.length; i++) for (let j = i + 1; j < brains.length; j++)
    for (const aIsBlue of [true, false]) jobs.push({ a: brains[i], b: brains[j], aIsBlue, save: !!saveData });
  const cost = j => (COST[j.a] || 1) + (COST[j.b] || 1);
  jobs.sort((x, y) => cost(y) - cost(x));
  const total = jobs.length, results = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logDir = path.join(__dirname, 'arena-logs');
  fs.mkdirSync(logDir, { recursive: true });
  let dataStream = null, savedRows = 0;
  if (saveData) { fs.mkdirSync(path.dirname(path.resolve(saveData)), { recursive: true }); dataStream = fs.createWriteStream(saveData, { flags: 'a' }); }
  console.log(`${brains.length} brains, ${total} games (each pair once as Blue, once as Red), ${nWorkers} workers`);
  if (saveData) console.log(`saving training rows to ${saveData}`);
  const t0 = Date.now();
  let next = 0, done = 0, live = 0;
  const finish = () => {
    if (dataStream) dataStream.end();
    const report = summarise(brains, results, (Date.now() - t0)/1000);
    console.log('\n' + report);
    const base = path.join(logDir, `l13-roundrobin-${stamp}`);
    fs.writeFileSync(base + '.txt', report + (saveData ? `\n${savedRows} training rows -> ${saveData}\n` : ''));
    fs.writeFileSync(base + '.json', JSON.stringify({ brains, results }, null, 1));
    console.log(`saved ${base}.txt and .json` + (saveData ? `\n${savedRows} training rows -> ${saveData}` : ''));
  };
  for (let w = 0; w < Math.min(nWorkers, total); w++) {
    const child = fork(__filename, ['--worker'], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
    live++;
    const deal = () => { if (next < total) child.send(jobs[next++]); else child.send('stop'); };
    child.on('message', m => {
      if (m === 'ready') return deal();
      done++;
      const { job } = m;
      if (dataStream) for (const r of m.rows) { dataStream.write(JSON.stringify(r) + '\n'); savedRows++; }
      results.push({ a: job.a, b: job.b, aIsBlue: job.aIsBlue, winnerIsA: m.winnerIsA, adjudicated: m.adjudicated,
                     plies: m.plies, msA: m.ms.A, msB: m.ms.B, movesA: m.moves.A, movesB: m.moves.B, komiLoss: m.komiLoss });
      const w = m.winnerIsA === null ? 'draw' : (m.winnerIsA ? job.a : job.b) + (m.adjudicated ? ' (komi)' : '');
      const blue = job.aIsBlue ? job.a : job.b, red = job.aIsBlue ? job.b : job.a;
      console.log(`[${String(done).padStart(3)}/${total}] ${blue.padEnd(12)} (Blue) vs ${red.padEnd(12)} (Red): ${w}, ${m.plies} plies, ${((Date.now() - t0)/60000).toFixed(1)} min`);
      deal();
    });
    child.on('exit', code => { if (code) console.error('worker exited with code ' + code); if (--live === 0) finish(); });
  }
}

function summarise(brains, results, secs) {
  const kw = r => 0.5 + (r.komiLoss || 0)/2;
  const pts = {}, wl = {}, colour = {}, speed = {};
  for (const b of brains) { pts[b] = 0; wl[b] = [0, 0, 0]; colour[b] = { Blue: [0, 0], Red: [0, 0] }; speed[b] = [0, 0]; }
  const cell = {};   // cell[a][b] = "WL" string from a's view: Blue result then Red result
  for (const b of brains) { cell[b] = {}; for (const c of brains) cell[b][c] = ['.', '.']; }
  for (const r of results) {
    const add = (me, won, asBlue) => {
      const s = won === null ? 0.5 : won ? (r.adjudicated ? kw(r) : 1) : (r.adjudicated ? 1 - kw(r) : 0);
      pts[me] += s; wl[me][won === null ? 2 : won ? 0 : 1]++;
      if (won !== null) colour[me][asBlue ? 'Blue' : 'Red'][won ? 0 : 1]++;
    };
    add(r.a, r.winnerIsA, r.aIsBlue);
    add(r.b, r.winnerIsA === null ? null : !r.winnerIsA, !r.aIsBlue);
    const ch = won => won === null ? 'D' : won ? 'W' : 'L';
    cell[r.a][r.b][r.aIsBlue ? 0 : 1] = ch(r.winnerIsA);
    cell[r.b][r.a][r.aIsBlue ? 1 : 0] = ch(r.winnerIsA === null ? null : !r.winnerIsA);
    speed[r.a][0] += r.msA; speed[r.a][1] += r.movesA; speed[r.b][0] += r.msB; speed[r.b][1] += r.movesB;
  }
  const order = brains.slice().sort((x, y) => pts[y] - pts[x]);
  let out = `L13 round robin -- ${results.length} games in ${(secs/60).toFixed(1)} min\n\n`;
  out += 'rank  brain         points  W-L-D     as Blue  as Red   ms/move\n';
  order.forEach((b, i) => {
    const [w, l, d] = wl[b], sp = speed[b][1] ? Math.round(speed[b][0]/speed[b][1]) : 0;
    out += `${String(i + 1).padStart(3)}.  ${b.padEnd(12)}  ${pts[b].toFixed(1).padStart(5)}   ${`${w}-${l}-${d}`.padEnd(8)}  ` +
           `${`${colour[b].Blue[0]}-${colour[b].Blue[1]}`.padEnd(7)}  ${`${colour[b].Red[0]}-${colour[b].Red[1]}`.padEnd(7)}  ${String(sp).padStart(6)}\n`;
  });
  out += '\nhead to head (row brain\'s result: as Blue / as Red; W win, L loss, D draw)\n';
  const w = 13;
  out += ''.padEnd(w) + order.map(b => b.slice(0, 11).padEnd(w)).join('') + '\n';
  for (const a of order) out += a.slice(0, 11).padEnd(w) + order.map(b => (a === b ? '--' : cell[a][b].join('/')).padEnd(w)).join('') + '\n';
  out += '\nOne game per colour per pairing is a fact about that pairing from the starting position, not a\n' +
         'rating: two brains can meet in a line one of them happens to know. Read the points column\n' +
         'across the whole field, and the as-Red column for the weakness this was built to find.\n';
  return out;
}

if (process.argv.includes('--worker')) worker(); else master();
