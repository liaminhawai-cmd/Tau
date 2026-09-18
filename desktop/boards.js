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
        // Thickness 11 through a 2.4-unit attenuation distance absorbed nearly everything -- the legs
        // read as opaque coloured plastic. Thinner glass, gentler absorption: still deeply tinted at
        // the grazing angles, but you see the board and the other piece through them.
        leg: mk({ thickness: 6.0, attenuationDistance: 6.0, roughness: 0.12, emissiveIntensity: 0.18,
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
    hubBall: 1.55,   // the brass bead read oversized at the default 1.9 -- its shine sells size on
                      // its own; legs/feet are untouched, only the ball shrinks
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
        const mid = (r0+r1)*0.5, bend = (r1-r0)*0.12;
        a.quadraticCurveTo(hx + Math.cos(th)*mid - Math.sin(th)*bend,
          hy + Math.sin(th)*mid + Math.cos(th)*bend,
          hx + Math.cos(th)*r1, hy + Math.sin(th)*r1); a.stroke();
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
    fill:{ color: 0x86d6c8, intensity: 0.45 },
    band: { color: 0x191324, rough: 0.35, metal: 0.25 }, slabColor: 0x110d1a, tableColor: 0x06060c,
    boardEnv: 0.25, bumpScale: 1.1, emissiveIntensity: 1.5, boardReflect: 0.28, guide: 0x8dffe8,
    // The showcase's bloom threshold lets only the brightest channels glow; the game has no bloom,
    // so the same emissive floods the whole membrane. This is the level the game applies instead.
    gameEmissive: 0.45,
    // GRAVITY LETS GO HERE. A piece pushed off the rim drops like it would anywhere, and then the
    // pull eases off as it goes: gone by the time it has fallen its own height, and a little past
    // gone after that. So it falls, slows, hangs, and lifts away -- something let go of underwater
    // rather than something dropped. `fade` is how long the pull takes to reach nothing, `lift` is
    // what is left over once it has.
    floorY: -70, gravity: { fade: 0.85, lift: -0.16 },
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
    // THREE COLOURS, NOT ONE. The board is a living teal membrane and it lights the room: measured
    // off the render, the board sat at hue 178, the blue piece at 192 and both read as the same
    // glowing cyan -- the piece disappeared into the table it stood on. Three things were doing it.
    // The side's glow was a cyan (0x3fd2ff, hue 196), which at this emissive strength IS the piece's
    // colour; full thin-film iridescence smears any hue towards the same spectral wash; and a
    // saturated teal fill light tinted whatever the two of them left. Blue is a true blue now, the
    // iridescence is a sheen rather than the whole surface, and the fill is a paler teal. Measured
    // again: board 177, blue 233, red 348 -- 56 degrees and 114 degrees apart, three hues you can
    // name. Red was never the problem and is untouched.
    pieces(which) {   // thin-film iridescent chitin with a faint internal glow
      const base = which === 'blue' ? 0x2436a8 : 0x7c2030;      // deep blue / haem — three hues, not two
      const film = which === 'blue' ? [140, 520] : [240, 700];  // nm range picks each side's shimmer
      // Self-luminous, like the membrane's channels: the glow is a BRIGHT bioluminescent tint of
      // each side, not the dark body colour turned up (a dark emissive at any intensity only
      // reads as a slightly less dark surface). Hot enough for the bloom pass to pick up.
      const glow = which === 'blue' ? 0x3355ff : 0xff5c7a;
      const mk = o => PHYS(Object.assign({
        color: base, metalness: 0, iridescence: 0.45, iridescenceIOR: 1.8,
        iridescenceThicknessRange: film, emissive: new THREE.Color(glow),
      }, o));
      return {
        hub: mk({ roughness: 0.18, clearcoat: 1.0, clearcoatRoughness: 0.1, emissiveIntensity: 0.9,
                  envMapIntensity: 0.7, specularIntensity: 0.8 }),
        // legs: PARTIAL thin-film only — at true grazing angles full iridescence goes white in
        // every wavelength (it replaces Fresnel entirely), so the legs run half-strength shimmer
        // over waxy chitin, rough enough to diffuse the sheath, lit from inside
        leg: mk({ iridescence: 0.18, roughness: 0.44, clearcoat: 0.2, clearcoatRoughness: 0.35,
                  emissiveIntensity: 1.1, envMapIntensity: 0.15, specularIntensity: 0.35 }),
      };
    },
  },

  // ============ COLOSSUS — two titans the size of buildings, seen from the stands ============
  // Enormity is all cues, not size: heavy atmospheric haze (far things fade = far things are FAR),
  // a telephoto camera high in the stands (long lens compresses = monumental), slow motion
  // (giant things move slowly — the whole sim runs at a third speed), tiers packed with a crowd
  // of ordinary-sized Taus for scale reference, and dust hanging in the sun.
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
    dust: { color: 0xd9c49c, size: 2.6 },   // the sand a fall throws up (see the desktop's tickEffects)
    // In the game the camera sits lower and wider than on the other boards, so the tiers and their
    // crowd rise behind the far rim instead of staying above the top of the frame.
    gameCam: { elev: 0.5, fov: 46 },
    floorY: -20, ownGround: true,   // the arena sand a fallen titan lands on -- the pitch is a plinth twenty units above it
    // …but the plinth is WIDER than the pitch, so a titan that goes over the rim comes down on
    // stone, not on sand: it lands on the plinth's top face, and only reaches the arena floor by
    // rolling off the edge and down the flank. Told the sand was the ground everywhere, it dropped
    // straight through the plinth and came to rest buried inside it.
    floorAt(x, z) {
      const r = Math.hypot(x, z), TOP_R = CFG.edgeU*1.04, BASE_R = CFG.edgeU*1.2;
      const TOP = -5.2, BASE = TOP - 16, GROUND = -20;
      if (r <= TOP_R) return TOP;
      if (r >= BASE_R) return GROUND;
      return Math.max(GROUND, TOP + (BASE - TOP)*(r - TOP_R)/(BASE_R - TOP_R));   // the sloped flank
    },
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
      // The dot and the darker disc under it are CONCENTRIC. The other looks nudge that disc a
      // little to one side, where it reads as a shadow thrown by a small stud sitting proud of the
      // surface. This board's dots are more than twice that size and its stone is only a shade off
      // the sand around it, so the same nudge stopped reading as a shadow and started reading as a
      // ring the dot had slipped inside -- six of them, each apparently off its own mark. Centred,
      // it is what the board actually is: basalt sunk into sand, with the sand darker where it
      // meets the stone.
      const dotR = Math.max(5, px(CFG.edgeU * CFG.padRadiusFrac * 2.2));
      for (const [dx,dy] of DOTS) {
        a.fillStyle = 'rgba(40,32,22,0.5)'; a.beginPath(); a.arc(ox+px(dx), oy+px(dy), dotR*1.3, 0, 7); a.fill();
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
    env() {   // the colosseum: an arena floor, stone tiers the crowd can climb, the arched wall, dust
      const g = new THREE.Group();
      // Everything the crowd stands on is at the CROWD'S scale. A figure is about two and a half
      // units tall, so a step rises a little over one -- the way a stadium's rows are built for
      // the people who sit in them -- and every tread holds one packed row. The old tiers rose
      // fifteen units a riser: nothing that size builds what it can't climb. The titans play on a
      // stone plinth twenty units above the sand, so a fallen one has somewhere to land.
      const GROUND = -20, R0 = 200, STEPS = 36, RISE = 1.15, TREAD = 5.0;
      const TOP_R = R0 + STEPS*TREAD, TOP_Y = GROUND + STEPS*RISE, WALL_R = 470;
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU*1.04, CFG.edgeU*1.2, 16, 96),
        new THREE.MeshStandardMaterial({ color: 0x7e6f54, roughness: 0.95 }));
      plinth.position.y = -5.2 - 8; plinth.receiveShadow = true; plinth.castShadow = true; g.add(plinth);
      // the arena floor: raked sand, the same tone as the pitch
      const sv = document.createElement('canvas'); sv.width = sv.height = 256;
      const sc = sv.getContext('2d');
      sc.fillStyle = '#b09a6e'; sc.fillRect(0, 0, 256, 256);
      sc.globalAlpha = 0.35; sc.drawImage(noiseCanvas(0.2, 515), 0, 0, 256, 256); sc.globalAlpha = 1;
      const sandTex = new THREE.CanvasTexture(sv); sandTex.colorSpace = THREE.SRGBColorSpace;
      sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping; sandTex.repeat.set(8, 8); sandTex.anisotropy = 8;
      const floor = new THREE.Mesh(new THREE.RingGeometry(40, R0 + 1, 128),
        new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, metalness: 0 }));
      floor.rotation.x = -Math.PI/2; floor.position.y = GROUND; floor.receiveShadow = true; g.add(floor);
      // The tiers: one lathe of a stair profile, riser and tread, unindexed so every face shades
      // flat (a smooth-shaded stair rounds its own edges off), then the promenade under the wall.
      const profile = [new THREE.Vector2(R0, GROUND)];
      for (let i = 0; i < STEPS; i++) {
        const r0 = R0 + i*TREAD, y1 = GROUND + (i+1)*RISE;
        profile.push(new THREE.Vector2(r0, y1), new THREE.Vector2(r0 + TREAD, y1));
      }
      profile.push(new THREE.Vector2(WALL_R, TOP_Y));
      const stone = new THREE.MeshStandardMaterial({ color: 0x9a8a6a, roughness: 0.95, side: THREE.DoubleSide });
      const tiers = new THREE.Mesh(new THREE.LatheGeometry(profile, 160).toNonIndexed(), stone);
      tiers.geometry.computeVertexNormals();
      tiers.receiveShadow = true; g.add(tiers);
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
      wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(12, 1); wallTex.anisotropy = 8;
      wallTex.colorSpace = THREE.SRGBColorSpace;
      const WALL_H = 150;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(WALL_R, WALL_R, WALL_H, 128, 1, true),
        new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, side: THREE.BackSide }));
      wall.position.y = TOP_Y + WALL_H/2; g.add(wall);
      // dust hanging in the raking sun — the air itself has depth, and depth reads as SIZE. Two
      // layers: a fine far haze of motes across the whole bowl, and a coarser near-camera drift of
      // bigger flecks that catch the light — the parallax between them sells the volume of air.
      // A mote is a soft disc, not a square: a point sprite with a radial falloff, so a fleck near
      // the camera reads as a blur of light and not a pixel block.
      const mote = softDiscTexture();
      const mkDust = (N, spreadR, spreadY, size, op, seed) => {
        let dr = seed; const rn = () => (dr = (dr*16807)%2147483647)/2147483647;
        const pos = new Float32Array(N*3);
        for (let i = 0; i < N; i++) {
          const th = rn()*Math.PI*2, rr = 20 + rn()*spreadR;
          pos[i*3] = Math.cos(th)*rr; pos[i*3+1] = 3 + rn()*spreadY; pos[i*3+2] = Math.sin(th)*rr;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffedc8, size, transparent: true, map: mote,
          opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
      };
      const dustFar = mkDust(1100, 380, 200, 1.3, 0.16, 909);
      const dustNear = mkDust(320, 200, 90, 3.2, 0.28, 313);
      g.add(dustFar, dustNear);
      // The crowd: little Taus on every step, the pieces below at a tenth of the size and in their
      // ordinary lacquered blue and red -- not stone. The figure is the real piece's proportions
      // (fusedTripodGeometry, index.html): a quarter-circle leg that leaves the crown level and
      // lands vertically, a short straight foot, a slim tube (thickened a little past true so it
      // doesn't alias to flicker at a distance), and only a small bead where the three legs meet;
      // no head. Several thousand of them are still one instanced draw, and they leap when a titan
      // goes over the rim.
      const FR = 1.0, FT = 0.28, LEG = 0.11, BEAD = 0.14;
      class LegPath extends THREE.Curve {
        getPoint(t, out = new THREE.Vector3()) {
          const arc = Math.PI/2*FR, s = t*(arc + FT);
          if (s <= arc) { const ph = s/FR; return out.set(Math.sin(ph)*FR, FT + Math.cos(ph)*FR, 0); }
          return out.set(FR, FT - (s - arc), 0);
        }
      }
      const partsOf = [];
      for (let k = 0; k < 3; k++) {
        const leg = new THREE.TubeGeometry(new LegPath(), 7, LEG, 4, false);
        leg.rotateY(-k*2*Math.PI/3);
        partsOf.push(leg);
      }
      const bead = new THREE.SphereGeometry(BEAD, 6, 5); bead.translate(0, FT + FR, 0); partsOf.push(bead);
      const P = [], N = [];
      for (const part of partsOf) {
        const flat = part.toNonIndexed();
        P.push(...flat.attributes.position.array); N.push(...flat.attributes.normal.array);
        part.dispose(); flat.dispose();
      }
      const figure = new THREE.BufferGeometry();
      figure.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      figure.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      // One packed row per tread, evenly spaced around it (pure random placement clumps and gaps)
      // with a little jitter so it doesn't read as a grid. Density is a spacing target applied per
      // step, so a wide outer row gets proportionally more figures than a narrow inner one.
      const SPACING = 3.8;
      const rows = [];
      let crowdTotal = 0;
      for (let i = 0; i < STEPS; i++) {
        const r = R0 + i*TREAD + TREAD*0.55, count = Math.round(2*Math.PI*r / SPACING);
        rows.push([r, GROUND + (i+1)*RISE, count, i/STEPS]); crowdTotal += count;
      }
      // Who sits where: supporters clump. A smooth field over the bowl -- three harmonics around the
      // arena, each drifting as it climbs the tiers -- says which way a seat leans, and a coin flip
      // wide enough to cross that field puts about a fifth of the crowd in among the other lot. So
      // reds sit in patches and blues in patches, still half the bowl each, with ragged edges rather
      // than an arena split down the middle. A flat coin flip per seat, which is what this was,
      // gives no patches at all: at any distance seventeen thousand alternating figures average out
      // to one uniform mauve speckle, and the arena reads as having no sides.
      const lean = (th, u) => Math.sin(6*th + 2.6*u + 0.7)
                            + 0.70*Math.sin(10*th - 4.1*u + 2.4)
                            + 0.55*Math.sin(15*th + 7.3*u + 5.1);
      const MIX = 1.05;   // how far a seat may fall from its patch; 0 packs them into blocks, 2.25 is the old coin flip
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Pv = new THREE.Vector3(), Sv = new THREE.Vector3();
      const UP = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
      let cr = 4242; const crn = () => (cr = (cr*16807)%2147483647)/2147483647;
      const blue = new THREE.Color(0x6b9eff), red = new THREE.Color(0xff6b6b);
      // Placed first, built second: the two halves are separate meshes so the winning colour can
      // jump on its own, and neither count is known until every seat has picked a side.
      const seats = [], counts = [0, 0];
      for (const [r, y, count, u] of rows) {
        for (let j = 0; j < count; j++) {
          const th = (j/count)*Math.PI*2 + (crn()-0.5)*(Math.PI*2/count)*0.5;
          const rr = r + (crn()-0.5)*1.4, sc = 1.7 + crn()*0.5, yaw = crn()*6.28;
          const side = (lean(th, u) + (crn()-0.5)*2*MIX) > 0 ? 0 : 1;
          seats.push([Math.cos(th)*rr, y, Math.sin(th)*rr, yaw, sc, side, 0.9 + crn()*0.15]);
          counts[side]++;
        }
      }
      const crowdMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.1,
                                                        clearcoat: 0.65, clearcoatRoughness: 0.22, envMapIntensity: 0.9 });
      const crowds = [new THREE.InstancedMesh(figure, crowdMat, counts[0]),
                      new THREE.InstancedMesh(figure, crowdMat, counts[1])];
      const at = [0, 0];
      for (const [x, y, z, yaw, sc, side, shade] of seats) {
        Pv.set(x, y, z); Q.setFromAxisAngle(UP, yaw); Sv.set(sc, sc, sc);
        M.compose(Pv, Q, Sv);
        crowds[side].setMatrixAt(at[side], M);
        crowds[side].setColorAt(at[side], col.copy(side === 0 ? blue : red).multiplyScalar(shade));
        at[side]++;
      }
      for (const c of crowds) {
        c.instanceMatrix.needsUpdate = true;
        if (c.instanceColor) c.instanceColor.needsUpdate = true;
        g.add(c);
      }
      const exciteT = [99, 99];
      // A titan went over, and the half of the bowl that came to see it win is the half that jumps.
      // `side` is the WINNING colour (0 blue, 1 red); called with nothing -- the showcase page, where
      // nobody is playing -- the whole arena goes up, which is what it used to do for everyone.
      g.userData.excite = side => {
        if (side === 0 || side === 1) exciteT[side] = 0;
        else exciteT[0] = exciteT[1] = 0;
      };
      // How far up the jump is, for the desktop's rest detector: whichever half is highest.
      g.userData.lift = () => Math.max(crowds[0].position.y, crowds[1].position.y);
      g.userData.tick = (t, dt) => {
        dustFar.rotation.y = t*0.003; dustFar.position.y = Math.sin(t*0.08)*2;
        dustNear.rotation.y = -t*0.006; dustNear.position.y = Math.sin(t*0.13 + 1)*3;
        for (let s = 0; s < 2; s++) {
          if (exciteT[s] < 3.2) {
            exciteT[s] += dt || 0.016;
            crowds[s].position.y = 2.4 * Math.abs(Math.sin(exciteT[s]*8)) * Math.max(0, 1 - exciteT[s]/3.2);
          } else crowds[s].position.y = 0;
        }
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
    // No dust on this one. Polished stone throws nothing up, and a shower of pale specks raining off
    // the table every time the glass went was reading as debris falling out of the board itself.
    // The marble table stands in a dark hall, and the hall has a floor a long way down. A piece
    // pushed over this rim falls the height of the table rather than the width of a hand -- which
    // is the drop the glass wants, since what waits at the bottom is stone.
    floorY: -86, ownGround: true,
    env() {
      const g = new THREE.Group();
      // Polished black stone, faded out into the dark so its edge is never a visible disc against
      // the backdrop. Rough enough to be stone, smooth enough to hold the room's reflection.
      const sv = document.createElement('canvas'); sv.width = sv.height = 256;
      const sc = sv.getContext('2d');
      sc.fillStyle = '#0f1013'; sc.fillRect(0, 0, 256, 256);
      sc.globalCompositeOperation = 'screen'; sc.globalAlpha = 0.18;
      sc.drawImage(noiseCanvas(0.45, 7373), 0, 0, 256, 256);
      sc.globalCompositeOperation = 'source-over'; sc.globalAlpha = 1;
      const tex = new THREE.CanvasTexture(sv); tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(7, 7); tex.anisotropy = 8;
      const av = document.createElement('canvas'); av.width = av.height = 256;
      const ac = av.getContext('2d');
      const ag = ac.createRadialGradient(128, 128, 0, 128, 128, 128);
      ag.addColorStop(0, '#ffffff'); ag.addColorStop(0.45, '#ffffff'); ag.addColorStop(1, '#000000');
      ac.fillStyle = ag; ac.fillRect(0, 0, 256, 256);
      const fade = new THREE.CanvasTexture(av);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(340, 96),
        new THREE.MeshStandardMaterial({ map: tex, alphaMap: fade, transparent: true,
          roughness: 0.24, metalness: 0.1, envMapIntensity: 0.7 }));
      floor.rotation.x = -Math.PI/2; floor.position.y = -86; floor.receiveShadow = true;
      g.add(floor);
      return g;
    },
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
      // Water-clear glass: everything behind a leg shows through it, refracted by its thickness.
      // three's transmission buffer holds only the opaque scene, so the game gives each glass piece
      // a proxy of its legs that draws into that buffer alone (desktop/presentation.js,
      // syncGlassProxy) -- that is how the red leg is seen through the blue one. Against the dark
      // room a clear leg is drawn by its edges: a Fresnel rim in installLegGradient.
      // Not QUITE total transmission: a tenth of the surface left to catch light gives the clear
      // end some body, so the arch is a glass tube rather than a hole cut in the picture. You still
      // see the board, the rings and the other piece straight through it.
      // THICKNESS IS THE WHOLE ARGUMENT HERE. three refracts in screen space: it samples the picture
      // behind the surface, offset by how far the glass would bend the ray. A solid rod 2.6 units
      // thick bends it a long way, and since the offset is measured in SCREEN pixels rather than
      // followed through the glass, the leg behind arrives as a coloured blob somewhere it is not --
      // a red arch with a blue smudge floating inside it, sliding about as the camera turns. A thin
      // wall bends it a little, so what is behind shows through roughly WHERE IT IS, and the leg
      // still reads as glass because the reflection and the tint do that work. (The absorption is
      // shortened to match: it is applied over the thickness, so the foot keeps the colour it had.)
      const leg = PHYS({ color: 0xf6f9ff,
        metalness: 0, roughness: 0.03, transmission: 0.9, ior: 1.52, thickness: 0.8,
        attenuationColor: new THREE.Color(0xe4ecff), attenuationDistance: 13,
        clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 2.6 });
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
// A point sprite: white with a radial falloff, for dust and motes drawn as THREE.Points.
let softDiscTex = null;
function softDiscTexture() {
  if (softDiscTex) return softDiscTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.65)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  softDiscTex = new THREE.CanvasTexture(cv);
  return softDiscTex;
}
function installLegGradient(material, tint) {
  material.userData.legTint = tint;   // read by the game's glass proxies, which wear the same ramp
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
      // THE TINT ALONG THE LEG, both ends. Running it one way only -- clear at the crown, full colour
      // at the foot -- left the glass at its palest exactly where it meets the ball, so a solid
      // coloured sphere sat on top of a colourless tube with a hard line between them. The colour
      // comes back at the top as well, but over a shorter run than it takes to reach the foot.
      // A hyperbola was tried for that and came off too hard -- it holds full colour for no distance
      // at all and then drops, so the join swapped one hard line for another a hair further down.
      // A cubic instead: flat where it meets the ball, easing off through the middle of its run and
      // arriving at nothing with no edge on it. Close up it is the colour running out of the ball
      // into the glass and thinning as it goes; from across the room it is simply that the two parts
      // belong to each other. The foot end, and the clear middle, are exactly as they were.
      .replace('#include <color_fragment>', '#include <color_fragment>\n' +
        'float legG = smoothstep(0.25, 1.0, vLegT);\n' +
        'legG = max(legG, 1.0 - smoothstep(0.0, 0.28, vLegT));\n' +
        'diffuseColor.rgb = mix(diffuseColor.rgb, uLegTint, legG);')
      .replace('material.transmission = transmission;', 'material.transmission = transmission * (1.0 - 0.7*legG*legG);')
      .replace('material.attenuationColor = attenuationColor;', 'material.attenuationColor = mix(attenuationColor, uLegTint, legG);')
      .replace('material.attenuationDistance = attenuationDistance;', 'material.attenuationDistance = mix(attenuationDistance, 0.8, legG);')
      // The rim: glass is seen by its edges. Where the surface turns away from the eye the leg
      // catches a pale Fresnel glow (the ball's colour towards the foot), so a leg against the
      // black backdrop, where there is nothing to see through it, is still drawn.
      // It was set far too faint to do that job. Water-clear glass in a near-black room genuinely
      // IS black -- which is what the arch looked like, a dark band over the board -- and the edges
      // are the only thing that ever reveals a clear rod. So the glow is strong enough to read now,
      // and wider (a gentler falloff), so it runs along the tube instead of hugging its outline.
      .replace('#include <opaque_fragment>',
        '{ float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.2);\n' +
        '  outgoingLight += mix(vec3(0.80, 0.86, 0.95), uLegTint, legG) * rim * 0.30; }\n' +
        '#include <opaque_fragment>');
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
float afbm3(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<3;i++){ s+=a*anoise(p); p=p*2.11+vec2(3.3,5.9); a*=0.5; } return s; }
// A FBM WHERE EVERY OCTAVE IS ALIVE. Ordinary noise, however many octaves you stack on it, is a
// still photograph -- pushing time through it makes the whole picture drift, one thing sliding
// about, and the detail inside it is as dead when it arrives as it was when it left. Here each
// octave swells and draws back on a clock of its own, and WHERE it is swelling is itself a slow
// wander, so the coarse shape can be blooming in one corner while the fine grain inside it is
// receding, and a moment later the other way round. Divided through by its own weights at the end,
// so what changes is which scale is speaking loudest rather than how bright the whole thing is.
// The upshot is that it is growing at every size at once: go closer and there is more of it, still
// moving, all the way down.
float lfbm6(vec2 p, float t){
  float s=0.0, w=0.0, a=0.5;
  for(int i=0;i<6;i++){
    float fi=float(i);
    float bl=0.35+1.30*(0.5+0.5*sin(t*(0.10+0.085*fi)+anoise(p*0.28+fi*7.3)*6.2832));
    s+=a*anoise(p)*bl; w+=a*bl;
    p=p*2.03+vec2(1.7,9.2); a*=0.5;
  }
  return w>1e-5 ? s/w : 0.5;
}
float lfbm4(vec2 p, float t){
  float s=0.0, w=0.0, a=0.5;
  for(int i=0;i<4;i++){
    float fi=float(i);
    float bl=0.35+1.30*(0.5+0.5*sin(t*(0.14+0.11*fi)+anoise(p*0.33+fi*5.1)*6.2832));
    s+=a*anoise(p)*bl; w+=a*bl;
    p=p*2.07+vec2(5.3,2.9); a*=0.5;
  }
  return w>1e-5 ? s/w : 0.5;
}
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
// The board is assembled from pieces that meet at the printed curves: the centre disc, each ring
// band and the six lens segments are separate boards, each cut from its plank at its own angle, so
// the grain turns at every joint. No straight cuts: the joints ARE the rings and arcs. Nine pieces,
// golden-angle grain directions (neighbours never share one), an offset per piece so no figure
// continues across a joint, and a gentle warp so the fibres stay curved. Mirrored in presentation.js.
vec2 woodFrame(vec2 p){
  float r = length(p);
  float band = r < uBoardGeom.x ? 2.0 : (r < uBoardGeom.y ? 1.0 : 0.0);
  float side = distance(p, vec2(-uBoardGeom.z, 0.0)) < uBoardGeom.w ? 1.0
             : (distance(p, vec2(uBoardGeom.z, 0.0)) < uBoardGeom.w ? 2.0 : 0.0);
  float id = (2.0 - band) + 3.0*side;
  float ang = mod(id * 2.399, 3.14159265);
  float c = cos(ang), sn = sin(ang);
  vec2 q = vec2(c*p.x - sn*p.y, sn*p.x + c*p.y) + vec2(id*37.0, id*23.0);
  return vec2(q.x + 3.4*sin(q.y*0.065) + 1.6*sin((q.x+q.y)*0.035),
              q.y + 1.8*sin(q.x*0.05));
}
// Wood: growth bands along a warped axis, early/late wood, and pores that pit the late wood.
// Returns (tint multiplier, roughness, height).
vec3 woodDetail(vec2 p0, out float rough){
  vec2 p = woodFrame(p0);
  vec2 w = p * vec2(0.09, 0.011);                        // grain runs along y; bands across x
  float warp = dfbm4(w * 2.0) * 1.6;
  float ring = sin((w.x + warp) * 9.0 + afbm(w * 1.3) * 3.0);
  float band = smoothstep(-0.35, 0.75, ring);            // 0 = early wood (paler), 1 = late wood
  float pore = pow(anoise(p * vec2(6.5, 0.9) + vec2(0.0, warp)), 9.0);   // elongated pores
  float fine = afbm(p * 2.8) - 0.5;                      // fibre flecks
  float tint = 1.0 - 0.20*band - 0.30*pore + 0.05*fine;
  rough = 0.44 + 0.20*band + 0.22*pore - 0.06*fine;
  float h = 0.45*band + 0.30*pore + 0.10*fine;
  return vec3(tint, 0.0, h);
}
// Marble: domain-warped ridged veins with a second, finer generation branching off them, plus the
// crystalline speckle of polished calcite. Fed through woodFrame, so the table is assembled from
// slabs that meet at the printed curves and the veining turns at every joint. Inside the black
// inlay (read off the bake's luminance) the palette inverts: pale veins in dark stone.
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
  vec3 field = mix(vec3(1.0), vec3(0.56, 0.55, 0.53), vein*0.95) * (1.0 - cloud*0.12);   // neutral grey veins: the table favours neither colour
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
        'if (uDetail > 1.5 && uDetail < 2.5) { float r; vec3 c; float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); vec3 m = marbleDetail(woodFrame(vWPos.xz), lum, r, c); diffuseColor.rgb *= c; dRough = r; dH = m.z; }\n' +
        'if (uDetail > 0.5) roughnessFactor = clamp(dRough, 0.02, 1.0);\n')
      // relief: after the normal is final, bend it by the detail height's screen-space slope
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' +
        'if (uDetail > 0.5) { vec2 dHdxy = vec2(dFdx(dH), dFdy(dH)) * (uDetail < 1.5 ? 0.45 : 0.4); normal = perturbDetail(-vViewPosition, normal, dHdxy, gl_FrontFacing ? 1.0 : -1.0); }\n')
      // the alien membrane, as the showcase draws it
      .replace(finalHook,
        MATH_PASS +
        'if (uAlien > 0.5) {\n' +
        '  vec2 p = vWPos.xz * 0.06;\n' +
        '  vec2 q = vec2(afbm3(p), afbm3(p + vec2(5.2, 1.3)));\n' +
        // three layers of the same living noise, each an order finer than the last, so whatever
        // distance you look from there is structure at that size and it is moving
        '  float warp = lfbm6(p + 1.8*q, uAlienTime);\n' +
        '  float vein = pow(1.0 - abs(warp*2.0 - 1.0), 6.0);\n' +
        '  float fine = lfbm4(p*3.9 + 4.0*q, uAlienTime*1.7);\n' +
        '  vein += 0.55 * pow(1.0 - abs(fine*2.0 - 1.0), 9.0);\n' +
        '  float finer = lfbm4(p*14.0 + 2.0*q, uAlienTime*2.6);\n' +
        '  vein += 0.30 * pow(1.0 - abs(finer*2.0 - 1.0), 11.0);\n' +
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
           THEMES, ALIEN_GLSL, DETAIL_GLSL, MATH_GLSL, installDetailShader, installLegGradient, shadeZones, softDiscTexture };
}
if (typeof window !== 'undefined') window.makeShowcaseBoards = makeShowcaseBoards;
if (typeof module !== 'undefined') module.exports = makeShowcaseBoards;
