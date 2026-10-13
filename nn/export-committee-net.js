// Shrinks a trained value net from its training-format JSON (full double-precision text, ~17
// bytes/number -- fine on a training box, ~45MB for the committee's own 400x9 nets) down to what
// the shipped game actually fetches: a small JSON header (sizes/fanIns/topology -- everything that
// ISN'T a bulk number) plus a raw Float32LE binary blob of every weight and bias in layer order,
// 4 bytes/number. Read back by index.html's committeeLoadNet(), which is the one other place that
// has to agree with this file's layer order and dtype.
//
//   node nn/export-committee-net.js nn/medals/pw0dv6b4/gold.json committee/gold
//
// writes committee/gold.meta.json + committee/gold.bin next to whatever output path is given.
'use strict';
const fs = require('fs');
const path = require('path');

function main() {
  const [inPath, outBase] = process.argv.slice(2);
  if (!inPath || !outBase) { console.error('usage: node export-committee-net.js <in.json> <out/base>'); process.exit(1); }
  const j = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  if (!Array.isArray(j.sizes) || !Array.isArray(j.W) || !Array.isArray(j.b))
    throw new Error(inPath + ' does not look like a value net (missing sizes/W/b)');
  const fanIns = Array.isArray(j.fanIns) ? j.fanIns : j.sizes.slice(0, -1);
  const layers = j.W.length;
  // Every layer's W then every layer's b, in order -- the one layout committeeLoadNet must mirror.
  const chunks = [];
  let total = 0;
  for (let l = 0; l < layers; l++) { const a = Float32Array.from(j.W[l]); chunks.push(a); total += a.length; }
  for (let l = 0; l < layers; l++) { const a = Float32Array.from(j.b[l]); chunks.push(a); total += a.length; }
  const out = new Float32Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  const meta = { sizes: j.sizes, fanIns, topology: j.topology || null };
  fs.mkdirSync(path.dirname(outBase), { recursive: true });
  fs.writeFileSync(outBase + '.meta.json', JSON.stringify(meta));
  fs.writeFileSync(outBase + '.bin', Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  const inBytes = fs.statSync(inPath).size, outBytes = fs.statSync(outBase + '.bin').size + fs.statSync(outBase + '.meta.json').size;
  console.log(`[export-committee-net] ${inPath} -> ${outBase}.{meta.json,bin}: ${(inBytes/1e6).toFixed(1)}MB -> ${(outBytes/1e6).toFixed(1)}MB`);
}
main();
