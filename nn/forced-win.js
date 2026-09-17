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
function replyFamily(pieces, mover, pv, dir, K) {
  const lim = swingLimit(pieces, mover, pv, dir);
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
  const other = 1 - mover; let worstMargin = Infinity, legalArcs = 0, unresolved = null;
  const minStepRad = eng.CFG.substepDeg * Math.PI / 180;
  for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
    const fam = replyFamily(pieces, mover, pv, dir, K); if (!fam) continue;
    legalArcs++;
    if (fam.out.maxFootR > EDGE) return { certified: false, status: 'escape', why: `reply (${pv},${dir}) throws the attacker`, escape: { pv, dir, stop: fam.out.offAt, throws: true }, worstMargin: -Infinity };
    const rec = fam.out.record;
    const sampleAt = a => {
      const r = rec.find(q => q.alpha >= a - 1e-9) || rec[rec.length - 1];
      const p = pieces.map(q => ({ ...q })); p[mover] = moverAt(pieces[mover], pv, dir, r.alpha); p[other] = { x: r.x, y: r.y, rot: r.rot };
      const arcs = [];
      for (let apv = 0; apv < 3; apv++) for (const adir of [1, -1]) { const t = throwMargin(p, other, apv, adir, K); arcs.push({ apv, adir, m: t.margin, sig: signature(t.out) }); }
      return { alpha: r.alpha, arcs, best: Math.max(...arcs.map(x => x.m)) };
    };
    const stepRad = replyStepDeg * Math.PI / 180, first = [];
    for (let a = MIN_MOVE; ; a += stepRad) { const last = a >= fam.lim - 1e-9; first.push(sampleAt(last ? fam.lim : a)); if (last) break; }
    for (const smp of first) if (!(smp.best > 0)) return { certified: false, status: 'escape', why: `reply (${pv},${dir}) to ${(smp.alpha * 180 / Math.PI).toFixed(1)}deg leaves no throw (best margin ${smp.best.toFixed(2)}u)`, escape: { pv, dir, stop: smp.alpha, bestMargin: smp.best }, worstMargin: Math.min(worstMargin, smp.best) };
    // certify each gap, subdividing while it fails with positive ends
    const gaps = []; for (let k = 0; k + 1 < first.length; k++) gaps.push([first[k], first[k + 1]]);
    while (gaps.length) {
      const [A, B] = gaps.pop(); const gapU = (B.alpha - A.alpha) * 2 * R;
      let ok = false, bestM = -Infinity;
      for (let i = 0; i < 6; i++) {
        const a = A.arcs[i], b = B.arcs[i];
        if (!Number.isFinite(a.m) || !Number.isFinite(b.m)) continue;
        const lip = Math.max(lipFloor, safety * Math.abs(a.m - b.m) / Math.max(gapU, 1e-9)), need = lip * gapU / 2;
        const consistent = a.sig.pairs === b.sig.pairs && (a.sig.onset == null || b.sig.onset == null || Math.abs(a.sig.onset - b.sig.onset) < 5 * Math.PI / 180);
        bestM = Math.max(bestM, Math.min(a.m, b.m));
        if (a.m > need && b.m > need && consistent) { ok = true; break; }
      }
      if (ok) { worstMargin = Math.min(worstMargin, bestM); continue; }
      if (B.alpha - A.alpha > minStepRad * 1.5) {                       // subdivide
        const M = sampleAt((A.alpha + B.alpha) / 2);
        if (!(M.best > 0)) return { certified: false, status: 'escape', why: `reply (${pv},${dir}) to ${(M.alpha * 180 / Math.PI).toFixed(1)}deg leaves no throw (best margin ${M.best.toFixed(2)}u)`, escape: { pv, dir, stop: M.alpha, bestMargin: M.best }, worstMargin: Math.min(worstMargin, M.best) };
        gaps.push([A, M], [M, B]); continue;
      }
      unresolved = unresolved || `reply (${pv},${dir}) ${(A.alpha * 180 / Math.PI).toFixed(1)}-${(B.alpha * 180 / Math.PI).toFixed(1)}deg: no single arc certifies the gap (best min margin ${bestM.toFixed(2)}u) even at the engine's substep -- the throw changes arm here`;
      worstMargin = Math.min(worstMargin, bestM);
    }
  }
  if (!legalArcs) return { certified: false, status: 'escape', why: 'victim has no legal reply', worstMargin: -Infinity };
  if (unresolved) return { certified: false, status: 'unresolved', why: unresolved, worstMargin };
  return { certified: true, status: 'dead', worstMargin };
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

module.exports = { load, swingLimit, throwMargin, bestThrow, certifyThrowBox, simCheck, signature, certifyForcedIn2, verifyAllReplies, simCheckForcedIn2, simCheckDead, simCheckEscape, familyProfile };

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

if (require.main === module && process.argv[2] === '--catalog') {
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
        if (v.status === 'dead') console.log(`  DEAD ${g} (${k} back): every move of ${victim === 0 ? 'blue' : 'red'} loses to a throw, worst margin ${v.worstMargin.toFixed(2)}u; engine ${check.agree}/${check.n}`);
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
