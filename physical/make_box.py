#!/usr/bin/env python3
"""Tau physical packaging generator — full-kit edition (disk-in-base).

Print-true dielines (1 SVG unit = 1 mm) for a round two-piece TELESCOPING (hatbox) box that ships
the magnetic disk seated in its base, with the two tripod pieces cradled above it.

  1. tau_box_dieline.svg   — bottom disc + wall strip (fold-under glue tabs) and a shallower lid.
  2. tau_insert_tray.svg   — die-cut piece cradle that sits ON the base, holding both tripods.

Everything derives from the constants below. For the ~30% bigger board, scale BASE_D (and the piece
constants if the pieces grow too) and re-run.

Measured inputs (from the uploaded files):
  - magnetic playing disk  Ø266.7 mm      (Bord.dxf edge r 66.667 board-units, 1 unit = 2 mm)
  - BASE (chunky_1.stl)    297.5 x 277.5 mm footprint, 15 mm tall — the disk is recessed in it.
      * slightly oval, so the round box is sized to the LARGER span (297.5) and clears the 277.5.
      * the Bord.dxf r=73.333u (Ø293.3) circle is the same base in the design file; the print came
        out ~4 mm larger, so trust the STL.
  - tripod piece  85.8 x 75.1 x 53.8 mm   (tripod_smoove_2021.stl; feet 46.19 mm from the hub axis).
"""
import math, os

# ---------------- parameters (mm) ----------------
BASE_D       = 297.5   # base outer diameter — the widest object in the box (max of 297.5 x 277.5)
BASE_T       = 15.0    # base height (magnetic disk recessed within it)
PIECE_FOOT_R = 46.19   # hub axis -> foot centre
PIECE_LEG_R  = 4.0     # leg tube radius
PIECE_PAD_R  = 6.5     # foot pad pocket radius (pad 5.8 + clearance)
PIECE_HUB_R  = 14.0    # hub keep-out radius (hub + sag of the leg arcs)
PIECE_H      = 54.0    # piece height incl. pads
GREYBOARD    = 2.0     # rigid box wall board thickness
TRAY_WALL    = 3.0     # insert tray wall / rim thickness
CLEAR        = 2.5     # base-to-box-wall slip clearance per side
LID_SLIP     = 0.6     # lid-over-base sliding clearance per side
LID_DEPTH_FR = 0.42    # lid wall depth as a fraction of base depth (telescoping look)
GLUE_OVERLAP = 15.0    # wall strip end overlap
TAB_H        = 12.0    # fold-under tabs gluing the wall to the bottom disc
TAB_W        = 24.0
TRAY_FLOOR   = 3.0     # tray board thickness under the pieces
TOP_PAD      = 6.0     # foam pad above the pieces before the lid closes

def box_dims():
    inner_d   = BASE_D + 2*CLEAR                       # base drops straight into the box
    depth     = BASE_T + TRAY_FLOOR + PIECE_H + TOP_PAD + 3.0
    base_od   = inner_d + 2*GREYBOARD
    lid_id    = base_od + 2*LID_SLIP
    lid_od    = lid_id + 2*GREYBOARD
    lid_depth = round(depth * LID_DEPTH_FR)
    return dict(inner_d=inner_d, depth=depth, base_od=base_od,
                lid_id=lid_id, lid_od=lid_od, lid_depth=lid_depth)

# ---------------- svg helpers ----------------
CUT   = 'fill:none;stroke:#000;stroke-width:0.4'
FOLD  = 'fill:none;stroke:#c22;stroke-width:0.4;stroke-dasharray:4,3'
GLUE  = 'fill:#9db8d9;fill-opacity:0.35;stroke:none'
NOTE  = 'font-family:Arial;font-size:9px;fill:#333'
TITLE = 'font-family:Arial;font-size:13px;font-weight:bold;fill:#000'
DIM   = 'font-family:Arial;font-size:8px;fill:#555'

def svg_doc(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}mm" height="{h}mm" '
            f'viewBox="0 0 {w} {h}">\n<title>{title}</title>\n'
            f'<rect x="0" y="0" width="{w}" height="{h}" fill="white"/>\n{body}</svg>\n')

def circle(cx, cy, r, style=CUT):
    return f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" style="{style}"/>\n'

def line(x1, y1, x2, y2, style=CUT):
    return f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" style="{style}"/>\n'

def rect(x, y, w, h, style=CUT):
    return f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" style="{style}"/>\n'

def text(x, y, s, style=NOTE, anchor='start'):
    return f'<text x="{x:.2f}" y="{y:.2f}" style="{style}" text-anchor="{anchor}">{s}</text>\n'

def dim_h(x1, x2, y, label):
    out = line(x1, y, x2, y, 'stroke:#555;stroke-width:0.3')
    out += line(x1, y-2, x1, y+2, 'stroke:#555;stroke-width:0.3')
    out += line(x2, y-2, x2, y+2, 'stroke:#555;stroke-width:0.3')
    out += text((x1+x2)/2, y-2, label, DIM, 'middle')
    return out

# ---------------- 1. box dieline ----------------
def box_svg():
    d = box_dims()
    pad = 15
    strip_base_len = math.pi * (d['inner_d'] + GREYBOARD) + GLUE_OVERLAP
    strip_lid_len  = math.pi * (d['lid_id'] + GREYBOARD) + GLUE_OVERLAP
    disc_col_w = d['lid_od'] + 2*pad
    strip_w = max(strip_base_len, strip_lid_len) + 2*pad
    W = disc_col_w + strip_w
    H = max(d['base_od'] + d['lid_od'] + 3*pad + 40,
            (d['depth']+TAB_H) + (d['lid_depth']+TAB_H) + 3*pad + 90)
    b = ''
    b += text(pad, 12, 'TAU — round telescoping box dieline (steel edition, disk-in-base)', TITLE)
    b += text(pad, 24, '1 SVG unit = 1 mm. Solid = cut, dashed red = crease, blue = glue area.', NOTE)
    b += text(pad, 34, f'Base Ø{BASE_D:.1f} (widest) drops straight in · box inner Ø{d["inner_d"]:.1f} × {d["depth"]:.0f} deep '
                       f'· greyboard {GREYBOARD:.1f} · lid slip {LID_SLIP:.1f}/side', NOTE)

    cy0 = 52 + d['base_od']/2
    cx0 = pad + d['lid_od']/2
    b += circle(cx0, cy0, d['base_od']/2 - GREYBOARD)
    b += text(cx0, cy0 - 6, 'BASE bottom disc', NOTE, 'middle')
    b += text(cx0, cy0 + 6, f'Ø{d["base_od"] - 2*GREYBOARD:.1f}', DIM, 'middle')
    cy1 = cy0 + d['base_od']/2 + pad + d['lid_od']/2
    b += circle(cx0, cy1, d['lid_od']/2 - GREYBOARD)
    b += text(cx0, cy1 - 6, 'LID top disc', NOTE, 'middle')
    b += text(cx0, cy1 + 6, f'Ø{d["lid_od"] - 2*GREYBOARD:.1f}', DIM, 'middle')

    def strip(x, y, length, depth, label):
        s = rect(x, y, length, depth)
        s += rect(x, y, GLUE_OVERLAP, depth, GLUE)
        s += line(x + GLUE_OVERLAP, y, x + GLUE_OVERLAP, y + depth, FOLD)
        n = max(6, int(length // 60))
        step = (length - GLUE_OVERLAP) / n
        for i in range(n):
            tx = x + GLUE_OVERLAP + i*step + (step - TAB_W)/2
            s += rect(tx, y + depth, TAB_W, TAB_H, CUT)
            s += rect(tx, y + depth, TAB_W, TAB_H, GLUE)
            s += line(tx, y + depth, tx + TAB_W, y + depth, FOLD)
        s += text(x, y - 4, label, NOTE)
        s += dim_h(x, x + length, y + depth + TAB_H + 8, f'{length:.1f}')
        return s

    sx = disc_col_w + pad
    sy = 52
    b += strip(sx, sy, strip_base_len, d['depth'],
               f'BASE wall strip — depth {d["depth"]:.0f} (+{TAB_H:.0f} tabs), wraps bottom disc, tabs glue under')
    sy2 = sy + d['depth'] + TAB_H + 34
    b += strip(sx, sy2, strip_lid_len, d['lid_depth'],
               f'LID wall strip — depth {d["lid_depth"]:.0f} (+{TAB_H:.0f} tabs)')
    b += text(sx, sy2 + d['lid_depth'] + TAB_H + 26,
              'Assembly: wrap wall around its disc, glue end overlap, fold tabs under disc and glue.', NOTE)
    b += text(sx, sy2 + d['lid_depth'] + TAB_H + 37,
              f'Stack in the box: base+disk ({BASE_T:.0f} mm) on the floor → insert tray with the two pieces → top pad → lid.', NOTE)
    b += text(sx, sy2 + d['lid_depth'] + TAB_H + 48,
              'Wrap both cups in printed paper (add 15 mm turn-in) — standard rigid setup-box construction.', NOTE)
    b += text(sx, sy2 + d['lid_depth'] + TAB_H + 59,
              'The ~297.5 base is slightly oval (297.5 x 277.5); the round box clears the larger span, ~10 mm gap on the short axis.', NOTE)
    return svg_doc(math.ceil(W), math.ceil(H), b, 'Tau box dieline (disk-in-base)')

# ---------------- 2. insert tray (piece cradle over the base) ----------------
def piece_cavity_path(cx, cy, rot_deg):
    out = circle(cx, cy, PIECE_HUB_R)
    for k in range(3):
        a = math.radians(rot_deg + k*120)
        fx, fy = cx + math.cos(a)*PIECE_FOOT_R, cy + math.sin(a)*PIECE_FOOT_R
        out += circle(fx, fy, PIECE_PAD_R)
        w = 2*(PIECE_LEG_R + 1.5)
        x0, y0 = cx + math.cos(a)*PIECE_HUB_R*0.7, cy + math.sin(a)*PIECE_HUB_R*0.7
        dx, dy = fx-x0, fy-y0; L = math.hypot(dx, dy); ux, uy = dx/L, dy/L; px, py = -uy, ux
        pts = [(x0+px*w/2, y0+py*w/2), (fx+px*w/2, fy+py*w/2), (fx-px*w/2, fy-py*w/2), (x0-px*w/2, y0-py*w/2)]
        out += '<path d="M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in pts) + ' Z" style="%s"/>\n' % CUT
    return out

def tray_svg():
    d = box_dims()
    tray_d = d['inner_d']            # sits on the base, fills the box footprint
    W = tray_d + 30; H = tray_d + 120
    cx, cy = W/2, 78 + tray_d/2
    b = ''
    b += text(15, 12, 'TAU — insert tray: piece cradle (die-cut), sits ON the base', TITLE)
    b += text(15, 24, f'Outer Ø{tray_d:.1f} drops into the box on top of the base. Thickness ≥ piece height 54 mm', NOTE)
    b += text(15, 34, '(laminate 3×18 mm E-flute, or cut 55 mm EVA). Cavities hold both tripods feet-down; the', NOTE)
    b += text(15, 44, 'magnetic disk is already protected in the base below. Cavities traced from tripod_smoove_2021.stl.', NOTE)
    b += circle(cx, cy, tray_d/2)
    off = PIECE_FOOT_R + PIECE_PAD_R + 8
    b += piece_cavity_path(cx - off, cy, 0)
    b += piece_cavity_path(cx + off, cy, 60)
    b += text(cx - off, cy - PIECE_FOOT_R - 12, 'blue piece', DIM, 'middle')
    b += text(cx + off, cy - PIECE_FOOT_R - 12, 'red piece', DIM, 'middle')
    for a in (90, 270):
        ar = math.radians(a)
        nx, ny = cx + math.cos(ar)*(tray_d/2), cy + math.sin(ar)*(tray_d/2)
        b += circle(nx, ny, 12)
        b += text(nx, ny + 3, 'finger notch', DIM, 'middle')
    b += dim_h(cx - tray_d/2, cx + tray_d/2, cy + tray_d/2 + 12, f'Ø{tray_d:.1f}')
    return svg_doc(math.ceil(W), math.ceil(H), b, 'Tau insert tray')

# ---------------- write files ----------------
outdir = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(outdir, 'tau_box_dieline.svg'), 'w').write(box_svg())
open(os.path.join(outdir, 'tau_insert_tray.svg'), 'w').write(tray_svg())
d = box_dims()
print('box dims:', {k: round(v, 1) for k, v in d.items()})
print('files written to', outdir)
