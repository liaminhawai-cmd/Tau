/* The board catalogue's art, shared by the game (desktop/presentation.js) and the showcase page
   (steam.html): the procedural bakes, the per-look piece materials, the alien membrane shader and
   the per-pixel surface-detail pass. One copy, so a look cannot drift between the two pages.

   It is a factory rather than a module because the two callers get THREE differently -- the game
   has the UMD global, the showcase imports the ES module -- and CFG is each page's own. Bakes are
   done at opts.size (or a screen-appropriate default); tests pass something tiny. */
function makeShowcaseBoards(THREE, CFG, opts = {}) {
// ---- shared canvas helpers -------------------------------------------------------------------
// 4K displays get 4096px board maps so the printed lines stay crisp when the camera leans in;
// laptops keep 2048 (noise detail is generated at 2048 either way and upscaled — see noiseCanvas)
const S = opts.size || ((Math.min(screen.width, screen.height) * (devicePixelRatio || 1) >= 2000) ? 4096 : 2048);
const sc = S / (2 * CFG.edgeU), ox = S/2, oy = S/2, px = u => u * sc;
const LW = Math.max(3, px(CFG.edgeU * CFG.lineWidthFrac * 1.35));
const DOTS = [];
for (const [hx, rot] of [[-CFG.startX, 0], [CFG.startX, Math.PI]])
  for (let i = 0; i < 3; i++) {
    const th = rot + i * 2*Math.PI/3;
    DOTS.push([hx + Math.cos(th)*CFG.footR, Math.sin(th)*CFG.footR]);
  }
function canvas2d() { const cv = document.createElement('canvas'); cv.width = cv.height = S; return [cv, cv.getContext('2d')]; }
function strokeLines(c, style, width, dash) {          // the printed geometry: 2 rings + 2 lens arcs
  c.strokeStyle = style; c.lineWidth = width; c.lineCap = 'round';
  c.setLineDash(dash || []);
  for (const r of CFG.rings) { c.beginPath(); c.arc(ox, oy, px(r), 0, 7); c.stroke(); }
  for (const s of CFG.sideArcs) {
    c.beginPath(); c.arc(ox + px(s.cx), oy + px(s.cy), px(s.r), s.a0*Math.PI/180, s.a1*Math.PI/180); c.stroke();
  }
  c.setLineDash([]);
}
// Grade a painted board by the flat board's four zone values: the centre a touch lighter, each
// step outward a touch darker, and the lens segments one step darker again -- the reading aid the
// 2D board has always had (fillBoardDisc), on the finished albedo so every look keeps its own
// colour and figure. Screen for the lift, multiply for the drops; `amt` scales it (0 = flat).
// Zone values are: centre 4, mid band 3, outer band 2, minus one inside a lens circle.
function shadeZones(c, amt) {
  if (!amt) return;
  const lift = 0.07*amt, drop = [0, 0.20*amt, 0.10*amt, 0, 0];   // by value: [_, v1, v2, v3, v4]
  // Every circle starts with a moveTo: arc() otherwise joins from the path's current point with a
  // straight segment, and under even-odd clipping that stray chord becomes a hard seam across the
  // board (a diagonal line that once cut Sumo in two).
  const circle = (cx, cy, r) => { c.moveTo(cx + r, cy); c.arc(cx, cy, r, 0, 7); };
  const bandPath = b => { c.beginPath(); circle(ox, oy, px(b === 0 ? CFG.edgeU : CFG.rings[b === 1 ? 1 : 0]));
                          if (b < 2) circle(ox, oy, px(b === 0 ? CFG.rings[1] : CFG.rings[0])); };
  const lenses = () => { for (const a of CFG.sideArcs) circle(ox + px(a.cx), oy + px(a.cy), px(a.r)); };
  for (let b = 0; b < 3; b++) for (const lens of [false, true]) {
    const v = (b === 2 ? 4 : b === 1 ? 3 : 2) - (lens ? 1 : 0);
    if (v === 3) continue;
    c.save();
    bandPath(b); c.clip('evenodd');                       // the band: a disc, or a disc with a hole
    c.beginPath();
    if (lens) lenses(); else { c.rect(0, 0, S, S); lenses(); }
    c.clip('evenodd');                                    // inside the lens circles, or everything but
    if (v === 4) { c.globalCompositeOperation = 'screen'; c.fillStyle = `rgba(255,255,255,${lift})`; }
    else { c.globalCompositeOperation = 'multiply'; c.fillStyle = `rgba(0,0,0,${drop[v]})`; }
    c.fillRect(0, 0, S, S);
    c.restore();
  }
}
function noiseCanvas(amp, seed) {
  // always generated at 2048 (the per-pixel grain loop is the slow part) and upscaled to S —
  // the noise is low-frequency mood, the crispness lives in the vector linework drawn at S
  const NS = 2048;
  const cv = document.createElement('canvas'); cv.width = cv.height = NS;
  const c = cv.getContext('2d');
  c.fillStyle = '#808080'; c.fillRect(0, 0, NS, NS);
  let rng = seed || 1234567;
  const rnd = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  for (let pass = 0; pass < 3; pass++) {
    const n = 42 * (pass + 1), r0 = NS / (5 + pass * 6);
    for (let i = 0; i < n; i++) {
      const x = rnd()*NS, y = rnd()*NS, r = r0 * (0.5 + rnd()), v = rnd();
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${v>0.5?255:0},${v>0.5?255:0},${v>0.5?255:0},${amp/(pass+1)})`);
      g.addColorStop(1, 'rgba(128,128,128,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
  }
  const img = c.getImageData(0, 0, NS, NS), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const g = (rnd()-0.5)*22; d[i]+=g; d[i+1]+=g; d[i+2]+=g; }
  c.putImageData(img, 0, 0);
  if (S === NS) return cv;
  const up = document.createElement('canvas'); up.width = up.height = S;
  up.getContext('2d').drawImage(cv, 0, 0, S, S);
  return up;
}
function vignette(c, strength) {
  const vg = c.createRadialGradient(ox, oy, px(CFG.edgeU)*0.35, ox, oy, px(CFG.edgeU));
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${strength})`);
  c.fillStyle = vg; c.fillRect(0, 0, S, S);
}
const tex  = cv => { const t = new THREE.CanvasTexture(cv); t.anisotropy = 8;
  if (THREE.SRGBColorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace; else t.encoding = THREE.sRGBEncoding; return t; };
const texL = cv => { const t = new THREE.CanvasTexture(cv); t.anisotropy = 8; return t; };


// ---- materials across two THREE versions ------------------------------------------------------
const physProbe = new THREE.MeshPhysicalMaterial();
const PHYS = params => {
  const p = Object.assign({}, params);
  if (!('attenuationColor' in physProbe) && p.attenuationColor && p.color !== undefined) {
    const tint = p.attenuationColor.isColor ? p.attenuationColor : new THREE.Color(p.attenuationColor);
    p.color = new THREE.Color(p.color).lerp(tint, 0.55);       // the tint the volume can no longer add
  }
  // r128's transmission has no screen-space pass: it is alpha-blended, so glass there must be
  // flagged transparent or it renders as an opaque solid. Newer builds render it opaque on purpose.
  if (!('thickness' in physProbe) && p.transmission > 0) {
    p.transparent = true;
    // Coloured glass is glass whose volume attenuates strongly (a short attenuation distance);
    // near-clear glass attenuates over tens of units. The former keeps more body so its colour shows.
    const coloured = p.attenuationDistance !== undefined && p.attenuationDistance < 10;
    p.transmission = Math.min(p.transmission, coloured ? 0.58 : 0.86);
  }
  for (const k of Object.keys(p)) if (!(k in physProbe)) delete p[k];
  return new THREE.MeshPhysicalMaterial(p);
};
// ---- themes ----------------------------------------------------------------------------------

// ---- themes ----------------------------------------------------------------------------------
const THEMES = {

  // ============ NOIR — glass on brass-inlaid slate (the original spike) ============
  noir: {
    bg: 0x0a0c10, exposure: 1.05, bloom: [0.22, 0.5, 0.9],
    key: { color: 0xfff1dc, intensity: 2.6, pos: [70,130,45], shadow: 0.55 },
    fill:{ color: 0x8fb4ff, intensity: 0.5 },
    band: { color: 0x353a42, rough: 0.35, metal: 0.85 }, slabColor: 0x17191d, tableColor: 0x0d0f13,
    boardEnv: 0.7, bumpScale: 0.9, boardReflect: 0.34, guide: 0xf3e3c0,
    paint() {
      const [al, a] = canvas2d();
      a.fillStyle = '#23262c'; a.fillRect(0, 0, S, S);
      a.globalCompositeOperation = 'soft-light'; a.globalAlpha = 0.85;
      a.drawImage(noiseCanvas(0.12), 0, 0);
      a.globalCompositeOperation = 'source-over'; a.globalAlpha = 1;
      vignette(a, 0.34);
      strokeLines(a, 'rgba(0,0,0,0.55)', LW*1.9);
      const brass = a.createLinearGradient(0, 0, S, S);
      brass.addColorStop(0,'#a8843c'); brass.addColorStop(0.5,'#d6b567'); brass.addColorStop(1,'#a8843c');
      strokeLines(a, brass, LW);
      const dotR = Math.max(3, px(CFG.edgeU * CFG.padRadiusFrac * 1.6));
      for (const [dx,dy] of DOTS) {
        a.fillStyle='rgba(0,0,0,0.5)'; a.beginPath(); a.arc(ox+px(dx), oy+px(dy)+dotR*0.35, dotR*1.25, 0, 7); a.fill();
        a.fillStyle=brass; a.beginPath(); a.arc(ox+px(dx), oy+px(dy), dotR, 0, 7); a.fill();
      }
      const [ro, r] = canvas2d();
      r.fillStyle='#9a9a9a'; r.fillRect(0,0,S,S);
      r.globalAlpha=0.5; r.drawImage(noiseCanvas(0.12, 777), 0, 0); r.globalAlpha=1;
      strokeLines(r, '#3a3a3a', LW);
      for (const [dx,dy] of DOTS) { r.fillStyle='#3a3a3a'; r.beginPath(); r.arc(ox+px(dx), oy+px(dy), dotR, 0, 7); r.fill(); }
      const [bu, b] = canvas2d();
      b.fillStyle='#808080'; b.fillRect(0,0,S,S);
      b.globalAlpha=0.6; b.drawImage(noiseCanvas(0.10, 999), 0, 0); b.globalAlpha=1;
      strokeLines(b, '#5a5a5a', LW*1.6);
      return { albedo: al, rough: ro, bump: bu };
    },
    pieces(which) {   // glass — transmission (the expensive material; this theme is the GPU test)
      const c = which === 'blue' ? { tint:0x7aa4ee, att:0x3b74e8 } : { tint:0xee7a6f, att:0xe8483b };
      const mk = o => PHYS(Object.assign({
        color: c.tint, metalness: 0, transmission: 1.0, ior: 1.5,
        attenuationColor: new THREE.Color(c.att), emissive: new THREE.Color(c.att),
      }, o));
      return {
        // legs at grazing angles are all Fresnel: with full clearcoat/env they washed to colourless
        // chrome (phone photo) — so the legs run the attenuation much harder and the reflective
        // terms much softer, and you see INTO the glass the way you do on the face-on bead.
        leg: mk({ thickness: 11.0, attenuationDistance: 2.4, roughness: 0.12, emissiveIntensity: 0.24,
                  clearcoat: 0.45, clearcoatRoughness: 0.14, specularIntensity: 0.4, envMapIntensity: 0.3 }),
        // the bead — untouched, it reads as real glass
        hub: mk({ thickness: 5.0, attenuationDistance: 6.5, roughness: 0.12, emissiveIntensity: 0.06,
                  clearcoat: 1.0, clearcoatRoughness: 0.06, specularIntensity: 0.9, envMapIntensity: 0.8 }),
      };
    },
  },

  // ============ MATH — graphite precision: the geometry speaks for itself, nothing is written ============
  math: {
    zoneGrade: 0,   // a drafting sheet is one sheet: the live construction is its reading aid
    bg: 0x0d1017, exposure: 1.0, bloom: [0.16, 0.45, 0.88],
    key: { color: 0xffffff, intensity: 2.2, pos: [40,140,70], shadow: 0.5 },
    fill:{ color: 0xa8c8ff, intensity: 0.65 },
    band: { color: 0x20242c, rough: 0.5, metal: 0.6 }, slabColor: 0x14171d, tableColor: 0x0b0d12,
    boardEnv: 0.3, bumpScale: 0.35, boardReflect: 0.16, guide: 0xdcecff,
    paint() {
      // Pure COMPASS work, no straightedge. Every board curve is drawn as a FULL circle, but the
      // ink is nearly invisible along empty stretches and DARKENS as it approaches a point where
      // two circles cross — so the whole figure reads as a constellation of intersections, the
      // geometry lit only where curves actually meet.
      const [al, a] = canvas2d();
      a.fillStyle = '#111826'; a.fillRect(0, 0, S, S);          // dark drafting-paper blue
      a.globalAlpha = 0.2; a.drawImage(noiseCanvas(0.06), 0, 0); a.globalAlpha = 1;
      const circles = [
        { cx: 0, cy: 0, r: CFG.rings[0], ring: true },
        { cx: 0, cy: 0, r: CFG.rings[1], ring: true },
        ...CFG.sideArcs.map(s => ({ cx: s.cx, cy: s.cy, r: s.r, ring: false })),
      ];
      // every pairwise circle-circle intersection point (full circles, spans ignored)
      const X = [];
      for (let i = 0; i < circles.length; i++) for (let j = i+1; j < circles.length; j++) {
        const A = circles[i], B = circles[j];
        const dx = B.cx - A.cx, dy = B.cy - A.cy, d = Math.hypot(dx, dy);
        if (d < 1e-6 || d > A.r + B.r || d < Math.abs(A.r - B.r)) continue;
        const xx = (d*d + A.r*A.r - B.r*B.r)/(2*d), yy2 = A.r*A.r - xx*xx;
        if (yy2 < 0) continue;
        const yy = Math.sqrt(yy2), ux = dx/d, uy = dy/d;
        for (const sgn of [1, -1]) X.push({ x: A.cx + xx*ux - sgn*yy*uy, y: A.cy + xx*uy + sgn*yy*ux });
      }
      const nearX = (x, y) => {                                 // board-unit distance to the closest crossing
        let m = 1e9;
        for (const p of X) { const dd = Math.hypot(x - p.x, y - p.y); if (dd < m) m = dd; }
        return m;
      };
      const HOT = 3, COLD = 15;                                 // bright within HOT u, faded out by COLD u
      // draw each circle as many short segments, alpha & width ramping up toward crossings
      for (const c of circles) {
        const [cxp, cyp] = [ox + px(c.cx), oy + px(c.cy)];
        const steps = 900;
        let prev = null;
        for (let k = 0; k <= steps; k++) {
          const th = k/steps*Math.PI*2;
          const wx = c.cx + Math.cos(th)*c.r, wy = c.cy + Math.sin(th)*c.r;
          const cur = [cxp + Math.cos(th)*px(c.r), cyp + Math.sin(th)*px(c.r)];
          if (prev) {
            const t = Math.max(0, Math.min(1, (COLD - nearX(wx, wy)) / (COLD - HOT)));
            const s = t*t*(3 - 2*t);                            // smoothstep emphasis
            const floor = c.ring ? 0.05 : 0.02;                 // rings keep a faint readable floor
            const alpha = floor + (0.92 - floor)*s;
            a.strokeStyle = `rgba(226,240,255,${alpha.toFixed(3)})`;
            a.lineWidth = LW*(0.55 + 0.9*s);
            a.lineCap = 'round';
            a.beginPath(); a.moveTo(prev[0], prev[1]); a.lineTo(cur[0], cur[1]); a.stroke();
          }
          prev = cur;
        }
      }
      // a bright node dot right at each crossing
      for (const p of X) {
        a.fillStyle = 'rgba(232,244,255,0.95)';
        a.beginPath(); a.arc(ox + px(p.x), oy + px(p.y), Math.max(3, LW*0.9), 0, 7); a.fill();
      }
      // faint compass-centre pricks (points, not lines)
      for (const c of circles) {
        a.fillStyle = 'rgba(150,192,236,0.22)';
        a.beginPath(); a.arc(ox + px(c.cx), oy + px(c.cy), 3, 0, 7); a.fill();
      }
      vignette(a, 0.22);
      // start dots as marked points
      const dotR = Math.max(4, px(CFG.edgeU * CFG.padRadiusFrac * 1.9));
      for (const [dx,dy] of DOTS) {
        a.strokeStyle = 'rgba(226,240,255,0.85)'; a.lineWidth = 3;
        a.beginPath(); a.arc(ox+px(dx), oy+px(dy), dotR, 0, 7); a.stroke();
      }
      // rough/bump: draw the full circles uniformly so the relief roughly follows the ink
      const drawCircles = (c2, style, wid) => {
        c2.strokeStyle = style; c2.lineWidth = wid; c2.lineCap = 'round';
        for (const c of circles) { c2.beginPath(); c2.arc(ox + px(c.cx), oy + px(c.cy), px(c.r), 0, 7); c2.stroke(); }
      };
      const [ro, r] = canvas2d();
      r.fillStyle = '#8a8a8a'; r.fillRect(0, 0, S, S);          // matte paper
      drawCircles(r, '#5c5c5c', LW*0.7);
      const [bu, b] = canvas2d(); b.fillStyle = '#808080'; b.fillRect(0, 0, S, S);
      drawCircles(b, '#8c8c8c', LW*0.7);                        // ink raised a hair
      return { albedo: al, rough: ro, bump: bu };
    },
    pieces(which) {   // glazed ink ceramic — cheap, phone-friendly
      const col = which === 'blue' ? 0x2f6fd8 : 0xd8442f;
      // hubs face the camera so gloss reads as glaze; legs sit at grazing angles where
      // Fresnel would silver them — they get a duller, lower-spec variant of the same glaze
      const hub = PHYS({ color: col, metalness: 0, roughness: 0.45,
        clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.45 });
      const leg = PHYS({ color: col, metalness: 0, roughness: 0.52,
        clearcoat: 0.15, clearcoatRoughness: 0.4, envMapIntensity: 0.25, specularIntensity: 0.45 });
      return { leg, hub };
    },
  },

  // ============ SUMO — the ring at dusk: weight and ceremony, no props ============
  sumo: {
    bg: 0x17120d, exposure: 1.02, bloom: [0.15, 0.55, 0.92],
    key: { color: 0xffdfae, intensity: 2.4, pos: [95,85,30], shadow: 0.65 },
    fill:{ color: 0x7286a8, intensity: 0.35 },
    band: { color: 0x3a2b1c, rough: 0.7, metal: 0.05 }, slabColor: 0x46351f, tableColor: 0x201810,
    boardEnv: 0.4, bumpScale: 0.9, boardReflect: 0.05, guide: 0xf6dfae,
    paint() {
      const [al, a] = canvas2d();
      a.fillStyle = '#6e4a2c'; a.fillRect(0, 0, S, S);          // deep earth
      a.globalCompositeOperation = 'soft-light'; a.globalAlpha = 1;
      a.drawImage(noiseCanvas(0.14), 0, 0);
      a.globalCompositeOperation = 'source-over';
      // faint worn patches — the ring has been fought on
      let rng = 424242; const rnd = () => (rng = (rng*16807)%2147483647)/2147483647;
      for (let i = 0; i < 40; i++) {
        const x = rnd()*S, y = rnd()*S, r = 40 + rnd()*140;
        const g = a.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(46,30,16,${0.04 + rnd()*0.05})`); g.addColorStop(1, 'rgba(46,30,16,0)');
        a.fillStyle = g; a.beginPath(); a.arc(x, y, r, 0, 7); a.fill();
      }
      vignette(a, 0.42);
      // the lines as broad, calm bands of burnished sand — weight, not rope
      strokeLines(a, 'rgba(28,16,6,0.55)', LW*2.6);
      strokeLines(a, '#c89a54', LW*1.8);
      strokeLines(a, 'rgba(240,206,138,0.5)', LW*0.7);
      // start dots: plain warm marks
      const dotR = Math.max(5, px(CFG.edgeU * CFG.padRadiusFrac * 2.0));
      for (const [dx,dy] of DOTS) {
        a.fillStyle = 'rgba(28,16,6,0.45)'; a.beginPath(); a.arc(ox+px(dx), oy+px(dy)+dotR*0.3, dotR*1.25, 0, 7); a.fill();
        a.fillStyle = '#d9ae62'; a.beginPath(); a.arc(ox+px(dx), oy+px(dy), dotR, 0, 7); a.fill();
      }
      const [ro, r] = canvas2d();
      r.fillStyle = '#b0b0b0'; r.fillRect(0, 0, S, S);           // dry earth = rough
      r.globalAlpha = 0.4; r.drawImage(noiseCanvas(0.12, 555), 0, 0); r.globalAlpha = 1;
      strokeLines(r, '#7a7a7a', LW*1.8);                          // burnished bands sit glossier
      const [bu, b] = canvas2d();
      b.fillStyle = '#808080'; b.fillRect(0, 0, S, S);
      b.globalAlpha = 0.6; b.drawImage(noiseCanvas(0.12, 313), 0, 0); b.globalAlpha = 1;
      strokeLines(b, '#b4b4b4', LW*1.8);                          // bands gently raised
      return { albedo: al, rough: ro, bump: bu };
    },
    pieces(which) {   // urushi lacquer — deep indigo / vermillion, gold-warm sheen
      // deep lacquer only works face-on (the hubs); on thin grazing legs the dark diffuse
      // vanishes under Fresnel and they chrome out — legs use a lighter coat, less spec
      const hubCol = which === 'blue' ? 0x1d2854 : 0x8c1c12;
      const legCol = which === 'blue' ? 0x31488f : 0xb03220;
      const hub = PHYS({ color: hubCol, metalness: 0, roughness: 0.3,
        clearcoat: 0.55, clearcoatRoughness: 0.18, envMapIntensity: 0.5 });
      const leg = PHYS({ color: legCol, metalness: 0, roughness: 0.42,
        clearcoat: 0.22, clearcoatRoughness: 0.32, envMapIntensity: 0.2, specularIntensity: 0.5 });
      return { leg, hub };
    },
  },

  // ============ COSY — heirloom board: figured walnut + gilt inlay, satin-waxed ============
  // An expensive antique games table, not a kids' toy: deep figured walnut cut across the log,
  // the lines as thin brass/gilt marquetry inlay, a satin wax finish (not plastic gloss), and
  // turned rosewood pieces capped in aged brass.
  cosy: {
    bg: 0x1a120c, exposure: 1.04, bloom: [0.14, 0.5, 0.9],
    key: { color: 0xffcf96, intensity: 2.5, pos: [95,80,30], shadow: 0.6 },
    fill:{ color: 0x8a94b0, intensity: 0.28 },
    band: { color: 0x3a2716, rough: 0.4, metal: 0.15 }, slabColor: 0x2e1f12, tableColor: 0x241811,
    boardEnv: 0.55, bumpScale: 0.5, boardReflect: 0.16, guide: 0xe8cf9a,
    paint() {
      const [al, a] = canvas2d();
      a.fillStyle = '#4a3220'; a.fillRect(0, 0, S, S);           // dark walnut ground
      // figured walnut cut across the log: tight, richly coloured growth rings around an off-centre
      // heart, deep browns to warm amber — the crowded rings near the heart are the "figure"
      let rng = 9090909; const rnd = () => (rng = (rng*16807)%2147483647)/2147483647;
      const hx = ox + S*0.09, hy = oy - S*0.06;
      const wob = [];
      for (let k = 0; k < 5; k++) wob.push({ f: 2 + Math.floor(rnd()*5), ph: rnd()*7, amp: 0.010 + rnd()*0.022 });
      let ring = S*0.01;
      while (ring < S*0.82) {
        const dark = rnd() > 0.4, w = dark ? 2.5 + rnd()*5 : 1 + rnd()*2;
        // amber highs, near-black-brown lows — the chroma range antique walnut has, honey oak doesn't
        a.strokeStyle = dark ? `rgba(58,34,16,${0.22 + rnd()*0.18})` : `rgba(150,102,52,${0.10 + rnd()*0.12})`;
        a.lineWidth = w; a.beginPath();
        for (let t = 0; t <= 160; t++) {
          const th = t/160*Math.PI*2;
          let rr = ring;
          for (const h of wob) rr *= 1 + h.amp*Math.sin(h.f*th + h.ph + ring*0.0014);
          const x2 = hx + Math.cos(th)*rr, y2 = hy + Math.sin(th)*rr;
          t ? a.lineTo(x2, y2) : a.moveTo(x2, y2);
        }
        a.closePath(); a.stroke();
        ring += S*(0.004 + rnd()*0.010);                         // tighter spacing = finer, dearer figure
      }
      for (let i = 0; i < 55; i++) {                             // fine medullary rays / silvering
        const th = rnd()*Math.PI*2, r0 = S*(0.02 + rnd()*0.12), r1 = r0 + S*(0.08 + rnd()*0.4);
        a.strokeStyle = `rgba(176,132,74,${0.04 + rnd()*0.06})`; a.lineWidth = 1 + rnd()*2;
        a.beginPath(); a.moveTo(hx + Math.cos(th)*r0, hy + Math.sin(th)*r0);
        a.lineTo(hx + Math.cos(th)*r1, hy + Math.sin(th)*r1); a.stroke();
      }
      a.globalCompositeOperation = 'soft-light'; a.globalAlpha = 0.45;
      a.drawImage(noiseCanvas(0.07, 202), 0, 0);
      a.globalCompositeOperation = 'overlay'; a.globalAlpha = 0.3;   // warm waxed sheen pooling at centre
      const wax = a.createRadialGradient(ox, oy, 0, ox, oy, px(CFG.edgeU));
      wax.addColorStop(0, 'rgba(120,84,40,0.5)'); wax.addColorStop(1, 'rgba(0,0,0,0)');
      a.fillStyle = wax; a.beginPath(); a.arc(ox, oy, px(CFG.edgeU), 0, 7); a.fill();
      a.globalCompositeOperation = 'source-over'; a.globalAlpha = 1;
      vignette(a, 0.34);
      // the lines as inlaid brass/gilt marquetry: a dark shadow channel, then a thin bright metal line
      strokeLines(a, 'rgba(24,14,6,0.6)', LW*1.5);
      const gilt = a.createLinearGradient(0, 0, S, S);
      gilt.addColorStop(0, '#b78a44'); gilt.addColorStop(0.5, '#e8c778'); gilt.addColorStop(1, '#b78a44');
      strokeLines(a, gilt, LW*0.8);
      const dotR = Math.max(4, px(CFG.edgeU * CFG.padRadiusFrac * 1.7));
      for (const [dx,dy] of DOTS) {                              // inlaid brass studs
        a.fillStyle = 'rgba(24,14,6,0.55)'; a.beginPath(); a.arc(ox+px(dx), oy+px(dy)+dotR*0.3, dotR*1.15, 0, 7); a.fill();
        a.fillStyle = gilt; a.beginPath(); a.arc(ox+px(dx), oy+px(dy), dotR, 0, 7); a.fill();
      }
      const [ro, r] = canvas2d();
      r.fillStyle = '#7a7a7a'; r.fillRect(0, 0, S, S);           // satin wax: soft mid gloss, not lacquer
      r.globalAlpha = 0.3; r.drawImage(noiseCanvas(0.09, 404), 0, 0); r.globalAlpha = 1;
      strokeLines(r, '#4a4a4a', LW*0.8);                          // polished brass inlay reads shinier
      const [bu, b] = canvas2d();
      b.fillStyle = '#808080'; b.fillRect(0, 0, S, S);
      b.globalAlpha = 0.35; b.drawImage(noiseCanvas(0.07, 505), 0, 0); b.globalAlpha = 1;
      strokeLines(b, '#6a6a6a', LW*0.9);                          // inlay set slightly INTO the wood
      return { albedo: al, rough: ro, bump: bu };
    },
    pieces(which) {   // turned hardwood capped in aged brass — an heirloom set
      const wood = which === 'blue' ? 0x3a4a66 : 0x5e2a22;       // stained rosewood, blue/red tinted
      const brass = 0x9a7638;
      const hub = PHYS({ color: brass, metalness: 0.75, roughness: 0.42,
        clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.55 });   // aged brass bead
      const leg = PHYS({ color: wood, metalness: 0, roughness: 0.44,
        clearcoat: 0.35, clearcoatRoughness: 0.25, envMapIntensity: 0.3, specularIntensity: 0.6 });  // waxed wood
      return { leg, hub };
    },
  },

  // ============ ALIEN — foreign biology: the board is alive, the light is wrong ============
  // No little-green-men skin. The board is a subdermal membrane with a branching vein network,
  // and the printed geometry is BIOLUMINESCENT — the game lines are channels the organism lights
  // from inside (emissive map + bloom). The pieces are thin-film iridescent chitin: reflection
  // colour genuinely shifts with viewing angle (physical thin-film interference, the "weird
  // refractive index" of beetle shells and oil slicks) — strongest exactly at the grazing angles
  // that silver ordinary materials. Lighting is deliberately unnatural: a dim violet key from
  // the wrong side, an acid-teal counter light, and murk instead of air.
  alien: {
    zoneGrade: 0,   // the membrane's blotches already grade it; banding would fight them
    bg: 0x04060b, exposure: 1.05, bloom: [0.45, 0.7, 0.72],
    key: { color: 0x9d8ce8, intensity: 1.0, pos: [-70,110,-50], shadow: 0.35 },
    fill:{ color: 0x35e8c8, intensity: 0.55 },
    band: { color: 0x191324, rough: 0.35, metal: 0.25 }, slabColor: 0x110d1a, tableColor: 0x06060c,
    boardEnv: 0.25, bumpScale: 1.1, emissiveIntensity: 1.5, boardReflect: 0.28, guide: 0x8dffe8,
    // The showcase's bloom threshold lets only the brightest channels glow; the game has no bloom,
    // so the same emissive floods the whole membrane. This is the level the game applies instead.
    gameEmissive: 0.45,
    fog: { color: 0x0a0816, density: 0.0018 },
    paint() {
      // one vein network, drawn into albedo (dark), bump (raised) — precompute the segments
      let rng = 777001; const rnd = () => (rng = (rng*16807)%2147483647)/2147483647;
      const segs = [], stack = [];
      for (let i = 0; i < 24; i++)
        stack.push({ x: rnd()*S, y: rnd()*S, h: rnd()*Math.PI*2, w: 4 + rnd()*5, life: 50 + rnd()*90 });
      while (stack.length) {
        const v = stack.pop();
        while (v.life-- > 0 && v.w > 0.8) {
          const x0 = v.x, y0 = v.y;
          v.h += (rnd() - 0.5)*0.55;
          v.x += Math.cos(v.h)*9; v.y += Math.sin(v.h)*9;
          v.w *= 0.985;
          segs.push([x0, y0, v.x, v.y, v.w]);
          if (rnd() < 0.05 && stack.length < 100)
            stack.push({ x: v.x, y: v.y, h: v.h + (rnd() < 0.5 ? 0.9 : -0.9), w: v.w*0.7, life: v.life*0.7 });
        }
      }
      const drawVeins = (c, style, wMul) => {
        c.strokeStyle = style; c.lineCap = 'round';
        for (const [x0, y0, x1, y1, w] of segs) {
          c.lineWidth = Math.max(0.6, w*wMul);
          c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        }
      };
      const [al, a] = canvas2d();
      a.fillStyle = '#171226'; a.fillRect(0, 0, S, S);          // midnight flesh
      // subdermal blotches — violet and abyssal teal
      for (let i = 0; i < 70; i++) {
        const x = rnd()*S, y = rnd()*S, r = 40 + rnd()*160, teal = rnd() > 0.6;
        const g = a.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, teal ? `rgba(16,58,66,${0.06 + rnd()*0.08})` : `rgba(58,30,88,${0.05 + rnd()*0.08})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        a.fillStyle = g; a.beginPath(); a.arc(x, y, r, 0, 7); a.fill();
      }
      a.globalCompositeOperation = 'soft-light'; a.globalAlpha = 0.7;
      a.drawImage(noiseCanvas(0.12, 909), 0, 0);
      a.globalCompositeOperation = 'source-over'; a.globalAlpha = 1;
      drawVeins(a, 'rgba(20,10,32,0.55)', 1);
      vignette(a, 0.44);
      // the printed geometry sits dark in the albedo — the light comes from the emissive channels
      strokeLines(a, 'rgba(6,16,16,0.8)', LW*1.7);
      strokeLines(a, '#0e3c36', LW);
      const dotR = Math.max(4, px(CFG.edgeU * CFG.padRadiusFrac * 2.0));
      for (const [dx,dy] of DOTS) {
        a.strokeStyle = '#12433c'; a.lineWidth = 3;
        a.beginPath(); a.arc(ox+px(dx), oy+px(dy), dotR, 0, 7); a.stroke();
      }
      const [ro, r] = canvas2d();
      r.fillStyle = '#4a4a4a'; r.fillRect(0, 0, S, S);          // moist membrane = glossy
      r.globalAlpha = 0.5; r.drawImage(noiseCanvas(0.14, 606), 0, 0); r.globalAlpha = 1;
      drawVeins(r, '#5c5c5c', 1);
      strokeLines(r, '#303030', LW);                             // wet channels, glossier still
      const [bu, b] = canvas2d();
      b.fillStyle = '#808080'; b.fillRect(0, 0, S, S);
      b.globalAlpha = 0.5; b.drawImage(noiseCanvas(0.10, 505), 0, 0); b.globalAlpha = 1;
      drawVeins(b, '#9c9c9c', 1);                                // veins sit proud of the membrane
      strokeLines(b, '#5a5a5a', LW*1.4);                         // channels recessed
      // emissive: the organism lights its own geometry — layered halo + hot core
      const [em, e] = canvas2d();
      e.fillStyle = '#000000'; e.fillRect(0, 0, S, S);
      strokeLines(e, 'rgba(38,150,128,0.10)', LW*5);
      strokeLines(e, 'rgba(52,208,178,0.22)', LW*3);
      strokeLines(e, 'rgba(96,246,214,0.5)', LW*1.6);
      strokeLines(e, '#b8ffe9', LW*0.7);
      for (const [dx,dy] of DOTS) {                              // photophore pores at the start dots
        const g = e.createRadialGradient(ox+px(dx), oy+px(dy), 0, ox+px(dx), oy+px(dy), dotR*2.2);
        g.addColorStop(0, 'rgba(196,255,238,0.95)'); g.addColorStop(0.4, 'rgba(96,246,214,0.5)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        e.fillStyle = g; e.beginPath(); e.arc(ox+px(dx), oy+px(dy), dotR*2.2, 0, 7); e.fill();
      }
      return { albedo: al, rough: ro, bump: bu, emissive: em };
    },
    pieces(which) {   // thin-film iridescent chitin with a faint internal glow
      const base = which === 'blue' ? 0x24558c : 0x7c2030;      // petrol / haem — bright enough to read
      const film = which === 'blue' ? [140, 520] : [240, 700];  // nm range picks each side's shimmer
      const mk = o => PHYS(Object.assign({
        color: base, metalness: 0, iridescence: 1.0, iridescenceIOR: 1.8,
        iridescenceThicknessRange: film, emissive: new THREE.Color(base),
      }, o));
      return {
        hub: mk({ roughness: 0.18, clearcoat: 1.0, clearcoatRoughness: 0.1, emissiveIntensity: 0.22,
                  envMapIntensity: 0.7, specularIntensity: 0.8 }),
        // legs: PARTIAL thin-film only — at true grazing angles full iridescence goes white in
        // every wavelength (it replaces Fresnel entirely), so the legs run half-strength shimmer
        // over waxy chitin, rough enough to diffuse the sheath, with a stronger internal glow
        leg: mk({ iridescence: 0.45, roughness: 0.44, clearcoat: 0.2, clearcoatRoughness: 0.35,
                  emissiveIntensity: 0.3, envMapIntensity: 0.15, specularIntensity: 0.35 }),
      };
    },
  },

  // ============ COLOSSUS — two titans the size of buildings, seen from the upper seats ============
  // Enormity is all cues, not size: heavy atmospheric haze (far things fade = far things are FAR),
  // a telephoto camera high in the stands (long lens compresses = monumental), slow motion
  // (giant things move slowly — the whole sim runs at a third speed), crowd-speckled tiers for
  // scale reference, and dust hanging in the sun.
  colossus: {
    bg: 0xb9a888, exposure: 1.0, bloom: [0.12, 0.4, 0.95],
    fill:{ color: 0x9fb4d8, intensity: 0.25 },
    band: { color: 0x8a7a5e, rough: 0.95, metal: 0.0 }, slabColor: 0x7e6f54, tableColor: 0xa08b64,
    boardEnv: 0.2, bumpScale: 1.2, boardReflect: 0, guide: 0xff9c3a,
    fog: { color: 0xc6b593, density: 0.0016 },   // haze GRADES with distance — board clear, wall half-gone
    // a LOW raking sun casts long dramatic shadows across the sand — nothing says "enormous" like
    // a shadow that stretches half the arena; camera high in the far seats looking down and across
    key: { color: 0xffe0b0, intensity: 3.4, pos: [230,90,120], shadow: 0.9 },
    cam: { pos: [-150, 115, 300], target: [0, 22, 0], fov: 34 },
    simSpeed: 0.35,
    paint() {
      const [al, a] = canvas2d();
      a.fillStyle = '#b49b6d'; a.fillRect(0, 0, S, S);           // raked arena sand
      a.globalCompositeOperation = 'soft-light'; a.globalAlpha = 1;
      a.drawImage(noiseCanvas(0.15, 111), 0, 0);
      a.globalCompositeOperation = 'source-over';
      let rng = 606060; const rnd = () => (rng = (rng*16807)%2147483647)/2147483647;
      for (let i = 0; i < 50; i++) {                             // churned patches from the last bout
        const x = rnd()*S, y = rnd()*S, r = 40 + rnd()*160;
        const g = a.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(122,100,64,${0.05 + rnd()*0.07})`); g.addColorStop(1, 'rgba(122,100,64,0)');
        a.fillStyle = g; a.beginPath(); a.arc(x, y, r, 0, 7); a.fill();
      }
      vignette(a, 0.3);
      // the lines as ancient basalt inlay set into the sand
      strokeLines(a, 'rgba(40,32,22,0.5)', LW*2.4);
      strokeLines(a, '#4a4038', LW*1.7);
      strokeLines(a, 'rgba(150,138,120,0.35)', LW*0.5);          // worn top sheen
      const dotR = Math.max(5, px(CFG.edgeU * CFG.padRadiusFrac * 2.2));
      for (const [dx,dy] of DOTS) {
        a.fillStyle = 'rgba(40,32,22,0.5)'; a.beginPath(); a.arc(ox+px(dx), oy+px(dy)+dotR*0.3, dotR*1.3, 0, 7); a.fill();
        a.fillStyle = '#4a4038'; a.beginPath(); a.arc(ox+px(dx), oy+px(dy), dotR, 0, 7); a.fill();
      }
      const [ro, r] = canvas2d();
      r.fillStyle = '#c2c2c2'; r.fillRect(0, 0, S, S);           // dry sand: fully matte
      r.globalAlpha = 0.35; r.drawImage(noiseCanvas(0.12, 222), 0, 0); r.globalAlpha = 1;
      strokeLines(r, '#8a8a8a', LW*1.7);                          // stone slightly less matte
      const [bu, b] = canvas2d();
      b.fillStyle = '#808080'; b.fillRect(0, 0, S, S);
      b.globalAlpha = 0.7; b.drawImage(noiseCanvas(0.14, 333), 0, 0); b.globalAlpha = 1;
      strokeLines(b, '#565656', LW*1.7);                          // inlay recessed into the sand
      return { albedo: al, rough: ro, bump: bu };
    },
    pieces(which) {   // colossal carved STONE — not bronze figurines. Matte, unlit-looking rock with
      // flat-shaded facets (the tube's segments become chisel planes) reads as roughly-hewn granite;
      // a low env and no metalness kills the "small shiny figurine" tell entirely. Weathered pale
      // stone with a faint mineral tint carrying the blue/red identity.
      const stone = which === 'blue' ? 0x8f97a0 : 0xa8907e;   // bluish granite / warm sandstone
      const mk = () => new THREE.MeshStandardMaterial({ color: stone, metalness: 0, roughness: 0.95,
        envMapIntensity: 0.12, flatShading: true });
      return { leg: mk(), hub: mk() };
    },
    env() {   // the colosseum: tiered stands flecked with crowd, an arched outer wall, hanging dust
      const g = new THREE.Group();
      // crowd texture: rows of tiny multicoloured specks on stone — individual people at this
      // distance are two pixels wide, which is exactly what sells the size of everything else
      // person-scale specks: at these radii a spectator is ~2 units tall — big enough to read as
      // a crowd, small enough that every one of them shouts how big the arena is
      const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
      const c = cv.getContext('2d');
      c.fillStyle = '#867457'; c.fillRect(0, 0, 1024, 256);
      let rng = 121212; const rnd = () => (rng = (rng*16807)%2147483647)/2147483647;
      const hues = ['#5a4a38','#8a5b36','#4a4a52','#96826a','#3e3a34','#a8906c','#7a4438','#4e5c6a','#6d5347'];
      for (let x = 4 + rnd()*6; x < 1024; x += 9 + rnd()*8)
        if (rnd() > 0.18) {
          c.fillStyle = hues[Math.floor(rnd()*hues.length)];
          const h = 90 + rnd()*50;
          c.fillRect(x, 250 - h, 5 + rnd()*3, h);                      // body
          c.fillStyle = '#c9a882';
          c.beginPath(); c.arc(x + 3.5, 246 - h, 4.5, 0, 7); c.fill(); // head
        }
      const crowdTex = new THREE.CanvasTexture(cv);
      crowdTex.wrapS = THREE.RepeatWrapping; crowdTex.repeat.set(24, 1); crowdTex.anisotropy = 8;
      crowdTex.colorSpace = THREE.SRGBColorSpace;
      // stepped seating, seen from INSIDE the bowl: a vertical riser faced with crowd, then a
      // flat stone walkway — the step profile is what reads as architecture instead of wallpaper
      const crowdMat = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.95, side: THREE.DoubleSide });
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a8a6a, roughness: 0.95, side: THREE.DoubleSide });
      for (let i = 0; i < 7; i++) {
        const r0 = 200 + i*58, y0 = 2 + i*30;
        const riser = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, 30, 96, 1, true), crowdMat);
        riser.position.y = y0 + 15; g.add(riser);
        const walk = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 58, 96), stoneMat);
        walk.rotation.x = -Math.PI/2; walk.position.y = y0 + 30; g.add(walk);
      }
      // outer wall with dark arched openings, mostly swallowed by the haze
      const wv = document.createElement('canvas'); wv.width = 1024; wv.height = 256;
      const w = wv.getContext('2d');
      w.fillStyle = '#93835f'; w.fillRect(0, 0, 1024, 256);
      for (let x = 20; x < 1024; x += 86) {
        w.fillStyle = '#2c2618';
        w.beginPath(); w.moveTo(x, 220); w.lineTo(x, 120);
        w.arc(x + 23, 120, 23, Math.PI, 0); w.lineTo(x + 46, 220); w.closePath(); w.fill();
      }
      const wallTex = new THREE.CanvasTexture(wv);
      wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(14, 1); wallTex.anisotropy = 8;
      wallTex.colorSpace = THREE.SRGBColorSpace;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(660, 660, 240, 128, 1, true),
        new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, side: THREE.BackSide }));
      wall.position.y = 200; g.add(wall);
      // dust hanging in the raking sun — the air itself has depth, and depth reads as SIZE. Two
      // layers: a fine far haze of motes across the whole bowl, and a coarser near-camera drift of
      // bigger flecks that catch the light — the parallax between them sells the volume of air.
      const mkDust = (N, spreadR, spreadY, size, op, seed) => {
        let dr = seed; const rn = () => (dr = (dr*16807)%2147483647)/2147483647;
        const pos = new Float32Array(N*3);
        for (let i = 0; i < N; i++) {
          const th = rn()*Math.PI*2, rr = 20 + rn()*spreadR;
          pos[i*3] = Math.cos(th)*rr; pos[i*3+1] = 3 + rn()*spreadY; pos[i*3+2] = Math.sin(th)*rr;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffedc8, size, transparent: true,
          opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
      };
      const dustFar = mkDust(1100, 380, 200, 1.3, 0.16, 909);
      const dustNear = mkDust(320, 200, 90, 3.2, 0.28, 313);
      g.add(dustFar, dustNear);
      g.userData.tick = t => {
        dustFar.rotation.y = t*0.003; dustFar.position.y = Math.sin(t*0.08)*2;
        dustNear.rotation.y = -t*0.006; dustNear.position.y = Math.sin(t*0.13 + 1)*3;
      };
      return g;
    },
  },

  // ============ MARBLE — a polished stone table, the rings and dots inlaid in black marble ============
  // Surface detail is NOT in these maps: the veining, the crystalline speckle and the micro-relief
  // come from the per-pixel detail shader (DETAIL_GLSL, mode 2) so they hold at any zoom. The bake
  // here is the base tone and, above all, the MASK: the black inlay is drawn dark so the shader can
  // read "inlay or field" off the albedo's luminance and invert its palette inside the rings.
  marble: {
    bg: 0x0d0e12, exposure: 1.02, bloom: [0.12, 0.4, 0.95],
    key: { color: 0xfff4e6, intensity: 2.4, pos: [60,140,60], shadow: 0.5 },
    fill:{ color: 0xa9b8d6, intensity: 0.5 },
    band: { color: 0x17171c, rough: 0.28, metal: 0.05 }, slabColor: 0x1a1a1f, tableColor: 0x0f1013,
    boardEnv: 0.9, bumpScale: 0.5, boardReflect: 0.22, guide: 0x3a3f4a,
    detail: 'marble', hubBall: 2.0,
    paint() {
      const [al, a] = canvas2d();
      a.fillStyle = '#e9e6df'; a.fillRect(0, 0, S, S);                       // warm white stone
      a.globalCompositeOperation = 'multiply'; a.globalAlpha = 0.22;
      a.drawImage(noiseCanvas(0.35, 4242), 0, 0);                             // broad cloudiness
      a.globalCompositeOperation = 'source-over'; a.globalAlpha = 1;
      vignette(a, 0.10);
      // Black marble for the inlay: a dark stone with faint pale veins, used as the STROKE.
      const [bm, b] = canvas2d();
      b.fillStyle = '#15151a'; b.fillRect(0, 0, S, S);
      b.globalCompositeOperation = 'screen'; b.globalAlpha = 0.16;
      b.drawImage(noiseCanvas(0.5, 9191), 0, 0);
      b.globalCompositeOperation = 'source-over'; b.globalAlpha = 1;
      const inlay = a.createPattern(bm, 'no-repeat') || '#15151a';
      strokeLines(a, 'rgba(0,0,0,0.35)', LW*2.2);                             // the groove's shadow
      strokeLines(a, inlay, LW*1.7);
      const dotR = Math.max(3, px(CFG.edgeU * CFG.padRadiusFrac * 1.6));
      for (const [dx,dy] of DOTS) { a.fillStyle = inlay; a.beginPath(); a.arc(ox+px(dx), oy+px(dy), dotR, 0, 7); a.fill(); }
      const [ro, r] = canvas2d();
      r.fillStyle = '#4a4a4a'; r.fillRect(0, 0, S, S);                       // polished: low roughness
      r.globalAlpha = 0.35; r.drawImage(noiseCanvas(0.2, 313), 0, 0); r.globalAlpha = 1;
      strokeLines(r, '#3a3a3a', LW*1.7);                                      // the inlay a touch glossier
      const [bu, bb] = canvas2d();
      bb.fillStyle = '#808080'; bb.fillRect(0, 0, S, S);
      strokeLines(bb, '#6c6c6c', LW*1.9);                                     // inlay sits a hair below the field
      return { albedo: al, rough: ro, bump: bu };
    },
    pieces(which) {   // glass legs under a solid coloured ball, standing on solid coloured feet
      const tint = which === 'blue' ? 0x3b74e8 : 0xe8483b;
      // The ball and the feet: solid colour, polished. Not glass -- they are the two things that read
      // as "the piece"; everything between them is what you look through.
      const solid = PHYS({ color: tint, metalness: 0, roughness: 0.08,
        clearcoat: 1, clearcoatRoughness: 0.04, specularIntensity: 1, envMapIntensity: 1 });
      const leg = PHYS({ color: 0xf6f9ff,
        metalness: 0, roughness: 0.03, transmission: 1.0, ior: 1.52, thickness: 2.6,
        attenuationColor: new THREE.Color(0xe4ecff), attenuationDistance: 40,
        clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1 });
      installLegGradient(leg, tint);
      return { leg, hub: solid, foot: solid };
    },
  },
};
// Marble's legs are clear where they leave the ball and gain the ball's colour on the way down to
// the foot -- one glass pour with the pigment settled at the bottom. Position along the leg comes
// from the fused geometry itself: the arc's bearing from the crown (0 at the apex, 1 where the
// vertical foot begins), so the ramp follows the leg rather than the height. The tint arrives late
// (clear for the first quarter) and does three things at the foot end: the glass tints, absorbs
// more, and transmits less, so the last stretch reads as solid colour that the pin then continues.
const LEG_FOOT_TOP = 3.6;   // TRIPOD_PIN_LIFT + TRIPOD_FOOT_LEN in the game's fused tripod
function installLegGradient(material, tint) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uLegTint = { value: new THREE.Color(tint) };
    shader.uniforms.uFootTop = { value: LEG_FOOT_TOP };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vLegT; uniform float uFootTop;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' +
        '{ float u = length(position.xz); float yy = position.y - uFootTop;\n' +
        '  float a = yy > 0.0 ? atan(u, yy) : 1.5707963;\n' +
        '  vLegT = clamp(a / 1.5707963, 0.0, 1.0); }');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLegT; uniform vec3 uLegTint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n' +
        'float legG = smoothstep(0.25, 1.0, vLegT);\n' +
        'diffuseColor.rgb = mix(diffuseColor.rgb, uLegTint, legG);')
      .replace('material.transmission = transmission;', 'material.transmission = transmission * (1.0 - 0.7*legG*legG);')
      .replace('material.attenuationColor = attenuationColor;', 'material.attenuationColor = mix(attenuationColor, uLegTint, legG);')
      .replace('material.attenuationDistance = attenuationDistance;', 'material.attenuationDistance = mix(attenuationDistance, 2.5, legG);');
  };
  material.customProgramCacheKey = () => 'tau-leg-gradient';
  return material;
}
// Math theme's LIVE construction: every foot projects its pivot-sweep circle (radius footR*sqrt3
// -- where that piece's other feet could land if this foot were pinned) onto the board. A ring is
// invisible along empty stretches and darkens where it approaches a crossing with an OPPOSITE-
// colour ring or a printed board line -- computed per-pixel, so the whole construction glides
// live with every swing. closeness(other curves) does the intersection detection implicitly:
// near ring A and near curve B simultaneously = near their crossing.
const MATH_GLSL = `
uniform float uMath; uniform vec2 uFeet[6]; uniform float uRingR;
float mcurve(vec2 p, vec2 c, float r) { return abs(distance(p, c) - r); }
float mboard(vec2 p) {   // nearest printed line (full circles, as the math board draws them)
  float d = mcurve(p, vec2(0.0), uBoardGeom.x);
  d = min(d, mcurve(p, vec2(0.0), uBoardGeom.y));
  d = min(d, mcurve(p, vec2(-uBoardGeom.z, 0.0), uBoardGeom.w));
  d = min(d, mcurve(p, vec2(uBoardGeom.z, 0.0), uBoardGeom.w));
  return d;
}
`;
const MATH_PASS =
  'if (uMath > 0.5) {\n' +
  '  vec2 p = vWPos.xz;\n' +
  '  float bd = mboard(p);\n' +
  '  for (int i = 0; i < 6; i++) {\n' +
  '    float stroke = smoothstep(0.55, 0.1, mcurve(p, uFeet[i], uRingR));\n' +
  '    if (stroke < 0.004) continue;\n' +
  '    float close = smoothstep(9.0, 1.0, bd);\n' +                // near a printed line?
  '    for (int j = 0; j < 6; j++) {\n' +                          // near an opposite-colour ring?
  '      if ((i < 3) == (j < 3)) continue;\n' +
  '      close = max(close, smoothstep(9.0, 1.0, mcurve(p, uFeet[j], uRingR)));\n' +
  '    }\n' +
  '    float alpha = stroke * (0.022 + 0.9*close*close);\n' +      // invisible -> faint -> bold
  '    vec3 tint = i < 3 ? vec3(0.42, 0.64, 1.0) : vec3(1.0, 0.5, 0.42);\n' +
  '    outgoingLight += tint * alpha * 0.55;\n' +
  '  }\n' +
  '}\n';
const ALIEN_GLSL = `
uniform float uAlien; uniform float uAlienTime; varying vec3 vWPos;
float ahash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
float anoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(ahash(i),ahash(i+vec2(1.0,0.0)),u.x), mix(ahash(i+vec2(0.0,1.0)),ahash(i+vec2(1.0,1.0)),u.x), u.y); }
float afbm(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<6;i++){ s+=a*anoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
`;

// ---- per-pixel surface detail ---------------------------------------------------------------
// The bakes above are the base tone and the printed geometry. What makes a surface read as wood or
// stone when you lean a 4K display into it is finer than any texture: pores, growth rings, the
// crystalline glitter in polished marble, the veins branching into capillaries. Those are computed
// here per pixel from WORLD position, so they keep resolving however close the camera gets, and
// they drive three things at once -- the colour, the roughness, and a micro-relief on the normal
// that makes the light actually break over them. Mode 3 is the alien membrane, verbatim.
const DETAIL_GLSL = `
uniform float uDetail; uniform float uDetailTime; uniform vec3 uDetailTint;
uniform vec4 uBoardGeom;   // inner ring, outer ring, board edge (= lens-circle centre), lens-circle radius
float dfbm4(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*anoise(p); p=p*2.11+vec2(3.1,7.7); a*=0.5; } return s; }
float whash(float n){ return fract(sin(n*12.9898)*43758.5453); }
// Joinery. The wooden boards are not one slab: the centre is a disc, each ring band is a segmented
// ring of staves (12 inner, 16 outer) with the grain running round the ring, and the lens segments
// are separate boards with the grain along their long axis. Returns p in that piece's own grain
// frame (grain along +y) with a per-piece offset so figure never continues across a joint; 'joint'
// is the distance to the nearest stave joint (the ring and lens boundaries are the printed lines),
// 'tone' the small tonal difference between boards cut from one log. Mirrored in presentation.js.
vec2 woodFrame(vec2 p, out float joint, out float tone){
  float r = length(p);
  float band = r < uBoardGeom.x ? 2.0 : (r < uBoardGeom.y ? 1.0 : 0.0);
  bool lens = distance(p, vec2(-uBoardGeom.z, 0.0)) < uBoardGeom.w || distance(p, vec2(uBoardGeom.z, 0.0)) < uBoardGeom.w;
  float ang, id; joint = 1.0e3;
  if (lens) { ang = 1.5707963; id = 100.0 + band*2.0 + step(0.0, p.x); }
  else if (band > 1.5) { ang = 0.0; id = 1.0; }
  else {
    float n = band > 0.5 ? 12.0 : 16.0;
    float a = atan(p.y, p.x);
    float k = floor((a + 3.1415927) * n / 6.2831853);
    float ka = -3.1415927 + (k + 0.5) * 6.2831853 / n;   // the stave's centre bearing
    ang = ka + 1.5707963;                                  // grain along the tangent
    id = 10.0 + band*20.0 + k;
    joint = r * (3.1415927 / n - abs(a - ka));             // arc distance to the nearer joint
  }
  tone = 1.0 + (whash(id*3.1) - 0.5) * 0.12;
  float c = cos(1.5707963 - ang), sn = sin(1.5707963 - ang);
  vec2 q = vec2(c*p.x - sn*p.y, sn*p.x + c*p.y);
  return q + vec2(whash(id)*97.0, whash(id*1.7)*61.0);
}
// Wood: growth bands along a warped axis, early/late wood, and pores that pit the late wood, all in
// the piece's own grain frame; the stave joints are a hair of dark glue line and a dip in the relief.
// Returns (tint multiplier, roughness, height).
vec3 woodDetail(vec2 p0, out float rough){
  float joint, tone; vec2 p = woodFrame(p0, joint, tone);
  vec2 w = p * vec2(0.09, 0.011);                        // grain runs along y; bands across x
  float warp = dfbm4(w * 2.0) * 1.6;
  float ring = sin((w.x + warp) * 9.0 + afbm(w * 1.3) * 3.0);
  float band = smoothstep(-0.35, 0.75, ring);            // 0 = early wood (paler), 1 = late wood
  float pore = pow(anoise(p * vec2(6.5, 0.9) + vec2(0.0, warp)), 9.0);   // elongated pores
  float fine = afbm(p * 2.8) - 0.5;                      // fibre flecks
  float j = 1.0 - smoothstep(0.10, 0.26, joint);         // the glue line
  float tint = (1.0 - 0.20*band - 0.30*pore + 0.05*fine) * tone * (1.0 - 0.45*j);
  rough = 0.44 + 0.20*band + 0.22*pore - 0.06*fine + 0.15*j;
  float h = 0.45*band + 0.30*pore + 0.10*fine - 0.5*j;   // pores dip the relief a little, not a crater
  return vec3(tint, 0.0, h);
}
// Marble: domain-warped ridged veins with a second, finer generation branching off them, plus the
// crystalline speckle of polished calcite. Inside the black inlay (read off the bake's luminance)
// the palette inverts: pale veins in dark stone.
vec3 marbleDetail(vec2 p, float lum, out float rough, out vec3 col){
  vec2 s = p * 0.07;
  vec2 q = vec2(afbm(s), afbm(s + vec2(4.1, 2.3)));
  float v = afbm(s + 1.7*q);
  float vein = pow(1.0 - abs(v*2.0 - 1.0), 5.0);
  float fineV = afbm(s*3.7 + 2.4*q);
  vein += 0.5 * pow(1.0 - abs(fineV*2.0 - 1.0), 8.0);
  float cloud = smoothstep(0.3, 0.75, q.y);
  float spark = pow(anoise(p * 5.5), 26.0);              // calcite facets catching the light: occasional glints
  float inlay = 1.0 - smoothstep(0.12, 0.28, lum);       // dark bake = the black marble
  vec3 field = mix(vec3(1.0), vec3(0.52, 0.55, 0.62), vein*0.95) * (1.0 - cloud*0.12);
  vec3 black = mix(vec3(1.0), vec3(2.6, 2.5, 2.4), vein*0.55) * (1.0 + cloud*0.15);
  col = mix(field, black, inlay);
  rough = 0.16 + 0.10*vein + 0.06*cloud - 0.12*spark;
  float h = 0.5*vein + 0.35*spark;
  return vec3(inlay, spark, h);
}
vec3 perturbDetail(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection){
  vec3 vSigmaX = dFdx(surf_pos); vec3 vSigmaY = dFdy(surf_pos); vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;
// Install the detail pass on a MeshStandardMaterial. Returns a getter for its uniforms (they only
// exist once the shader has compiled, i.e. after the first frame that draws the material).
function installDetailShader(material) {
  const holder = { uniforms: null };
  material.onBeforeCompile = shader => {
    shader.uniforms.uDetail = { value: 0 };
    shader.uniforms.uDetailTime = { value: 0 };
    shader.uniforms.uDetailTint = { value: new THREE.Vector3(1,1,1) };
    shader.uniforms.uAlien = { value: 0 };
    shader.uniforms.uAlienTime = { value: 0 };
    shader.uniforms.uMath = { value: 0 };
    shader.uniforms.uRingR = { value: CFG.footR*Math.sqrt(3) };
    shader.uniforms.uFeet = { value: Array.from({ length: 6 }, () => new THREE.Vector2(1e4, 1e4)) };
    const rings = CFG.rings || [40, 53.3], arc = (CFG.sideArcs && CFG.sideArcs[0]) || { cx: -CFG.edgeU, r: 40 };
    shader.uniforms.uBoardGeom = { value: new THREE.Vector4(rings[0], rings[1], Math.abs(arc.cx), arc.r) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    // Where the lit colour is final differs by version: a chunk include in newer builds, the bare
    // gl_FragColor line in r128. Hook whichever this shader has.
    const finalHook = ['#include <opaque_fragment>', '#include <output_fragment>', 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );']
      .find(h => shader.fragmentShader.includes(h)) || '#include <opaque_fragment>';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + ALIEN_GLSL + DETAIL_GLSL + MATH_GLSL)
      // colour + roughness: right after the maps have had their say
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' +
        'float dH = 0.0; float dRough = roughnessFactor;\n' +
        'if (uDetail > 0.5 && uDetail < 1.5) { float r; vec3 w = woodDetail(vWPos.xz, r); diffuseColor.rgb *= w.x * uDetailTint; dRough = r; dH = w.z; }\n' +
        'if (uDetail > 1.5 && uDetail < 2.5) { float r; vec3 c; float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); vec3 m = marbleDetail(vWPos.xz, lum, r, c); diffuseColor.rgb *= c; dRough = r; dH = m.z; }\n' +
        'if (uDetail > 0.5) roughnessFactor = clamp(dRough, 0.02, 1.0);\n')
      // relief: after the normal is final, bend it by the detail height's screen-space slope
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' +
        'if (uDetail > 0.5) { vec2 dHdxy = vec2(dFdx(dH), dFdy(dH)) * (uDetail < 1.5 ? 0.45 : 0.4); normal = perturbDetail(-vViewPosition, normal, dHdxy, gl_FrontFacing ? 1.0 : -1.0); }\n')
      // the alien membrane, as the showcase draws it
      .replace(finalHook,
        MATH_PASS +
        'if (uAlien > 0.5) {\n' +
        '  vec2 p = vWPos.xz * 0.06;\n' +
        '  vec2 q = vec2(afbm(p), afbm(p + vec2(5.2, 1.3)));\n' +
        '  float warp = afbm(p + 1.8*q + uAlienTime*0.015);\n' +
        '  float vein = pow(1.0 - abs(warp*2.0 - 1.0), 6.0);\n' +
        '  float fine = afbm(p*3.9 + 4.0*q);\n' +
        '  vein += 0.55 * pow(1.0 - abs(fine*2.0 - 1.0), 9.0);\n' +
        '  float pulse = 0.65 + 0.35*sin(uAlienTime*0.7 + warp*6.28);\n' +
        '  float blotch = smoothstep(0.32, 0.72, q.x);\n' +
        '  outgoingLight *= (1.0 - blotch*0.3);\n' +
        '  outgoingLight += vec3(0.10, 0.95, 0.80) * vein * 0.55 * pulse;\n' +
        '}\n' + finalHook);
    holder.uniforms = shader.uniforms;
  };
  material.customProgramCacheKey = () => 'tau-detail';
  material.needsUpdate = true;
  return holder;
}

  return { S, sc, ox, oy, px, LW, DOTS, canvas2d, strokeLines, noiseCanvas, vignette, tex, texL,
           THEMES, ALIEN_GLSL, DETAIL_GLSL, MATH_GLSL, installDetailShader, installLegGradient, shadeZones };
}
if (typeof window !== 'undefined') window.makeShowcaseBoards = makeShowcaseBoards;
if (typeof module !== 'undefined') module.exports = makeShowcaseBoards;
