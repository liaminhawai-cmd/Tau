'use strict';
// Regression probe for the interval park regime used by throw-cert's moving enclosure.
//
// This is deliberately a SMALL audit, not a proof:
//   1. replay the historical ndpxhts24 post-reply position,
//   2. find the exact victim-vertex park regimes selected by analyse(),
//   3. require parkJacobian() to use the same attacker chord that produced the regime,
//   4. require the touching leg pair (from the sweep's pushes, not from segPairs — those
//      carry chord indices a/b and vertex vk, never leg indices i/j).
//
// A future enclosure change that silently re-discovers a different chord will fail here.
//
// Usage:
//   node nn/throw-audit/park-jacobian-regime.js
// Optional:
//   POSE=x,y,rot,x,y,rot node ... <attacker> <pv> <dir> [halfU] [halfRotDeg]
const FW = require('../forced-win.js');
const TC = require('../throw-cert.js');

const DEG = Math.PI / 180;
const DEFAULT_POSE = [-24.31126879077936,-37.34799285619334,1.3448263401595464,-11.7593,-23.2838,2.9442];
const pose = process.env.POSE ? process.env.POSE.split(',').map(Number) : DEFAULT_POSE;
const attacker = +(process.argv[2] ?? 1);
const pv = +(process.argv[3] ?? 0);
const dir = +(process.argv[4] ?? -1);
const half = +(process.argv[5] ?? 0.0002);
const halfRot = +(process.argv[6] ?? 0.002) * DEG;

const pieces = FW.piecesOf(pose);
const lim = FW.limitAt(pieces, attacker, pv, dir).lim;
const steps = Math.round(lim / TC.LIM_SUB);
const tr = TC.sweep(pieces, attacker, pv, dir, steps);

let parks = 0, checked = 0, failures = [];
for (let k = 0; k < tr.length; k++) {
  const t = tr[k];
  if (!t.pushes.length) continue;
  const v = t.pose;
  const box = {
    x: [v.x - half, v.x + half],
    y: [v.y - half, v.y + half],
    rot: [v.rot - halfRot, v.rot + halfRot]
  };
  const an = TC.analyse(box, t.att, [t.pushes[0].i, t.pushes[0].j]);
  if (!an.segPairs) continue;
  for (const sp of an.segPairs.filter(s => s.exact && s.vertex === 'V' && s.vk >= 0)) {
    parks++;
    const pair = [t.pushes[0].i, t.pushes[0].j];
    if (!Number.isInteger(pair[0]) || !Number.isInteger(pair[1])) {
      failures.push({ k: k + 1, a: sp.a, b: sp.b, vk: sp.vk, why: 'probe pair is not integer' });
      continue;
    }
    const j = TC.parkJacobian(t.att, v, pair, sp.vk, box, sp.a);
    if (!j) {
      failures.push({ k: k + 1, a: sp.a, b: sp.b, vk: sp.vk, why: 'parkJacobian refused its regime chord' });
      continue;
    }
    checked++;
    if (j.seg !== sp.a) {
      failures.push({ k: k + 1, a: sp.a, got: j.seg, b: sp.b, vk: sp.vk, why: 'Jacobian chord differs from regime chord' });
    }
  }
}

console.log(JSON.stringify({
  pose,
  attacker,
  arm: [pv, dir],
  steps,
  parks,
  checked,
  failures,
  status: failures.length ? 'FAIL' : 'PASS'
}, null, 2));

if (failures.length) process.exit(1);
