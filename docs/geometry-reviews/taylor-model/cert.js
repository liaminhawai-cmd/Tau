// Taylor-model certificate for one defender interval on the Brief 6 seed.
//   node cert.js <a0deg> <a1deg> [degree]        (env BRANCH=1: keep separate branches; V=1: trace)
'use strict';
const iv = require('./iv.js');
const tmmod = require('./tm.js');
const { TM, setDegree } = tmmod;
const P = require('./push-tm.js');

function run(a0, a1, deg, opts = {}) {
  setDegree(deg);
  const SEED = { blue: { x: -27.3934, y: -36.4088, rot: 1.2052 }, red: { x: -11.7593, y: -23.2838, rot: 2.9442 } };
  // t in [-1, 1] -> alpha = am + ar t degrees, covering [a0, a1]
  const am = 0.5 * a0 + 0.5 * a1;
  let ar = iv.up(Math.max(a1 - am, am - a0));
  if (!(am - ar <= a0 && am + ar >= a1)) throw new Error('alpha map does not cover the interval');
  const k = iv.div([Math.PI, Math.PI], [180, 180]);
  const th = TM.linearI(iv.mul([am, am], k), iv.mul([ar, ar], k));
  const c = th.cos(), s = th.sin();
  const b = SEED.blue;
  const a = iv.add([b.rot, b.rot], P.TWO_PI_3);                 // foot 1 bearing
  const px = iv.add([b.x, b.x], iv.mul(iv.cos(a), [P.footR, P.footR]));
  const py = iv.add([b.y, b.y], iv.mul(iv.sin(a), [P.footR, P.footR]));
  const rx = iv.sub([b.x, b.x], px), ry = iv.sub([b.y, b.y], py);
  let st0 = {
    x: c.scaleI(rx).add(s.scaleI(ry)).addI(px),
    y: s.scaleI(iv.neg(rx)).add(c.scaleI(ry)).addI(py),
    rot: th.neg().addC(b.rot),
  };
  const start = { x: st0.x, y: st0.y };
  let st = [st0];
  const stepRad = iv.div(iv.div(iv.mul([3, 3], [Math.PI, Math.PI]), [180, 180]), [8, 8]);
  const info = { pushes: 0, relaxed: 0, hulls: 0, passes: 0, maxCand: 0, branches: 0, folds: 0, firstContact: null };
  const trace = [];
  const t0 = Date.now();
  for (let kk = 1; kk <= 123; kk++) {
    const red = P.redGeometry(P.redPose(SEED.red, 0, -1, kk, stepRad));
    const before = info.pushes;
    try { st = P.resolvePushTM(st, red, info, opts.push || {}); } catch (e) { e.message = `substep ${kk}: ` + e.message; e.partial = { trace, info }; throw e; }
    if (info.pushes > before && info.firstContact === null) info.firstContact = kk;
    st = st.map(b => { const nsym = new Set([...b.x.s.keys(), ...b.y.s.keys(), ...b.rot.s.keys()]).size;
      if (info.pushes > before || nsym > (opts.maxSym || 12)) { info.folds++; return P.fold(b); } return b; });
    trace.push(st);
    if (opts.verbose && info.pushes > 0) {
      const w = m => { const r = m.range(); return (r[1] - r[0]).toExponential(2); };
      const s0 = st[0]; const ns = new Set([...s0.x.s.keys(), ...s0.y.s.keys(), ...s0.rot.s.keys()]).size;
      console.error(`k${kk} pushes ${info.pushes} relaxed ${info.relaxed} hulls ${info.hulls} cand ${info.maxCand} br ${info.branches} | branches ${st.length} width x ${w(s0.x)} y ${w(s0.y)} rot ${w(s0.rot)} | rem ${s0.x.remMag().toExponential(1)} | sym ${ns} symMag ${s0.x.symMag().toExponential(1)}`);
    }
  }
  // margin: the exposed foot's radius minus the board edge (66.667 + 0.5 in reals), worst branch
  const edge = iv.add([66.667, 66.667], [0.5, 0.5]);
  let marginLo = Infinity, marginHi = -Infinity, foot = -1, hubMoveLo = Infinity;
  for (const bs of st) {
    const fr = [0, 1, 2].map(j => {
      const ang = bs.rot.addI(iv.mul([j, j], P.TWO_PI_3));
      const fx = bs.x.add(ang.cos().scaleI([P.footR, P.footR])), fy = bs.y.add(ang.sin().scaleI([P.footR, P.footR]));
      return fx.sqr().add(fy.sqr()).sqrt().range();
    });
    const best = fr.reduce((m, r, j) => r[0] > m.lo ? { j, lo: r[0], hi: r[1] } : m, { j: -1, lo: -Infinity });
    if (best.lo < marginLo + edge[1]) { marginLo = iv.dn(best.lo - edge[1]); foot = best.j; }
    marginHi = Math.max(marginHi, iv.up(best.hi - edge[0]));
    hubMoveLo = Math.min(hubMoveLo, bs.x.sub(start.x).sqr().add(bs.y.sub(start.y).sqr()).sqrt().range()[0]);
  }
  st = st[0];
  const w = m => { const r = m.range(); return r[1] - r[0]; };
  return {
    a0, a1, deg, ms: Date.now() - t0, info,
    marginLo, marginHi, foot,
    widths: { x: w(st.x), y: w(st.y), rotFoot: w(st.rot) * P.footR },
    rem: { x: st.x.remMag(), y: st.y.remMag(), rot: st.rot.remMag() },
    hubMoveLo, trace,
  };
}
module.exports = { run };
if (require.main === module) {
  const [a0, a1] = process.argv.slice(2, 4).map(Number);
  const deg = +(process.argv[4] || 6);
  try {
    const push = process.env.BRANCH ? { branch: true, branchStraddle: !!process.env.STRADDLE, tolHull: +(process.env.TOLH || 1e-7), maxBranches: +(process.env.MAXB || 8) } : {};
    const r = run(a0, a1, deg, { verbose: !!process.env.V, push });
    console.log(JSON.stringify({ interval: [a0, a1], deg, ms: r.ms, margin: [r.marginLo, r.marginHi], foot: r.foot, widths: r.widths, rem: r.rem, hubMoveLo: r.hubMoveLo, info: r.info }));
  } catch (e) { console.log(JSON.stringify({ interval: [a0, a1], deg, error: e.message })); }
}
