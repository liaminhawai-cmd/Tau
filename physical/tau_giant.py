#!/usr/bin/env python3
"""Giant Tau piece for a 1 m board — printable on an Ender 3 as 3 legs + 1 hub.

Source of truth is the real piece mesh (../tripod smoove 2021.stl, the Ø266.7 mm-board tripod,
120°-symmetric to <0.16 mm). A 1 m board is EXACTLY 3.75x that (1 game unit: 2 mm -> 7.5 mm), so
the giant piece is the genuine article scaled, then split — never re-modelled.

Split: one sphere centred in the hub dome (C=(0,0,170), R=100 in giant mm — probed so the sphere
surface crosses ONLY the three legs; the dome sits fully inside and the feet far outside).
  hub  = piece ∩ sphere(R)          -> the dome with three convex spherical stubs
  leg  = piece − sphere(R+0.15)     -> concave spherical cup that nests over a stub (0.15 gap)
Both cut spheres are the SAME icosphere tessellation (the outer one scaled), so the mating faces
are congruent facet-for-facet and the clearance is uniform. The spherical pair self-aligns; a
keyed rectangular tenon (leg) into a mortise (hub) fixes rotation and carries the joint, with the
rim model's proven snap: retention dome proud 0.45 on the tenon top popping past a 0.25-deep
dimple in the mortise roof (dome > dimple depth = real interference click), mortise oversize
0.20 mm per side. Coupon pair included to dial the fit before committing to full prints.

Run:  python3 tau_giant.py     -> ./out_giant/*.stl  (+ preview PNGs if matplotlib is present)
"""
import os, math
import numpy as np
import trimesh

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(HERE, '..', 'tripod smoove 2021.stl')
OUT  = os.path.join(HERE, 'out_giant')
os.makedirs(OUT, exist_ok=True)

S          = 3.75                 # Ø266.7 board -> Ø1000.1 board (1 unit: 2 mm -> 7.5 mm)
CUT_C      = np.array([0.0, 0.0, 170.0])   # sphere-cut centre (giant mm) — probed
CUT_R      = 100.0                # sphere-cut radius — probed: crosses only the 3 legs
FACE_CLEAR = 0.15                 # radial gap between hub stub and leg cup
LOCK_CLEAR = 0.20                 # mortise oversize per side (print fit — the rim model's number)
TENON_L    = 22.0                 # tenon length beyond the leg's cut face (into the hub)
TENON_EMB  = 8.0                  # how far the tenon root is buried inside the leg (weld overlap)
BUMP_R     = 2.2                  # retention dome sphere radius
BUMP_PROUD = 0.45                 # how far the dome stands proud of the tenon top
DIMPLE_D   = 0.25                 # dimple depth (< BUMP_PROUD -> genuine interference click)

# Foot bolts (cost model v5: "domed button-head bolts seated head-down in each foot, 3 per piece"
# — mass low at the outer points, a rounded steel sliding contact, no magnets). The scaled foot
# tip is only Ø8.4 so each foot gets a printed BOSS around it: a frustum with a recessed seat the
# head shoulder pulls up against (dome cap protruding below to be the glide contact) and a snug
# pilot bore the bolt self-taps into (the piece's weight rests on the seat; the thread only stops
# the bolt dropping out when the piece is lifted). Defaults = M10 x 40 button head (~30 g each,
# ~90 g of steel per piece, Bunnings-common); switch BOLT='M8' for the lighter set.
BOLT = 'M10'
BOLTS = {                        # head_d, head_h, pilot_d (self-tap in PLA/PETG), min length
    'M8':  dict(head_d=14.0, head_h=4.4, pilot_d=7.2, length=30),
    'M10': dict(head_d=18.0, head_h=5.5, pilot_d=8.9, length=40),
}[BOLT]
BOSS_BOT_D = BOLTS['head_d'] + 8.0   # boss frustum: bottom Ø (seat + 4 mm wall)
BOSS_TOP_D = 14.0                    # tapers to hug the ankle
BOSS_H     = 30.0
SEAT_DEPTH = 1.5                     # head shoulder recess -> dome cap protrudes head_h-SEAT_DEPTH

def boolean(kind, meshes):
    fn = {'union': trimesh.boolean.union, 'diff': trimesh.boolean.difference,
          'inter': trimesh.boolean.intersection}[kind]
    r = fn(meshes, engine='manifold')
    if isinstance(r, list): r = trimesh.util.concatenate(r)
    return r

def frame_matrix(axes, origin):
    """4x4 with columns = local axes (3 unit vectors) and translation."""
    M = np.eye(4); M[:3,0], M[:3,1], M[:3,2] = axes; M[:3,3] = origin
    return M

# ----------------------------------------------------------------------- load + scale
piece = trimesh.load(SRC)
piece.apply_translation([0,0,3.77])   # foot pads onto z=0
piece.apply_scale(S)
assert piece.is_watertight
print('giant piece: extents %.1f x %.1f x %.1f mm, solid %.0f cm3'
      % (*piece.extents, piece.volume/1000))

# congruent cutting spheres (same tessellation, outer one scaled about the shared centre)
sph_in  = trimesh.creation.icosphere(subdivisions=5, radius=CUT_R);            sph_in.apply_translation(CUT_C)
sph_out = trimesh.creation.icosphere(subdivisions=5, radius=CUT_R+FACE_CLEAR); sph_out.apply_translation(CUT_C)

# ----------------------------------------------------------------------- split
hub_raw  = boolean('inter', [piece, sph_in])
legs_raw = boolean('diff',  [piece, sph_out])
parts = legs_raw.split(only_watertight=True)
assert len(parts) == 3, f'expected 3 legs, got {len(parts)}'
# the +Y leg (azimuth 90°) is the canonical one — print it three times
def azim(m): c = m.centroid; return (math.degrees(math.atan2(c[1], c[0])) + 360) % 360
leg_raw = min(parts, key=lambda p: abs(azim(p) - 90))
print('leg azimuths:', [round(azim(p)) for p in parts], '-> using', round(azim(leg_raw)))

# ----------------------------------------------------------------------- joint frame (the +Y leg)
# cut-face centroid: leg vertices sitting on the outer cut sphere
v = leg_raw.vertices
d = np.linalg.norm(v - CUT_C, axis=1)
face_v = v[d < CUT_R + FACE_CLEAR + 0.35]
p0 = face_v.mean(axis=0)
u  = CUT_C - p0; u /= np.linalg.norm(u)             # tenon axis: into the hub
t_up = np.array([0,0,1.0]) - u*np.dot([0,0,1.0], u) # 'up' projected off the axis
t_up /= np.linalg.norm(t_up)
t_side = np.cross(u, t_up)
# local width/height of the leg at the cut face -> tenon sizing (~55% of the local section)
rel = face_v - p0
w_loc = 2*np.abs(rel @ t_side).max(); h_loc = 2*np.abs(rel @ t_up).max()
TEN_W = round(0.55 * w_loc, 1); TEN_H = round(0.55 * h_loc, 1)
print('cut face at %s, local section %.1f x %.1f -> tenon %.1f x %.1f x %.1f'
      % (np.round(p0,1), w_loc, h_loc, TEN_W, TEN_H, TENON_L))

def tenon_solid(grow=0.0, extra_len=0.0):
    """The tenon prism in the +Y leg's joint frame. grow>0 -> the mortise cut."""
    L = TENON_EMB + TENON_L + extra_len
    box = trimesh.creation.box(extents=[TEN_W + 2*grow, TEN_H + 2*grow, L + 2*grow])
    # centred so it runs from EMB inside the leg face to TENON_L beyond it (along +u)
    box.apply_transform(frame_matrix([t_side, t_up, u], p0 + u*(L/2 - TENON_EMB)))
    return box

def bump_solid(dimple=False):
    """Retention dome on the tenon top (dimple=False) or its shallower pocket (dimple=True)."""
    r = BUMP_R * (1.05 if dimple else 1.0)
    top = TEN_H/2 + (LOCK_CLEAR if dimple else 0.0)          # tenon top / mortise roof
    sink = (r - BUMP_PROUD) if not dimple else (r - DIMPLE_D)
    centre = p0 + u*(TENON_L - 6.0) + t_up*(top - sink)
    s = trimesh.creation.icosphere(subdivisions=3, radius=r); s.apply_translation(centre)
    return s

rot120 = trimesh.transformations.rotation_matrix(math.radians(120), [0,0,1])

# ----------------------------------------------------------------------- foot bolt boss
# frustum hugging the ankle, seat recess for the button head's shoulder (dome cap protrudes below
# as the glide contact), snug pilot bore the bolt self-taps into.
pad_c = leg_raw.vertices[leg_raw.vertices[:,2] < 2].mean(axis=0); pad_c[2] = 0.0
def frustum(r_bot, r_top, h, sections=64):
    cyl = trimesh.creation.cylinder(radius=r_bot, height=h, sections=sections)
    v = cyl.vertices.copy()
    top = v[:,2] > 0
    v[top,0] *= r_top/r_bot; v[top,1] *= r_top/r_bot
    cyl.vertices = v
    return cyl
boss = frustum(BOSS_BOT_D/2, BOSS_TOP_D/2, BOSS_H)
boss.apply_translation(pad_c + [0,0,BOSS_H/2])
seat = trimesh.creation.cylinder(radius=(BOLTS['head_d']+0.6)/2, height=SEAT_DEPTH+4, sections=64)
seat.apply_translation(pad_c + [0,0,SEAT_DEPTH/2 - 2])          # from below z=0 up to SEAT_DEPTH
pilot_h = SEAT_DEPTH + BOLTS['length'] + 3
pilot = trimesh.creation.cylinder(radius=BOLTS['pilot_d']/2, height=pilot_h, sections=48)
pilot.apply_translation(pad_c + [0,0,pilot_h/2 - 1])            # blind bore up the ankle
print('foot: boss Ø%.0f->Ø%.0f x %.0f at (%.1f, %.1f); %s x %d button head, dome protrudes %.1f mm'
      % (BOSS_BOT_D, BOSS_TOP_D, BOSS_H, pad_c[0], pad_c[1], BOLT, BOLTS['length'],
         BOLTS['head_h'] - SEAT_DEPTH))

# ----------------------------------------------------------------------- build parts
leg = boolean('union', [leg_raw, boss, tenon_solid(), bump_solid()])
leg = boolean('diff',  [leg, seat, pilot])

cuts = []
for k in range(3):
    mo = tenon_solid(grow=LOCK_CLEAR, extra_len=0.4)
    di = bump_solid(dimple=True)
    for _ in range(k): mo.apply_transform(rot120); di.apply_transform(rot120)
    cuts += [mo, di]
hub = boolean('diff', [hub_raw] + cuts)

# ----------------------------------------------------------------------- verify
for name, m in (('leg', leg), ('hub', hub)):
    assert m.is_watertight, name + ' not watertight'
    print('%s: watertight, extents %.1f x %.1f x %.1f mm, solid %.0f cm3'
          % (name, *m.extents, m.volume/1000))
    fits = all(e <= lim for e, lim in zip(sorted(m.extents), (220, 220, 250)))
    print('   fits Ender 3 (220x220x250):', 'YES' if fits else 'CHECK ORIENTATION')

# assembly reconstruction: hub + 3 rotated legs should re-form the piece's silhouette
assy = [hub]
for k in range(3):
    lg = leg.copy()
    for _ in range(k): lg.apply_transform(rot120)
    assy.append(lg)
assembled = trimesh.util.concatenate(assy)
db = np.abs(assembled.bounds - piece.bounds).max()
print('assembly bounds vs original: max dev %.2f mm' % db)

# ----------------------------------------------------------------------- fit coupon
# socket block with the real mortise+dimple, and a short paddle with the real tenon+bump —
# print both first, click together, and adjust LOCK_CLEAR if needed before the big prints.
cp_frame = frame_matrix([np.array([1.,0,0]), np.array([0,0,1.]), np.array([0,1.,0])], [0,0,0])
def reframe(m):
    m = m.copy()
    m.apply_transform(np.linalg.inv(frame_matrix([t_side, t_up, u], p0)))  # joint frame -> origin
    m.apply_transform(cp_frame)                                            # axis along +Y, up +Z
    return m
sock = trimesh.creation.box(extents=[TEN_W+16, TENON_L+8, TEN_H+14])
sock.apply_translation([0, (TENON_L+8)/2 - 0.01, 0])
coupon_socket = boolean('diff', [sock, reframe(tenon_solid(grow=LOCK_CLEAR, extra_len=0.4)),
                                 reframe(bump_solid(dimple=True))])
pad = trimesh.creation.box(extents=[TEN_W+16, 10, TEN_H+14]); pad.apply_translation([0,-5,0])
coupon_tenon = boolean('union', [pad, reframe(tenon_solid()), reframe(bump_solid())])
for name, m in (('coupon_socket', coupon_socket), ('coupon_tenon', coupon_tenon)):
    assert m.is_watertight, name + ' not watertight'

# ----------------------------------------------------------------------- print-ready leg
# The leg is a curved rod: laid on its side it kisses the bed along a THIN LINE, so with no brim it
# detaches and turns into spaghetti (the reported failed print). Lay it flat in its own plane and
# shave a small FLAT SOLE along the underside -> a continuous ribbon of bed contact the whole
# length, which sticks with just a skirt and prints with NO supports (nothing arches off the bed).
# The sole is a hair off the back of the tube, hidden against the board in play; the foot's glide
# contact is the bolt dome, untouched.
SOLE_CUT = 1.4        # mm shaved flat along the leg's underside
R_flat = trimesh.transformations.rotation_matrix(math.radians(-90), [0,1,0])
leg_flat = leg.copy(); leg_flat.apply_transform(R_flat)
leg_flat.apply_translation(-leg_flat.bounds[0])                         # drop min corner to origin
b = leg_flat.bounds
knife = trimesh.creation.box(extents=[b[1][0]-b[0][0]+20, b[1][1]-b[0][1]+20, SOLE_CUT*2+4])
knife.apply_translation([(b[0][0]+b[1][0])/2, (b[0][1]+b[1][1])/2, SOLE_CUT - (SOLE_CUT*2+4)/2 + SOLE_CUT])
leg_flat = boolean('diff', [leg_flat, knife])
leg_flat.apply_translation([0,0,-leg_flat.bounds[0][2]])                # re-seat on the bed
pf,_ = trimesh.sample.sample_surface(leg_flat, 60000)
print('print-flat leg: %.0f x %.0f x %.0f mm, bed-contact surface now %.0f%% (was ~0)'
      % (*leg_flat.extents, 100*(pf[:,2] < 0.4).mean()))
assert leg_flat.is_watertight

# ----------------------------------------------------------------------- export
files = {'tau_giant_leg.stl': leg, 'tau_giant_leg_printflat.stl': leg_flat, 'tau_giant_hub.stl': hub,
         'tau_giant_coupon_socket.stl': coupon_socket, 'tau_giant_coupon_tenon.stl': coupon_tenon}
for fn, m in files.items():
    m.export(os.path.join(OUT, fn))
    print('wrote', fn, '(%d faces)' % len(m.faces))

# ----------------------------------------------------------------------- previews (best effort)
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    def snap(meshes, colors, fname, elev=18, azim=-60):
        fig = plt.figure(figsize=(7,7)); ax = fig.add_subplot(111, projection='3d')
        lo = np.min([m.bounds[0] for m in meshes], axis=0); hi = np.max([m.bounds[1] for m in meshes], axis=0)
        for m, c in zip(meshes, colors):
            ax.add_collection3d(Poly3DCollection(m.triangles, facecolor=c, edgecolor='none', alpha=0.95))
        ctr, rad = (lo+hi)/2, (hi-lo).max()/2
        ax.set_xlim(ctr[0]-rad, ctr[0]+rad); ax.set_ylim(ctr[1]-rad, ctr[1]+rad); ax.set_zlim(max(0,ctr[2]-rad), ctr[2]+rad)
        ax.set_box_aspect([1,1,1]); ax.view_init(elev=elev, azim=azim); ax.axis('off')
        plt.tight_layout(); plt.savefig(os.path.join(OUT, fname), dpi=110); plt.close()
        print('wrote', fname)
    leg2 = leg.copy();  leg2.apply_transform(rot120)
    leg3 = leg.copy();  leg3.apply_transform(rot120); leg3.apply_transform(rot120)
    # exploded: pull each leg 35 mm outward along its own joint axis
    ex = []
    for k, lg in enumerate((leg, leg2, leg3)):
        ax_u = u.copy()
        for _ in range(k):
            ax_u = rot120[:3,:3] @ ax_u
        e = lg.copy(); e.apply_translation(-ax_u*35); ex.append(e)
    snap([hub]+ex, ['#c9a227', '#3c66a8', '#3c66a8', '#3c66a8'], 'preview_exploded.png')
    snap([hub, leg, leg2, leg3], ['#c9a227', '#3c66a8', '#3c66a8', '#3c66a8'], 'preview_assembled.png')
    snap([leg], ['#3c66a8'], 'preview_leg.png', elev=8, azim=-35)
except Exception as e:
    print('previews skipped:', e)
print('DONE')
