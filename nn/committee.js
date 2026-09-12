'use strict';
// Committee brain: several different brains, one move.
//
//   committee:L11;nn:0:models/best.json;nn:0:models/deep.json      explicit members, ';'-separated
//   committee:auto                                                  picked from this machine's Elo
//
// Every member runs in its own worker thread (committee-worker.js), so a three-member committee at
// depth 3 costs about one depth-3 search of wall-clock per move on three cores, not three. Per move:
//   1. PROPOSE  every member searches the root in parallel and names its move.
//   2. JUDGE    every member scores every distinct proposal (its own included, through the same
//               routine, so a member never compares two differently-computed numbers): play the
//               move, answer it at the member's own depth, read the member's leaf.
//   3. VETO     a proposal any member proves LOST (the engine says the game is over against the
//               mover) is dead, and one dissenter is believed -- a proven throw is a fact, not an
//               opinion. Only engine-proven results veto; a net's -0.98 is still just a vote.
//   4. AGREE    the survivors are ranked by every member and the best summed rank (Borda) wins, so
//               the committee settles on the move the fewest members dislike rather than the one a
//               single member loves. Ties go to the chair: the first member listed.
// Scores are never compared across members, only ranks -- a rung's eval is in the hundreds, a value
// net's in [-1,1], and neither is calibrated against the other.
//
// `auto` reads elo-summary-<machine>.json: the strongest live ladder rung (plain, not +corner) plus
// the two highest-rated D1 value nets whose hidden shapes differ, so the two nets bring different
// blind spots rather than the same one twice. Runs anywhere arena.js's brain specs do, e.g.
//   node nn/arena.js --a committee:auto --b L11 --games 10 --depth 3
const fs = require('fs');
const path = require('path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');

const SAME_STOP_RAD = 0.5*Math.PI/180;   // proposals within half a degree on the same arm are one move

function pickAuto(dir) {
  const { summaryPath } = require('./machine-id.js');
  const { activeLadderLevels } = require('./evolution-roster.js');
  let players = {};
  try { players = JSON.parse(fs.readFileSync(summaryPath(dir), 'utf8')).players || {}; } catch (_) {}
  const live = new Set(activeLadderLevels(dir));
  const rungs = Object.entries(players)
    .filter(([id, r]) => r.kind === 'ladder' && !r.corner && /^L\d+$/.test(id) && live.has(+id.slice(1)) && Number.isFinite(+r.elo))
    .sort((a, b) => b[1].elo - a[1].elo);
  const chair = rungs.length ? rungs[0][0] : 'L11';
  const shapeOf = file => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j.sizes) ? j.sizes.slice(1, -1).join(',') : null; } catch (_) { return null; } };
  const nets = Object.entries(players)
    .filter(([id, r]) => r.kind === 'nn' && r.brain === 'nn' && +r.depth === 1 && !r.dualPolicy && Number.isFinite(+r.elo) && (+r.games || 0) >= 6)
    .sort((a, b) => b[1].elo - a[1].elo);
  const out = [chair], shapes = new Set();
  for (const [id, r] of nets) {
    const file = path.join(dir, 'models', path.basename(String(r.model)));
    if (!fs.existsSync(file)) continue;
    const shape = shapeOf(file);
    if (!shape || shapes.has(shape)) continue;
    shapes.add(shape); out.push('nn:0:' + file);
    if (out.length === 3) break;
  }
  if (out.length < 3) throw new Error('committee:auto needs two rated D1 nets of different shapes; found ' + (out.length - 1));
  return out;
}

function parseSpec(spec, dir) {
  const body = spec.replace(/^committee:/i, '');
  if (body === 'auto' || body === '') return pickAuto(dir);
  return body.split(';').map(s => s.trim()).filter(Boolean);
}

function makeBrain(eng, spec, opts) {
  const o = opts || {};
  const dir = o.dir || __dirname;
  const depth = o.depth || 3, keepForDepth = o.keepForDepth || 4;
  const specs = parseSpec(spec, dir);
  if (specs.length < 2) throw new Error('a committee needs at least two members');
  const members = specs.map(s => {
    const ctrl = new SharedArrayBuffer(4);
    const { port1, port2 } = new MessageChannel();
    const w = new Worker(path.join(__dirname, 'committee-worker.js'),
                         { workerData: { spec: s, depth, keepForDepth, ctrl, port: port2 }, transferList: [port2] });
    w.on('error', e => { console.error('[committee] member ' + s + ' died: ' + (e && e.message)); });
    w.unref();
    return { spec: s, worker: w, port: port1, ctrl: new Int32Array(ctrl), seen: 0, name: s };
  });
  // Block until one message is available on the member's port, then take it.
  const take = m => {
    for (;;) {
      const msg = receiveMessageOnPort(m.port);
      if (msg) return msg.message;
      Atomics.wait(m.ctrl, 0, Atomics.load(m.ctrl, 0), 250);
    }
  };
  for (const m of members) { const r = take(m); if (r.error) throw new Error(r.error); m.name = r.name || m.spec; }
  const name = 'committee(' + members.map(m => m.name).join('|') + (depth !== 3 ? ',D' + depth : '') + ')';
  let jobId = 0;
  const ask = (m, job) => { job.id = ++jobId; m.port.postMessage(job); };
  const sameMove = (a, b) => a.pivotIdx === b.pivotIdx && a.dir === b.dir && Math.abs(Math.abs(a.targetRad) - Math.abs(b.targetRad)) < SAME_STOP_RAD;
  const stats = { moves: 0, vetoes: 0, unanimous: 0, chairOverruled: 0 };

  function fn(idx) {
    const g = eng.getG();
    const pose = g.pieces.map(p => [p.x, p.y, p.rot]);
    const plies = g.plies || 0;
    // 1. propose, all members at once
    for (const m of members) ask(m, { type: 'propose', pose, active: idx, plies });
    const proposals = [];
    members.forEach((m, mi) => {
      const r = take(m);
      if (r.error) { console.error('[committee] ' + m.name + ' propose failed: ' + r.error.split('\n')[0]); return; }
      if (!r.plan) return;
      const dup = proposals.find(p => sameMove(p.plan, r.plan));
      if (dup) dup.by.push(mi); else proposals.push({ plan: r.plan, by: [mi] });
    });
    if (!proposals.length) return null;
    stats.moves++;
    if (proposals.length === 1) { stats.unanimous++; return proposals[0].plan; }
    // 2. judge: every member scores every proposal, in parallel across members
    const plans = proposals.map(p => p.plan);
    for (const m of members) ask(m, { type: 'judge', pose, active: idx, plies, plans });
    const scores = members.map(m => { const r = take(m); return r.error ? null : r.scores; });
    // 3. veto: a proven loss in ANY member's eyes kills the proposal
    const dead = plans.map((_, pi) => scores.some(s => s && s[pi] <= -1e5));
    let alive = proposals.map((p, pi) => pi).filter(pi => !dead[pi]);
    if (!alive.length) alive = proposals.map((p, pi) => pi);   // everything lost: least-bad below
    else if (alive.length < proposals.length) stats.vetoes++;
    // 4. Borda over the survivors; ties to the chair (member 0)
    const borda = new Array(plans.length).fill(0);
    scores.forEach(s => {
      if (!s) return;
      const order = alive.slice().sort((a, b) => s[b] - s[a]);
      order.forEach((pi, rank) => { borda[pi] += rank; });
    });
    alive.sort((a, b) => borda[a] - borda[b] || (scores[0] ? scores[0][b] - scores[0][a] : 0) || Math.min(...proposals[a].by) - Math.min(...proposals[b].by));
    const pick = alive[0];
    if (!proposals[pick].by.includes(0)) stats.chairOverruled++;
    if (o.verbose) {
      console.log('[committee] ' + proposals.map((p, pi) => `#${pi}<-${p.by.map(i => members[i].name).join('+')} borda ${borda[pi]}${dead[pi] ? ' DEAD' : ''} ` +
        scores.map((s, mi) => s ? members[mi].name.slice(0, 8) + '=' + (Math.abs(s[pi]) >= 1e5 ? (s[pi] > 0 ? 'WIN' : 'LOSS') : s[pi].toFixed(3)) : '?').join(' ')).join(' | ') + ` -> #${pick}`);
    }
    return proposals[pick].plan;
  }
  fn.stats = stats;
  fn.close = () => { for (const m of members) m.worker.terminate(); };
  return { name, fn, close: fn.close, stats };
}

module.exports = { makeBrain, pickAuto, parseSpec };
