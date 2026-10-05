'use strict';
const FW = require('./forced-win.js'), TC = require('./throw-cert.js'), CL = require('./contact-law.js');
const K = CL.REPLICA, DEG = Math.PI / 180;
function emptyPatch(r, a, b, w) {
  return { replyArm: r, replyInterval: [a, b], witness: { pv: w[0], dir: w[1], stopRule: 'limit' }, eventSignature: null,
    enclosure: { metric: 'L1-foot', radius: 0, remainder: 0 }, throwMargin: 0,
    proof: { status: 'refused', method: 'interval-tube', noEventCrossing: false } };
}
function replyTube(pieces, m, rpv, rd, a, b) {
  const fam = FW.replyFamily(pieces, m, rpv, rd, K);
  if (!fam) return null;
  const s0 = (a + b) / 2;
  const r0 = fam.out.record.find(r => r.alpha >= s0 - 1e-6) || fam.out.record[fam.out.record.length - 1];
  const lo = fam.out.record.find(r => r.alpha >= a - 1e-6) || fam.out.record[0];
  const hi = fam.out.record.find(r => r.alpha >= b - 1e-6) || fam.out.record[fam.out.record.length - 1];
  return { centre: r0, hx: Math.max(0.002, Math.abs(hi.x - lo.x) / 2 + 0.01), hy: Math.max(0.002, Math.abs(hi.y - lo.y) / 2 + 0.01), hr: Math.max(0.002 * DEG, Math.abs(hi.rot - lo.rot) / 2 + 0.01 * DEG) };
}
function rotAbout(base, foot, s, d) {
  const c = Math.cos(d * s), sn = Math.sin(d * s);
  return { x: foot.x + (base.x - foot.x) * c - (base.y - foot.y) * sn, y: foot.y + (base.x - foot.x) * sn + (base.y - foot.y) * c, rot: base.rot + d * s };
}
function certifyPatch(pieces, m, rpv, rd, a, b, wpv, wd, opts) {
  const tube = replyTube(pieces, m, rpv, rd, a, b);
  if (!tube) return { certified: false, why: 'no reply family' };
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