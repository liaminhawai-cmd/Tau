// The engine's push (resolvePush in index.html) run on Taylor models.
//
// Model: the engine's program in exact real arithmetic, with its numeric constants taken as their
// binary64 values (Math.PI included) and the real sin/cos/sqrt. The defender's (blue's) pose is a
// Taylor model in t, where t in [-1, 1] maps linearly onto the defender's stop-angle interval.
// The attacker (red) is kinematic: its pose at every substep is an exact constant (an interval
// enclosure), independent of blue, exactly as in the engine (applySwing rotates the active piece
// and checks its own feet before resolvePush touches the opponent).
//
// Every branch of the program (which segment pair is closest, how the closest point is clamped,
// whether a pair touches) is either decided uniformly over the whole model, or all the possible
// outcomes are computed over the whole model and kept: enclosed together in one hull (fresh noise
// symbols), or carried as separate branches. Leg-leg and hub-leg pushes, the horizontal-fraction
// floor and the separation cap are modelled. Program paths the certificate does not model (the
// deep-crossing shove, near-vertical contacts with hf < 1e-4, hub-hub contact) must be excluded
// uniformly, or the run stops.
'use strict';
const iv = require('./iv.js');
const { TM, newSym, norm1, getN } = require('./tm.js');
const { dn, up } = iv;

// ---- constants, as the engine defines them (CFG in index.html) ----
const footR = 23.095, hubHeight = 23.095, legRadius = 1.44, inertiaK = 0.7, legSegs = 12;
const minD = legRadius * 2;                    // exact: doubling a double
const hubR = iv.mul([legRadius, legRadius], [1.9, 1.9]);
const hubLegD = iv.add(hubR, [legRadius, legRadius]);
const hubHub = iv.mul(hubR, [2, 2]);
const Ii = iv.mul(iv.mul([inertiaK, inertiaK], [footR, footR]), [footR, footR]);
const invI = iv.div([1, 1], Ii);
const TWO_PI_3 = iv.div(iv.mul([Math.PI, Math.PI], [2, 2]), [3, 3]);   // 2*Math.PI/3 in reals
// arc table: s_k = sin(ph) R, h_k = cos(ph) H, ph = (k/N)(Math.PI/2), in reals
const ARC_S = [], ARC_H = [];
for (let k = 0; k <= legSegs; k++) {
  const ph = iv.mul(iv.div([k, k], [legSegs, legSegs]), iv.div([Math.PI, Math.PI], [2, 2]));
  ARC_S.push(iv.mul(iv.sin(ph), [footR, footR]));
  ARC_H.push(iv.mul(iv.cos(ph), [hubHeight, hubHeight]));
}
const midf = a => iv.mid(a);

// ---- red (kinematic) pose at a substep, as intervals ----
function redPose(seedRed, pivotIdx, dir, k, stepRad) {
  // pivot = the pinned foot at the start of the swing; then k rotations by dir*step about it
  const a0 = iv.add([seedRed.rot, seedRed.rot], iv.mul([pivotIdx, pivotIdx], TWO_PI_3));
  const px = iv.add([seedRed.x, seedRed.x], iv.mul(iv.cos(a0), [footR, footR]));
  const py = iv.add([seedRed.y, seedRed.y], iv.mul(iv.sin(a0), [footR, footR]));
  const ang = iv.mul(iv.mul([k, k], stepRad), [dir, dir]);
  const c = iv.cos(ang), s = iv.sin(ang);
  const rx = iv.sub([seedRed.x, seedRed.x], px), ry = iv.sub([seedRed.y, seedRed.y], py);
  return {
    x: iv.add(px, iv.sub(iv.mul(rx, c), iv.mul(ry, s))),
    y: iv.add(py, iv.add(iv.mul(rx, s), iv.mul(ry, c))),
    rot: iv.add([seedRed.rot, seedRed.rot], ang),
  };
}
function redGeometry(P) {
  const legs = [];
  for (let i = 0; i < 3; i++) {
    const a = iv.add(P.rot, iv.mul([i, i], TWO_PI_3)), ca = iv.cos(a), sa = iv.sin(a);
    const pts = [];
    for (let k = 0; k <= legSegs; k++) pts.push({ x: iv.add(P.x, iv.mul(ca, ARC_S[k])), y: iv.add(P.y, iv.mul(sa, ARC_S[k])), h: ARC_H[k] });
    legs.push(pts);
  }
  return { hub: { x: P.x, y: P.y, h: [hubHeight, hubHeight] }, legs };
}

// ---- float helpers (for candidate screening only; every screen is made rigorous by a margin) ----
// legs and hub of a pusher whose pose {x, y, rot} is made of Taylor models
function tmGeometry(pose) {
  const legs = [];
  for (let i = 0; i < 3; i++) {
    const a = pose.rot.addI(iv.mul([i, i], TWO_PI_3)), ca = a.cos(), sa = a.sin();
    const pts = [];
    for (let k = 0; k <= legSegs; k++) pts.push({ x: pose.x.add(ca.scaleI(ARC_S[k])), y: pose.y.add(sa.scaleI(ARC_S[k])), h: ARC_H[k] });
    legs.push(pts);
  }
  return { hub: { x: pose.x, y: pose.y, h: [hubHeight, hubHeight] }, legs };
}
function segDist3f(p1, q1, p2, q2) {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, h: q1.h - p1.h }, d2 = { x: q2.x - p2.x, y: q2.y - p2.y, h: q2.h - p2.h };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, h: p1.h - p2.h };
  const a = d1.x * d1.x + d1.y * d1.y + d1.h * d1.h, e = d2.x * d2.x + d2.y * d2.y + d2.h * d2.h;
  const f = d2.x * r.x + d2.y * r.y + d2.h * r.h, c = d1.x * r.x + d1.y * r.y + d1.h * r.h;
  const b = d1.x * d2.x + d1.y * d2.y + d1.h * d2.h, denom = a * e - b * b;
  let s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
  let t = e > 1e-12 ? (b * s + f) / e : 0;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, a > 1e-12 ? -c / a : 0)); }
  else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, a > 1e-12 ? (b - c) / a : 0)); }
  const dx = p2.x + d2.x * t - p1.x - d1.x * s, dy = p2.y + d2.y * t - p1.y - d1.y * s, dh = p2.h + d2.h * t - p1.h - d1.h * s;
  return Math.sqrt(dx * dx + dy * dy + dh * dh);
}
function pointSegDist3f(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dh = b.h - a.h, len2 = dx * dx + dy * dy + dh * dh || 1e-12;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.h - a.h) * dh) / len2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y, a.h + dh * t - p.h);
}
// A guaranteed lower bound on the distance between two segments (exact arithmetic; the float
// rounding here is far below FLOAT_SLACK). The squared distance is a convex quadratic in the two
// segment parameters: if its unconstrained minimiser lies outside the unit square, the minimum is
// on the square's boundary, i.e. an endpoint-to-segment distance; otherwise it is the distance
// between the two lines, which never exceeds the segment distance. Nearly parallel pairs, where
// the minimiser is ill-conditioned, fall back to the bounding-sphere bound.
function segDist3Lower(p1, q1, p2, q2) {
  const e = Math.min(pointSegDist3f(p1, p2, q2), pointSegDist3f(q1, p2, q2), pointSegDist3f(p2, p1, q1), pointSegDist3f(q2, p1, q1));
  const u = { x: q1.x - p1.x, y: q1.y - p1.y, h: q1.h - p1.h }, v = { x: q2.x - p2.x, y: q2.y - p2.y, h: q2.h - p2.h };
  const cx = u.y * v.h - u.h * v.y, cy = u.h * v.x - u.x * v.h, ch = u.x * v.y - u.y * v.x;
  const c2 = cx * cx + cy * cy + ch * ch, uu = u.x * u.x + u.y * u.y + u.h * u.h, vv = v.x * v.x + v.y * v.y + v.h * v.h;
  if (c2 <= 1e-6 * uu * vv) {
    const m1 = { x: 0.5 * (p1.x + q1.x), y: 0.5 * (p1.y + q1.y), h: 0.5 * (p1.h + q1.h) }, m2 = { x: 0.5 * (p2.x + q2.x), y: 0.5 * (p2.y + q2.y), h: 0.5 * (p2.h + q2.h) };
    return Math.min(e, Math.max(0, Math.hypot(m1.x - m2.x, m1.y - m2.y, m1.h - m2.h) - 0.5 * Math.sqrt(uu) - 0.5 * Math.sqrt(vv)));
  }
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, h: p1.h - p2.h };
  const b = u.x * v.x + u.y * v.y + u.h * v.h, c = u.x * r.x + u.y * r.y + u.h * r.h, f = v.x * r.x + v.y * r.y + v.h * r.h;
  const s = (b * f - c * vv) / c2, t = (uu * f - b * c) / c2;
  if (s < -1e-6 || s > 1 + 1e-6 || t < -1e-6 || t > 1 + 1e-6) return e;
  return Math.min(e, Math.abs(r.x * cx + r.y * cy + r.h * ch) / Math.sqrt(c2));
}
// Distances between segments are 1-Lipschitz in the endpoints (every point of a segment moves by
// at most the larger endpoint move), so a float distance between the boxes' centres, minus the
// boxes' radii and a generous rounding allowance, is a rigorous lower bound.
const FLOAT_SLACK = 1e-9;

// ---- blue's geometry from its pose models ----
function boxOf(m) { const r = m.rangeCrude(); return { lo: r[0], hi: r[1], mid: 0.5 * r[0] + 0.5 * r[1], rad: up(0.5 * (r[1] - r[0])) }; }
function blueGeometry(st, needArcs) {
  const g = { st, dir: [], arcs: [], box: [] };
  const bx = boxOf(st.x), by = boxOf(st.y), br = st.rot.rangeCrude();
  g.hubBox = { x: bx, y: by };
  for (let j = 0; j < 3; j++) {
    const aI = iv.add(br, iv.mul([j, j], TWO_PI_3)), caI = iv.cos(aI), saI = iv.sin(aI);
    g.box.push({ caI, saI });
  }
  g.legModels = j => {
    if (g.dir[j]) return g.dir[j];
    const a = st.rot.addI(iv.mul([j, j], TWO_PI_3));
    const ca = a.cos(), sa = a.sin();
    const pts = [];
    for (let k = 0; k <= legSegs; k++) pts.push({ x: st.x.add(ca.scaleI(ARC_S[k])), y: st.y.add(sa.scaleI(ARC_S[k])), h: ARC_H[k] });
    g.dir[j] = { ca, sa, pts };
    return g.dir[j];
  };
  // centre and radius of the box enclosing blue's arc point k of leg j
  g.pointBox = (j, k) => {
    const { caI, saI } = g.box[j];
    const X = iv.add([bx.lo, bx.hi], iv.mul(caI, ARC_S[k])), Y = iv.add([by.lo, by.hi], iv.mul(saI, ARC_S[k]));
    const mx = iv.mid(X), my = iv.mid(Y);
    return { x: mx, y: my, h: midf(ARC_H[k]), r: up(Math.hypot(up(X[1] - mx), up(Y[1] - my)) + iv.rad(ARC_H[k])) };
  };
  return g;
}
// the pusher's points may carry x and y as Taylor models (a pose that depends on the cell's angle)
// or as plain intervals; every consumer goes through asTM or the cached ranges
const asTM = v => (v instanceof TM ? v : TM.constI(v));
const rangeOf = p => ({ x: p._xr || (p._xr = (p.x instanceof TM ? p.x.rangeCrude() : p.x)), y: p._yr || (p._yr = (p.y instanceof TM ? p.y.rangeCrude() : p.y)) });
function redPointF(p) { const r = rangeOf(p); return { x: midf(r.x), y: midf(r.y), h: midf(p.h), r: up(Math.hypot(iv.rad(r.x), iv.rad(r.y)) + iv.rad(p.h)) }; }

// ---- closest points between a red segment (constant) and a blue segment (models) ----
// Returns every branch of segClosest3 that is possible somewhere on the model.
function segClosestTM(p1, q1, j, v, G, stats) {
  const leg = G.legModels(j);
  const P1x = asTM(p1.x), P1y = asTM(p1.y), Q1x = asTM(q1.x), Q1y = asTM(q1.y);
  const d1 = { x: Q1x.sub(P1x), y: Q1y.sub(P1y), h: iv.sub(q1.h, p1.h) };
  const dS = iv.sub(ARC_S[v + 1], ARC_S[v]), dH = iv.sub(ARC_H[v + 1], ARC_H[v]);
  const d2 = { x: leg.ca.scaleI(dS), y: leg.sa.scaleI(dS), h: dH };
  const p2 = leg.pts[v];
  const r = { x: P1x.sub(p2.x), y: P1y.sub(p2.y), h: iv.sub(p1.h, p2.h) };
  const a = d1.x.sqr().add(d1.y.sqr()).addI(iv.sqr(d1.h));
  const e = iv.add(iv.sqr(dS), iv.sqr(dH));               // |d2|^2: cos^2 + sin^2 = 1 exactly
  const b = d2.x.mul(d1.x).add(d2.y.mul(d1.y)).addI(iv.mul(d1.h, dH));
  const f = d2.x.mul(r.x).add(d2.y.mul(r.y)).addI(iv.mul(dH, r.h));
  const c = r.x.mul(d1.x).add(r.y.mul(d1.y)).addI(iv.mul(d1.h, r.h));
  const denom = a.scaleI(e).sub(b.sqr());
  const dr = denom.range();
  if (!(dr[0] > 1e-12)) throw new Error('near-parallel segments: denom range ' + dr);
  const sraw = b.mul(f).sub(c.scaleI(e)).div(denom);
  const out = [];
  const opts = (m) => {                // clamp(m, 0, 1) options: each [model-or-const, label]
    const R = m.range(), o = [];
    if (R[0] < 0) o.push([TM.const(0), 'lo']);
    if (R[1] >= 0 && R[0] <= 1) o.push([m, 'in']);
    if (R[1] > 1) o.push([TM.const(1), 'hi']);
    return o;
  };
  const invE = iv.div([1, 1], e), invA = a.inv();
  for (const [s0, l0] of opts(sraw)) {
    const traw = b.mul(s0).add(f).scaleI(invE);
    const TR = traw.range();
    const cases = [];
    if (TR[0] < 0) for (const [s1, l1] of opts(c.neg().mul(invA))) cases.push([s1, TM.const(0), `s${l0}/t0/s${l1}`]);
    if (TR[1] > 1) for (const [s1, l1] of opts(b.sub(c).mul(invA))) cases.push([s1, TM.const(1), `s${l0}/t1/s${l1}`]);
    if (TR[1] >= 0 && TR[0] <= 1) cases.push([s0, traw, `s${l0}/tin`]);
    for (const [s, t, label] of cases) {
      const pa = { x: s.mul(d1.x).add(P1x), y: s.mul(d1.y).add(P1y), h: s.scaleI(d1.h).addI(p1.h) };
      const pb = { x: p2.x.add(d2.x.mul(t)), y: p2.y.add(d2.y.mul(t)), h: t.scaleI(dH).addI(p2.h) };
      const dx = pb.x.sub(pa.x), dy = pb.y.sub(pa.y), dh = pb.h.sub(pa.h);
      const hd2 = dx.sqr().add(dy.sqr());
      const d2s = hd2.add(dh.sqr());
      const dist = d2s.sqrt();
      out.push({ pa, pb, dx, dy, dh, hd2, dist, label });
    }
  }
  if (stats) stats.branches = Math.max(stats.branches || 0, out.length);
  return out;
}

// pusher hub (a point) vs blue leg j segment k: closest point on the segment, every clamp branch
function hubLegBranches(p, j, k, G) {
  const leg = G.legModels(j);
  const A = leg.pts[k];
  const Px = asTM(p.x), Py = asTM(p.y);
  const dS = iv.sub(ARC_S[k + 1], ARC_S[k]), dH = iv.sub(ARC_H[k + 1], ARC_H[k]);
  const dx = leg.ca.scaleI(dS), dy = leg.sa.scaleI(dS);
  const len2 = iv.add(iv.sqr(dS), iv.sqr(dH));
  const wx = Px.sub(A.x), wy = Py.sub(A.y), wh = iv.sub(p.h, A.h);
  const traw = wx.mul(dx).add(wy.mul(dy)).addI(iv.mul(wh, dH)).scaleI(iv.div([1, 1], len2));
  const R = traw.range(), ts = [];
  if (R[0] < 0) ts.push(TM.const(0));
  if (R[1] > 1) ts.push(TM.const(1));
  if (R[1] >= 0 && R[0] <= 1) ts.push(traw);
  return ts.map(t => {
    const pb = { x: A.x.add(dx.mul(t)), y: A.y.add(dy.mul(t)), h: t.scaleI(dH).addI(A.h) };
    // push3d(aHub, c.pt, ...): pa = pusher hub, pb = the point on the pushed leg
    const ddx = pb.x.sub(Px), ddy = pb.y.sub(Py), ddh = pb.h.addI(iv.neg(p.h));
    const hd2 = ddx.sqr().add(ddy.sqr());
    return { pb, dx: ddx, dy: ddy, dh: ddh, hd2, dist: hd2.add(ddh.sqr()).sqrt() };
  });
}
// pushed hub (models, snapshot) vs pusher leg segment a->b
function blueHubBranches(a, b, G) {
  const hx = G.st.x, hy = G.st.y, hh = [hubHeight, hubHeight];
  const Ax = asTM(a.x), Ay = asTM(a.y), Bx = asTM(b.x), By = asTM(b.y);
  const d = { x: Bx.sub(Ax), y: By.sub(Ay), h: iv.sub(b.h, a.h) };
  const len2 = d.x.sqr().add(d.y.sqr()).addI(iv.sqr(d.h));
  const wx = hx.sub(Ax), wy = hy.sub(Ay), wh = iv.sub(hh, a.h);
  const traw = wx.mul(d.x).add(wy.mul(d.y)).addI(iv.mul(wh, d.h)).mul(len2.inv());
  const R = traw.range(), ts = [];
  if (R[0] < 0) ts.push(TM.const(0));
  if (R[1] > 1) ts.push(TM.const(1));
  if (R[1] >= 0 && R[0] <= 1) ts.push(traw);
  return ts.map(t => {
    // push3d(c.pt, oHub, ...): pa = the point on the pusher's leg, pb = the pushed (snapshot) hub
    const qx = t.mul(d.x).add(Ax), qy = t.mul(d.y).add(Ay), qh = t.scaleI(d.h).addI(a.h);
    const ddx = hx.sub(qx), ddy = hy.sub(qy), ddh = qh.neg().addI(hh);
    const hd2 = ddx.sqr().add(ddy.sqr());
    return { pb: { x: hx, y: hy }, dx: ddx, dy: ddy, dh: ddh, hd2, dist: hd2.add(ddh.sqr()).sqrt() };
  });
}
// hull of several alternative states: S1 + sum_i (Si - S1)(1 + e_i)/2, sharing e_i across x, y, rot
function hullStates(alts) {
  if (alts.length === 1) return alts[0];
  const base = alts[0];
  const res = { x: base.x, y: base.y, rot: base.rot };
  for (let i = 1; i < alts.length; i++) {
    const e = newSym();
    for (const key of ['x', 'y', 'rot']) {
      const d = alts[i][key].sub(base[key]).scale(0.5);
      // d * (1 + e) = d + d*e; d*e keeps d's polynomial part on e, the rest is bounded
      let m = res[key].add(d);
      const extra = up(d.symMag() + d.remMag());
      m = m.clone(); m.s.set(e, Float64Array.from(d.c)); m.widen(extra);
      res[key] = m;
    }
  }
  return res;
}

// the engine's apply(): push the opponent by sep along (nx, ny) at contact point (px, py)
function applyPush(st, pbx, pby, nx, ny, sep) {
  const rx = pbx.sub(st.x), ry = pby.sub(st.y);
  const rn = rx.mul(ny).sub(ry.mul(nx));
  const wEff = rn.sqr().scaleI(invI).addC(1);
  const lam = sep.div(wEff);
  return { x: st.x.add(lam.mul(nx)), y: st.y.add(lam.mul(ny)), rot: st.rot.add(lam.mul(rn).scaleI(invI)) };
}

// one contact candidate (segment pair and clamp branch): the state after its push, or null if it
// cannot touch anywhere on the model
function pushAlternative(st, br, info, thr = [minD, minD], deepRule = true, opts = {}) {
  const gap = br.dist.neg().addI(thr);
  const GR = gap.range();
  if (GR[1] <= 0) return null;
  const DR = br.dist.range();
  if (deepRule && !(DR[0] >= 0.3)) throw new Error('deep-crossing rule not excluded: dist ' + DR);
  if (!deepRule && !(DR[0] > 1e-6)) throw new Error('hub contact at zero distance not excluded');
  const hd = br.hd2.sqrt();
  const hf = hd.div(br.dist);
  const HF = hf.range();
  if (!(HF[0] >= 1e-4)) throw new Error('vertical contact (hf < 1e-4) not excluded: hf ' + HF);
  const invHd = hd.inv();
  const nx = br.dx.mul(invHd), ny = br.dy.mul(invHd);
  // the separation the engine asks for: gap / max(hf, 0.35), then min(., 0.8). Where the floor or
  // the cap may be active somewhere on the model, every possible formula is an outcome.
  const sepsOf = g => {
    const out = [];
    if (HF[1] >= 0.35) out.push(g.mul(br.dist).mul(invHd));                         // gap / hf
    if (HF[0] < 0.35) { out.push(g.scaleI(iv.div([1, 1], [0.35, 0.35]))); info.floorUsed = (info.floorUsed || 0) + 1; }
    const capped = [];
    for (const s of out) {
      const SR = s.range();
      if (SR[0] <= 0.8) capped.push(s);
      if (SR[1] > 0.8) { capped.push(TM.const(0.8)); info.capUsed = (info.capUsed || 0) + 1; }
    }
    return capped;
  };
  if (GR[0] < 0 && (opts.branchStraddle || opts.hullStraddle) && Math.min(-GR[0], GR[1]) > (opts.tolRelax || 1e-9)) {
    // exact outcomes: this pair pushes (raw gap) or it does not touch
    info.pushes++; info.straddleSplits = (info.straddleSplits || 0) + 1;
    return [...sepsOf(gap).map(s => applyPush(st, br.pb.x, br.pb.y, nx, ny, s)), null];
  }
  let gp = gap;
  if (GR[0] < 0) {
    // max(0, g) = a g + w with w in [0, W]: exact for any a in [0, 1]
    const l = GR[0], u = GR[1], a = u / (u - l);
    const W = up(Math.max(-a * l, (1 - a) * u) * (1 + 1e-12));
    const e = newSym();
    gp = gap.scale(a).addC(0.5 * W).widen(up(0.5 * W * 4 * 1.2e-16));
    const p = new Float64Array(getN() + 1); p[0] = 0.5 * W; gp.s.set(e, p);
    gp.widen(up(Math.abs(0.5 * W) * 2.3e-16));
    info.relaxed++;
  }
  info.pushes++;
  const seps = sepsOf(gp);
  if (info.dbg && seps.length > 1) console.error(`      pushAlternative: ${seps.length} separations; HF [${HF}] sep ranges ${seps.map(q => q.range().map(v => v.toExponential(3)))} gap [${GR}]`);
  if (seps.length === 1) return applyPush(st, br.pb.x, br.pb.y, nx, ny, seps[0]);
  return seps.map(s => applyPush(st, br.pb.x, br.pb.y, nx, ny, s));
}

// ---- one call of resolvePush(red, blue) on models, with optional branch splitting ----
// opts.branch: keep genuinely different outcomes as separate branches (each exact) instead of
// enclosing them in one hull; outcomes closer than opts.tolHull are still hulled.
function stateDiff(A, B) {
  const m = (a, b, w) => { const r = a.sub(b).range(); return w * Math.max(Math.abs(r[0]), Math.abs(r[1])); };
  return Math.max(m(A.x, B.x, 1), m(A.y, B.y, 1), m(A.rot, B.rot, footR));
}
function clusterHull(states, tol) {
  const clusters = [];
  for (const s of states) {
    const c = clusters.find(c => stateDiff(c[0], s) < tol);
    if (c) c.push(s); else clusters.push([s]);
  }
  return clusters.map(c => c.length === 1 ? c[0] : hullStates(c));
}
// the contact slots of one pass, in the engine's order, with screened candidates (snapshot geometry)
function passSlots(G, red, info) {
  const slots = [];
  for (let i = 0; i < 3; i++) {
    const rl = red.legs[i];
    for (let j = 0; j < 3; j++) {
      const hubB = G.pointBox(j, 0), footB = G.pointBox(j, legSegs);
      const rh = redPointF(rl[0]), rf = redPointF(rl[legSegs]);
      const flat = segDist3Lower({ x: rh.x, y: rh.y, h: 0 }, { x: rf.x, y: rf.y, h: 0 }, { x: hubB.x, y: hubB.y, h: 0 }, { x: footB.x, y: footB.y, h: 0 });
      if (flat - Math.max(rh.r, rf.r) - Math.max(hubB.r, footB.r) - FLOAT_SLACK >= minD) continue;
      const cand = []; let Umin = Infinity;
      const pbx = []; for (let k = 0; k <= legSegs; k++) pbx.push(G.pointBox(j, k));
      const prx = rl.map(redPointF);
      for (let u = 0; u < legSegs; u++) for (let v = 0; v < legSegs; v++) {
        const d = segDist3f(prx[u], prx[u + 1], pbx[v], pbx[v + 1]);          // a feasible pair: upper bound
        const dl = segDist3Lower(prx[u], prx[u + 1], pbx[v], pbx[v + 1]);    // guaranteed lower bound
        const slack = Math.max(prx[u].r, prx[u + 1].r) + Math.max(pbx[v].r, pbx[v + 1].r) + FLOAT_SLACK;
        if (d + slack < Umin) Umin = d + slack;
        cand.push({ u, v, L: dl - slack });
      }
      const C = cand.filter(c => c.L <= Umin && c.L < minD);
      if (!C.length) continue;
      for (const c of C) c.br = segClosestTM(rl[c.u], rl[c.u + 1], j, c.v, G, info);
      const keep = screenCandidates(C, [minD, minD], info);
      if (keep) slots.push({ keep, thr: [minD, minD], deep: true, kind: 'leg' });
    }
  }
  const hr = rangeOf(red.hub);
  const rhub = { x: midf(hr.x), y: midf(hr.y), h: hubHeight, r: Math.hypot(iv.rad(hr.x), iv.rad(hr.y)) };
  for (let j = 0; j < 3; j++) {
    const cand = []; let Umin = Infinity;
    for (let k = 0; k < legSegs; k++) {
      const A = G.pointBox(j, k), B = G.pointBox(j, k + 1);
      const d = pointSegDist3f(rhub, A, B), sl = Math.max(A.r, B.r) + rhub.r + FLOAT_SLACK;
      if (d + sl < Umin) Umin = d + sl;
      cand.push({ k, L: d - sl });
    }
    const C = cand.filter(c => c.L <= Umin && c.L < hubLegD[1]);
    if (!C.length) continue;
    for (const c of C) c.br = hubLegBranches(red.hub, j, c.k, G);
    const keep = screenCandidates(C, hubLegD, info);
    if (keep) slots.push({ keep, thr: hubLegD, deep: false, kind: 'redhub' });
  }
  const bhub = { x: G.hubBox.x.mid, y: G.hubBox.y.mid, h: hubHeight, r: Math.hypot(G.hubBox.x.rad, G.hubBox.y.rad) };
  for (let i = 0; i < 3; i++) {
    const cand = []; let Umin = Infinity;
    for (let k = 0; k < legSegs; k++) {
      const A = redPointF(red.legs[i][k]), B = redPointF(red.legs[i][k + 1]);
      const d = pointSegDist3f(bhub, A, B), sl = bhub.r + Math.max(A.r, B.r) + FLOAT_SLACK;
      if (d + sl < Umin) Umin = d + sl;
      cand.push({ k, L: d - sl });
    }
    const C = cand.filter(c => c.L <= Umin && c.L < hubLegD[1]);
    if (!C.length) continue;
    for (const c of C) c.br = blueHubBranches(red.legs[i][c.k], red.legs[i][c.k + 1], G);
    const keep = screenCandidates(C, hubLegD, info);
    if (keep) slots.push({ keep, thr: hubLegD, deep: false, kind: 'bluehub' });
  }
  // hub against hub: a slot unless the hubs are clear by a wide margin (earlier pushes in the pass
  // can still move the pushed hub, so the screen is generous)
  {
    const gx = G.hubBox.x, gy = G.hubBox.y;
    const dd = Math.hypot(gx.mid - midf(hr.x), gy.mid - midf(hr.y)) - Math.hypot(gx.rad, gy.rad) - Math.hypot(iv.rad(hr.x), iv.rad(hr.y)) - FLOAT_SLACK;
    if (dd < hubHub[1] + 9) slots.push({ kind: 'hubhub', hub: red.hub, keep: [] });
  }
  return slots;
}
function screenCandidates(C, thr, info) {
  C = C.filter(c => c.br.some(b => b.dist.range()[0] < thr[1]));
  if (!C.length) return null;
  const beats = (A, B) => A.br.every(ba => B.br.every(bb => ba.dist.sub(bb.dist).range()[1] < 0));
  const keep = C.filter(c => !C.some(o => o !== c && beats(o, c)));
  info.maxCand = Math.max(info.maxCand, keep.length);
  return keep;
}
// hub against hub, the engine's last contact of a pass: if the hubs are closer than 2 hubR the pushed
// hub slides away along the line between them by the shortfall (capped at 0.8u), and does not turn.
// It reads the pushed piece's LIVE position, so it is evaluated when the slot is applied.
function hubHubAlt(st, hub, info, opts) {
  const Hx = asTM(hub.x), Hy = asTM(hub.y);
  const dx = st.x.sub(Hx), dy = st.y.sub(Hy);
  const d2 = dx.sqr().add(dy.sqr());
  const R2 = d2.range();
  if (R2[0] >= iv.sqr(hubHub)[1]) return null;                      // hubs clear of each other everywhere
  if (!(R2[0] > 1e-6)) throw new Error('hub-hub: hubs may coincide: d2 range ' + R2 + ' dx ' + dx.range() + ' dy ' + dy.range() + ' st.x ' + st.x.range() + ' H ' + Hx.range() + ',' + Hy.range());
  const d = d2.sqrt();
  const gap = d.neg().addI(hubHub);
  const GR = gap.range();
  if (GR[1] <= 0) return null;
  const inv = d.inv(), nx = dx.mul(inv), ny = dy.mul(inv);
  const capped = g => {                                              // min(g, 0.8)
    const SR = g.range();
    if (SR[1] <= 0.8) return [g];
    if (SR[0] >= 0.8) { info.capUsed = (info.capUsed || 0) + 1; return [TM.const(0.8)]; }
    info.capUsed = (info.capUsed || 0) + 1; return [g, TM.const(0.8)];
  };
  const move = sep => ({ x: st.x.add(sep.mul(nx)), y: st.y.add(sep.mul(ny)), rot: st.rot });
  info.hubHubPushes = (info.hubHubPushes || 0) + 1;
  if (GR[0] < 0 && (opts.branchStraddle || opts.hullStraddle) && Math.min(-GR[0], GR[1]) > (opts.tolRelax || 1e-9)) {
    info.pushes++; info.straddleSplits = (info.straddleSplits || 0) + 1;
    return [...capped(gap).map(move), null];
  }
  let gp = gap;
  if (GR[0] < 0) {
    const l = GR[0], u = GR[1], a = u / (u - l);
    const W = up(Math.max(-a * l, (1 - a) * u) * (1 + 1e-12));
    const e = newSym();
    gp = gap.scale(a).addC(0.5 * W).widen(up(0.5 * W * 4 * 1.2e-16));
    const pp = new Float64Array(getN() + 1); pp[0] = 0.5 * W; gp.s.set(e, pp);
    gp.widen(up(Math.abs(0.5 * W) * 2.3e-16));
    info.relaxed++;
  }
  info.pushes++;
  const seps = capped(gp);
  return seps.length === 1 ? move(seps[0]) : seps.map(move);
}
// push every outcome of every slot onto cur, slot by slot in the engine's order; returns
// [{ cur, pushed }], merged after each slot so the branch count stays bounded
function applySlots(cur, slots, info, opts) {
  let states = [{ cur, pushed: false }];
  for (const slot of slots) {
    const next = [];
    for (const st of states) {
      const alts = []; let anyPush = false;
      const take = r => {
        if (Array.isArray(r)) { for (const s of r) { if (s) { alts.push(s); anyPush = true; } else alts.push(st.cur); } }
        else if (r) { alts.push(r); anyPush = true; } else alts.push(st.cur);
      };
      if (slot.kind === 'hubhub') take(hubHubAlt(st.cur, slot.hub, info, opts));
      else for (const c of slot.keep) for (const b of c.br) take(pushAlternative(st.cur, b, info, slot.thr, slot.deep, opts));
      if (info.dbg) {
        const wd = m => { const r = m.range(); return (r[1] - r[0]).toExponential(1); };
        console.error(`      slot ${slot.kind} candidates ${slot.keep.map(c => `${c.u ?? c.k}-${c.v ?? ''}x${c.br.length}`).join(',')} thr ${slot.thr}`);
        for (const a of alts) console.error(`      after slot ${slot.kind}: ${alts.length} alts; x width ${wd(a.x)} symMag ${a.x.symMag().toExponential(1)} rem ${a.x.remMag().toExponential(1)} nsym ${a.x.s.size}`);
      }
      if (slot.kind === 'redhub' && anyPush) info.hubPushes = (info.hubPushes || 0) + 1;
      const uniq = []; for (const s of alts) if (!uniq.includes(s)) uniq.push(s);
      if (uniq.length === 1) { next.push({ cur: uniq[0], pushed: st.pushed || anyPush }); continue; }
      if (!opts.branch) { info.hulls++; next.push({ cur: hullStates(uniq), pushed: st.pushed || anyPush }); continue; }
      info.splits = (info.splits || 0) + 1;
      for (const s of uniq) next.push({ cur: s, pushed: st.pushed || s !== st.cur });
    }
    states = mergeTagged(next, opts, info);
  }
  return states;
}
// merge tagged branch states: hull those closer than tolHull, then the closest pairs down to the cap
function mergeTagged(list, opts, info) {
  if (list.length <= 1) return list;
  const tol = opts.tolHull || 0, cap = opts.branch ? (opts.maxBranches || 1) : 1;
  let L = [];
  for (const s of list) {
    const c = L.find(g => stateDiff(g[0].cur, s.cur) < tol);
    if (c) c.push(s); else L.push([s]);
  }
  L = L.map(g => g.length === 1 ? g[0] : { cur: hullStates(g.map(x => x.cur)), pushed: g.some(x => x.pushed) });
  while (L.length > cap) {
    let best = null;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const d = stateDiff(L[i].cur, L[j].cur); if (!best || d < best.d) best = { i, j, d };
    }
    if (opts.failOnForcedMerge) throw new Error('branch cap reached');
    const h = { cur: hullStates([L[best.i].cur, L[best.j].cur]), pushed: L[best.i].pushed || L[best.j].pushed };
    L = L.filter((_, k) => k !== best.i && k !== best.j); L.push(h);
    info.forcedMerges = (info.forcedMerges || 0) + 1;
  }
  info.maxBranches = Math.max(info.maxBranches || 1, L.length);
  return L;
}
function hubHubCheck(cur, red) {
  const cx = boxOf(cur.x), cy = boxOf(cur.y), hr = rangeOf(red.hub);
  const hh = Math.hypot(cx.mid - midf(hr.x), cy.mid - midf(hr.y)) - Math.hypot(cx.rad, cy.rad) - Math.hypot(iv.rad(hr.x), iv.rad(hr.y)) - FLOAT_SLACK;
  if (!(hh > hubHub[1])) throw new Error('hub-hub contact not excluded: ' + hh);
}
function runPasses(state, red, info, pass, opts) {
  if (pass >= 10) return [state];
  const G = blueGeometry(state);
  const slots = passSlots(G, red, info);
  if (info.dbg) {   // DBG=1: one line per pass and per contact candidate
    const wd = m => { const r = m.range(); return (r[1] - r[0]).toExponential(1); };
    console.error(`  pass ${pass}: x width ${wd(state.x)} y ${wd(state.y)} rot ${wd(state.rot)} symMag ${state.x.symMag().toExponential(1)} rem ${state.x.remMag().toExponential(1)} polyW ${(() => { const q = state.x.polyRange(); return (q[1] - q[0]).toExponential(1); })()}`);
    for (const sl of slots) {
      if (sl.kind === 'hubhub') { console.error('    slot hubhub'); continue; }
      for (const c of sl.keep) for (const b of c.br) console.error(`    slot ${sl.kind} ${c.u ?? c.k}-${c.v ?? ''} ${b.label || ''} gap [${b.dist.neg().addI(sl.thr).range().map(v => v.toExponential(2))}] hd2 [${b.hd2.range().map(v => v.toFixed(3))}]`);
    }
  }
  if (!slots.length) return [state];
  const res = applySlots(state, slots, info, opts);
  const out = [];
  for (const r of res) {
    if (!r.pushed) out.push(r.cur);       // a pass without contact leaves this branch unchanged for good
    else { info.passes++; out.push(...runPasses(r.cur, red, info, pass + 1, opts)); }
  }
  return mergeBranches(out, opts, info);
}
function mergeBranches(list, opts, info) {
  if (list.length <= 1) return list;
  let L = clusterHull(list, opts.tolHull || 0);
  while (L.length > (opts.maxBranches || 1)) {
    let best = null;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const d = stateDiff(L[i], L[j]); if (!best || d < best.d) best = { i, j, d };
    }
    if (opts.failOnForcedMerge) throw new Error('branch cap reached');
    const h = hullStates([L[best.i], L[best.j]]);
    L = L.filter((_, k) => k !== best.i && k !== best.j); L.push(h);
    info.forcedMerges = (info.forcedMerges || 0) + 1;
  }
  info.maxBranches = Math.max(info.maxBranches || 1, L.length);
  return L;
}
// resolvePush on a list of branch states
function resolvePushTM(states, red, info, opts = {}) {
  if (!Array.isArray(states)) states = [states];
  const out = [];
  for (const s of states) out.push(...runPasses(s, red, info, 0, opts));
  return mergeBranches(out, opts, info);
}

// ---- symbol reduction (Lohner-style): keep the polynomial parts, re-express all noise symbols and
// interval parts as three fresh symbols with constant coefficients ----
function det3(m) {   // interval determinant of a 3x3 interval matrix
  const t = (a, b, c, d) => iv.sub(iv.mul(a, b), iv.mul(c, d));
  return iv.add(iv.sub(iv.mul(m[0][0], t(m[1][1], m[2][2], m[1][2], m[2][1])), iv.mul(m[0][1], t(m[1][0], m[2][2], m[1][2], m[2][0]))), iv.mul(m[0][2], t(m[1][0], m[2][1], m[1][1], m[2][0])));
}
function inv3(Mf) {  // rigorous enclosure of the inverse of a float 3x3 matrix
  const m = Mf.map(r => r.map(v => [v, v]));
  const D = det3(m);
  if (D[0] <= 0 && D[1] >= 0) throw new Error('singular basis in fold');
  const cof = (i, j) => {
    const r = [0, 1, 2].filter(k => k !== i), c = [0, 1, 2].filter(k => k !== j);
    const v = iv.sub(iv.mul(m[r[0]][c[0]], m[r[1]][c[1]]), iv.mul(m[r[0]][c[1]], m[r[1]][c[0]]));
    return (i + j) % 2 ? iv.neg(v) : v;
  };
  const out = [];
  for (let i = 0; i < 3; i++) { out.push([]); for (let j = 0; j < 3; j++) out[i].push(iv.div(cof(j, i), D)); }
  return out;
}
function gramSchmidt(cols) {   // orthonormal basis, dominant columns first, completed to 3
  const Q = [];
  const sorted = cols.slice().sort((a, b) => Math.hypot(...b) - Math.hypot(...a));
  const cand = sorted.concat([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  for (const v of cand) {
    let w = v.slice();
    for (const q of Q) { const d = w[0] * q[0] + w[1] * q[1] + w[2] * q[2]; w = w.map((x, k) => x - d * q[k]); }
    const n = Math.hypot(...w);
    if (n > 1e-12 * Math.max(1, Math.hypot(...v)) && n > 1e-300) Q.push(w.map(x => x / n));
    if (Q.length === 3) break;
  }
  return Q;   // rows are basis vectors
}
// protect: ids of noise symbols that must keep their identity (they also appear in the pusher's pose,
// so re-basing them would lose the relation between the pushed piece and the pusher)
function fold(st, protect) {
  const N = getN();
  const keys = ['x', 'y', 'rot'];
  // weight rotation by the foot radius so the basis treats one unit of foot motion alike
  const W = [1, 1, footR];
  const S = keys.map(k => st[k].clone());
  const kept = S.map(m => { const o = new Map(); if (protect) for (const id of protect) if (m.s.has(id)) { o.set(id, m.s.get(id)); m.s.delete(id); } return o; });
  // centre the interval parts
  const rho = [];
  for (let i = 0; i < 3; i++) {
    const m = S[i], md = 0.5 * m.lo + 0.5 * m.hi;
    const c0 = m.c[0] + md; const err = up(Math.abs(c0) * 2.3e-16);
    m.c[0] = c0;
    rho.push(up(Math.max(m.hi - md, md - m.lo) + err));
    m.lo = 0; m.hi = 0;
  }
  const syms = new Set(); for (const m of S) for (const k of m.s.keys()) syms.add(k);
  const gens = [];   // each: { poly: [p_x, p_y, p_rot] (Float64Array or null) }
  for (const j of syms) gens.push(S.map(m => m.s.get(j) || null));
  if (!gens.length && rho.every(r => r === 0)) return st;
  // a basis from the generators at t = 0 (weighted), plus the interval parts
  const cols = gens.map(g => g.map((p, i) => (p ? p[0] : 0) * W[i]));
  for (let i = 0; i < 3; i++) if (rho[i] > 0) { const v = [0, 0, 0]; v[i] = rho[i] * W[i]; cols.push(v); }
  const Qrows = gramSchmidt(cols);
  // basis matrix in unweighted coordinates: B = diag(1/W) Q^T
  const B = [0, 1, 2].map(i => [0, 1, 2].map(k => Qrows[k][i] / W[i]));
  const Binv = inv3(B);
  // v_k = sum over generators of max_t |(Binv g(t))_k| + the interval parts
  const v = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let acc = 0;
    for (const g of gens) {
      // polynomial sum_i mid(Binv[k][i]) g_i(t), plus the error from Binv's radius
      const p = new Float64Array(N + 1); let err = 0;
      for (let i = 0; i < 3; i++) {
        if (!g[i]) continue;
        const md = iv.mid(Binv[k][i]), r = iv.rad(Binv[k][i]);
        for (let n = 0; n <= N; n++) { const val = md * g[i][n]; p[n] += val; err += Math.abs(p[n]) + Math.abs(val); }
        err += r * norm1(g[i]) / (2.3e-16);   // rescaled below
      }
      const tmp = new TM(p);
      const R = tmp.polyRange();
      acc += up(Math.max(Math.abs(R[0]), Math.abs(R[1])) + err * 2.3e-16);
    }
    for (let i = 0; i < 3; i++) acc += up(iv.mag(Binv[k][i]) * rho[i]);
    v[k] = up(acc * (1 + 1e-10));
  }
  // new generators: columns of B scaled by v; their float rounding goes to the interval parts
  const out = {};
  const fresh = [newSym(), newSym(), newSym()];
  for (let i = 0; i < 3; i++) {
    const m = new TM(Float64Array.from(S[i].c));
    let err = 0;
    for (let k = 0; k < 3; k++) {
      const val = B[i][k] * v[k];
      if (val === 0) continue;
      const p = new Float64Array(N + 1); p[0] = val; m.s.set(fresh[k], p);
      err += Math.abs(val);
    }
    // B[i][k] * v[k] in reals equals val within half an ulp; enlarge v by that amount via the remainder
    m.widen(up(err * 2.3e-16));
    for (const [id, pp] of kept[i]) m.s.set(id, pp);
    out[keys[i]] = m;
  }
  return out;
}

module.exports = { passSlots, hubHubCheck, blueGeometry, segClosestTM, redPose, redGeometry, tmGeometry, resolvePushTM, fold, hullStates, footR, minD, TWO_PI_3, ARC_S, ARC_H, legSegs, Ii };
