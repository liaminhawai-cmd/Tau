// Renders Tau's Steam store screenshots and art on THIS machine's GPU, with the game's own path
// tracer (the Steam build's Ultra tier). Run through STEAM-SHOTS.bat; plain `node shots.mjs` works too.
//
//   node shots.mjs                  everything (screenshots + key art + composed store images)
//   node shots.mjs --only shots     just the gameplay screenshots
//   node shots.mjs --only art       just the key art and the composed capsules
//   node shots.mjs --samples 512    more path-tracing samples per image (default 384; slower, cleaner)
//   node shots.mjs --boards sumo,noir   screenshots of these boards only
//   node shots.mjs --raster         skip ray tracing (the High raster tier) -- quicker, and what most players see
//   node shots.mjs --scale 1        screenshots at 1920x1080 instead of the default 2x (3840x2160, sharper)
//
// It drives the Edge or Chrome already installed here (no browser download), in a visible window so
// you can watch it, and serves the game from this checkout on a private localhost port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'output');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const ONLY = arg('only', 'all');
const SAMPLES = +arg('samples', 384);
const RASTER = argv.includes('--raster');
const TIMEOUT_S = +arg('timeout', 600);
const SCALE = +arg('scale', 2);   // screenshots render at 1920x1080 x SCALE: 2 = 4K, crisper edges and detail
const REPORT = [];

// ---------- what to shoot ----------
const POSES = { a: [[-14, 10, 0.4], [16, -6, 3.3]], b: [[-22, -8, -0.5], [-4, -14, 2.6]], c: [[6, 14, 1.2], [20, 4, 4.4]],
                g: [[-12, 3, 0.2], [12, -2, 3.3]] };
const SHOTS = [['sumo', 'a'], ['marble', 'b'], ['alien', 'c'], ['colossus', 'a'], ['noir', 'b'], ['dojo', 'c'],
               ['ebony', 'a'], ['slate', 'b'], ['cosy', 'c'], ['math', 'a']];
const ART = [   // raw renders at 2x the Steam size; composed and scaled down below
  { name: 'main',     board: 'sumo',     W: 2464, H: 1412, cam: [44, 24, 84],  tgt: [-20, 13, -4], fov: 33 },
  { name: 'header',   board: 'sumo',     W: 1840, H: 860,  cam: [48, 22, 84],  tgt: [-40, 13, -4], fov: 30 },
  { name: 'vertical', board: 'sumo',     W: 1496, H: 1792, cam: [30, 30, 112], tgt: [0, 34, -4],   fov: 40 },
  { name: 'libcap',   board: 'sumo',     W: 1200, H: 1800, cam: [30, 34, 128], tgt: [0, 38, -4],   fov: 40 },
  { name: 'hero',     board: 'colossus', W: 3840, H: 1240, cam: [0, 18, 96],   tgt: [4, 19, 0],    fov: 30 },
];

// ---------- a tiny static server over this checkout ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.bin': 'application/octet-stream', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// ---------- browser ----------
async function launch() {
  const args = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  const headless = process.env.HEADLESS === '1';
  if (process.env.TAU_BROWSER) return chromium.launch({ executablePath: process.env.TAU_BROWSER, headless, args });
  for (const channel of ['msedge', 'chrome']) {
    try { const b = await chromium.launch({ channel, headless, args }); console.log(`Using ${channel}.`); return b; }
    catch (e) { /* try the next */ }
  }
  throw new Error('Neither Microsoft Edge nor Google Chrome could be started. Install one and run again.');
}
const browser = await launch();
fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'store'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'library'), { recursive: true });

async function openGame(W, H, dpr = 1) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  await p.addInitScript(({ samples, pixels, raster }) => {
    window.TAU_SHOT = { samples, pixels };
    try {
      const k = 'tauDesktopSettingsV1', s = JSON.parse(localStorage.getItem(k) || '{}');
      s.quality = raster ? 'high' : 'ultra'; s.qualityPicked = true; s.rayTrace = !raster; s.reducedMotion = true;
      localStorage.setItem(k, JSON.stringify(s));
    } catch (_) {}
  }, { samples: SAMPLES, pixels: W * H * dpr * dpr + 1, raster: RASTER });
  await p.goto(BASE + 'index.html?steam=1&premium=1');
  if (!REPORT.gpu) { REPORT.gpu = await p.evaluate(() => { try { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; } catch (_) { return 'unknown'; } }); console.log('GPU: ' + REPORT.gpu); REPORT.push('GPU: ' + REPORT.gpu); }
  await p.waitForFunction(() => window.tauDesktop && typeof startGame === 'function', null, { timeout: 60000 });
  await p.waitForTimeout(4000);
  // Pin the camera, when asked, at the last moment before every frame is drawn: the game's own
  // framing runs first each frame and this simply overrides it, so the traced picture holds still.
  await p.evaluate(() => {
    const orig = tauDesktop.renderFrame;
    tauDesktop.renderFrame = function () {
      const c = window.__lockCam;
      if (c) { camera.clearViewOffset && camera.clearViewOffset(); camera.fov = c.fov; camera.aspect = innerWidth / innerHeight;
        camera.up.set(0, 1, 0); camera.position.set(...c.cam); camera.lookAt(...c.tgt); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); }
      return orig.apply(this, arguments);
    };
  });
  return { p, ctx };
}

async function setScene(p, board, pose) {
  await p.evaluate(board => { if (typeof hideModal === 'function') hideModal(); tauDesktop.board = board; startGame(true, 0, 'easy'); }, board);
  await p.waitForTimeout(2500);
  await p.evaluate(q => {
    if (typeof hideModal === 'function') hideModal();
    for (let i = 0; i < 2; i++) { G.pieces[i].x = q[i][0]; G.pieces[i].y = q[i][1]; G.pieces[i].rot = q[i][2]; }
    G.pinned = null; G.active = 0;
    if (typeof camCenterFrac !== 'undefined') { camCenterFrac = 1; camManualSet = false; }
    if (typeof resize === 'function') resize();
  }, pose);
}

// Wait for the traced frame to reach its sample count (or give up at the timeout and take it anyway).
async function waitForTrace(p, label) {
  if (RASTER) { await p.waitForTimeout(8000); return 'raster'; }
  const t0 = Date.now(); let last = -1;
  for (;;) {
    const st = await p.evaluate(() => ({ phase: tauDesktop.rayTraceStatus(), n: tauDesktop.rayTraceSamples(), rt: tauDesktop.rayTrace }));
    if (st.phase === 'failed' || !st.rt) { console.log(`  ${label}: ray tracing is not running on this GPU -- taking the raster frame`); await p.waitForTimeout(4000); return 'raster'; }
    if (st.n >= SAMPLES) return `${st.n} samples`;
    if (st.n !== last && st.n > 0 && (st.n % 32 === 0 || st.n - last >= 32)) { process.stdout.write(`  ${label}: ${st.n}/${SAMPLES} samples\r`); last = st.n; }
    if ((Date.now() - t0) / 1000 > TIMEOUT_S) return `timed out at ${st.n} samples`;
    await p.waitForTimeout(1000);
  }
}

const t0 = Date.now();
// ---------- gameplay screenshots (UI included: this is what the game looks like) ----------
if (ONLY === 'all' || ONLY === 'shots') {
  const want = arg('boards', null); const list = want ? SHOTS.filter(([b]) => want.split(',').includes(b)) : SHOTS;
  const { p, ctx } = await openGame(1920, 1080, SCALE);
  for (const [board, pose] of list) {
    await setScene(p, board, POSES[pose]);
    await p.waitForTimeout(6000);   // let the game's own camera settle on the new position
    // The game's own camera is left alone: once it has settled it holds still, which is all the
    // tracer needs (it refines exactly the frames a player would see while thinking).
    const how = await waitForTrace(p, board);
    const file = path.join(OUT, 'screenshots', `tau-${board}.png`);
    await p.screenshot({ path: file, timeout: 0 });
    console.log(`  screenshot ${board}  (${how})                    `);
    REPORT.push(`screenshot ${board}: ${how}`);
  }
  await ctx.close();
}

// ---------- key art: clean renders (no UI), then composed into the Steam slots ----------
if (ONLY === 'all' || ONLY === 'art') {
  const raws = {};
  for (const A of ART) {
    const { p, ctx } = await openGame(A.W, A.H);
    await p.addStyleTag({ content: 'body *{visibility:hidden!important} #view3d,#view3d *{visibility:visible!important} #bootSplash{display:none!important}' });
    await setScene(p, A.board, POSES.g);
    await p.evaluate(A => { window.__lockCam = { cam: A.cam, tgt: A.tgt, fov: A.fov }; }, A);
    await p.waitForTimeout(3000);
    const how = await waitForTrace(p, A.name);
    const file = path.join(OUT, 'raw', `${A.name}.png`);
    await p.screenshot({ path: file, timeout: 0 });
    raws[A.name] = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
    console.log(`  key art ${A.name} ${A.W}x${A.H}  (${how})                    `);
    REPORT.push(`key art ${A.name}: ${how}`);
    await ctx.close();
  }
  // Compose in a plain page with a 2D canvas: logo with a soft shadow, scaled down 2x for crispness.
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await p.goto(BASE + 'tau-logo.png');
  const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'tau-logo.png')).toString('base64');
  const out = await p.evaluate(async ({ raws, logo }) => {
    const img = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const L = await img(logo);
    // the logo's own transparent margin, trimmed
    const t = document.createElement('canvas'); t.width = L.width; t.height = L.height; const tc = t.getContext('2d'); tc.drawImage(L, 0, 0);
    const d = tc.getImageData(0, 0, L.width, L.height).data; let x0 = L.width, y0 = L.height, x1 = 0, y1 = 0;
    for (let y = 0; y < L.height; y++) for (let x = 0; x < L.width; x++) if (d[(y * L.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const LW = x1 - x0 + 1, LH = y1 - y0 + 1;
    const make = (W, H) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; return [c, g]; };
    const logoAt = (g, w, x, y) => { const h = LH * w / LW; g.save(); g.shadowColor = 'rgba(0,0,0,.78)'; g.shadowBlur = Math.max(8, w / 22); g.shadowOffsetY = Math.max(2, w / 160);
      g.drawImage(L, x0, y0, LW, LH, x, y, w, h); g.restore(); g.drawImage(L, x0, y0, LW, LH, x, y, w, h); return h; };
    const R = {}; for (const k in raws) R[k] = await img(raws[k]);
    const png = c => c.toDataURL('image/png');
    const res = {};
    { const [c, g] = make(920, 430); g.drawImage(R.header, 0, 0, 920, 430); logoAt(g, 380, 34, 40); res['store/header_capsule_920x430.png'] = res['library/library_header_920x430.png'] = png(c); }
    { const [c, g] = make(1232, 706); g.drawImage(R.main, 0, 0, 1232, 706); logoAt(g, 540, 52, 56); res['store/main_capsule_1232x706.png'] = png(c); }
    { const [c, g] = make(748, 896); g.drawImage(R.vertical, 0, 0, 748, 896); logoAt(g, 600, 74, 96); res['store/vertical_capsule_748x896.png'] = png(c); }
    { const [c, g] = make(600, 900); g.drawImage(R.libcap, 0, 0, 600, 900); logoAt(g, 500, 50, 110); res['library/library_capsule_600x900.png'] = png(c); }
    { const [c, g] = make(462, 174); const src = R.header, sw = src.width * 0.5, sh = sw * 174 / 462, sx = (src.width - sw) * 0.8, sy = (src.height - sh) * 0.35;
      g.filter = 'blur(3px) brightness(0.38)'; g.drawImage(src, sx, sy, sw, sh, -6, -6, 474, 186); g.filter = 'none';
      const w = 372; logoAt(g, w, (462 - w) / 2, (174 - LH * w / LW) / 2); res['store/small_capsule_462x174.png'] = png(c); }
    { const [c, g] = make(3840, 1240); g.drawImage(R.hero, 0, 0); res['library/library_hero_3840x1240.png'] = png(c); }
    return res;
  }, { raws, logo });
  for (const [rel, data] of Object.entries(out)) fs.writeFileSync(path.join(OUT, rel), Buffer.from(data.split(',')[1], 'base64'));
  await ctx.close();
  console.log('  composed the store and library images');
}

await browser.close(); server.close();
fs.writeFileSync(path.join(OUT, 'report.txt'), [`Tau steam-shots  ${new Date().toISOString()}`,
  `mode: ${RASTER ? 'raster (High)' : 'ray traced (Ultra), target ' + SAMPLES + ' samples'}, screenshots at ${1920 * SCALE}x${1080 * SCALE}`, '', ...REPORT, ''].join('\n'));
console.log(`\nDone in ${Math.round((Date.now() - t0) / 60000)} min. Everything is in:\n  ${OUT}`);
