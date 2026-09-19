// A dead POINT becomes a dead BALL: forced-win.js --star at the largest half-box h that the
// reach envelopes accept, falling back down a ladder when an envelope refuses (two stopping
// events inside the box -- the limit is continuous only between events, so the box straddles a
// wall and must shrink or be split). Each ball is engine-checked inside --star itself; a
// contradiction exits 2 and is recorded, never swallowed.
//   node nn/star-drive.js <verified.jsonl> <graph-out.jsonl> <log.jsonl> [shard] [nShards] [maxSeconds]
'use strict';
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const [, , inPath, graphPath, logPath, shardArg, shardsArg, budgetArg] = process.argv;
const shard = +(shardArg || 0), shards = +(shardsArg || 1), budget = +(budgetArg || Infinity);
const HS = [0.35, 0.25, 0.175, 0.125, 0.08, 0.05];
const FW = path.join(__dirname, 'forced-win.js');

const rows = fs.readFileSync(inPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  .filter(r => r.engineAgreed === true);
const mine = rows.filter((_, i) => i % shards === shard);
console.log(`${rows.length} engine-agreed dead points, shard ${shard}/${shards}: ${mine.length} to star`);

const t0 = Date.now();
let done = 0, balls = 0;
for (const r of mine) {
  if ((Date.now() - t0) / 1000 > budget) { console.log(`budget reached after ${done} points`); break; }
  const pose = r.p.map(x => +(+x).toFixed(4)).join(',');
  let got = null, tried = [];
  for (const h of HS) {
    let out = '', code = 0;
    try {
      out = execFileSync(process.execPath, [FW, '--star', pose, '--mover', String(r.mover), '--h', String(h),
        '--out', graphPath, '--seed', `mined-${r.g || 'x'}`], { encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 26 });
    } catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.status == null ? -1 : e.status; }
    const line = out.split('\n').filter(Boolean).pop() || '';
    tried.push({ h, code, tail: line.slice(0, 180) });
    if (code === 2) { console.log(`CONTRADICTED at h=${h} for ${r.g}: ${out.slice(-400)}`); break; }
    if (code === 0) {
      const m = /appended (\S+) \(plies 2, side (\d+), eps ([\d.]+)u, W ([\d.]+)u\)/.exec(out);
      const eng = /engine: (\d+)\/(\d+) random poses/.exec(out);
      if (m) { got = { h, id: m[1], eps: +m[3], W: +m[4], engineAgree: eng ? +eng[1] : null, engineN: eng ? +eng[2] : null }; balls++; }
      break;                                        // exit 0 with no append = already in the graph
    }
  }
  done++;
  fs.appendFileSync(logPath, JSON.stringify({ p: r.p, mover: r.mover, g: r.g, file: r.file,
    worstMargin: r.worstMargin, ball: got, tried, stamp: new Date().toISOString() }) + '\n');
  console.log(`${done}/${mine.length} ${r.g}: ${got ? `ball ${got.id} h=${got.h} eps=${got.eps.toFixed(3)}u W=${got.W.toFixed(2)}u engine ${got.engineAgree}/${got.engineN}` : `no ball (${tried.map(t => t.h + ':' + t.code).join(' ')})`}   ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
console.log(`shard ${shard}: ${balls} dead balls from ${done} points`);
