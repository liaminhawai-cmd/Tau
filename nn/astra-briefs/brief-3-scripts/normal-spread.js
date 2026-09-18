// True spread of the contact normal over a box of victim start poses, interior contact versus
// during the park, on the search's grid. Checks the claim that a park's normal is translation-
// sensitive where an interior contact's is not.
const C = require('../contact-law.js');
const DEG = Math.PI / 180, { REPLICA } = C;
const blue0 = { x: -24.31126879077936, y: -37.34799285619334, rot: 1.3448263401595464 };
const red0  = { x: -11.7593, y: -23.2838, rot: 2.9442 };
const P = { x: -34.40582386831619, y: -18.75456367565295 };
const rotAbout = (p, a) => { const c = Math.cos(a), s = Math.sin(a), rx = p.x - P.x, ry = p.y - P.y;
  return { x: P.x + rx * c - ry * s, y: P.y + rx * s + ry * c, rot: p.rot + a }; };
const BOX = +(process.argv[2] || 0.0005), ROT = +(process.argv[3] || 0.002) * DEG, N = +(process.argv[4] || 120);
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };

const byK = new Map();                                    // substep -> list of {n3, pose}
for (let i = 0; i < N; i++) {
  const q0 = { x: blue0.x + BOX * rnd(), y: blue0.y + BOX * rnd(), rot: blue0.rot + ROT * rnd() };
  let opp = { ...q0 }, act = { ...red0 };
  for (let call = 0; call < 46; call++) {
    const o = C.swing([opp, act], 1, 0, -1, 1 * DEG, { ...REPLICA, trace: true, record: true });
    for (const t of o.trace) {
      const k = call * 3 + Math.round(t.alpha / (DEG / 3));
      const nz = Math.sqrt(Math.max(0, 1 - t.hf * t.hf));
      const n3 = [t.hf * t.nx, t.hf * t.ny, nz];
      if (!byK.has(k)) byK.set(k, []);
      byK.get(k).push({ n3, x: t.opp.x, y: t.opp.y });
    }
    opp = { x: o.opp.x, y: o.opp.y, rot: o.opp.rot }; act = rotAbout(red0, -(call + 1) * DEG);
  }
}
const spreadOf = k => {
  const rows = byK.get(k); if (!rows || rows.length < 2) return null;
  let wide = 0; for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const d = rows[i].n3[0] * rows[j].n3[0] + rows[i].n3[1] * rows[j].n3[1] + rows[i].n3[2] * rows[j].n3[2];
    wide = Math.max(wide, Math.acos(Math.min(1, d))); }
  let pos = 0; for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++)
    pos = Math.max(pos, Math.hypot(rows[i].x - rows[j].x, rows[i].y - rows[j].y));
  return { n: rows.length, cone: wide / DEG, pose: pos };
};
console.log(`box +-${BOX}u / +-${(ROT/DEG).toFixed(4)} deg, ${N} poses`);
console.log('substep  regime    poses  hub spread (u)  normal cone (deg)');
for (const k of [40, 50, 60, 70, 72, 73, 74, 76, 80, 84, 90, 96]) {
  const s = spreadOf(k); if (!s) continue;
  const regime = k <= 72 ? 'interior' : k === 73 ? 'combined' : 'park    ';
  console.log(`${String(k).padStart(5)}    ${regime}  ${String(s.n).padStart(4)}   ${s.pose.toFixed(6)}        ${s.cone.toFixed(4)}`);
}
