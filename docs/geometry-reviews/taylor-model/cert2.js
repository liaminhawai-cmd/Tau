// Taylor-model certificate for one blue stop-angle interval on ANY blue arm of the Brief 6 seed,
// including arms whose reply pushes red. Two phases, both through push-tm.js:
//
//   A. blue's reply: blue is kinematic and plays the engine planner's call schedule (full 3-degree
//      calls of 8 substeps of 0.375 degrees, then one partial call of ceil(r/0.4) equal substeps);
//      red is the free body and starts at the seed. The pusher's pose at each substep is an interval.
//   B. red's reply: red (pivot foot 0, direction -1) starts from its pushed pose, a Taylor model, and
//      swings 123 substeps of 0.375 degrees; blue, rotated exactly by the stop angle, is the free body.
//      The pusher's pose at each substep is the interval range of red's path.
//
// Both pushers are Taylor models in the cell's angle where they depend on it (blue's partial-call
// poses in A, red's whole path in B), so a push that leaves the gap at exactly zero is seen to do so.
// Red's pose enters B with its noise symbols collapsed into the interval remainder.
//
//   node cert2.js <bluePivot> <blueDir> <a0deg> <a1deg> [degree]   (env BRANCH=1: separate branches)
'use strict';
const iv = require('./iv.js');
const { TM, setDegree } = require('./tm.js');
const P = require('./push-tm.js');
const { opCount } = require('./tm.js');

const R = P.footR, TWO_PI_3 = P.TWO_PI_3;
const SEED = { blue: { x: -27.3934, y: -36.4088, rot: 1.2052 }, red: { x: -11.7593, y: -23.2838, rot: 2.9442 } };
// the engine's constants, as binary64 values, in the engine's own evaluation order
const STEP3 = 3 * Math.PI / 180;            // AI_STEP_RAD
const STEP_MAX = 0.4 * Math.PI / 180;       // CFG.substepDeg * Math.PI / 180
const DELTA = STEP3 / 8;                    // a full call is ceil(STEP3 / STEP_MAX) = 8 substeps, exact division
const K_RED = 123;                          // red's swing: 123 substeps of DELTA (46.125 degrees)
const EDGE = iv.add([66.667, 66.667], [0.5, 0.5]);
const DEG = iv.div([Math.PI, Math.PI], [180, 180]);

// seed rotated about its foot `pivotIdx` by the signed interval angle `ang`
function rotPose(seed, pivotIdx, ang) {
  const phi = iv.add([seed.rot, seed.rot], iv.mul([pivotIdx, pivotIdx], TWO_PI_3));
  const ex = iv.mul(iv.cos(phi), [R, R]), ey = iv.mul(iv.sin(phi), [R, R]);
  const c = iv.cos(ang), s = iv.sin(ang), omc = iv.sub([1, 1], c);
  return {
    x: iv.add([seed.x, seed.x], iv.add(iv.mul(ex, omc), iv.mul(ey, s))),
    y: iv.add([seed.y, seed.y], iv.sub(iv.mul(ey, omc), iv.mul(ex, s))),
    rot: iv.add([seed.rot, seed.rot], ang),
  };
}

// the same rotation with the angle a Taylor model
function rotPoseTM(seed, pivotIdx, ang) {
  const phi = iv.add([seed.rot, seed.rot], iv.mul([pivotIdx, pivotIdx], TWO_PI_3));
  const ex = iv.mul(iv.cos(phi), [R, R]), ey = iv.mul(iv.sin(phi), [R, R]);
  const c = ang.cos(), sn = ang.sin(), omc = c.neg().addC(1);
  return {
    x: omc.scaleI(ex).add(sn.scaleI(ey)).addI([seed.x, seed.x]),
    y: omc.scaleI(ey).add(sn.scaleI(iv.neg(ex))).addI([seed.y, seed.y]),
    rot: ang.addC(seed.rot),
  };
}
// a Taylor model with its noise symbols folded into the interval remainder
function collapse(m) {
  const c = m.clone(), S = m.symMag();
  c.s = new Map(); c.widen(S);
  return c;
}

// every (j, m) the engine's call schedule can follow for some alpha in the cell: j full calls, then
// one partial call of m equal substeps. Returns [{ j, m, angles: [interval, ...] }] (total angle
// after each blue substep, in radians)
function regimes(a0, a1) {
  const A = iv.mul([a0, a1], DEG);
  const out = [];
  for (let j = 0; j <= Math.floor(A[1] / STEP3) + 1; j++) {
    const r = iv.sub(A, iv.mul([j, j], [STEP3, STEP3]));
    if (r[1] <= 0 || r[0] > STEP3 * (1 + 1e-12)) continue;
    const rlo = Math.max(r[0], 1e-300), rhi = Math.min(r[1], STEP3);
    const mLo = Math.max(1, Math.ceil(rlo / STEP_MAX - 1e-9)), mHi = Math.min(8, Math.ceil(rhi / STEP_MAX + 1e-9));
    for (let m = mLo; m <= mHi; m++) {
      const angles = [];
      for (let i = 1; i <= 8 * j; i++) angles.push([i * DELTA, i * DELTA]);
      for (let i = 1; i <= m; i++) angles.push(iv.add(iv.mul([j, j], [STEP3, STEP3]), iv.mul(iv.div([i, i], [m, m]), r)));
      out.push({ j, m, angles, nFull: 8 * j });
    }
  }
  return out;
}

function symIds(b) { return new Set([...b.x.s.keys(), ...b.y.s.keys(), ...b.rot.s.keys()]); }
function symCount(b, protect) { let n = 0; for (const id of symIds(b)) if (!protect || !protect.has(id)) n++; return n; }
function foldAll(states, info, before, maxSym, protect) {
  return states.map(b => (info.pushes > before || symCount(b, protect) > maxSym) ? (info.folds++, P.fold(b, protect)) : b);
}
function radiusUpper(x, y) { return iv.sqrt(iv.add(iv.sqr(x.range()), iv.sqr(y.range())))[1]; }

// the feet of a pose (TM state), as upper bounds on their radius and the pose's three radius ranges
function feetRadii(b) {
  return [0, 1, 2].map(j => {
    const ang = b.rot.addI(iv.mul([j, j], TWO_PI_3));
    const fx = b.x.add(ang.cos().scaleI([R, R])), fy = b.y.add(ang.sin().scaleI([R, R]));
    return fx.sqr().add(fy.sqr()).sqrt().range();
  });
}

// red's pose at each of K_RED substeps, from its (Taylor model) start pose: the engine rotates the
// piece about the fixed position of its pinned foot, so hub_k = hub + (I - Rot(ang)) e with e the
// hub-to-pivot-foot vector
function redPath(r0, pivotIdx, dir) {
  const phi = r0.rot.addI(iv.mul([pivotIdx, pivotIdx], TWO_PI_3));
  const ex = phi.cos().scaleI([R, R]), ey = phi.sin().scaleI([R, R]);
  const poses = [];
  for (let k = 1; k <= K_RED; k++) {
    const ang = [dir * k * DELTA, dir * k * DELTA];
    const c = iv.cos(ang), s = iv.sin(ang), omc = iv.sub([1, 1], c);
    const x = r0.x.add(ex.scaleI(omc)).add(ey.scaleI(s)), y = r0.y.add(ey.scaleI(omc)).add(ex.scaleI(iv.neg(s)));
    const rot = r0.rot.addI(ang);
    poses.push({ x: x.range(), y: y.range(), rot: rot.range(), tm: { x, y, rot } });
  }
  return poses;
}

function run2(bp, bd, a0, a1, deg, opts = {}) {
  setDegree(deg);
  const push = opts.push || {};
  if (opts.maxOps) push.maxOps = opts.maxOps;       // the work budget travels with the push options to the solver
  const t0 = Date.now();
  const am = 0.5 * a0 + 0.5 * a1, ar = iv.up(Math.max(a1 - am, am - a0));
  if (!(am - ar <= a0 && am + ar >= a1)) throw new Error('alpha map does not cover the interval');
  const info = { ops0: opCount(), dbg: !!(opts.dbgFrom && 0), pushes: 0, relaxed: 0, hulls: 0, passes: 0, maxCand: 0, folds: 0, firstContact: null, maxBranches: 1 };
  const all = { marginLo: Infinity, marginHi: -Infinity, hubMoveLo: Infinity, foot: -1, regimes: 0, redBranches: 0, aPushes: 0 };
  const trace = { items: [] };

  // blue after its reply: seed rotated exactly by bd * alpha (a Taylor model in t)
  const th = TM.linearI(iv.mul([am, am], DEG), iv.mul([ar, ar], DEG));
  const ang = bd > 0 ? th : th.neg();
  const c = ang.cos(), s = ang.sin();
  const b = SEED.blue, phiB = iv.add([b.rot, b.rot], iv.mul([bp, bp], TWO_PI_3));
  const bex = iv.mul(iv.cos(phiB), [R, R]), bey = iv.mul(iv.sin(phiB), [R, R]);
  const omcB = c.neg().addC(1);
  const blue0 = {
    x: omcB.scaleI(bex).add(s.scaleI(bey)).addI([b.x, b.x]),
    y: omcB.scaleI(bey).add(s.scaleI(iv.neg(bex))).addI([b.y, b.y]),
    rot: ang.addC(b.rot),
  };

  for (const reg of regimes(a0, a1)) {
    all.regimes++;
    // ---- phase A: blue's reply pushes red ----
    let red = [{ x: TM.const(SEED.red.x), y: TM.const(SEED.red.y), rot: TM.const(SEED.red.rot) }];
    const pushesA = info.pushes;
    for (let s_ = 0; s_ < reg.angles.length; s_++) {
      let pusher;
      if (s_ < reg.nFull) pusher = P.redGeometry(rotPose(SEED.blue, bp, bd > 0 ? reg.angles[s_] : iv.neg(reg.angles[s_])));
      else {
        // partial call: total angle (i/m) alpha + j STEP3 (m - i)/m, a Taylor model in t
        const i = s_ - reg.nFull + 1, w = iv.div([i, i], [reg.m, reg.m]);
        const tot = th.scaleI(w).addI(iv.mul(iv.mul([reg.j, reg.j], [STEP3, STEP3]), iv.sub([1, 1], w)));
        pusher = P.tmGeometry(rotPoseTM(SEED.blue, bp, bd > 0 ? tot : tot.neg()));
      }
      const before = info.pushes;
      info.dbg = !!process.env.DBGA && Math.abs(s_ + 1 - +process.env.DBGA) < 0.5;
      if (info.dbg) console.error(`substep A${s_ + 1}`);
      try { red = P.resolvePushTM(red, pusher, info, push); } catch (e) { e.message = `phase A substep ${s_ + 1}: ` + e.message; throw e; }
      if (opts.maxPasses && info.passes > opts.maxPasses) throw new Error(`phase A substep ${s_ + 1}: work budget exceeded (${info.passes} solver passes)`);
      red = foldAll(red, info, before, opts.maxSym || 12);
      if (opts.verbose && info.pushes > pushesA) {
        const w = m => { const q = m.range(); return (q[1] - q[0]).toExponential(1); };
        console.error(`A${s_ + 1} branches ${red.length} pushes ${info.pushes - pushesA} | red x ${red[0].x.range()[0].toFixed(5)} width ${w(red[0].x)} y ${w(red[0].y)} rot ${w(red[0].rot)}`);
      }
    }
    all.aPushes += info.pushes - pushesA;
    all.redBranches = Math.max(all.redBranches, red.length);
    const item = { j: reg.j, m: reg.m, red, B: [] };
    if (opts.keepTrace) trace.items.push(item);
    if (opts.phaseAOnly) continue;      // legal-red.js wants red's pose after blue's reply, nothing else

    // ---- phase B: red's reply, one run per red branch ----
    for (const r0raw of red) {
      // red's pose keeps its uncertainty as three shared noise symbols, so every substep of its path
      // carries the same ones and the pushed piece's dependence on them is tracked, not re-invented
      const r0 = P.fold(r0raw);
      const protect = symIds(r0);
      // red must still be on the board after being pushed (else blue has won and there is no reply)
      const ro = feetRadii(r0);
      if (!(Math.max(...ro.map(r => r[1])) < EDGE[0])) throw new Error('red may be pushed off the board by blue\'s reply');
      const path = redPath(r0, 0, -1);
      // red must not swing itself off during its 123 substeps
      for (const p of path) {
        const fr = [0, 1, 2].map(j => { const an = iv.add(p.rot, iv.mul([j, j], TWO_PI_3)); return iv.sqrt(iv.add(iv.sqr(iv.add(p.x, iv.mul(iv.cos(an), [R, R]))), iv.sqr(iv.add(p.y, iv.mul(iv.sin(an), [R, R])))))[1]; });
        if (!(Math.max(...fr) < EDGE[0])) throw new Error('red may swing itself off the board');
      }
      let st = [{ x: blue0.x, y: blue0.y, rot: blue0.rot }];
      const Bs = []; item.B.push(Bs);
      const start = { x: blue0.x, y: blue0.y };
      for (let kk = 1; kk <= K_RED; kk++) {
        const p = path[kk - 1];
        const pusher = P.tmGeometry(p.tm);
        const before = info.pushes;
        info.dbg = !!process.env.DBGB && Math.abs(kk - +process.env.DBGB) <= 1;
        if (info.dbg) console.error(`substep B${kk}`);
        try { st = P.resolvePushTM(st, pusher, info, push); } catch (e) { e.message = `phase B substep ${kk}: ` + e.message; throw e; }
        if (opts.maxPasses && info.passes > opts.maxPasses) throw new Error(`phase B substep ${kk}: work budget exceeded (${info.passes} solver passes)`);
        if (info.pushes > before && info.firstContact === null) info.firstContact = kk;
        st = foldAll(st, info, before, opts.maxSym || 12, protect);
        if (opts.keepTrace) Bs.push(st);
        if (opts.verbose) {
          const w = m => { const q = m.range(); return (q[1] - q[0]).toExponential(1); };
          const b0 = st[0];
          console.error(`B${kk} branches ${st.length} pushes ${info.pushes} | x ${b0.x.range()[0].toFixed(5)} width ${w(b0.x)} y ${w(b0.y)} rot ${w(b0.rot)} rem ${b0.x.remMag().toExponential(1)} hubhub ${info.hubHubPushes || 0} relaxed ${info.relaxed} hulls ${info.hulls} folds ${info.folds} cand ${info.maxCand} | polyW ${(() => { const q = b0.x.polyRange(); return (q[1] - q[0]).toExponential(1); })()} symMag ${b0.x.symMag().toExponential(1)} nsym ${b0.x.s.size}`);
        }
      }
      for (const bs of st) {
        const fr = feetRadii(bs);
        const best = fr.reduce((m, r, j) => r[0] > m.lo ? { j, lo: r[0], hi: r[1] } : m, { j: -1, lo: -Infinity });
        const lo = iv.dn(best.lo - EDGE[1]);
        if (lo < all.marginLo) { all.marginLo = lo; all.foot = best.j; }
        all.marginHi = Math.max(all.marginHi, iv.up(best.hi - EDGE[0]));
        all.hubMoveLo = Math.min(all.hubMoveLo, bs.x.sub(start.x).sqr().add(bs.y.sub(start.y).sqr()).sqrt().range()[0]);
      }
    }
  }
  return { a0, a1, deg, ms: Date.now() - t0, info, ...all, trace };
}
module.exports = { run2, regimes, rotPose, redPath, K_RED, DELTA, STEP3, STEP_MAX };

if (require.main === module) {
  const [bp, bd, a0, a1] = process.argv.slice(2, 6).map(Number);
  const deg = +(process.argv[6] || 6);
  try {
    const push = process.env.BRANCH ? { branch: true, branchStraddle: !!process.env.STRADDLE, tolHull: +(process.env.TOLH || 1e-7), maxBranches: +(process.env.MAXB || 8) } : (process.env.HULLSTRADDLE ? { hullStraddle: true } : {});
    const r = run2(bp, bd, a0, a1, deg, { push, verbose: !!process.env.V });
    console.log(JSON.stringify({ arm: [bp, bd], interval: [a0, a1], deg, ms: r.ms, margin: [r.marginLo, r.marginHi], foot: r.foot, hubMoveLo: r.hubMoveLo, regimes: r.regimes, redBranches: r.redBranches, aPushes: r.aPushes, info: r.info }));
  } catch (e) { console.log(JSON.stringify({ arm: [bp, bd], interval: [a0, a1], deg, error: e.message })); }
}
