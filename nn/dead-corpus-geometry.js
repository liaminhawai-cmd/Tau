'use strict';
// How big is the certified dead set, and how far apart are its pieces?
//
//   node nn/dead-corpus-geometry.js [--corpus docs/dead-regions] [--query <file.jsonl>]
//
// The question "would a lookup table over the certified corpus make a rung stronger" does not
// need a game to answer it. It needs the corpus measured in the metric its own certificates are
// issued in: L1 over both pieces, rotation carried as arc length (R = 23.095u), which is what
// forced-win.js certifies in and what index.html's deadPieceDist implements.
//
// Each ball in dead-balls.jsonl was grown from a point in dead-points-mined.jsonl, so the two
// files share positions; they are merged here and counted once, the ball's eps attaching to its
// seed point. Points with no ball carry radius 0 -- they have no certified radius, and giving them
// one is the over-claim this script exists to make visible.
const fs = require('fs');
const path = require('path');
const R = 23.095;                       // CFG.footR: rotation as foot-travel arc length
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const corpusDir = path.resolve(arg('corpus', path.join(__dirname, '..', 'docs', 'dead-regions')));

const load = p => fs.readFileSync(p, 'utf8').split('\n')
  .filter(l => l.trim() && !l.startsWith('#')).map(l => JSON.parse(l));
const norm = a => { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; };
const pieceDist = (p, q, o) => Math.hypot(p[o] - q[o], p[o+1] - q[o+1]) + R*Math.abs(norm(p[o+2] - q[o+2]));
const jointDist = (p, q) => pieceDist(p, q, 0) + pieceDist(p, q, 3);
const quant = (xs, f) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f*s.length))]; };
const fmt = xs => `min ${Math.min(...xs).toFixed(2)}u  p05 ${quant(xs,.05).toFixed(2)}u  median ${quant(xs,.5).toFixed(2)}u  ` +
                  `p95 ${quant(xs,.95).toFixed(2)}u  max ${Math.max(...xs).toFixed(2)}u`;

const pts = load(path.join(corpusDir, 'dead-points-mined.jsonl'));
const balls = load(path.join(corpusDir, 'dead-balls.jsonl'));
// merge on the pose itself, so a ball and the point it was grown from are one entry
const key = d => d.p.map(v => v.toFixed(4)).join(',') + '|' + d.mover;
const byKey = new Map();
for (const d of pts) byKey.set(key(d), { p: d.p, mover: d.mover, eps: 0 });
for (const b of balls) {
  const k = key(b), cur = byKey.get(k);
  if (cur) cur.eps = Math.max(cur.eps, b.eps);
  else byKey.set(k, { p: b.p, mover: b.mover, eps: b.eps });
}
const corpus = [...byKey.values()];
const withEps = corpus.filter(c => c.eps > 0);
const radii = withEps.map(c => c.eps);
console.log(`${corpus.length} distinct certified dead positions (${pts.length} points + ${balls.length} balls, merged on pose)`);
console.log(`${withEps.length} of them carry a certified radius: min ${Math.min(...radii)}u, ` +
            `median ${quant(radii, .5)}u, max ${Math.max(...radii)}u`);
console.log(`${corpus.length - withEps.length} carry NO certified radius ("ball": null) -- radius 0, not 1.0\n`);

// 1. how far apart are the certified positions themselves?
const nn = [];
for (let i = 0; i < corpus.length; i++) {
  let best = Infinity;
  for (let j = 0; j < corpus.length; j++)
    if (i !== j && corpus[j].mover === corpus[i].mover) best = Math.min(best, jointDist(corpus[i].p, corpus[j].p));
  if (Number.isFinite(best)) nn.push(best);
}
console.log('nearest-neighbour joint L1 distance between certified positions of the SAME mover:');
console.log('  ' + fmt(nn));
for (const bar of [1.0, 5.0, Math.max(...radii)*2])
  console.log(`  within ${bar.toFixed(2)}u of another: ${nn.filter(x => x <= bar).length} of ${nn.length}`);

// 2. do any two certified balls overlap?
let overlap = 0, near = 0;
for (let i = 0; i < withEps.length; i++) for (let j = i + 1; j < withEps.length; j++) {
  if (withEps[i].mover !== withEps[j].mover) continue;
  const d = jointDist(withEps[i].p, withEps[j].p), sum = withEps[i].eps + withEps[j].eps;
  if (d <= sum) overlap++;
  if (d <= 2*sum) near++;
}
console.log(`\ncertified balls that overlap (distance <= sum of radii): ${overlap}`);
console.log(`certified balls within twice the sum of their radii:     ${near}`);

// 3. ambient 6-volume, on Astra's Vol6 = (pi^2/45) * eps^6, against a crude box for reachable space
const vol = radii.reduce((a, e) => a + (Math.PI**2/45)*Math.pow(e, 6), 0);
const box = Math.pow(Math.PI*66.667*66.667, 2) * Math.pow(2*Math.PI*R, 2);
console.log(`\ncertified 6-volume  sum (pi^2/45)*eps^6 = ${vol.toExponential(6)} u^6`);
console.log(`crude reachable box (two hub discs x two full rotations) = ${box.toExponential(3)} u^6`);
console.log(`coverage ratio ~ ${(vol/box).toExponential(2)}  (order of magnitude only -- the box mixes a`);
console.log(`Euclidean disc with an L1 ball; the separation above needs no such modelling)`);

// 4. optional: how close does real play come?
const qf = arg('query', path.join(corpusDir, 'screened-not-dead.jsonl'));
if (fs.existsSync(qf)) {
  const q = load(qf);
  const d = [];
  let inCert = 0, inShipped = 0;
  for (const s of q) {
    let best = Infinity, hitC = false, hit1 = false;
    for (const c of corpus) {
      if (c.mover !== s.mover) continue;
      const dd = jointDist(s.p, c.p);
      if (dd < best) best = dd;
      if (dd <= c.eps) hitC = true;
      if (dd <= 1.0) hit1 = true;
    }
    if (Number.isFinite(best)) d.push(best);
    if (hitC) inCert++;
    if (hit1) inShipped++;
  }
  console.log(`\n${q.length} query positions from ${path.basename(qf)}`);
  console.log('  nearest joint distance to any same-mover certified entry:');
  console.log('  ' + fmt(d));
  console.log(`  inside a certified ball (its own eps):        ${inCert} / ${q.length}`);
  console.log(`  inside index.html's shipped DEAD_CERT_EPS=1.0: ${inShipped} / ${q.length}`);
}
