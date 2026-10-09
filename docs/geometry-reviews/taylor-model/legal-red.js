// Is red's 123-substep reply legal from every red pose a cell can produce? The proof of a cell assumes red
// swings pin-foot 0, direction -1, 123 substeps of 0.375 degrees. The engine stops a swing only for two
// reasons, and this checks both on the enclosure of red's pose after blue's reply:
//
//   self-off  a foot past the rim (edgeU + edgeEps = 67.167): cert2.js already requires every foot of
//             every substep to be inside it, so a cell that was proved is also clear of this.
//   crossing  the line-contact rule of crossingSubstep (index.html). A foot is "on" a line when its
//             centre is within touchEps = 0.81 of it, measured after each substep. The first time a
//             non-pivot foot goes on a line is one crossing (the turn's budget is one); the crossing
//             stays open while any non-pivot foot is on a line and closes when none is; touching a line
//             again after that is refused, and so is a foot that, already on one line, touches another
//             away from a printed corner. The pivot foot never moves and costs nothing.
//
// Sufficient condition checked here, for every red branch of every regime of a cell, with each foot's
// position at each substep an interval (red's pose is a Taylor model; its range is taken):
//   1. at the start no non-pivot foot is possibly on any line;
//   2. over substeps 1..123, collect every (foot,line) pair that is possibly on a line (the two side
//      arcs are treated as full circles, which can only add possible touches);
//   3. each candidate pair is strictly monotone around its contact window, so its true contact interval
//      is consecutive;
//   4. different feet may hand one whole-tripod crossing episode from one line to another, so from the
//      first possible contact through the last, at least one candidate line is guaranteed ON at every
//      substep; a single foot touching two distinct lines is rejected here unless corner handling is
//      separately certified.
// Then the engine opens at most one whole-tripod crossing and every one of the 123 substeps is legal.
//
//   node legal-red.js <bluePivot> <blueDir> [from] [to] [degree]   ->  results/arm_X/legal_<from>_<to>.json
'use strict';
const fs = require('fs'), path = require('path');
const iv = require('./iv.js');
const P = require('./push-tm.js');
const { run2, redPath } = require('./cert2.js');
const { MODES } = require('./modes2.js');
const { fromEnv, armResultsDir } = require('./problem.js');
const PR = fromEnv();          // the problem this run is for (PROBLEM env, default Brief 6)
if (PR.firstMover !== 0) throw new Error('legal-red.js assumes firstMover 0 (blue moves first, red is the witness); got ' + PR.firstMover);
const KRED = PR.kRed, WIT = PR.witness;
// The feet that move in the witness swing: every foot but the pinned one. (This was hard-coded as feet 1
// and 2, which is right only for a witness that pins foot 0: with pivot 2 it checked the stationary foot
// and never looked at foot 0. The engine excludes exactly the pinned foot, `i !== st.pinned`.)
const MOVING = [0, 1, 2].filter(j => j !== WIT.pivot);

const R = P.footR, TWO_PI_3 = P.TWO_PI_3;
const TOUCH = 0.81;                                   // CFG.touchEps (lineStick is 0, so stickEps is the same)
const CIRCLES = [
  { id: 'r0', cx: 0, cy: 0, r: 40 }, { id: 'r1', cx: 0, cy: 0, r: 53.3 },
  { id: 'a0', cx: -66.667, cy: 0, r: 40 }, { id: 'a1', cx: 66.667, cy: 0, r: 40 },
];

const feetAt = pose => [0, 1, 2].map(j => {
  const an = iv.add(pose.rot, iv.mul([j, j], TWO_PI_3));
  return { x: iv.add(pose.x, iv.mul(iv.cos(an), [R, R])), y: iv.add(pose.y, iv.mul(iv.sin(an), [R, R])) };
});
const radiusIv = (f, c) => iv.sqrt(iv.add(iv.sqr(iv.sub(f.x, [c.cx, c.cx])), iv.sqr(iv.sub(f.y, [c.cy, c.cy]))));
// guaranteed lower bound of | rho - r | over the interval rho
const lowerDist = (rho, r) => (rho[0] > r ? iv.dn(rho[0] - r) : rho[1] < r ? iv.dn(r - rho[1]) : 0);

const upperDist = (rho, r) => iv.up(Math.max(Math.abs(rho[0] - r), Math.abs(rho[1] - r)));
const PIVOT_MARGIN = 1e-6;

// The pivot foot is never moved, so in exact arithmetic its contact with a line never changes and it
// costs nothing. The float engine recomputes its position from the rotated hub every substep, which
// jitters it by about 1e-14; a pose within that of the edge of a band could therefore flip its contact
// by rounding. The exact-arithmetic model ignores this, but cells where the pivot foot may sit that
// close to a band edge are flagged and counted.
function pivotBorderline(r0) {
  const pivot = feetAt({ x: r0.x.range(), y: r0.y.range(), rot: r0.rot.range() })[WIT.pivot];
  for (const c of CIRCLES) {
    const rho = radiusIv(pivot, c), lo = lowerDist(rho, c.r), up = upperDist(rho, c.r);
    if (!(lo > TOUCH + PIVOT_MARGIN || up < TOUCH - PIVOT_MARGIN)) return `${c.id} band edge, distance in [${lo.toFixed(6)}, ${up.toFixed(6)}]`;
  }
  return null;
}

// one red start pose (a Taylor model state): the verdict for its 123-substep swing
function checkPose(r0) { const v = crossingCheck(r0); v.borderline = pivotBorderline(r0); return v; }
function crossingCheck(r0) {
  const poses = [{ x: r0.x.range(), y: r0.y.range(), rot: r0.rot.range() }];
  for (const p of redPath(r0, WIT.pivot, WIT.dir, KRED)) poses.push({ x: p.x, y: p.y, rot: p.rot });
  // rho[k][j][c] = radius interval of foot j about circle c at substep k
  const rho = poses.map(p => feetAt(p).map(f => CIRCLES.map(c => radiusIv(f, c))));
  const possible = [];                                   // possible[k] = list of [j, c]
  const closest = new Map();                             // smallest guaranteed distance of each (foot, line) pair that never possibly touches
  for (let k = 0; k <= KRED; k++) {
    const list = [];
    for (const j of MOVING) for (let c = 0; c < CIRCLES.length; c++) {
      const d = lowerDist(rho[k][j][c], CIRCLES[c].r), key = j + ':' + c;
      if (d <= TOUCH) list.push([j, c]); closest.set(key, Math.min(closest.has(key) ? closest.get(key) : Infinity, d));
    }
    possible.push(list);
  }
  const clearOf = skip => { let m = Infinity; for (const [key, d] of closest) if (key !== skip) m = Math.min(m, d); return m; };
  if (possible[0].length) return { ok: false, why: 'a foot may start on a line', clearance: Infinity };
  const pairs = new Map();
  for (let k = 1; k <= KRED; k++) for (const [j, c] of possible[k]) {
    const key = j + ':' + c;
    const e = pairs.get(key) || { j, c, k1: k, k2: k };
    e.k2 = k; pairs.set(key, e);
  }
  // The crossing budget is PER TRIPOD, not per foot. Two different feet may therefore be on two
  // different lines at once, provided the piece never becomes clear of all lines in between.
  const clearance = pairs.size ? (pairs.size === 1 ? clearOf([...pairs.keys()][0]) : -Infinity) : clearOf(null);
  if (!pairs.size) return { ok: true, crossing: 'none', clearance };

  // A single foot touching a second distinct line is still illegal unless the lines meet at a printed
  // corner. Keep this conservative here; Target1's overlapping contacts are on different feet.
  const byFoot = new Map();
  for (const e of pairs.values()) {
    const a = byFoot.get(e.j) || []; a.push(e); byFoot.set(e.j, a);
  }
  for (const [j, es] of byFoot) if (es.length > 1)
    return { ok: false, why: 'foot ' + j + ' may touch multiple distinct lines: ' + es.map(e => CIRCLES[e.c].id).join(' '), clearance };

  // Every pair must be monotone around its own contact window, so its possible window describes
  // one contiguous true-contact interval rather than a disconnected event.
  for (const e of pairs.values()) {
    if (e.c > 1) return { ok: false, why: 'foot ' + e.j + ' may touch side arc ' + CIRCLES[e.c].id, clearance };
    const lo = Math.max(0, e.k1 - 1), hi = Math.min(KRED, e.k2 + 1);
    let dec = true, inc = true;
    for (let k = lo; k < hi; k++) {
      if (!(rho[k + 1][e.j][e.c][1] < rho[k][e.j][e.c][0])) dec = false;
      if (!(rho[k + 1][e.j][e.c][0] > rho[k][e.j][e.c][1])) inc = false;
    }
    if (!dec && !inc) return { ok: false, why: 'foot ' + e.j + ' radius is not monotone around window [' + e.k1 + ', ' + e.k2 + '] on ' + CIRCLES[e.c].id, clearance };
  }

  // The whole tripod must make exactly one continuous line-contact episode (the engine bills a crossing
  // when an episode opens and refuses a second one; the episode stays open while any moving foot is
  // within touchEps of a line). Each pair's true contact substeps are one contiguous run (monotone
  // radius, checked above). With one pair that is the whole episode. With several, let the guaranteed
  // block be the substeps where some pair is certainly on a line. If that block has no gap, every pair
  // that is certainly on somewhere in it joins it (its run is contiguous and meets the block), and a pair
  // that is never certainly on must have its possible window inside the block. Then the union of the
  // true runs is one contiguous run: one episode. (Requiring certainty at every possible substep, as
  // before, refused any episode whose first or last substep is uncertain, which is the usual case.)
  const first = Math.min(...[...pairs.values()].map(e => e.k1));
  const last = Math.max(...[...pairs.values()].map(e => e.k2));
  if (pairs.size > 1) {
    const sure = (e, k) => upperDist(rho[k][e.j][e.c], CIRCLES[e.c].r) < TOUCH;
    const G = [];
    for (let k = first; k <= last; k++) if ([...pairs.values()].some(e => sure(e, k))) G.push(k);
    if (!G.length) return { ok: false, why: 'several feet may touch lines and none is certainly on: episode not determined', clearance };
    const g0 = G[0], g1 = G[G.length - 1];
    if (G.length !== g1 - g0 + 1) return { ok: false, why: 'line-contact episode may close between substeps ' + g0 + ' and ' + g1, clearance };
    for (const e of pairs.values()) {
      let hasSure = false;
      for (let k = e.k1; k <= e.k2 && !hasSure; k++) if (k >= g0 && k <= g1 && sure(e, k)) hasSure = true;
      if (!hasSure && (e.k1 < g0 || e.k2 > g1)) return { ok: false, why: 'foot ' + e.j + ' on ' + CIRCLES[e.c].id + ' may touch outside the certain episode [' + g0 + ', ' + g1 + ']', clearance };
    }
  }
  const labels = [...pairs.values()].map(e => 'foot ' + e.j + ' / ' + CIRCLES[e.c].id + ' substeps ' + e.k1 + '..' + e.k2);
  return { ok: true, crossing: labels.join('; '), window: [first, last], clearance };
}

// every red branch of every regime of one cell
function checkCell(bp, bd, a, b, deg, mode, sym, vtx) {
  const m = MODES.find(x => x[0] === mode);
  const r = run2(bp, bd, a, b, deg, { push: { ...(sym ? { symRem: true } : {}), ...(vtx ? { vertexDedup: true } : {}), ...(m ? m[2] : {}) }, keepTrace: true, phaseAOnly: true, problem: PR });
  let ok = true, why = null, clearance = Infinity, branches = 0, borderline = null; const crossings = new Set();
  for (const it of r.trace.items) for (const red of it.red) {
    branches++;
    const v = checkPose(P.fold(red));
    if (v.borderline) borderline = v.borderline;
    clearance = Math.min(clearance, v.clearance);
    if (v.ok) crossings.add(v.crossing); else if (ok) { ok = false; why = v.why; }
  }
  return { ok, why, clearance, branches, borderline, crossings: [...crossings] };
}
module.exports = { checkPose, checkCell };

if (require.main === module) {
  const [bp, bd] = process.argv.slice(2, 4).map(Number);
  const dir = armResultsDir(PR, bp, bd);
  const leaves = [];
  for (const f of fs.readdirSync(dir)) if (/^cover_.*_d\d+\.json$/.test(f)) leaves.push(...JSON.parse(fs.readFileSync(path.join(dir, f))).leaves);
  leaves.sort((p, q) => p.a - q.a);
  const from = process.argv[4] !== undefined ? +process.argv[4] : leaves[0].a, to = process.argv[5] !== undefined ? +process.argv[5] : leaves[leaves.length - 1].b;
  const deg = +(process.argv[6] || 4);
  const cells = leaves.filter(l => l.a >= from && l.b <= to);
  const bad = [], kinds = {}, edge = []; let clearance = Infinity, stopped = 0;
  for (const c of cells) {
    let v;
    try { v = checkCell(bp, bd, c.a, c.b, deg, c.mode, c.sym, c.vtx); } catch (e) { stopped++; bad.push({ a: c.a, b: c.b, why: 'model stopped: ' + e.message.slice(0, 100) }); continue; }
    clearance = Math.min(clearance, v.clearance);
    if (v.borderline) edge.push({ a: c.a, b: c.b, pivot: v.borderline });
    for (const k of v.crossings) kinds[k.replace(/substeps.*/, '')] = (kinds[k.replace(/substeps.*/, '')] || 0) + 1;
    if (!v.ok) bad.push({ a: c.a, b: c.b, why: v.why });
  }
  fs.writeFileSync(path.join(dir, `legal_${from}_${to}.json`), JSON.stringify({ arm: [bp, bd], from, to, cells: cells.length, bad, pivotAtBandEdge: edge }));
  console.log(JSON.stringify({ arm: [bp, bd], range: [from, to], cells: cells.length, legalCells: cells.length - bad.length, notShown: bad.length, stopped, pivotAtBandEdge: edge, crossingKinds: kinds, smallestClearanceOfOtherPairs: clearance, firstBad: bad.slice(0, 5) }, null, 1));
}
