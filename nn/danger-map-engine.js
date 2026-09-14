// GENERATED from index.html via nn/engine.js's buildEngineSource() + the EXACT trailer text its
// own createEngine() uses (extracted programmatically from engine.js's source, not retyped, so it
// cannot drift from what every arena/retromine/policyloop worker actually runs). Regenerate with:
//   node -e "require('/tmp/gen-bundle.js-equivalent')" -- or re-run this same extraction pattern
//   against a fresh nn/engine.js if index.html's rules ever change.
function buildTauEngine() {
const CFG = {
    edgeU: 66.667,                 // drop-off radius (266.67mm board, matches Metal base 266.666.stl)
    rings: [40, 53.3],             // the two concentric crossing lines
    sideArcs: [                    // lens arcs, r=40, centred on the rim; ends land exactly on the rim
        { cx: -66.667, cy: 0, r: 40, a0: -72.542, a1: 72.542 },
        { cx:  66.667, cy: 0, r: 40, a0: 107.458, a1: 252.542 }
    ],
    edgeEps: 0.5,
    lineWidthFrac: 0.0079,          // printed ring/arc line width, as a fraction of edgeU (measured off the design photo)
    padRadiusFrac: 0.0082,          // printed dot radius, as a fraction of edgeU (measured off the design photo) —
                                     // the real feet have magnets this size, so a foot fully covers its dot at rest
                                     // rather than tapering to an infinitely sharp point.
    footR: 23.095,                 // hub→foot = 46.19mm (tripod smoove 2021.stl)
    startX: 30.597,                // hub offset: puts the two back feet exactly halfway between the rings
    maxCrossingsPerTurn: 1,
    // ONE band decides everything now: the magnet's SURFACE touching the printed stroke. Magnet
    // radius 0.55 (2.2mm pin) + half line width 0.26 = 0.81. There used to be three different
    // sizes here -- a tight magnet-CENTRE band for grace/rest (0.4), another for holding an episode
    // open (0.45), and a wider pad band for contact (0.8) -- and the gaps between them were exactly
    // where the grace tricks lived (parked beside a line reads as "on" for one test and "off" for
    // another). Same number everywhere, so "is the magnet on the line" has one answer.
    crossEps: 0.81,
    holdEps: 0.81,          // same magnet-surface band (see crossEps)
    touchEps: 0.81,         // same magnet-surface band (see crossEps)
    // No grace, no tolerances beyond the magnet face itself: contact is exactly the magnet's
    // surface touching the printed stroke (touchEps), on and off, and that is the only band in the
    // rule. lineStick (a 0.25u = 0.5mm release stickiness) and cornerEps (a corner-merge allowance)
    // both used to live here and are both gone -- the first was non-physical, the second redundant
    // against the whole-piece crossing episode. See crossingSubstep.
    lineStick: 0,
    // Rounding a PRINTED corner -- where two lines actually meet -- is one crossing, not two.
    // Same magnet-surface band as crossEps/holdEps/touchEps: the magnet must actually reach the
    // crossing point. Valid range measured at 0.70-0.93 (below 0.70 the centre-spin dies, at 1.00
    // the opening slips through again); 0.81 sits mid-window and is the physical value.
    cornerEps: 0.81,
    substepDeg: 0.4,
    minMoveDeg: 2,                 // NET rotation for a move to count (else the turn is undone)
    lockDeg: 2,                    // net rotation before the one-direction-per-turn lock engages
    // Leg tube radius, for BOTH collision and render. 1.44u = 2.88mm = the 5.77mm tube measured
    // straight off tripod smoove 2021.stl. This was 2.0u ("≈8mm printed") — 39% fatter than the
    // real leg, so pieces collided at a distance the physical ones don't and legs couldn't slip
    // through gaps they physically fit. Changing it changes how everything pushes.
    legRadius: 1.44,
    footPadFrac: 0.4,              // 3D leg's flat foot cap, as a fraction of legRadius. Kept slim so the
                                     // rendered foot matches the real printed piece — a thin leg ending in a
                                     // small rounded foot, NOT the wider gameplay footprint. (Still well above
                                     // magnet/dot size so it doesn't read as a sharp needle.)
    hubHeight: 23.095,             // = footR → legs are true quarter-circle arcs
    legSegs: 12,                   // 3D arc polyline resolution for collision
    inertiaK: 0.7,                 // rotational inertia factor (lower = redirects/spins more easily)
    pushIters: 10,                 // contact-solver iterations per sub-step
    pushRelax: 1.0,
    maxPenPerIter: 0.8,            // cap on correction per iteration — prevents overshoot/sign-flip tunneling
    minHorizFrac: 0.35,            // steepest contact normal we fully separate against (pieces only move horizontally)

    // ---------- ko: no repeating a position you didn't fight your way back to ----------
    // Two players can lock into a sterile oscillation — each shuffling between the same two poses,
    // never touching, forever. Measured on real games: one L11-vs-L9 game spent 5h52m replaying an
    // exact 4-ply loop 73 times, reaching only 14 distinct positions in 300 plies. 14 of the 18
    // capped games on record are that shape.
    //
    // The rule, as a rule: the board may not return to a position it has already been in, unless
    // there was CONTACT in between. Contact wipes the history — revisiting a position after a push
    // is a fight resuming, not a stall repeating, and Tau is a contact game (the opponent gets
    // displaced on 66% of all recorded moves). The exclusion is progressive on its own: every
    // shuffle adds another banned spot, so the loop narrows until a different foot has to move.
    //
    // Cost to real play, dry-run over all 6592 recorded games that ended in a win: 11 of them (0.17%)
    // would have had to pick a different stopping angle at some point. Nothing else changes.
    koRule: true,
    koEps: 0.25,                   // hub distance under which two poses count as the same position
    koDeg: 2,                      // ...and rotation. Same threshold as minMoveDeg: a position is
                                     // "new" once it is at least one real move away from every old one.

    // ---------- komi: the grinding games that legitimately run long ----------
    // Ko kills the stalls but not the grinds: two pieces genuinely shoving each other can fill 300
    // plies with 300 distinct positions and a 98% push rate, and still not resolve. Those used to be
    // scored as draws. Now the position is scored instead — whoever's outermost foot is nearer the
    // rim loses, which is the same margin the Hard AI already evaluates with (marginFor).
    //
    // komi is the correction that makes that scoring fair. Being ON MOVE is worth real clearance
    // that a still picture cannot see, so the side to move is spotted `komi` before the comparison.
    // Calibrated against 6592 decided games by adjudicating them early and checking the call against
    // who actually went on to win: the colour-unbiased offset is ~3u, and it flips sign exactly with
    // the side to move (−2.7/−2.9/−3.6 at plies 20/30/40 with blue to move, +4.2/+3.6/+3.3 at plies
    // 21/31/41 with red to move) — so it is tempo, not colour. At komi 3 the call agrees with the
    // real winner 74–78% of the time.
    //
    // Which is why an adjudicated game is worth komiLoss, not a whole win: it is a real result, but
    // three-quarters of one. (The measured accuracy would justify up to ~0.5; 0.3 is the cautious end.)
    moveCap: 300,                  // plies — 150 turns each, so the cap always falls at equal turns
    komi: 3.0,                     // rim clearance credited to the side on move at adjudication
    komiLoss: 0.3                  // an adjudicated result counts this much of a win
};
const norm  = a => { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; };
const radU  = p => Math.hypot(p.x, p.y);
class Piece {
    constructor(id) { this.id=id; this.color = id===0 ? '#6b9eff' : '#ff6b6b'; this.x=0; this.y=0; this.rot=0; }
    feet() {
        const r = CFG.footR, out = [];
        for (let i=0;i<3;i++){ const a=this.rot+i*(2*Math.PI/3);
            out.push({ x:this.x+Math.cos(a)*r, y:this.y+Math.sin(a)*r }); }
        return out;
    }
    rotateAround(px, py, dA) {
        const c=Math.cos(dA), s=Math.sin(dA), rx=this.x-px, ry=this.y-py;
        this.x = px + rx*c - ry*s; this.y = py + rx*s + ry*c; this.rot += dA;
    }
    anyFootOff() { return this.feet().some(f => radU(f) > CFG.edgeU + CFG.edgeEps); }
    legs() { const h={x:this.x,y:this.y}; return this.feet().map(f => [h, f]); }
    // 3D polylines of the quarter-circle legs — the same curve the 3D view renders,
    // so what you see touching is exactly what the physics feels. {x,y} board plane, h up.
    legArcs() {
        const R=CFG.footR, H=CFG.hubHeight, N=CFG.legSegs, out=[];
        for (let i=0;i<3;i++){
            const a=this.rot+i*(2*Math.PI/3), ca=Math.cos(a), sa=Math.sin(a), pts=[];
            for (let k=0;k<=N;k++){
                const ph=(k/N)*(Math.PI/2), s=Math.sin(ph)*R;
                pts.push({ x:this.x+ca*s, y:this.y+sa*s, h:Math.cos(ph)*H });
            }
            out.push(pts);
        }
        return out;
    }
}
function angInSpan(deg, a0, a1) {
    const w = x => { while(x<0)x+=360; while(x>=360)x-=360; return x; };
    deg=w(deg); let lo=w(a0), hi=w(a1);
    return lo<=hi ? (deg>=lo&&deg<=hi) : (deg>=lo||deg<=hi);
}
function nearLineIds(f, eps) {
    if (eps===undefined) eps=CFG.crossEps;
    const r=radU(f), ids=[];
    CFG.rings.forEach((R,k)=>{ if (Math.abs(r-R)<eps) ids.push('r'+k); });
    CFG.sideArcs.forEach((a,k)=>{
        const d=Math.hypot(f.x-a.cx,f.y-a.cy);
        if (Math.abs(d-a.r)<eps && angInSpan(Math.atan2(f.y-a.cy,f.x-a.cx)*180/Math.PI,a.a0,a.a1)) ids.push('a'+k);
    });
    return ids;
}
function lineSideOf(f, id) {
    if (id[0]==='r') return Math.sign(radU(f) - CFG.rings[+id[1]]) || 1;
    const a = CFG.sideArcs[+id[1]];
    return Math.sign(Math.hypot(f.x-a.cx, f.y-a.cy) - a.r) || 1;
}
function lineDistOf(f, id) {
    if (id[0]==='r') return Math.abs(radU(f) - CFG.rings[+id[1]]);
    const a = CFG.sideArcs[+id[1]];
    return Math.abs(Math.hypot(f.x-a.cx, f.y-a.cy) - a.r);
}
const LINE_INTERSECTIONS = (() => {
    const circles = [
        ...CFG.rings.map((R,k) => ({ id:'r'+k, cx:0, cy:0, r:R })),
        ...CFG.sideArcs.map((a,k) => ({ id:'a'+k, cx:a.cx, cy:a.cy, r:a.r, a0:a.a0, a1:a.a1 })),
    ];
    const pts = [];
    for (let i=0;i<circles.length;i++) for (let j=i+1;j<circles.length;j++){
        const A=circles[i], B=circles[j];
        const dx=B.cx-A.cx, dy=B.cy-A.cy, d=Math.hypot(dx,dy);
        if (d<1e-9 || d>A.r+B.r || d<Math.abs(A.r-B.r)) continue;   // concentric rings / no contact
        const x=(d*d + A.r*A.r - B.r*B.r)/(2*d), y2=A.r*A.r - x*x;
        if (y2 < 0) continue;
        const y=Math.sqrt(y2), ux=dx/d, uy=dy/d;
        for (const s of [1,-1]){
            const px=A.cx + x*ux - s*y*uy, py=A.cy + x*uy + s*y*ux;
            const inSpan = c => c.a0===undefined || angInSpan(Math.atan2(py-c.cy,px-c.cx)*180/Math.PI, c.a0, c.a1);
            if (inSpan(A) && inSpan(B)) pts.push({ x:px, y:py, lines:[A.id, B.id] });
        }
    }
    return pts;
})();
function crossingSubstep(before, after, st) {
    if (!st.contact) {
        st.contact = before.map(f => nearLineIds(f, CFG.touchEps));
        // st.earned no longer grants any free departure -- there is no turn-start grace at all now
        // (see the departure billing below). It survives only as the CORNER-SPONSOR set: which lines
        // this foot is genuinely on, and may therefore carry a free corner merge from. A line joins
        // it by being sat on at turn start or by being billed as a fresh crossing.
        st.earned = before.map(f => nearLineIds(f, CFG.touchEps));
        st.startSide = before.map((f,i) => { const m={}; for (const id of st.contact[i]) m[id]=lineSideOf(f,id); return m; });
        st.entrySide = [{},{},{}];     // approach side of each line entered THIS turn
        st.pendingMerge = [{},{},{}];  // corner-merged lines awaiting centreline validation: id -> sponsor id
        // Snapshot of what each foot was ALREADY resting on when the turn began -- a park position
        // paid for last turn, not this one. The one-line-per-foot rule below must count only lines
        // FRESHLY entered this turn against that budget; a foot that starts parked on a line and
        // then freshly touches one new line has still only spent ONE crossing this turn, even though
        // it is technically in contact with two lines at once.
        st.turnStartContact = st.contact.map(a => a.slice());
        // Has the tripod's CURRENT stretch of line contact already cost a crossing? False here on
        // purpose: lines a foot merely starts the turn sat on haven't cost anything yet -- the
        // charge lands when something actually crosses (including that foot crossing off).
        st.episodeCharged = false;
    }
    const stickEps = CFG.touchEps + CFG.lineStick;
    const next = [], nextEarned = []; let opened = 0;
    const newSides = [{},{},{}];   // entrySide additions, committed only if the substep stands
    const newPending = [{},{},{}], resolvedPending = [[],[],[]];
    const justCrossed = [];   // every line id a foot's PAD newly touched this substep (billed or free)
    for (let i=0;i<3;i++){
        // PER-FOOT contact episodes. hadContact must be this foot's own state, NOT the whole piece's:
        // a stationary pivot foot resting on a line keeps continuous contact all turn, and a piece-level
        // "any foot in contact" flag let that permanent contact mask every OTHER foot's crossings (pin a
        // foot on the inner ring, then sweep the others across as many lines as you like, all free — the
        // reported illegal AI/demo moves). Tracking each foot's own off→on transition closes that.
        const hadContact = st.contact[i].length > 0;
        const near = nearLineIds(after[i], stickEps);
        const kept = st.contact[i].filter(id => near.includes(id));
        const earned = (st.earned && st.earned[i]) ? st.earned[i].slice() : st.contact[i].slice();
        // NO GRACE: leaving a start line is free only if the foot backed off the side it started
        // on. Cross to the OTHER side and it is billed, exactly like a fresh entry -- starting a
        // turn sat on a line no longer buys a free trip over it.
        for (const id of st.contact[i]) if (!near.includes(id)) {
            if (st.startSide && st.startSide[i] && st.startSide[i][id] !== undefined &&
                lineSideOf(after[i], id) !== st.startSide[i][id]) {
                opened++;
                justCrossed.push(id);
            }
        }
        // Deferred corner-merge validation: a merged line rode in free on the promise that the foot
        // is rounding the PRINTED CORNER — one continuous crossing over the point where the lines
        // meet. That promise is checked the moment the merged line's CENTRELINE is actually crossed:
        // right at the corner, the sponsoring line passes through the same point, so the magnet is
        // still on it (≤ holdEps at any incidence angle). A foot slipping PAST the corner crosses
        // the second centreline with the sponsor's line 0.6+ behind it — magnet clearly off — and
        // that crossing is billed here as a fresh one (blocking if over budget). This is what makes
        // the CW/CCW two-step opening slip impossible while the centre-spin (feet riding dead ON
        // the ring, magnet distance ~0 at every corner) keeps sweeping corners for free.
        for (const id of kept) {
            const sponsor = st.pendingMerge[i][id];
            if (sponsor === undefined) continue;
            const flipped = st.entrySide[i][id] !== undefined && lineSideOf(after[i], id) !== st.entrySide[i][id];
            if (flipped) {
                if (lineDistOf(after[i], sponsor) > CFG.holdEps) opened++;   // missed the corner: it's a real 2nd crossing
                resolvedPending[i].push(id);   // validated once, at the first centreline flip
            } else if (lineDistOf(after[i], id) <= CFG.crossEps && lineDistOf(after[i], sponsor) > CFG.holdEps) {
                // The sponsor is already lost and the foot is about to reach the merged line's
                // magnet zone: the corner roll is doomed, so convert it to an ordinary billed
                // crossing NOW, while the foot is still outside grace reach. If the budget rejects,
                // the swing stops here — resting beyond crossEps, so next turn can't grace-cross
                // the line it never paid for (the three-step version of the corner slip).
                opened++;
                resolvedPending[i].push(id);
            }
        }
        let entered = false, blockedSecond = false;
        for (const id of nearLineIds(after[i], CFG.touchEps))
            if (!kept.includes(id)) {
                // ONE LINE PER FOOT PER TURN. A foot already touching a line must STOP SHORT of a
                // different one -- it is not carried across by an overlap where two lines happen to
                // run close together. The budget is still a whole-piece episode (two DIFFERENT feet
                // taking two lines in one motion is one crossing, unchanged); this bounds what a
                // SINGLE foot may do inside that episode.
                //
                // The exception is a genuine printed corner, where the two lines actually meet:
                // rounding that is one continuous crossing, and it is what keeps the unbounded
                // centre-spin legal (feet riding dead on the inner ring meet each arc AT its
                // intersection). cornerEps is the same magnet-surface band as everything else --
                // the magnet has to actually reach the crossing point.
                //
                // Reported from real play: a max-CW-then-max-anti-CW opening took a corner the
                // board refuses. Measured, foot1 crossed r0 and then a0 in one turn, bridged by a
                // 1.2deg window (12.4-13.2deg) where it touched both at once, 1.9mm to the SIDE of
                // their printed corner -- beside it, not on it. Now billed as the second crossing
                // it is, so move 2 stops at 12.0deg instead of running to 74.4deg. Genuine corner
                // rounds (measured at 1.48mm, inside the band) still merge free.
                //
                // Only a line FRESHLY entered THIS turn spends the budget -- a line the foot was
                // already resting on at turn start (a park position paid for last turn) does not.
                // Without this, a piece parked with a foot on one line could never move that foot
                // again in the direction of any nearby second line, even on a brand new turn with a
                // fresh budget: reported from real play as "forever blocked" continuing a swing from
                // a parked position, reproduced as pivot1 CCW, pivot2 CW, pivot2 CW again -- the
                // third move died at 0.0deg because move 2 legitimately parks foot1 on r0, and move
                // 3's first substep found that foot already "on a line" and refused to let it touch
                // a0 at all, though this turn had spent nothing yet.
                const freshKept = kept.filter(h => !st.turnStartContact[i].includes(h));
                if (freshKept.length > 0) {
                    const roundingCorner = freshKept.some(h => LINE_INTERSECTIONS.some(P =>
                        P.lines.includes(id) && P.lines.includes(h) &&
                        Math.hypot(after[i].x-P.x, after[i].y-P.y) <= CFG.cornerEps));
                    if (!roundingCorner) { blockedSecond = true; break; }
                }
                kept.push(id);
                if (!earned.includes(id)) earned.push(id);   // fresh billed entry: genuine contact
                newSides[i][id] = lineSideOf(after[i], id);  // approach side, for the centreline-flip check
                justCrossed.push(id);
                entered = true;
            }
        if (blockedSecond) return true;   // roll back: this foot must stop short of the second line
        if (entered) opened++;   // this foot opened a fresh crossing
        next.push(kept);
        nextEarned.push(earned.filter(id => kept.includes(id)));
    }
    // The budget is a WHOLE-TRIPOD state, not a per-foot one:
    //   a swing starts with the counter at 0; the moment a foot goes onto a line it goes to 1;
    //   while any foot is still on a line, further feet going onto lines are part of that same
    //   crossing and cost nothing; once every foot is off the lines the crossing is spent, and
    //   touching another line after that would be a second one.
    // Staying off the lines is free, so a swing may keep going after its crossing is spent -- it
    // only stops at the point where a foot would touch a line again.
    //
    // This used to be billed per SUBSTEP, which merged only the openings landing in the same 0.4
    // degrees. Two feet crossing different lines a hair apart -- visibly simultaneous, and legal --
    // missed that window and were charged twice.
    //
    // "On a line" here is the true touching band (touchEps), NOT the sticky retention band the
    // contact sets use: lineStick exists to stop contact flickering at the band edge, and letting
    // it widen the merge window too would hold a crossing open for a quarter unit after the foot
    // has visibly left the line, chaining crossings that are plainly separate.
    // The pivot is excluded throughout -- it is the centre of rotation, never moves and crosses
    // nothing, so a foot parked there neither costs a crossing nor keeps one open.
    if (opened && !st.episodeCharged) {
        if (st.crossings + 1 > CFG.maxCrossingsPerTurn) return true;   // over the per-turn budget: roll back
        st.crossings += 1;                  // billed when it OPENS (parking on a line spends it too)
        st.episodeCharged = true;
    }
    st.contact = next;
    st.earned = nextEarned;
    // Crossing closes the instant the whole tripod is clear of every line (pivot excluded). It is
    // spent at that point, so the next foot to touch a line opens a NEW one -- refused at a budget
    // of 1. Measured on `after`, the pose this substep actually reached.
    if (!after.some((f, i) => i !== st.pinned && nearLineIds(f, CFG.touchEps).length > 0))
        st.episodeCharged = false;
    for (let i=0;i<3;i++) {
        for (const id in newSides[i]) st.entrySide[i][id] = newSides[i][id];
        for (const id in newPending[i]) st.pendingMerge[i][id] = newPending[i][id];
        for (const id of resolvedPending[i]) delete st.pendingMerge[i][id];
        for (const id in st.pendingMerge[i]) if (!next[i].includes(id)) delete st.pendingMerge[i][id];   // backed out of the band unflipped: free retreat
    }
    // Only reaches here on a committed substep (the budget check above already returned on a
    // rollback), so this never records a crossing that got undone.
    if (justCrossed.length) st.justCrossed = (st.justCrossed || []).concat(justCrossed);
    return false;
}
function segClosest(a, b, c, d) {
    const d1={x:b.x-a.x,y:b.y-a.y}, d2={x:d.x-c.x,y:d.y-c.y}, r={x:a.x-c.x,y:a.y-c.y};
    const A=d1.x*d1.x+d1.y*d1.y, E=d2.x*d2.x+d2.y*d2.y, F=d2.x*r.x+d2.y*r.y;
    const C=d1.x*r.x+d1.y*r.y, B=d1.x*d2.x+d1.y*d2.y, denom=A*E-B*B;
    let s = denom!==0 ? Math.min(1,Math.max(0,(B*F-C*E)/denom)) : 0;
    let t = (B*s+F)/E;
    if (t<0){ t=0; s=Math.min(1,Math.max(0,-C/A)); }
    else if (t>1){ t=1; s=Math.min(1,Math.max(0,(B-C)/A)); }
    const pa={x:a.x+d1.x*s,y:a.y+d1.y*s}, pb={x:c.x+d2.x*t,y:c.y+d2.y*t};
    return { pa, pb, dist:Math.hypot(pa.x-pb.x,pa.y-pb.y) };
}
function segClosest3(p1,q1,p2,q2){
    const d1={x:q1.x-p1.x,y:q1.y-p1.y,h:q1.h-p1.h};
    const d2={x:q2.x-p2.x,y:q2.y-p2.y,h:q2.h-p2.h};
    const r ={x:p1.x-p2.x,y:p1.y-p2.y,h:p1.h-p2.h};
    const a=d1.x*d1.x+d1.y*d1.y+d1.h*d1.h, e=d2.x*d2.x+d2.y*d2.y+d2.h*d2.h;
    const f=d2.x*r.x+d2.y*r.y+d2.h*r.h,   c=d1.x*r.x+d1.y*r.y+d1.h*r.h;
    const b=d1.x*d2.x+d1.y*d2.y+d1.h*d2.h, denom=a*e-b*b;
    let s = denom>1e-12 ? Math.min(1,Math.max(0,(b*f-c*e)/denom)) : 0;
    let t = e>1e-12 ? (b*s+f)/e : 0;
    if (t<0){ t=0; s=Math.min(1,Math.max(0, a>1e-12 ? -c/a : 0)); }
    else if (t>1){ t=1; s=Math.min(1,Math.max(0, a>1e-12 ? (b-c)/a : 0)); }
    const pa={x:p1.x+d1.x*s, y:p1.y+d1.y*s, h:p1.h+d1.h*s};
    const pb={x:p2.x+d2.x*t, y:p2.y+d2.y*t, h:p2.h+d2.h*t};
    const dx=pb.x-pa.x, dy=pb.y-pa.y, dh=pb.h-pa.h;
    return { pa, pb, dist:Math.sqrt(dx*dx+dy*dy+dh*dh) };
}
function arcClosest(A, B){
    let best=null;
    for (let i=0;i<A.length-1;i++) for (let j=0;j<B.length-1;j++){
        const c=segClosest3(A[i],A[i+1],B[j],B[j+1]);
        if (!best || c.dist<best.dist) best=c;
    }
    return best;
}
function pointArcClosest(p, A){
    let best=null;
    for (let i=0;i<A.length-1;i++){
        const a=A[i], b=A[i+1];
        const dx=b.x-a.x, dy=b.y-a.y, dh=b.h-a.h;
        const len2=dx*dx+dy*dy+dh*dh || 1e-12;
        let t=((p.x-a.x)*dx+(p.y-a.y)*dy+(p.h-a.h)*dh)/len2;
        t=Math.max(0,Math.min(1,t));
        const pt={x:a.x+dx*t, y:a.y+dy*t, h:a.h+dh*t};
        const d=Math.hypot(pt.x-p.x, pt.y-p.y, pt.h-p.h);
        if (!best || d<best.dist) best={pt, dist:d};
    }
    return best;
}
function resolvePush(active, opp) {
    const minD = CFG.legRadius*2, hubR = CFG.legRadius*1.9, H = CFG.hubHeight;
    const m = 1, I = CFG.inertiaK * CFG.footR * CFG.footR;
    // freeze the opponent's "which side" reference: the deep-crossing branch picks a
    // push direction from opp's position, and if that position is itself being corrected
    // inside this loop the sign can flip between iterations and the piece just chatters.
    const opp0 = { x: opp.x, y: opp.y };
    const aArcs = active.legArcs(), aChords = active.legs();
    const aHub = { x:active.x, y:active.y, h:H };

    // horizontal push of magnitude sep along unit (nx,ny), applied at contact point (px,py)
    const apply = (px, py, nx, ny, sep) => {
        // cap the correction per iteration — a full-penetration shove recomputes direction
        // from a position that already moved, and a big jump can overshoot past the piece.
        sep = Math.min(sep, CFG.maxPenPerIter);
        const rx = px-opp.x, ry = py-opp.y;
        const rn = rx*ny - ry*nx;                    // r × n
        const wEff = 1/m + rn*rn/I;
        const lambda = CFG.pushRelax * sep / wEff;
        opp.x   += (lambda/m)*nx;
        opp.y   += (lambda/m)*ny;
        opp.rot += (lambda*rn)/I;
    };
    // turn a 3D contact (pa on active, pb on opp, dist) into a horizontal push
    const push3d = (pa, pb, dist, gap) => {
        const nx3=(pb.x-pa.x)/dist, ny3=(pb.y-pa.y)/dist;
        const hf = Math.hypot(nx3, ny3);             // horizontal fraction of the contact normal
        if (hf < 1e-4) return;                       // dead-vertical stack: horizontal motion can't separate it
        // separating the tubes by `gap` along the normal needs gap/hf of horizontal travel;
        // floor hf so a steep (near-vertical) graze doesn't demand a huge shove.
        apply(pb.x, pb.y, nx3/hf, ny3/hf, gap/Math.max(hf, CFG.minHorizFrac));
    };

    for (let iter=0; iter<CFG.pushIters; iter++) {
        const oArcs = opp.legArcs(), oChords = opp.legs();
        const oHub = { x:opp.x, y:opp.y, h:H };
        let any = false;
        for (let i=0;i<3;i++) for (let j=0;j<3;j++) {
            // exact prune: an arc projects straight down onto its hub→foot chord, so the 3D
            // gap can never be smaller than the flat top-down gap between the chords.
            if (segClosest(aChords[i][0],aChords[i][1],oChords[j][0],oChords[j][1]).dist >= minD) continue;
            const c = arcClosest(aArcs[i], oArcs[j]);
            if (c.dist >= minD) continue;            // clears over/under — no touch, no push
            any = true;
            if (c.dist < 0.3) {                      // tubes deeply crossed: shove ⟂ off the active leg, toward opp's side
                const A=aChords[i], ax=A[1].x-A[0].x, ay=A[1].y-A[0].y, L=Math.hypot(ax,ay)||1;
                let nx=-ay/L, ny=ax/L;
                if (nx*(opp0.x-c.pa.x)+ny*(opp0.y-c.pa.y) < 0){ nx=-nx; ny=-ny; }
                apply(c.pb.x, c.pb.y, nx, ny, minD);
            } else {
                push3d(c.pa, c.pb, c.dist, minD - c.dist);
            }
        }
        // hub ball contacts: my hub vs their legs, their hub vs my legs, hub vs hub
        const hubLegD = hubR + CFG.legRadius;
        for (let j=0;j<3;j++){
            const c = pointArcClosest(aHub, oArcs[j]);
            if (c.dist < hubLegD && c.dist > 1e-6){ any=true; push3d(aHub, c.pt, c.dist, hubLegD - c.dist); }
        }
        for (let i=0;i<3;i++){
            const c = pointArcClosest(oHub, aArcs[i]);
            if (c.dist < hubLegD && c.dist > 1e-6){ any=true; push3d(c.pt, oHub, c.dist, hubLegD - c.dist); }
        }
        {
            const dx=opp.x-active.x, dy=opp.y-active.y, d=Math.hypot(dx,dy);
            if (d < 2*hubR && d > 1e-6){ any=true; apply(opp.x, opp.y, dx/d, dy/d, 2*hubR - d); }
        }
        if (!any) break;
    }
}
let G;
function takeSnap(){ return G.pieces.map(p=>({x:p.x, y:p.y, rot:p.rot})); }
function restoreSnap(){
    if (!G.snap) return;
    G.pieces.forEach((p,i)=>{ p.x=G.snap[i].x; p.y=G.snap[i].y; p.rot=G.snap[i].rot; });
    G.turnDir=0; G.crossings=0; G.atLimit=false; G.netRad=0; G.contact=null;
    G.contact = null;   // feet are back at their start pose — contact re-derives from it next substep
    G.justCrossed = [];   // any line touched during the undone motion didn't really happen either
}
function pinFoot(idx) {
    const feet = G.pieces[G.active].feet();
    G.pinned = idx; G.pivot = { x:feet[idx].x, y:feet[idx].y };
    G.turnDir = 0; G.crossings = 0; G.atLimit = false; G.netRad = 0; G.limitReason = null;
    G.snap = takeSnap();
    // Contact state re-derives from the pinned pose at the first substep; whatever the feet already
    // sit on becomes the turn's FREE opening episode ("a foot that starts on a line leaves it for free").
    G.contact = null;
    // AI planning explores many hypothetical swings on this same live G before settling on one (see
    // aiChoosePlan*/ladderPlan*), so justCrossed can be full of lines a foot only touched "in its
    // head". This is the one point every real move -- human or AI's actual chosen swing -- starts
    // from, so wiping it here keeps only what the swing that's really about to play touches.
    G.justCrossed = [];
}
function applySwing(dA) {
    if (dA===0 || !G.pivot) return;   // no pivot: a stale animation tick raced a reset — ignore it
    // one direction per turn — but only lock it once the player has clearly committed
    // (|net| >= lockDeg). Locking on the very first pointer sample let touch jitter pick
    // the direction, and then every drag the player actually intended was rejected.
    if (G.turnDir!==0 && Math.sign(dA)!==G.turnDir) return;
    const active=G.pieces[G.active], opp=G.pieces[1-G.active];
    const stepMax=CFG.substepDeg*Math.PI/180;
    const steps=Math.max(1, Math.ceil(Math.abs(dA)/stepMax));
    const step=dA/steps;
    for (let s=0;s<steps;s++){
        const before=active.feet();
        active.rotateAround(G.pivot.x, G.pivot.y, step);
        // You can't swing yourself off: if this substep would carry one of the ACTIVE piece's own
        // feet past the rim, roll it back and stop the swing right at the edge. Checked BEFORE the
        // crossing rule so a rolled-back step never records a phantom crossing. (Pushing the OPPONENT
        // off is untouched -- that happens in resolvePush and is still how you win.)
        if (active.anyFootOff()){
            active.rotateAround(G.pivot.x, G.pivot.y, -step); G.atLimit=true; G.limitReason='selfoff'; break; }
        if (crossingSubstep(before, active.feet(), G)){          // hit the one-crossing limit: roll this step back
            active.rotateAround(G.pivot.x, G.pivot.y, -step); G.atLimit=true; G.limitReason='cross'; break; }
        G.netRad+=step;
        resolvePush(active, opp);
    }
    if (G.turnDir===0 && Math.abs(G.netRad) >= CFG.lockDeg*Math.PI/180)
        G.turnDir = Math.sign(G.netRad);
}
function clearTurn(){ G.pinned=null; G.pivot=null; G.handle=null; G.turnDir=0;
    G.crossings=0; G.atLimit=false; G.netRad=0; G.ptrAngle=null; G.snap=null;
    G.contact=null; }
function endTurn() {
    const active=G.pieces[G.active], opp=G.pieces[1-G.active];
    if (active.anyFootOff()){ G.over=true; G.winner=1-G.active; }
    else if (opp.anyFootOff()){ G.over=true; G.winner=G.active; }
    else G.active=1-G.active;
    clearTurn();
}
function koBoardPose(){ const b=G.pieces[0], r=G.pieces[1]; return [b.x,b.y,b.rot,r.x,r.y,r.rot]; }
function koSamePiece(a, b, o){
    let dr = Math.abs(a[o+2]-b[o+2]) % (2*Math.PI);
    dr = Math.min(dr, 2*Math.PI-dr);
    return dr < CFG.koDeg*Math.PI/180 && Math.hypot(a[o]-b[o], a[o+1]-b[o+1]) < CFG.koEps;
}
function koSameBoard(a, b){ return koSamePiece(a,b,0) && koSamePiece(a,b,3); }
function koContactThisTurn(){
    if (!G.snap) return false;
    const o = 1-G.active, p = G.pieces[o], s = G.snap[o];
    return !koSamePiece([s.x, s.y, s.rot], [p.x, p.y, p.rot], 0);
}
function koViolation(){
    return !!(CFG.koRule && G.koHist && !koContactThisTurn() &&
              G.koHist.some(q => koSameBoard(q, koBoardPose())));
}
function koNote(){
    if (!CFG.koRule || !G.koHist) return;
    if (koContactThisTurn()) G.koHist.length = 0;   // a push resets the history for both sides
    G.koHist.push(koBoardPose());
}
function koReset(){ if (G && G.koHist) { G.koHist.length = 0; if (CFG.koRule) G.koHist.push(koBoardPose()); } }
function adjudicate(){
    const m = outermostRadU(G.pieces[1]) - outermostRadU(G.pieces[0]);
    const adj = m + (G.active === 0 ? CFG.komi : -CFG.komi);
    G.over = true; G.adjudicated = true;
    G.winner = Math.abs(adj) < 1e-9 ? null : (adj > 0 ? 0 : 1);   // dead level really is a draw
}
function commitTurn(){
    koNote();          // must read G.snap, which endTurn()'s clearTurn() is about to wipe
    endTurn();
    if (!G.over && CFG.moveCap && ++G.plies >= CFG.moveCap) adjudicate();
}
function koLegalizePlan(plan){
    if (!CFG.koRule || !plan || !G.koHist || !G.koHist.length) return plan;
    // Cheap pre-filter. Three necessary conditions for a banned stopping point, none of which needs
    // anything simulated -- if no remembered position meets all three, no stop on this arc can be
    // banned and the trial swings below are pure waste:
    //
    //   1. NOT where we already stand. A move has to move (minMoveDeg), and 2 degrees of swing
    //      carries the hub ~0.8u, well past koEps -- so a remembered position that IS the current
    //      one can never be stopped at. This clause is the one that matters, and it is the one two
    //      earlier attempts at this filter both missed: the entry filed at the end of the opponent's
    //      last turn describes exactly where the board stands right now, so it satisfies every
    //      other test trivially and the filter skipped nothing at all. Cost of missing it, measured:
    //      the rule ate 34-44% of self-play wall time instead of ~2%.
    //   2. The opponent agrees. A banned stop implies no contact this turn (contact wipes the
    //      history), and no contact means the opponent has not moved -- so a remembered position has
    //      to have it standing where it still stands.
    //   3. Reachable. This turn pins a foot and rotates the piece about it, so the mover's hub
    //      travels a circle of radius footR centred on that pinned foot; a remembered hub that is
    //      not ON that circle cannot be reached however the swing goes.
    const here = koBoardPose(), oppOff = (1-G.active)*3, movOff = G.active*3;
    const piv = G.pieces[G.active].feet()[plan.pivotIdx];
    const couldReach = G.koHist.some(q =>
        !koSamePiece(q, here, movOff) &&
        koSamePiece(q, here, oppOff) &&
        Math.abs(Math.hypot(q[movOff]-piv.x, q[movOff+1]-piv.y) - CFG.footR) < CFG.koEps);
    if (!couldReach) return plan;
    const step = CFG.koDeg*Math.PI/180, minMove = CFG.minMoveDeg*Math.PI/180;
    const snap0 = takeSnap();
    const restore = () => { G.pieces.forEach((p,i)=>{ p.x=snap0[i].x; p.y=snap0[i].y; p.rot=snap0[i].rot; });
                            G.turnDir=0; G.crossings=0; G.atLimit=false; G.netRad=0;
                            G.contact=null; G.justCrossed=[]; };
    // null = not a real move at all (too small / no room), true = banned, false = legal
    const tryStop = (targetRad) => {
        if (targetRad < minMove) return null;
        pinFoot(plan.pivotIdx);
        let g = 0;
        while (!G.atLimit && Math.abs(G.netRad) < targetRad && g++ < 5000)
            applySwing(plan.dir*Math.min(AI_STEP_RAD, targetRad - Math.abs(G.netRad)));
        const net = Math.abs(G.netRad), banned = koViolation();
        restore();
        return net < minMove ? null : banned;
    };
    const base = Math.abs(plan.targetRad);
    if (tryStop(base) !== true) { restore(); return plan; }
    for (let k = 1; k <= 24; k++)
        for (const t of [base - k*step, base + k*step])
            if (tryStop(t) === false) { restore(); return { ...plan, targetRad: t }; }
    restore();
    return plan;
}
const AI_STEP_RAD = 3 * Math.PI/180;
const AI_SAFETY_CAP_RAD = 170 * Math.PI/180;
function directionToward(pivot, footPos, targetPos) {
    const aFoot=Math.atan2(footPos.y-pivot.y, footPos.x-pivot.x);
    const aTarget=Math.atan2(targetPos.y-pivot.y, targetPos.x-pivot.x);
    return norm(aTarget-aFoot) >= 0 ? 1 : -1;
}
function aiChoosePlan(aiIdx) {
    const ai=G.pieces[aiIdx], human=G.pieces[1-aiIdx];
    const offense = radU(ai) < radU(human);
    const ref = offense ? {x:human.x,y:human.y} : {x:0,y:0};
    const feet = ai.feet();
    const order=[0,1,2].sort((p,q)=>
        radU({x:feet[q].x-ref.x,y:feet[q].y-ref.y}) - radU({x:feet[p].x-ref.x,y:feet[p].y-ref.y}));
    return { pivotIdx:order[1], swingIdx:order[0], target:ref };   // order[0]=furthest, order[1]=2nd-furthest
}
function aiSwingDir(dir) {
    let total=0;
    while (Math.abs(total) < AI_SAFETY_CAP_RAD) {
        applySwing(dir*AI_STEP_RAD);
        total = G.netRad;
        if (G.atLimit) break;
    }
    return G.netRad;
}
function searchedPlanFor(difficulty, aiIdx){
    return difficulty==='master' ? aiChoosePlanMaster(aiIdx)
         : difficulty==='hard'   ? aiChoosePlanHard(aiIdx)
         : difficulty==='zone'   ? aiChoosePlanZone(aiIdx) : null;
}
function aiStopFrac(){ return aiDifficulty==='dumb' ? 0.6 + Math.random()*0.3 : 1; }
const HARD_WIN_BONUS = 1e6;
const HARD_MIN_MOVE_RAD = CFG.minMoveDeg * Math.PI/180;
function outermostRadU(piece){ let m=0; for (const f of piece.feet()){ const r=radU(f); if (r>m) m=r; } return m; }
function marginFor(idx){ return outermostRadU(G.pieces[1-idx]) - outermostRadU(G.pieces[idx]); }
function hubLeverageFor(attackerIdx){
    const a=G.pieces[attackerIdx], v=G.pieces[1-attackerIdx];
    const contact=CFG.legRadius*2.9; // victim hub ball radius (1.9r) + attacking leg tube (1r)
    const vc=Math.hypot(v.x,v.y)||1e-9, ux=-v.x/vc, uy=-v.y/vc;
    const tx=v.x+ux*contact, ty=v.y+uy*contact; // leg-centre target on centre-facing hub surface
    let best=0;
    for(const f of a.feet()){
        const dx=f.x-a.x, dy=f.y-a.y, l2=dx*dx+dy*dy||1e-9;
        const t=Math.max(0,Math.min(1,((tx-a.x)*dx+(ty-a.y)*dy)/l2));
        const qx=a.x+t*dx, qy=a.y+t*dy, d=Math.hypot(tx-qx,ty-qy);
        const near=Math.max(0,1-d/12);
        // Hard directional gate: a close leg on the rim-facing half of the hub is not attack
        // leverage.  Full credit arrives only as the working point reaches the centre-side surface.
        const centreSide=Math.max(0,Math.min(1,((qx-v.x)*ux+(qy-v.y)*uy)/contact));
        const working=.65+.35*Math.sin(Math.PI*t);
        best=Math.max(best,near*centreSide*working);
    }
    return 10*best;
}
function simMoveToLimit(pivot, dir){
    pinFoot(pivot);   // resets the turn accumulators AND arms the leave-a-start-line grace
    let guard=0;
    while (Math.abs(G.netRad) < AI_SAFETY_CAP_RAD && !G.atLimit && guard++ < 500) applySwing(dir*AI_STEP_RAD);
    return G.netRad;
}
function aiChoosePlanHard(aiIdx){
    const humanIdx = 1 - aiIdx, origActive = G.active;
    const snap0 = takeSnap();
    const restore = (snap) => {
        G.pieces.forEach((p,i)=>{ p.x=snap[i].x; p.y=snap[i].y; p.rot=snap[i].rot; });
        G.turnDir=0; G.crossings=0; G.atLimit=false; G.netRad=0; G.contact=null;
    };
    let best = null;   // { pivotIdx, dir, targetRad, score }
    for (let mp=0; mp<3; mp++) for (const md of [1,-1]) {
        restore(snap0); G.active = aiIdx;
        const net = simMoveToLimit(mp, md);
        if (Math.abs(net) < HARD_MIN_MOVE_RAD) continue;          // this pivot/dir can't make a real move
        if (G.pieces[aiIdx].anyFootOff()) continue;               // swinging this far offs my OWN foot — never
        let score;
        if (G.pieces[humanIdx].anyFootOff()) {
            score = HARD_WIN_BONUS + marginFor(aiIdx);            // this move pushes the human off — instant win
        } else {
            const snap1 = takeSnap();                             // the human now replies with their best six-way move
            let worst = Infinity;
            for (let op=0; op<3; op++) for (const od of [1,-1]) {
                restore(snap1); G.active = humanIdx;
                const onet = simMoveToLimit(op, od);
                if (Math.abs(onet) < HARD_MIN_MOVE_RAD) continue;
                if (G.pieces[humanIdx].anyFootOff()) continue;    // the human wouldn't off their own foot — ignore
                const m = G.pieces[aiIdx].anyFootOff() ? -HARD_WIN_BONUS : marginFor(aiIdx);
                if (m < worst) worst = m;
            }
            score = worst === Infinity ? marginFor(aiIdx) : worst;   // human had no legal reply — take my own position
        }
        if (!best || score > best.score) best = { pivotIdx: mp, dir: md, targetRad: Math.abs(net), score };
    }
    restore(snap0); G.active = origActive;
    return best;
}
const MASTER_ZONE_W = 0.5;
const MASTER_PARK_W = 0.8;
const MASTER_PARK_KEEP = 4;
const PARK_LO = 0.05, PARK_HI = 0.34;
const SHOVE_EPS = 0.05;
function masterEval(aiIdx, mw){
    let parks = 0;
    for (const f of G.pieces[aiIdx].feet())   if (nearLineIds(f, CFG.crossEps).length) parks++;   // magnet-on: only parks that actually bank grace
    for (const f of G.pieces[1-aiIdx].feet()) if (nearLineIds(f, CFG.crossEps).length) parks--;
    let s = marginFor(aiIdx)
         + ((mw && mw.zone) || MASTER_ZONE_W) * (pieceZoneScore(G.pieces[aiIdx]) - pieceZoneScore(G.pieces[1-aiIdx]))
         + ((mw && mw.park) || MASTER_PARK_W) * parks;
    if (mw && mw.oppFree){ let free=0;
        for (const f of G.pieces[1-aiIdx].feet()){ let d=1e9;
            CFG.rings.forEach(R => d=Math.min(d, Math.abs(radU(f)-R)));
            CFG.sideArcs.forEach(a => { if (angInSpan(Math.atan2(f.y-a.cy,f.x-a.cx)*180/Math.PI, a.a0, a.a1)) d=Math.min(d, Math.abs(Math.hypot(f.x-a.cx,f.y-a.cy)-a.r)); });
            free += Math.min(d, 10); }
        s += mw.oppFree * free; }
    return s;
}
function aiChoosePlanMaster(aiIdx, mw){
    const humanIdx = 1 - aiIdx, origActive = G.active;
    const snap0 = takeSnap();
    const restore = (snap) => {
        G.pieces.forEach((p,i)=>{ p.x=snap[i].x; p.y=snap[i].y; p.rot=snap[i].rot; });
        G.turnDir=0; G.crossings=0; G.atLimit=false; G.netRad=0; G.contact=null;
    };
    // ply 1: sweep each (pivot × direction) once to its limit, snapshotting up to 2 park stops per
    // sweep on the way (first entry per foot×line pair) plus the limit itself.
    const cands = [];
    for (let mp=0; mp<3; mp++) for (const md of [1,-1]) {
        restore(snap0); G.active = aiIdx;
        pinFoot(mp);
        const seen = {}; let parksHere = 0, guard = 0;
        while (Math.abs(G.netRad) < AI_SAFETY_CAP_RAD && !G.atLimit && guard++ < 500) {
            applySwing(md*AI_STEP_RAD);
            if (parksHere < 2 && Math.abs(G.netRad) >= HARD_MIN_MOVE_RAD && !G.pieces[aiIdx].anyFootOff()) {
                const feet = G.pieces[aiIdx].feet();
                for (let i=0; i<3 && parksHere<2; i++) {
                    if (i === mp) continue;
                    for (const id of nearLineIds(feet[i], PARK_HI)) {
                        if (nearLineIds(feet[i], PARK_LO).includes(id)) continue;   // skip dead-centre stops; park just off centre, magnet still on the ink
                        const key = i+':'+id;
                        if (seen[key]) continue;
                        seen[key] = true;
                        cands.push({ pivotIdx: mp, dir: md, targetRad: Math.abs(G.netRad), snap: takeSnap(), park: true });
                        parksHere++; break;
                    }
                }
            }
        }
        if (Math.abs(G.netRad) >= HARD_MIN_MOVE_RAD && !G.pieces[aiIdx].anyFootOff())
            cands.push({ pivotIdx: mp, dir: md, targetRad: Math.abs(G.netRad), snap: takeSnap() });
    }
    // 0-ply glance: keep every limit move, and only the strongest few parks (wins float up)
    for (const c of cands) {
        restore(c.snap);
        c.quick = G.pieces[humanIdx].anyFootOff() ? HARD_WIN_BONUS + masterEval(aiIdx, mw) : masterEval(aiIdx, mw);
    }
    cands.sort((a,b) => b.quick - a.quick);
    let parksKept = 0;
    for (let i = 0; i < cands.length; ) {
        if (cands[i].park && ++parksKept > MASTER_PARK_KEEP) cands.splice(i, 1); else i++;
    }
    let best = null;   // { pivotIdx, dir, targetRad, score }
    for (const c of cands) {
        restore(c.snap); G.active = aiIdx;
        let score;
        if (G.pieces[humanIdx].anyFootOff()) {
            score = HARD_WIN_BONUS + masterEval(aiIdx, mw);            // immediate win -- no need to look further
        } else {
            const snap1 = takeSnap();
            let worst = Infinity;                                  // the human picks their best (= my worst) reply
            reply:
            for (let op=0; op<3; op++) for (const od of [1,-1]) {
                restore(snap1); G.active = humanIdx;
                const onet = simMoveToLimit(op, od);
                if (Math.abs(onet) < HARD_MIN_MOVE_RAD) continue;
                if (G.pieces[humanIdx].anyFootOff()) continue;     // the human wouldn't off their own foot
                let replyScore;
                if (G.pieces[aiIdx].anyFootOff()) {
                    replyScore = -HARD_WIN_BONUS;                  // that reply wins for the human outright
                } else {
                    const snap2 = takeSnap();
                    let bestFollow = -Infinity;                    // my turn again -- take my best follow-up
                    for (let fp=0; fp<3 && bestFollow < HARD_WIN_BONUS/2; fp++) for (const fd of [1,-1]) {
                        restore(snap2); G.active = aiIdx;
                        const fnet = simMoveToLimit(fp, fd);
                        if (Math.abs(fnet) < HARD_MIN_MOVE_RAD) continue;
                        if (G.pieces[aiIdx].anyFootOff()) continue;
                        const fscore = G.pieces[humanIdx].anyFootOff() ? HARD_WIN_BONUS + masterEval(aiIdx, mw) : masterEval(aiIdx, mw);
                        if (fscore > bestFollow) bestFollow = fscore;
                    }
                    replyScore = bestFollow === -Infinity ? masterEval(aiIdx, mw) : bestFollow;   // no legal follow-up -- take the current margin
                }
                if (replyScore < worst) worst = replyScore;
                if (best && worst <= best.score) break reply;      // can't beat the incumbent — stop refuting
            }
            score = worst === Infinity ? masterEval(aiIdx, mw) : worst;   // the human had no legal reply at all
        }
        if (!best || score > best.score) best = { pivotIdx: c.pivotIdx, dir: c.dir, targetRad: c.targetRad, score };
    }
    restore(snap0); G.active = origActive;
    return best;
}
function zoneValue(p){
    const r = radU(p);
    const band = r < CFG.rings[0] ? 4 : r < CFG.rings[1] ? 3 : 2;
    const inLens = CFG.sideArcs.some(a => Math.hypot(p.x-a.cx, p.y-a.cy) < a.r);
    return inLens ? band - 1 : band;
}
function pieceZoneScore(piece){ return piece.feet().reduce((s,f) => s + zoneValue(f), 0); }
function aiChoosePlanZone(aiIdx){
    const humanIdx = 1 - aiIdx, origActive = G.active;
    const snap0 = takeSnap();
    const restore = (snap) => {
        G.pieces.forEach((p,i)=>{ p.x=snap[i].x; p.y=snap[i].y; p.rot=snap[i].rot; });
        G.turnDir=0; G.crossings=0; G.atLimit=false; G.netRad=0; G.contact=null;
    };
    let best = null;   // { pivotIdx, dir, targetRad, score }
    for (let mp=0; mp<3; mp++) for (const md of [1,-1]) {
        restore(snap0); G.active = aiIdx;
        const net = simMoveToLimit(mp, md);
        if (Math.abs(net) < HARD_MIN_MOVE_RAD) continue;
        if (G.pieces[aiIdx].anyFootOff()) continue;
        const score = G.pieces[humanIdx].anyFootOff()
            ? HARD_WIN_BONUS + pieceZoneScore(G.pieces[aiIdx])
            : pieceZoneScore(G.pieces[aiIdx]) - pieceZoneScore(G.pieces[humanIdx]);
        if (!best || score > best.score) best = { pivotIdx: mp, dir: md, targetRad: Math.abs(net), score };
    }
    restore(snap0); G.active = origActive;
    return best;
}
let cx = 0, cy = 0, scale = 1;
let aiIdx = 1, humanIdx = 0;
let vsAI = false, aiAnim = null, aiTimer = null, aiGapTimer = null, aiDifficulty = 'easy';
const AI_LADDER = [
    { kind:'l1' },                                                                              // L1 pushover
    { kind:'builtin', brain:'dumb' },                                                           // L2 menu-Easy
    { kind:'p', w:{margin:.6},                     o:{sampleDeg:26,depth:1,keepStops:1}, noise:.30 }, // L3 cautious pusher
    { kind:'p', w:{margin:.5,zone:.3,center:1.5},  o:{sampleDeg:18,depth:1,keepStops:2} },      // L4 centre-dancer
    { kind:'p', w:{margin:.6,zone:.4,park:2},      o:{sampleDeg:18,depth:1,keepStops:2} },      // L5 corner-cutter
    { kind:'p', w:{margin:1,triMe:.1},             o:{sampleDeg:24,depth:2,keepStops:1,maxCands:8} }, // L6 solid, 2-ply + a touch of inside-line triangle (softens L7's edge, funkier L6)
    // L7/L9 re-spread (the "sprinkle" pass): before it, L8vL7 sat at exact parity and L10
    // towered 77% over L9. A light dose of the fitted weights in L7 (which softens Master a
    // touch at this shallow search) and a half dose in L9 evened the whole top of the ladder:
    // L8 over L7 63%, L9 over L8 67%, L10 over L9 71% (24-game head-to-heads per rung).
    { kind:'builtin', brain:'master', mw:{zone:2.5,park:2.2,oppFree:-0.3} },                    // L7 Expert, sprinkled
    { kind:'p3', w:{margin:1,zone:.5,park:.9,center:.15}, o:{sampleDeg:18,depth:3,keepStops:2,maxCands:11} }, // L8 cap
    { kind:'p3', w:{margin:1,zone:2.2,park:1.9,center:.12,oppFree:-0.2}, o:{sampleDeg:9,depth:3,keepStops:4,maxCands:28} },  // L9 deep: L8's search x2.5, half-dose fitted eval
    // L10 (interim): the refitted territory eval beat all self-play opponents (incl. the aggressive
    // dumb AI 100%) yet a human found it trivially exploitable, because the ladder top is a STYLE
    // cycle, not a strict ranking -- L10's territory style preys on L9 but has a hole a human's style
    // walks through. The triMe (inside-line) term is what makes L11 hard for that human style, so a
    // dose of it is added here too as a stopgap until a replay of the exploit lets it be fixed
    // properly. Kept below L11's triMe .2 so L11 stays on top (L9 < L10 < L11 held in self-play).
    { kind:'p3', w:{margin:1,zone:12,park:8,oppFree:-1.1,triMe:.15}, o:{sampleDeg:9,depth:3,keepStops:4,maxCands:28} },
    // L11: L10 plus the triangle-angle term (keep my hub between the board centre and theirs).
    // Beat plain L10 24/36 (67%) head-to-head; same search cost, the extra term is arithmetic.
    { kind:'p3', w:{margin:1,zone:12,park:8,oppFree:-1.1,triMe:.2}, o:{sampleDeg:9,depth:3,keepStops:4,maxCands:28} },
    // L12 slot: retired. It was the opponent-model search experiment, then for a day the "Corner
    // L12" rung that opened with the corner cross; that opening is now a per-game wrapper any rung
    // can wear (G.cornerOpening, see ladderPlanFor / ladderPlanCorner), so the trainer teaches the
    // nets the line from every rung rather than one. Kept as a slot so old arena logs still replay.
    { kind:'p3', experimental:'retired-corner', label:'Retired L12',
      w:{margin:1,zone:12,park:8,oppFree:-1.1,triMe:.2}, o:{sampleDeg:9,depth:3,keepStops:4,maxCands:28} },
    // L13: L11's eval, L11's candidates, L11's pessimistic minimax -- but the opponent's replies
    // come from ladderOppReplies (full swing + park stops + the max-shove stop) instead of six
    // swing-to-the-jam endpoints. The sweep those replies come from was already being paid for, so
    // unlike L12 this costs little more than L11. oppKeep caps how many of the ranked replies get
    // the full follow-up ply.
    { kind:'opp2', experimental:'retired-search', label:'Retired L13',
      w:{margin:1,zone:12,park:8,oppFree:-1.1,triMe:.2},
      o:{sampleDeg:9,depth:3,keepStops:4,maxCands:28, oppKeep:18} },
    // L14 EXPERIMENT: L11 at identical search cost, plus Liam's two-sided leverage idea.
    // hubAttack rewards one of my physical leg arcs lining up beside their hub; hubExpose charges
    // the mirror-image danger. Equal magnitudes make this attack-minus-exposure, not a blanket
    // aggression bonus. Keep it isolated as a rung until its balanced L14-v-L11 trial has evidence.
    { kind:'p3', experimental:'hub-leverage', label:'Leverage',
      w:{margin:1,zone:12,park:8,oppFree:-1.1,triMe:.2,hubAttack:2,hubExpose:-2},
      o:{sampleDeg:9,depth:3,keepStops:4,maxCands:28} },
];
function ladderRestore(s){ G.pieces.forEach((p,i)=>{p.x=s[i].x;p.y=s[i].y;p.rot=s[i].rot;}); G.turnDir=0;G.crossings=0;G.atLimit=false;G.netRad=0;G.contact=null; }
function ladderEval(idx, w){
    let s = 0;
    if (w.margin) s += w.margin * marginFor(idx);
    if (w.zone)   s += w.zone * (pieceZoneScore(G.pieces[idx]) - pieceZoneScore(G.pieces[1-idx]));
    if (w.center){ let d=1e9; for (const f of G.pieces[idx].feet()) d=Math.min(d, Math.hypot(f.x,f.y)); s += w.center * Math.max(0, 1 - d/12) * 10; }
    if (w.park){ let a=0;
        for (const f of G.pieces[idx].feet()){ const on = nearLineIds(f, CFG.crossEps);   // magnet-on: only parks that actually bank grace
            if (on.length){ a += 1;
                for (const P of LINE_INTERSECTIONS) if (P.lines.some(l=>on.includes(l)) && Math.hypot(f.x-P.x,f.y-P.y) < 9){ a += 1; break; } } }
        s += w.park * a; }
    if (w.attack) s += w.attack * (outermostRadU(G.pieces[1-idx]) - CFG.rings[1]);
    // oppFree (negative weight): the opponent's summed room-to-nearest-line, clamped per foot.
    // Shrinking it herds their feet against lines, so their sweeps hit the one-crossing budget
    // sooner — the "box them in" idea the self-play fit surfaced (lineFreedomOp).
    if (w.oppFree){ let free=0;
        for (const f of G.pieces[1-idx].feet()){ let d=1e9;
            CFG.rings.forEach(R => d=Math.min(d, Math.abs(radU(f)-R)));
            CFG.sideArcs.forEach(a => { if (angInSpan(Math.atan2(f.y-a.cy,f.x-a.cx)*180/Math.PI, a.a0, a.a1)) d=Math.min(d, Math.abs(Math.hypot(f.x-a.cx,f.y-a.cy)-a.r)); });
            free += Math.min(d, 10); }
        s += w.oppFree * free; }
    // triMe: the angle at MY hub between the board centre and the opponent's hub, in degrees.
    // Big angle = my piece sits between the centre and theirs (owning the inside line facing
    // them). The strongest single predictor found in the judo-feature round; validated in play
    // (L10 search + this term beat plain L10 67%).
    if (w.triMe){ const me=G.pieces[idx], op=G.pieces[1-idx];
        const ax=-me.x, ay=-me.y, bx=op.x-me.x, by=op.y-me.y;
        const la=Math.hypot(ax,ay)||1e-9, lb=Math.hypot(bx,by)||1e-9;
        s += w.triMe * (Math.acos(Math.max(-1,Math.min(1,(ax*bx+ay*by)/(la*lb))))*180/Math.PI); }
    if (w.hubAttack) s += w.hubAttack * hubLeverageFor(idx);
    if (w.hubExpose) s += w.hubExpose * hubLeverageFor(1-idx);
    return s;
}
function ladderSampledPlan(idx, w, o){
    const origActive=G.active, snap0=takeSnap(); const cands=[];
    for (let pv=0; pv<3; pv++) for (const dir of [1,-1]){
        ladderRestore(snap0); G.active=idx; pinFoot(pv);
        let guard=0, lastMark=0; const local=[];
        while (Math.abs(G.netRad) < AI_SAFETY_CAP_RAD && !G.atLimit && guard++ < 500){
            applySwing(dir*AI_STEP_RAD); const a=Math.abs(G.netRad);
            if (o.sampleDeg && a-lastMark >= o.sampleDeg*Math.PI/180 && a >= HARD_MIN_MOVE_RAD && !G.pieces[idx].anyFootOff()){
                lastMark=a; local.push({pivotIdx:pv,dir,targetRad:a,snap:takeSnap(),q:ladderEval(idx,w)+(G.pieces[1-idx].anyFootOff()?HARD_WIN_BONUS:0)}); }
        }
        if (Math.abs(G.netRad) >= HARD_MIN_MOVE_RAD && !G.pieces[idx].anyFootOff())
            local.push({pivotIdx:pv,dir,targetRad:Math.abs(G.netRad),snap:takeSnap(),q:ladderEval(idx,w)+(G.pieces[1-idx].anyFootOff()?HARD_WIN_BONUS:0)});
        local.sort((a,b)=>b.q-a.q); cands.push(...local.slice(0, o.keepStops||2));
    }
    if (!cands.length){ ladderRestore(snap0); G.active=origActive; return null; }
    let best=null;
    if ((o.depth||1) < 2){ for (const c of cands) if (!best || c.q>best.q) best=c; best={pivotIdx:best.pivotIdx,dir:best.dir,targetRad:best.targetRad}; }
    else {
        cands.sort((a,b)=>b.q-a.q);
        for (const c of cands.slice(0, o.maxCands||10)){
            ladderRestore(c.snap); let score;
            if (G.pieces[1-idx].anyFootOff()) score = HARD_WIN_BONUS + c.q;
            else {
                const s1=takeSnap(); let worst=Infinity;
                reply: for (let op=0; op<3; op++) for (const od of [1,-1]){
                    ladderRestore(s1); G.active=1-idx;
                    const onet=simMoveToLimit(op,od);
                    if (Math.abs(onet) < HARD_MIN_MOVE_RAD) continue;
                    if (G.pieces[1-idx].anyFootOff()) continue;
                    const rs = G.pieces[idx].anyFootOff() ? -HARD_WIN_BONUS : ladderEval(idx,w);
                    if (rs < worst) worst = rs;
                    if (best && worst <= best.score) break reply;
                }
                score = worst===Infinity ? c.q : worst;
            }
            if (!best || score > best.score) best={pivotIdx:c.pivotIdx,dir:c.dir,targetRad:c.targetRad,score};
        }
    }
    ladderRestore(snap0); G.active=origActive; return best;
}
function ladderRoots3(idx, w, o, snap0){
    const roots=[];
    for (let pv=0; pv<3; pv++) for (const dir of [1,-1]){
        ladderRestore(snap0); G.active=idx; pinFoot(pv);
        let guard=0, lastMark=0, parksHere=0; const local=[]; const seenPark={};
        while (Math.abs(G.netRad) < AI_SAFETY_CAP_RAD && !G.atLimit && guard++ < 500){
            applySwing(dir*AI_STEP_RAD); const a=Math.abs(G.netRad);
            if (o.sampleDeg && a-lastMark >= o.sampleDeg*Math.PI/180 && a >= HARD_MIN_MOVE_RAD && !G.pieces[idx].anyFootOff()){
                lastMark=a; local.push({pivotIdx:pv,dir,targetRad:a,snap:takeSnap(),q:ladderEval(idx,w)+(G.pieces[1-idx].anyFootOff()?HARD_WIN_BONUS:0)}); }
            // PARK stops, same as Master's recorder: since the turn-start grace went magnet-scale
            // (build 130), the coarse sampleDeg stops almost never land a foot genuinely ON a line,
            // which silently took the park/double-cross play away from the p3 rungs (measured: L8
            // fell from ~63% to ~43% vs L7, whose dedicated recorder kept its aim). Record up to two
            // exact in-band stops per sweep so the deep search can weigh real parks again.
            if (parksHere < 2 && Math.abs(G.netRad) >= HARD_MIN_MOVE_RAD && !G.pieces[idx].anyFootOff()){
                const feet = G.pieces[idx].feet();
                for (let fi=0; fi<3 && parksHere<2; fi++){
                    if (fi === pv) continue;
                    for (const id of nearLineIds(feet[fi], PARK_HI)) {
                        if (nearLineIds(feet[fi], PARK_LO).includes(id)) continue;
                        const key = fi+':'+id;
                        if (seenPark[key]) continue;
                        seenPark[key] = true;
                        local.push({pivotIdx:pv,dir,targetRad:Math.abs(G.netRad),snap:takeSnap(),park:true,
                                    q:ladderEval(idx,w)+(G.pieces[1-idx].anyFootOff()?HARD_WIN_BONUS:0)});
                        parksHere++; break;
                    }
                }
            }
        }
        if (Math.abs(G.netRad) >= HARD_MIN_MOVE_RAD && !G.pieces[idx].anyFootOff())
            local.push({pivotIdx:pv,dir,targetRad:Math.abs(G.netRad),snap:takeSnap(),q:ladderEval(idx,w)+(G.pieces[1-idx].anyFootOff()?HARD_WIN_BONUS:0)});
        // parks ride along IN ADDITION to the keepStops best sampled stops, like Master's cands
        local.sort((a,b)=>b.q-a.q);
        roots.push(...local.filter(c=>!c.park).slice(0, o.keepStops||2), ...local.filter(c=>c.park));
    }
    roots.sort((a,b)=>b.q-a.q);
    return roots;
}
function ladderScore3(idx, w, snap, alpha){
    let worst=Infinity;
    reply: for (let op=0; op<3; op++) for (const od of [1,-1]){
        ladderRestore(snap); G.active=1-idx;
        const onet=simMoveToLimit(op,od);
        if (Math.abs(onet) < HARD_MIN_MOVE_RAD) continue;
        if (G.pieces[1-idx].anyFootOff()) continue;
        let rs;
        if (G.pieces[idx].anyFootOff()) rs = -HARD_WIN_BONUS;
        else {
            const s2=takeSnap(); let bf=-Infinity;
            for (let fp=0; fp<3 && bf<HARD_WIN_BONUS/2; fp++) for (const fd of [1,-1]){
                ladderRestore(s2); G.active=idx;
                const fnet=simMoveToLimit(fp,fd);
                if (Math.abs(fnet) < HARD_MIN_MOVE_RAD) continue;
                if (G.pieces[idx].anyFootOff()) continue;
                const fs = G.pieces[1-idx].anyFootOff() ? HARD_WIN_BONUS+ladderEval(idx,w) : ladderEval(idx,w);
                if (fs>bf) bf=fs;
            }
            rs = bf===-Infinity ? ladderEval(idx,w) : bf;
        }
        if (rs<worst) worst=rs;
        if (alpha!==undefined && worst<=alpha) break reply;
    }
    return worst;
}
function ladderPlan3(idx, w, o){
    const origActive=G.active, snap0=takeSnap();
    const roots = ladderRoots3(idx, w, o, snap0);
    if (!roots.length){ ladderRestore(snap0); G.active=origActive; return null; }
    let best=null;
    for (const c of roots.slice(0, o.maxCands||10)){
        ladderRestore(c.snap); let score;
        if (G.pieces[1-idx].anyFootOff()) score = HARD_WIN_BONUS + c.q;
        else {
            const worst = ladderScore3(idx, w, c.snap, best ? best.score : undefined);
            score = worst===Infinity ? c.q : worst;
        }
        if (!best || score>best.score) best={pivotIdx:c.pivotIdx,dir:c.dir,targetRad:c.targetRad,score};
    }
    ladderRestore(snap0); G.active=origActive; return best;
}
function ladderPlanOppModel(idx, w, o){
    const origActive=G.active, snap0=takeSnap();
    const roots = ladderRoots3(idx, w, o, snap0);
    if (!roots.length){ ladderRestore(snap0); G.active=origActive; return null; }
    let best=null;
    for (const c of roots.slice(0, o.oppCands||4)){
        ladderRestore(c.snap);
        let score;
        if (G.pieces[1-idx].anyFootOff()) score = HARD_WIN_BONUS + c.q;   // already won; no reply to model
        else {
            G.active = 1-idx;
            // oppLevel is a 0-based AI_LADDER index and must point at a NON-'opp' rung or this
            // recurses; the L12 entry below pins it to L11.
            const reply = ladderPlanFor(o.oppLevel, 1-idx);
            if (!reply || Math.abs(reply.targetRad) < 1e-9) score = ladderEval(idx, w);
            else {
                pinFoot(reply.pivotIdx);
                let guard=0;
                while (!G.atLimit && Math.abs(G.netRad) < Math.abs(reply.targetRad) && guard++ < 5000)
                    applySwing(reply.dir*Math.min(AI_STEP_RAD, Math.abs(reply.targetRad) - Math.abs(G.netRad)));
                score = G.pieces[idx].anyFootOff()   ? -HARD_WIN_BONUS
                      : G.pieces[1-idx].anyFootOff() ?  HARD_WIN_BONUS + ladderEval(idx, w)
                      :                                 ladderEval(idx, w);
            }
        }
        if (!best || score>best.score) best={pivotIdx:c.pivotIdx,dir:c.dir,targetRad:c.targetRad,score};
    }
    ladderRestore(snap0); G.active=origActive; return best;
}
function ladderOppReplies(oppIdx, meIdx, o, snap){
    const out=[];
    for (let pv=0; pv<3; pv++) for (const dir of [1,-1]){
        ladderRestore(snap); G.active=oppIdx; pinFoot(pv);
        let guard=0, parks=0; const seenPark={};
        let shoveOutRad=-Infinity, shoveOut=null, shoveInRad=Infinity, shoveIn=null;
        while (Math.abs(G.netRad) < AI_SAFETY_CAP_RAD && !G.atLimit && guard++ < 500){
            applySwing(dir*AI_STEP_RAD);
            const a=Math.abs(G.netRad);
            if (a < HARD_MIN_MOVE_RAD || G.pieces[oppIdx].anyFootOff()) continue;
            // (c) BOTH extremes of what this sweep does to my rim clearance. Max is the obvious
            // threat -- shove my outermost foot toward the edge. Min matters too: the stop that
            // shoves me furthest INWARD is the opponent declining the push to reposition me, which
            // can be the stronger positional reply and is equally invisible to a swing-to-limit
            // model. Since my piece only moves via resolvePush, both extremes usually sit mid-arc.
            const myOut = outermostRadU(G.pieces[meIdx]);
            if (myOut > shoveOutRad){ shoveOutRad=myOut; shoveOut={pivotIdx:pv,dir,targetRad:a}; }
            if (myOut < shoveInRad){ shoveInRad=myOut; shoveIn={pivotIdx:pv,dir,targetRad:a}; }
            if (parks < 2){                                        // (b)
                const feet = G.pieces[oppIdx].feet();
                for (let fi=0; fi<3 && parks<2; fi++){
                    if (fi === pv) continue;
                    for (const id of nearLineIds(feet[fi], PARK_HI)){
                        if (nearLineIds(feet[fi], PARK_LO).includes(id)) continue;
                        const key = fi+':'+id;
                        if (seenPark[key]) continue;
                        seenPark[key] = true;
                        out.push({pivotIdx:pv,dir,targetRad:a}); parks++; break;
                    }
                }
            }
        }
        if (Math.abs(G.netRad) >= HARD_MIN_MOVE_RAD && !G.pieces[oppIdx].anyFootOff())
            out.push({pivotIdx:pv,dir,targetRad:Math.abs(G.netRad)});   // (a)
        // Only emit the shove stops when the shove is REAL. My piece moves solely via resolvePush,
        // so with no contact anywhere in this sweep outermostRadU(me) is constant -- and then
        // "max" and "min" both latch onto the first qualifying step and emit a degenerate
        // AI_STEP_RAD stub. That produced six useless 3-degree candidates per position, which are
        // never the minimax worst and so changed nothing while still costing a full simulation
        // each. Require a measurable spread before either extreme counts as a distinct reply.
        if (shoveOutRad - shoveInRad > SHOVE_EPS){
            if (shoveOut) out.push(shoveOut);
            if (shoveIn && shoveIn.targetRad !== shoveOut.targetRad) out.push(shoveIn);
        }
    }
    return out;
}
function ladderPlan13(idx, w, o){
    const origActive=G.active, snap0=takeSnap();
    const roots = ladderRoots3(idx, w, o, snap0);
    if (!roots.length){ ladderRestore(snap0); G.active=origActive; return null; }
    let best=null;
    for (const c of roots.slice(0, o.maxCands||10)){
        ladderRestore(c.snap);
        let score;
        if (G.pieces[1-idx].anyFootOff()) score = HARD_WIN_BONUS + c.q;
        else {
            const s1=takeSnap();
            // rank every candidate reply by how bad it leaves me after one cheap eval, then spend
            // the follow-up ply only on the worst few
            const replies=[];
            for (const r of ladderOppReplies(1-idx, idx, o, s1)){
                ladderRestore(s1); G.active=1-idx;
                pinFoot(r.pivotIdx);
                let g=0;
                while (!G.atLimit && Math.abs(G.netRad) < Math.abs(r.targetRad) && g++ < 500)
                    applySwing(r.dir*Math.min(AI_STEP_RAD, Math.abs(r.targetRad) - Math.abs(G.netRad)));
                if (Math.abs(G.netRad) < HARD_MIN_MOVE_RAD) continue;
                if (G.pieces[1-idx].anyFootOff()) continue;
                replies.push({ r, snap: takeSnap(),
                               v: G.pieces[idx].anyFootOff() ? -HARD_WIN_BONUS : ladderEval(idx,w) });
            }
            replies.sort((a,b)=>a.v-b.v);
            let worst=Infinity;
            reply: for (const rep of replies.slice(0, o.oppKeep||6)){
                let rs;
                if (rep.v <= -HARD_WIN_BONUS) rs = -HARD_WIN_BONUS;
                else {
                    ladderRestore(rep.snap);
                    const s2=takeSnap(); let bf=-Infinity;
                    for (let fp=0; fp<3 && bf<HARD_WIN_BONUS/2; fp++) for (const fd of [1,-1]){
                        ladderRestore(s2); G.active=idx;
                        const fnet=simMoveToLimit(fp,fd);
                        if (Math.abs(fnet) < HARD_MIN_MOVE_RAD) continue;
                        if (G.pieces[idx].anyFootOff()) continue;
                        const fs = G.pieces[1-idx].anyFootOff() ? HARD_WIN_BONUS+ladderEval(idx,w) : ladderEval(idx,w);
                        if (fs>bf) bf=fs;
                    }
                    rs = bf===-Infinity ? rep.v : bf;
                }
                if (rs<worst) worst=rs;
                if (best && worst<=best.score) break reply;
            }
            score = worst===Infinity ? c.q : worst;
        }
        if (!best || score>best.score) best={pivotIdx:c.pivotIdx,dir:c.dir,targetRad:c.targetRad,score};
    }
    ladderRestore(snap0); G.active=origActive; return best;
}
const CORNER_L = () => CFG.footR*Math.sqrt(3);
function ladderSwingTo(idx, pv, dir, rad){
    G.active=idx; pinFoot(pv);
    let guard=0;
    while (!G.atLimit && Math.abs(G.netRad) < rad-1e-9 && guard++ < 5000)
        applySwing(dir*Math.min(AI_STEP_RAD, rad-Math.abs(G.netRad)));
    return !G.pieces[idx].anyFootOff() && Math.abs(G.netRad) >= rad-1e-6;
}
function ladderCornerSetupStops(idx, pv, d){
    const snap0=takeSnap(), L=CORNER_L(), stops=[], fine=0.3*Math.PI/180;
    const delta=(i,P)=>{ const f=G.pieces[idx].feet()[i]; return Math.hypot(f.x-P.x, f.y-P.y)-L; };
    // coarse pass: bracket every sign change
    G.active=idx; pinFoot(pv);
    let guard=0, prevA=0, prev=LINE_INTERSECTIONS.map((P,k)=>[0,1,2].map(i=>i===pv?0:delta(i,P)));
    const brackets=[];
    while (Math.abs(G.netRad) < AI_SAFETY_CAP_RAD && !G.atLimit && guard++ < 500){
        applySwing(d*AI_STEP_RAD);
        if (G.pieces[idx].anyFootOff()) break;
        const a=Math.abs(G.netRad); if (a-prevA < 1e-9) break;
        const cur=LINE_INTERSECTIONS.map((P,k)=>[0,1,2].map(i=>i===pv?0:delta(i,P)));
        for (let k=0;k<cur.length;k++) for (let i=0;i<3;i++)
            if (i!==pv && (prev[k][i]<0)!==(cur[k][i]<0)) brackets.push({k,i,lo:prevA,hi:a});
        prev=cur; prevA=a;
    }
    // fine pass: walk each bracket in 0.3-degree steps to the flip
    for (const b of brackets){
        ladderRestore(snap0);
        if (!ladderSwingTo(idx, pv, d, b.lo)) continue;
        const P=LINE_INTERSECTIONS[b.k], s0=delta(b.i,P)<0; let g=0, hit=false;
        while (!G.atLimit && Math.abs(G.netRad) < b.hi+fine && g++ < 20){
            applySwing(d*fine);
            if (G.pieces[idx].anyFootOff()) break;
            if ((delta(b.i,P)<0)!==s0){ hit=true; break; }
        }
        const at=Math.abs(G.netRad);
        if (hit && at >= HARD_MIN_MOVE_RAD) stops.push({pivotIdx:pv, dir:d, targetRad:at, nextPivot:b.i});
    }
    ladderRestore(snap0);
    return stops;
}
const CORNER_VETO_STEP = 3 * Math.PI/180;
function oppTwoForOneAvailable(opp, stepRad){
    const step=stepRad || CORNER_VETO_STEP;
    const snap0=takeSnap(), origActive=G.active;
    let found=false;
    for (let pv=0; pv<3 && !found; pv++) for (const d of [1,-1]){
        ladderRestore(snap0); G.active=opp; pinFoot(pv);
        let guard=0;
        while (!G.atLimit && Math.abs(G.netRad) < AI_SAFETY_CAP_RAD && guard++ < 2000){
            applySwing(d*step);
            if (G.pieces[opp].anyFootOff()) break;
            if (G.crossings > 0 && new Set(G.justCrossed||[]).size >= 2){ found=true; break; }
        }
        if (found) break;
    }
    ladderRestore(snap0); G.active=origActive;
    return found;
}
function ladderPlanVeto(idx, plan, stepDeg, maxSteps){
    if (!plan || !(Math.abs(plan.targetRad) > 0)) return plan;
    const snap0=takeSnap(), origActive=G.active, opp=1-idx;
    const step=(stepDeg||3)*Math.PI/180, tries=Math.max(1, maxSteps||4), base=Math.abs(plan.targetRad);
    // Play `rad` on the rung's arm and report what it leaves the opponent. null = not playable at
    // all (under the minimum move, or the swing cannot reach it cleanly).
    const probe=rad=>{
        if (rad < HARD_MIN_MOVE_RAD) return null;
        ladderRestore(snap0); G.active=idx;
        if (!ladderSwingTo(idx, plan.pivotIdx, plan.dir, rad)) return null;
        // A throw ends the game: never talk the rung out of one to tidy up a corner.
        if (G.pieces[opp].anyFootOff()) return {win:true};
        return {win:false, corner:oppTwoForOneAvailable(opp)};
    };
    const b=probe(base);
    ladderRestore(snap0); G.active=origActive;
    if (!b || b.win || !b.corner) return plan;                 // nothing to veto
    for (let k=1; k<=tries; k++) for (const rad of [base-k*step, base+k*step]){
        const r=probe(rad);
        ladderRestore(snap0); G.active=origActive;
        if (r && (r.win || !r.corner)) return {...plan, targetRad:rad, vetoStep:(rad<base?-k:k)};
    }
    return plan;
}
const CORNER_CHOICE_W = {margin:1,zone:12,park:8,oppFree:-1.1,triMe:.2};
function ladderPlanCorner(idx, w, o, fallback){
    const openPlies = o.openPlies==null ? 10 : o.openPlies;
    if (!G.cornerBook) G.cornerBook=[null,null];
    if (!G.cornerDone) G.cornerDone=[false,false];
    if (G.cornerDone[idx] || (G.plies||0) >= openPlies){ G.cornerBook[idx]=null; return fallback(); }
    const origActive=G.active, snap0=takeSnap(), me=G.pieces[idx];
    const hubR=()=>Math.hypot(me.x, me.y), hubR0=hubR();
    const done=()=>{ G.cornerDone[idx]=true; G.cornerBook[idx]=null; ladderRestore(snap0); G.active=origActive; return fallback(); };
    // Sweep (pv,d) as far as the rules allow. Returns the stop, whether the hub moved toward the
    // centre, and the pose there; null if the swing is nothing or throws the piece off.
    const sweepMax=(pv,d)=>{
        ladderRestore(snap0); G.active=idx; pinFoot(pv);
        let guard=0; while (!G.atLimit && Math.abs(G.netRad) < AI_SAFETY_CAP_RAD && guard++ < 500) applySwing(d*AI_STEP_RAD);
        if (G.pieces[idx].anyFootOff()) return null;
        const rad=Math.abs(G.netRad); if (rad < HARD_MIN_MOVE_RAD) return null;
        return { pivotIdx:pv, dir:d, targetRad:rad, fwd: hubR() < hubR0-1e-6, snap:takeSnap() };
    };
    const bk=G.cornerBook[idx];
    if (!bk){
        // Move 1. The back feet are the two farthest from the centre; each has one forward way
        // round (the one that brings the hub in). Blue: coin. Red: L11's depth-3 look at each.
        const feet=me.feet();
        const backs=[0,1,2].sort((a,b)=>Math.hypot(feet[b].x,feet[b].y)-Math.hypot(feet[a].x,feet[a].y)).slice(0,2);
        const opts=[];
        for (const pv of backs){
            let best=null;
            for (const d of [1,-1]){ const s=sweepMax(pv,d); if (s && s.fwd && (!best || s.targetRad>best.targetRad)) best=s; }
            if (best) opts.push(best);
        }
        if (!opts.length) return done();
        let pick;
        if (idx===0 || opts.length===1) pick=opts[Math.floor(Math.random()*opts.length)];
        else {
            let bestQ=-Infinity;
            for (const s of opts){
                ladderRestore(s.snap); const q0=ladderEval(idx,w);
                const v=ladderScore3(idx, w, s.snap), q=v===Infinity ? q0 : v;
                if (q>bestQ){ bestQ=q; pick=s; }
            }
        }
        // the crossed foot: the moving foot that came in toward the centre (the other is the front)
        ladderRestore(snap0); const f0=me.feet(); ladderRestore(pick.snap); const f1=me.feet();
        const crossFoot=[0,1,2].filter(i=>i!==pick.pivotIdx).sort((a,b)=>(Math.hypot(f1[a].x,f1[a].y)-Math.hypot(f0[a].x,f0[a].y))-(Math.hypot(f1[b].x,f1[b].y)-Math.hypot(f0[b].x,f0[b].y)))[0];
        ladderRestore(snap0); G.active=origActive;
        G.cornerBook[idx]={ at:1, pivotIdx:pick.pivotIdx, dir:pick.dir, crossFoot, firstDeg:pick.targetRad*180/Math.PI };
        return { pivotIdx:pick.pivotIdx, dir:pick.dir, targetRad:pick.targetRad };
    }
    // Move 3: the swing back through the corner move 2 set up. The book owns the pivot (the crossed
    // foot, which is sitting a foot-to-foot length from the corner precisely so the swing about it
    // rounds that corner) and the direction -- the reverse of the book's own, the one that carries
    // the hub inward. Only the stop is the rung's, scored with its own eval: "stopping where the
    // rung's own eval likes". Leaving the pivot to the rung too threw the setup away -- it pinned a
    // different foot and the piece stopped inside the corner.
    if (bk.at===2){
        const B3=bk.crossFoot, d3=-bk.dir;
        if (B3==null) return done();
        const step=(o.sampleDeg||6)*Math.PI/180;
        let best=null;
        const consider=a=>{ const q=ladderEval(idx,w)+(G.pieces[1-idx].anyFootOff()?HARD_WIN_BONUS:0);
                            if (!best || q>best.q) best={q,targetRad:a}; };
        ladderRestore(snap0); G.active=idx; pinFoot(B3);
        let g3=0, lastMark=0;
        while (Math.abs(G.netRad) < AI_SAFETY_CAP_RAD && !G.atLimit && g3++ < 500){
            applySwing(d3*AI_STEP_RAD); const a=Math.abs(G.netRad);
            if (a-lastMark >= step && a >= HARD_MIN_MOVE_RAD && !G.pieces[idx].anyFootOff()){ lastMark=a; consider(a); }
        }
        if (Math.abs(G.netRad) >= HARD_MIN_MOVE_RAD && !G.pieces[idx].anyFootOff()) consider(Math.abs(G.netRad));
        ladderRestore(snap0); G.active=origActive;
        if (!best) return done();
        G.cornerBook[idx]={ ...bk, at:3, thirdDeg:best.targetRad*180/Math.PI };
        G.cornerDone[idx]=true;   // the line is played out; from here the rung is simply itself
        return { pivotIdx:B3, dir:d3, targetRad:best.targetRad };
    }
    // Move 2: same pin, same way. The crossed foot takes the next line and stops a few degrees
    // past it -- at the solved setup angle if one lies just past the crossing, else 4 degrees past.
    // The opening survives a nudge but not a shove: the swing's first crossing must be THAT foot
    // taking a line within 20 degrees, or the line is gone and the rung is L11 from here.
    if (bk.at!==1) return done();
    const pv=bk.pivotIdx, d=bk.dir, B=bk.crossFoot;
    ladderRestore(snap0); G.active=idx; pinFoot(pv);
    let guard=0, radAtCross=null;
    while (!G.atLimit && Math.abs(G.netRad) < 20*Math.PI/180 && guard++ < 500){
        applySwing(d*AI_STEP_RAD);
        if (G.pieces[idx].anyFootOff()) break;
        if (G.crossings>0){ if (nearLineIds(me.feet()[B], CFG.touchEps).length) radAtCross=Math.abs(G.netRad); break; }
    }
    ladderRestore(snap0);
    if (radAtCross===null) return done();
    const few=4*Math.PI/180, window=12*Math.PI/180;
    const solved=ladderCornerSetupStops(idx, pv, d).filter(s=>s.targetRad>radAtCross && s.targetRad<=radAtCross+window)
        .sort((a,b)=>a.targetRad-b.targetRad)[0];
    let rad=solved ? solved.targetRad : radAtCross+few;
    ladderRestore(snap0);
    if (!ladderSwingTo(idx, pv, d, rad)){ ladderRestore(snap0); rad=radAtCross+few; if (!ladderSwingTo(idx, pv, d, rad)) return done(); }
    ladderRestore(snap0); G.active=origActive;
    G.cornerBook[idx]={ at:2, pivotIdx:pv, dir:d, crossFoot:B, firstDeg:bk.firstDeg, secondDeg:rad*180/Math.PI, crossDeg:radAtCross*180/Math.PI, solved:!!solved };
    return { pivotIdx:pv, dir:d, targetRad:rad };
}
function ladderProbe(idx, pv, dir){
    const snap0=takeSnap(); pinFoot(pv);
    let guard=0, radAtCross=null;
    while (Math.abs(G.netRad)<AI_SAFETY_CAP_RAD && !G.atLimit && guard++<500){
        applySwing(dir*AI_STEP_RAD);
        if (radAtCross===null && G.crossings>0) radAtCross=Math.abs(G.netRad);
    }
    const lim=Math.abs(G.netRad); ladderRestore(snap0); return {lim, radAtCross};
}
function ladderDumbPlan(idx){
    const plan=aiChoosePlan(idx), feet=G.pieces[idx].feet();
    let dir=directionToward(feet[plan.pivotIdx], feet[plan.swingIdx], plan.target);
    const snap0=takeSnap();
    let net=simMoveToLimit(plan.pivotIdx,dir); ladderRestore(snap0);
    if (Math.abs(net)<1e-9){ dir=-dir; net=simMoveToLimit(plan.pivotIdx,dir); ladderRestore(snap0); }
    return {pivotIdx:plan.pivotIdx, dir, targetRad:Math.abs(net)*aiStopFrac()};
}
function ladderL1Plan(idx){
    const opp=G.pieces[1-idx], feet=G.pieces[idx].feet();
    let pv=0,dmin=1e9; feet.forEach((f,i)=>{const d=Math.hypot(f.x-opp.x,f.y-opp.y); if(d<dmin){dmin=d;pv=i;}});
    if (Math.random()<0.2) pv=Math.floor(Math.random()*3);
    let sw=(pv+1)%3,dmax=-1; feet.forEach((f,i)=>{ if(i!==pv){const d=Math.hypot(f.x-opp.x,f.y-opp.y); if(d>dmax){dmax=d;sw=i;}}});
    let dir=directionToward(feet[pv],feet[sw],{x:opp.x,y:opp.y});
    let p=ladderProbe(idx,pv,dir);
    if (p.lim<HARD_MIN_MOVE_RAD){ dir=-dir; p=ladderProbe(idx,pv,dir); }
    if (p.lim<HARD_MIN_MOVE_RAD) return ladderDumbPlan(idx);
    let target=p.lim*(0.45+Math.random()*0.35);
    if (Math.random()<0.55 && p.radAtCross!==null && p.radAtCross*0.8 > HARD_MIN_MOVE_RAD*1.5)
        target=Math.min(target, p.radAtCross*0.8);
    return {pivotIdx:pv, dir, targetRad:target};
}
function ladderRandomPlan(idx){
    for(let t=0;t<8;t++){ const pv=Math.floor(Math.random()*3), dir=Math.random()<0.5?1:-1;
        const p=ladderProbe(idx,pv,dir);
        if (p.lim>=HARD_MIN_MOVE_RAD) return {pivotIdx:pv, dir, targetRad:p.lim*(0.3+Math.random()*0.6)}; }
    return ladderDumbPlan(idx);
}
const CORNER_OPENING_MIN_LEVEL = 7, CORNER_OPENING_P = 0.5;
function ladderPlanFor(levelIdx, idx){
    const def=AI_LADDER[levelIdx]; if (!def) return null;
    if (!G.cornerOpening) G.cornerOpening=[null,null];
    if (G.cornerOpening[idx]==null) G.cornerOpening[idx] = levelIdx+1 >= CORNER_OPENING_MIN_LEVEL && Math.random() < CORNER_OPENING_P;
    if (G.cornerOpening[idx] && !(G.cornerDone && G.cornerDone[idx]))
        return ladderPlanCorner(idx, def.w && def.w.zone ? def.w : CORNER_CHOICE_W, def.o||{}, () => ladderPlanRung(def, idx));
    return ladderPlanRung(def, idx);
}
function ladderPlanRung(def, idx){
    if (def.noise && Math.random()<def.noise) return ladderRandomPlan(idx);
    if (def.kind==='l1') return ladderL1Plan(idx);
    if (def.kind==='builtin') return def.brain==='master' ? aiChoosePlanMaster(idx, def.mw) : ladderDumbPlan(idx);
    if (def.kind==='p3') return ladderPlan3(idx, def.w, def.o);
    if (def.kind==='opp') return ladderPlanOppModel(idx, def.w, def.o);
    if (def.kind==='opp2') return ladderPlan13(idx, def.w, def.o);
    return ladderSampledPlan(idx, def.w, def.o);
}

function __newGame() {
  const blue = new Piece(0), red = new Piece(1);
  blue.x = -CFG.startX; blue.rot = 0;
  red.x  =  CFG.startX; red.rot  = Math.PI;
  G = { pieces: [blue, red], active: 0, pinned: null, pivot: null, handle: null, turnDir: 0,
        crossings: 0, atLimit: false, netRad: 0, ptrAngle: null, over: false, winner: null,
        snap: null, contact: null, justCrossed: [],
        // must mirror reset()'s G in index.html -- this literal is the one piece of engine state
        // that is duplicated rather than extracted, so new per-game fields have to be added twice
        koHist: [], plies: 0, adjudicated: false };
  koReset();   // the opening counts as a position the board has been in -- see koReset
  return G;
}
// play one full turn from a { pivotIdx, dir, targetRad } plan (the shape every brain returns)
function __applyPlan(plan) {
  if (!plan || Math.abs(plan.targetRad) < 1e-9) { clearTurn(); G.active = 1 - G.active; return; }
  // Ko: the brains search without the rule (which keeps them exactly as fast as before), so the
  // chosen move's stopping angle is moved off any position the board has already been at.
  plan = koLegalizePlan(plan);
  pinFoot(plan.pivotIdx);
  let guard = 0;
  while (!G.atLimit && Math.abs(G.netRad) < Math.abs(plan.targetRad) && guard++ < 5000) {
    const rem = Math.abs(plan.targetRad) - Math.abs(G.netRad);
    applySwing(plan.dir * Math.min(AI_STEP_RAD, rem));
  }
  commitTurn();
}
// The same turn played "in its head": no ko legalising, no ko history, no ply counter. Search that
// walks candidate turns forward and rolls them back (nnai's depth-2/3 lookahead, throwprobe's
// hanging-move check) MUST use this -- committing through __applyPlan would file positions that
// never happened into G.koHist and tick the move cap several times per real move.
function __applyPlanSearch(plan) {
  if (!plan || Math.abs(plan.targetRad) < 1e-9) { clearTurn(); G.active = 1 - G.active; return; }
  pinFoot(plan.pivotIdx);
  let guard = 0;
  while (!G.atLimit && Math.abs(G.netRad) < Math.abs(plan.targetRad) && guard++ < 5000) {
    const rem = Math.abs(plan.targetRad) - Math.abs(G.netRad);
    applySwing(plan.dir * Math.min(AI_STEP_RAD, rem));
  }
  endTurn();
}
let __exports;
__exports = {
  CFG, Piece, radU, norm,
  pinFoot, applySwing, clearTurn, endTurn, commitTurn, takeSnap, restoreSnap,
  koLegalizePlan, koViolation, koReset, adjudicate, outermostRadU,
  directionToward, aiChoosePlan, simMoveToLimit, searchedPlanFor,
  AI_LADDER, ladderPlanFor, ladderEval,
  angInSpan, nearLineIds, lineDistOf, lineSideOf, LINE_INTERSECTIONS,
  oppTwoForOneAvailable, ladderPlanVeto,
  newGame: __newGame, applyPlan: __applyPlan, applyPlanSearch: __applyPlanSearch,
  getG: () => G, setActive: a => { G.active = a; },
};
return __exports;
}
