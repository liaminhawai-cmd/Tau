// Position -> feature vector, from the side-to-move's perspective.
//
// WHY THIS IS BIGGER THAN IT LOOKS LIKE IT NEEDS TO BE
// The old 16-feature version canonicalised the frame by rotating the mover's hub onto the +x axis.
// That is only a legal symmetry if the BOARD is rotationally symmetric. The rings are. The two side
// arcs are not -- they are circles centred at (+-edgeU, 0), pinned to the x axis. So two positions
// related by a pure rotation collapsed onto the SAME feature vector while being genuinely different
// positions (a foot parked on a side arc in one, nowhere near an arc in the other). Contradictory
// labels on identical inputs is an information ceiling: no amount of width, epochs or data fits it,
// which is exactly what the old capacity probe measured (3.5x params -> +0.8% acc, and the wide
// net's TRAIN mse no lower than the small one's -- the signature of aliasing, not underfitting).
//
// The fix is not to drop the canonicalisation (it is still worth having for piece-RELATIVE
// geometry) but to add board geometry computed in WORLD coordinates, before any rotation, so the
// information the rotation destroys is handed back explicitly:
//
//   A. the 16 original piece-relative numbers          (rotation/mirror canonicalised)
//   B. per foot, where it sits relative to the printed lines                          (30 numbers)
//   C. per pinned foot and direction, how far the piece can swing before it pays      (36 numbers)
//
// Block C is the one that encodes the actual decision. Pinning a foot does not free the other two,
// it puts them on rails: they travel a circle centred on the pin whose radius is the inter-foot
// distance (a constant 40.0 for this tripod -- 2*footR*sin60). So "how far can I swing before
// crossing a line" is just: where does that circle meet the line, and what rotation gets there.
// The corner-cut manoeuvre needs no special case -- when a sweep passes through a point where two
// lines meet, the first and second crossing angles coincide, and the net sees a gap of ~0.
//
// A net cannot do trig. Every distance and angle precomputed here is capacity it does not have to
// spend rediscovering sqrt() and atan2() from raw coordinates.
'use strict';

// A. 16 original + B. 6 feet x 5 + C. 2 pieces x 3 pivots x 2 directions x 3
const N_FEATURES = 16 + 30 + 36;

const TWO_PI = Math.PI*2;

// The three feet of a piece, in world coordinates, sorted outermost-first. Sorting is the piece's
// 3-fold symmetry: which foot is "foot 0" is arbitrary, so the net should see shape, not labels.
// Every per-foot block below uses this same order so the columns stay aligned with each other.
function sortedFeet(p, CFG) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const a = p.rot + i*TWO_PI/3;
    const x = p.x + Math.cos(a)*CFG.footR, y = p.y + Math.sin(a)*CFG.footR;
    out.push({ x, y, r: Math.hypot(x, y) });
  }
  out.sort((u, v) => v.r - u.r);
  return out;
}

// Where a circle of radius R about (px,py) meets a circle of radius cr about (cx,cy), as ANGLES
// measured from (px,py) -- which is the form a sweep needs, since a pinned foot turns each other
// foot into a point travelling around exactly this circle. Pushes {ang, x, y} onto `out`.
function circleMeetAngles(px, py, R, cx, cy, cr, out) {
  const dx = cx - px, dy = cy - py, d = Math.hypot(dx, dy);
  if (d < 1e-9 || d > R + cr || d < Math.abs(R - cr)) return;   // concentric, disjoint, or nested
  const a = (d*d + R*R - cr*cr)/(2*d), h2 = R*R - a*a;
  if (h2 < 0) return;
  const h = Math.sqrt(h2), ux = dx/d, uy = dy/d;
  for (const s of [1, -1]) {
    const qx = px + a*ux - s*h*uy, qy = py + a*uy + s*h*ux;
    out.push({ ang: Math.atan2(qy - py, qx - px), x: qx, y: qy });
  }
}

// Signed distance from a point to a side arc's centreline: negative inside the arc's circle,
// positive outside. Outside the arc's angular span the arc simply is not there, so the distance
// falls back to the nearer endpoint -- which is continuous, because at the span boundary the
// endpoint IS the closest point on the circle.
function arcSignedDist(f, a, angInSpan) {
  const dx = f.x - a.cx, dy = f.y - a.cy, d = Math.hypot(dx, dy);
  const side = d >= a.r ? 1 : -1;
  if (angInSpan(Math.atan2(dy, dx)*180/Math.PI, a.a0, a.a1)) return side*Math.abs(d - a.r);
  let best = Infinity;
  for (const deg of [a.a0, a.a1]) {
    const t = deg*Math.PI/180;
    best = Math.min(best, Math.hypot(f.x - (a.cx + a.r*Math.cos(t)), f.y - (a.cy + a.r*Math.sin(t))));
  }
  return side*best;
}

function features(eng) {
  const G = eng.getG(), CFG = eng.CFG, E = CFG.edgeU;
  const angInSpan = eng.angInSpan, INTER = eng.LINE_INTERSECTIONS;
  const me = G.pieces[G.active], op = G.pieces[1 - G.active];

  // ---- A. the original 16: piece-relative geometry, rotation+mirror canonicalised ----
  const b = Math.atan2(me.y, me.x) || 0;
  const cb = Math.cos(-b), sb = Math.sin(-b);
  let oxr = op.x*cb - op.y*sb, oyr = op.x*sb + op.y*cb;
  const mirror = oyr < 0 ? -1 : 1;
  oyr *= mirror;
  const meR = Math.hypot(me.x, me.y);
  const opB = Math.atan2(op.y, op.x) || 0;
  const a3m = 3*(me.rot - b), a3o = 3*(op.rot - opB);
  const mFeet = sortedFeet(me, CFG), oFeet = sortedFeet(op, CFG);
  const out = [
    meR/E,
    Math.cos(a3m), Math.sin(a3m)*mirror,
    oxr/E, oyr/E,
    Math.cos(a3o), Math.sin(a3o)*mirror,
    Math.hypot(op.x - me.x, op.y - me.y)/E,
    mFeet[0].r/E, mFeet[1].r/E, mFeet[2].r/E,
    oFeet[0].r/E, oFeet[1].r/E, oFeet[2].r/E,
    (E - mFeet[0].r)/E,
    (E - oFeet[0].r)/E,
  ];

  // ---- B. per foot, position relative to the printed lines (world frame, no canonicalisation) ----
  // Signed so the sign pattern alone identifies which region of the board the foot is in -- an
  // integer zone id would imply an ordering between regions that does not exist, and would hide the
  // "about to be forced across" gradient that matters tactically.
  for (const feet of [mFeet, oFeet]) {
    for (const f of feet) {
      let nearestLine = Infinity;
      for (const R of CFG.rings) {
        const d = f.r - R;
        out.push(d/E);
        nearestLine = Math.min(nearestLine, Math.abs(d));
      }
      let arc = Infinity;
      for (const a of CFG.sideArcs) {
        const d = arcSignedDist(f, a, angInSpan);
        if (Math.abs(d) < Math.abs(arc)) arc = d;
      }
      out.push(arc/E);
      nearestLine = Math.min(nearestLine, Math.abs(arc));
      // "parked on a line", as a soft indicator rather than a threshold. crossEps is 0.81 out of a
      // 66.7 board -- about 1% of the normalised range -- and a tanh net resolves a step that sharp
      // badly. exp() decay gives it a gradient to follow instead of a cliff to memorise.
      out.push(Math.exp(-nearestLine/CFG.crossEps));
      let inter = Infinity;
      for (const P of INTER) inter = Math.min(inter, Math.hypot(f.x - P.x, f.y - P.y));
      out.push(Math.min(inter, E)/E);
    }
  }

  // ---- C. per pinned foot and direction: how far this piece can swing before it costs ----
  // maxCrossingsPerTurn is 1, so the SECOND crossing is usually the real limit and the first is
  // affordable; both are given rather than picking one, since the turn-start grace ("a foot that
  // starts on a line leaves it for free") makes which one binds depend on the position. The rim
  // angle is a harder stop than either: swinging a foot past edgeU loses the game outright.
  for (const [piece, feet] of [[me, mFeet], [op, oFeet]]) {
    for (let pv = 0; pv < 3; pv++) {
      const P = feet[pv];
      const hits = [];        // absolute angles about the pivot where SOME foot meets SOME line
      const rimHits = [];
      for (let i = 0; i < 3; i++) {
        if (i === pv) continue;
        const S = feet[i];
        const R = Math.hypot(S.x - P.x, S.y - P.y);
        if (R < 1e-9) continue;
        const start = Math.atan2(S.y - P.y, S.x - P.x);
        const raw = [];
        for (const ring of CFG.rings) circleMeetAngles(P.x, P.y, R, 0, 0, ring, raw);
        const arcRaw = [];
        for (const a of CFG.sideArcs) {
          const before = arcRaw.length;
          circleMeetAngles(P.x, P.y, R, a.cx, a.cy, a.r, arcRaw);
          // an arc only exists across its span -- a meeting point outside it is not a crossing
          for (let k = arcRaw.length - 1; k >= before; k--)
            if (!angInSpan(Math.atan2(arcRaw[k].y - a.cy, arcRaw[k].x - a.cx)*180/Math.PI, a.a0, a.a1))
              arcRaw.splice(k, 1);
        }
        for (const q of raw.concat(arcRaw)) hits.push({ ang: q.ang, start });
        const rim = [];
        circleMeetAngles(P.x, P.y, R, 0, 0, E, rim);
        for (const q of rim) rimHits.push({ ang: q.ang, start });
      }
      for (const dir of [1, -1]) {
        // rotation needed to bring a foot from `start` round to `ang`, travelling in `dir`
        const travel = h => {
          let t = dir > 0 ? h.ang - h.start : h.start - h.ang;
          t %= TWO_PI; if (t < 0) t += TWO_PI;
          return t;
        };
        // A foot already sitting on a line reports ~0 and would swamp both slots with "here";
        // that state is already carried by the parked-on-a-line term in block B.
        const angs = hits.map(travel).filter(t => t > 0.01).sort((x, y) => x - y);
        const rims = rimHits.map(travel).filter(t => t > 0.01).sort((x, y) => x - y);
        out.push(Math.min(angs[0] !== undefined ? angs[0] : Math.PI, Math.PI)/Math.PI);
        out.push(Math.min(angs[1] !== undefined ? angs[1] : Math.PI, Math.PI)/Math.PI);
        out.push(Math.min(rims[0] !== undefined ? rims[0] : Math.PI, Math.PI)/Math.PI);
      }
    }
  }
  return out;
}

module.exports = { features, N_FEATURES };
