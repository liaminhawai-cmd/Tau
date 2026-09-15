// Turn a brain-map .bin sweep into a PNG, so the thing the whole study is about can actually be
// looked at rather than only tabulated.
//
// WHY INDEXED (colour type 3) AND WHY FULL RESOLUTION
// The subject of these pictures is the FINE TEXTURE. Downsampling a 1024^2 sweep to fit a page is
// a box blur, which removes precisely the thing the reader is being asked to look at, so the pixels
// stay 1:1 with the sweep. That costs file size, and an RGBA PNG of a rough field is megabytes. A
// 256-entry palette gives the same picture at a quarter of the raw bytes and deflates far better,
// because a palette index is one byte and neighbouring cells usually land on the same index.
// Index 0 is reserved for "outside the legal disc" and made transparent via tRNS, so the mask reads
// as page background rather than as a value.
//
// Each map is scaled to ITS OWN range by default. That is the right default for comparing texture
// across a capacity ladder -- an untrained net's output spans 0.09 and a champion's 0.72, so a
// shared scale would render the untrained map as a flat grey rectangle and hide the finding that
// its texture is identical. The range used is printed, and belongs in any caption.
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const A = require('./map-analyze.js');

// ---- PNG ----------------------------------------------------------------------------------
let CRC = null;
function crc32(buf) {
  if (!CRC) {
    CRC = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function pngIndexed(idx, w, h, palette) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.alloc(768);
  for (let i = 0; i < 256; i++) { plte[i*3] = palette[i][0]; plte[i*3+1] = palette[i][1]; plte[i*3+2] = palette[i][2]; }
  const trns = Buffer.from([0]);                      // index 0 fully transparent, the rest opaque
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;                             // filter: none. Palette indices do not
    idx.copy ? idx.copy(raw, y * (w + 1) + 1, y * w, y * w + w)   // benefit from delta filters, and
             : Buffer.from(idx.subarray(y * w, y * w + w)).copy(raw, y * (w + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('tRNS', trns),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- colour -------------------------------------------------------------------------------
// Diverging teal -> pale -> brick, the report page's own two accents with a neutral pivot, so a
// figure and the prose around it read as one document. Diverging rather than sequential because
// the quantity is a value FOR THE MOVER: the sign is meaningful and the midpoint is not arbitrary.
const STOPS = [
  [0.00, [ 10, 46, 43]], [0.18, [ 17, 107, 96]], [0.38, [130, 183, 172]],
  [0.50, [235, 238, 233]],
  [0.62, [214, 163, 129]], [0.82, [172,  76,  43]], [1.00, [ 74,  22,  12]],
];
function ramp(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [a, ca] = STOPS[i-1], [b, cb] = STOPS[i];
      const f = (t - a) / (b - a);
      return [0, 1, 2].map(k => Math.round(ca[k] + (cb[k] - ca[k]) * f));
    }
  }
  return STOPS[STOPS.length - 1][1];
}
function palette() {
  const p = [[0, 0, 0]];                              // index 0: the transparent mask
  for (let i = 1; i < 256; i++) p.push(ramp((i - 1) / 254));
  return p;
}

// Percentile clip, not min/max. One throw-adjacent cell or one edge artefact sets the whole scale
// otherwise, and the picture goes flat.
function limits(field, lo = 0.005, hi = 0.995) {
  const v = [];
  for (let i = 0; i < field.length; i++) if (Number.isFinite(field[i])) v.push(field[i]);
  v.sort((a, b) => a - b);
  return { lo: v[Math.floor(v.length * lo)], hi: v[Math.floor(v.length * hi)], n: v.length };
}

function render(field, res, lo, hi) {
  const idx = Buffer.alloc(res * res);
  const span = hi - lo || 1;
  for (let i = 0; i < field.length; i++) {
    if (!Number.isFinite(field[i])) { idx[i] = 0; continue; }
    const t = (field[i] - lo) / span;
    idx[i] = 1 + Math.max(0, Math.min(254, Math.round(t * 254)));
  }
  return idx;
}

// ---- cli ----------------------------------------------------------------------------------
function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

if (require.main === module) {
  const base = arg('map', null);
  if (!base) { console.error('usage: node nn/map-png.js --map nn/brain-maps/best__swing1__1024 [--rough <sigma>] [--out f.png]'); process.exit(1); }
  const m = A.loadMap(base);
  const roughSigma = arg('rough', null);
  let field = m.field, kind = 'value';
  if (roughSigma) { field = A.roughness(m.field, m.res, +roughSigma); kind = `rough(sigma=${roughSigma})`; }
  let { lo, hi } = limits(field);
  // A roughness field is signed and centred on zero; forcing the scale symmetric keeps zero on the
  // palette's neutral pivot, so "no detail here" reads as blank rather than as a colour.
  if (roughSigma) { const a = Math.max(Math.abs(lo), Math.abs(hi)); lo = -a; hi = a; }
  const out = arg('out', base + (roughSigma ? `.rough${roughSigma}` : '') + '.png');
  const png = pngIndexed(render(field, m.res, lo, hi), m.res, m.res, palette());
  fs.writeFileSync(out, png);
  console.log(`${out}  ${m.res}x${m.res}  ${kind}  range [${lo.toFixed(4)}, ${hi.toFixed(4)}]  ${(png.length/1024).toFixed(0)}KB`);
}

module.exports = { pngIndexed, palette, ramp, render, limits };
