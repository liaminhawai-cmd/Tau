// Throw certificate, second form: a thin set around the centre trajectory.
//
// The attacker is kinematic: the search swings it a degree at a time, and the engine splits each
// degree into three substeps of 1/3 degree, so at substep k it is rotated about its pinned foot P by
// k/3 degrees. Its swing limit depends on its own pose only, so every victim pose in the box sees
// the same K substeps. The victim starts anywhere in a box and is pushed by the engine's law.
//
// The set of victim poses after substep k is enclosed by a parallelotope around the CENTRE pose's
// own trajectory (simulated exactly): q = q_c(k) + M u, u in a box U, with the third column of M
// the centre's push direction a_c = (n, rn/I). Per substep:
//   * analyse() (from throw-cert.js) bounds, over the axis-aligned hull of the parallelotope, the
//     touching leg pair (H1), the contact normal cone, hf and the lever arm rn;
//   * the push of any pose is Lambda a_c + v with Lambda >= 0 unknown and v in Lambda * (a - a_c),
//     a ranging over the cone (all Gauss-Seidel iterations included, since each pushes along a
//     normal in the cone by a non-negative amount): v moves the tangential coordinates u1, u2 by a
//     small interval, and Lambda moves only the coefficient of a_c;
//   * that coefficient is then PINNED by the contact constraint: after the substep the pair's
//     distance is in [D, D + eta] for every pushed pose (the solver stops when no pair is under D,
//     and Lemma 1 bounds the overshoot), and the distance is a Lipschitz function of the pose whose
//     gradient is the unit closest-point vector (hf n, hf rn), enclosed by the cone. The mean-value
//     form around the centre pose therefore bounds the coefficient to a width of order eta.
// Nothing is linearised: the only derivative used is the gradient of a distance function, which is
// the closest-point vector itself. The victim is thrown when the exposed foot's radius over the
// final parallelotope exceeds EDGE. --validate simulates random poses with the engine's own substep
// and asserts containment at every substep.
'use strict';
const FW = require('./forced-win.js');
const CL = require('./contact-law.js');
const { REPLICA, feetOf, R, I, MIND: D, EDGE } = CL;
const eng = CL.eng, CFG = eng.CFG;
const H = CFG.hubHeight, RHO = CFG.legRadius, HUBR = RHO * 1.9, HUBLEGD = HUBR + RHO, NSEG = CFG.legSegs;
const DEG = Math.PI / 180, LIM_SUB = DEG / Math.ceil(1 / CFG.substepDeg);   // the engine's substep under a one-degree swing
// The overshoot a substep's pushes can leave, i.e. how far above D the pair can end up.
//
// The tempting argument is that the law moves the touched point by exactly the gap along the contact
// normal, so to first order the pair ends at exactly D, leaving only the difference between the
// finite rotation and its linearisation, R(1 - cos eps) + R(eps - sin eps). That is about 8e-6u
// here, and it is WRONG: measured against the engine over this sweep it is exceeded, by about 10%,
// from the first chord-vertex crossing onward (substep 32 of 138: true 8.838e-6u against a bound of
// 8.025e-6u). It follows one old material point, whereas the quantity that has to be bounded is the
// shortest distance after the push, which is re-minimised over the whole polyline.
//
// Use the projection form instead. In mass coordinates the one-contact update is a Newton step on
// the gap, Phi(z) = z - G(z) a/|a|^2 with a = grad G, so its linear term cancels exactly and
// Taylor's theorem leaves
//     |G(Phi(z))|  <=  M p^2 / (2 m^2),
// with p the penetration entering the substep, m a lower bound on |a| = hf sqrt(1 + rn^2/I), and M a
// bound on the Hessian of the gap. For one chord pair, with alpha = R/sqrt(I), p0 = sqrt(1+alpha^2),
// sigma = sqrt(1 - cbar^2), b0 = p0/sigma + d/(sqrt(I) sigma^2),
//     k_n = 1/(sqrt(I) sigma)                    both contact points interior,
//     k_n = p0/d + 1/(sqrt(I) sigma)             if an endpoint may clamp,
//     M   = sqrt( k_n^2 + [alpha k_n + alpha/sqrt(I) + b0/sqrt(I)]^2 ).
// That is about 0.226/u interior and 1.06/u with clamping, giving a residual near 1.1e-3u rather
// than 8e-6u. Two orders of magnitude looser, and actually proved. (Due to an outside reviewer,
// whose counterexample is what showed the material-point bound was unsound.)
const SQI = Math.sqrt(I), ALPHA = R / SQI, P0 = Math.hypot(1, ALPHA);
function hessBound(cbar, dHi, clamping, dLo) {
  const sigma = Math.sqrt(Math.max(1e-6, 1 - cbar * cbar));
  const b0 = P0 / sigma + dHi / (SQI * sigma * sigma);
  const kn = (clamping ? P0 / Math.max(dLo, 1e-3) : 0) + 1 / (SQI * sigma);
  return Math.hypot(kn, ALPHA * kn + ALPHA / SQI + b0 / SQI);
}
const etaOf = (M, p, m) => (M * p * p) / (2 * Math.max(m, 1e-3) * Math.max(m, 1e-3));
// Epsilon-inflation, for the fixed point below. The round loop looks for an assumed contact cone C
// whose own image Phi(C) is contained in C, which certifies C as an enclosure of the true post-push
// cone. The iteration contracts geometrically but reaches containment only in the limit, so a plain
// equality test runs out of rounds a hair short. The standard remedy is to test a slightly FATTENED
// candidate instead: if Phi(C+) is contained in C+, then C+ is a valid enclosure, and nothing about
// the containment test is weakened -- only the candidate offered to it is better chosen.
const inflate = (a, eps) => { const w = Math.max(wid(a) * eps, eps * 1e-3); return [a[0] - w, a[1] + w]; };
const inflateCone = (c, eps) => { const psiN = inflate(c.psiN, eps), rn = inflate(c.rn, eps), hf = [Math.max(0.01, inflate(c.hf, eps)[0]), Math.min(1, inflate(c.hf, eps)[1])];
  const n = [cosRange(psiN), sinRange(psiN)];
  return { psiN, rn, hf, n, G: [mul(hf, n[0]), mul(hf, n[1]), mul(hf, rn)], cth: c.cth, cbar: c.cbar, clamping: c.clamping }; };
const EPS_LO = 1e-7;               // the solver leaves no pair under D (it stops when none is); fp slack

// ---- intervals ----
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[1], a[1] - b[0]];
const mul = (a, b) => { const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]; return [Math.min(...p), Math.max(...p)]; };
const scale = (a, k) => (k >= 0 ? [a[0] * k, a[1] * k] : [a[1] * k, a[0] * k]);
const neg = a => [-a[1], -a[0]];
const sq = a => (a[0] >= 0 ? [a[0] * a[0], a[1] * a[1]] : a[1] <= 0 ? [a[1] * a[1], a[0] * a[0]] : [0, Math.max(a[0] * a[0], a[1] * a[1])]);
const divPos = (a, b) => { if (b[0] <= 0) throw new Error('division by an interval touching 0'); return [Math.min(a[0] / b[0], a[0] / b[1]), Math.max(a[1] / b[0], a[1] / b[1])]; };
const hull = (a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
const isect = (a, b) => [Math.max(a[0], b[0]), Math.min(a[1], b[1])];
const wid = a => a[1] - a[0];
function cosRange(a) { const [lo, hi] = a; if (hi - lo >= 2 * Math.PI) return [-1, 1]; const c0 = Math.cos(lo), c1 = Math.cos(hi); let mn = Math.min(c0, c1), mx = Math.max(c0, c1); const k0 = Math.ceil(lo / Math.PI); for (let k = k0; k * Math.PI <= hi; k++) { if (k % 2 === 0) mx = 1; else mn = -1; } return [mn, mx]; }
function sinRange(a) { return cosRange([a[0] - Math.PI / 2, a[1] - Math.PI / 2]); }
function angleHull(bx, by) {
  if (bx[0] <= 0 && bx[1] >= 0 && by[0] <= 0 && by[1] >= 0) return null;
  const corners = [[bx[0], by[0]], [bx[0], by[1]], [bx[1], by[0]], [bx[1], by[1]]].map(([x, y]) => Math.atan2(y, x));
  const c = Math.atan2((by[0] + by[1]) / 2, (bx[0] + bx[1]) / 2);
  const rel = corners.map(t => Math.atan2(Math.sin(t - c), Math.cos(t - c)));
  return [c + Math.min(...rel), c + Math.max(...rel)];
}
function dotCone(bx, by, t) {
  let mn = Infinity, mx = -Infinity;
  for (const wx of bx) for (const wy of by) {
    const ph = Math.atan2(wy, wx), cands = [t[0], t[1]];
    for (const st of [ph, ph + Math.PI]) { for (let k = -2; k <= 2; k++) { const x = st + 2 * Math.PI * k; if (x >= t[0] && x <= t[1]) cands.push(x); } }
    for (const x of cands) { const v = wx * Math.cos(x) + wy * Math.sin(x); if (v < mn) mn = v; if (v > mx) mx = v; }
  }
  return [mn, mx];
}
// 3x3 matrices as columns; vectors [x, y, rot]
const matVec = (M, v) => [0, 1, 2].map(r => M[r][0] * v[0] + M[r][1] * v[1] + M[r][2] * v[2]);
const matVecIv = (M, U) => [0, 1, 2].map(r => add(add(scale(U[0], M[r][0]), scale(U[1], M[r][1])), scale(U[2], M[r][2])));
const matMul = (A, B) => [0, 1, 2].map(r => [0, 1, 2].map(c => A[r][0] * B[0][c] + A[r][1] * B[1][c] + A[r][2] * B[2][c]));
function matInv(M) {
  const [[a, b, c], [d, e, f], [g, h, i]] = M, det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-18) throw new Error('singular basis');
  return [[(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det], [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det], [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]];
}
const colsOf = (m1, m2, m3) => [0, 1, 2].map(r => [m1[r], m2[r], m3[r]]);
const col = (M, j) => [M[0][j], M[1][j], M[2][j]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const aabbOf = (c, M, U) => { const v = matVecIv(M, U); return { x: add([c.x, c.x], v[0]), y: add([c.y, c.y], v[1]), rot: add([c.rot, c.rot], v[2]) }; };

// ---- geometry: the engine's, verbatim from contact-law.js ----
const arcPts = (p, i) => { const a = p.rot + i * 2 * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a), pts = []; for (let k = 0; k <= NSEG; k++) { const ph = (k / NSEG) * Math.PI / 2, s = Math.sin(ph) * R; pts.push({ x: p.x + ca * s, y: p.y + sa * s, h: Math.cos(ph) * H }); } return pts; };
const chordsOf = p => feetOf(p).map(f => [{ x: p.x, y: p.y }, f]);
function segClosest(a, b, c, d) {
  const d1 = { x: b.x - a.x, y: b.y - a.y }, d2 = { x: d.x - c.x, y: d.y - c.y }, r = { x: a.x - c.x, y: a.y - c.y };
  const A = d1.x * d1.x + d1.y * d1.y, E = d2.x * d2.x + d2.y * d2.y, F = d2.x * r.x + d2.y * r.y;
  const C = d1.x * r.x + d1.y * r.y, B = d1.x * d2.x + d1.y * d2.y, denom = A * E - B * B;
  let s = denom !== 0 ? Math.min(1, Math.max(0, (B * F - C * E) / denom)) : 0;
  let t = (B * s + F) / E;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -C / A)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (B - C) / A)); }
  const pa = { x: a.x + d1.x * s, y: a.y + d1.y * s }, pb = { x: c.x + d2.x * t, y: c.y + d2.y * t };
  return { pa, pb, dist: Math.hypot(pa.x - pb.x, pa.y - pb.y) };
}
function segClosest3(p1, q1, p2, q2) {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, h: q1.h - p1.h }, d2 = { x: q2.x - p2.x, y: q2.y - p2.y, h: q2.h - p2.h }, r = { x: p1.x - p2.x, y: p1.y - p2.y, h: p1.h - p2.h };
  const a = d1.x * d1.x + d1.y * d1.y + d1.h * d1.h, e = d2.x * d2.x + d2.y * d2.y + d2.h * d2.h;
  const f = d2.x * r.x + d2.y * r.y + d2.h * r.h, c = d1.x * r.x + d1.y * r.y + d1.h * r.h, b = d1.x * d2.x + d1.y * d2.y + d1.h * d2.h, denom = a * e - b * b;
  let s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
  let t = e > 1e-12 ? (b * s + f) / e : 0;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, a > 1e-12 ? -c / a : 0)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, a > 1e-12 ? (b - c) / a : 0)); }
  const pa = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, h: p1.h + d1.h * s }, pb = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, h: p2.h + d2.h * t };
  return { pa, pb, dist: Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.h - pa.h), s, t };
}
function arcClosest(A, B) { let best = null; for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++) { const c = segClosest3(A[i], A[i + 1], B[j], B[j + 1]); if (!best || c.dist < best.dist) best = c; } return best; }
function pointArcClosest(p, A) {
  let best = null;
  for (let i = 0; i < A.length - 1; i++) {
    const a = A[i], b = A[i + 1], dx = b.x - a.x, dy = b.y - a.y, dh = b.h - a.h, len2 = dx * dx + dy * dy + dh * dh || 1e-12;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.h - a.h) * dh) / len2; t = Math.max(0, Math.min(1, t));
    const pt = { x: a.x + dx * t, y: a.y + dy * t, h: a.h + dh * t }, d = Math.hypot(pt.x - p.x, pt.y - p.y, pt.h - p.h);
    if (!best || d < best.dist) best = { pt, dist: d };
  }
  return best;
}
const rotAbout = (p, P, dA) => { const c = Math.cos(dA), s = Math.sin(dA), rx = p.x - P.x, ry = p.y - P.y; return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + dA }; };
const phiMid = k => ((k + 0.5) / NSEG) * Math.PI / 2;
const legAngle = (p, i) => p.rot + i * 2 * Math.PI / 3;

// One engine substep's push resolution on the victim `opp` by the (already rotated) attacker
// `active`: contact-law.js's REPLICA loop, with every push recorded. Mutates opp.
function pushSubstep(active, opp, K) {
  K = K || REPLICA;
  const pushes = [], flags = { deep: 0, hfFloor: 0, cap: 0, hub: 0, iters: 0 };
  const aArcs = [0, 1, 2].map(i => arcPts(active, i)), aChords = chordsOf(active), aHub = { x: active.x, y: active.y, h: H };
  const opp0 = { x: opp.x, y: opp.y };
  const apply = (px, py, nx, ny, sep, tag) => {
    if (sep > K.cap) { flags.cap++; sep = K.cap; }
    const rx = px - opp.x, ry = py - opp.y, rn = rx * ny - ry * nx, wEff = 1 + rn * rn / I, lambda = sep / wEff;
    pushes.push({ ...tag, nx, ny, rn, lambda, sep });
    opp.x += lambda * nx; opp.y += lambda * ny; opp.rot += (lambda * rn) / I;
  };
  const push3d = (pa, pb, dist, gap, tag) => {
    const nx3 = (pb.x - pa.x) / dist, ny3 = (pb.y - pa.y) / dist, hf = Math.hypot(nx3, ny3);
    if (hf < 1e-4) return;
    if (hf < K.hfFloor) flags.hfFloor++;
    apply(pb.x, pb.y, nx3 / hf, ny3 / hf, gap / Math.max(hf, K.hfFloor), { ...tag, hf, dist });
  };
  for (let iter = 0; iter < K.iters; iter++) {
    flags.iters = iter + 1;
    const oArcs = [0, 1, 2].map(j => arcPts(opp, j)), oChords = chordsOf(opp), oHub = { x: opp.x, y: opp.y, h: H };
    let any = 0, worst = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      if (segClosest(aChords[i][0], aChords[i][1], oChords[j][0], oChords[j][1]).dist >= D) continue;
      const c = arcClosest(aArcs[i], oArcs[j]);
      if (c.dist >= D) continue;
      any++; worst = Math.max(worst, D - c.dist);
      if (K.deepRule && c.dist < 0.3) {
        flags.deep++;
        const A = aChords[i], ax = A[1].x - A[0].x, ay = A[1].y - A[0].y, L = Math.hypot(ax, ay) || 1;
        let nx = -ay / L, ny = ax / L;
        if (nx * (opp0.x - c.pa.x) + ny * (opp0.y - c.pa.y) < 0) { nx = -nx; ny = -ny; }
        apply(c.pb.x, c.pb.y, nx, ny, D, { kind: 'deep', i, j, iter });
      } else if (c.dist < 1e-9) {
        const A = aChords[i], ax = A[1].x - A[0].x, ay = A[1].y - A[0].y, L = Math.hypot(ax, ay) || 1;
        let nx = -ay / L, ny = ax / L;
        if (nx * (opp0.x - c.pa.x) + ny * (opp0.y - c.pa.y) < 0) { nx = -nx; ny = -ny; }
        apply(c.pb.x, c.pb.y, nx, ny, D, { kind: 'crossed', i, j, iter });
      } else push3d(c.pa, c.pb, c.dist, D - c.dist, { kind: 'leg', i, j, iter, pa: c.pa, pb: c.pb });
    }
    for (let j = 0; j < 3; j++) { const c = pointArcClosest(aHub, oArcs[j]); if (c.dist < HUBLEGD && c.dist > 1e-6) { any++; flags.hub++; worst = Math.max(worst, HUBLEGD - c.dist); push3d(aHub, c.pt, c.dist, HUBLEGD - c.dist, { kind: 'hubA', j, iter }); } }
    for (let i = 0; i < 3; i++) { const c = pointArcClosest(oHub, aArcs[i]); if (c.dist < HUBLEGD && c.dist > 1e-6) { any++; flags.hub++; worst = Math.max(worst, HUBLEGD - c.dist); push3d(c.pt, oHub, c.dist, HUBLEGD - c.dist, { kind: 'hubV', i, iter }); } }
    { const dx = opp.x - active.x, dy = opp.y - active.y, d = Math.hypot(dx, dy); if (d < 2 * HUBR && d > 1e-6) { any++; flags.hub++; worst = Math.max(worst, 2 * HUBR - d); apply(opp.x, opp.y, dx / d, dy / d, 2 * HUBR - d, { kind: 'hubhub', iter }); } }
    if (!any || worst <= K.tol) break;
  }
  return { pushes, flags };
}
// The centre trajectory: the victim's pose after every substep, with every push recorded.
function sweep(pieces, attacker, pv, dir, steps) {
  const att0 = pieces[attacker], P = feetOf(att0)[pv], opp = { ...pieces[1 - attacker] }, out = [];
  for (let k = 1; k <= steps; k++) {
    const att = rotAbout(att0, P, dir * k * LIM_SUB);
    const r = pushSubstep(att, opp);
    out.push({ k, att, pose: { ...opp }, pushes: r.pushes, flags: r.flags, maxFootR: Math.max(...feetOf(opp).map(f => Math.hypot(f.x, f.y))) });
  }
  return out;
}

// The victim's own leg vertices are KNOWN MATERIAL POINTS of the victim, so over a set of poses each
// one traces an exactly computable arc, not a blanket ball of radius pad. Leg j's vertex k sits at
// arclength angle ph = (k/NSEG)(pi/2), so at radius R sin(ph) and fixed height H cos(ph), turned by
// the pose's own rotation. This is the whole reason a vertex contact is CHEAPER than an interior one
// rather than dearer: one end of the contact vector stops being something to localise.
function vertexBoxOf(box, j, k) {
  const ang = [box.rot[0] + j * 2 * Math.PI / 3, box.rot[1] + j * 2 * Math.PI / 3];
  const ph = (k / NSEG) * Math.PI / 2, s = Math.sin(ph) * R, hh = Math.cos(ph) * H;
  return { x: add(box.x, scale(cosRange(ang), s)), y: add(box.y, scale(sinRange(ang), s)), h: [hh, hh] };
}
// The foot of the perpendicular from ONE FIXED point onto a segment whose ends are themselves known
// material points of the victim. The attacker does not move within a substep, so its own vertices are
// exact; this is the mirror of footOnFixedSeg and makes an attacker-vertex contact exact too.
function footOnMovingSeg(pt, B0, B1) {
  const e = [sub(B1.x, B0.x), sub(B1.y, B0.y), sub(B1.h, B0.h)];
  const eL2 = add(add(sq(e[0]), sq(e[1])), sq(e[2]));
  if (eL2[0] < 1e-12) return null;
  const r = [sub([pt.x, pt.x], B0.x), sub([pt.y, pt.y], B0.y), sub([pt.h, pt.h], B0.h)];
  const t = divPos(add(add(mul(r[0], e[0]), mul(r[1], e[1])), mul(r[2], e[2])), eL2);
  if (t[0] <= 1e-4 || t[1] >= 1 - 1e-4) return null;
  const foot = { x: add(B0.x, mul(t, e[0])), y: add(B0.y, mul(t, e[1])), h: add(B0.h, mul(t, e[2])) };
  const w = [sub(foot.x, [pt.x, pt.x]), sub(foot.y, [pt.y, pt.y]), sub(foot.h, [pt.h, pt.h])];   // foot - pt
  return { w, foot, t };
}
// The foot of the perpendicular from a set of points onto ONE FIXED segment. The attacker does not
// move within a substep, so for a victim-vertex contact this is exact too: t is affine in the point,
// and w = p - foot is the point's component orthogonal to the chord. Returns null when the foot can
// leave the segment, where the clamp makes it a different (endpoint) regime.
function footOnFixedSeg(pB, q0, q1) {
  const e = [q1.x - q0.x, q1.y - q0.y, q1.h - q0.h], eL2 = dot3(e, e);
  if (eL2 < 1e-12) return null;
  const r = [sub(pB.x, [q0.x, q0.x]), sub(pB.y, [q0.y, q0.y]), sub(pB.h, [q0.h, q0.h])];
  const t = scale(add(add(mul(r[0], [e[0], e[0]]), mul(r[1], [e[1], e[1]])), mul(r[2], [e[2], e[2]])), 1 / eL2);
  if (t[0] <= 1e-4 || t[1] >= 1 - 1e-4) return null;
  // w = p - foot is the component of r orthogonal to the chord, so apply the projector I - uu^T in
  // ONE product with SCALAR coefficients. Forming t first and subtracting t e instead costs a whole
  // extra level of interval dependency -- t and e are perfectly correlated and interval arithmetic
  // cannot know it -- which was inflating the cone in the park by a factor of three.
  const u = e.map(v => v / Math.sqrt(eL2));
  const P = [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) - u[i] * u[j]));
  const w = [0, 1, 2].map(i => add(add(scale(r[0], P[i][0]), scale(r[1], P[i][1])), scale(r[2], P[i][2])));
  const foot = { x: sub(pB.x, w[0]), y: sub(pB.y, w[1]), h: sub(pB.h, w[2]) };
  return { w, foot, t };
}

// ---- one substep's analysis over an axis-aligned box of victim poses (throw-cert.js's) ----
function analyse(box, att, pairWant) {
  const c = { x: (box.x[0] + box.x[1]) / 2, y: (box.y[0] + box.y[1]) / 2, rot: (box.rot[0] + box.rot[1]) / 2 };
  const hx = (box.x[1] - box.x[0]) / 2, hy = (box.y[1] - box.y[0]) / 2, ht = (box.rot[1] - box.rot[0]) / 2;
  const pad = Math.hypot(hx, hy) + 2 * R * Math.sin(Math.min(ht, Math.PI) / 2);
  const A = [0, 1, 2].map(i => arcPts(att, i)), V = [0, 1, 2].map(j => arcPts(c, j));
  const out = { pad, c, hx, hy, ht };
  const pairs = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let best = Infinity; const segs = [];
    for (let a = 0; a < NSEG; a++) for (let b = 0; b < NSEG; b++) { const cc = segClosest3(A[i][a], A[i][a + 1], V[j][b], V[j][b + 1]); segs.push({ a, b, ...cc }); if (cc.dist < best) best = cc.dist; }
    pairs.push({ i, j, dist: best, segs });
  }
  const touchable = pairs.filter(p => p.dist - pad < D);
  const hubA = { x: att.x, y: att.y, h: H }, hubV = { x: c.x, y: c.y, h: H };
  const hubLeg = Math.min(...[0, 1, 2].map(j => pointArcClosest(hubA, V[j]).dist), ...[0, 1, 2].map(i => pointArcClosest(hubV, A[i]).dist));
  const hubHub = Math.hypot(att.x - c.x, att.y - c.y);
  if (hubLeg - pad < HUBLEGD) return { ...out, refuse: `hub-leg contact possible (${hubLeg.toFixed(2)} - pad ${pad.toFixed(2)} < ${HUBLEGD.toFixed(2)})` };
  if (hubHub - pad < 2 * HUBR) return { ...out, refuse: `hub-hub contact possible` };
  if (touchable.length === 0) return { ...out, free: true, minDist: Math.min(...pairs.map(p => p.dist)) - pad };
  if (touchable.length > 1) return { ...out, refuse: `two leg pairs can touch: ${touchable.map(p => `(${p.i},${p.j}) ${p.dist.toFixed(2)}`).join(', ')}` };
  const P = touchable[0];
  if (pairWant && (P.i !== pairWant[0] || P.j !== pairWant[1])) return { ...out, refuse: `touching pair changed to (${P.i},${P.j})` };
  out.pair = [P.i, P.j]; out.distC = P.dist; out.surelyTouching = P.dist + pad < D;
  // LEMMA 1 (contact-point localisation). Over the set, the closest pair of a segment pair moves by
  // a LINEAR multiple of the set's size, not the square root of it. Write F(s,t) = |A(s) - V_q(t)|^2
  // in arclength on the two chords. The chords are straight, so F is a quadratic with the fixed
  // Hessian 2[[1, -c], [-c, 1]], c = cos(crossing angle), whose smallest eigenvalue is mu = 2(1-|c|)
  // -- independent of the pose. Moving the victim's pose inside the set moves each of its leg points
  // by at most delta = pad and turns its tangent by at most the set's rotation span, so the gradient
  // of F changes by at most |g| = hypot(2 delta, 2 delta + 2 (d + delta) drot). If the centre's
  // minimiser is interior to the chord rectangle, its gradient vanishes there, and if the pose's own
  // minimiser is interior too then grad F_c at it equals that perturbation, so with grad F_c affine
  //      mu |Delta| <= |grad F_c(s*, t*)| = |g|   =>   |Delta| <= |g| / mu.
  // Interiority is then checked a posteriori: if the centre's minimiser is further than |Delta| from
  // both ends of both chords, every pose's is in the same chord pair, and the argument closes. That
  // is the whole game: staying inside ONE chord pair makes the contact normal EXACT, because at a
  // minimum the closest-point vector is perpendicular to both chords, so it is parallel to
  // uA x uV with uA fixed and uV turning only by the set's own rotation span. The old sublevel-set
  // localisation left the contact point free over +-0.8u of leg and the normal over a 15 degree fan
  // of neighbouring chords, which is a floor that no shrinking of the box could get under.
  const thr = P.dist + 2 * pad;                     // a pair further than this cannot hold the global minimiser
  const cand = P.segs.filter(s => s.dist <= thr);
  const drot = 2 * ht;
  const lenOf = (p, q) => Math.hypot(q.x - p.x, q.y - p.y, q.h - p.h);
  const unitOf = (p, q) => { const L = lenOf(p, q); return [(q.x - p.x) / L, (q.y - p.y) / L, (q.h - p.h) / L]; };
  // The localisation above holds for a minimiser on the rectangle's BOUNDARY too: the variational
  // inequalities at both minimisers add to  mu |Delta|^2 <= -g . Delta,  so |Delta| <= |g| / mu
  // whether or not the gradient vanishes. What a boundary minimiser costs is the NORMAL: at a chord
  // end the closest-point vector is no longer perpendicular to that chord, so the exact uA x uV
  // formula fails and the fan has to open to the neighbouring chord -- 7.5 degrees, the floor that
  // kept the old checker from closing.
  //
  // Almost every such case is spurious: two chords meeting at a vertex both report a minimiser AT
  // that vertex, and only one of them is a real local minimum of the polyline pair. Discard the
  // other, with a margin, by the one-sided derivative test. The distance from a victim point sliding
  // along its chord has derivative n . uV (n the unit closest-point vector, attacker to victim).
  // So if at the vertex the distance rises into chord b and falls into chord b-1, then -- because
  // the partial minimum over the attacker's chord is convex along a straight chord, so a rising
  // derivative at one end rises along the whole chord -- the minimum over pair (a, b) is exactly its
  // value at the vertex, which chord b-1 strictly beats. Pair (a, b) can then be dropped. The same
  // test with uA and the opposite sign handles a boundary on the attacker's side.
  // NB the degenerate segment goes FIRST: segClosest3 solves for the second segment's parameter from
  // the first, so a point passed as the second argument pair silently returns that chord's start.
  const nhatAt = (P, q0, q1) => { const cc = segClosest3(P, P, q0, q1); const w = [P.x - cc.pb.x, P.y - cc.pb.y, P.h - cc.pb.h], L = Math.hypot(w[0], w[1], w[2]); return { n: w.map(v => v / L), d: L }; };
  const psiA = legAngle(att, P.i), psiV = [legAngle(c, P.j) - ht, legAngle(c, P.j) + ht];
  const cP = cosRange(psiV), sP = sinRange(psiV), psiDiff = sinRange([psiV[0] - psiA, psiV[1] - psiA]);
  // per-candidate geometry and the localisation radius, then the dominance pruning
  const geom = new Map();
  for (const sg of cand) {
    const A0 = A[P.i][sg.a], A1 = A[P.i][sg.a + 1], V0 = V[P.j][sg.b], V1 = V[P.j][sg.b + 1];
    const LA = lenOf(A0, A1), LV = lenOf(V0, V1), uA = unitOf(A0, A1), uV = unitOf(V0, V1);
    const cth = Math.abs(uA[0] * uV[0] + uA[1] * uV[1] + uA[2] * uV[2]), mu = 2 * (1 - cth);
    const gmag = Math.hypot(2 * pad, 2 * pad + 2 * (sg.dist + pad) * drot);
    geom.set(`${sg.a},${sg.b}`, { sg, LA, LV, uA, uV, mu, dmax: mu > 1e-4 ? gmag / mu : Infinity, sA: sg.s * LA, sV: sg.t * LV });
  }
  const has = (a, b) => geom.get(`${a},${b}`);
  const kept = cand.filter(sg => {
    // Margin for the derivative test. The vertex itself and the chord it sits on are KNOWN for each
    // pose (the attacker's exactly, the victim's up to its rigid motion), and the closest point on
    // the other chord moves by at most the same rigid motion plus its slide, so the unit vector
    // between them turns by at most 2 (2 pad + R drot) / dist. The chord-sliding radius dmax does not
    // belong here: it bounds where a MINIMISER can be, not how far the vertex's own normal can turn.
    // pad already carries the set's rotation for a leg point, so it must not be added a second time.
    const G = has(sg.a, sg.b), m = 2 * pad / Math.max(sg.dist, 1e-6) + drot;
    const n = [(sg.pb.x - sg.pa.x) / sg.dist, (sg.pb.y - sg.pa.y) / sg.dist, (sg.pb.h - sg.pa.h) / sg.dist];
    const dotV = n[0] * G.uV[0] + n[1] * G.uV[1] + n[2] * G.uV[2], dotA = n[0] * G.uA[0] + n[1] * G.uA[1] + n[2] * G.uA[2];
    // victim chord: minimiser at its start, distance rising into it, neighbour chord falling
    if (process.env.DBG3) console.log(`      prune? pad ${pad.toFixed(4)} hx ${hx.toFixed(4)} hy ${hy.toFixed(4)} ht ${(ht / DEG).toFixed(4)}deg thr ${thr.toFixed(4)} (${sg.a},${sg.b}) d ${sg.dist.toFixed(4)} dotV ${dotV.toFixed(4)} dotA ${dotA.toFixed(4)} m ${m.toFixed(4)} ends ${[G.sV <= G.dmax, G.LV - G.sV <= G.dmax, G.sA <= G.dmax, G.LA - G.sA <= G.dmax].map(v => v ? 1 : 0).join('')} dmax ${G.dmax.toFixed(3)}`);
    if (G.sV <= G.dmax && sg.b > 0 && has(sg.a, sg.b - 1) && dotV > m) { const nb = has(sg.a, sg.b - 1); const w = nhatAt(V[P.j][sg.b], A[P.i][sg.a], A[P.i][sg.a + 1]); const val = w.n[0] * nb.uV[0] + w.n[1] * nb.uV[1] + w.n[2] * nb.uV[2]; if (process.env.DBG3) console.log(`        startV test (${sg.a},${sg.b}): ${val.toFixed(4)} vs m ${m.toFixed(4)}`); if (val > m) return false; }
    if (G.LV - G.sV <= G.dmax && sg.b < NSEG - 1 && has(sg.a, sg.b + 1) && dotV < -m) { const nb = has(sg.a, sg.b + 1); const w = nhatAt(V[P.j][sg.b + 1], A[P.i][sg.a], A[P.i][sg.a + 1]); if (w.n[0] * nb.uV[0] + w.n[1] * nb.uV[1] + w.n[2] * nb.uV[2] < -m) return false; }
    if (G.sA <= G.dmax && sg.a > 0 && has(sg.a - 1, sg.b) && dotA < -m) { const nb = has(sg.a - 1, sg.b); const w = nhatAt(A[P.i][sg.a], V[P.j][sg.b], V[P.j][sg.b + 1]); if (-(w.n[0] * nb.uA[0] + w.n[1] * nb.uA[1] + w.n[2] * nb.uA[2]) < -m) return false; }
    if (G.LA - G.sA <= G.dmax && sg.a < NSEG - 1 && has(sg.a + 1, sg.b) && dotA > m) { const nb = has(sg.a + 1, sg.b); const w = nhatAt(A[P.i][sg.a + 1], V[P.j][sg.b], V[P.j][sg.b + 1]); const val = -(w.n[0] * nb.uA[0] + w.n[1] * nb.uA[1] + w.n[2] * nb.uA[2]); if (process.env.DBG3) console.log(`        endA test (${sg.a},${sg.b}): n.uA(next) = ${val.toFixed(4)} vs m ${m.toFixed(4)}`); if (val > m) return false; }
    return true;
  });
  // LEMMA 2 (the gap between two chord pairs is far steadier than either distance). A pair is only
  // worth carrying if it can hold the GLOBAL minimum for some pose in the set. Comparing each pair's
  // own distance against the minimum with each one's own Lipschitz slack throws away the fact that
  // the two move together: near a shared vertex their contact points are close, so their gradients
  // -- the closest-point unit vectors (hf n, hf rn) -- nearly coincide, and the gap between the two
  // distances barely moves across the set even though each distance moves a lot. Writing
  //     d_ab(q) - d_min(q) = gap(centre) + integral of (G_ab - G_min) . dq,
  // the pair can be dropped whenever gap(centre) exceeds what the DIFFERENCE of the gradients can
  // accumulate over the set. This is what finally excludes the stale neighbouring chord through a
  // vertex crossing, where each pair's own slack is several times the gap between them.
  const gradOf = sg => { const n3 = [(sg.pb.x - sg.pa.x) / sg.dist, (sg.pb.y - sg.pa.y) / sg.dist, (sg.pb.h - sg.pa.h) / sg.dist];
    return [n3[0], n3[1], -n3[0] * (sg.pb.y - c.y) + n3[1] * (sg.pb.x - c.x)]; };
  const gMin = gradOf(P.segs.reduce((m, x) => (x.dist < m.dist ? x : m)));
  const kept2 = kept.filter(sg => {
    const gap = sg.dist - P.dist; if (gap <= 0) return true;
    const g = gradOf(sg), G = has(sg.a, sg.b);
    // how far each gradient can drift over the set: a position-based bound on the closest-point
    // vector's turn, which also carries the lever arm through the contact point's own excursion
    const eps = 2 * (Math.min(G.dmax, Math.max(G.LA, G.LV)) + pad) / Math.max(sg.dist, 1e-6);
    const e = [eps, eps, (Math.min(G.dmax, Math.max(G.LA, G.LV)) + pad) + R * eps];
    const reach = (Math.abs(g[0] - gMin[0]) + e[0]) * hx + (Math.abs(g[1] - gMin[1]) + e[1]) * hy + (Math.abs(g[2] - gMin[2]) + e[2]) * ht;
    if (process.env.DBG3) console.log(`        gap test (${sg.a},${sg.b}): gap ${gap.toFixed(4)} vs reach ${reach.toFixed(4)} (dG ${[0,1,2].map(i => (g[i] - gMin[i]).toFixed(3)).join(',')})`);
    return gap <= reach;
  });
  let segPairs = [];
  for (const sg of kept2) {
    const A0 = A[P.i][sg.a], A1 = A[P.i][sg.a + 1], V0 = V[P.j][sg.b], V1 = V[P.j][sg.b + 1];
    const LA = lenOf(A0, A1), LV = lenOf(V0, V1), uA = unitOf(A0, A1), uV = unitOf(V0, V1);
    const cth = Math.abs(uA[0] * uV[0] + uA[1] * uV[1] + uA[2] * uV[2]), mu = 2 * (1 - cth);
    if (mu < 1e-4) return { ...out, refuse: `legs nearly parallel on segments (${sg.a},${sg.b})` };
    const gmag = Math.hypot(2 * pad, 2 * pad + 2 * (sg.dist + pad) * drot);
    const dmax = gmag / mu;
    // interiority of the centre's own minimiser, in arclength, with the slack it needs
    const sA = sg.s * LA, sV = sg.t * LV;
    const atStartA = sA <= dmax, atEndA = LA - sA <= dmax, atStartV = sV <= dmax, atEndV = LV - sV <= dmax;

    // IS THE INTERIOR/INTERIOR REGIME REACHABLE AT ALL? Its normal is the one perpendicular to both
    // chord tangents, which is a genuine contact only when some pose in the set has its minimiser in
    // the interior of BOTH chords. During a park no pose does: the minimiser sits on a vertex for the
    // whole dwell. Carrying the interior entry anyway is SOUND -- it only widens the hull -- but it
    // costs several degrees of normal cone on every parked substep, and that cone is what the box
    // grows by each push, so the waste compounds.
    //
    // The drop test is the first-order condition at the clamped endpoint. Write F(s,t) = |A(s)-V(t)|^2
    // with pa = A(s), pb = V(t) and n = (pb-pa)/dist. Then dF/ds = -2 dist (n.uA) and dF/dt = +2 dist
    // (n.uV). If the centre's minimiser is clamped hard at t = 0 then dF/dt >= 0 there; if it is
    // bounded away from zero by more than the drift the derivative can pick up across the set, every
    // pose in the set is clamped at t = 0 too, and no pose has an interior minimiser in t.
    //
    // Drift bound: at a hard clamp pb IS the chord endpoint, a material point of the victim, so it
    // moves by at most pad; the foot on the fixed attacker chord is its projection, and projection
    // onto a fixed segment is 1-Lipschitz, so it moves by at most pad as well. The connecting vector
    // therefore changes by at most 2 pad and turns by at most 2 pad / (dist - 2 pad) -- the SHRUNK
    // distance, since the pair can close over the set. uA and uV turn with the pose by at most drot.
    // Anything short of a strict pass keeps the entry, which is the sound fallback.
    const nHat = [(sg.pb.x - sg.pa.x) / sg.dist, (sg.pb.y - sg.pa.y) / sg.dist, (sg.pb.h - sg.pa.h) / sg.dist];
    const dotVc = nHat[0] * uV[0] + nHat[1] * uV[1] + nHat[2] * uV[2];
    const dotAc = nHat[0] * uA[0] + nHat[1] * uA[1] + nHat[2] * uA[2];
    const mDrift = 2 * pad / Math.max(sg.dist - 2 * pad, 1e-6) + drot;
    const HARD = 1e-12;
    const interiorImpossible =
      (sg.t <= HARD && dotVc > mDrift) || (sg.t >= 1 - HARD && dotVc < -mDrift) ||
      (sg.s <= HARD && dotAc < -mDrift) || (sg.s >= 1 - HARD && dotAc > mDrift);
    if (process.env.DBGI) console.log(`      interior? (${sg.a},${sg.b}) s ${sg.s.toFixed(6)} t ${sg.t.toFixed(6)} dotA ${dotAc.toFixed(4)} dotV ${dotVc.toFixed(4)} mDrift ${mDrift.toFixed(4)} -> ${interiorImpossible ? 'DROP' : 'keep'}`);
    if ((atStartA && atEndA) || (atStartV && atEndV)) return { ...out, refuse: `contact point not localised on segments (${sg.a},${sg.b}) (slack ${dmax.toFixed(3)}u of ${Math.min(LA, LV).toFixed(2)}u)` };
    if ((sg.a === 0 && atStartA) || (sg.b === 0 && atStartV)) return { ...out, refuse: 'closest point may be at a hub end' };
    if ((sg.a === NSEG - 1 && atEndA) || (sg.b === NSEG - 1 && atEndV)) return { ...out, refuse: 'closest point may be at a foot end (the victim could slide off)' };
    // The chord-angle fans are EXACTLY this chord's, never widened: a pose whose closest point lies
    // in the interior of this chord pair has its closest-point vector perpendicular to both chords,
    // full stop. A pose whose closest point sits ON a shared vertex is a different regime, and gets
    // its own entry below rather than being smeared into this one -- widening the fan to the
    // neighbouring chord was worth 7.5 degrees of normal cone and was what re-inflated the set
    // every time the contact crossed a vertex.
    const fanA = [phiMid(sg.a), phiMid(sg.a)], fanV = [phiMid(sg.b), phiMid(sg.b)];
    // the contact points: the centre's, moved by at most dmax along the chord (both legs) and by the
    // rigid motion of the set (the victim's leg only -- the attacker is fixed this substep)
    const aBox = { x: [sg.pa.x - dmax, sg.pa.x + dmax], y: [sg.pa.y - dmax, sg.pa.y + dmax], h: [sg.pa.h - dmax, sg.pa.h + dmax] };
    const vBox = { x: [sg.pb.x - dmax - pad, sg.pb.x + dmax + pad], y: [sg.pb.y - dmax - pad, sg.pb.y + dmax + pad], h: [sg.pb.h - dmax, sg.pb.h + dmax] };
    const cA = cosRange(fanA), sAr = sinRange(fanA), cV = cosRange(fanV), sV2 = sinRange(fanV);
    let d = [
      add(scale(mul(cA, sV2), -Math.sin(psiA)), mul(mul(sAr, cV), sP)),
      add(neg(mul(mul(sAr, cV), cP)), scale(mul(cA, sV2), Math.cos(psiA))),
      mul(mul(cA, cV), psiDiff)];
    const dC = [sg.pb.x - sg.pa.x, sg.pb.y - sg.pa.y, sg.pb.h - sg.pa.h], mid0 = d.map(v => (v[0] + v[1]) / 2);
    if (dC[0] * mid0[0] + dC[1] * mid0[1] + dC[2] * mid0[2] < 0) d = d.map(neg);
    { const m = d.map(v => (v[0] + v[1]) / 2), mn = Math.hypot(...m); let worst = 1; for (const x of d[0]) for (const y of d[1]) for (const z of d[2]) { const cc = (x * m[0] + y * m[1] + z * m[2]) / (Math.hypot(x, y, z) * mn); if (cc < worst) worst = cc; } if (!(worst > Math.SQRT1_2)) return { ...out, refuse: `normal family too wide on segments (${sg.a},${sg.b}) (cos ${worst.toFixed(2)})` }; }
    const hor2 = add(sq(d[0]), sq(d[1]));
    if (hor2[0] <= 1e-9) return { ...out, refuse: 'normal may be vertical' };
    const psiN = angleHull(d[0], d[1]); if (!psiN) return { ...out, refuse: 'horizontal normal cone contains the origin' };
    const tz = divPos(sq(d[2]), hor2), hf = [1 / Math.sqrt(1 + tz[1]), 1 / Math.sqrt(1 + tz[0])];
    const rn = dotCone(neg(sub(vBox.y, box.y)), sub(vBox.x, box.x), psiN);
    // the vertex regime: while the closest point dwells on a shared vertex, the vector to it is not
    // perpendicular to either chord, but the vertex's own position is known exactly from the pose, so
    // the cone follows from the set's size alone (the foot of the perpendicular on the other chord
    // moves by at most the same amount), and is a couple of degrees rather than the wedge's 7.5
    for (const [flag, vp, oth0, oth1, side] of [[atStartV, V0, A0, A1, 'V'], [atEndV, V1, A0, A1, 'V'], [atStartA, A0, V0, V1, 'A'], [atEndA, A1, V0, V1, 'A']]) {
      if (!flag) continue;
      // A dwelling vertex has TWO valid bounds, and which one is tighter depends on the set.
      //
      // Exact: the dwelling vertex is a known material point of its own piece, so over a pose set it
      // traces a computable arc rather than a ball of radius pad, and the foot of the perpendicular
      // on the other chord follows from it. This is what makes a park cheaper than interior contact
      // and it has no floor -- it shrinks with the box all the way down.
      //
      // Blanket: both endpoints move by at most pad, so the vector turns by at most pad / L. Crude,
      // but it never loses the contact, whereas the exact form goes through interval products that
      // widen faster than linearly once the box is large.
      //
      // Take whichever is narrower. Both enclose, so the narrower one is the valid one to carry.
      let exactSP = null;
      {
        let kv = null, vBx = null, ft = null;
        if (side === 'V') { kv = vp === V0 ? sg.b : sg.b + 1; vBx = vertexBoxOf(box, P.j, kv); ft = footOnFixedSeg(vBx, oth0, oth1); }
        else { kv = -1 - (vp === A0 ? sg.a : sg.a + 1); ft = footOnMovingSeg(vp, vertexBoxOf(box, P.j, sg.b), vertexBoxOf(box, P.j, sg.b + 1)); if (ft) vBx = ft.foot; }
        if (ft) {
          const hor2v = add(sq(ft.w[0]), sq(ft.w[1]));
          const psiV = hor2v[0] > 1e-9 ? angleHull(ft.w[0], ft.w[1]) : null;
          if (psiV) {
            const tzv = divPos(sq(ft.w[2]), hor2v), hfv = [1 / Math.sqrt(1 + tzv[1]), 1 / Math.sqrt(1 + tzv[0])];
            exactSP = { a: sg.a, b: sg.b, aBox: side === 'V' ? ft.foot : { x: [vp.x, vp.x], y: [vp.y, vp.y], h: [vp.h, vp.h] }, vBox: vBx,
              psiN: psiV, hf: hfv, fanA, fanV, dmax, cth, vertex: side, exact: true, vk: kv,
              rn: dotCone(neg(sub(vBx.y, box.y)), sub(vBx.x, box.x), psiV),
              why: `(${sg.a},${sg.b}) VERTEX ${side} exact cone ${(wid(psiV) / DEG).toFixed(3)}deg t ${ft.t.map(v => v.toFixed(3))}` };
          }
        }
      }
      const cc2 = segClosest3(vp, vp, oth0, oth1);
      const pA = side === 'V' ? cc2.pb : vp, pV = side === 'V' ? vp : cc2.pb;
      const w = [pV.x - pA.x, pV.y - pA.y, pV.h - pA.h], L = Math.hypot(w[0], w[1], w[2]);
      if (L < 1e-6) return { ...out, refuse: 'degenerate vertex contact' };
      const phi = (side === 'V' ? 2 * pad : pad) / L;
      const hfC = Math.hypot(w[0], w[1]) / L, psiC = Math.atan2(w[1], w[0]);
      let blanketSP = null;
      if (phi < 0.5 && hfC - phi > 0.05) {
        const dpsi = Math.asin(Math.min(0.99, phi / (hfC - phi)));
        const psiN2 = [psiC - dpsi, psiC + dpsi], hf2 = [Math.max(0.01, hfC - phi), Math.min(1, hfC + phi)];
        const aB = { x: [pA.x - pad, pA.x + pad], y: [pA.y - pad, pA.y + pad], h: [pA.h - pad, pA.h + pad] };
        const vB = { x: [pV.x - pad, pV.x + pad], y: [pV.y - pad, pV.y + pad], h: [pV.h - pad, pV.h + pad] };
        blanketSP = { a: sg.a, b: sg.b, aBox: aB, vBox: vB, psiN: psiN2, hf: hf2, fanA, fanV, dmax, cth, vertex: side,
          rn: dotCone(neg(sub(vB.y, box.y)), sub(vB.x, box.x), psiN2),
          why: `(${sg.a},${sg.b}) VERTEX ${side} cone ${(2 * dpsi / DEG).toFixed(2)}deg` };
      }
      const pick = !exactSP ? blanketSP : !blanketSP ? exactSP : (wid(exactSP.psiN) <= wid(blanketSP.psiN) ? exactSP : blanketSP);
      if (!pick) return { ...out, refuse: `vertex cone too wide (${(phi / DEG).toFixed(1)} deg)` };
      segPairs.push(pick);
    }
    // ... and the interior entry itself, once. It used to be pushed twice, identically but for the
    // annotation; the hull is idempotent so the duplicate changed no bound, but it doubled this
    // pair's contribution to the regime and state counts that MAXSTATES caps.
    if (!interiorImpossible) segPairs.push({ a: sg.a, b: sg.b, aBox, vBox, psiN, hf, fanA, fanV, rn, dmax, cth, atStartV, atEndV, why: `(${sg.a},${sg.b}) d ${sg.dist.toFixed(4)} cross ${(Math.acos(cth) / DEG).toFixed(1)}deg mu ${mu.toFixed(3)} dmax ${dmax.toFixed(3)} sA ${sA.toFixed(2)}/${LA.toFixed(2)} sV ${sV.toFixed(2)}/${LV.toFixed(2)} ends ${[atStartA, atEndA, atStartV, atEndV].map(v => (v ? 1 : 0)).join('')} n ${(psiN[0] / DEG).toFixed(2)}..${(psiN[1] / DEG).toFixed(2)}` });
  }
  // A PARK IS ONE REGIME, NOT TWO. While the closest point dwells on the vertex shared by victim
  // chords k-1 and k, both chord pairs report their minimiser AT that vertex: the same physical
  // contact, listed twice. Left alone they become two regimes that each branch again next substep,
  // and the count doubles every step of the dwell. The exact vertex entry already describes that
  // contact with no interval at all, so drop the two plain entries whose minimiser is clamped there.
  // The stale-neighbour test cannot do this job: it discriminates by which side the distance falls
  // on, and during a dwell neither side falls.
  { const seenV = new Set(); segPairs = segPairs.filter(sp => { if (!sp.exact) return true; const key = `${sp.a}|${sp.vk}`; if (seenV.has(key)) return false; seenV.add(key); return true; }); }
  const parked = segPairs.filter(sp => sp.exact && sp.vertex === 'V');
  const keptSP = parked.length === 0 ? segPairs : segPairs.filter(sp =>
    sp.exact || !parked.some(pk => pk.a === sp.a && ((sp.b === pk.vk && sp.atStartV) || (sp.b === pk.vk - 1 && sp.atEndV))));
  out.segPairs = keptSP.length ? keptSP : segPairs;
  segPairs = out.segPairs;
  // hulls over the candidate segment pairs: the normal cone (as an angle interval and as a vector
  // box), hf, rn, and the gradient of the pair's distance function (hf n, hf rn)
  let psiN = segPairs[0].psiN, hf = segPairs[0].hf, rn = segPairs[0].rn;
  for (const sp of segPairs) { psiN = [Math.min(psiN[0], sp.psiN[0]), Math.max(psiN[1], sp.psiN[1])]; hf = hull(hf, sp.hf); rn = hull(rn, sp.rn); }
  const nx = cosRange(psiN), ny = sinRange(psiN);
  out.psiN = psiN; out.hf = hf; out.rn = rn; out.n = [nx, ny];
  out.cbar = Math.max(...segPairs.map(s => s.cth || 0));          // worst |cos(crossing angle)|
  out.clamping = segPairs.some(s => s.vertex);                     // an endpoint may be active
  out.aMin = hf[0] * Math.sqrt(1 + (rn[0] <= 0 && rn[1] >= 0 ? 0 : Math.min(rn[0] * rn[0], rn[1] * rn[1])) / I);
  out.G = [mul(hf, nx), mul(hf, ny), mul(hf, rn)];
  return out;
}
const hullAn = (p, q) => { const psiN = [Math.min(p.psiN[0], q.psiN[0]), Math.max(p.psiN[1], q.psiN[1])], hf = hull(p.hf, q.hf), rn = hull(p.rn, q.rn), nx = cosRange(psiN), ny = sinRange(psiN);
  return { psiN, hf, rn, n: [nx, ny], G: [mul(hf, nx), mul(hf, ny), mul(hf, rn)], cth: Math.max(p.cth || 0, q.cth || 0), cbar: Math.max(p.cbar || p.cth || 0, q.cbar || q.cth || 0), clamping: !!(p.clamping || q.clamping || p.vertex || q.vertex) }; };
// the pair's distance function and closest pair at one pose
function pairDist(att, q, pair) {
  const A = arcPts(att, pair[0]), V = arcPts(q, pair[1]); let best = null;
  for (let a = 0; a < NSEG; a++) for (let b = 0; b < NSEG; b++) { const cc = segClosest3(A[a], A[a + 1], V[b], V[b + 1]); if (!best || cc.dist < best.dist) best = { ...cc, a, b }; }
  const nx3 = (best.pb.x - best.pa.x) / best.dist, ny3 = (best.pb.y - best.pa.y) / best.dist, hf = Math.hypot(nx3, ny3), nx = nx3 / hf, ny = ny3 / hf;
  const rn = (best.pb.x - q.x) * ny - (best.pb.y - q.y) * nx;
  return { dist: best.dist, nx, ny, hf, rn, pa: best.pa, pb: best.pb };
}

// Merge coefficient boxes that have come back together, and cap how many are carried. Two regimes
// are worth keeping apart only while they are actually apart: once their boxes overlap enough that
// the hull is barely bigger than either, the split is costing bookkeeping and buying nothing. Over
// the cap, merge the closest pair repeatedly -- merging is always sound, it only loosens.
const MAXSTATES = 12;
function mergeStates(list, M) {
  const hullOf = (a, b) => [0, 1, 2].map(r => hull(a[r], b[r]));
  // cost by WIDTH, per axis, not by volume: these boxes are thin, so a volume ratio is dominated by
  // whichever axis happens to be thinnest and reads two clearly separated regimes as cheap to merge.
  const costOf = (a, b, h) => Math.max(...[0, 1, 2].map(r => wid(h[r]) / Math.max(wid(a[r]), wid(b[r]), 1e-12)));
  let out = list.slice();
  for (let pass = 0; pass < 64; pass++) {
    let best = null;
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const h = hullOf(out[i], out[j]), cost = costOf(out[i], out[j], h);
      if (!best || cost < best.cost) best = { i, j, h, cost };
    }
    if (!best) break;
    if (best.cost > 1.15 && out.length <= MAXSTATES) break;
    out = out.filter((_, x) => x !== best.i && x !== best.j).concat([best.h]);
  }
  return out;
}

// ---- the certificate ----
function certify(pieces, attacker, pv, dir, box0, jF, opts) {
  opts = opts || {}; const log = opts.log || (() => {}), victim = 1 - attacker;
  const lim = FW.limitAt(pieces, attacker, pv, dir).lim, K = Math.round(lim / LIM_SUB);
  const c0 = { x: (box0.x[0] + box0.x[1]) / 2, y: (box0.y[0] + box0.y[1]) / 2, rot: (box0.rot[0] + box0.rot[1]) / 2 };
  const pcs = pieces.map((p, i) => (i === victim ? c0 : { ...p }));
  const traj = sweep(pcs, attacker, pv, dir, K);
  log(`throw arm (${pv},${dir}) limit ${(lim / DEG).toFixed(2)} deg = ${K} substeps of ${(LIM_SUB / DEG).toFixed(4)} deg; centre thrown ${traj.findIndex(t => t.maxFootR > EDGE) + 1 || 'never'}`);
  // the parallelotope: centre q_c (the centre trajectory), columns M, coefficient box U
  let qc = c0, M = colsOf([(box0.x[1] - box0.x[0]) / 2, 0, 0], [0, (box0.y[1] - box0.y[0]) / 2, 0], [0, 0, (box0.rot[1] - box0.rot[0]) / 2]);
  // The enclosure is a LIST of coefficient boxes, all in the same (q_c, M) frame. One box per live
  // contact regime, because hulling the regimes into a single box at the end of every substep is
  // what a chord-vertex event costs: at the crowded one, three regimes go live at once and the hull
  // is three times either of them, which then admits more chords. Kept apart they each stay thin,
  // and a regime that no pose can be in proves itself empty and is dropped.
  let Us = [[[-1, 1], [-1, 1], [-1, 1]]], pair = null;
  const rows = [], fail = (why, k) => ({ certified: false, traj, pair, why: `substep ${k} (${(k * LIM_SUB / DEG).toFixed(2)} deg): ${why}`, k, rows, K });
  for (let k = 1; k <= K; k++) {
    const t = traj[k - 1], att = t.att, qcNext = t.pose;
    if (t.flags.hub || t.flags.deep || t.flags.cap || t.flags.hfFloor) return fail(`the centre's own push used a hub contact / deep rule / cap / hf floor`, k);
    // the shell argument needs the solver to have STOPPED because nothing was under D, not because
    // it ran out of passes: at the cap the post-push distance is not bounded below by D at all
    if (t.pushes.length && t.flags.iters >= REPLICA.iters) return fail(`the solver used all ${REPLICA.iters} passes, so the contact shell's lower edge is not established`, k);
    // the aabb of the whole enclosure, for pair discovery and the free / no-touch tests
    const bbAll = Us.map(U => aabbOf(qc, M, U)).reduce((a, b) => ({ x: hull(a.x, b.x), y: hull(a.y, b.y), rot: hull(a.rot, b.rot) }));
    const preAll = analyse(bbAll, att, pair);
    if (preAll.refuse) return fail(preAll.refuse, k);
    if (preAll.free) { if (t.pushes.length) return fail('centre pushed while the box was declared free (bug)', k); rows.push({ k, free: true }); continue; }
    if (!pair) { pair = preAll.pair; log(`  first possible contact at substep ${k} (${(k * LIM_SUB / DEG).toFixed(2)} deg): legs (${pair[0]},${pair[1]}), centre distance ${preAll.distC.toFixed(3)}, pad ${preAll.pad.toFixed(3)}`); }
    // the centre's pre-push contact: the push direction a_c and the constraint gradient G_c
    const cc = pairDist(att, qc, pair);
    const a_c = [cc.nx, cc.ny, cc.rn / I], G_c = [cc.hf * cc.nx, cc.hf * cc.ny, cc.hf * cc.rn];
    // Rebase onto a basis built from the contact itself: t1 the tangential slide, t2 the spin-led
    // tangent, a_c the push. All three are orthogonal in the foot-displacement metric (x, y, R rot)
    // except a small t2 . a_c term, so the basis is well conditioned -- projecting the PREVIOUS
    // columns instead leaves the rot direction reachable only through a_c, and then a 0.005u wobble
    // costs 0.03u of the first column. That skew, not the physics, is what blew the old checker up.
    {
      const kap = (cc.hf * cc.rn) / dot3(G_c, a_c);
      const t1 = [-cc.ny, cc.nx, 0];
      let t2 = [-a_c[0] * kap, -a_c[1] * kap, 1 - a_c[2] * kap];
      const n2 = Math.hypot(t2[0], t2[1], t2[2] * R); t2 = t2.map(v => v / n2);
      const Mn = colsOf(t1, t2, a_c), T = matMul(matInv(Mn), M);
      Us = Us.map(U => [0, 1, 2].map(r => add(add(scale(U[0], T[r][0]), scale(U[1], T[r][1])), scale(U[2], T[r][2]))));
      M = Mn;
    }
    // the centre's push decomposed: Lambda_c a_c + v_c, over all its solver iterations
    for (const p of t.pushes) if (p.kind !== 'leg' || p.i !== pair[0] || p.j !== pair[1]) return fail(`the centre's push touched ${p.kind} (${p.i},${p.j})`, k);
    const LamC = t.pushes.reduce((s2, p) => s2 + p.lambda, 0);
    const vC = [0, 0, 0]; for (const p of t.pushes) { vC[0] += p.lambda * (p.nx - a_c[0]); vC[1] += p.lambda * (p.ny - a_c[1]); vC[2] += p.lambda * (p.rn / I - a_c[2]); }
    const qcPush = [qcNext.x - qc.x, qcNext.y - qc.y, qcNext.rot - qc.rot];
    for (let r = 0; r < 3; r++) if (Math.abs(qcPush[r] - LamC * a_c[r] - vC[r]) > 1e-9) return fail('centre push decomposition off (bug)', k);
    const fc = pairDist(att, qcNext, pair).dist;
    const m1 = col(M, 0), m2 = col(M, 1), Mi = matInv(M);
    const Gdot = (A, w) => add(add(mul(A.G[0], [w[0], w[0]]), mul(A.G[1], [w[1], w[1]])), mul(A.G[2], [w[2], w[2]]));
    const GdotA = A => mul(A.hf, add(cosRange([-wid(A.psiN), wid(A.psiN)]), scale(mul(A.rn, A.rn), 1 / I)));
    // poses that receive no push at all keep their absolute positions, so relative to the centre --
    // which did move -- their coefficients shift by -M^-1 (centre push)
    const noPush = matVec(Mi, qcPush.map(v => -v));
    const nextUs = [];
    let rounds = 0, coneWide = 0, post = null, fPreAny = null, ngroups = 0;

    for (const U of Us) {
      const pre = analyse(aabbOf(qc, M, U), att, pair);
      if (pre.refuse) return fail(pre.refuse, k);
      // this regime's poses cannot touch this substep: they take no push
      if (pre.free) { nextUs.push([0, 1, 2].map(r => add(U[r], [noPush[r], noPush[r]]))); continue; }
      // pre-push distance over the set, by the mean-value form around the centre
      const dev = matVecIv(M, U);
      const fPre = add([cc.dist, cc.dist], add(add(mul(pre.G[0], dev[0]), mul(pre.G[1], dev[1])), mul(pre.G[2], dev[2])));
      fPreAny = fPreAny ? hull(fPreAny, fPre) : fPre;
      if (fPre[0] >= D) { nextUs.push([0, 1, 2].map(r => add(U[r], [noPush[r], noPush[r]]))); continue; }
      const fHi = fPre[1];
      // BRANCH ON THE CONTACT REGIME. When the contact point crosses a chord vertex, two chords are
      // both live and their exact normals differ by the polyline's turn, about 7.5 degrees. Hulling
      // those two into one cone before the push is what made every crossing run away: the push then
      // gets 7.5 degrees of slack, the set widens, a wider set admits more chords, and round it goes.
      // No pose has both normals, so carry the regimes SEPARATELY -- each with its own exact,
      // hair-thin cone -- and now keep them apart ACROSS substeps too rather than hulling at the end.
      // A regime is a CHORD PAIR, not a band of normal azimuths. Grouping by azimuth was wrong twice
      // over: single-linkage on the midpoints chains two regimes together through anything sitting
      // between them, and after the push the bands have moved, so an azimuth window picks up the
      // neighbouring regime's pairs and the cone grows every round until it is thirty degrees wide.
      // Keyed on (attacker chord, victim chord, which endpoint dwells) each regime keeps the exact,
      // hair-thin cone that Lemma 2 gives it.
      const groups = [];
      for (const sp of pre.segPairs) {
        const g = groups.find(gr => Math.abs(gr.seed - (sp.psiN[0] + sp.psiN[1]) / 2) < 1.5 * DEG);
        if (g) { g.psiN = [Math.min(g.psiN[0], sp.psiN[0]), Math.max(g.psiN[1], sp.psiN[1])]; g.rn = hull(g.rn, sp.rn); g.hf = hull(g.hf, sp.hf); }
        else groups.push({ psiN: sp.psiN.slice(), rn: sp.rn.slice(), hf: sp.hf.slice(), seed: (sp.psiN[0] + sp.psiN[1]) / 2 });
      }
      for (const g of groups) { g.n = [cosRange(g.psiN), sinRange(g.psiN)]; g.G = [mul(g.hf, g.n[0]), mul(g.hf, g.n[1]), mul(g.hf, g.rn)]; }
      ngroups += groups.length;
      const pen = Math.max(0, D - fPre[0]);          // the deepest penetration entering this substep
      const M0 = hessBound(pre.cbar, D, pre.clamping, fPre[0]);
      let ETA = etaOf(M0, pen, pre.aMin), target = [D - EPS_LO, Math.max(D + ETA, fHi)];
      let Un = null, U3 = null, Lam = null;
      // Lambda's range BEFORE the pin. Upper: the pair's distance rises through the pushes and stops
      // at D + eta, so Lambda min(G.a) <= D + eta - fPre_lo. Lower, and this one matters as much: a
      // pose whose pre-push distance is already below D must be pushed until it is not, so when the
      // WHOLE set is under D, Lambda max(G.a) >= D - fPre_hi. Without that floor Lambda starts at 0
      // and the set is handed a spurious 0.06u of slack along the push direction on every substep.
      const Lam0 = (() => { const g0 = GdotA(pre), gHi = g0[1] > 0 ? g0[1] : 1;
        const hi = g0[0] > 0 ? Math.max(0, D + ETA - fPre[0]) / g0[0] : Math.max(0, D + ETA - fPre[0]) / Math.max(pre.hf[0], 0.35);
        return [fPre[1] < D ? Math.max(0, (D - EPS_LO - fPre[1]) / gHi) : 0, hi]; })();
      for (const grp of groups) {
        let cone = grp; Lam = Lam0.slice(); ETA = etaOf(M0, pen, pre.aMin); target = [D - EPS_LO, Math.max(D + ETA, fHi)];
        let inflated = false, empty = false;
        for (let round = 1; round <= 32; round++) {
          rounds = Math.max(rounds, round);
          const da = [sub(cone.n[0], [a_c[0], a_c[0]]), sub(cone.n[1], [a_c[1], a_c[1]]), scale(sub(cone.rn, [cc.rn, cc.rn]), 1 / I)];
          const w = da.map((d, r) => sub(mul(Lam, d), [vC[r], vC[r]]));
          const cw = matVecIv(Mi, w);
          Un = [add(U[0], cw[0]), add(U[1], cw[1]), add(add(U[2], cw[2]), sub(Lam, [LamC, LamC]))];
          post = analyse(aabbOf(qcNext, M, Un), att, pair);
          if (post.refuse) return fail(`after the push: ${post.refuse}`, k);
          if (post.free) return fail('post-push set declared free (bug)', k);
          // pin u3 by the post-push contact constraint (mean value along the segment from the centre,
          // which stays inside the post set, so post's own gradient bound applies). The pin uses the
          // WHOLE post set's gradient, not this regime's: a pose may change regime across the push.
          const Ga = Gdot(post, a_c);
          const alpha = Ga[0] > 0 ? divPos(sub(sub(sub(target, [fc, fc]), mul(Gdot(post, m1), Un[0])), mul(Gdot(post, m2), Un[1])), Ga) : [-Infinity, Infinity];
          const U3n = isect(alpha, Un[2]);
          // An empty range is a PROOF that no pose is in this regime: both sides are necessary
          // conditions on a pose that is. Drop the regime rather than failing the certificate.
          if (U3n[0] > U3n[1] + 1e-12) { empty = true; break; }
          const LamN = isect(add([LamC, LamC], sub(sub(U3n, U[2]), cw[2])), Lam);
          if (LamN[0] > LamN[1] + 1e-12) { empty = true; break; }
          ETA = etaOf(hessBound(Math.max(pre.cbar, post.cbar), D, pre.clamping || post.clamping, fPre[0]), pen, Math.min(pre.aMin, post.aMin));
          target = [D - EPS_LO, Math.max(D + ETA, fHi)];
          // this regime's own post cone: the pairs of the post analysis that belong to it, hulled
          // with the regime's pre cone. Hulling with the PRE set only (never with earlier rounds)
          // lets the cone shrink as Lambda tightens instead of locking in one wide early estimate.
          // This regime's own post pairs. Nearest-regime, not a fixed azimuth window: a window is an
          // absolute width and the regimes are not absolutely spaced, so an 8-degree one swallowed
          // the neighbour whenever it sat closer than that and the cone grew every round. But when
          // this is the ONLY live regime there is no neighbour to be nearer to, and the window is
          // what keeps a post pair from some unrelated part of the leg out, so keep both tests.
          let pc = null;
          for (const sp of post.segPairs) {
            const mid = (sp.psiN[0] + sp.psiN[1]) / 2;
            if (Math.abs(mid - grp.seed) >= 8 * DEG) continue;
            let owner = 0, bestd = Infinity;
            for (let gi = 0; gi < groups.length; gi++) { const d2 = Math.abs(mid - groups[gi].seed); if (d2 < bestd) { bestd = d2; owner = gi; } }
            if (groups[owner] === grp) pc = pc ? hullAn(pc, sp) : sp;
          }
          const coneN = pc ? hullAn(grp, pc) : hullAn(grp, post);
          const grew = coneN.psiN[0] < cone.psiN[0] - 1e-9 || coneN.psiN[1] > cone.psiN[1] + 1e-9 || coneN.rn[0] < cone.rn[0] - 1e-7 || coneN.rn[1] > cone.rn[1] + 1e-7 || coneN.hf[0] < cone.hf[0] - 1e-9 || coneN.hf[1] > cone.hf[1] + 1e-9;
          const shrank = LamN[1] < Lam[1] - 1e-9 || LamN[0] > Lam[0] + 1e-9;
          U3 = U3n; Lam = [Math.max(0, LamN[0]), LamN[1]];
          // settled: this round's post set is enclosed by what the round assumed, so the enclosure
          // is self-consistent and therefore valid for the true image
          if (!grew && !shrank) { cone = coneN; break; }
          // Still creeping after eight rounds, and creeping by less each time: offer the containment
          // test a fattened candidate once, then go on iterating from it. If a later round comes back
          // contained, that round's own check is what certifies it -- the inflation only proposes.
          if (round >= 8 && !inflated) { cone = inflateCone(coneN, 0.25); inflated = true; continue; }
          cone = coneN;
          if (round === 32) return fail('the push cone did not settle', k);
        }
        if (empty) continue;
        coneWide = Math.max(coneWide, wid(cone.psiN));
        nextUs.push([Un[0], Un[1], U3]);
      }
    }
    if (!nextUs.length) return fail('every regime proved empty, so the centre is in none of them (bug)', k);
    const fPre = fPreAny || [cc.dist, cc.dist];
    // Merge regimes that have come back together, and cap the count. Two boxes merge when their hull
    // is no bigger than a shade over their union would have to be anyway, which is the case as soon
    // as the regimes stop being distinct; over the cap, merge the closest pair repeatedly.
    Us = mergeStates(nextUs, M);
    qc = qcNext;
    if (process.env.DBG2 && post) for (const sp of post.segPairs) console.log(`      k${k} ${sp.why}`);
    if (process.env.DBG) console.log(`   dbg k${k} rounds ${rounds} states ${Us.length} (from ${nextUs.length}, ${ngroups} groups) fPre[${fPre.map(v => v.toFixed(4))}] cone ${(coneWide / DEG).toFixed(2)}deg pad ${post ? post.pad.toFixed(3) : '-'}`);
    // sanity: the centre (u = 0) is inside at least one of them
    if (!Us.some(U => U[0][0] <= 1e-9 && U[0][1] >= -1e-9 && U[1][0] <= 1e-9 && U[1][1] >= -1e-9 && U[2][0] <= 1e-9 && U[2][1] >= -1e-9)) return fail(`centre left every set (bug)`, k);
    const U = Us.reduce((a, b) => [0, 1, 2].map(r => hull(a[r], b[r])));   // for reporting only
    const bb = aabbOf(qc, M, U);
    rows.push({ k, deg: +(k * LIM_SUB / DEG).toFixed(2), pad: +post.pad.toFixed(3), psiN: post.psiN.map(v => +(v / DEG).toFixed(2)), hf: post.hf.map(v => +v.toFixed(3)), rn: post.rn.map(v => +v.toFixed(2)), fPre: fPre.map(v => +v.toFixed(4)), LamC: +LamC.toFixed(4), U: U.map(u => u.map(v => +v.toFixed(5))), Mlen: [0, 1, 2].map(j => +Math.hypot(M[0][j], M[1][j], M[2][j] * R).toFixed(3)), box: { x: bb.x.map(v => +v.toFixed(3)), y: bb.y.map(v => +v.toFixed(3)), rot: bb.rot.map(v => +(v / DEG).toFixed(3)) }, bbRaw: bb, footR: +t.maxFootR.toFixed(3), segs: post.segPairs.map(s => `${s.a},${s.b}`).join(' ') });
  }
  // the exposed foot's radius over the final set: F = hub + R e(rot + jF 120deg), linear in u up to
  // R (drot)^2 / 2, bounded below by its projection on the centre foot's direction
  const th = qc.rot + jF * 2 * Math.PI / 3, Fc = { x: qc.x + R * Math.cos(th), y: qc.y + R * Math.sin(th) }, rc = Math.hypot(Fc.x, Fc.y), fx = Fc.x / rc, fy = Fc.y / rc;
  // every regime must clear the rim, so the bound is the WORST of them
  const minROf = U => { let mR = rc, drot = 0;
    for (let j = 0; j < 3; j++) { const m = col(M, j), coef = (m[0] - R * Math.sin(th) * m[2]) * fx + (m[1] + R * Math.cos(th) * m[2]) * fy; mR += Math.min(coef * U[j][0], coef * U[j][1]); drot += Math.abs(m[2]) * Math.max(Math.abs(U[j][0]), Math.abs(U[j][1])); }
    return mR - R * drot * drot / 2; };
  const minR = Math.min(...Us.map(minROf));
  const U = Us.reduce((a, b) => [0, 1, 2].map(r => hull(a[r], b[r])));
  const bb = aabbOf(qc, M, U);
  log(`  final set: x[${bb.x.map(v => v.toFixed(3))}] y[${bb.y.map(v => v.toFixed(3))}] rot[${bb.rot.map(v => (v / DEG).toFixed(3))}] deg; foot ${jF} radius >= ${minR.toFixed(3)}u (centre ${rc.toFixed(3)}), rim ${EDGE}`);
  const certified = minR > EDGE;
  return { certified, why: certified ? null : `final foot radius bound ${minR.toFixed(3)} <= ${EDGE}`, k: K, K, rows, minR, rc, final: { qc, M, U }, pair, traj };
}

module.exports = { certify, analyse, sweep, pushSubstep, LIM_SUB };

if (require.main === module) {
  // POSE=x,y,rot,x,y,rot node nn/throw-cert.js attacker pv dir jF hx hy hRotDeg [--validate N] [--rows] [--engine]
  const args = process.argv.slice(2), pose = process.env.POSE.split(',').map(Number), attacker = +args[0], pv = +args[1], dir = +args[2], jF = +args[3];
  const hx = +args[4], hy = +args[5], hr = +args[6] * DEG;
  const pieces = FW.piecesOf(pose), victim = 1 - attacker, v = pieces[victim];
  const box0 = { x: [v.x - hx, v.x + hx], y: [v.y - hy, v.y + hy], rot: [v.rot - hr, v.rot + hr] };
  const t0 = Date.now();
  const res = certify(pieces, attacker, pv, dir, box0, jF, { log: console.log });
  console.log(`${res.certified ? 'CERTIFIED' : 'REFUSED'}: ${res.why || `every pose thrown by ${(res.K * LIM_SUB / DEG).toFixed(2)} deg`}   (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (args.includes('--rows')) for (const r of res.rows) console.log(r.free ? `  k${r.k} free` : r.noTouch ? `  k${r.k} no pose touches, f[${r.fPre}]` : `  k${r.k} ${r.deg}deg pad ${r.pad} n[${r.psiN}] hf[${r.hf}] rn[${r.rn}] f[${r.fPre}] LamC ${r.LamC} U ${JSON.stringify(r.U)} |m| ${r.Mlen} box x[${r.box.x}] y[${r.box.y}] rot[${r.box.rot}] footR ${r.footR} segs ${r.segs}`);
  if (args.includes('--engine')) {
    // the sweep against the engine itself, a degree at a time, on the centre pose
    const g = FW.load(pieces, attacker); eng.pinFoot(pv); let guard = 0;
    while (!g.atLimit && guard++ < 400) eng.applySwing(dir * Math.PI / 180);
    const e = g.pieces[victim], t = res.traj[res.traj.length - 1].pose;
    console.log(`engine check: victim after the swing ${e.x.toFixed(6)},${e.y.toFixed(6)},${e.rot.toFixed(6)} vs replica ${t.x.toFixed(6)},${t.y.toFixed(6)},${t.rot.toFixed(6)}; engine netRad ${(Math.abs(g.netRad) / DEG).toFixed(3)} deg, thrown ${g.pieces[victim].feet().some(f => Math.hypot(f.x, f.y) > EDGE)}`);
  }
  if (args.includes('--validate')) {
    const N = +args[args.indexOf('--validate') + 1] || 50; let viol = 0, valid = 0, thrown = 0, worstR = Infinity, maxOver = 0, minPost = Infinity;
    const byK = new Map(res.rows.map(r => [r.k, r]));
    for (let tI = 0; tI < N; tI++) {
      const q = { x: box0.x[0] + Math.random() * 2 * hx, y: box0.y[0] + Math.random() * 2 * hy, rot: box0.rot[0] + Math.random() * 2 * hr };
      const ps = pieces.map((p, i) => i === victim ? q : p);
      if (CL.minGapOf(ps[attacker], q) < D) continue; valid++;
      const tr = sweep(ps, attacker, pv, dir, res.K);
      // containment at every substep the certificate reached (the rows hold U, M only implicitly: rebuild by re-running)
      // -> re-run certify's bookkeeping is heavy; instead check the axis-aligned boxes of the rows and the final parallelotope
      for (const t of tr) {
        const r = byK.get(t.k); if (!r || r.free || r.noTouch) continue;
        // NB against bbRaw, not the row's display box: that one is rounded to 1e-3 for printing, which
        // at a +-0.001u starting box is the same size as the box itself and reports phantom misses
        const p = t.pose, bb = r.bbRaw;
        const over = Math.max(bb.x[0] - p.x, p.x - bb.x[1], bb.y[0] - p.y, p.y - bb.y[1], (bb.rot[0] - p.rot) * R, (p.rot - bb.rot[1]) * R);
        if (over > 1e-6) { viol++; if (viol <= 8) console.log(`  VIOLATION pose ${tI} k${t.k}: [${p.x.toFixed(6)},${p.y.toFixed(6)},${(p.rot / DEG).toFixed(5)}] outside x[${bb.x}] y[${bb.y}] rot[${bb.rot.map(v => v / DEG)}] by ${over.toExponential(2)}u`); }
        if (t.pushes.length) { const pd = pairDist(t.att, t.pose, res.pair); if (pd.dist > D + maxOver) maxOver = pd.dist - D; if (pd.dist < minPost) minPost = pd.dist; }
      }
      if (res.final) {
        const last = tr[tr.length - 1].pose, { qc, M, U } = res.final, u = matVec(matInv(M), [last.x - qc.x, last.y - qc.y, last.rot - qc.rot]);
        for (let j = 0; j < 3; j++) if (u[j] < U[j][0] - 1e-6 || u[j] > U[j][1] + 1e-6) { viol++; if (viol <= 8) console.log(`  VIOLATION pose ${tI} final: u${j} = ${u[j].toFixed(5)} outside [${U[j]}]`); }
        const rF = Math.hypot(...(() => { const f = feetOf(last)[jF]; return [f.x, f.y]; })());
        if (rF < worstR) worstR = rF;
        if (rF < res.minR - 1e-6) { viol++; if (viol <= 8) console.log(`  VIOLATION pose ${tI}: final foot radius ${rF.toFixed(4)} < bound ${res.minR.toFixed(4)}`); }
      }
      if (tr.some(t => t.maxFootR > EDGE)) thrown++;
    }
    console.log(`validate: ${valid} poses, ${thrown} thrown by the replica, ${viol} violations; final foot radius min ${worstR.toFixed(3)} (bound ${res.minR ? res.minR.toFixed(3) : '-'}); post-push pair distance in [${minPost.toFixed(5)}, ${(D + maxOver).toFixed(5)}] (D ${D})`);
  }
}
