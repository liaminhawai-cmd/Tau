// Summarise results/probe/*.csv: per blue arm, the stop-angle ranges where a tiny cell proves red's
// reply (the model works) and where it fails, with the failure reasons.   node probe-summary.js
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'results', 'probe');
const LIMIT = { '0_m': 63.375, '0_p': 44.25, '1_m': 16.5, '1_p': 14.625, '2_m': 15.75, '2_p': 4.875 };
const byArm = {};
for (const f of fs.readdirSync(dir).filter(f => /^arm_.*\.csv$/.test(f))) {
  const key = f.slice(4, 7);
  const rows = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').slice(1).filter(Boolean).map(r => r.split(','));
  (byArm[key] = byArm[key] || []).push(...rows.map(r => ({ a: +r[0], ok: r[1] === '1', margin: r[2] === '' ? null : +r[2], phase: r[3], sub: r[4] === '' ? null : +r[4], why: r[5] })));
}
const fmt = x => x.toFixed(2);
for (const key of Object.keys(byArm).sort()) {
  const rows = byArm[key].sort((p, q) => p.a - q.a);
  const ok = rows.filter(r => r.ok).length;
  // runs of ok / fail
  const runs = [];
  for (const r of rows) {
    if (runs.length && runs[runs.length - 1].ok === r.ok) runs[runs.length - 1].b = r.a; else runs.push({ ok: r.ok, a: r.a, b: r.a, n: 0 });
    runs[runs.length - 1].n++;
  }
  const why = {}; for (const r of rows) if (!r.ok) why[r.why] = (why[r.why] || 0) + 1;
  const first = rows.find(r => !r.ok);
  console.log(`arm (${key[0]},${key[2] === 'm' ? '-' : '+'}) limit ${LIMIT[key]}: ${rows.length} probes, ${ok} ok (${(100 * ok / rows.length).toFixed(0)}%)` + (first ? `; first failure at ${fmt(first.a)}` : '; no failures'));
  console.log('   failure reasons: ' + (Object.keys(why).length ? Object.entries(why).sort((p, q) => q[1] - p[1]).map(([k, v]) => `${k} ${v}`).join(', ') : 'none'));
  const long = runs.filter(r => r.n >= 3);
  console.log('   runs of 3+ probes: ' + long.map(r => `${r.ok ? 'ok' : 'FAIL'} ${fmt(r.a)}-${fmt(r.b)}`).join(' | '));
}
