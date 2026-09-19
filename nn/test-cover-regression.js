'use strict';
// Regression test for the gap-cover rule in forced-win.js's deadCertificate.
//
// The cover rule makes the certifier ACCEPT gaps the single-arc rule refused. That direction is
// dangerous in a way the old rule was not: too permissive a cover manufactures false certificates,
// and the 261-point corpus quietly stops meaning what it says. So the rule is pinned against
// positions the ENGINE has already falsified -- 40 random legal victim moves, at least one of which
// did not end in a throw. Those positions are not dead. If the certifier ever calls one of them
// dead, the rule is wrong and this exits non-zero.
//
//   node nn/test-cover-regression.js [limit]
//
// The counterexamples come from docs/dead-regions/gap-cover-falsified.jsonl (engineAgreed:false),
// which is 25 positions whose blocking gap IS coverable while the position still escapes elsewhere
// -- exactly the case a naive cover rule would get wrong. Expect 'unresolved' or 'escape', never
// 'dead'. A nonzero `covers` on a position that still fails is correct and healthy: it means the
// rule resolved one gap honestly without rescuing the position.
const fs = require('fs');
const path = require('path');
const F = require('./forced-win.js');
const { REPLICA } = require('./contact-law.js');
const src = path.join(__dirname, '..', 'docs', 'dead-regions', 'gap-cover-falsified.jsonl');
const limit = +(process.argv[2] || 0);

const rows = fs.readFileSync(src, 'utf8').split('\n')
  .filter(l => l.trim() && !l.startsWith('#')).map(l => JSON.parse(l)).filter(r => !r.engineAgreed);
const use = limit > 0 ? rows.slice(0, limit) : rows;
console.log(`${use.length} engine-falsified positions; none may certify as dead`);

let bad = 0, covers = 0;
for (const r of use) {
  const pieces = [{ x: r.p[0], y: r.p[1], rot: r.p[2] }, { x: r.p[3], y: r.p[4], rot: r.p[5] }];
  const c = F.deadCertificate(pieces, r.mover, REPLICA, { replyStepDeg: 2, safety: 3, lipFloor: 1 });
  covers += c.covers || 0;
  if (c.status === 'dead') { bad++; console.log(`  FALSE CERTIFICATE ${r.g} (covers=${c.covers})`); }
}
console.log(`${use.length - bad} correctly refused, ${bad} false certificates; cover rule fired on ${covers} gap(s)`);
if (bad) { console.error('FAIL: the cover rule certified a position the engine falsified'); process.exit(1); }
console.log('PASS');
