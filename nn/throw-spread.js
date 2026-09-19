// How much do the contact quantities (normal angle, hf, lever arm) and the pose set itself really
// vary over a box of victim poses, substep by substep? Compared with what the checker's intervals
// claim. POSE=... node nn/throw-spread.js attacker pv dir hx hy hRotDeg [N]
'use strict';
const FW = require('./forced-win.js');
const CL = require('./contact-law.js');
const TC = require('./throw-cert.js');
const { feetOf, R, I, MIND: D, EDGE } = CL;
const DEG = Math.PI / 180, LIM_SUB = TC.LIM_SUB;
const a = process.argv.slice(2), pose = process.env.POSE.split(',').map(Number);
const attacker = +a[0], pv = +a[1], dir = +a[2], hx = +a[3], hy = +a[4], hr = +a[5] * DEG, N = +(a[6] || 200);
const pieces = FW.piecesOf(pose), victim = 1 - attacker, v = pieces[victim];
const lim = FW.limitAt(pieces, attacker, pv, dir).lim, K = Math.round(lim / LIM_SUB);
const c0 = { x: v.x, y: v.y, rot: v.rot };

const trajs = [];
for (let t = 0; t < N; t++) {
  const q = t === 0 ? { ...c0 } : { x: v.x + (Math.random() * 2 - 1) * hx, y: v.y + (Math.random() * 2 - 1) * hy, rot: v.rot + (Math.random() * 2 - 1) * hr };
  if (CL.minGapOf(pieces[attacker], q) < D) continue;
  trajs.push(TC.sweep(pieces.map((p, i) => (i === victim ? q : p)), attacker, pv, dir, K));
}
console.log(`${trajs.length} poses, ${K} substeps, box +-${hx}u +-${a[5]}deg`);
const pairAt = (att, q, pair) => {
  const A = [], V = [];
  for (let s = 0; s <= 12; s++) { }
  return null;
};
console.log('  k   deg  |  set: dx    dy    drot   footspread |  contact: psi span   hf span     rn span  | pushes  Lam');
for (let k = 1; k <= K; k++) {
  const ps = trajs.map(tr => tr[k - 1]);
  const xs = ps.map(p => p.pose.x), ys = ps.map(p => p.pose.y), rs = ps.map(p => p.pose.rot);
  const dx = Math.max(...xs) - Math.min(...xs), dy = Math.max(...ys) - Math.min(...ys), dr = Math.max(...rs) - Math.min(...rs);
  // the worst separation of two poses, in foot-displacement terms
  let spread = 0;
  for (let i = 0; i < ps.length; i += Math.max(1, Math.floor(ps.length / 40))) for (let j = 0; j < ps.length; j += Math.max(1, Math.floor(ps.length / 40))) {
    const p = ps[i].pose, q = ps[j].pose, s = Math.hypot(p.x - q.x, p.y - q.y) + 2 * R * Math.abs(Math.sin((p.rot - q.rot) / 2));
    if (s > spread) spread = s;
  }
  const pushes = ps.flatMap(p => p.pushes);
  let line = `  ${String(k).padStart(3)} ${(k * LIM_SUB / DEG).toFixed(2).padStart(5)}  |  ${dx.toFixed(4)} ${dy.toFixed(4)} ${(dr / DEG).toFixed(4)} ${spread.toFixed(4).padStart(8)}   |`;
  if (pushes.length) {
    const psis = pushes.map(p => Math.atan2(p.ny, p.nx)), hfs = pushes.map(p => p.hf), rns = pushes.map(p => p.rn);
    const c = psis[0], rel = psis.map(t => Math.atan2(Math.sin(t - c), Math.cos(t - c)));
    const lam = ps.map(p => p.pushes.reduce((s, q) => s + q.lambda, 0)).filter(x => x > 0);
    line += ` ${((Math.max(...rel) - Math.min(...rel)) / DEG).toFixed(3).padStart(7)}deg ${(Math.max(...hfs) - Math.min(...hfs)).toFixed(4)} ${(Math.max(...rns) - Math.min(...rns)).toFixed(3).padStart(7)} | ${String(ps.filter(p => p.pushes.length).length).padStart(4)}/${ps.length} ${(lam.length ? Math.max(...lam) : 0).toFixed(4)}`;
  } else line += '   (no contact)';
  if (k <= 40 || k % 5 === 0) console.log(line);
}
