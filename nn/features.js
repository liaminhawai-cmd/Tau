// Position -> feature vector, from the side-to-move's perspective, with the board's symmetries
// baked in so the net never wastes capacity learning them:
//   - rotation: the frame is rotated so the mover's hub sits on the +x axis
//   - mirror:   flipped so the opponent's hub has y >= 0
//   - 3-fold piece symmetry: orientations enter as cos/sin of 3*angle (feet repeat every 120°)
// Radii are normalized by the drop-off radius. 16 numbers total.
'use strict';

const N_FEATURES = 16;

function features(eng) {
  const G = eng.getG(), CFG = eng.CFG, E = CFG.edgeU;
  const me = G.pieces[G.active], op = G.pieces[1 - G.active];
  const b = Math.atan2(me.y, me.x) || 0;          // mover's bearing; frame rotates by -b
  const cb = Math.cos(-b), sb = Math.sin(-b);
  const rot = (x, y) => [x*cb - y*sb, x*sb + y*cb];
  let [oxr, oyr] = rot(op.x, op.y);
  const mirror = oyr < 0 ? -1 : 1;
  oyr *= mirror;
  const meR = Math.hypot(me.x, me.y);
  const opB = Math.atan2(op.y, op.x) || 0;
  const a3m = 3*(me.rot - b), a3o = 3*(op.rot - opB);
  const footRs = p => {
    const r = [];
    for (let i = 0; i < 3; i++) {
      const a = p.rot + i*2*Math.PI/3;
      r.push(Math.hypot(p.x + Math.cos(a)*CFG.footR, p.y + Math.sin(a)*CFG.footR));
    }
    return r.sort((x, y) => y - x);               // sorted: the net sees shape, not foot labels
  };
  const mf = footRs(me), of = footRs(op);
  return [
    meR/E,
    Math.cos(a3m), Math.sin(a3m)*mirror,
    oxr/E, oyr/E,
    Math.cos(a3o), Math.sin(a3o)*mirror,
    Math.hypot(op.x - me.x, op.y - me.y)/E,
    mf[0]/E, mf[1]/E, mf[2]/E,
    of[0]/E, of[1]/E, of[2]/E,
    (E - mf[0])/E,                                // my closest approach to the rim (danger)
    (E - of[0])/E,                                // theirs (opportunity)
  ];
}

module.exports = { features, N_FEATURES };
