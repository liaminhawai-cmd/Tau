#!/usr/bin/env python3
"""Tau physical model — CadQuery parametric source (canonical).

Outputs manufacturing-native STEP + printable STL for every part. One master variable, DISK_D,
drives all geometry via SCALE = DISK_D / 266.7; magnet pockets snap to a stocked-part table (never
SCALE). Rim proportions: LEAN MINIMUM (owner's call) — just enough wall to seat + capture the disk.

Measured inputs (from the clean repo STLs — do not re-guess):
    steel disk   Ø266.65 x 2.0 mm   (400 SKU: Ø399.98 x 2.0)
    tripod       hub->foot 46.19 mm, height 53.77 mm
    old rim      inner face FLARED outward (bug) — inner disk-contact face here is VERTICAL.

Disk seat: FLUSH. The rim's whole top (inner seat wall and outer wall alike) sits level with the
disk's own playing surface -- nothing stands proud of it anywhere. An earlier version capped the
disk with an inward lip 2mm above the play surface (fine for manufacturing, wrong for play: a piece
sliding toward the rim would hit that wall instead of reaching the true edge and falling off).
Fixed by owner's report: "the pieces won't fall off the edge... they'll crash into it."

Seam joints: an ENCLOSED press-fit lock, not a Lego tube-clutch (that needs tolerances tighter than
a home FDM printer holds reliably) and not the old open-top dovetail (fine against sideways
prying, but nothing stopped a segment being lifted straight back out -- "easily knocked apart").
The new tab/pocket is Z-bounded within the wall, so once seated a segment has solid material above
AND below it and physically cannot lift out; assembly is a straight in-plane PRESS (segments
pushed together sideways at the seam), not a vertical slide. A small retention dome near the tip
pops into a shallow pocket at full depth for the actual click, backed by the thick wall rather than
a thin flexing arm (a skinny cantilever is the fatigue-prone part of most snap-fits after repeated
assembly cycles). Print-and-tune like the old dovetail: the coupon pair is the fast way to dial in
lock_clear / bump_proud / dimple_depth before committing to a full rim.

Seam magnets no longer fit at this (shorter, corrected) rim height -- the 'mag' seam variant is
dropped. FOOT magnets (in the tripod feet, gripping the steel disk -- unrelated to seam assembly)
are unaffected.

Run:  python3 tau_cad.py           # both SKUs -> ./out_cad/*.step + *.stl
"""
import os, math
import cadquery as cq

BASE_DISK_D = 266.7
MAGNETS = [(4,2),(5,2),(5,3),(6,2),(6,3),(8,2),(8,3),(10,3)]   # stocked neodymium discs (Ø, thick)

# ------------------------------------------------------------------ parameters
class Spec:
    def __init__(self, disk_d, n_seg, fit='glue'):
        self.disk_d = disk_d
        s = self.scale = disk_d / BASE_DISK_D
        self.disk_t      = 2.0            # steel (both SKUs)
        self.disk_clear  = 0.35 * s
        self.wall_thick  = 8.0  * s       # radial wall at the disk edge
        self.ledge_h     = 3.0  * s       # rim floor under the disk edge
        self.ledge_w     = 2.5  * s       # reach under the disk
        self.skirt_bevel = 6.0  * s       # outer skirt slopes in toward the bottom
        self.groove_w    = 34.0 * s       # finger scoops: ALWAYS 2, player axis, any N_SEG
        self.groove_depth= 10.0 * s
        self.n_seg       = n_seg
        self.fit         = fit            # 'press' (-0.10 bore) | 'glue' (+0.15 bore)
        self.mag_backing = 1.2
        # enclosed press-lock (scale-aware, sized off the wall)
        self.lock_len    = 5.0  * s       # tangential engagement depth
        self.lock_w      = 4.4  * s       # radial width of the tab (constant cross-section)
        self.lock_margin = 0.7  * s       # solid ceiling+floor left above/below the tab in the wall
        self.lock_clear  = 0.20           # mortise oversize per side (print fit; NOT scaled)
        self.bump_d      = 1.8  * s       # retention dome diameter
        self.bump_proud  = 0.35 * s       # how far the dome stands proud of the tab
        self.dimple_depth= 0.20 * s       # matching pocket depth (shallower than bump_proud -> real interference)
    def bore(self, mag_d): return mag_d + (-0.10 if self.fit == 'press' else 0.15)
    # derived ------------------------------------------------------------------
    @property
    def seat_r(self):   return self.disk_d/2 + self.disk_clear      # vertical inner face
    @property
    def floor_r(self):  return self.seat_r - self.ledge_w
    @property
    def outer_r(self):  return self.seat_r + self.wall_thick
    @property
    def outer_bot_r(self): return self.outer_r - self.skirt_bevel
    @property
    def disk_top_z(self): return self.ledge_h + self.disk_t
    @property
    def rim_h(self):    return self.disk_top_z   # FLUSH: rim top = disk top, everywhere
    @property
    def wall_mid_r(self): return (self.seat_r + self.outer_r) / 2
    @property
    def lock_h(self):   return self.rim_h - 2*self.lock_margin

# ------------------------------------------------------------------ solids
def rim_ring(sp: Spec):
    """Solid of revolution: vertical inner face, FLUSH top (no proud lip), bottom ledge, sloped
    skirt. The whole rim tops out level with the disk's own playing surface -- a piece sliding
    toward the rim reaches the true edge with nothing standing above it to catch on."""
    pts = [
        (sp.floor_r,     0),
        (sp.outer_bot_r, 0),
        (sp.outer_r,     sp.rim_h),
        (sp.seat_r,      sp.rim_h),
        (sp.seat_r,      sp.ledge_h),
        (sp.floor_r,     sp.ledge_h),
    ]
    ring = (cq.Workplane("XZ").polyline(pts).close()
            .revolve(360, (0,0,0), (0,1,0)))
    # finger scoops: two vertical cylinders on the player axis (±Y), independent of N_SEG
    for sy in (+1, -1):
        ring = ring.cut(
            cq.Workplane("XY").center(0, sy*sp.outer_r).circle(sp.groove_w/2)
              .extrude(sp.groove_depth*2).translate((0,0,sp.rim_h - sp.groove_depth)))
    return ring

def seam_offset(n_seg):
    """Angular offset (rad) for the ring of seams that best clears the two finger grooves (on +-Y).
    A seam landing on a groove would run through a thinned wall, so from a few natural offsets pick
    the one whose seams sit farthest from +-90 deg. Works for any count (the old pi/n rule put a seam
    straight onto a groove at n=6)."""
    step = 2 * math.pi / n_seg
    grooves = (math.pi/2, 3*math.pi/2)
    def clearance(off):
        seams = [(off + step*k) % (2*math.pi) for k in range(n_seg)]
        return min(min(abs(((s - g + math.pi) % (2*math.pi)) - math.pi) for g in grooves) for s in seams)
    return max((0.0, step/2, step/4, 3*step/4), key=clearance)

def wedge(a0, a1, R, H):
    """Angular pie-slice solid, z 0..H (a0/a1 radians)."""
    steps = max(3, int(math.degrees(a1-a0)/6))
    pts = [(0,0)] + [(R*math.cos(a0+(a1-a0)*i/steps), R*math.sin(a0+(a1-a0)*i/steps))
                     for i in range(steps+1)]
    return cq.Workplane("XY").polyline(pts).close().extrude(H)

def lock_tab(sp: Spec, ang, clear=0.0):
    """Rectangular tab (clear=0) or its oversized mortise cut (clear>0) at seam angle `ang`.
    Constant cross-section, Z-BOUNDED within the wall (lock_margin of solid ceiling+floor is left
    on the mortise side), so once seated the tab cannot be lifted out vertically at all -- that
    solid ceiling/floor is what the old open-top dovetail was missing. Assembled by a straight
    in-plane PRESS: the two segments are pushed together sideways at the seam, at a fixed height,
    not slid down from above."""
    L, W = sp.lock_len + clear, sp.lock_w + 2*clear
    rm = sp.wall_mid_r
    ca, sa = math.cos(ang), math.sin(ang)
    ux, uy = -sa, ca                    # +tangential (protrusion direction)
    vx, vy = ca, sa                     # +radial
    quad = [(-0.4, -W/2), (-0.4, W/2), (L, W/2), (L, -W/2)]   # -0.4: bury the root in the owner
    pts = [(rm*vx + u*ux + v*vx, rm*vy + u*uy + v*vy) for (u, v) in quad]
    zlo = sp.lock_margin - clear
    return (cq.Workplane("XY").polyline(pts).close()
            .extrude(sp.lock_h + 2*clear).translate((0, 0, zlo)))

def lock_bump(sp: Spec, ang, dimple=False):
    """A small dome near the tab's tip (dimple=False), or its shallower matching pocket cut into
    the socket's ceiling (dimple=True). The dome sits proud by bump_proud; the dimple is cut
    shallower than that (dimple_depth), so seating the tab means genuinely compressing past it --
    that's the actual click, and what resists it being pressed straight back out. Backed by the
    thick wall on both sides, not a thin flexing arm, so it isn't the fatigue-prone part."""
    rm = sp.wall_mid_r
    ca, sa = math.cos(ang), math.sin(ang)
    ux, uy = -sa, ca; vx, vy = ca, sa
    u0 = sp.lock_len * 0.72                          # near the tip, so it engages at full depth
    cx, cy = rm*vx + u0*ux, rm*vy + u0*uy
    cz = sp.lock_margin + sp.lock_h                   # the tab's top face / socket's ceiling
    r = sp.bump_d / 2
    if not dimple:
        # a sphere sunk so only `bump_proud` of it pokes above the tab's top face
        return (cq.Workplane("XY").workplane(offset=cz - (r - sp.bump_proud))
                .center(cx, cy).sphere(r))
    else:
        # same cap position/shape as the bump above, just shallower (dimple_depth < bump_proud) --
        # the leftover difference is the interference that has to compress to seat, and resists
        # pulling the tab back out.
        return (cq.Workplane("XY").workplane(offset=cz - (r*1.05 - sp.dimple_depth))
                .center(cx, cy).sphere(r * 1.05))

# ------------------------------------------------------------------ build
def build(disk_d, n_seg, outdir, label, variant='snap'):
    sp = Spec(disk_d, n_seg)
    os.makedirs(outdir, exist_ok=True)
    tag = f"{label}_{variant}"
    rpt = [f"--- SKU {tag}: DISK_D={disk_d} scale={sp.scale:.3f} N_SEG={n_seg} ---",
           f"  outer Ø{2*sp.outer_r:.1f}, rim height {sp.rim_h:.1f} (flush with disk top), seat Ø{2*sp.seat_r:.1f} (vertical)",
           f"  lock: {sp.lock_len:.1f} deep x {sp.lock_w:.1f} wide, {sp.lock_h:.1f} tall (margin {sp.lock_margin:.2f} top/bottom), "
           f"mortise clearance {sp.lock_clear}, bump Ø{sp.bump_d:.1f} proud {sp.bump_proud:.2f} / dimple depth {sp.dimple_depth:.2f}"]
    ring = rim_ring(sp)
    fbase = os.path.join(outdir, f"tau_rim_{label}_full")                # whole base as ONE solid, for viewing/editing
    cq.exporters.export(ring, fbase + ".step"); cq.exporters.export(ring, fbase + ".stl")
    rpt.append(f"  full ring (single solid) -> tau_rim_{label}_full.step/.stl")
    off = seam_offset(n_seg)                             # keep seams off the finger grooves
    R = sp.outer_r*2
    seams = [off + 2*math.pi*k/n_seg for k in range(n_seg)]
    for k in range(n_seg):
        a0, a1 = seams[k], off + 2*math.pi*(k+1)/n_seg
        a1m = a1 % (2*math.pi)
        seg = ring.intersect(wedge(a0, a1, R, sp.rim_h))
        seg = seg.union(lock_tab(sp, a1m)).union(lock_bump(sp, a1m))                  # tab + its dome at my a1 end
        seg = seg.cut(lock_tab(sp, a0, clear=sp.lock_clear)).cut(lock_bump(sp, a0, dimple=True))   # pocket + dimple at my a0 end
        solid = seg.val()
        ok = solid.isValid() and solid.Volume() > 0
        base = os.path.join(outdir, f"tau_rim_{tag}_seg{k+1}of{n_seg}")
        cq.exporters.export(seg, base + ".step")
        cq.exporters.export(seg, base + ".stl")
        rpt.append(f"  seg {k+1}/{n_seg}: valid={ok} vol={solid.Volume()/1000:.1f} cm3 -> {os.path.basename(base)}.step/.stl")
    # ---- coupons: one seam pair, plus the foot-pocket stub ----
    stub = ring.intersect(wedge(-math.radians(14), math.radians(14), R, sp.rim_h))
    half_a = stub.intersect(wedge(-math.radians(14), 0, R, sp.rim_h))
    half_b = stub.intersect(wedge(0, math.radians(14), R, sp.rim_h))
    half_b = half_b.union(lock_tab(sp, 0.0)).union(lock_bump(sp, 0.0))
    half_a = half_a.cut(lock_tab(sp, 0.0, clear=sp.lock_clear)).cut(lock_bump(sp, 0.0, dimple=True))
    for nm, part in [("A", half_a), ("B", half_b)]:
        solid = part.val()
        ok = solid.isValid() and solid.Volume() > 0
        base = os.path.join(outdir, f"tau_coupon_seam{nm}_{tag}")
        cq.exporters.export(part, base + ".step"); cq.exporters.export(part, base + ".stl")
        rpt.append(f"  coupon seam{nm}: valid={ok} -> {os.path.basename(base)}.step/.stl")
    fm_d, fm_t = (5,2)   # foot magnets grip the steel board — polarity irrelevant
    foot_pad_r = 6.5 * sp.scale
    assert sp.bore(fm_d)/2 <= foot_pad_r - 0.8, "foot magnet too big for the pad — pick smaller stock"
    pad = (cq.Workplane("XY").circle(foot_pad_r + 2).extrude(9)
           .cut(cq.Workplane("XY").circle(sp.bore(fm_d)/2).extrude(fm_t + sp.mag_backing)))
    base = os.path.join(outdir, f"tau_coupon_foot_{label}")
    cq.exporters.export(pad, base + ".step"); cq.exporters.export(pad, base + ".stl")
    rpt.append(f"  coupon: foot pocket ({fm_d}x{fm_t})")
    return "\n".join(rpt)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out_cad")
    # Segment counts sized for a 220x220 bed (Ender 3): the longest arc must fit with margin for a
    # skirt. 267 -> 4 arcs (~200 mm), 400 -> 8 arcs (~162 mm). Fewer, larger arcs are possible if you
    # print them across the bed diagonal; change the count here if you prefer that.
    print(build(266.7, 4, out, "267"))
    print(build(400.0, 8, out, "400"))
    print(f"\nParts written to {out}")
