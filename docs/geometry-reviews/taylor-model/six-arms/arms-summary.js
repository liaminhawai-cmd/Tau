// Summarise the sampled data in data/: per blue arm, how many blue stops there are, whether red's
// (0,-) reply throws at every one, and where the margin is smallest.   node arms-summary.js
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'data');
const read = f => {
  const [h, ...rows] = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n');
  const cols = h.split(',');
  return { cols, rows: rows.map(r => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v === '' ? NaN : +v]))) };
};
const ARMS = ['0m', '0p', '1m', '1p', '2m', '2p'];
const armName = k => `(${k[0]},${k[1] === 'm' ? '−' : '+'})`;
function summarise(prefix, label) {
  console.log(`\n${label}`);
  const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix)).sort();
  let stops = 0, ok = 0, worst = Infinity, worstAt = '';
  for (const f of files) {
    const { cols, rows } = read(f);
    const arm = f.slice(prefix.length + 2, -4).replace('_', ',');
    const live = rows.filter(r => r.blueOver === 0);
    const reds = ARMS.filter(k => cols.includes('m' + k));
    const t = k => live.filter(r => r['l' + k] >= 2 && r['m' + k] > 0).length;
    const m0 = live.map(r => r.m0m), min0 = Math.min(...m0), at0 = live[m0.indexOf(min0)].alpha;
    const early = Math.min(...live.map(r => r.x0m));
    const touch = live.filter(r => r.pushedRed === 1);
    console.log(`  blue arm (${arm}): ${live.length} stops, ${rows.length - live.length} win outright; red (0,−) throws at ${t('0m')}/${live.length}, smallest margin ${min0.toFixed(4)}u at ${at0.toFixed(2)}° (early-stop test ${early.toFixed(4)}u); blue pushes red on ${touch.length ? touch[0].alpha.toFixed(2) + '°–' + touch[touch.length - 1].alpha.toFixed(2) + '°' : 'no stop'}`);
    if (reds.length > 1) for (const k of reds) if (k !== '0m') console.log(`      red ${armName(k)} throws at ${t(k)}/${live.length}`);
    stops += live.length; ok += t('0m');
    if (min0 < worst) { worst = min0; worstAt = `blue (${arm}) at ${at0.toFixed(2)}°`; }
  }
  console.log(`  total: red (0,−) throws at ${ok} of ${stops} stops; smallest margin ${worst.toFixed(4)}u (${worstAt})`);
}
summarise('all-replies-0.1deg', 'Every red reply, blue stops every 0.1°');
summarise('red-0m-0.01deg', 'Red (0,−) only, blue stops every 0.01°');
