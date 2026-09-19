// Falsification pass over --dead-batch's certified rows: the ENGINE itself plays N random legal
// moves from the claimed dead pose and every one must end in a throw. A disagreement is a bug in
// the certificate, not a rounding, so it is recorded loudly and the row is not carried forward.
//   node nn/verify-dead.js <in.jsonl> <out.jsonl> [N=40] [shard] [nShards]
'use strict';
const fs = require('fs');
const FW = require('./forced-win.js');
const [, , inPath, outPath, nArg, shardArg, shardsArg] = process.argv;
const N = +(nArg || 40), shard = +(shardArg || 0), shards = +(shardsArg || 1);

const rows = fs.readFileSync(inPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  .filter(r => r.status === 'dead' || r.certified === true);
// dedupe on the pose key, keeping the first
const seen = new Set(), uniq = [];
for (const r of rows) { const k = r.p.map(x => (+x).toFixed(4)).join(',') + '|' + r.mover; if (seen.has(k)) continue; seen.add(k); uniq.push(r); }
const mine = uniq.filter((_, i) => i % shards === shard);
console.log(`${rows.length} certified rows, ${uniq.length} distinct poses, shard ${shard}/${shards}: ${mine.length} to check with ${N} random moves each`);

let pass = 0, fail = 0;
for (const r of mine) {
  const pieces = [{ x: r.p[0], y: r.p[1], rot: r.p[2] }, { x: r.p[3], y: r.p[4], rot: r.p[5] }];
  const t0 = Date.now();
  const c = FW.simCheckDead(pieces, r.mover, N);
  const ok = c.agree === c.n;
  ok ? pass++ : fail++;
  fs.appendFileSync(outPath, JSON.stringify({
    p: r.p, mover: r.mover, k: r.k, g: r.g, file: r.file,
    worstMargin: r.worstMargin, screenMinBest: r.screenMinBest, slivers: r.slivers || 0,
    probedSlivers: r.probedSlivers || 0, certSeconds: r.seconds,
    engine: { n: c.n, agree: c.agree, fails: (c.fails || []).slice(0, 3) },
    engineAgreed: ok, checkSeconds: +((Date.now() - t0) / 1000).toFixed(1), stamp: new Date().toISOString(),
  }) + '\n');
  if (!ok) console.log(`CONTRADICTED ${r.g}: engine ${c.agree}/${c.n} -- ${JSON.stringify((c.fails || []).slice(0, 2))}`);
}
console.log(`shard ${shard}: ${pass} agreed, ${fail} contradicted`);
