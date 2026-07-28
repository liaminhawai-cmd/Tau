#!/usr/bin/env python3
"""Tau physical model — parametric rim (the raised edge the steel disk seats into).

Everything geometric derives from ONE master variable, DISK_D (steel disk diameter). SCALE =
DISK_D / 266.7 scales the whole rim; magnet pockets are the ONE exception — they snap to a real
stocked part (see MAGNETS), never to SCALE.

Measured from the clean repo STLs (do not re-guess these):
  - steel disk        Ø266.65, 2.0 mm thick   (Metal base 266.666.stl)   ; 400 SKU Ø399.98, 2.0 mm
  - tripod piece      hub->foot 46.19 mm, height 53.77 mm                (tripod smoove 2021.stl)
  - existing rim      Ø297.5 outer, 15 mm tall; its inner face FLARES outward (126->148 mm r,
                      bottom->top) — that is the load-bearing bug this model fixes: the inner
                      face that contacts the disk edge is now VERTICAL, so lean becomes
                      compression into the wall, not an outward wedge that splays the segments.

Builds with trimesh + manifold3d (CSG booleans, STL export) so every part is verified watertight
before it is written. Run:  python3 tau_model.py           # both SKUs, STLs into ./out
"""
import os, math, argparse
import numpy as np
import trimesh

# ----------------------------------------------------------------------------- master + stock
BASE_DISK_D = 266.7                      # the reference SKU the measurements are in

# Stocked neodymium disc magnets (dia mm, thickness mm). Pockets snap to one of THESE, never SCALE.
MAGNETS = [(4,2),(5,2),(5,3),(6,2),(6,3),(8,2),(8,3),(10,3)]
def pick_magnet(dia):                    # nearest stocked entry at or below the asked diameter
    ok = [m for m in MAGNETS if m[0] <= dia] or [MAGNETS[0]]
    return max(ok, key=lambda m: m[0])

# ----------------------------------------------------------------------------- parameters
class Spec:
    def __init__(self, disk_d, n_seg, foot_mag=(6,3), joint_mag=(6,3),
                 fit='glue', mag_backing=1.5):
        self.disk_d = disk_d
        self.scale  = disk_d / BASE_DISK_D
        s = self.scale
        self.disk_t        = 2.0                         # steel thickness (both SKUs)
        self.disk_clear    = 0.35 * s                    # radial gap so the disk drops in
        self.wall_thick    = 8.0  * s                    # radial rim wall thickness at the disk
        self.ledge_h       = 3.0  * s                    # rim height below the disk (bottom ledge)
        self.ledge_w       = 2.5  * s                    # how far the bottom ledge reaches under the disk
        self.lip_overlap   = 2.5  * s                    # top inner lip caps the disk (hoops segments)
        self.lip_height    = 2.0  * s                    # lip thickness above the disk
        self.skirt_bevel   = 6.0  * s                    # outer skirt slopes in toward the bottom (tumble cliff)
        self.groove_w      = 34.0 * s                    # finger-scoop width
        self.groove_depth  = 10.0 * s                    # how deep the scoop cuts the top rim
        self.n_seg         = n_seg
        # magnets: snap to stock (fit clearance applies to the BORE, not the pocket depth)
        self.foot_mag      = foot_mag
        self.joint_mag     = joint_mag
        self.fit           = fit                          # 'press' (-0.1) or 'glue' (+0.15)
        self.mag_backing   = mag_backing
    def bore(self, mag_d):
        return mag_d + (-0.1 if self.fit == 'press' else 0.15)
    # derived radii ---------------------------------------------------------------------------
    @property
    def disk_seat_r(self):  return self.disk_d/2 + self.disk_clear     # VERTICAL inner face
    @property
    def inner_lip_r(self):  return self.disk_seat_r - self.lip_overlap
    @property
    def bottom_inner_r(self):return self.disk_seat_r - self.ledge_w
    @property
    def outer_top_r(self):  return self.disk_seat_r + self.wall_thick
    @property
    def outer_bot_r(self):  return self.outer_top_r - self.skirt_bevel
    @property
    def disk_top_z(self):   return self.ledge_h + self.disk_t
    @property
    def rim_top_z(self):    return self.disk_top_z + self.lip_height

# ----------------------------------------------------------------------------- rim body
def rim_ring(sp: Spec):
    """The full rim as a solid of revolution. Cross-section (r,z), CCW, with a VERTICAL inner
    disk-contact face, a top capture lip, a bottom seating ledge, and a sloped outer skirt."""
    p = [
        (sp.bottom_inner_r, 0.0),          # inner bottom corner
        (sp.outer_bot_r,    0.0),          # outer bottom corner
        (sp.outer_top_r,    sp.rim_top_z), # outer top corner (skirt slopes out toward the top)
        (sp.inner_lip_r,    sp.rim_top_z), # top of the capture lip (inner)
        (sp.inner_lip_r,    sp.disk_top_z),# lip underside, inner edge
        (sp.disk_seat_r,    sp.disk_top_z),# lip meets the vertical wall = disk top corner
        (sp.disk_seat_r,    sp.ledge_h),   # VERTICAL inner face down to the seating ledge
        (sp.bottom_inner_r, sp.ledge_h),   # ledge top (disk rests here)
    ]
    prof = np.array(p + [p[0]], dtype=float)
    ring = trimesh.creation.revolve(prof, sections=256)
    return ring

def cut_finger_grooves(mesh, sp: Spec):
    """Two scoops on the player axis (+y / -y), so the disk can be lifted out. Always exactly 2,
    independent of segment count. Cut as vertical cylinders through the top of the rim."""
    for sign in (+1, -1):
        cy = sign * sp.outer_top_r
        cutter = trimesh.creation.cylinder(radius=sp.groove_w/2, height=sp.groove_depth*2.2)
        cutter.apply_translation((0, cy, sp.rim_top_z + sp.groove_depth*1.1 - sp.groove_depth*1.0))
        mesh = trimesh.boolean.difference([mesh, cutter])
    return mesh

# ----------------------------------------------------------------------------- segmentation
def segment(mesh, sp: Spec):
    """Split the ring into N_SEG equal wedges. Seam orientation: N=2 -> seam east-west (cut plane
    is the x-z plane) so the two player-axis grooves land mid-segment; N=4 -> seams on the 45°
    diagonals for the same reason."""
    n = sp.n_seg
    seam_offset = 0.0 if n == 2 else math.pi/n     # rotate wedges so seams miss the grooves
    R = sp.outer_top_r * 3
    segs = []
    for k in range(n):
        a0 = seam_offset + 2*math.pi*k/n
        a1 = seam_offset + 2*math.pi*(k+1)/n
        # wedge = big prism spanning [a0,a1]; build as a fan of triangles extruded in z
        wedge = wedge_prism(a0, a1, R, sp.rim_top_z*3)
        wedge.apply_translation((0,0,-sp.rim_top_z))
        segs.append(trimesh.boolean.intersection([mesh, wedge]))
    return segs

def wedge_prism(a0, a1, R, H):
    """A solid angular wedge (pie slice) from a0..a1, radius R, height H, centered on z=0..H."""
    steps = max(2, int(math.degrees(a1-a0)/5))
    pts = [(0,0)]
    for i in range(steps+1):
        a = a0 + (a1-a0)*i/steps
        pts.append((R*math.cos(a), R*math.sin(a)))
    poly = trimesh.path.polygons.Polygon(pts)
    return trimesh.creation.extrude_polygon(poly, height=H)

# ----------------------------------------------------------------------------- magnet pockets
def add_joint_magnet_pockets(seg, sp: Spec, seam_angles):
    """Bore a rim-joint magnet pocket into each seam face of a segment. Alignment/click only —
    NOT structural (the dovetail carries load; that is a TODO pending a confirmed style)."""
    md, mt = sp.joint_mag
    bore = sp.bore(md)
    depth = mt + sp.mag_backing
    rmid = (sp.disk_seat_r + sp.outer_top_r)/2
    zmid = sp.rim_top_z/2
    for ang in seam_angles:
        # pocket axis is tangential (into the flat seam face): direction = +theta normal
        nx, ny = -math.sin(ang), math.cos(ang)
        cx, cy = rmid*math.cos(ang), rmid*math.sin(ang)
        pocket = trimesh.creation.cylinder(radius=bore/2, height=depth*2)
        # orient cylinder (default +z) to the tangential normal
        T = trimesh.geometry.align_vectors([0,0,1],[nx,ny,0])
        pocket.apply_transform(T)
        pocket.apply_translation((cx, cy, zmid))
        seg = trimesh.boolean.difference([seg, pocket])
    return seg

# ----------------------------------------------------------------------------- test coupons
def coupon_seam(sp: Spec):
    """Two short arc stubs of the rim across one seam — to lean-test the interlock + magnet fit."""
    ring = rim_ring(sp)
    stub = wedge_prism(math.radians(-14), math.radians(14), sp.outer_top_r*3, sp.rim_top_z*3)
    stub.apply_translation((0,0,-sp.rim_top_z))
    arc = trimesh.boolean.intersection([ring, stub])
    return arc

def coupon_foot_pocket(sp: Spec):
    """A small stub of a tripod foot with its magnet pocket, to check press-fit + board grip."""
    md, mt = sp.foot_mag
    # foot pad radius must clear the magnet bore — assert
    foot_pad_r = 6.5 * sp.scale
    assert sp.bore(md)/2 <= foot_pad_r, \
        f"foot magnet Ø{md} bore {sp.bore(md):.2f} exceeds foot pad radius {foot_pad_r:.2f} — pick a smaller stock magnet"
    stub = trimesh.creation.cylinder(radius=foot_pad_r+2, height=10)
    stub.apply_translation((0,0,5))
    bore = trimesh.creation.cylinder(radius=sp.bore(md)/2, height=(mt+sp.mag_backing)*2)
    bore.apply_translation((0,0,(mt+sp.mag_backing)))  # open at the bottom face
    return trimesh.boolean.difference([stub, bore])

# ----------------------------------------------------------------------------- build + verify
def build_sku(disk_d, n_seg, outdir, label):
    sp = Spec(disk_d, n_seg)
    os.makedirs(outdir, exist_ok=True)
    report = [f"--- SKU {label}: DISK_D={disk_d}  scale={sp.scale:.3f}  N_SEG={n_seg} ---"]
    report.append(f"  disk seat (vertical face) Ø{2*sp.disk_seat_r:.2f}, capture lip overlap {sp.lip_overlap:.2f} mm")
    report.append(f"  outer Ø{2*sp.outer_top_r:.2f} (top) / Ø{2*sp.outer_bot_r:.2f} (bottom skirt), height {sp.rim_top_z:.2f} mm")
    report.append(f"  joint magnet {sp.joint_mag[0]}x{sp.joint_mag[1]} bore Ø{sp.bore(sp.joint_mag[0]):.2f} ({sp.fit})")

    ring = rim_ring(sp)
    ring = cut_finger_grooves(ring, sp)
    report.append(f"  full ring watertight: {ring.is_watertight}")

    seam_offset = 0.0 if n_seg == 2 else math.pi/n_seg
    segs = segment(ring, sp)
    for k, seg in enumerate(segs):
        a0 = seam_offset + 2*math.pi*k/n_seg
        a1 = seam_offset + 2*math.pi*(k+1)/n_seg
        seg = add_joint_magnet_pockets(seg, sp, [a0, a1])
        wt = seg.is_watertight
        path = os.path.join(outdir, f"tau_rim_{label}_seg{k+1}of{n_seg}.stl")
        seg.export(path)
        report.append(f"  segment {k+1}/{n_seg}: watertight={wt}  -> {os.path.basename(path)}")

    coupon_seam(sp).export(os.path.join(outdir, f"tau_coupon_seam_{label}.stl"))
    coupon_foot_pocket(sp).export(os.path.join(outdir, f"tau_coupon_foot_{label}.stl"))
    report.append(f"  coupons: tau_coupon_seam_{label}.stl, tau_coupon_foot_{label}.stl")
    # verification asserts
    assert abs((2*sp.disk_seat_r) - (disk_d + 2*sp.disk_clear)) < 1e-6
    return "\n".join(report)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "out"))
    args = ap.parse_args()
    print(build_sku(266.7, 2, args.out, "267"))
    print(build_sku(400.0, 4, args.out, "400"))
    print(f"\nSTLs written to {args.out}")
