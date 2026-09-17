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
//
// THE GRAPH (nn/family-graph.jsonl, one JSON row per node, immutable once appended). Deeper
// results are regions in the JOINT space of both poses, measured in one metric, d(p, q) = the sum
// over the two pieces of hypot(dx, dy) + R*|drot| (L1 across the pieces and across position and
// rotation; with an L1 metric a max-over-axes finite difference is a valid Lipschitz constant,
// which is what lets a star of probes certify a ball). Two node kinds:
//   point (even plies): the side to move LOSES; region = the L1 ball of radius eps around pose,
//     eps from certifyStar (13 dead certificates, the reply families swept to a reach ENVELOPE of
//     the victim's box rather than each sample's own limit, so no stop reachable anywhere in the
//     ball goes uncertified);
//   arc (odd plies): the side to move WINS by one move that lands exactly on a point node; the
//     arc is the child's attacker unwound about its own foot, every position played forward by the
//     engine, with a tube radius eps = min(child.eps / 3, clearance - 0.17u, limit slack) -- 3 is
//     the L1 Lipschitz constant of a rigid rotation about a foot (hub moves <= |dxy| + 2R|drot|,
//     rot moves |drot|), 0.17u is what the tube gap can change between two samples 0.5 degrees
//     apart (no point of the swinging piece is farther than R*sqrt(3) = 40u from the pivot).
// Level 1 is never stored: "throws now" is bestThrow, "thrown for a box" is certifyThrowBox.
// Every certificate is followed by the engine playing random positions of the claim, and a
// contradiction halts the run: it is a bug here, never a rounding.
'use strict';
const fs = require('fs'), path = require('path');
const { swing, minGapOf, sampleEvent, IDEAL, REPLICA, feetOf, anyOff, R, EDGE, MIND, eng } = require('./contact-law.js');

const MIN_MOVE = eng.CFG.minMoveDeg * Math.PI / 180;
const DEG = Math.PI / 180, SUBSTEP = eng.CFG.substepDeg * DEG;
// Between two samples of a sweep at most 0.5 degrees apart, no point of the swinging piece moves
// more than R*sqrt(3) (the far feet from the pivot) * 0.25 degrees = 0.17u, so the tube gap sampled
// at the law's 0.4-degree step bounds the continuous gap to within this. A proof, not a fit.
const GAP_STEP = R * Math.sqrt(3) * 0.25 * DEG;
// A non-pivot foot travels R*sqrt(3) * (1/3 degree) = 0.23u in one substep of a 1-degree applySwing
// call, so the line a foot was stopped short of is within touchEps + 0.25u of it after the rollback
// (measured at the four dead points: 0.81-1.01u).
const STOP_BAND = eng.CFG.touchEps + 0.25;
// The engine lands a played-forward arc on its target within this (the --back-from tolerance,
// 0.05u and 1e-3 rad per piece), in the metric.
const LAND_TOL = 2 * (0.05 + R * 1e-3);
const GRAPH_PATH = path.join(__dirname, 'family-graph.jsonl');
// PHASE_TOL: how far the law's fixed 0.4-degree record can sit from an engine turn of arbitrary
// phase (applySwing splits each call into EQUAL substeps, so a human drag integrates a different
// ladder). Measured by --phase-tol and read here; null until it has been measured, and level 3
// (pushed landings) must not run without it.
const PHASE_TOL = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'phase-tol.json'), 'utf8')).phaseTol; } catch (e) { return null; } })();
// An ESCAPE claim needs the best throw margin below -ESC_TOL, not merely below zero: the law and the
// engine differ by up to ~0.6u on a push (contact-law.js), and three thin "escapes" mined from real
// games were contradicted by the engine before this existed. Between -ESC_TOL and 0 is unresolved.
const ESC_TOL = 0.75;
// A gap at the engine's substep whose ends both clear this margin (on any arm) is accepted as a
// sliver -- see verifyAllReplies.
const SLIVER_BAR = 5;

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
// The mover's TRUE limit: applySwing looped a degree at a time until the engine stops it or a full
// turn is done. Not simMoveToLimit: that is the AI's move generator and stops at its own 170-degree
// safety cap (index.html AI_SAFETY_CAP_RAD) which a human drag does not have; applySwing itself
// stops only for 'selfoff' (an own foot past the rim) or 'cross' (the one-crossing rule). Measured
// at the four dead points: 13-408 ms per arm against 9-357 ms for simMoveToLimit, the same, because
// these arms stop at 3-110 degrees; the limits differ by 0.1-0.3 degrees (the two ladders' phase).
// Also says WHAT stopped it -- the reason, the lines crossed on the way, the foot that was stopped
// and the line (or rim) it was stopped at -- as a signature: a reach envelope refuses a box whose
// grid neighbours stop on different events, since the limit is only continuous between events.
function limitAt(pieces, active, pv, dir) {
  const g = load(pieces, active); eng.pinFoot(pv); let guard = 0;
  while (!g.atLimit && Math.abs(g.netRad) < 2 * Math.PI - 1e-9 && guard++ < 1200) eng.applySwing(dir * Math.min(DEG, 2 * Math.PI - Math.abs(g.netRad)));
  const feet = g.pieces[active].feet(), reason = g.limitReason || 'full';
  let foot = null, line = null, best = Infinity;
  if (reason === 'selfoff') { for (let i = 0; i < 3; i++) if (i !== pv) { const r = -Math.hypot(feet[i].x, feet[i].y); if (r < best) { best = r; foot = i; line = 'rim'; } } }
  else for (let i = 0; i < 3; i++) { if (i === pv) continue; for (const id of eng.nearLineIds(feet[i], STOP_BAND)) { const d = eng.lineDistOf(feet[i], id); if (d < best) { best = d; foot = i; line = id; } } }
  const crossed = [...new Set(g.justCrossed || [])].sort();
  return { lim: Math.abs(g.netRad), reason, crossed, foot, line, sig: `${reason}|${crossed.join(',')}|${foot == null ? '-' : foot + ':' + line}` };
}
// The limit is a function of the mover's own pose alone (pinFoot and crossingSubstep read only the
// active piece; resolvePush moves only the other one), so it is memoised on that pose. Along a
// contact-free reply the pushed attacker never moves and its six throw limits repeat at every stop;
// measured hit rate 44% at the dead points, verifyAllReplies 44-70 s -> ~30-40 s. Keyed at 1e-7:
// a pose that differs by less is the same pose to the engine's substep.
const limitMemo = new Map(), memoStats = { hits: 0, misses: 0 };
function swingLimitMemo(pieces, active, pv, dir) {
  const p = pieces[active], key = `${p.x.toFixed(7)},${p.y.toFixed(7)},${p.rot.toFixed(7)},${pv},${dir}`;
  const hit = limitMemo.get(key); if (hit !== undefined) { memoStats.hits++; return hit; }
  memoStats.misses++; if (limitMemo.size > 500000) limitMemo.clear();
  const lim = limitAt(pieces, active, pv, dir).lim; limitMemo.set(key, lim); return lim;
}
// Throw margin of one swing swept to its limit: furthest any victim foot gets beyond the rim.
function throwMargin(pieces, active, pv, dir, K) {
  const rad = swingLimitMemo(pieces, active, pv, dir);
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
  // only the contacts BEFORE the foot leaves: nothing after a throw can un-throw it, and a late,
  // irrelevant leg pair was breaking the consistency check between neighbouring stops
  const upto = out.offAt != null ? out.trace.filter(t => t.alpha <= out.offAt + 1e-9) : out.trace;
  const pairs = [...new Set(upto.map(t => t.i * 3 + t.j))].sort().join(',');
  return { pairs, onset: upto.length ? upto[0].alpha : out.trace[0].alpha };
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


// ---- Level 2: forced in two ---------------------------------------------------------------
// A witness is one attacker move M = (arc, stop). It is certified when, along EVERY victim reply
// arc, every stop leaves the attacker a throw: the reply family is ONE sweep of the law (the
// pushed attacker's pose is recorded at every step, and a stop at s is a prefix of the sweep to
// the limit), sampled every `stepDeg`; at each sample the attacker's six throw margins are taken
// and the max must clear a Lipschitz allowance over the gap to the next sample, with the chosen
// arc's contact history consistent between neighbours (else a grazing surface could hide). The
// reply must not throw the attacker either -- the pushed piece's furthest foot is monotone in the
// stop, so the full sweep answers that for every stop at once.
//
// The mover's own pose where a swing is rotated: the law's `swing` moves `active` about its pivot
// but returns only the pushed piece, so the mover's pose at a stop is recomputed here.
function moverAt(piece, pv, dir, rad) {
  const f = feetOf(piece)[pv], c = Math.cos(dir * rad), sn = Math.sin(dir * rad), rx = piece.x - f.x, ry = piece.y - f.y;
  return { x: f.x + rx * c - ry * sn, y: f.y + rx * sn + ry * c, rot: piece.rot + dir * rad };
}
// limOverride: sweep to this angle instead of the mover's own limit -- a reach envelope's hi, so
// that a certificate over a region covers every stop reachable from anywhere in it. Stops past the
// mover's own limit are then certified too (a superset of its replies; past a 'selfoff' limit the
// mover has thrown itself, which the throw margin reads as won at once).
function replyFamily(pieces, mover, pv, dir, K, limOverride) {
  const lim = limOverride != null ? Math.min(limOverride, 2 * Math.PI) : swingLimitMemo(pieces, mover, pv, dir);
  if (lim < MIN_MOVE) return null;
  const out = swing(pieces, mover, pv, dir, lim, { ...K, record: true });
  return { lim, out };
}
function certifyForcedIn2(pieces, attacker, K, opts) {
  const stepDeg = (opts && opts.stepDeg) || 3, replyStepDeg = (opts && opts.replyStepDeg) || 2;
  const safety = (opts && opts.safety) || 3, lipFloor = (opts && opts.lipFloor) || 1;
  const victim = 1 - attacker;
  const candidates = [];
  for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
    const fam = replyFamily(pieces, attacker, pv, dir, K); if (!fam) continue;
    // a candidate is a stop; the victim's pose there comes from the recorded family
    const stepRad = stepDeg * Math.PI / 180;
    for (let s = MIN_MOVE; s <= fam.lim + 1e-9; s += stepRad) {
      const rec = fam.out.record.find(r => r.alpha >= s - 1e-9) || fam.out.record[fam.out.record.length - 1];
      if (rec.maxFootR > EDGE) { candidates.push({ pv, dir, stop: s, winsNow: true }); break; }   // a throw in one: done
      const p = pieces.map(q => ({ ...q })); p[attacker] = moverAt(pieces[attacker], pv, dir, rec.alpha); p[victim] = { x: rec.x, y: rec.y, rot: rec.rot };
      candidates.push({ pv, dir, stop: rec.alpha, after: p });
    }
  }
  const win1 = candidates.find(c => c.winsNow);
  if (win1) return { level: 1, witness: win1, certified: true };
  let best = null, refuted = 0, unresolvedN = 0;
  for (const c of candidates) {
    const v = verifyAllReplies(c.after, victim, K, replyStepDeg, safety, lipFloor);
    if (v.certified) return { level: 2, witness: c, certified: true, detail: v };
    if (v.status === 'escape') refuted++; else unresolvedN++;
    if (!best || v.worstMargin > best.v.worstMargin) best = { c, v };
  }
  return { level: 2, certified: false, closest: best, refuted, unresolvedN, tried: candidates.length };
}
// For a position with `mover` to reply: does every reply leave the other side a throw? Three
// verdicts, never a bare "no": DEAD (certified along every arc), ESCAPE (a sampled stop at which
// no attacker arc has a positive margin -- a real position, checkable), or UNRESOLVED (margins
// positive everywhere sampled but too small for the allowance even at the engine's own substep).
// Gaps that fail the allowance with positive margins at both ends are subdivided before giving up.
function verifyAllReplies(pieces, mover, K, replyStepDeg, safety, lipFloor) {
  return deadCertificate(pieces, mover, K, { replyStepDeg, safety, lipFloor });
}
// The same certificate with what a REGION needs of it. opts.reach: the six per-arm reach
// envelopes of the victim's box (index pv*2 + (dir < 0)); each reply family is swept to its hi
// instead of this sample's own limit. opts.screen: stops every 8 degrees and no gap loop, ~6 s,
// returning only the smallest best margin seen (minBest) -- a cheap first look at a candidate
// child before its certificate is paid for. And every verdict carries a PROFILE: per reply arm,
// the certified gaps with the SET of attacker arcs that certify each (a bitmask over apv*2 +
// (adir < 0)); two profiles are consistent when every pair of overlapping gaps shares a certifying
// arc, i.e. the same throw answers the same reply across the region -- the grazing guard the star
// needs between its probes, tolerant of the ties that a "first arc" rule would break on.
// worstMargin is computed exactly as before this existed (the running best over arcs up to and
// including the first certifying one), so verifyAllReplies' verdicts and margins are unchanged.
function deadCertificate(pieces, mover, K, opts) {
  opts = opts || {};
  const replyStepDeg = opts.replyStepDeg || 2, safety = opts.safety || 3, lipFloor = opts.lipFloor || 1, reach = opts.reach || null, screen = !!opts.screen;
  const other = 1 - mover; let worstMargin = Infinity, legalArcs = 0, unresolved = null, slivers = 0, minBest = Infinity;
  const minStepRad = SUBSTEP, profile = [];
  for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
    const env = reach ? reach[pv * 2 + (dir < 0 ? 1 : 0)] : null;
    const fam = replyFamily(pieces, mover, pv, dir, K, env ? env.hi : undefined); if (!fam) { profile.push({ pv, dir, legal: false }); continue; }
    legalArcs++;
    if (fam.out.maxFootR > EDGE) return { certified: false, status: 'escape', why: `reply (${pv},${dir}) throws the attacker`, escape: { pv, dir, stop: fam.out.offAt, throws: true }, worstMargin: -Infinity, profile };
    const rec = fam.out.record;
    const sampleAt = a => {
      const r = rec.find(q => q.alpha >= a - 1e-9) || rec[rec.length - 1];
      const p = pieces.map(q => ({ ...q })); p[mover] = moverAt(pieces[mover], pv, dir, r.alpha); p[other] = { x: r.x, y: r.y, rot: r.rot };
      const arcs = [];
      for (let apv = 0; apv < 3; apv++) for (const adir of [1, -1]) { const t = throwMargin(p, other, apv, adir, K); arcs.push({ apv, adir, m: t.margin, sig: signature(t.out) }); }
      return { alpha: r.alpha, arcs, best: Math.max(...arcs.map(x => x.m)) };
    };
    const stepRad = (screen ? 8 : replyStepDeg) * Math.PI / 180, first = [];
    for (let a = MIN_MOVE; ; a += stepRad) { const last = a >= fam.lim - 1e-9; first.push(sampleAt(last ? fam.lim : a)); if (last) break; }
    for (const smp of first) { minBest = Math.min(minBest, smp.best); if (smp.best <= -ESC_TOL) return { certified: false, status: 'escape', why: `reply (${pv},${dir}) to ${(smp.alpha * 180 / Math.PI).toFixed(1)}deg leaves no throw (best margin ${smp.best.toFixed(2)}u)`, escape: { pv, dir, stop: smp.alpha, bestMargin: smp.best }, worstMargin: Math.min(worstMargin, smp.best), minBest, profile }; }
    if (screen) { profile.push({ pv, dir, legal: true, lim: fam.lim, stops: first.map(s => ({ alpha: s.alpha, best: s.best })) }); continue; }
    // certify each gap, subdividing while it fails with positive ends
    const gaps = [], done = []; for (let k = 0; k + 1 < first.length; k++) gaps.push([first[k], first[k + 1]]);
    while (gaps.length) {
      const [A, B] = gaps.pop(); const gapU = (B.alpha - A.alpha) * 2 * R;
      let ok = false, bestM = -Infinity, mask = 0, firstArc = -1;
      for (let i = 0; i < 6; i++) {
        const a = A.arcs[i], b = B.arcs[i];
        if (!Number.isFinite(a.m) || !Number.isFinite(b.m)) continue;
        const lip = Math.max(lipFloor, safety * Math.abs(a.m - b.m) / Math.max(gapU, 1e-9)), need = lip * gapU / 2;
        const consistent = a.sig.pairs === b.sig.pairs && (a.sig.onset == null || b.sig.onset == null || Math.abs(a.sig.onset - b.sig.onset) < 5 * Math.PI / 180);
        if (!ok) bestM = Math.max(bestM, Math.min(a.m, b.m));
        if (a.m > need && b.m > need && consistent) { mask |= 1 << i; if (!ok) { ok = true; firstArc = i; } }
      }
      if (ok) { worstMargin = Math.min(worstMargin, bestM); done.push({ from: A.alpha, to: B.alpha, arcs: mask, arc: firstArc, pairs: A.arcs[firstArc].sig.pairs, m: bestM }); continue; }
      if (B.alpha - A.alpha > minStepRad * 1.5) {                       // subdivide
        const M = sampleAt((A.alpha + B.alpha) / 2);
        minBest = Math.min(minBest, M.best);
        if (M.best <= -ESC_TOL) return { certified: false, status: 'escape', why: `reply (${pv},${dir}) to ${(M.alpha * 180 / Math.PI).toFixed(1)}deg leaves no throw (best margin ${M.best.toFixed(2)}u)`, escape: { pv, dir, stop: M.alpha, bestMargin: M.best }, worstMargin: Math.min(worstMargin, M.best), minBest, profile };
        gaps.push([A, M], [M, B]); continue;
      }
      // At the engine's own substep, a gap whose two ends both clear a high bar on SOME arm (not
      // necessarily the same one) is accepted as a sliver: for the throw to vanish inside it, the
      // margin would have to fall from over SLIVER_BAR to zero and back within one substep, which
      // the engine itself cannot resolve. Counted and reported, so the certificate says
      // "relative to the engine's resolution" in so many words.
      if (A.best > SLIVER_BAR && B.best > SLIVER_BAR) { slivers++; worstMargin = Math.min(worstMargin, Math.min(A.best, B.best)); done.push({ from: A.alpha, to: B.alpha, arcs: 0, arc: -1, sliver: true, m: Math.min(A.best, B.best) }); continue; }
      unresolved = unresolved || `reply (${pv},${dir}) ${(A.alpha * 180 / Math.PI).toFixed(1)}-${(B.alpha * 180 / Math.PI).toFixed(1)}deg: no single arc certifies the gap (best min margin ${bestM.toFixed(2)}u) even at the engine's substep -- the throw changes arm here`;
      worstMargin = Math.min(worstMargin, bestM);
      done.push({ from: A.alpha, to: B.alpha, arcs: 0, arc: -1, unresolved: true, m: bestM });
    }
    done.sort((a, b) => a.from - b.from);
    // segments: runs of gaps certified by the same set of arcs, as the arm reads to a person
    const segments = []; for (const gp of done) { const L = segments[segments.length - 1]; if (L && L.arcs === gp.arcs) { L.to = gp.to; L.n++; } else segments.push({ from: gp.from, to: gp.to, arcs: gp.arcs, arc: gp.arc, n: 1 }); }
    profile.push({ pv, dir, legal: true, lim: fam.lim, gaps: done, segments });
  }
  if (screen) return { certified: false, status: 'screen', minBest, legalArcs, profile };
  if (!legalArcs) return { certified: false, status: 'escape', why: 'victim has no legal reply', worstMargin: -Infinity, profile };
  if (unresolved) return { certified: false, status: 'unresolved', why: unresolved, worstMargin, slivers, minBest, profile };
  return { certified: true, status: 'dead', worstMargin, slivers, minBest, profile };
}
// Two dead profiles agree when, on every reply arm, every pair of overlapping certified gaps shares
// a certifying attacker arc. Slivers (no certifying arc, at the substep) are wildcards.
function profilesConsistent(a, b) {
  const bad = [], deg = x => (x * 180 / Math.PI).toFixed(1), arcsOf = m => [0, 1, 2, 3, 4, 5].filter(i => m & (1 << i)).map(i => `(${i >> 1},${i & 1 ? -1 : 1})`).join('');
  for (let k = 0; k < 6; k++) {
    const A = a[k], B = b[k]; if (!A || !B) { bad.push({ arm: k, why: 'missing arm' }); continue; }
    if (!!A.legal !== !!B.legal) { bad.push({ arm: k, why: `arm (${A.pv},${A.dir}) legal at one sample only` }); continue; }
    if (!A.legal) continue;
    let hit = null;
    for (const ga of A.gaps) { for (const gb of B.gaps) {
      const lo = Math.max(ga.from, gb.from), hi = Math.min(ga.to, gb.to);
      if (hi - lo <= 1e-9 || !ga.arcs || !gb.arcs) continue;
      if (!(ga.arcs & gb.arcs)) { hit = `arm (${A.pv},${A.dir}) ${deg(lo)}-${deg(hi)}deg certified by ${arcsOf(ga.arcs)} at one sample and ${arcsOf(gb.arcs)} at the other`; break; }
    } if (hit) break; }
    if (hit) bad.push({ arm: k, why: hit });
  }
  return { ok: bad.length === 0, bad };
}
// The family profile: from a parent position with `mover` to move, every reply arm sampled every
// `stepDeg`, and at each stop the other side's best throw margin -- so an arm reads as segments,
// "stops 2-14 degrees dead, 14-43 alive". This is the class description: every position in a
// dead segment is one you reach from the same parent by the same arm, and is lost.
function familyProfile(pieces, mover, K, stepDeg) {
  const other = 1 - mover, arms = [];
  for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
    const fam = replyFamily(pieces, mover, pv, dir, K); if (!fam) { arms.push({ pv, dir, legal: false }); continue; }
    const stepRad = (stepDeg || 2) * Math.PI / 180, stops = [];
    for (let a = MIN_MOVE; ; a += stepRad) {
      const last = a >= fam.lim - 1e-9, at = last ? fam.lim : a;
      const rec = fam.out.record.find(q => q.alpha >= at - 1e-9) || fam.out.record[fam.out.record.length - 1];
      const p = pieces.map(q => ({ ...q })); p[mover] = moverAt(pieces[mover], pv, dir, rec.alpha); p[other] = { x: rec.x, y: rec.y, rot: rec.rot };
      const thrown = rec.maxFootR > EDGE;                                       // the reply itself throws the other side
      const bt = thrown ? null : bestThrow(p, other, K);
      stops.push({ deg: +(rec.alpha * 180 / Math.PI).toFixed(1), margin: thrown ? -Infinity : +bt.margin.toFixed(2), wins: thrown });
      if (last) break;
    }
    // segments of equal fate
    const segs = []; for (const st of stops) { const fate = st.wins ? 'WINS' : st.margin > 0 ? 'dead' : 'alive'; const L = segs[segs.length - 1]; if (L && L.fate === fate) { L.to = st.deg; L.n++; } else segs.push({ fate, from: st.deg, to: st.deg, n: 1 }); }
    arms.push({ pv, dir, legal: true, limitDeg: +(fam.lim * 180 / Math.PI).toFixed(1), stops, segments: segs });
  }
  return arms;
}
// A DEAD verdict over a box of the victim's poses (the attacker held): every grid sample must
// certify dead with its worst margin clearing the cell diagonal times a Lipschitz allowance taken
// from the grid's steepest finite difference (never under 1). Sample verdicts other than dead
// refuse the box outright. This is what turns a dead POINT into a dead REGION -- and a region is
// what the next rung needs, because "every victim move lands in a forced win in two" can only be
// tested against regions, never against the curves a single dead point unwinds into.
function certifyDeadBox(pieces, victim, box, h, K, opts) {
  const safety = (opts && opts.safety) || 3, lipFloor = (opts && opts.lipFloor) || 1;
  const axis = (lo, hi, step) => { const n = Math.max(1, Math.ceil((hi - lo) / step)); return Array.from({ length: n + 1 }, (_, i) => lo + (hi - lo) * i / n); };
  const xs = axis(box.x[0], box.x[1], h), ys = axis(box.y[0], box.y[1], h), rs = axis(box.rot[0], box.rot[1], h / R);
  const grid = new Map(), key = (i, j, k) => `${i},${j},${k}`; let minMargin = Infinity, worstLip = 0, refuse = null;
  for (let i = 0; i < xs.length && !refuse; i++) for (let j = 0; j < ys.length && !refuse; j++) for (let k = 0; k < rs.length && !refuse; k++) {
    const p = pieces.map(q => ({ ...q })); const v = p[victim]; v.x = xs[i]; v.y = ys[j]; v.rot = rs[k];
    const r = verifyAllReplies(p, victim, K, 2, 3, 1);
    if (r.status !== 'dead') { refuse = `sample (${i},${j},${k}) is ${r.status}: ${r.why}`; break; }
    grid.set(key(i, j, k), r.worstMargin); minMargin = Math.min(minMargin, r.worstMargin);
  }
  if (refuse) return { certified: false, why: refuse, samples: grid.size };
  const dx = xs.length > 1 ? xs[1] - xs[0] : 1, dy = ys.length > 1 ? ys[1] - ys[0] : 1, dr = rs.length > 1 ? (rs[1] - rs[0]) * R : 1;
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) for (let k = 0; k < rs.length; k++) {
    const a = grid.get(key(i, j, k));
    for (const [n, d] of [[key(i + 1, j, k), dx], [key(i, j + 1, k), dy], [key(i, j, k + 1), dr]]) { const b = grid.get(n); if (b != null) worstLip = Math.max(worstLip, Math.abs(a - b) / d); }
  }
  const lip = Math.max(lipFloor, safety * worstLip), need = lip * Math.hypot(dx, dy, dr) / 2;
  return { certified: minMargin > need, minMargin, need, lip, samples: grid.size, why: minMargin > need ? null : `min worst-margin ${minMargin.toFixed(2)}u under the allowance ${need.toFixed(2)}u` };
}
// The engine's check of an ESCAPE claim: play the escaping reply, then sweep every attacker arc;
// the attacker must find no throw.
function simCheckEscape(pieces, victim, esc) {
  const attacker = 1 - victim; let g = load(pieces, victim); eng.pinFoot(esc.pv); let guard = 0;
  while (!g.atLimit && Math.abs(g.netRad) < esc.stop - 1e-9 && guard++ < 2000) { eng.applySwing(esc.dir * Math.min(Math.PI / 180, esc.stop - Math.abs(g.netRad))); if (g.pieces[attacker].feet().some(f => Math.hypot(f.x, f.y) > EDGE)) return { agree: !!esc.throws }; }
  const after = g.pieces.map(p => ({ x: p.x, y: p.y, rot: p.rot }));
  for (let apv = 0; apv < 3; apv++) for (const adir of [1, -1]) {
    g = load(after, attacker); eng.pinFoot(apv); guard = 0;
    while (!g.atLimit && guard++ < 400) { eng.applySwing(adir * Math.PI / 180); if (g.pieces[victim].feet().some(f => Math.hypot(f.x, f.y) > EDGE)) return { agree: false, thrownBy: [apv, adir] }; }
  }
  return { agree: true };
}
// The engine's check of a level-2 claim: random replies (arc, stop) played by the engine, then
// the engine sweeps each attacker arc to its limit looking for a throw.
function simCheckForcedIn2(pieces, attacker, witness, n) {
  const victim = 1 - attacker; let agree = 0; const fails = [];
  for (let t = 0; t < n; t++) {
    let g = load(pieces, attacker); eng.pinFoot(witness.pv);
    let guard = 0; while (!g.atLimit && Math.abs(g.netRad) < witness.stop - 1e-9 && guard++ < 2000) eng.applySwing(witness.dir * Math.min(Math.PI / 180, witness.stop - Math.abs(g.netRad)));
    const after = g.pieces.map(p => ({ x: p.x, y: p.y, rot: p.rot }));
    // a random legal reply
    const pv = Math.floor(Math.random() * 3), dir = Math.random() < 0.5 ? 1 : -1;
    g = load(after, victim); const snap = eng.takeSnap(); const lim = Math.abs(eng.simMoveToLimit(pv, dir)); eng.restoreSnap(snap);
    if (lim < MIN_MOVE) { t--; continue; }
    const stop = MIN_MOVE + Math.random() * (lim - MIN_MOVE);
    eng.pinFoot(pv); guard = 0; let attackerThrown = false;
    while (!g.atLimit && Math.abs(g.netRad) < stop - 1e-9 && guard++ < 2000) { eng.applySwing(dir * Math.min(Math.PI / 180, stop - Math.abs(g.netRad))); if (g.pieces[attacker].feet().some(f => Math.hypot(f.x, f.y) > EDGE)) { attackerThrown = true; break; } }
    const after2 = g.pieces.map(p => ({ x: p.x, y: p.y, rot: p.rot }));
    let thrown = false;
    if (!attackerThrown) for (let apv = 0; apv < 3 && !thrown; apv++) for (const adir of [1, -1]) {
      g = load(after2, attacker); eng.pinFoot(apv); guard = 0;
      while (!g.atLimit && guard++ < 400) { eng.applySwing(adir * Math.PI / 180); if (g.pieces[victim].feet().some(f => Math.hypot(f.x, f.y) > EDGE)) { thrown = true; break; } }
      if (thrown) break;
    }
    if (thrown && !attackerThrown) agree++; else fails.push({ pv, dir, stop, attackerThrown });
  }
  return { agree, n, fails };
}

// The engine's check of a "dead" claim (victim to move, every move loses to a throw): random
// legal victim moves played by the engine, then the engine sweeps each attacker arc for the throw.
function simCheckDead(pieces, victim, n) {
  const attacker = 1 - victim; let agree = 0; const fails = [];
  for (let t = 0; t < n; t++) {
    const pv = Math.floor(Math.random() * 3), dir = Math.random() < 0.5 ? 1 : -1;
    let g = load(pieces, victim); const snap = eng.takeSnap(); const lim = Math.abs(eng.simMoveToLimit(pv, dir)); eng.restoreSnap(snap);
    if (lim < MIN_MOVE) { t--; continue; }
    const stop = MIN_MOVE + Math.random() * (lim - MIN_MOVE);
    eng.pinFoot(pv); let guard = 0, attackerThrown = false;
    while (!g.atLimit && Math.abs(g.netRad) < stop - 1e-9 && guard++ < 2000) { eng.applySwing(dir * Math.min(Math.PI / 180, stop - Math.abs(g.netRad))); if (g.pieces[attacker].feet().some(f => Math.hypot(f.x, f.y) > EDGE)) { attackerThrown = true; break; } }
    const after = g.pieces.map(p => ({ x: p.x, y: p.y, rot: p.rot }));
    let thrown = false;
    if (!attackerThrown) for (let apv = 0; apv < 3 && !thrown; apv++) for (const adir of [1, -1]) {
      g = load(after, attacker); eng.pinFoot(apv); guard = 0;
      while (!g.atLimit && guard++ < 400) { eng.applySwing(adir * Math.PI / 180); if (g.pieces[victim].feet().some(f => Math.hypot(f.x, f.y) > EDGE)) { thrown = true; break; } }
      if (thrown) break;
    }
    if (thrown && !attackerThrown) agree++; else fails.push({ pv, dir, stop, attackerThrown });
  }
  return { agree, n, fails };
}

// ---- The graph: metric, reach envelopes, stars, arcs, lookup, the file ------------------------
// Poses travel as the game's own six numbers [bx, by, brot, rx, ry, rrot], rotations raw.
const pose6 = p => typeof p[0] === 'number' ? p : [p[0].x, p[0].y, p[0].rot, p[1].x, p[1].y, p[1].rot];
const piecesOf = p => typeof p[0] === 'number' ? [{ x: p[0], y: p[1], rot: p[2] }, { x: p[3], y: p[4], rot: p[5] }] : p.map(q => ({ ...q }));
const ARMS = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
const armIndex = (pv, dir) => pv * 2 + (dir < 0 ? 1 : 0);
// The metric: L1 across the pieces and across position and rotation, rotation weighted by R so a
// unit is a unit of foot travel either way. Rotations compared raw: the tripod's 120-degree
// relabelling is a symmetry of the geometry but not of the game's numbers, and the dedupe key is
// where symmetries live.
function dist6(p, q) {
  const a = pose6(p), b = pose6(q);
  return Math.hypot(a[0] - b[0], a[1] - b[1]) + R * Math.abs(a[2] - b[2]) + Math.hypot(a[3] - b[3], a[4] - b[4]) + R * Math.abs(a[5] - b[5]);
}
// A random point inside the L1 ball of radius eps around a pose: the length split over the six
// axes by normalised exponentials with random signs (uniform on the L1 sphere), the radius drawn
// as eps * U^(1/6) (uniform in the ball). The xy axes are entered as |dx| + |dy| >= hypot(dx, dy),
// so every sample is inside the metric ball, biased slightly inward on those axes.
function randomInBall(pose, eps) {
  const p = pose6(pose).slice(); if (!(eps > 0)) return p;
  const e = Array.from({ length: 6 }, () => -Math.log(1 - Math.random())), s = e.reduce((a, b) => a + b, 0), r = eps * Math.pow(Math.random(), 1 / 6);
  for (let k = 0; k < 6; k++) { const v = (Math.random() < 0.5 ? -1 : 1) * r * e[k] / s; p[k] += k % 3 === 2 ? v / R : v; }
  return p;
}

// The reach ENVELOPE of one reply arm over a box of the mover's pose: the limit on an n^3 grid, the
// steepest finite difference between grid neighbours times the standing safety factor 3 (floor 1
// degree per u: a foot 40u from the pivot meets a line ~1.4 degrees later per unit of hub shift,
// so the floor is below the natural slope; the throw certificates' floor of 1 is margin-u per u,
// and a floor of 1 radian per u here would be a 20-degree allowance on a 0.375u half-cell), times
// the half cell diagonal in L1, plus one substep (0.4 degrees: applySwing splits each call into
// EQUAL substeps, so the ladder's phase depends on the caller and the limit with it, measured at
// 0.1-0.3 degrees between 3-degree and 1-degree steps). Refused when two grid neighbours stop on
// different events -- the limit is continuous only between events, and a box straddling a
// tangency (a foot's arc grazing a line's band, a corner merge flipping) is two regions, to be
// split along the named axis, never averaged. D-claims (the victim's replies) use hi; W-claims
// (the attacker's witness legality) use lo.
function reachEnvelope(pieces, mover, pv, dir, box, n) {
  n = n || 5;
  const ax = (lo, hi) => Array.from({ length: n }, (_, i) => n === 1 ? (lo + hi) / 2 : lo + (hi - lo) * i / (n - 1));
  const xs = ax(box.x[0], box.x[1]), ys = ax(box.y[0], box.y[1]), rs = ax(box.rot[0], box.rot[1]);
  const L = new Map(), key = (i, j, k) => `${i},${j},${k}`;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const p = pieces.map(q => ({ ...q })); p[mover] = { x: xs[i], y: ys[j], rot: rs[k] };
    const l = limitAt(p, mover, pv, dir); L.set(key(i, j, k), l); lo = Math.min(lo, l.lim); hi = Math.max(hi, l.lim);
  }
  const dx = n > 1 ? xs[1] - xs[0] : 0, dy = n > 1 ? ys[1] - ys[0] : 0, dr = n > 1 ? (rs[1] - rs[0]) * R : 0;
  let slope = 0, refused = null;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const a = L.get(key(i, j, k));
    for (const [nb, d] of [[[i + 1, j, k], dx], [[i, j + 1, k], dy], [[i, j, k + 1], dr]]) {
      const b = L.get(key(...nb)); if (!b) continue;
      if (a.sig !== b.sig) refused = refused || `arm (${pv},${dir}): stopping event changes between cells (${i},${j},${k})-(${nb}): ${a.sig} vs ${b.sig}`;
      slope = Math.max(slope, Math.abs(a.lim - b.lim) / d);
    }
  }
  const lip = Math.max(DEG, 3 * slope), allow = lip * (dx + dy + dr) / 2 + SUBSTEP, c = L.get(key(n >> 1, n >> 1, n >> 1));
  return { pv, dir, lo: lo - allow, hi: hi + allow, sig: c.sig, reason: c.reason, crossed: c.crossed, foot: c.foot, line: c.line, min: lo, max: hi, slope, lip, allow, n, refused };
}
const envText = e => `(${e.pv},${e.dir}) ${(e.lo * 180 / Math.PI).toFixed(1)}-${(e.hi * 180 / Math.PI).toFixed(1)} deg [${e.reason}${e.crossed.length ? ' ' + e.crossed.join(',') : ''}${e.foot != null ? ' foot ' + e.foot + (e.reason === 'selfoff' ? '' : ' at ' + e.line) : ''}]`;

// certifyStar: a dead POINT becomes a dead BALL. Six reach envelopes over the victim's box (+-h,
// rotation +-h/R); the certificate at the centre and at +-h on each of the six axes, every one
// with the families swept to the envelopes; all 13 dead and every probe's profile consistent with
// the centre's; lipStar = max(1, 3 * the steepest central difference of W per u); then every q
// with d(q, pose) <= eps has W(q) >= W_centre - lipStar * eps > 0, so eps = min(h, W_centre /
// lipStar). Falsified by simCheckDeadBall right after.
function certifyStar(node, h, K, opts) {
  const log = (opts && opts.log) || (() => {}), V = node.side, A = 1 - V, base = piecesOf(node.pose), v = base[V];
  const box = { x: [v.x - h, v.x + h], y: [v.y - h, v.y + h], rot: [v.rot - h / R, v.rot + h / R] };
  node.reach = []; const refused = [];
  for (const [pv, dir] of ARMS) { const t = Date.now(); const e = reachEnvelope(base, V, pv, dir, box, 5); node.reach.push(e); log(`  reach: arm ${envText(e)}  grid ${e.min === Infinity ? '-' : (e.min * 180 / Math.PI).toFixed(1)}-${(e.max * 180 / Math.PI).toFixed(1)}, slope ${(e.slope / DEG).toFixed(2)} deg/u, allow ${(e.allow / DEG).toFixed(2)} deg (${((Date.now() - t) / 1000).toFixed(0)}s)${e.refused ? '  REFUSED: ' + e.refused : ''}`); if (e.refused) refused.push(e.refused); }
  if (refused.length) { node.star = { h, refused, certified: false }; return node; }
  const axes = [[V, 'x', h], [V, 'y', h], [V, 'rot', h / R], [A, 'x', h], [A, 'y', h], [A, 'rot', h / R]];
  const run = (p, tag, axis, sign) => {
    const t = Date.now(), r = deadCertificate(p, V, K, { reach: node.reach }), secs = +((Date.now() - t) / 1000).toFixed(0);
    log(`  ${tag}: ${r.status} worst ${Number.isFinite(r.worstMargin) ? r.worstMargin.toFixed(3) : r.worstMargin} (${secs}s)${r.why ? ' ' + r.why : ''}`);
    return { axis, sign, tag, status: r.status, W: r.worstMargin, why: r.why || null, slivers: r.slivers || 0, secs, profile: r.profile };
  };
  const centre = run(base, 'centre', -1, 0), probes = [];
  for (let i = 0; i < 6; i++) for (const sign of [1, -1]) { const p = base.map(q => ({ ...q })); p[axes[i][0]][axes[i][1]] += sign * axes[i][2]; probes.push(run(p, `${axes[i][0] === V ? 'V' : 'A'}.${axes[i][1]}${sign > 0 ? '+' : '-'}`, i, sign)); }
  let allDead = centre.status === 'dead', minW = centre.W; const badArms = new Set(), whys = [];
  for (const pr of probes) {
    if (pr.status !== 'dead') { allDead = false; pr.profileOK = null; continue; }
    minW = Math.min(minW, pr.W);
    const c = centre.status === 'dead' ? profilesConsistent(centre.profile, pr.profile) : { ok: false, bad: [] };
    pr.profileOK = c.ok; if (!c.ok) { pr.profileWhy = c.bad.map(b => b.why); for (const b of c.bad) { badArms.add(b.arm); whys.push(`${pr.tag}: ${b.why}`); } }
  }
  let maxSlope = 0; const slopes = [];
  for (let i = 0; i < 6; i++) { const plus = probes[2 * i], minus = probes[2 * i + 1]; const s = plus.status === 'dead' && minus.status === 'dead' ? Math.abs(plus.W - minus.W) / (2 * h) : null; slopes.push(s); if (s != null) maxSlope = Math.max(maxSlope, s); }
  const lipStar = Math.max(1, 3 * maxSlope), certified = allDead && badArms.size === 0;
  const strip = pr => ({ ...pr, profile: pr.profile ? pr.profile.map(a => a.legal ? { pv: a.pv, dir: a.dir, lim: a.lim, segments: a.segments } : a) : null });
  node.star = { h, probes: [strip(centre), ...probes.map(strip)], lipStar, maxSlope, slopes, consistentArms: 6 - badArms.size, inconsistent: whys, minW, certified };
  node.margin = centre.W; node.lip = lipStar; node.eps = certified ? Math.min(h, centre.W / lipStar) : 0; node.need = lipStar * node.eps;
  return node;
}
// The engine on the ball: random poses inside it, each played through random legal victim moves
// (the engine's own limits, random stops), then the six attacker sweeps: every trial must end in a
// throw of the victim.
function simCheckDeadBall(node, nPoses, nMoves) {
  let agree = 0; const fails = [];
  for (let t = 0; t < nPoses; t++) {
    const q = piecesOf(randomInBall(node.pose, node.eps)), s = simCheckDead(q, node.side, nMoves);
    if (s.agree === s.n) agree++; else fails.push({ pose: pose6(q).map(x => +x.toFixed(4)), fails: s.fails.slice(0, 2) });
  }
  return { trials: nPoses, moves: nMoves, agree, n: nPoses, fails };
}

// The position on an arc at unwound angle s: the child's pose with its attacker rotated back about
// its own foot pv. Playing (pv, dir) forward by s from here lands exactly on the child (the same
// rigid rotation, inverted) when nothing is touched on the way.
function arcPose(node, s) { const p = piecesOf(node.pose); p[node.side] = moverAt(p[node.side], node.arc.pv, -node.arc.dir, s); return p; }
// unwindArcs: from a point node, the six arms of the side that just moved in, each unwound a degree
// at a time from 2 to 359 (uncapped, like the limit). A sample is on the arc when the engine plays
// the forward swing and lands BOTH pieces on the child (the --back-from test: the attacker within
// 0.05u / 1e-3 rad, the victim likewise, no limit hit), the law's sweep pushes nothing (the pushed
// piece's pose exactly unchanged, no leg contact traced) and the engine's limit from there clears
// the stop by a substep. Samples are cut into arcs where that fails or where the stopping event
// (limitAt's signature) changes, so one arc has one limit event to probe. The tube radius is
// eps = min(child.eps / 3, clearance - 0.17u, limSlack) with clearance = the least gap over the
// sweep minus MIND -- measured at the four dead points from real games the landing pose ITSELF is
// in contact (gap - MIND = +-2e-5, the solver's resolution: the victim was pushed into place), so
// every arc into them has clearance 0 and eps 0. Such an arc is still a certified curve (every
// position on it wins by the engine-played swing plus the child's certificate); a positive tube
// needs a child whose landing is clear of contact, or a pushed-landing allowance that does not
// exist yet (the victim's push per unit of penetration is up to ~3.7x in this metric: hf floored
// at 0.35, lever arm 0.39R).
function unwindArcs(node, K, opts) {
  const log = (opts && opts.log) || (() => {}), att = 1 - node.side, D = piecesOf(node.pose), hubMax = eng.CFG.edgeU - R - eng.CFG.edgeEps, arcs = [];
  for (const [pv, dir] of ARMS) {
    const t0 = Date.now(), samples = [], tally = { off: 0, limit: 0, pushed: 0, contact: 0, slack: 0, ok: 0 };
    for (let deg = 2; deg <= 359; deg++) {
      const s = deg * DEG, prev = D.map(q => ({ ...q })); prev[att] = moverAt(D[att], pv, -dir, s);
      const smp = { s, ok: false };
      if (anyOff(prev[att]) || Math.hypot(prev[att].x, prev[att].y) > hubMax) { tally.off++; samples.push(smp); continue; }
      const g = load(prev, att); eng.pinFoot(pv); let guard = 0;
      while (!g.atLimit && Math.abs(g.netRad) < s - 1e-9 && guard++ < 3000) eng.applySwing(dir * Math.min(DEG, s - Math.abs(g.netRad)));
      const a = g.pieces[att], m = g.pieces[node.side];
      const lands = !g.atLimit && Math.abs(g.netRad) >= s - 1e-6 && Math.hypot(a.x - D[att].x, a.y - D[att].y) < 0.05 && Math.abs(a.rot - D[att].rot) < 1e-3 && Math.hypot(m.x - D[node.side].x, m.y - D[node.side].y) < 0.05 && Math.abs(m.rot - D[node.side].rot) < 1e-3;
      if (!lands) { tally[g.atLimit ? 'limit' : 'pushed']++; samples.push(smp); continue; }
      const out = swing(prev, att, pv, dir, s, { ...K, gap: true, trace: true }), v = prev[node.side];
      smp.minGap = out.minGap;
      if (out.trace.length || Math.hypot(out.opp.x - v.x, out.opp.y - v.y) + R * Math.abs(out.opp.rot - v.rot) > 1e-9) { tally.contact++; samples.push(smp); continue; }
      const ls = limitAt(prev, att, pv, dir); smp.lim = ls.lim; smp.limSig = ls.sig;
      if (ls.lim < s + SUBSTEP) { tally.slack++; samples.push(smp); continue; }
      smp.ok = true; tally.ok++; samples.push(smp);
    }
    let run = []; const runs = [];
    const flush = () => { if (run.length >= 2) runs.push(run); run = []; };
    for (const smp of samples) { if (!smp.ok || (run.length && run[run.length - 1].limSig !== smp.limSig)) flush(); if (smp.ok) run.push(smp); }
    flush();
    log(`  ${att === 0 ? 'blue' : 'red'} arm (${pv},${dir}): ${tally.ok} of 358 degrees on the arc (off board ${tally.off}, engine limit ${tally.limit}, pushed ${tally.pushed}, law contact ${tally.contact}, limit slack ${tally.slack}), ${runs.length} arc${runs.length === 1 ? '' : 's'} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    for (const r of runs) arcs.push(makeArc(node, pv, dir, r, K, log));
  }
  return arcs;
}
function makeArc(node, pv, dir, run, K, log) {
  const att = 1 - node.side, clearance = Math.min(...run.map(r => r.minGap)) - MIND, ends = [run[0], run[run.length - 1]];
  const arc = { id: null, plies: node.plies + 1, side: att, kind: 'arc', pose: pose6(node.pose).slice(), eps: 0, margin: clearance, lip: 3, need: GAP_STEP, reach: null, star: null,
    arc: { pv, dir, span: [run[0].s, run[run.length - 1].s], step: DEG, perSample: run.map(r => ({ s: r.s, minGap: r.minGap, lim: r.lim, limSig: r.limSig })), limSig: run[0].limSig, limSlack: [] },
    child: node.id, samples: null, engine: null, koProof: false, seed: node.seed || null, key: dedupeKey(node.pose) };
  // limit slack: 12 limitAt probes at +-eps on the attacker's three axes at the arc's two ends must
  // clear the stop by a substep with the arc's own stopping event; else halve eps, three rounds
  let eps = Math.min((node.eps || 0) / 3, clearance - GAP_STEP), slackOK = !(eps > 0);
  for (let round = 0; round < 3 && eps > 0 && !slackOK; round++) {
    let bad = null;
    for (const end of ends) for (const [axis, d] of [['x', eps], ['y', eps], ['rot', eps / R]]) for (const sign of [1, -1]) {
      const p = arcPose({ ...node, side: att, arc: { pv, dir } }, end.s); p[att][axis] += sign * d;
      const ls = limitAt(p, att, pv, dir);
      if (!(ls.lim >= end.s + SUBSTEP && ls.sig === end.limSig)) { bad = `at ${(end.s / DEG).toFixed(0)}deg ${axis}${sign > 0 ? '+' : '-'}: limit ${(ls.lim / DEG).toFixed(1)}deg [${ls.sig}] vs [${end.limSig}]`; break; }
    }
    arc.arc.limSlack.push({ eps, ok: !bad, bad }); if (!bad) slackOK = true; else eps /= 2;
  }
  arc.eps = slackOK && eps > 0 ? eps : 0;
  arc.engine = simCheckArc(arc, node, 30);
  log(`    arc ${(run[0].s / DEG).toFixed(0)}-${(run[run.length - 1].s / DEG).toFixed(0)}deg (${run.length} samples) [${run[0].limSig}]: clearance ${clearance.toFixed(3)}u, child eps ${(node.eps || 0).toFixed(3)} -> tube eps ${arc.eps.toFixed(3)}u${arc.arc.limSlack.length ? ` (limit slack ${arc.arc.limSlack.map(r => r.ok ? 'ok@' + r.eps.toFixed(3) : 'no@' + r.eps.toFixed(3)).join(' ')})` : ''}; engine: ${arc.engine.agree}/${arc.engine.n} forward swings from the tube land inside ${node.id}'s ball, victim untouched${arc.engine.fails.length ? ' -- FAILS ' + JSON.stringify(arc.engine.fails.slice(0, 2)) : ''}`);
  return arc;
}
// The engine on an arc: a random s in the span, a random q in the tube around arcPose(s), the
// forward swing played by the engine (pinFoot + applySwing a degree at a time); the landing must be
// inside the child's ball without a limit, and then lose every one of 8 random moves to a throw.
function simCheckArc(arc, child, n) {
  const att = arc.side, [s0, s1] = arc.arc.span, { pv, dir } = arc.arc; let agree = 0; const fails = [];
  for (let t = 0; t < n; t++) {
    const s = s0 + Math.random() * (s1 - s0), q = piecesOf(randomInBall(arcPose(arc, s), arc.eps));
    const g = load(q, att); eng.pinFoot(pv); let guard = 0;
    while (!g.atLimit && Math.abs(g.netRad) < s - 1e-9 && guard++ < 3000) eng.applySwing(dir * Math.min(DEG, s - Math.abs(g.netRad)));
    const landing = g.pieces.map(p => ({ x: p.x, y: p.y, rot: p.rot })), d = dist6(landing, child.pose);
    const inside = !g.atLimit && d <= (child.eps > 0 ? child.eps + 1e-6 : LAND_TOL);
    const dead = inside ? simCheckDead(landing, child.side, 8) : null;
    if (inside && dead.agree === dead.n) agree++; else fails.push({ s: +(s / DEG).toFixed(2), atLimit: g.atLimit, d: +d.toFixed(4), dead: dead ? `${dead.agree}/${dead.n}` : null });
  }
  return { trials: n, agree, n, fails };
}

// lookup: is q inside a node of the given plies and side? Points: depth = eps - d(q, pose). Arcs:
// depth = eps - the least distance to the arc's polyline (the chords between consecutive samples;
// the metric is convex along a chord, so a ternary search finds the minimum) minus the chord's
// sagitta R*step^2/8 (the hub travels a circle of radius R about the foot, 8.8e-4u at a 1-degree
// step; the rotation is exactly linear in s). The distance to the nearest SAMPLE would not do: it
// sits up to half a chord, 2R * step / 2 = 0.4u at 1 degree, above the distance to the arc, so a
// tube thinner than that could only be hit at its samples. Returns the deepest hit with depth > 0,
// or null. No canonicalisation: the graph is a tree of real positions and a hit is a coincidence
// of positions, not a symmetry.
function lookup(q, plies, side, graph) {
  let best = null; const q6 = pose6(q);
  for (const node of graph) {
    if (node.plies !== plies || node.side !== side || !(node.eps > 0)) continue;
    let depth;
    if (node.kind === 'point') depth = node.eps - dist6(q6, node.pose);
    else {
      const P = node.arc.perSample.map(smp => pose6(arcPose(node, smp.s))); let dmin = Infinity;
      for (let k = 0; k + 1 < P.length; k++) {
        const A = P[k], B = P[k + 1], at = t => dist6(q6, A.map((a, i) => a + t * (B[i] - a)));
        let lo = 0, hi = 1; for (let it = 0; it < 40; it++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (at(m1) < at(m2)) hi = m2; else lo = m1; }
        dmin = Math.min(dmin, at((lo + hi) / 2), at(0), at(1));
      }
      if (P.length === 1) dmin = dist6(q6, P[0]);
      depth = node.eps - dmin - R * node.arc.step * node.arc.step / 8;
    }
    if (depth > 0 && (!best || depth > best.depth)) best = { node, depth };
  }
  return best;
}
// The board's symmetries, used ONLY to recognise a seed already certified: x -> -x (feet renumbered,
// rot -> pi - rot), y -> -y (rot -> -rot), their product (the 180-degree rotation) and the tripod's
// own 120-degree relabelling (rot folded into [0, 2pi/3)); the smallest image, rounded to 0.1u (0.1
// u/R in rotation). No certificate is ever transported across these: resolvePush is Gauss-Seidel
// in a fixed (i, j) order, so a reflected or relabelled multi-contact push is not bit-identical.
function dedupeKey(pose) {
  const p = pose6(pose), fold = r => { const t = 2 * Math.PI / 3; r = r % t; return r < 0 ? r + t : r; }, imgs = [];
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const im = [];
    for (let i = 0; i < 6; i += 3) { let rot = p[i + 2]; if (sx < 0) rot = Math.PI - rot; if (sy < 0) rot = -rot; im.push(Math.round(p[i] * sx * 10), Math.round(p[i + 1] * sy * 10), Math.round(fold(rot) * R * 10)); }
    imgs.push(im.join(','));
  }
  return imgs.sort()[0];
}
// The file. One JSON row per node, appended whole in one write under a directory lock (mkdir is
// atomic on every filesystem this runs on) so that several processes -- the level-3 program runs
// one per seed -- never interleave rows or hand out the same id. Ids are P2-0001, A3-0001, P4-,
// A5-: kind letter, plies, a counter per prefix taken from the rows already there. Nodes are
// immutable once appended: a lookup that hits another process's node is reading a finished
// certificate. (Not the tmp-and-rename writer used for the trainer's state files: that replaces
// the whole file, which would drop rows another process appended meanwhile.)
function sleepSync(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { const end = Date.now() + ms; while (Date.now() < end); } }
function loadGraph(file) {
  file = file || GRAPH_PATH;
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const rows = [];
  for (const line of text.split('\n')) { if (!line.startsWith('{')) continue; try { rows.push(JSON.parse(line)); } catch (e) { /* a row still being written by another process */ } }
  return rows;
}
function appendNode(node, file) {
  file = file || GRAPH_PATH;
  const lock = file + '.lock', t0 = Date.now();
  for (;;) {
    try { fs.mkdirSync(lock); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 120000) { fs.rmdirSync(lock); continue; } } catch (e2) { /* the holder just released it */ }
      if (Date.now() - t0 > 60000) throw new Error(`could not lock ${file} in 60 s (stale ${lock}?)`);
      sleepSync(50);
    }
  }
  try {
    const prefix = `${node.kind === 'point' ? 'P' : 'A'}${node.plies}-`; let n = 0;
    for (const r of loadGraph(file)) if (r.id && r.id.startsWith(prefix)) n = Math.max(n, +r.id.slice(prefix.length) || 0);
    node.id = prefix + String(n + 1).padStart(4, '0'); node.written = new Date().toISOString(); node.host = require('os').hostname();
    if (!fs.existsSync(file)) fs.writeFileSync(file, '# the family graph (nn/forced-win.js --star / --unwind / --lost4): one node per row, immutable. point = the side to move loses within `plies` plies everywhere in the L1 ball of radius eps (u, both pieces) around pose; arc = the side to move wins by playing (arc.pv, arc.dir) to stop s from any position within eps of the child\'s attacker unwound by s, s in arc.span. pose = [bx,by,brot,rx,ry,rrot].\n');
    fs.appendFileSync(file, JSON.stringify(node) + '\n');
    return node.id;
  } finally { try { fs.rmdirSync(lock); } catch (e) { /* released */ } }
}

// PHASE_TOL: the engine stopped at random angles by applySwing calls of random size (0.3-6
// degrees, like a human drag) against the law's fixed-ladder record read as the certificates read
// it (the first recorded step at or past the angle). The pushed piece's pose differs by the phase
// of the substep ladder AND by the record's rounding up to the next step; both are in every
// pushed-landing claim at level 3, so the p100 of this is what those claims must absorb. Also the
// limit reached by the random-size calls against limitAt's 1-degree ladder.
function phaseTol(events, stopsPer) {
  const dPose = [], dLim = []; let early = 0;
  for (const ev of events) {
    const rec = swing(ev.pieces, ev.active, ev.pv, ev.dir, ev.rad, { ...REPLICA, record: true }).record;
    const stops = Array.from({ length: stopsPer }, () => MIN_MOVE + Math.random() * (ev.rad - MIN_MOVE)).sort((a, b) => a - b);
    const g = load(ev.pieces, ev.active); eng.pinFoot(ev.pv); let guard = 0;
    for (const a of stops) {
      while (!g.atLimit && Math.abs(g.netRad) < a - 1e-9 && guard++ < 5000) eng.applySwing(ev.dir * Math.min((0.3 + 5.7 * Math.random()) * DEG, a - Math.abs(g.netRad)));
      if (g.atLimit) { early++; break; }
      const o = g.pieces[1 - ev.active], r = rec.find(q => q.alpha >= a - 1e-9) || rec[rec.length - 1];
      dPose.push(Math.hypot(o.x - r.x, o.y - r.y) + R * Math.abs(o.rot - r.rot));
    }
    while (!g.atLimit && Math.abs(g.netRad) < 2 * Math.PI && guard++ < 5000) eng.applySwing(ev.dir * (0.3 + 5.7 * Math.random()) * DEG);
    dLim.push(Math.abs(Math.abs(g.netRad) - limitAt(ev.pieces, ev.active, ev.pv, ev.dir).lim) / DEG);
  }
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
  return { events: events.length, stops: dPose.length, stopsPerEvent: stopsPer, median: q(dPose, .5), p90: q(dPose, .9), max: q(dPose, 1), limMedianDeg: q(dLim, .5), limMaxDeg: q(dLim, 1), stoppedEarly: early };
}

module.exports = { load, swingLimit, limitAt, swingLimitMemo, memoStats, throwMargin, bestThrow, certifyThrowBox, simCheck, signature, certifyForcedIn2, verifyAllReplies, deadCertificate, profilesConsistent, simCheckForcedIn2, simCheckDead, simCheckEscape, familyProfile, certifyDeadBox,
  moverAt, replyFamily, dist6, pose6, piecesOf, randomInBall, reachEnvelope, certifyStar, simCheckDeadBall, arcPose, unwindArcs, makeArc, simCheckArc, lookup, dedupeKey, loadGraph, appendNode, phaseTol,
  MIN_MOVE, SUBSTEP, GAP_STEP, LAND_TOL, GRAPH_PATH, PHASE_TOL, ARMS, armIndex };

// A victim with one foot `inside` u from the rim and the attacker 26-44u from that foot on the
// inward side, not touching.
function exposedPose(insideLo, insideHi) {
  const hubMax = eng.CFG.edgeU - R - eng.CFG.edgeEps;
  for (let t = 0; t < 200; t++) {
    eng.newGame(); const g = eng.getG();
    const victim = Math.random() < 0.5 ? 0 : 1, attacker = 1 - victim, v = g.pieces[victim], a = g.pieces[attacker];
    const inside = insideLo + (insideHi - insideLo) * Math.random(), fr = eng.CFG.edgeU - inside, fa = Math.random() * 2 * Math.PI;
    v.rot = Math.random() * 2 * Math.PI; v.x = fr * Math.cos(fa) - Math.cos(v.rot) * R; v.y = fr * Math.sin(fa) - Math.sin(v.rot) * R;
    if (Math.hypot(v.x, v.y) > hubMax || anyOff(v)) continue;
    const d = 26 + 18 * Math.random(), aa = fa + Math.PI + (Math.random() - 0.5) * 1.6;
    a.x = fr * Math.cos(fa) + d * Math.cos(aa); a.y = fr * Math.sin(fa) + d * Math.sin(aa); a.rot = Math.random() * 2 * Math.PI;
    if (Math.hypot(a.x, a.y) > hubMax || anyOff(a)) continue;
    const pieces = g.pieces.map(p => ({ x: p.x, y: p.y, rot: p.rot }));
    const b1 = bestThrow(pieces, attacker, REPLICA); if (!Number.isFinite(b1.margin)) continue;   // touching / no legal arc
    return { pieces, victim, attacker, inside, win1: b1.margin > 0 };
  }
  return null;
}

// The engine's own depth-2 verdict on a position at several search widths, as "keep/sweep:dead|ok".
function searchVerdicts(pieces, mover, rung) {
  const { nnPlanFor } = require('./nnai.js');
  const w = eng.AI_LADDER[(rung || eng.AI_LADDER.length) - 1].w, evalFn = (e, side) => e.ladderEval(side, w);
  const out = [];
  for (const [keep, sweep, diverse] of [[2, 9, false], [2, 9, true], [4, 9, true], [12, 9, false], [12, 3, false], [12, 3, true], [12, 1, false], [12, 1, true]]) {
    load(pieces, mover); const top = [];
    const plan = nnPlanFor(eng, null, mover, { temperature: 0, depth: 2, keepForDepth: keep, rawRoot: true, evalFn, sweepDeg: sweep, keepDiverse: diverse, captureTop: top, captureTopN: 1 });
    const v = plan && top.length ? top[0].score : NaN;
    out.push(`${keep}/${sweep}${diverse ? 'd' : ''}:${v <= -1e5 ? 'DEAD' : v >= 1e5 ? 'win' : Number.isFinite(v) ? 'ok' : '?'}`);
  }
  return out;
}
// Shared reporting for a verifyAllReplies verdict, with the engine's check of whichever claim it is.
const T = { dead: 0, deadOK: 0, deadBad: 0, escape: 0, escapeOK: 0, escapeBad: 0, unresolved: 0 };
function report(v, pieces, victim, label) {
  if (v.status === 'dead') {
    T.dead++; const c = simCheckDead(pieces, victim, 30);
    if (c.agree === c.n) T.deadOK++; else { T.deadBad++; console.log(`  CONTRADICTED: engine found an escape ${c.n - c.agree}/${c.n}: ${JSON.stringify(c.fails.slice(0, 2))}`); }
    console.log(`  DEAD: ${label} -- every reply certified lost, worst margin ${v.worstMargin.toFixed(2)}u; engine agrees ${c.agree}/${c.n}`);
  } else if (v.status === 'escape') {
    T.escape++; const c = simCheckEscape(pieces, victim, v.escape);
    if (c.agree) T.escapeOK++; else { T.escapeBad++; console.log(`  CONTRADICTED: engine still throws after the escape (arc ${JSON.stringify(c.thrownBy)})`); }
    console.log(`  escape: ${label} -- ${v.why}; engine agrees ${c.agree}`);
  } else { T.unresolved++; console.log(`  unresolved: ${label} -- ${v.why}`); }
}

if (require.main === module && process.argv[2] === '--dead-box') {
  // node nn/forced-win.js --dead-box bx,..,rrot --mover m [--half 0.5] [--h 0.5]: the dead verdict
  // over a box of the mover's poses, then the engine on random poses in the box (every move lost).
  const K = REPLICA, nums = process.argv[3].split(',').map(Number);
  const mover = process.argv.includes('--mover') ? +process.argv[process.argv.indexOf('--mover') + 1] : 0;
  const half = process.argv.includes('--half') ? +process.argv[process.argv.indexOf('--half') + 1] : 0.5, h = process.argv.includes('--h') ? +process.argv[process.argv.indexOf('--h') + 1] : 0.5;
  const D = [{ x: nums[0], y: nums[1], rot: nums[2] }, { x: nums[3], y: nums[4], rot: nums[5] }], v = D[mover];
  const box = { x: [v.x - half, v.x + half], y: [v.y - half, v.y + half], rot: [v.rot - half / R, v.rot + half / R] }, t0 = Date.now();
  const c = certifyDeadBox(D, mover, box, h, K);
  console.log(`dead box +-${half}u around ${mover === 0 ? 'blue' : 'red'} (grid ${h}u, ${c.samples} samples, ${((Date.now() - t0) / 60).toFixed(0)}s): ${c.certified ? `CERTIFIED -- min worst-margin ${c.minMargin.toFixed(2)}u > ${c.need.toFixed(2)}u (lip ${c.lip.toFixed(2)})` : 'refused -- ' + c.why}`);
  if (c.certified) { let agree = 0, n = 25; for (let t = 0; t < n; t++) { const p = D.map(q => ({ ...q })); const w = p[mover]; w.x = box.x[0] + Math.random() * 2 * half; w.y = box.y[0] + Math.random() * 2 * half; w.rot = box.rot[0] + Math.random() * 2 * half / R; const s = simCheckDead(p, mover, 8); if (s.agree === s.n) agree++; } console.log(`  engine: ${agree}/${n} random poses in the box lose every one of 8 random moves to a throw`); }
} else if (require.main === module && process.argv[2] === '--back-from') {
  // Backward families from a certified DEAD position: node nn/forced-win.js --back-from bx,..,rrot --mover m
  // `mover` is the side to move in D (the dead side); the OTHER side just swung into D. Unwinding
  // each of its six arms gives the positions it could have come from; wherever the forward swing
  // is legal (reaches the unwound angle before any limit) and touches nothing on the way (else the
  // victim would have been pushed and the predecessor's victim pose differs), that predecessor is
  // a certified forced win in two: the move lands exactly on D. Each family is checked in the
  // engine at random points: play the forward swing, confirm it lands on D.
  const K = REPLICA, nums = process.argv[3].split(',').map(Number);
  const mover = process.argv.includes('--mover') ? +process.argv[process.argv.indexOf('--mover') + 1] : 0, att = 1 - mover;
  const D = [{ x: nums[0], y: nums[1], rot: nums[2] }, { x: nums[3], y: nums[4], rot: nums[5] }];
  const v = verifyAllReplies(D, mover, K, 2, 3, 1);
  console.log(`D: ${mover === 0 ? 'blue' : 'red'} to move -- ${v.status}${v.status === 'dead' ? ` (worst margin ${v.worstMargin.toFixed(2)}u)` : ': ' + v.why}`);
  if (v.status !== 'dead') { console.log('not a dead position; nothing to unwind'); process.exit(0); }
  let total = 0;
  for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
    // unwind: the attacker rotated about its foot pv by +dir*s to arrive at D, so before it sat at -dir*s
    const foot = feetOf(D[att])[pv]; const segs = []; let cur = null;
    for (let deg = 2; deg <= 170; deg += 1) {
      const sRad = deg * Math.PI / 180;
      const prev = D.map(q => ({ ...q })); prev[att] = moverAt(D[att], pv, -dir, sRad);
      let ok = !anyOff(prev[att]) && Math.hypot(prev[att].x, prev[att].y) <= eng.CFG.edgeU - R - eng.CFG.edgeEps;
      if (ok) {
        // the engine plays the forward swing itself: legal iff it reaches s without a limit, and a
        // valid predecessor iff BOTH pieces land on D (a push on the way would have moved the victim)
        const g = load(prev, att); eng.pinFoot(pv); let guard = 0;
        while (!g.atLimit && Math.abs(g.netRad) < sRad - 1e-9 && guard++ < 3000) eng.applySwing(dir * Math.min(Math.PI / 180, sRad - Math.abs(g.netRad)));
        const a = g.pieces[att], m = g.pieces[mover];
        ok = !g.atLimit && Math.abs(g.netRad) >= sRad - 1e-6 && Math.hypot(a.x - D[att].x, a.y - D[att].y) < 0.05 && Math.abs(a.rot - D[att].rot) < 1e-3 && Math.hypot(m.x - D[mover].x, m.y - D[mover].y) < 0.05 && Math.abs(m.rot - D[mover].rot) < 1e-3;
      }
      if (ok) { if (!cur) cur = { from: deg, to: deg }; else cur.to = deg; } else if (cur) { segs.push(cur); cur = null; }
    }
    if (cur) segs.push(cur);
    for (const sg of segs) {
      total += sg.to - sg.from + 1;
      console.log(`  ${att === 0 ? 'blue' : 'red'} came by arm (${pv},${dir}) from ${sg.from}-${sg.to}deg back: ${sg.to - sg.from + 1} degrees of forced-win-in-two positions (each played forward by the engine, landing on D)`);
    }
  }
  console.log(`\n${total} degrees of predecessor arc certified as forced win in two for ${att === 0 ? 'blue' : 'red'} (each degree ~0.4-0.8u of hub travel). Contact-free arrivals only: a predecessor that PUSHED its way in has a different victim pose, and the game record is where those come from (the row before a mined dead position).`);
} else if (require.main === module && process.argv[2] === '--throw-map') {
  // The picture: node nn/forced-win.js --throw-map bx,..,rrot --mover m [--half 20] [--res 64] [--out base]
  // The other side's throw region over the MOVER's hub positions (mover's rotation held, other side
  // held), as a margin field, with the mover's six reachable arcs drawn on it (hub trajectories,
  // stops where the arc touches the other side skipped, since there the other side would have
  // moved). If the mover is dead, every arc lies inside the positive region.
  const K = REPLICA, nums = process.argv[3].split(',').map(Number);
  const mover = process.argv.includes('--mover') ? +process.argv[process.argv.indexOf('--mover') + 1] : 0, other = 1 - mover;
  const half = process.argv.includes('--half') ? +process.argv[process.argv.indexOf('--half') + 1] : 20, res = process.argv.includes('--res') ? +process.argv[process.argv.indexOf('--res') + 1] : 64;
  const base = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'nn/brain-maps/throw-map';
  const D = [{ x: nums[0], y: nums[1], rot: nums[2] }, { x: nums[3], y: nums[4], rot: nums[5] }];
  const cx = D[mover].x, cy = D[mover].y, cell = 2 * half / res, field = new Float32Array(res * res), t0 = Date.now();
  const hubMax = eng.CFG.edgeU - R - eng.CFG.edgeEps;
  for (let j = 0; j < res; j++) { for (let i = 0; i < res; i++) {
    const x = cx - half + (i + 0.5) * cell, y = cy - half + (j + 0.5) * cell, p = D.map(q => ({ ...q })); p[mover] = { x, y, rot: D[mover].rot };
    if (Math.hypot(x, y) > hubMax || anyOff(p[mover])) { field[j * res + i] = NaN; continue; }
    const bt = bestThrow(p, other, K); field[j * res + i] = Number.isFinite(bt.margin) ? bt.margin : NaN;   // NaN where the pieces overlap
  } if (j % 8 === 7) process.stdout.write(`\r  ${Math.round(100 * (j + 1) / res)}%  ${((Date.now() - t0) / 1000).toFixed(0)}s  `); }
  // The mover's reachable arcs, each stop coloured by the other side's TRUE throw margin at that
  // stop's actual pose (the mover's rotation changes along an arc and the other side moves where the
  // arc touches it, so the background slice -- rotation held, other side held -- is not the margin
  // at the arc's own points). Dead reads literally: every arc point in the positive colour.
  const arcs = [];
  for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) { const fam = replyFamily(D, mover, pv, dir, K); if (!fam) continue;
    const rec = fam.out.record; let insideArc = 0;
    for (let k = 0; k < rec.length; k += 3) { const r = rec[k]; const h = moverAt(D[mover], pv, dir, r.alpha);
      const p = D.map(q => ({ ...q })); p[mover] = h; p[other] = { x: r.x, y: r.y, rot: r.rot };
      const m = r.maxFootR > EDGE ? -Infinity : bestThrow(p, other, K).margin;         // the reply itself throws: no margin
      arcs.push({ x: h.x, y: h.y, margin: m }); }
  }
  require('fs').writeFileSync(base + '.bin', Buffer.from(field.buffer));
  require('fs').writeFileSync(base + '.json', JSON.stringify({ tag: 'throw-map', res, cx, cy, half, cell, extent: half, mover, D, live: [...field].filter(Number.isFinite).length }));
  // render: map-png's ramp for the margin, arcs punched through as index 0 (page background)
  const P = require('./map-png.js'); const A = require('./map-analyze.js');
  const m = A.loadMap(base); let { lo, hi } = P.limits(m.field); const a = Math.max(Math.abs(lo), Math.abs(hi)); lo = -a; hi = a;   // symmetric: zero = the boundary
  const idx = P.render(m.field, res, lo, hi), scale = 8, W = res * scale, big = new Uint8Array(W * W);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) for (let b = 0; b < scale; b++) big.fill(idx[j * res + i], (j * scale + b) * W + i * scale, (j * scale + b) * W + i * scale + scale);
  const px = (x, y) => [Math.round((x - (cx - half)) / cell * scale), Math.round((y - (cy - half)) / cell * scale)];
  // arc points: a black-bordered dot whose fill is the ramp colour of the TRUE margin
  const rampIdx = m => !Number.isFinite(m) ? 0 : Math.max(1, Math.min(255, 1 + Math.round(254 * (Math.max(lo, Math.min(hi, m)) - lo) / (hi - lo))));
  for (const q of arcs) { const [X, Y] = px(q.x, q.y); for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X2 = X + dx, Y2 = Y + dy; if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= W) continue; const d = Math.abs(dx) + Math.abs(dy); if (d > 4) continue; big[Y2 * W + X2] = d >= 3 ? 0 : rampIdx(q.margin); } }
  { const [X, Y] = px(D[mover].x, D[mover].y); for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (Math.abs(dx) + Math.abs(dy) > 3 && Math.abs(dx) + Math.abs(dy) < 6) { const X2 = X + dx, Y2 = Y + dy; if (X2 >= 0 && Y2 >= 0 && X2 < W && Y2 < W) big[Y2 * W + X2] = 0; } }
  require('fs').writeFileSync(base + '.png', P.pngIndexed(big, W, W, P.palette()));
  const inside = arcs.filter(q => q.margin > 0).length, thrown = arcs.filter(q => q.margin === -Infinity).length;
  console.log(`\n${base}.png: ${other === 0 ? 'blue' : 'red'}'s throw margin over ${mover === 0 ? 'blue' : 'red'}'s hub (background: rotation held), ${res}x${res} over +-${half}u; range [${lo.toFixed(1)}, ${hi.toFixed(1)}]u; ${mover === 0 ? 'blue' : 'red'}'s arcs as dots coloured by the true margin at each stop: ${inside}/${arcs.length} stops lost to a throw${thrown ? `, ${thrown} stops where the move itself throws` : ''}`);
} else if (require.main === module && process.argv[2] === '--catalog') {
  // A catalogue of the obvious families: a victim with one foot `inside` u from the rim at the
  // 12 o'clock rim point, turned `vrot` from radial; the attacker `dist` from that foot at approach
  // angle `approach` (0 = straight inward of the foot), turned `arot`. Each grid point is tagged
  // win-in-1 (attacker to move) and, when the attacker has a throw, whether the VICTIM to move is
  // dead or has an escape. Rows go to --out (default nn/catalog-rim.jsonl); classes are the
  // contiguous runs of equal verdict along each parameter.
  const fs = require('fs'), K = REPLICA, outPath = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'nn/catalog-rim.jsonl';
  const hubMax = eng.CFG.edgeU - R - eng.CFG.edgeEps, t0 = Date.now();
  const insides = [1, 2, 3, 4.5, 6], vrots = [0, 45, 90, 135], dists = [26, 30, 34, 38, 42], approaches = [-60, -30, 0, 30, 60], arots = [0, 40, 80];
  const T = { skipped: 0, win1: 0, dead: 0, escape: 0, unresolved: 0, safe: 0 }; let n = 0;
  for (const inside of insides) for (const vrot of vrots) for (const dist of dists) for (const approach of approaches) for (const arot of arots) {
    const fr = eng.CFG.edgeU - inside, fx = 0, fy = fr;                         // exposed foot at 12 o'clock
    const v = { rot: (90 + vrot) * Math.PI / 180 }; v.x = fx - Math.cos(v.rot) * R; v.y = fy - Math.sin(v.rot) * R;   // foot 0 is the exposed one
    const aa = (-90 + approach) * Math.PI / 180, a = { x: fx + dist * Math.cos(aa), y: fy + dist * Math.sin(aa), rot: arot * Math.PI / 180 };
    const pieces = [v, a];                                                       // blue = victim, red = attacker
    if (Math.hypot(v.x, v.y) > hubMax || Math.hypot(a.x, a.y) > hubMax || anyOff(v) || anyOff(a)) { T.skipped++; continue; }
    const bt = bestThrow(pieces, 1, K); if (!Number.isFinite(bt.margin)) { T.skipped++; continue; }   // touching
    const row = { inside, vrot, dist, approach, arot, p: [v.x, v.y, v.rot, a.x, a.y, a.rot], win1: bt.margin > 0, win1Margin: +bt.margin.toFixed(2), win1Arc: [bt.pv, bt.dir] };
    if (bt.margin > 0) {
      T.win1++;
      const vv = verifyAllReplies(pieces, 0, K, 2, 3, 1);                        // victim to move: can it get out?
      row.victimToMove = vv.status; row.victimMargin = Number.isFinite(vv.worstMargin) ? +vv.worstMargin.toFixed(2) : null; if (vv.escape) row.escape = vv.escape;
      T[vv.status]++;
    } else T.safe++;
    fs.appendFileSync(outPath, JSON.stringify(row) + '\n'); n++;
    if (n % 50 === 0) console.log(`  ${n} rows, ${((Date.now() - t0) / 60000).toFixed(1)} min: ${JSON.stringify(T)}`);
  }
  console.log(`\ncatalogue: ${n} positions -> ${outPath}\n  attacker to move: win in one ${T.win1}, no throw ${T.safe}, skipped (off-board/touching) ${T.skipped}\n  of the win-in-one positions, victim to move: dead ${T.dead}, escape ${T.escape}, unresolved ${T.unresolved}`);
} else if (require.main === module && process.argv[2] === '--pos') {
  // One position, pasted from the lab: node nn/forced-win.js --pos bx,by,brot,rx,ry,rrot --mover 0|1 [--deep]
  // Reports the mover's verdict (dead / escape / unresolved) with the engine's check, the other
  // side's best throw if it were their move instead, and with --deep, whether the escape only leads
  // into a forced loss in two (level 2 from the post-escape position, the other side attacking).
  const K = REPLICA, nums = process.argv[3].split(',').map(Number);
  const mover = process.argv.includes('--mover') ? +process.argv[process.argv.indexOf('--mover') + 1] : 0, other = 1 - mover;
  const pieces = [{ x: nums[0], y: nums[1], rot: nums[2] }, { x: nums[3], y: nums[4], rot: nums[5] }];
  const g = load(pieces, mover);
  for (const i of [0, 1]) console.log(`${i === 0 ? 'blue' : 'red '} hub (${pieces[i].x.toFixed(1)},${pieces[i].y.toFixed(1)}) feet ` + g.pieces[i].feet().map((f, k) => `${k}:(${f.x.toFixed(1)},${f.y.toFixed(1)}) r=${Math.hypot(f.x, f.y).toFixed(1)}`).join('  '));
  const ob = bestThrow(pieces, other, K); console.log(`if it were ${other === 0 ? 'blue' : 'red'}'s move: best throw arc (${ob.pv},${ob.dir}) margin ${ob.margin.toFixed(2)}u ${ob.margin > 0 ? '-- a throw' : '-- none'}`);
  const mb = bestThrow(pieces, mover, K); console.log(`${mover === 0 ? 'blue' : 'red'} (to move) best throw now: arc (${mb.pv},${mb.dir}) margin ${mb.margin.toFixed(2)}u ${mb.margin > 0 ? '-- wins in one' : '-- none'}`);
  if (process.argv.includes('--profile')) for (const arm of familyProfile(pieces, mover, K, 2)) console.log(`  arm (${arm.pv},${arm.dir}): ` + (arm.legal ? `to ${arm.limitDeg}deg  ` + arm.segments.map(sg => `${sg.fate} ${sg.from}-${sg.to}`).join(' | ') : 'no legal move'));
  const v = verifyAllReplies(pieces, mover, K, 2, 3, 1);
  console.log(`${mover === 0 ? 'BLUE' : 'RED'} TO MOVE: ${v.status.toUpperCase()} -- ${v.why || `every move certified lost, worst margin ${v.worstMargin.toFixed(2)}u`}`);
  if (v.status === 'dead') { const c = simCheckDead(pieces, mover, 40); console.log(`  engine: ${c.agree}/${c.n} random moves lose to a throw`); }
  if (v.status === 'escape' && v.escape) {
    const c = simCheckEscape(pieces, mover, v.escape); console.log(`  engine confirms the escape: ${c.agree}${c.thrownBy ? ' (NO: still thrown by arc ' + c.thrownBy + ')' : ''}`);
    if (process.argv.includes('--deep') && !v.escape.throws) {
      const esc = v.escape, fam = replyFamily(pieces, mover, esc.pv, esc.dir, K);
      const rec = fam.out.record.find(r => r.alpha >= esc.stop - 1e-9) || fam.out.record[fam.out.record.length - 1];
      const after = pieces.map(q => ({ ...q })); after[mover] = moverAt(pieces[mover], esc.pv, esc.dir, rec.alpha); after[other] = { x: rec.x, y: rec.y, rot: rec.rot };
      console.log(`  after the escape: [${after.map(q => `${q.x.toFixed(2)},${q.y.toFixed(2)},${q.rot.toFixed(4)}`).join(',')}] -- does ${other === 0 ? 'blue' : 'red'} have a forced win in two from here?`);
      const r2 = certifyForcedIn2(after, other, K);
      if (r2.certified) console.log(`  YES: level ${r2.level} -- ${other === 0 ? 'blue' : 'red'} plays (${r2.witness.pv},${r2.witness.dir}) to ${(r2.witness.stop * 180 / Math.PI).toFixed(1)}deg${r2.detail ? `; every reply certified lost, worst margin ${r2.detail.worstMargin.toFixed(2)}u` : ' and throws'}`);
      else console.log(`  NO forced win in two certified: ${r2.refuted}/${r2.tried} attacking moves refuted by an escape, ${r2.unresolvedN}/${r2.tried} unresolved`);
    }
  }
} else if (require.main === module && process.argv[2] === '--mine') {
  // Real dead positions from real games. Every recorded row carries the raw pose (p = blue x,y,rot,
  // red x,y,rot) and the mover (m); a game's rows are contiguous under one tag (g), and a decided
  // game's last row is the winner's position before the throw (z ~ +1). The row before it is the
  // LOSER to move, one move from being thrown: was every move already lost there (dead), or did an
  // escape exist that the loser missed (a blunder)? Either is an exact label. Certified verdicts are
  // appended to the --out file (default nn/dead-positions.jsonl) with the pose, the mover, the
  // verdict, the margin and the game.
  //   node nn/forced-win.js --mine <files.jsonl...> [--out f] [--max N] [--back K]
  // --back K also looks K loser-moves earlier (2K rows back), to see how deep the point of no return
  // lies in play.
  const fs = require('fs'), K = REPLICA;
  const files = process.argv.slice(3).filter(a => !a.startsWith('--') && a !== process.argv[process.argv.indexOf('--out') + 1] && a !== process.argv[process.argv.indexOf('--max') + 1] && a !== process.argv[process.argv.indexOf('--back') + 1]);
  const outPath = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'nn/dead-positions.jsonl';
  const maxGames = process.argv.includes('--max') ? +process.argv[process.argv.indexOf('--max') + 1] : Infinity;
  const back = process.argv.includes('--back') ? +process.argv[process.argv.indexOf('--back') + 1] : 0;
  const tally = {}; let games = 0; const t0 = Date.now();
  const bump = k => { tally[k] = (tally[k] || 0) + 1; };
  for (const file of files) {
    const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const byGame = new Map(); rows.forEach(r => { if (r.g && r.p) { if (!byGame.has(r.g)) byGame.set(r.g, []); byGame.get(r.g).push(r); } });
    for (const [g, gr] of byGame) {
      if (games >= maxGames) break;
      const last = gr[gr.length - 1];
      if (!(Math.abs(last.z) >= 0.98) || gr.length < 2) continue;          // not a decided game ending in a throw
      games++;
      for (let k = 0; k <= back; k++) {
        const i = gr.length - 2 - 2 * k; if (i < 0) break;
        const r = gr[i], victim = r.m;
        const pieces = [{ x: r.p[0], y: r.p[1], rot: r.p[2] }, { x: r.p[3], y: r.p[4], rot: r.p[5] }];
        const v = verifyAllReplies(pieces, victim, K, 2, 3, 1);
        let check = null;
        if (v.status === 'dead') check = simCheckDead(pieces, victim, 20);
        else if (v.status === 'escape') check = simCheckEscape(pieces, victim, v.escape);
        const agreed = check ? (check.n != null ? check.agree === check.n : check.agree) : null;
        const key = `${k === 0 ? 'one move before the throw' : k + ' loser-moves earlier'}: ${v.status}${agreed === false ? ' (ENGINE DISAGREED)' : ''}`;
        bump(key);
        fs.appendFileSync(outPath, JSON.stringify({ g, file: require('path').basename(file), row: i, back: k, mover: victim, p: r.p, mv: r.mv, verdict: v.status, worstMargin: Number.isFinite(v.worstMargin) ? +v.worstMargin.toFixed(3) : null, escape: v.escape || null, why: v.why || null, engineAgreed: agreed }) + '\n');
        if (v.status === 'dead') {
          console.log(`  DEAD ${g} (${k} back): every move of ${victim === 0 ? 'blue' : 'red'} loses to a throw, worst margin ${v.worstMargin.toFixed(2)}u; engine ${check.agree}/${check.n}`);
          // and the position before it -- the winner to move, whose played move led here -- is a
          // certified forced win in two, with the played move as the witness
          if (i >= 1) { const w = gr[i - 1]; fs.appendFileSync(outPath, JSON.stringify({ g, file: require('path').basename(file), row: i - 1, back: k, mover: w.m, p: w.p, mv: w.mv, verdict: 'win-in-2', witness: 'the move played', leadsTo: { row: i } }) + '\n'); bump('the position before it: win in two (certified by the dead position)'); }
        }
      }
      if (games % 10 === 0) console.log(`  ${games} games, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    }
  }
  console.log(`\n${games} decided games:`); for (const k of Object.keys(tally).sort()) console.log(`  ${k}: ${tally[k]}`);
  console.log(`verdicts appended to ${outPath}`);
} else if (require.main === module && process.argv[2] === '--dead-map') {
  // Real dead positions: the cells a searched danger map marked forced-lost at ply 2 (the mover has
  // no move that escapes a throw). Reconstruct each cell's position and certify it.
  // A finished map (.json + .bin, losses clamped to the map's min) or a map still being swept
  // (.part.json + .part.bin, losses still at the raw -1e6, the pose taken from a sibling map's json
  // given as the 5th argument -- every swing1 map shares it).
  const fs = require('fs'), base = process.argv[3], N = +(process.argv[4] || 30), K = REPLICA;
  let j, field, isLoss;
  if (fs.existsSync(base + '.json')) {
    j = JSON.parse(fs.readFileSync(base + '.json', 'utf8')); const buf = fs.readFileSync(base + '.bin');
    field = new Float32Array(buf.buffer, buf.byteOffset, j.res * j.res); const lossVal = j.min; isLoss = v => Math.abs(v - lossVal) < 1e-4;
  } else {
    const part = JSON.parse(fs.readFileSync(base + '.part.json', 'utf8')), stamp = JSON.parse(part.stamp);
    j = { ...JSON.parse(fs.readFileSync(process.argv[5], 'utf8')), res: stamp.res, cx: stamp.cx, cy: stamp.cy, half: stamp.half, decidedLoss: '?' };
    const buf = fs.readFileSync(base + '.part.bin'); field = new Float32Array(buf.buffer, buf.byteOffset, j.res * j.res);
    const done = new Set(part.rows); isLoss = (v, k) => done.has(Math.floor(k / j.res)) && v <= -1e5;
    console.log(`partial map: ${part.rows.length}/${j.res} rows swept`);
  }
  const cells = [];
  for (let k = 0; k < field.length; k++) if (Number.isFinite(field[k]) && isLoss(field[k], k)) cells.push(k);
  console.log(`${base}: ${j.decidedLoss} forced-loss cells recorded, ${cells.length} found; certifying ${Math.min(N, cells.length)} of them`);
  const half = j.half != null ? j.half : j.extent, cx = j.cx || 0, cy = j.cy || 0, cell = 2 * half / j.res;
  for (let t = 0; t < N && cells.length; t++) {
    const k = cells.splice(Math.floor(Math.random() * cells.length), 1)[0], i = k % j.res, row = Math.floor(k / j.res);
    const x = cx - half + (i + 0.5) * cell, y = cy - half + (row + 0.5) * cell;
    const pieces = [null, null]; pieces[j.active] = { x, y, rot: j.meRot }; pieces[1 - j.active] = { x: j.opponent.x, y: j.opponent.y, rot: j.opponent.rot };
    const v = verifyAllReplies(pieces, j.active, K, 2, 3, 1);
    report(v, pieces, j.active, `cell (${x.toFixed(1)},${y.toFixed(1)})`);
    if (process.argv.includes('--search')) console.log('      engine depth-2 search says dead at (keep,sweep): ' + searchVerdicts(pieces, j.active, j.rung).join('  '));
  }
  console.log(`\ndead certified ${T.dead} (engine agreed on every move in ${T.deadOK}, contradicted ${T.deadBad}); escapes ${T.escape} (engine agreed ${T.escapeOK}, contradicted ${T.escapeBad}); unresolved ${T.unresolved}`);
} else if (require.main === module && process.argv[2] === '--win-map') {
  // The cells a searched map marked forced-WON at ply 2: replay the engine's own chosen move (the
  // same search settings the map used), then ask whether every reply really leaves a throw.
  const fs = require('fs'), base = process.argv[3], N = +(process.argv[4] || 20), K = REPLICA;
  const { nnPlanFor } = require('./nnai.js');
  let j, field, isWin;
  if (fs.existsSync(base + '.json')) { j = JSON.parse(fs.readFileSync(base + '.json', 'utf8')); const buf = fs.readFileSync(base + '.bin'); field = new Float32Array(buf.buffer, buf.byteOffset, j.res * j.res); isWin = v => Math.abs(v - j.max) < 1e-4; }
  else { const part = JSON.parse(fs.readFileSync(base + '.part.json', 'utf8')), stamp = JSON.parse(part.stamp); j = { ...JSON.parse(fs.readFileSync(process.argv[5], 'utf8')), res: stamp.res, cx: stamp.cx, cy: stamp.cy, half: stamp.half, rung: stamp.rung }; const buf = fs.readFileSync(base + '.part.bin'); field = new Float32Array(buf.buffer, buf.byteOffset, j.res * j.res); const done = new Set(part.rows); isWin = (v, k) => done.has(Math.floor(k / j.res)) && v >= 1e5; }
  const cells = []; for (let k = 0; k < field.length; k++) if (Number.isFinite(field[k]) && isWin(field[k], k)) cells.push(k);
  console.log(`${base}: ${cells.length} forced-win cells found; checking ${Math.min(N, cells.length)}`);
  const half = j.half != null ? j.half : j.extent, cx = j.cx || 0, cy = j.cy || 0, cell = 2 * half / j.res;
  const w = eng.AI_LADDER[(j.rung || eng.AI_LADDER.length) - 1].w, evalFn = (e, side) => e.ladderEval(side, w);
  let holds = 0, broken = 0, unres = 0, win1 = 0;
  for (let t = 0; t < N && cells.length; t++) {
    const k = cells.splice(Math.floor(Math.random() * cells.length), 1)[0], i = k % j.res, row = Math.floor(k / j.res);
    const x = cx - half + (i + 0.5) * cell, y = cy - half + (row + 0.5) * cell;
    const pieces = [null, null]; pieces[j.active] = { x, y, rot: j.meRot }; pieces[1 - j.active] = { x: j.opponent.x, y: j.opponent.y, rot: j.opponent.rot };
    load(pieces, j.active); const top = [];
    const plan = nnPlanFor(eng, null, j.active, { temperature: 0, depth: 2, keepForDepth: 2, rawRoot: true, evalFn, sweepDeg: 9, captureTop: top, captureTopN: 1 });
    if (!plan) { console.log('  no plan'); continue; }
    // play it on the law and see whether it is a throw outright or a forced-in-2 claim
    const lim = swingLimit(pieces, j.active, plan.pivotIdx, plan.dir), rad = Math.min(Math.abs(plan.targetRad), lim);
    const out = swing(pieces, j.active, plan.pivotIdx, plan.dir, rad, { ...K, record: true });
    if (out.maxFootR > EDGE) { win1++; console.log(`  cell (${x.toFixed(1)},${y.toFixed(1)}): the move throws outright`); continue; }
    const after = pieces.map(q => ({ ...q })); after[j.active] = moverAt(pieces[j.active], plan.pivotIdx, plan.dir, rad); after[1 - j.active] = { x: out.opp.x, y: out.opp.y, rot: out.opp.rot };
    const v = verifyAllReplies(after, 1 - j.active, K, 2, 3, 1);
    if (v.status === 'dead') { holds++; const c = simCheckDead(after, 1 - j.active, 30); console.log(`  cell (${x.toFixed(1)},${y.toFixed(1)}): forced win HOLDS -- every reply certified lost (worst ${v.worstMargin.toFixed(2)}u); engine agrees ${c.agree}/${c.n}`); }
    else if (v.status === 'escape') { broken++; const c = simCheckEscape(after, 1 - j.active, v.escape); console.log(`  cell (${x.toFixed(1)},${y.toFixed(1)}): forced win BROKEN -- ${v.why}; engine agrees ${c.agree}`); }
    else { unres++; console.log(`  cell (${x.toFixed(1)},${y.toFixed(1)}): unresolved -- ${v.why}`); }
  }
  console.log(`\nforced-win cells: throws outright ${win1}, forced-in-2 holds ${holds}, broken (a reply escapes) ${broken}, unresolved ${unres}`);
} else if (require.main === module && process.argv[2] === '--dead') {
  // The victim to move: is every move answered by a throw? Certified along the six reply arcs,
  // then checked by the engine on random moves.
  const N = +(process.argv[3] || 20), K = REPLICA; let tried = 0, win1 = 0; const t0 = Date.now();
  while (tried < N) {
    const s = exposedPose(4, 12); if (!s) continue; tried++;
    if (s.win1) win1++;                                             // the attacker could throw now; the question is whether the victim can fix that
    const v = verifyAllReplies(s.pieces, s.victim, K, 2, 3, 1);
    report(v, s.pieces, s.victim, `victim ${s.victim} (foot ${s.inside.toFixed(1)}u inside)`);
  }
  console.log(`\n${tried} positions (victim to move, foot 4-12u inside): dead certified ${T.dead} (engine agreed on every move in ${T.deadOK}, contradicted ${T.deadBad}); escapes ${T.escape} (engine agreed ${T.escapeOK}, contradicted ${T.escapeBad}); unresolved ${T.unresolved}; attacker had a throw available in ${win1}   ${((Date.now() - t0) / 1000).toFixed(0)}s`);
} else if (require.main === module && process.argv[2] === '--in2') {
  // Sample positions with a victim foot a few units inside the rim and the attacker in reach,
  // skip those the attacker wins in one, try to certify a forced win in two, check each in the engine.
  const N = +(process.argv[3] || 20), K = REPLICA;
  let tried = 0, win1 = 0, cert2 = 0, cert2ok = 0, cert2bad = 0, refused = 0; const t0 = Date.now();
  while (tried < N) {
    const s = exposedPose(6, 14); if (!s) continue; tried++;
    if (s.win1) { win1++; continue; }
    const { pieces, attacker } = s, fr = eng.CFG.edgeU - s.inside;
    const r = certifyForcedIn2(pieces, attacker, K);
    if (r.certified) {
      cert2++;
      const s = simCheckForcedIn2(pieces, attacker, r.witness, 30);
      if (s.agree === s.n) cert2ok++; else { cert2bad++; console.log(`  CONTRADICTED: engine disagreed on ${s.n - s.agree}/${s.n}: ${JSON.stringify(s.fails.slice(0, 2))}`); }
      console.log(`  forced in 2: attacker ${attacker} plays (${r.witness.pv},${r.witness.dir}) to ${(r.witness.stop * 180 / Math.PI).toFixed(1)}deg; worst certified margin ${r.detail.worstMargin.toFixed(2)}u; engine agrees ${s.agree}/${s.n}   [victim foot ${(eng.CFG.edgeU - fr).toFixed(1)}u inside]`);
    } else { refused++; if (r.closest) console.log(`  no certificate (closest candidate (${r.closest.c.pv},${r.closest.c.dir})@${(r.closest.c.stop * 180 / Math.PI).toFixed(0)}deg: ${r.closest.v.status} -- ${r.closest.v.why}); refuted by an escape: ${r.refuted}/${r.tried}, unresolved: ${r.unresolvedN}/${r.tried}`); }
  }
  console.log(`\n${tried} positions (victim foot 3-10u inside the rim): win-in-1 ${win1}, forced-in-2 certified ${cert2} (engine agreed on every reply in ${cert2ok}, contradicted ${cert2bad}), no certificate ${refused}   ${((Date.now() - t0) / 1000).toFixed(0)}s`);
} else if (require.main === module && process.argv[2] === '--phase-tol') {
  // node nn/forced-win.js --phase-tol [n=200] [--events events.json] [--stops 5]
  // Step 0 of the graph: the constant every pushed-landing claim absorbs, measured before any
  // level-3 claim is trusted. Events are the law's own sampleEvent set (regenerated -- Math.random
  // has no seed here -- or a saved set from `node nn/contact-law.js 200 events.json`). Writes
  // nn/phase-tol.json; forced-win.js reads it at load as PHASE_TOL.
  const n = /^\d+$/.test(process.argv[3] || '') ? +process.argv[3] : 200, stopsPer = process.argv.includes('--stops') ? +process.argv[process.argv.indexOf('--stops') + 1] : 5;
  const evPath = process.argv.includes('--events') ? process.argv[process.argv.indexOf('--events') + 1] : null, t0 = Date.now();
  let events;
  if (evPath) events = JSON.parse(fs.readFileSync(evPath, 'utf8')).slice(0, n);
  else { events = []; let tries = 0; while (events.length < n && tries++ < n * 50) { const ev = sampleEvent(); if (ev) events.push(ev); } }
  console.log(`${events.length} contact events${evPath ? ' from ' + evPath : ' sampled'}; the engine stopped at ${stopsPer} random angles each by random-size (0.3-6 degree) applySwing calls, against the law's 0.4-degree record`);
  const r = phaseTol(events, stopsPer);
  console.log(`PHASE_TOL: pushed-pose difference (L1) median ${r.median.toFixed(3)}u p90 ${r.p90.toFixed(3)}u max ${r.max.toFixed(3)}u over ${r.stops} stops; limit difference median ${r.limMedianDeg.toFixed(2)} max ${r.limMaxDeg.toFixed(2)} deg (${r.events} events, ${r.stoppedEarly} stopped early by the engine)   ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const out = { phaseTol: r.max, ...r, measured: new Date().toISOString(), events: evPath || 'sampled' };
  require('./atomic-write.js').atomicWrite(path.join(__dirname, 'phase-tol.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(`written to nn/phase-tol.json (phaseTol = ${r.max.toFixed(3)}u)${r.max > 0.5 ? ' -- above 0.5u: level-3 gaps on pushing arms will need the record re-swept at the gap\'s own phase' : ''}`);
} else if (require.main === module && process.argv[2] === '--star') {
  // node nn/forced-win.js --star bx,..,rrot --mover m [--h 0.5] [--out nn/family-graph.jsonl] [--seed tag]
  // Step 1: a dead point (the mover to move loses every move to a throw) becomes a dead BALL in the
  // joint space, node P2-xxxx. Six reach envelopes over the mover's box, 13 dead certificates swept
  // to them, the star's Lipschitz radius, the engine on random poses in the ball, then the row.
  const K = REPLICA, nums = process.argv[3].split(',').map(Number);
  const mover = process.argv.includes('--mover') ? +process.argv[process.argv.indexOf('--mover') + 1] : 0;
  const h = process.argv.includes('--h') ? +process.argv[process.argv.indexOf('--h') + 1] : 0.5;
  const outPath = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : GRAPH_PATH;
  const seed = process.argv.includes('--seed') ? process.argv[process.argv.indexOf('--seed') + 1] : null;
  const node = { id: null, plies: 2, side: mover, kind: 'point', pose: nums, eps: 0, margin: null, lip: null, need: null, reach: null, star: null, arc: null, child: null, samples: null, engine: null, koProof: false, seed, key: dedupeKey(nums) };
  const dup = loadGraph(outPath).find(r => r.kind === 'point' && r.plies === 2 && r.key === node.key && r.eps > 0);
  if (dup) { console.log(`a dead ball with this seed's key is already in ${outPath}: ${dup.id} (eps ${dup.eps.toFixed(3)}u, h ${dup.star && dup.star.h}); nothing to do`); process.exit(0); }
  console.log(`star on ${mover === 0 ? 'blue' : 'red'} to move at [${nums.join(',')}], h ${h}u (rotation ${(h / R).toFixed(4)} rad)`);
  const t0 = Date.now();
  certifyStar(node, h, K, { log: console.log });
  const st = node.star;
  if (st.refused) { console.log(`refused: a reach envelope changes stopping event inside the box -- split the box along the named axis and rerun\n  ${st.refused.join('\n  ')}`); process.exit(1); }
  const dead = st.probes.filter(p => p.status === 'dead').length;
  console.log(`star h=${h}u: ${dead}/13 dead, profiles consistent ${st.consistentArms}/6 arms; W centre ${node.margin.toFixed(2)}, min ${st.minW.toFixed(2)}; max |dW|/2h ${st.maxSlope.toFixed(2)}/u -> lipStar ${st.lipStar.toFixed(2)} -> eps = min(${h}, ${(node.margin / st.lipStar).toFixed(2)}) = ${node.eps.toFixed(2)}u (L1, both pieces)   (${((Date.now() - t0) / 60000).toFixed(1)} min, limit memo ${memoStats.hits}/${memoStats.hits + memoStats.misses} hits)`);
  if (!st.certified) { console.log(`refused: ${dead < 13 ? st.probes.filter(p => p.status !== 'dead').map(p => `${p.tag} is ${p.status}: ${p.why}`).join('; ') : st.inconsistent.join('; ')}`); process.exit(1); }
  node.engine = simCheckDeadBall(node, 25, 8);
  console.log(`engine: ${node.engine.agree}/${node.engine.n} random poses in the ball lose every one of ${node.engine.moves} random moves to a throw`);
  if (node.engine.agree < node.engine.n) { console.log(`CONTRADICTED -- the engine escaped from inside a certified ball: ${JSON.stringify(node.engine.fails.slice(0, 3))}\nhalting: this is a bug in the certificate, not a rounding; nothing appended`); process.exit(2); }
  const id = appendNode(node, outPath);
  console.log(`appended ${id} (plies 2, side ${mover}, eps ${node.eps.toFixed(3)}u, W ${node.margin.toFixed(3)}u) to ${outPath}`);
} else if (require.main === module && process.argv[2] === '--unwind') {
  // node nn/forced-win.js --unwind <nodeId> [--graph nn/family-graph.jsonl]
  // Step 2: the WIN(plies+1) arcs of the side that moved into a point node, one per arm and
  // stopping event, each engine-checked, appended as A3-xxxx (A5- from a plies-4 point).
  const K = REPLICA, id = process.argv[3], graphPath = process.argv.includes('--graph') ? process.argv[process.argv.indexOf('--graph') + 1] : GRAPH_PATH;
  const graph = loadGraph(graphPath), node = graph.find(r => r.id === id);
  if (!node) { console.log(`no node ${id} in ${graphPath}`); process.exit(1); }
  if (node.kind !== 'point') { console.log(`${id} is an arc; only point nodes unwind`); process.exit(1); }
  const have = graph.filter(r => r.kind === 'arc' && r.child === id);
  if (have.length) console.log(`note: ${have.length} arc${have.length === 1 ? '' : 's'} already unwound from ${id} (${have.map(r => r.id).join(', ')}); nodes are immutable, so new ones are appended`);
  console.log(`unwinding ${id}: ${node.side === 0 ? 'blue' : 'red'} to move loses (plies ${node.plies}, eps ${(node.eps || 0).toFixed(3)}u, W ${node.margin != null ? node.margin.toFixed(3) : '-'}u); ${node.side === 0 ? 'red' : 'blue'}'s six arms unwound 2-359 degrees`);
  const t0 = Date.now(), arcs = unwindArcs(node, K, { log: console.log });
  let written = 0;
  for (const arc of arcs) {
    if (arc.engine.agree < arc.engine.n) { console.log(`CONTRADICTED on arm (${arc.arc.pv},${arc.arc.dir}) ${(arc.arc.span[0] / DEG).toFixed(0)}-${(arc.arc.span[1] / DEG).toFixed(0)}deg: ${JSON.stringify(arc.engine.fails.slice(0, 3))}\nhalting: this is a bug; ${written} arcs appended before it`); process.exit(2); }
    const aid = appendNode(arc, graphPath); written++;
    console.log(`  appended ${aid}: arm (${arc.arc.pv},${arc.arc.dir}) ${(arc.arc.span[0] / DEG).toFixed(0)}-${(arc.arc.span[1] / DEG).toFixed(0)}deg, tube eps ${arc.eps.toFixed(3)}u, child ${id}`);
  }
  console.log(`\n${written} WIN(${node.plies + 1}) arc${written === 1 ? '' : 's'} for ${node.side === 0 ? 'red' : 'blue'} into ${id}, ${arcs.reduce((a, r) => a + r.arc.perSample.length, 0)} degrees in all, ${arcs.filter(a => a.eps > 0).length} with a positive tube radius   (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
} else if (require.main === module) {
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
