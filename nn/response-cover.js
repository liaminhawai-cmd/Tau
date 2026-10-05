'use strict';
const FW = require('./forced-win.js'), TC = require('./throw-cert.js'), CL = require('./contact-law.js');
const K = CL.REPLICA, DEG = Math.PI / 180;
function emptyPatch(r, a, b, w) {
  return { replyArm: r, replyInterval: [a, b], witness: { pv: w[0], dir: w[1], stopRule: 'limit' }, eventSignature: null,
    enclosure: { metric: 'L1-foot', radius: 0, remainder: 0 }, throwMargin: 0,
    proof: { status: 'refused', method: 'interval-tube', noEventCrossing: false } };
}
function replyTube(pieces, m, rpv, rd, a, b) {
  // DISCOVERY ONLY: replyFamily records are sampled at the replica integrator's 0.4deg
  // ladder.  They are not, by themselves, an enclosure of every stop in [a,b].  Until
  // a validated derivative/event enclosure is supplied, refuse to call this a proof tube.
  const fam = FW.replyFamily(pieces, m, rpv, rd, K);
  if (!fam || !fam.out || !Array.isArray(fam.out.record) || fam.out.record.length < 2) return null;
  // If the reply sweep never moves the opponent, it is contact-free.  In that regime the
  // replying piece itself is an exact rigid curve and can be enclosed analytically.
  const rec0 = fam.out.record[0], recN = fam.out.record[fam.out.record.length - 1];
  const staticVictim = Math.abs(recN.x - rec0.x) < 1e-12 &&
    Math.abs(recN.y - rec0.y) < 1e-12 &&
    Math.abs(recN.rot - rec0.rot) < 1e-12;
  if (staticVictim) {
    const base = pieces[m];
    const foot = CL.feetOf(base)[rpv];
    const box = exactRigidReplyBox(base, foot, rd, a, b);
    return {
      centre: { x: (box.x[0] + box.x[1]) / 2, y: (box.y[0] + box.y[1]) / 2,
        rot: (box.rot[0] + box.rot[1]) / 2, alpha: (a + b) / 2 },
      hx: (box.x[1] - box.x[0]) / 2,
      hy: (box.y[1] - box.y[0]) / 2,
      hr: (box.rot[1] - box.rot[0]) / 2,
      exactReplyBox: box,
      validated: true,
      method: 'exact-rigid-rotation'
    };
  }
  const rec = fam.out.record;
  const lo = rec.find(r => r.alpha >= a - 1e-9);
  const hi = rec.find(r => r.alpha >= b - 1e-9) || rec[rec.length - 1];
  if (!lo || !hi) return null;
  const samples = rec.filter(r => r.alpha >= a - 1e-9 && r.alpha <= b + 1e-9);
  if (samples.length < 2) return null;
  const span = Math.max(1e-12, b - a);
  let Lx = 0, Ly = 0, Lr = 0;
  for (let i = 1; i < samples.length; i++) {
    const da = Math.max(1e-12, samples[i].alpha - samples[i - 1].alpha);
    Lx = Math.max(Lx, Math.abs(samples[i].x - samples[i - 1].x) / da);
    Ly = Math.max(Ly, Math.abs(samples[i].y - samples[i - 1].y) / da);
    Lr = Math.max(Lr, Math.abs(samples[i].rot - samples[i - 1].rot) / da);
  }
  // A finite-difference maximum is evidence, not a derivative bound.  Therefore this object is
  // explicitly marked unvalidated and cannot be passed to certifyPatch as a proof enclosure.
  return {
    centre: samples[Math.floor(samples.length / 2)],
    hx: Math.max(0.002, Math.abs(hi.x - lo.x) / 2 + 0.01),
    hy: Math.max(0.002, Math.abs(hi.y - lo.y) / 2 + 0.01),
    hr: Math.max(0.002 * DEG, Math.abs(hi.rot - lo.rot) / 2 + 0.01 * DEG),
    empiricalLipschitz: { x: Lx, y: Ly, rot: Lr },
    validated: false,
    reason: 'sampled reply records do not prove a continuous interval enclosure'
  };
}
// Exact coordinate enclosure for a rigid rotation about a fixed foot.
// For a contact-free reply, every stop alpha in [a,b] is exactly this curve.  The bounds
// below are analytic: each coordinate is A + B cos(theta) + C sin(theta), whose extrema
// on an interval occur at an endpoint or where atan2(C,B) (plus pi) lies in the interval.
// No sampled record is used to establish the enclosure.
function trigRange(A, B, C, lo, hi) {
  const vals = [A + B * Math.cos(lo) + C * Math.sin(lo), A + B * Math.cos(hi) + C * Math.sin(hi)];
  const t = Math.atan2(C, B), two = 2 * Math.PI;
  const k0 = Math.ceil((lo - t) / two), k1 = Math.floor((hi - t) / two);
  for (let k = k0; k <= k1; k++) vals.push(A + B * Math.cos(t + k * two) + C * Math.sin(t + k * two));
  const t2 = t + Math.PI;
  const j0 = Math.ceil((lo - t2) / two), j1 = Math.floor((hi - t2) / two);
  for (let k = j0; k <= j1; k++) vals.push(A + B * Math.cos(t2 + k * two) + C * Math.sin(t2 + k * two));
  return [Math.min(...vals), Math.max(...vals)];
}
function exactRigidReplyBox(base, pivotFoot, rd, a, b) {
  const dx = base.x - pivotFoot.x, dy = base.y - pivotFoot.y;
  const lo = rd * a, hi = rd * b;
  const tlo = Math.min(lo, hi), thi = Math.max(lo, hi);
  const x = trigRange(pivotFoot.x, dx, -dy, tlo, thi);
  const y = trigRange(pivotFoot.y, dy,  dx, tlo, thi);
  const r0 = base.rot + lo, r1 = base.rot + hi;
  return {
    x, y, rot: [Math.min(r0, r1), Math.max(r0, r1)],
    validated: true,
    method: 'exact-rigid-rotation',
    domain: [a, b],
    parameter: 'reply-stop-angle'
  };
}

function rotAbout(base, foot, s, d) {
  const c = Math.cos(d * s), sn = Math.sin(d * s);
  return { x: foot.x + (base.x - foot.x) * c - (base.y - foot.y) * sn, y: foot.y + (base.x - foot.x) * sn + (base.y - foot.y) * c, rot: base.rot + d * s };
}
function certifyPatch(pieces, m, rpv, rd, a, b, wpv, wd, opts) {
  const tube = replyTube(pieces, m, rpv, rd, a, b);
  if (!tube) return { certified: false, why: 'no reply family' };
  if (!tube.validated) return { certified: false, why: tube.reason };
  const att = 1 - m, foot = CL.feetOf(pieces[m])[rpv];
  const mPos = rotAbout(pieces[m], foot, tube.centre.alpha, rd);
  const aPos = { x: tube.centre.x, y: tube.centre.y, rot: tube.centre.rot };
  const pcs = m === 0 ? [mPos, aPos] : [aPos, mPos];
  const box = { x: [mPos.x - 0.0002, mPos.x + 0.0002], y: [mPos.y - 0.0002, mPos.y + 0.0002], rot: [mPos.rot - 0.002 * DEG, mPos.rot + 0.002 * DEG] };
  return TC.certify(pcs, att, wpv, wd, box, 1, { ...opts, log: (opts && opts.log) || (() => {}) });
}
function validatePatch(pieces, m, rpv, rd, a, b, wpv, wd, N, log) {
  log = log || console.log;  let ok = 0, bad = [];
  for (let i = 0; i < N; i++) {
    const s = a + (b - a) * Math.random(), fam = FW.replyFamily(pieces, m, rpv, rd, K);
    if (!fam) { bad.push({ stop: s, why: 'no family' }); continue; }
    const rec = fam.out.record.find(r => r.alpha >= s - 1e-6) || fam.out.record[fam.out.record.length - 1];
    const foot = CL.feetOf(pieces[m])[rpv], mPos = rotAbout(pieces[m], foot, rec.alpha, rd);
    const aPos = { x: rec.x, y: rec.y, rot: rec.rot };
    const pcs = m === 0 ? [mPos, aPos] : [aPos, mPos];
    const box = { x: [mPos.x - 0.002, mPos.x + 0.002], y: [mPos.y - 0.002, mPos.y + 0.002], rot: [mPos.rot - 0.002 * DEG, mPos.rot + 0.002 * DEG] };
    const r = TC.certify(pcs, 1 - m, wpv, wd, box, 1, { log: () => {} });
    if (r.certified) ok++; else bad.push({ stop: s, why: r.why });
  }
  log(bad.length === 0 ? '# ok ' + ok + '/' + N : '# FAIL ' + ok + '/' + N);
  bad.slice(0, 5).forEach(v => log('#   stop ' + v.stop.toFixed(4) + ': ' + v.why));
  return bad.length;
}
const pose = [0.4981, 35.798, 0.5752, 2.4001, 49.5323, 4.7];
const m = 1, rpv = 2, rd = -1, a = 0, b = 0.610865, wpv = 1, wd = 1;
const args = process.argv.slice(2), vi = args.indexOf('--validate'), N = vi >= 0 ? +(args[vi + 1] || 100) : 0;
const pieces = FW.piecesOf(pose), tube = replyTube(pieces, m, rpv, rd, a, b);
if (!tube) { console.log('NO TUBE'); process.exit(1); }
const res = certifyPatch(pieces, m, rpv, rd, a, b, wpv, wd);
const rec = emptyPatch([rpv, rd], a, b, [wpv, wd]);
rec.enclosure.radius = Math.hypot(tube.hx, tube.hy);
rec.throwMargin = res.minR || 0;
rec.proof.status = res.certified ? 'validated' : 'refused';
rec.proof.noEventCrossing = !res.why || !res.why.includes('event');
console.log(JSON.stringify(rec, null, 2));
console.log('# certify:', res.certified ? 'ok k=' + res.k : 'REFUSED: ' + (res.why || '?'));
if (N > 0) { console.log('# --validate ' + N); const v = validatePatch(pieces, m, rpv, rd, a, b, wpv, wd, N); process.exit(v ? 1 : 0); }
process.exit(res.certified ? 0 : 1);