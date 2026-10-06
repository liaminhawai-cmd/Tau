// See ./README.md.
// Which contact regime does the deep range of CERT target 1's family (2,1) actually need?
// The 2026-10-07 hub-clearance fix left the deep range [2, ~9.7] deg refusing on
// "the centre's own push used a hub contact" -- this census replays the best witnesses
// from representative deep stops and tallies, per substep, the KINDS of pushes the
// replica uses ('leg' chord-chord, 'hubA' attacker hub vs victim leg, 'hubV' victim
// hub vs attacker leg, 'hubhub'), so the next regime derivation knows exactly which
// case to build first.
//
//   node nn/throw-audit/hub-regime-census.js
'use strict';
const FW = require('../forced-win.js');
const TC = require('../throw-cert.js');
const CL = require('../contact-law.js');
const DEG = Math.PI / 180, K = CL.REPLICA;

const row = { p: [12.2195, 37.7663, 11.0497, 2.8121, 28.9609, -13.703], mover: 0 };
const rpv = 2, rd = 1;
const WITNESSES = [[0, -1], [2, 1], [1, 1]];
const STOPS = [2.5, 5.0, 7.5, 9.5].map(d => d * DEG);

const pieces0 = FW.piecesOf(row.p), m = row.mover, att = 1 - m;
const fam = FW.replyFamily(pieces0, m, rpv, rd, K);
console.log(`family (2,1) of CERT target 1, lim ${(fam.lim / DEG).toFixed(2)} deg; reply stops ${STOPS.map(s => (s / DEG).toFixed(1)).join('/')} deg`);
for (const stop of STOPS) {
  const rec = fam.out.record.find(r => r.alpha >= stop - 1e-9) || fam.out.record[fam.out.record.length - 1];
  const p = pieces0.map(q => ({ ...q }));
  p[m] = FW.moverAt(pieces0[m], rpv, rd, rec.alpha);
  p[att] = { x: rec.x, y: rec.y, rot: rec.rot };   // the reply is contact-free down here? if not, this stop carries a push
  for (const [wpv, wd] of WITNESSES) {
    const lim = FW.limitAt(p, att, wpv, wd).lim;
    if (!(lim > 0)) { console.log(`  stop ${(stop / DEG).toFixed(1)} witness (${wpv},${wd}): arm illegal from the post-reply pose`); continue; }
    const nSub = Math.max(1, Math.round(lim / TC.LIM_SUB));
    const tr = TC.sweep(p, att, wpv, wd, nSub);
    const tally = {}, subsWithHub = [];
    let maxFootR = 0;
    for (const st of tr) {
      const kindsHere = new Set();
      for (const pu of st.pushes) { const kd = pu.tag ? pu.tag.kind : (pu.kind || '?'); tally[kd] = (tally[kd] || 0) + 1; kindsHere.add(kd); }
      if (kindsHere.has('hubA') || kindsHere.has('hubV') || kindsHere.has('hubhub')) subsWithHub.push(st.k || '?');
      maxFootR = Math.max(maxFootR, ...CL.feetOf(st.pose || st.opp || { x: 0, y: 0, rot: 0 }).map(f => Math.hypot(f.x, f.y)));
    }
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    const hubKinds = ['hubA', 'hubV', 'hubhub'].filter(k => tally[k]);
    console.log(`  stop ${(stop / DEG).toFixed(1)} witness (${wpv},${wd}): ${total} pushes ${JSON.stringify(tally)}${hubKinds.length ? '  HUB at substeps ' + subsWithHub.slice(0, 12).join(',') + (subsWithHub.length > 12 ? `(+${subsWithHub.length - 12})` : '') : ''}  thrown=${maxFootR > CL.EDGE ? 'YES' : 'no'}`);
  }
}
