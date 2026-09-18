// The ndpxhts24 throw on the SEARCH's substep grid: 46 separate one-degree applySwing calls,
// each of which contact-law's swing splits into ceil(1/0.4) = 3 equal substeps of exactly 1/3
// degree, for 138 substeps with no floating-point slack.
//
// Earlier traces for briefs 2 and 3 asked for the whole 46 degrees in ONE call with stepDeg = 1/3.
// That is not the same trajectory: 46*DEG / ((1/3)*Math.PI/180) evaluates to 138.00000000000003,
// one ulp over, so ceil gives 139 substeps of 0.330935 degrees. Substeps inside a call are equal,
// so a different call pattern integrates a different trajectory.
const C = require('../contact-law.js');
const R = C.R, DEG = Math.PI / 180, { REPLICA, feetOf } = C;
const blue0 = { x: -24.31126879077936, y: -37.34799285619334, rot: 1.3448263401595464 };
const red0  = { x: -11.7593, y: -23.2838, rot: 2.9442 };
const P = { x: -34.40582386831619, y: -18.75456367565295 };      // the attacker's pinned foot
const rotAbout = (p, a) => { const c = Math.cos(a), s = Math.sin(a), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + a }; };

const trace = [], record = [];
let opp = { ...blue0 }, act = { ...red0 };
for (let call = 0; call < 46; call++) {
  const o = C.swing([opp, act], 1, 0, -1, 1 * DEG, { ...REPLICA, trace: true, record: true });
  for (const t of o.trace)  trace.push({ ...t, k: call * 3 + Math.round(t.alpha / (DEG / 3)) });
  for (let s = 0; s < o.record.length; s++) record.push({ ...o.record[s], k: call * 3 + s + 1 });
  opp = { x: o.opp.x, y: o.opp.y, rot: o.opp.rot };
  act = rotAbout(red0, -(call + 1) * DEG);
}
const last = record[record.length - 1];
console.log(`substeps ${record.length}, step ${(46 / record.length).toFixed(10)} deg`);
console.log(`final victim pose ${last.x.toFixed(6)}, ${last.y.toFixed(6)}, ${(last.rot / DEG).toFixed(5)}`);
const thrown = record.find(r => r.maxFootR > C.EDGE);
console.log(`throw at substep ${thrown.k} = ${(thrown.k / 3).toFixed(2)} deg`);

// the victim's phi = 30 vertex on its leg 0, and the distance of each contact point from the
// nearest vertex of its own polyline
const arcP = (p, i) => { const a = p.rot + i * 2 * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a), pts = [];
  for (let k = 0; k <= 12; k++) { const ph = (k / 12) * Math.PI / 2, s = Math.sin(ph) * R; pts.push({ x: p.x + ca * s, y: p.y + sa * s, h: Math.cos(ph) * R }); } return pts; };
const vdist = phi => { const m = (phi / DEG) / 7.5; return Math.min(m - Math.floor(m), Math.ceil(m) - m) * 7.5 * DEG * R; };

let dwellFrom = null, n = 0, maxd = 0;
console.log('\n| substep | sweep | phi attacker / victim | u to attacker vertex | u to victim vertex | rn | hf |');
for (const t of trace) {
  const V = arcP(t.opp, 0), vx = V[4];   // the victim pose at contact time, before this substep's push
  const d = Math.hypot(t.pb.x - vx.x, t.pb.y - vx.y);
  if (d < 1e-6) { if (dwellFrom === null) dwellFrom = t.k; n++; maxd = Math.max(maxd, d); }
  if (t.k >= 68 && t.k <= 86)
    console.log(`| ${t.k} | ${(t.k / 3).toFixed(3)} | ${(t.phiA / DEG).toFixed(3)} / ${(t.phiB / DEG).toFixed(6)} | ${vdist(t.phiA).toFixed(3)} | ${vdist(t.phiB).toFixed(3)} | ${t.rn.toFixed(3)} | ${t.hf.toFixed(3)} |`);
}
console.log(`\ncontact substeps traced: ${trace.length} (first ${trace[0].k}, last ${trace[trace.length - 1].k})`);
console.log(`victim contact sits on its phi = 30 vertex from substep ${dwellFrom} (${(dwellFrom / 3).toFixed(2)} deg) for ${n} substeps, max deviation ${maxd.toExponential(1)}u`);
// the first crossing, for the 1.408u contrast
const firstX = trace.find(t => t.k >= 30 && t.k <= 36);
for (const t of trace) if (Math.abs(t.k - 32) <= 2) console.log(`  k${t.k} (${(t.k/3).toFixed(2)} deg) phiA ${(t.phiA/DEG).toFixed(3)} phiB ${(t.phiB/DEG).toFixed(3)} vertA ${vdist(t.phiA).toFixed(3)} vertB ${vdist(t.phiB).toFixed(3)} chords ${t.i},${t.j}`);
