// The barrier theorem's (H2)/(H3) want a per-substep lower bound on the gain that holds for EVERY
// pose in the box. Over a wide box the poses do not all start touching at the same substep, so the
// honest statement is: from the substep at which the whole box is in sustained contact, what is the
// smallest per-substep gain?
const C = require('../contact-law.js');
const DEG = Math.PI / 180, { REPLICA, feetOf, EDGE } = C;
const blue0 = { x: -24.31126879077936, y: -37.34799285619334, rot: 1.3448263401595464 };
const red0  = { x: -11.7593, y: -23.2838, rot: 2.9442 };
const P = { x: -34.40582386831619, y: -18.75456367565295 };
const rotAbout = (p, a) => { const c = Math.cos(a), s = Math.sin(a), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + a }; };
const BOX = +process.argv[2], ROT = +process.argv[3], N = +(process.argv[4] || 200);
let seed = 987654321; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
const runs = [];
for (let i = 0; i < N; i++) {
  const q0 = i === 0 ? { ...blue0 } : { x: blue0.x + BOX * rnd(), y: blue0.y + BOX * rnd(), rot: blue0.rot + ROT * rnd() };
  const r = []; let opp = { ...q0 }, act = { ...red0 };
  for (let call = 0; call < 46; call++) {
    const o = C.swing([opp, act], 1, 0, -1, 1 * DEG, { ...REPLICA, record: true });
    for (const rec of o.record) { const f = feetOf(rec); r.push({ foot: Math.hypot(f[1].x, f[1].y), max: Math.max(...f.map(g => Math.hypot(g.x, g.y))) }); }
    opp = { x: o.opp.x, y: o.opp.y, rot: o.opp.rot }; act = rotAbout(red0, -(call + 1) * DEG);
  }
  runs.push(r);
}
const K = runs[0].length, firsts = [], sustained = [];
let lapsed = 0;
for (const r of runs) {
  let first = null, lastZero = null;
  for (let k = 2; k <= K; k++) { const d = r[k - 1].foot - r[k - 2].foot;
    if (d > 1e-9 && first === null) first = k;
    if (first !== null && k > first && d <= 1e-9) lastZero = k; }
  if (lastZero !== null) lapsed++;
  firsts.push(first); sustained.push(lastZero === null ? first : lastZero + 1);
}
const S = Math.max(...sustained);
let mg = Infinity, mk = null;
for (const r of runs) for (let k = S + 1; k <= K; k++) { const d = r[k - 1].foot - r[k - 2].foot; if (d < mg) { mg = d; mk = k; } }
let thrown = 0, last = 0;
for (const r of runs) { for (let k = 1; k <= K; k++) if (r[k - 1].max > EDGE) { thrown++; last = Math.max(last, k); break; } }
console.log(`+-${BOX}u / +-${ROT} rad   first contact ${Math.min(...firsts)}-${Math.max(...firsts)}   lapses ${lapsed}/${N}   whole box in sustained contact from ${S}   smallest gain from there ${mg.toFixed(6)}u at substep ${mk}   thrown ${thrown}/${N} by ${last}`);
