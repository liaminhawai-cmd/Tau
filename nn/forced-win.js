// Forced wins as REGIONS, certified rather than sampled.
//
// The contact law (contact-law.js) makes the outcome of a swing a continuous function of the pose
// except across grazing surfaces (contact vs no contact), and measured over 200 events its throw
// margin -- the furthest any victim foot gets past the rim, negative if none does -- moves less than
// 1u per 1u of victim pose for 90% of contacts (median 0.4, p90 0.85, max ~9) and flips sign by
// ordinary zero-crossing 47 times in 48. So a BOX of victim poses can be certified as thrown by one
// attacker swing from a grid of samples: every sample's margin must clear the box's cell diagonal
// times a Lipschitz allowance, the allowance itself taken from the steepest finite difference the
// grid shows (times a safety factor, never below 1), and every sample must share a contact history
// (same leg pairs touched, first touch within a step of its neighbours) so no grazing surface can
// hide inside. Falsifiable: certify() is always followed by simCheck(), the engine on random poses
// in the box, and a claim the engine contradicts is a bug here, not a rounding.
//
// Level 1 here: throw-in-1 boxes. Level 2 (forced in two: my move, every reply, my throw) is the
// same certificate walked along each of the victim's six reply arcs.
'use strict';
const { swing, IDEAL, REPLICA, feetOf, anyOff, R, EDGE, eng } = require('./contact-law.js');

const MIN_MOVE = eng.CFG.minMoveDeg * Math.PI / 180;

// Put a position on the engine's board (G is rebuilt per game, so fetch it afterwards).
function load(pieces, active) {
  eng.newGame(); const g = eng.getG();
  g.pieces.forEach((p, i) => { p.x = pieces[i].x; p.y = pieces[i].y; p.rot = pieces[i].rot; });
  g.active = active; return g;
}
// How far the mover may swing (pv, dir): its own crossing budget and rim, nothing else -- the mover
// is kinematic, contact never stops it -- so this is a property of the mover's pose alone.
function swingLimit(pieces, active, pv, dir) {
  const g = load(pieces, active); const snap = eng.takeSnap();
  const lim = Math.abs(eng.simMoveToLimit(pv, dir)); eng.restoreSnap(snap); return lim;
}
// Throw margin of one swing swept to its limit: furthest any victim foot gets beyond the rim.
function throwMargin(pieces, active, pv, dir, K) {
  const rad = swingLimit(pieces, active, pv, dir);
  if (rad < MIN_MOVE) return { margin: -Infinity, rad, out: null };
  const out = swing(pieces, active, pv, dir, rad, { ...K, trace: true });
  return { margin: out.maxFootR - EDGE, rad, out };
}
function bestThrow(pieces, active, K) {
  let best = null;
  for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) { const t = throwMargin(pieces, active, pv, dir, K); if (!best || t.margin > best.margin) best = { ...t, pv, dir }; }
  return best;
}
// A contact history's signature: which leg pairs touched, and when the first touch came.
function signature(out) {
  if (!out || !out.trace || !out.trace.length) return { pairs: '', onset: null };
  const pairs = [...new Set(out.trace.map(t => t.i * 3 + t.j))].sort().join(',');
  return { pairs, onset: out.trace[0].alpha };
}

// Certify: every victim pose in `box` ({x:[lo,hi], y:[lo,hi], rot:[lo,hi]}) is thrown by the
// attacker's swing (pv, dir). Grid spacing h in u (rotation spacing h/R). Returns the verdict and
// the evidence.
function certifyThrowBox(pieces, active, pv, dir, box, h, K, opts) {
  const safety = (opts && opts.safety) || 3, lipFloor = (opts && opts.lipFloor) || 1;
  const axis = (lo, hi, step) => { const n = Math.max(1, Math.ceil((hi - lo) / step)); return Array.from({ length: n + 1 }, (_, i) => lo + (hi - lo) * i / n); };
  const xs = axis(box.x[0], box.x[1], h), ys = axis(box.y[0], box.y[1], h), rs = axis(box.rot[0], box.rot[1], h / R);
  const grid = new Map(); let minMargin = Infinity, worstLip = 0, graze = null;
  const key = (i, j, k) => `${i},${j},${k}`;
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) for (let k = 0; k < rs.length; k++) {
    const p = pieces.map(q => ({ ...q })); const v = p[1 - active]; v.x = xs[i]; v.y = ys[j]; v.rot = rs[k];
    const t = throwMargin(p, active, pv, dir, K);
    grid.set(key(i, j, k), { m: t.margin, sig: signature(t.out) });
    if (t.margin < minMargin) minMargin = t.margin;
  }
  // finite differences along each axis, in margin per u (rotation distance measured as R*dtheta)
  const dx = xs.length > 1 ? xs[1] - xs[0] : 1, dy = ys.length > 1 ? ys[1] - ys[0] : 1, dr = rs.length > 1 ? (rs[1] - rs[0]) * R : 1;
  const sig0 = grid.get(key(0, 0, 0)).sig;
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) for (let k = 0; k < rs.length; k++) {
    const a = grid.get(key(i, j, k));
    if (a.sig.pairs !== sig0.pairs) graze = graze || `leg pairs differ: [${sig0.pairs}] vs [${a.sig.pairs}] at (${i},${j},${k})`;
    for (const [n, d] of [[key(i + 1, j, k), dx], [key(i, j + 1, k), dy], [key(i, j, k + 1), dr]]) {
      const b = grid.get(n); if (!b) continue;
      if (Number.isFinite(a.m) && Number.isFinite(b.m)) worstLip = Math.max(worstLip, Math.abs(a.m - b.m) / d);
      if (a.sig.onset != null && b.sig.onset != null && Math.abs(a.sig.onset - b.sig.onset) > 5 * Math.PI / 180) graze = graze || `first touch jumps ${(Math.abs(a.sig.onset - b.sig.onset) * 180 / Math.PI).toFixed(1)}deg between neighbours`;
    }
  }
  const lip = Math.max(lipFloor, safety * worstLip);
  const diag = Math.hypot(dx, dy, dr) / 2;                 // furthest any pose in a cell is from a sample
  const need = lip * diag;
  const certified = !graze && Number.isFinite(minMargin) && minMargin > need;
  return { certified, minMargin, need, lip, worstLip, graze, samples: grid.size };
}

// The engine's own answer on random poses in the box: is the victim thrown at any point of the
// sweep to the limit? Returns how many of n agree with `expect`.
function simCheck(pieces, active, pv, dir, box, n, expect) {
  let agree = 0; const fails = [];
  for (let t = 0; t < n; t++) {
    const p = pieces.map(q => ({ ...q })); const v = p[1 - active];
    v.x = box.x[0] + Math.random() * (box.x[1] - box.x[0]); v.y = box.y[0] + Math.random() * (box.y[1] - box.y[0]); v.rot = box.rot[0] + Math.random() * (box.rot[1] - box.rot[0]);
    const g = load(p, active); eng.pinFoot(pv);
    let thrown = false, guard = 0;
    while (!g.atLimit && guard++ < 400) { eng.applySwing(dir * Math.PI / 180); if (g.pieces[1 - active].feet().some(f => Math.hypot(f.x, f.y) > EDGE)) { thrown = true; break; } }
    if (thrown === expect) agree++; else fails.push({ x: v.x, y: v.y, rot: v.rot });
  }
  return { agree, n, fails };
}

module.exports = { load, swingLimit, throwMargin, bestThrow, certifyThrowBox, simCheck, signature };

if (require.main === module) {
  // Demo on recorded contact events: around every engine throw, try to certify a box of victim
  // poses of half-width `half` and check the claim against the engine.
  const rows = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
  const half = +(process.argv[3] || 0.5), h = +(process.argv[4] || 0.25);
  const K = REPLICA;                                           // certify in the engine's own metric
  let tried = 0, cert = 0, certOK = 0, certBad = 0, refusedGraze = 0, refusedMargin = 0;
  for (const r of rows) {
    if (!r.engine.off) continue;
    const v = r.pieces[1 - r.active];
    const box = { x: [v.x - half, v.x + half], y: [v.y - half, v.y + half], rot: [v.rot - half / R, v.rot + half / R] };
    const c = certifyThrowBox(r.pieces, r.active, r.pv, r.dir, box, h, K);
    tried++;
    if (c.certified) {
      cert++;
      const s = simCheck(r.pieces, r.active, r.pv, r.dir, box, 40, true);
      if (s.agree === s.n) certOK++; else { certBad++; console.log(`  CONTRADICTED: event ${rows.indexOf(r)} min margin ${c.minMargin.toFixed(2)} need ${c.need.toFixed(2)} -- engine disagreed on ${s.n - s.agree}/${s.n}`); }
      console.log(`  certified: min margin ${c.minMargin.toFixed(2)}u > ${c.need.toFixed(2)}u (lip ${c.lip.toFixed(2)}), ${c.samples} samples; engine agrees ${s.agree}/${s.n}`);
    } else if (c.graze) { refusedGraze++; console.log(`  refused (grazing): ${c.graze}`); }
    else { refusedMargin++; console.log(`  refused (margin): min ${c.minMargin.toFixed(2)}u vs need ${c.need.toFixed(2)}u (lip ${c.lip.toFixed(2)})`); }
  }
  console.log(`\nboxes of half-width ${half}u around ${tried} engine throws: certified ${cert} (engine agreed on every pose in ${certOK}, contradicted ${certBad}); refused ${refusedGraze} for grazing, ${refusedMargin} for margin`);
}
