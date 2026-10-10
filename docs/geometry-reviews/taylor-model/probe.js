// Feasibility probe: where can the model prove anything? For one blue arm, try a tiny cell
// [alpha, alpha + width] at every `step` degrees and record whether it proves red's reply, and if not
// why. A tiny cell avoids the contact events a wide one straddles, so a failure means a stretch
// where the model itself cannot enclose the contact, not a bad choice of cell.
//   node probe.js <bluePivot> <blueDir> <from> <to> <step> [width=1e-5] [degree=4]   -> CSV on stdout
'use strict';
const { run2 } = require('./cert2.js');
const { fromEnv } = require('./problem.js');
const [bp, bd, from, to, step] = process.argv.slice(2, 7).map(Number);
const width = +(process.argv[7] || 1e-5), deg = +(process.argv[8] || 4);
const code = msg => {
  if (/vertical contact/.test(msg)) return 'steep';
  if (/deep-crossing/.test(msg)) return 'deep';
  if (/near-parallel/.test(msg)) return 'parallel';
  if (/hub-hub/.test(msg)) return 'hubhub';
  if (/inv: range/.test(msg)) return 'inv';
  if (/sqrt: range/.test(msg)) return 'sqrt';
  if (/separation cap/.test(msg)) return 'cap';
  if (/pushed off|swing itself off/.test(msg)) return 'offboard';
  return 'other';
};
const problem = fromEnv();
const push = process.env.SYMREM ? { symRem: true } : {};   // SYMREM=1: probe the model that moves push remainders into noise symbols
console.log('alpha,ok,margin,phase,substep,reason');
const n = Math.floor((to - from) / step + 1e-9);
for (let i = 0; i <= n; i++) {
  const a = from + i * step;
  try {
    const r = run2(bp, bd, a, a + width, deg, { push, problem });
    console.log(`${a},1,${r.marginLo.toFixed(4)},,,`);
  } catch (e) {
    const m = /^phase ([AB]) substep (\d+): (.*)$/.exec(e.message);
    console.log(`${a},0,,${m ? m[1] : ''},${m ? m[2] : ''},${code(e.message)}`);
  }
}
