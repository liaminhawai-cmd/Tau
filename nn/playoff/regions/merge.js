'use strict';
const fs = require('fs');
const parts = fs.readdirSync('.').filter(f => /^rel-w\d+\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const MEMBERS = parts[0].members;
const acc = {}, pairAcc = {}, errSum = {}, errSq = {};
let n = 0;
for (const p of parts) {
  n += p.n;
  for (const dim in p.acc) { acc[dim] ||= {};
    for (const cell in p.acc[dim]) { acc[dim][cell] ||= {};
      for (const m in p.acc[dim][cell]) { const a = acc[dim][cell][m] ||= { n:0, loss:0, right:0 }, b = p.acc[dim][cell][m];
        a.n += b.n; a.loss += b.loss; a.right += b.right; } } }
  for (const k in p.pairAcc) pairAcc[k] = (pairAcc[k]||0) + p.pairAcc[k];
  for (const m in p.errSum) { errSum[m] = (errSum[m]||0) + p.errSum[m]; errSq[m] = (errSq[m]||0) + p.errSq[m]; }
}
fs.writeFileSync('merged.json', JSON.stringify({ members: MEMBERS, acc, pairAcc, errSum, errSq, n }));
const DMLAB = ['0-8u','8-16u','16-24u','24-32u','32-40u','40-48u','48-56u','56u+'];
const LINELAB = ['<1u (on a line)','1-3u','3-8u','8u+'];
const ADVLAB = ['losing','even','winning'];
const lab = (dim, c) => dim === 'dm' ? DMLAB[c] : dim === 'line' ? LINELAB[c] : dim === 'adv' ? ADVLAB[c] : 'all';
console.log(`${n} positions scored\n`);
for (const dim of ['all','dm','line','adv']) {
  console.log(`## by ${dim}`);
  const cells = Object.keys(acc[dim]).sort((a,b)=>+a-+b);
  const hdr = 'cell'.padEnd(17) + 'n'.padStart(7) + MEMBERS.map(m => m.padStart(9)).join('') + '   best-minus-L11';
  console.log(hdr);
  for (const c of cells) {
    const row = acc[dim][c];
    const cn = row[MEMBERS[0]].n;
    // log-loss per position, lower is better
    const L = m => row[m] ? row[m].loss / row[m].n : NaN;
    const d = L('best') - L('L11');
    console.log(lab(dim,+c).padEnd(17) + String(cn).padStart(7) +
      MEMBERS.map(m => L(m).toFixed(3).padStart(9)).join('') + '   ' + (d>=0?'+':'') + d.toFixed(3) + (d<0?'  net better':'  L11 better'));
  }
  console.log('');
}
console.log('## accuracy (sign of the call), by distance from centre');
console.log('cell'.padEnd(17) + MEMBERS.map(m => m.padStart(9)).join(''));
for (const c of Object.keys(acc.dm).sort((a,b)=>+a-+b)) {
  const row = acc.dm[c];
  console.log(DMLAB[+c].padEnd(17) + MEMBERS.map(m => (100*row[m].right/row[m].n).toFixed(1).padStart(9)).join(''));
}
console.log('\n## error correlation (do two members make the SAME mistakes?)');
const sd = {}; for (const m of MEMBERS) { const mu = errSum[m]/n; sd[m] = Math.sqrt(errSq[m]/n - mu*mu); }
const pairs = [];
for (const a of MEMBERS) for (const b of MEMBERS) { if (a>=b) continue;
  const cov = pairAcc[a+'|'+b]/n - (errSum[a]/n)*(errSum[b]/n);
  pairs.push({ pair: a+' ~ '+b, r: cov/(sd[a]*sd[b]) }); }
pairs.sort((x,y)=>x.r-y.r);
for (const p of pairs) console.log('  ' + p.pair.padEnd(20) + p.r.toFixed(3));
