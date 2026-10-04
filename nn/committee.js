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

// The strongest live ladder rung (plain, not +corner) by this machine's Elo; L11 if none is rated.
function strongestRung(dir, players) {
  const { activeLadderLevels } = require('./evolution-roster.js');
  if (!players) {
    const { summaryPath } = require('./machine-id.js');
    try { players = JSON.parse(fs.readFileSync(summaryPath(dir), 'utf8')).players || {}; } catch (_) { players = {}; }
  }
  const live = new Set(activeLadderLevels(dir));
  const rungs = Object.entries(players)
    .filter(([id, r]) => r.kind === 'ladder' && !r.corner && /^L\d+$/.test(id) && live.has(+id.slice(1)) && Number.isFinite(+r.elo))
    .sort((a, b) => b[1].elo - a[1].elo);
  return rungs.length ? rungs[0][0] : 'L11';
}

function pickAuto(dir) {
  const { summaryPath } = require('./machine-id.js');
  let players = {};
  try { players = JSON.parse(fs.readFileSync(summaryPath(dir), 'utf8')).players || {}; } catch (_) {}
  const chair = strongestRung(dir, players);
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

// ---- position weighting (opt-in, @posw) ------------------------------------------------------
// The log pool trusts every member equally everywhere. It does not have to: if a member is
// measurably stronger in one part of the board, its log-probability can carry more weight there.
//
// ONE axis has unbiased evidence behind it, and only one. 432 positions sampled evenly across
// (losing/even/winning) x (inner/mid/outer) were each played out to the end four times, once with
// each of L11, L8, best.json at depth 1 and best.json at depth 2 as the mover, always against the
// same L8 (nn/playoff/, 1728 games, run 2026-09-18). Paired by position, the net at depth 2 beat
// L11 by 12 points of win rate with the mover's hub inside 21.5u of the centre (85% vs 74%, 144
// positions, clear of its 2-sigma bar) and was level with it further out (0 and 3 points, both
// inside the bar). By ADVANTAGE state the same games showed nothing: 8, 1 and 1 points, every one
// of them inside its error bar, so "L11 is the one to trust when losing" is not in the data and is
// deliberately not encoded here.
//
// A separate static-evaluation sweep (48k recorded positions, each member scored by log-loss
// against the eventual result) is NOT the source of these numbers and must not be: positions near
// the rim are far more decided than the ones mid-board -- every member calls 94% of them right out
// there against 71% mid-board -- so a loss comparison across those bins measures how settled the
// positions are as much as who judges them better. The game-level playoff is balanced by
// construction, which is why it and not the sweep sets the weights.
//
// So: nudge, on one axis, at a size the evidence supports, and let the league rate it against the
// unweighted committee rather than assuming it helps. TAU_COMMITTEE_POSW overrides the pair as
// "<netWeight>,<ladderWeight>".
const POSW_INNER_U = 21.5;        // the playoff's inner/mid boundary, a tercile of real play
const POSW_FULL_U = 10;           // full nudge inside this, ramped linearly out to POSW_INNER_U
const [POSW_NET, POSW_LADDER] = (process.env.TAU_COMMITTEE_POSW || '1.35,0.75').split(',').map(Number);
const isNetSpec = spec => !/^L\d+/i.test(String(spec));
// Weight for one member at a root position whose mover's hub sits `dm` from the board centre.
function poswWeight(spec, dm) {
  if (!(dm < POSW_INNER_U)) return 1;
  const t = dm <= POSW_FULL_U ? 1 : (POSW_INNER_U - dm)/(POSW_INNER_U - POSW_FULL_U);
  const full = isNetSpec(spec) ? POSW_NET : POSW_LADDER;
  return 1 + t*(full - 1);
}

// "committee:<members>[@opt,opt]" -- options are d1/d2/d3 (deepest stage), flat (one stage at that
// depth instead of the D1->D2->D3 funnel), borda (the old rank-and-veto rule), k=N (candidates per
// member's sweep), temp=N (the ladder members' logistic temperature), posw (weight each member's
// vote by where on the board the position is -- see above).
function splitSpec(spec) {
  const body = spec.replace(/^committee:/i, '');
  const at = body.lastIndexOf('@');
  return at >= 0 ? { body: body.slice(0, at), opts: body.slice(at + 1) } : { body, opts: '' };
}
function parseSpec(spec, dir) {
  const { body } = splitSpec(spec);
  if (body === 'auto' || body === '') return pickAuto(dir);
  return body.split(';').map(s => s.trim()).filter(Boolean);
}
function parseOpts(spec) {
  const out = { depth: null, flat: false, borda: false, posw: false, k: 4, temp: 0 };
  for (const t of splitSpec(spec).opts.split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) {
    const dm = /^d([1-4])$/.exec(t); if (dm) { out.depth = +dm[1]; continue; }
    const km = /^k=(\d+)$/.exec(t); if (km) { out.k = Math.max(1, +km[1]); continue; }
    const tm = /^temp=(\d+(?:\.\d+)?)$/.exec(t); if (tm) { out.temp = +tm[1]; continue; }
    if (t === 'flat') out.flat = true;
    else if (t === 'borda') out.borda = true;
    else if (t === 'posw') out.posw = true;
  }
  return out;
}
// The funnel: judge everything cheaply, then spend the deep search only on what survived. Judging
// every candidate at full depth is what made the first version so expensive, and most candidates
// are settled by a 1-ply look anyway.
function stagesFor(maxDepth, flat) {
  if (flat || maxDepth <= 1) return [{ depth: maxDepth, keep: 1 }];
  if (maxDepth === 2) return [{ depth: 1, keep: 4 }, { depth: 2, keep: 1 }];
  return [{ depth: 1, keep: 6 }, { depth: 2, keep: 3 }, { depth: maxDepth, keep: 1 }];
}

function makeBrain(eng, spec, opts) {
  const o = opts || {};
  const dir = o.dir || __dirname;
  const cfg = parseOpts(spec);
  const depth = cfg.depth || o.depth || 3, keepForDepth = o.keepForDepth || 4;
  const stages = stagesFor(depth, cfg.flat);
  const specs = parseSpec(spec, dir);
  if (specs.length < 2) throw new Error('a committee needs at least two members');
  const members = specs.map(s => {
    const ctrl = new SharedArrayBuffer(4);
    const { port1, port2 } = new MessageChannel();
    const w = new Worker(path.join(__dirname, 'committee-worker.js'),
                         { workerData: { spec: s, depth, keepForDepth, ladderTemp: cfg.temp, ctrl, port: port2 }, transferList: [port2] });
    w.on('error', e => { console.error('[committee] member ' + s + ' died: ' + (e && e.message)); });
    w.unref();
    return { spec: s, worker: w, port: port1, ctrl: new Int32Array(ctrl), name: s };
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
  const name = 'committee(' + members.map(m => m.name).join('|') +
               (depth !== 3 ? ',D' + depth : '') + (cfg.borda ? ',borda' : '') + (cfg.flat ? ',flat' : '') +
               (cfg.posw ? ',posw' : '') + ')';
  let jobId = 0;
  const ask = (m, job) => { job.id = ++jobId; m.port.postMessage(job); };
  const sameMove = (a, b) => a.pivotIdx === b.pivotIdx && a.dir === b.dir && Math.abs(Math.abs(a.targetRad) - Math.abs(b.targetRad)) < SAME_STOP_RAD;
  const stats = { moves: 0, vetoes: 0, unanimous: 0, chairOverruled: 0, provenWins: 0 };
  const fmt = v => !v ? '?' : v.proven > 0 ? 'WIN' : v.proven < 0 ? 'LOSS' : v.p.toFixed(3);

  // Ask every member for the same list of moves, at this stage's depth.
  function judgeAll(pose, idx, plies, plans, d) {
    for (const m of members) ask(m, { type: 'judge', pose, active: idx, plies, plans, depth: d });
    return members.map(m => {
      const r = take(m);
      if (r.error) { console.error('[committee] ' + m.name + ' judge failed: ' + String(r.error).split('\n')[0]); return null; }
      return r.scores;
    });
  }
  // LOG POOL: every member turns its own verdict into a win probability, and the totals are the
  // sums of their logs. Multiplying probabilities is what makes one member's "this is nearly dead"
  // decisive -- log p -> -Infinity as p -> 0 -- without letting a member with a bigger raw scale
  // dominate an ordinary position, which is what summing raw scores would do. Engine-PROVEN results
  // are not opinions and are not pooled: a proven loss is an absolute floor, a proven win an
  // absolute ceiling.
  function pool(rows, n, weights) {
    const out = [];
    for (let j = 0; j < n; j++) {
      let sum = 0, dead = false, won = false;
      rows.forEach((row, mi) => {
        const v = row && row[j];
        if (!v) return;
        if (v.proven < 0) dead = true; else if (v.proven > 0) won = true;
        // A PROVEN result is never scaled -- weighting is about how much to trust an OPINION, and
        // a proven loss is not one. Those are handled by the flags above, not by this sum.
        sum += (weights ? weights[mi] : 1)*Math.log(v.p);
      });
      out.push(dead ? -Infinity : won ? Infinity : sum);
    }
    return out;
  }

  function fn(idx) {
    const g = eng.getG();
    const pose = g.pieces.map(p => [p.x, p.y, p.rot]);
    const plies = g.plies || 0;
    // Computed once per real move from the ROOT position, not per candidate: the question the
    // weights answer is "whose judgement counts for more in this part of the board", and every
    // candidate in this search is being judged from the same root.
    const weights = cfg.posw
      ? members.map(m => poswWeight(m.spec, Math.hypot(pose[idx][0], pose[idx][1])))
      : null;
    // 1. SWEEP -- the candidate set is the UNION of every member's own shortlist, not one move
    // each. A move only one member likes can still win the pool; it could never even be considered
    // when every member reported only its single favourite.
    for (const m of members) ask(m, { type: 'sweep', pose, active: idx, plies, depth: stages[0].depth, k: cfg.k });
    const cands = [], by = [];
    members.forEach((m, mi) => {
      const r = take(m);
      if (r.error) { console.error('[committee] ' + m.name + ' sweep failed: ' + String(r.error).split('\n')[0]); return; }
      for (const p of r.plans || []) {
        const at = cands.findIndex(c => sameMove(c, p));
        if (at >= 0) { if (!by[at].includes(mi)) by[at].push(mi); }
        else { cands.push(p); by.push([mi]); }
      }
    });
    if (!cands.length) return null;
    stats.moves++;
    if (cands.length === 1) { stats.unanimous++; return cands[0]; }

    // 2. FUNNEL -- judge what is still alive at this stage's depth, pool, keep the best few.
    let alive = cands.map((_, i) => i);
    for (const st of stages) {
      if (alive.length === 1) break;
      const plans = alive.map(i => cands[i]);
      const rows = judgeAll(pose, idx, plies, plans, st.depth);
      // @borda is the legacy rank rule kept only so the two can be raced; ranks have no scale for
      // a weight to act on, so position weighting applies to the log pool and says so.
      const totals = cfg.borda ? bordaTotals(rows, plans.length) : pool(rows, plans.length, weights);
      const order = plans.map((_, j) => j).sort((a, b) => totals[b] - totals[a]);
      if (o.verbose) {
        console.log('[committee] D' + st.depth + ' ' + plans.map((_, j) =>
          '#' + alive[j] + (totals[j] === -Infinity ? ' DEAD' : totals[j] === Infinity ? ' WIN' : ' ' + totals[j].toFixed(2)) + '[' +
          rows.map((row, mi) => members[mi].name.slice(0, 8) + '=' + fmt(row && row[j])).join(' ') + ']').join(' | '));
      }
      if (totals[order[0]] === Infinity) { stats.provenWins++; alive = [alive[order[0]]]; break; }
      if (totals.some(t => t === -Infinity)) stats.vetoes++;
      const keep = Math.max(1, Math.min(st.keep, order.length));
      // A candidate a member proved lost never advances, even if that leaves fewer than `keep`.
      const kept = order.slice(0, keep).filter(j => totals[j] > -Infinity);
      alive = (kept.length ? kept : order.slice(0, 1)).map(j => alive[j]);
    }
    const pick = alive[0];
    if (!by[pick].includes(0)) stats.chairOverruled++;
    return cands[pick];
  }
  // The old rule, kept behind @borda so the two can be raced against each other: rank within each
  // member, sum the ranks, and treat only a proven loss as disqualifying.
  function bordaTotals(rows, n) {
    const alive = [];
    for (let j = 0; j < n; j++) alive.push(rows.some(row => row && row[j] && row[j].proven < 0) ? null : j);
    const live = alive.filter(j => j !== null);
    const borda = new Array(n).fill(0);
    for (const row of rows) {
      if (!row) continue;
      const ord = live.slice().sort((a, b) => (row[b] ? row[b].s : -Infinity) - (row[a] ? row[a].s : -Infinity));
      ord.forEach((j, rank) => { borda[j] += rank; });
    }
    // higher is better everywhere else, so flip the rank sum and floor the dead
    return borda.map((v, j) => alive[j] === null ? -Infinity : -v);
  }
  fn.stats = stats;
  fn.close = () => { for (const m of members) m.worker.terminate(); };
  return { name, fn, close: fn.close, stats };
}

// ---- the league's committee faces ------------------------------------------------------------
// A committee is an ordinary league face. Every time a new champion is promoted, run.js forms one:
// the champion as chair (ties go to it), a medal net (silver, else bronze, else gold -- the first
// that is a different plain value net) and the strongest live ladder rung. It is written as a small
// model file named for its members, and from there evolution-roster treats it like any other model:
// a D1 seat on arrival, deeper faces (every member searching at that depth) when the frontier
// promotes it, and the elastic cull when it falls behind. Nothing makes it immortal. Its compute is
// charged in full: each member searches in its own thread, so elorank-legacy and the cull price a
// committee face for every member's time rather than the wall clock of one search. Committees of
// earlier champions stay until the cull retires them, so generations sit side by side.
//
// This replaced a sweep that formed committees from the current field, held them immortal until
// each had met 20 faces, and fielded four variants (d2, d3, d2w, d2pair) of the same members. One
// shared lane at 10-50 minutes a match, against a field the cull kept churning, meant the first set
// never finished and no second set ever formed. Depth is now the roster's ordinary frontier
// question; @posw stays available in a spec and committee-weight-match.js measures it directly.
const { atomicWrite } = require('./atomic-write.js');

function plainValueNet(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return !j.committee && !j.dual && !j.policyEntrant && Array.isArray(j.sizes) && +j.sizes[j.sizes.length - 1] === 1;
  } catch (_) { return false; }
}

function formForChampion(dir, champPath, { log = console.log } = {}) {
  const models = path.join(dir, 'models');
  const champ = path.resolve(champPath), champName = path.basename(champ, '.json');
  const sameBytes = f => {
    try { return fs.statSync(f).size === fs.statSync(champ).size && fs.readFileSync(f).equals(fs.readFileSync(champ)); }
    catch (_) { return false; }
  };
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(require('./machine-id.js').medalsMetaPath(dir), 'utf8')); } catch (_) {}
  let medal = null;
  for (const which of ['silver', 'bronze', 'gold']) {
    const src = meta && meta.medals && meta.medals[which] && meta.medals[which].source;
    if (!src || src === champName) continue;
    const file = path.join(models, src + '.json');
    if (!fs.existsSync(file) || !plainValueNet(file) || sameBytes(file)) continue;
    medal = { which, name: src, file };
    break;
  }
  if (!medal) {
    log(`[committee] none formed for ${champName}: no medal holder is a different value net`);
    return null;
  }
  const rung = strongestRung(dir);
  const members = ['nn:0:' + champ, 'nn:0:' + medal.file, rung];
  const name = `committee[${champName},${medal.name},${rung}]`;
  const file = path.join(models, name + '.json');
  if (fs.existsSync(file)) { log(`[committee] ${name} already exists; not formed again`); return null; }
  atomicWrite(file, JSON.stringify({ committee: true, id: name + '@D1', spec: 'committee:' + members.join(';'),
                                     members, champion: champName, medal: { [medal.which]: medal.name }, rung,
                                     formedAt: new Date().toISOString() }, null, 1));
  log(`[committee] formed ${name}: champion ${champName}, ${medal.which} ${medal.name}, ${rung}; an ordinary face from D1 up, ` +
      `charged for all ${members.length} members' compute`);
  return file;
}

// The sweep kept its live committees in models/.committee-state.json with no model file until they
// finished. Any still listed there are written out as ordinary model files -- their spec keeps its
// fixed search depth, so each holds its one D1 seat and its rating continues -- and the list clears.
function releaseLegacyCommittees(dir, { log = console.log } = {}) {
  const p = path.join(dir, 'models', '.committee-state.json');
  let st;
  try { st = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return 0; }
  const live = (st.actives || []).filter(c => !c.swept && c.file && c.spec);
  if (!live.length) return 0;
  const at = new Date().toISOString();
  for (const c of live) {
    if (!fs.existsSync(c.file))
      atomicWrite(c.file, JSON.stringify({ committee: true, id: c.id, spec: c.spec, members: c.members, depth: c.depth,
                                           startedAt: c.startedAt, releasedAt: at }, null, 1));
    Object.assign(c, { swept: true, endedAt: at, reason: 'released: committees are ordinary faces' });
  }
  st.history = (st.history || []).concat(st.actives);
  st.actives = [];
  atomicWrite(p, JSON.stringify(st, null, 1));
  log(`[committee] released ${live.length} sweeping committee(s) as ordinary faces: ${live.map(c => c.name).join(', ')}`);
  return live.length;
}

module.exports = { makeBrain, pickAuto, parseSpec, parseOpts, formForChampion, releaseLegacyCommittees };
