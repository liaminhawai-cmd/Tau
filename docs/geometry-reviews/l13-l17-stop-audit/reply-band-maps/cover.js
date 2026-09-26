'use strict';
// From a full map (map-position.js --json): for each defender arm, the stretches of consecutive
// stops over which ONE endpoint reply throws the defender at every stop, chosen greedily (longest
// run first from the current stop). A grid observation, not a certificate: it says nothing about
// the defender states between two sampled stops.
// Run: node cover.js results/brief6-seed.json [--sched quarterDeg]
const fs = require('fs');
const file = process.argv[2];
const sched = (process.argv.indexOf('--sched') > 0 ? process.argv[process.argv.indexOf('--sched') + 1] : 'quarterDeg');
const map = JSON.parse(fs.readFileSync(file, 'utf8'));
const name = r => `(${r.pivotIdx},${r.dir > 0 ? '+' : '-'})`;
const out = { label: map.label, sourcePin: map.sourcePin, schedule: sched, arms: [] };
for (const arm of map.arms[sched]) {
  const st = arm.stops, runs = [];
  let i = 0;
  while (i < st.length) {
    if (st[i].kind !== 'punished') { runs.push({ from: st[i].deg, to: st[i].deg, reply: st[i].kind }); i++; continue; }
    let best = null;
    for (let k = 0; k < 6; k++) {
      let j = i;
      while (j < st.length && st[j].kind === 'punished' && st[j].responses[k].legal && st[j].responses[k].throwsDefender) j++;
      if (j > i && (!best || j > best.j)) best = { k, j };
    }
    runs.push({ from: st[i].deg, to: st[best.j - 1].deg, reply: name(st[i].responses[best.k]), stops: best.j - i });
    i = best.j;
  }
  out.arms.push({ arm: `(${arm.pivotIdx},${arm.dir > 0 ? '+' : '-'})`, limitDeg: arm.limitDeg, stops: st.length,
                  cover: runs.map(r => `${r.from.toFixed(2)}-${r.to.toFixed(2)} ${r.reply}`) });
}
console.log(JSON.stringify(out, null, 1));
