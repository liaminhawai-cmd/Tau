'use strict';
// The rung hunt: find the line where Red BEATS a rung the gauntlet keeps losing to.
//
//   node nn/rung-hunt.js                       (best.json @D2 as Red vs the top shipped rung)
//   node nn/rung-hunt.js --face R13 --net nn/models/resume-759.json --depth 2 --wins 4
//
// WHY (the user's, 29 Oct): every net the gauntlet plays beats R13 as Blue and loses to it as Red,
// so no net clears the bar and no L14 ships. That is not a solved game -- the user beat L13 as Red
// (with undo), so the winning Red lines exist; the nets just never walk into one. Self-play and the
// generic retromine meet R13 rarely and from random openings, so they never look for one either.
//
// HOW: the rung is deterministic and so is a temp-0 net, so "net Red vs R13 Blue from the true
// start" is ONE fixed game -- the gauntlet's loss. This takes that game apart from the end backward:
// at each of Red's plies, a hunter brain takes over Red from that exact position (the line is
// REPLAYED move for move from the start, so ko history and turn state are the real ones, not a
// pose restore) and plays it out against the rung. A hunter that wins has found a winning Red line
// that shares the net's own line up to the deviation -- the closest thing to "change one decision"
// there is, which is why the walk goes from the last Red ply backward.
//
// Hunters, one worker thread each (each walks every Red ply, so the cores are all busy):
//   - the base net one ply deeper (D+1), and best.json if the base net is something else
//   - the top --topNets rated nets from the Elo summary, at their rated depth (<= --maxDepth)
//   - --perturb workers that play the base net, but with ONE random legal swing at the branch ply
//     first -- the deviation a deterministic brain will never make on its own
// The hunt stops once --wins winning lines are found (or every hunter has walked every ply).
//
// OUTPUT: every winning game -> training rows in nn/data/hunt-<machine>-<day>.jsonl (selfplay's
// schema, src:'hunt'), so the next training cycle sees R13's positions labelled as Red wins along a
// line the net nearly plays already. --keepLosses also writes the hunters' lost games. Each found
// line, with its full move list (replayable), goes to nn/rung-hunt.jsonl.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const dir = __dirname;
function arg(name, dflt) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; }
const has = name => process.argv.includes('--' + name);
const log = m => console.log(`[hunt] ${m}`);
const clone = o => JSON.parse(JSON.stringify(o));

// The live engine plus the face's rung brain, built the same way rung-gauntlet.js builds them.
function liveEngine(live) {
  const eng = require(path.join(live, 'nn', 'engine.js')).createEngine();
  if (eng.AI_LADDER.some(d => d && d.nets)) require(path.join(live, 'nn', 'committee-nets.js')).equipLadderNets(eng);
  return eng;
}

function netBrain(eng, spec) {
  const { MLP } = require('./net.js');
  const { nnPlanFor } = require('./nnai.js');
  const net = MLP.fromJSON(JSON.parse(fs.readFileSync(spec.path, 'utf8')));
  return idx => nnPlanFor(eng, net, idx, { depth: spec.depth, temperature: 0, keepForDepth: 4 });
}

// Play from the start: the first `prefix.length` plies are replayed as given, then `red` and the
// face play it out. Red is seat 1 (the gauntlet's "net as Red"). Returns the full move list (so a
// win is replayable), the rows (features per position), and the result for Red.
function playLine(eng, face, red, prefix, firstRedPlan, prefixOnly) {
  const { features } = require('./features.js');
  eng.CFG.moveCap = 300;
  eng.newGame();
  const rows = [], plans = [];
  let plies = 0, nulls = 0, forced = firstRedPlan || null;
  while (!eng.getG().over && plies < 300) {
    if (prefixOnly && plies >= prefix.length) break;
    const G = eng.getG(), idx = G.active;
    (G.cornerOpening || (G.cornerOpening = [null, null]))[0] = face.corner;
    const ps = G.pieces;
    rows.push({ f: features(eng), m: idx, p: [ps[0].x, ps[0].y, ps[0].rot, ps[1].x, ps[1].y, ps[1].rot] });
    let plan;
    if (plies < prefix.length) plan = clone(prefix[plies]);
    else if (idx === 1 && forced) { plan = forced; forced = null; }
    else plan = idx === 1 ? red(idx) : eng.ladderPlanFor(face.li, idx);
    // (a null prefix entry is a turn that passed with no move in the line being replayed)
    if (!plan) {
      rows.pop(); plans.push(null);
      if (++nulls > 4) break;
      eng.clearTurn(); eng.setActive(1 - idx); plies++; continue;
    }
    nulls = 0;
    plans.push(clone(plan));
    eng.applyPlan(plan);
    plies++;
  }
  const G = eng.getG();
  const decided = G.over && G.winner !== null;
  return { plans, rows, plies, winner: decided ? G.winner : null, adjudicated: !!G.adjudicated,
           result: !decided ? 'draw' : G.winner === 1 ? 'win' : 'loss' };
}

function toRows(game, gameId, redId, faceId, komiLoss) {
  const scale = game.adjudicated ? komiLoss : 1;
  return game.rows.map((r, i) => JSON.stringify({
    f: r.f.map(v => +v.toFixed(5)),
    z: +(scale * (r.m === game.winner ? 1 : -1) * Math.pow(0.995, game.rows.length - i)).toFixed(4),
    p: r.p.map(v => +v.toFixed(4)), m: r.m, g: gameId, mv: r.m === 1 ? redId : faceId, src: 'hunt',
    ...(game.adjudicated ? { adj: 1 } : {}) }));
}

// ---- worker: one hunter walks every branch ply it is given --------------------------------------
if (!isMainThread) {
  const { live, face, hunter, base, branchPlies, keepLosses } = workerData;
  const eng = liveEngine(live);
  const red = netBrain(eng, hunter.perturb ? base : hunter);
  const { randomOpeningPlan } = require('./opening.js');
  let stop = false;
  parentPort.on('message', m => { if (m === 'stop') stop = true; });
  (async () => {
    for (const k of branchPlies) {
      if (stop) break;
      let first = null;
      if (hunter.perturb) {
        // the random swing has to be drawn from the branch position itself
        playLine(eng, face, null, base.plans.slice(0, k), null, true);
        first = randomOpeningPlan(eng);
        if (!first) continue;
      }
      const game = playLine(eng, face, red, base.plans.slice(0, k), first);
      const keep = game.result === 'win' || (keepLosses && game.winner !== null);
      parentPort.postMessage({ k, result: game.result, plies: game.plies, adjudicated: game.adjudicated,
        plans: game.result === 'win' ? game.plans : undefined,
        rows: keep ? toRows(game, `hunt-${face.id}-${hunter.id}-${k}`, hunter.id, face.id, eng.CFG.komiLoss) : undefined });
      await new Promise(r => setImmediate(r));   // let a 'stop' in
    }
    parentPort.postMessage({ done: true });
  })();
  return;
}

// ---- main --------------------------------------------------------------------------------------
function hunters(baseSpec, maxDepth, topNets, perturb) {
  const out = [];
  const seen = new Set();
  const add = h => { const key = `${path.resolve(h.path)}|${h.depth}`; if (seen.has(key) || !fs.existsSync(h.path)) return; seen.add(key); out.push(h); };
  seen.add(`${path.resolve(baseSpec.path)}|${baseSpec.depth}`);   // the base line already IS that brain
  add({ id: `${baseSpec.name}@D${baseSpec.depth + 1}`, path: baseSpec.path, depth: baseSpec.depth + 1 });
  const best = path.join(dir, 'models', 'best.json');
  add({ id: `best@D${baseSpec.depth}`, path: best, depth: baseSpec.depth });
  try {
    const summary = JSON.parse(fs.readFileSync(arg('summary', require('./machine-id.js').summaryPath(dir)), 'utf8'));
    const nets = Object.entries(summary.players || {})
      .filter(([, v]) => v.kind === 'nn' && (v.games || 0) >= 4 && (v.depth || 1) <= maxDepth && v.brain !== 'dual')
      .sort((a, b) => (b[1].elo || 0) - (a[1].elo || 0));
    let n = 0;
    for (const [id, v] of nets) {
      if (n >= topNets) break;
      let mp = v.model;
      if (!mp || !fs.existsSync(mp)) mp = path.join(dir, 'models', path.basename(v.model || (id.split('@')[0] + '.json')));
      const before = out.length;
      add({ id, path: mp, depth: v.depth || 1 });
      if (out.length > before) n++;
    }
  } catch (e) { log(`no Elo summary (${e.message}) -- hunting with the base net's own family only`); }
  for (let i = 0; i < perturb; i++) out.push({ id: `${baseSpec.name}@D${baseSpec.depth}+swing${i + 1}`, path: baseSpec.path, depth: baseSpec.depth, perturb: true });
  return out;
}

async function main() {
  const live = path.resolve(arg('live', path.join(dir, '..', '..', 'Tau-live')));
  if (!has('noUpdate')) require('./rung-gauntlet.js').ensureLive(live);
  const { eng, faces } = require('./rung-gauntlet.js').loadLive(live);
  const topRung = Math.max(...faces.map(f => f.rung));
  const want = arg('face', `R${topRung}`);
  // R13 flips a corner-opening coin in the app, so it is two faces; --bothCorners hunts both
  const plain = want.replace(/\+corner$/, '');
  const huntFaces = faces.filter(f => f.id === want || (has('bothCorners') && (f.id === plain || f.id === plain + '+corner')));
  if (!huntFaces.length) throw new Error(`no face ${want} on the live ladder (${faces.map(f => f.id).join(' ')})`);

  const netPath = path.resolve(arg('net', path.join(dir, 'models', 'best.json')));
  const depth = +arg('depth', 2);
  const baseSpec = { name: path.basename(netPath).replace(/\.json$/i, ''), path: netPath, depth };
  const wins = +arg('wins', 4);
  const cores = Math.max(1, os.cpus().length - 1);
  const pool = hunters(baseSpec, +arg('maxDepth', 3), +arg('topNets', Math.max(2, cores - 3)), +arg('perturb', 2)).slice(0, +arg('workers', cores));
  const keepLosses = has('keepLosses');
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dataOut = path.join(dir, 'data', `hunt-${os.hostname().toLowerCase()}-${day}.jsonl`);

  for (const face of huntFaces) {
    const t0 = Date.now();
    const base = playLine(eng, face, netBrain(eng, baseSpec), []);
    base.name = baseSpec.name;
    log(`${baseSpec.name}@D${depth} as Red vs ${face.id}: ${base.result} in ${base.plies} plies`);
    // --force hunts a line the net already wins (a cheap way to exercise the machinery on a low rung)
    if (base.result === 'win' && !has('force')) { log(`${face.id}: the base net already wins this line as Red -- nothing to hunt`); continue; }
    // Every branch replays this line move for move, so it has to reproduce the same game exactly.
    const check = playLine(eng, face, null, base.plans, null, true);
    if (check.plies !== base.plies || check.winner !== base.winner) {
      log(`${face.id}: replaying the line did NOT reproduce the game (${check.plies} plies, winner ${check.winner} vs ` +
          `${base.plies}, ${base.winner}) -- branches would start from the wrong positions; not hunting`);
      process.exitCode = 1;
      continue;
    }
    // Red's decision points, last first. A ply where Red had no move has nothing to change.
    const redPlies = [];
    for (let k = base.plans.length - 1; k >= 0; k--) if (base.rows[k] && base.rows[k].m === 1 && base.plans[k]) redPlies.push(k);
    const maxBack = +arg('maxBranches', redPlies.length);
    const branchPlies = redPlies.slice(0, maxBack);
    log(`${face.id}: ${branchPlies.length} Red plies to branch from, ${pool.length} hunters: ${pool.map(h => h.id).join(', ')}`);

    const found = [];
    let games = 0, lossRows = 0;
    const ws = fs.openSync(dataOut, 'a');
    await new Promise(resolve => {
      let running = pool.length;
      const workers = pool.map(h => {
        const w = new Worker(__filename, { argv: process.argv.slice(2), workerData: {
          live, face, hunter: h, keepLosses, branchPlies,
          base: { path: baseSpec.path, depth: baseSpec.depth, plans: base.plans } } });
        w.on('message', m => {
          // a 'stop' only lands between games, so games already in flight still report: drop them
          // a worker that has walked its plies is still listening for 'stop', which keeps it alive
          if (m.done) { w.terminate(); return; }
          if (found.length >= wins) return;
          games++;
          if (m.rows) { fs.writeSync(ws, m.rows.join('\n') + '\n'); if (m.result !== 'win') lossRows += m.rows.length; }
          if (m.result !== 'win') return;
          const redMove = redPlies.length - redPlies.indexOf(m.k);   // redPlies runs last-first
          found.push({ k: m.k, hunter: h.id, plies: m.plies });
          log(`  WIN: ${h.id} takes over Red at ply ${m.k} (Red's move ${redMove} of ${redPlies.length}) and beats ${face.id} in ${m.plies} plies${m.adjudicated ? ' (adjudicated)' : ''}`);
          fs.appendFileSync(path.join(dir, 'rung-hunt.jsonl'), JSON.stringify({ at: new Date().toISOString(), face: face.id,
            base: `${baseSpec.name}@D${depth}`, basePlies: base.plies, branchPly: m.k, hunter: h.id, plies: m.plies,
            adjudicated: m.adjudicated, plans: m.plans }) + '\n');
          if (found.length >= wins) workers.forEach(x => x.postMessage('stop'));
        });
        w.on('error', e => log(`  ${h.id}: ${e.message}`));
        w.on('exit', () => { if (--running === 0) resolve(); });
        return w;
      });
    });
    fs.closeSync(ws);
    const secs = Math.round((Date.now() - t0) / 1000);
    log(`${face.id}: ${found.length} winning Red line(s) in ${games} games, ${secs}s` +
        (found.length ? ` -- earliest deviation at ply ${Math.min(...found.map(f => f.k))}; rows -> ${path.relative(dir, dataOut)}` : ' -- none found; try --perturb 6, --topNets 10 or --depth 3'));
    if (lossRows) log(`  (+${lossRows} rows from hunters' lost games, --keepLosses)`);
  }
}

if (require.main === module) main().catch(e => { log('stopped: ' + e.message); process.exitCode = 1; });
