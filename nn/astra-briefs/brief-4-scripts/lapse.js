// Does the victim's contact ever lapse once it has begun, and if so is any lapse before the throw?
// Contact is read off motion: the victim is a free body, so it moves in a substep exactly when it
// is being pushed. Runs either throw arm of seed ndpxhts24.
const C = require('../contact-law.js');
const DEG = Math.PI / 180, { REPLICA, feetOf, EDGE } = C;
const blue0 = { x: -24.31126879077936, y: -37.34799285619334, rot: 1.3448263401595464 };
const red0  = { x: -11.7593, y: -23.2838, rot: 2.9442 };
const FOOT = +(process.argv[2]), DIR = +(process.argv[3]), CALLS = +(process.argv[4]);
const BOX = +(process.argv[5] || 0.125), ROT = +(process.argv[6] || 0.01), N = +(process.argv[7] || 200);
const pv = feetOf(red0)[FOOT], P = { x: pv.x, y: pv.y };
const rotAbout = (p, a) => { const c = Math.cos(a), s = Math.sin(a), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + a }; };
let seed = 987654321; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
const MOVE = 1e-12;
let lapsers = 0, firstLapse = Infinity, lapseBeforeThrow = 0, thrownCount = 0;
let firstThrow = Infinity, lastThrow = -Infinity, K = null;
for (let i = 0; i < N; i++) {
  const q0 = i === 0 ? { ...blue0 } : { x: blue0.x + BOX * rnd(), y: blue0.y + BOX * rnd(), rot: blue0.rot + ROT * rnd() };
  const poses = []; let opp = { ...q0 }, act = { ...red0 };
  for (let call = 0; call < CALLS; call++) {
    const o = C.swing([opp, act], 1, FOOT, DIR, 1 * DEG, { ...REPLICA, record: true });
    for (const rec of o.record) poses.push({ x: rec.x, y: rec.y, rot: rec.rot, max: Math.max(...feetOf(rec).map(g => Math.hypot(g.x, g.y))) });
    opp = { x: o.opp.x, y: o.opp.y, rot: o.opp.rot }; act = rotAbout(red0, DIR * (call + 1) * DEG);
  }
  K = poses.length;
  const moved = [];
  for (let k = 2; k <= K; k++) moved[k] = Math.abs(poses[k-1].x - poses[k-2].x) + Math.abs(poses[k-1].y - poses[k-2].y) + Math.abs(poses[k-1].rot - poses[k-2].rot) > MOVE;
  let thrown = null;
  for (let k = 1; k <= K; k++) if (poses[k-1].max > EDGE) { thrown = k; break; }
  if (thrown !== null) { thrownCount++; firstThrow = Math.min(firstThrow, thrown); lastThrow = Math.max(lastThrow, thrown); }
  let begun = false, lapse = null;
  for (let k = 2; k <= K; k++) {
    if (moved[k]) begun = true;
    else if (begun && lapse === null) lapse = k;
  }
  if (lapse !== null) { lapsers++; firstLapse = Math.min(firstLapse, lapse);
    if (thrown === null || lapse < thrown) lapseBeforeThrow++; }
}
console.log(`arm (${FOOT},${DIR}), ${CALLS} one-degree calls = ${K} substeps, +-${BOX}u / +-${ROT} rad, ${N} poses`);
console.log(`  thrown: ${thrownCount}/${N}${thrownCount ? `, substeps ${firstThrow} to ${lastThrow}` : ''}`);
console.log(`  poses whose contact lapses at some point: ${lapsers}/${N}${lapsers ? `, earliest lapse at substep ${firstLapse}` : ''}`);
console.log(`  poses whose contact lapses BEFORE that pose is thrown: ${lapseBeforeThrow}/${N}`);
