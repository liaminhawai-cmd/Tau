// See ./README.md.
// Per-SUBSTEP contact census for the hubV push-regime derivation: at the deep stops of family
// (2,1) of CERT target 1, which substeps of the witnesses' throws are hubV-ONLY (the first regime
// target), which are hubV+leg MIXED (deferred), and which are leg-only / free / other-hub. Also
// reports the hubV pushes' hf and sep (cap / hfFloor risk for the centre) and the leg index
// distribution, plus the substep range where hubV-only occurs.
//
//   node nn/throw-audit/hubv-substep-census.js
'use strict';
const FW = require('../forced-win.js');
const TC = require('../throw-cert.js');
const CL = require('../contact-law.js');
const DEG = Math.PI / 180, K = CL.REPLICA;

const row = { p: [12.2195, 37.7663, 11.0497, 2.8121, 28.9609, -13.703], mover: 0 };
const rpv = 2, rd = 1, m = row.mover, att = 1 - m;
const pieces0 = FW.piecesOf(row.p);
const fam = FW.replyFamily(pieces0, m, rpv, rd, K);
for (const stopDeg of [2.5, 5.0, 7.5, 9.5]) {
  const stop = stopDeg * DEG;
  const rec = fam.out.record.find(r => r.alpha >= stop - 1e-9) || fam.out.record[fam.out.record.length - 1];
  const p = pieces0.map(q => ({ ...q }));
  p[m] = FW.moverAt(pieces0[m], rpv, rd, rec.alpha);
  p[att] = { x: rec.x, y: rec.y, rot: rec.rot };
  for (const [wpv, wd] of [[0, -1], [2, 1]]) {
    const lim = FW.limitAt(p, att, wpv, wd).lim;
    const nSub = Math.max(1, Math.round(lim / TC.LIM_SUB));
    const tr = TC.sweep(p, att, wpv, wd, nSub);
    const cls = { hubVonly: 0, legOnly: 0, mixed: 0, free: 0, other: 0 };
    let hfMin = 1, sepMax = 0, legs = {}, firstK = null, lastK = null, multiHubV = 0;
    for (let k = 0; k < tr.length; k++) {
      const st = tr[k];
      const hubHere = st.pushes.filter(pu => pu.kind === 'hubV');
      const kinds = new Set(st.pushes.map(pu => pu.kind));
      const hasV = kinds.has('hubV'), hasL = kinds.has('leg'), hasA = kinds.has('hubA'), hasH = kinds.has('hubhub');
      if (hasA || hasH) cls.other++;
      else if (hasV && !hasL) { cls.hubVonly++; if (firstK === null) firstK = k + 1; lastK = k + 1; }
      else if (hasV && hasL) cls.mixed++;
      else if (hasL) cls.legOnly++;
      else cls.free++;
      if (hubHere.length > 1) multiHubV++;
      for (const pu of hubHere) { hfMin = Math.min(hfMin, pu.hf); sepMax = Math.max(sepMax, pu.sep); legs[pu.i] = (legs[pu.i] || 0) + 1; }
    }
    console.log(`stop ${stopDeg} witness (${wpv},${wd}): ${JSON.stringify(cls)} substeps ${tr.length}; hubV-only at k${firstK ?? '-'}..${lastK ?? '-'}; hubV hf>=${hfMin.toFixed(3)} sep<=${sepMax.toFixed(3)} multi-per-substep ${multiHubV}; legs ${JSON.stringify(legs)}`);
  }
}
