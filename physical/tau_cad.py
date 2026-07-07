#!/usr/bin/env python3
"""Tau physical model — CadQuery parametric source (canonical).

Outputs manufacturing-native STEP + printable STL for every part. One master variable, DISK_D,
drives all geometry via SCALE = DISK_D / 266.7; magnet pockets snap to a stocked-part table (never
SCALE). Rim proportions: LEAN MINIMUM (owner's call) — just enough wall to seat + capture the disk.

Measured inputs (from the clean repo STLs — do not re-guess):
    steel disk   Ø266.65 x 2.0 mm   (400 SKU: Ø399.98 x 2.0)
    tripod       hub->foot 46.19 mm, height 53.77 mm
    old rim      inner face FLARED outward (bug) — inner disk-contact face here is VERTICAL.

Seam joints: a vertical-slide DOVETAIL carries prying/shear (assemble by dropping the segment in;
the disk capture lip then locks vertical lift, hooping the ring). Magnets are alignment/click only —
geometry is identical on both faces; glue them in with opposite poles facing across each seam
(polarity is an assembly step, not geometry). A no-magnet variant is exported too.

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
        self.lip_overlap = 2.5  * s       # top lip caps the disk -> hoops the segments
        self.lip_height  = 2.0  * s
        self.skirt_bevel = 6.0  * s       # outer skirt slopes in toward the bottom
        self.groove_w    = 34.0 * s       # finger scoops: ALWAYS 2, player axis, any N_SEG
        self.groove_depth= 10.0 * s
        self.n_seg       = n_seg
        self.fit         = fit            # 'press' (-0.10 bore) | 'glue' (+0.15 bore)
        self.mag_backing = 1.2
        # dovetail (scale-aware, sized off the wall)
        self.dt_depth    = 4.0 * s        # tangential protrusion into the neighbour
        self.dt_neck     = 3.2 * s        # radial width at the seam face
        self.dt_flare    = 5.6 * s        # radial width at the tip (wider = the lock)
        self.dt_clear    = 0.15           # mortise oversize per side (print fit; NOT scaled)
    def bore(self, mag_d): return mag_d + (-0.10 if self.fit == 'press' else 0.15)
    def pick_seam_magnet(self):
        """Largest stocked magnet whose bore fits the seam face height with 1mm walls."""
        max_bore = self.rim_h - 2.0
        ok = [m for m in MAGNETS if self.bore(m[0]) <= max_bore]
        assert ok, f"no stocked magnet fits a {self.rim_h:.1f} mm seam face — deepen the rim"
        return max(ok, key=lambda m: (m[0], m[1]))
    # derived ------------------------------------------------------------------
    @property
    def seat_r(self):   return self.disk_d/2 + self.disk_clear      # vertical inner face
    @property
    def lip_r(self):    return self.seat_r - self.lip_overlap
    @property
    def floor_r(self):  return self.seat_r - self.ledge_w
    @property
    def outer_r(self):  return self.seat_r + self.wall_thick
    @property
    def outer_bot_r(self): return self.outer_r - self.skirt_bevel
    @property
    def disk_top_z(self): return self.ledge_h + self.disk_t
    @property
    def rim_h(self):    return self.disk_top_z + self.lip_height
    @property
    def wall_mid_r(self): return (self.seat_r + self.outer_r) / 2

# ------------------------------------------------------------------ solids
def rim_ring(sp: Spec):
    """Solid of revolution: vertical inner face, top capture lip, bottom ledge, sloped skirt."""
    pts = [
        (sp.floor_r,     0),
        (sp.outer_bot_r, 0),
        (sp.outer_r,     sp.rim_h),
        (sp.lip_r,       sp.rim_h),
        (sp.lip_r,       sp.disk_top_z),
        (sp.seat_r,      sp.disk_top_z),
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

def wedge(a0, a1, R, H):
    """Angular pie-slice solid, z 0..H (a0/a1 radians)."""
    steps = max(3, int(math.degrees(a1-a0)/6))
    pts = [(0,0)] + [(R*math.cos(a0+(a1-a0)*i/steps), R*math.sin(a0+(a1-a0)*i/steps))
                     for i in range(steps+1)]
    return cq.Workplane("XY").polyline(pts).close().extrude(H)

def dovetail(sp: Spec, ang, clear=0.0):
    """Tapered prism at seam angle `ang`: neck at the seam plane, flaring wider with tangential
    protrusion — resists tangential pull-apart; assembled by vertical slide. `clear` grows the
    solid for the mortise cut."""
    d  = sp.dt_depth + clear            # protrusion (tangential)
    w1 = sp.dt_neck  + 2*clear          # radial width at seam
    w2 = sp.dt_flare + 2*clear          # radial width at tip
    rm = sp.wall_mid_r
    # local frame at the seam: u = tangential (protrude), v = radial
    ca, sa = math.cos(ang), math.sin(ang)
    ux, uy = -sa, ca                    # +tangential
    vx, vy = ca, sa                     # +radial
    quad = [(-0.4, -w1/2), (-0.4, w1/2), (d, w2/2), (d, -w2/2)]   # -0.4: bury the neck in the owner
    pts = [(rm*vx + u*ux + v*vx, rm*vy + u*uy + v*vy) for (u, v) in quad]
    h = clear  # mortise also over-tall so the slide isn't a force fit
    return (cq.Workplane("XY").polyline(pts).close()
            .extrude(sp.rim_h + 2*h).translate((0,0,-h)))

def seam_magnet_pocket(sp: Spec, ang, side):
    """Cylindrical bore into a seam face, axis tangential. side=+1 bores into the segment ABOVE
    the seam angle, -1 below. Same geometry both faces (polarity = assembly)."""
    md, mt = sp.pick_seam_magnet()
    bore_r = sp.bore(md)/2
    depth  = mt + sp.mag_backing
    ca, sa = math.cos(ang), math.sin(ang)
    ux, uy = -sa*side, ca*side          # into the target segment
    # radial placement: inner half of the wall, clear of the (outer-half) dovetail
    r_mag = sp.seat_r + sp.wall_thick*0.28
    cx, cy = r_mag*ca, r_mag*sa
    pocket = (cq.Workplane("XY").circle(bore_r).extrude(depth)
              .rotate((0,0,0),(1,0,0),90))                     # cylinder axis -> +Y
    a_deg = math.degrees(math.atan2(uy, ux))
    pocket = pocket.rotate((0,0,0),(0,0,1), a_deg - 90 + 180)  # axis -> (ux,uy), opening at the face
    return pocket.translate((cx, cy, sp.rim_h/2))

# Can a dovetail AND a magnet share the seam face? On the lean rim (7 mm face x 8 mm wall) they
# cannot — measured, not guessed — so joints come in two variants: dovetail-only (default,
# structural; the vertical slide + disk lip already align and retain) and magnet-click (tool-less,
# weaker). If the rim is ever made chunky enough, combo re-enables automatically.
def combo_fits(sp: Spec):
    try: md, _ = sp.pick_seam_magnet()
    except AssertionError: return False
    mag_outer_edge = sp.seat_r + 0.8 + sp.bore(md)
    dt_inner_edge  = sp.wall_mid_r - sp.dt_flare/2
    return mag_outer_edge < dt_inner_edge - 0.6

# ------------------------------------------------------------------ build
def build(disk_d, n_seg, outdir, label, variant='dt'):
    sp = Spec(disk_d, n_seg)
    if variant == 'combo' and not combo_fits(sp):
        return f"--- SKU {label}: combo joint does not fit at scale {sp.scale:.2f} (lean rim) — skipped"
    dovetails = variant in ('dt', 'combo')
    magnets   = variant in ('mag', 'combo')
    os.makedirs(outdir, exist_ok=True)
    tag = f"{label}_{variant}"
    rpt = [f"--- SKU {tag}: DISK_D={disk_d} scale={sp.scale:.3f} N_SEG={n_seg} ---",
           f"  outer Ø{2*sp.outer_r:.1f}, rim height {sp.rim_h:.1f}, seat Ø{2*sp.seat_r:.1f} (vertical), lip overlap {sp.lip_overlap:.1f}"]
    if dovetails: rpt.append(f"  dovetail neck {sp.dt_neck:.1f} -> tip {sp.dt_flare:.1f}, depth {sp.dt_depth:.1f}, mortise clearance {sp.dt_clear}")
    if magnets:
        md, mt = sp.pick_seam_magnet()
        rpt.append(f"  seam magnet {md}x{mt} bore Ø{sp.bore(md):.2f} ({sp.fit}) — opposite poles across each seam")
    ring = rim_ring(sp)
    off = 0.0 if n_seg == 2 else math.pi/n_seg          # keep seams off the grooves
    R = sp.outer_r*2
    seams = [off + 2*math.pi*k/n_seg for k in range(n_seg)]
    for k in range(n_seg):
        a0, a1 = seams[k], off + 2*math.pi*(k+1)/n_seg
        seg = ring.intersect(wedge(a0, a1, R, sp.rim_h))
        if dovetails:
            seg = seg.union(dovetail(sp, a1 % (2*math.pi)))                # tenon at my a1 end
            seg = seg.cut(dovetail(sp, a0, clear=sp.dt_clear))             # mortise at my a0 end
        if magnets:
            seg = seg.cut(seam_magnet_pocket(sp, a1 % (2*math.pi), +1))    # face pockets, both ends
            seg = seg.cut(seam_magnet_pocket(sp, a0, -1))
        solid = seg.val()
        ok = solid.isValid() and solid.Volume() > 0
        base = os.path.join(outdir, f"tau_rim_{tag}_seg{k+1}of{n_seg}")
        cq.exporters.export(seg, base + ".step")
        cq.exporters.export(seg, base + ".stl")
        rpt.append(f"  seg {k+1}/{n_seg}: valid={ok} vol={solid.Volume()/1000:.1f} cm3 -> {os.path.basename(base)}.step/.stl")
    # ---- coupons: seam pair for THIS variant, plus the foot-pocket stub (dt run only) ----
    stub = ring.intersect(wedge(-math.radians(14), math.radians(14), R, sp.rim_h))
    half_a = stub.intersect(wedge(-math.radians(14), 0, R, sp.rim_h))
    half_b = stub.intersect(wedge(0, math.radians(14), R, sp.rim_h))
    if dovetails:
        half_b = half_b.union(dovetail(sp, 0.0))
        half_a = half_a.cut(dovetail(sp, 0.0, clear=sp.dt_clear))
    if magnets:
        half_a = half_a.cut(seam_magnet_pocket(sp, 0.0, -1))
        half_b = half_b.cut(seam_magnet_pocket(sp, 0.0, +1))
    for nm, part in [("A", half_a), ("B", half_b)]:
        base = os.path.join(outdir, f"tau_coupon_seam{nm}_{tag}")
        cq.exporters.export(part, base + ".step"); cq.exporters.export(part, base + ".stl")
    rpt.append(f"  coupons: seamA/B ({variant})")
    if variant == 'dt':
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
    for variant in ('dt', 'mag'):
        print(build(266.7, 2, out, "267", variant))
        print(build(400.0, 4, out, "400", variant))
    print(f"\nParts written to {out}")
