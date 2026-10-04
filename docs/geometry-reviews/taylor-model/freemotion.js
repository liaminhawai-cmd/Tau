// Blue's reply on arm (1,-) never touches red: for every intermediate angle phi in [p0, p1] the
// Taylor-model screen finds no possible leg-leg, hub-leg or hub-hub contact with red at its seed pose.
//   node freemotion.js <p0deg> <p1deg>
'use strict';
const iv = require('./iv.js'); const { TM, setDegree } = require('./tm.js'); const P = require('./push-tm-v1.js');
setDegree(6);
const [p0, p1] = process.argv.slice(2).map(Number);
const red = P.redGeometry(P.redPose({ x: -11.7593, y: -23.2838, rot: 2.9442 }, 0, -1, 0, [0, 0]));
let cells = 0, minClear = Infinity;
function check(a0, a1, depth) {
  const am = 0.5 * a0 + 0.5 * a1, ar = iv.up(Math.max(a1 - am, am - a0));
  const k = iv.div([Math.PI, Math.PI], [180, 180]);
  const th = TM.linearI(iv.mul([am, am], k), iv.mul([ar, ar], k)), c = th.cos(), s = th.sin();
  const b = { x: -27.3934, y: -36.4088, rot: 1.2052 };
  const a = iv.add([b.rot, b.rot], P.TWO_PI_3);
  const px = iv.add([b.x, b.x], iv.mul(iv.cos(a), [P.footR, P.footR])), py = iv.add([b.y, b.y], iv.mul(iv.sin(a), [P.footR, P.footR]));
  const rx = iv.sub([b.x, b.x], px), ry = iv.sub([b.y, b.y], py);
  const st = { x: c.scaleI(rx).add(s.scaleI(ry)).addI(px), y: s.scaleI(iv.neg(rx)).add(c.scaleI(ry)).addI(py), rot: th.neg().addC(b.rot) };
  const info = { maxCand: 0 };
  let ok = true;
  try { if (P.passSlots(P.blueGeometry(st), red, info).length) ok = false; P.hubHubCheck(st, red); } catch (e) { ok = false; }
  if (ok) { cells++; return; }
  if (depth > 20) throw new Error(`possible contact near phi in [${a0}, ${a1}]`);
  check(a0, am, depth + 1); check(am, a1, depth + 1);
}
check(p0, p1, 0);
console.log(`blue's reply arm (1,-): no possible contact with red for every phi in [${p0}, ${p1}] deg (${cells} cells)`);
