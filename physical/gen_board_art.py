#!/usr/bin/env python3
"""
Tau board print art -- generator.

Reproduces the SHIPPED digital board (index.html: CFG, fillBoardDisc, zoneValue) as real-world
vector geometry, in millimetres, for the Slate and Dojo colourways, at both physical SKUs
(267mm and 400mm). Outputs DXF (opens natively in AutoCAD/most CAD & vinyl-cutter software --
the universal CAD interchange format; true .dwg is a proprietary Autodesk binary format with no
open writer, DXF is what every CAD tool reads/writes identically and can Save-As .dwg from
within AutoCAD/BricsCAD/LibreCAD if a literal .dwg file is ever required) and print-ready PDF
(both an RGB build matching the screen values, and a CMYK build for a traditional press quote).

Geometry source of truth (do not hand-tune -- read from index.html):
    CFG.edgeU = 66.667          board units, radius of the printed disc
    CFG.rings = [40, 53.3]      the two concentric crossing lines, board units
    CFG.sideArcs                the two lens arcs (r=40, centred just past the rim)
    CFG.lineWidthFrac = 0.0079  printed line stroke width, as a fraction of edgeU
    CFG.padRadiusFrac = 0.0082  printed start-dot radius, as a fraction of edgeU
    CFG.footR = 23.095, CFG.startX = 30.597   tripod start pose -> the 6 start dots

Scale: 1 board unit = 2.0 mm exactly (footR 23.095u = 46.19mm hub-to-foot per the tripod STL;
edgeU 66.667u = 133.334mm radius = 266.67mm board diameter per the disk STL -- both confirm the
same 2.0 factor). The 400mm SKU scales every dimension by 400.0/266.7, identically to tau_cad.py.

Zone shading (fillBoardDisc, faithfully reproduced as real non-overlapping filled regions rather
than opaque canvas layering): v4 = centre (< rings[0]), v3 = mid band, v2 = outer band, each
dropped one step (v3/v2/v1 respectively) inside either lens pocket -- this is the "crossings to
centre" grading, one value darker every ring/arc you'd have to cross to reach that cell from the
centre.
"""
import math, os
import numpy as np
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union
import ezdxf
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.colors import Color, CMYKColor
from reportlab.lib.units import mm

MM_PER_UNIT = 2.0          # confirmed: footR 23.095u == 46.19mm; edgeU 66.667u == 133.334mm radius
BASE_EDGE_U = 66.667
CIRCLE_SEGS = 1440         # fine enough that curve deviation is invisible at any print/cut scale

# ---- geometry read verbatim from index.html CFG (do not hand-tune) ----
RINGS = [40.0, 53.3]
SIDE_ARCS = [
    {"cx": -66.667, "cy": 0.0, "r": 40.0, "a0": -72.542, "a1": 72.542},
    {"cx":  66.667, "cy": 0.0, "r": 40.0, "a0": 107.458, "a1": 252.542},
]
LINE_WIDTH_FRAC = 0.0079
PAD_RADIUS_FRAC = 0.0082
FOOT_R = 23.095
START_X = 30.597

# ---- colourways (exact hex from index.html SLATE_SKIN / DOJO_SKIN) ----
SKINS = {
    "slate": {"v4": "#5a636c", "v3": "#4b535b", "v2": "#3c434a", "v1": "#2f353b",
              "flat": "#454d55", "lines": "#12161a", "rim": "#8f979e",
              "pb": "#5487c4", "pr": "#d05a48", "label": "Slate"},
    "dojo":  {"v4": "#e9d9b3", "v3": "#ddc99b", "v2": "#cbb47e", "v1": "#b89a62",
              "flat": "#d9c9a3", "lines": "#3a2f22", "rim": "#3c434a",
              "pb": "#243f78", "pr": "#cf3b26", "label": "Dojo"},
}

SKUS = {"267": 266.7, "400": 400.0}


def hex_to_rgb01(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4))


def rgb_to_cmyk(r, g, b):
    """Standard UCR (under-colour-removal) conversion, GCR-light: derive K from the darkest
    channel, then normalise C/M/Y against the remaining headroom. This is the conventional
    naive-but-correct starting formula -- print shops will still want a proof (see README)."""
    k = 1 - max(r, g, b)
    if k >= 0.9999:
        return (0.0, 0.0, 0.0, 1.0)
    c = (1 - r - k) / (1 - k)
    m = (1 - g - k) / (1 - k)
    y = (1 - b - k) / (1 - k)
    return (c, m, y, k)


def circle_poly(cx, cy, r, segs=CIRCLE_SEGS):
    th = np.linspace(0, 2 * math.pi, segs, endpoint=False)
    return Polygon(np.column_stack([cx + r * np.cos(th), cy + r * np.sin(th)]))


def arc_ring_poly(cx, cy, r_in, r_out, a0_deg, a1_deg, segs=360):
    """A filled wedge/ring segment between two radii and two angles (degrees), used for the
    ring-line stroke geometry (a stroked circle rendered as a filled annulus)."""
    a0, a1 = math.radians(a0_deg), math.radians(a1_deg)
    th = np.linspace(a0, a1, segs)
    outer = np.column_stack([cx + r_out * np.cos(th), cy + r_out * np.sin(th)])
    inner = np.column_stack([cx + r_in * np.cos(th[::-1]), cy + r_in * np.sin(th[::-1])])
    return Polygon(np.vstack([outer, inner]))


def build_geometry(edge_u):
    """Returns dict of shapely polygons: zone fills (v1..v4), line strokes (rings+arcs, as filled
    annuli matching lineWidthFrac), start dots, and the board outline -- all at `edge_u` board-unit
    scale (still needs the MM_PER_UNIT*sku_scale multiply to reach real mm for a given SKU)."""
    disc = circle_poly(0, 0, edge_u)
    r0, r1 = RINGS
    disc_r0 = circle_poly(0, 0, r0)
    disc_r1 = circle_poly(0, 0, r1)

    lens_polys = []
    for a in SIDE_ARCS:
        lens_polys.append(circle_poly(a["cx"], a["cy"], a["r"]).intersection(disc))
    lens_union = unary_union(lens_polys)

    # base (non-lens) bands, per fillBoardDisc's layering: v2 under v3 under v4, each punched by
    # the lens union since the lens re-fills that area with the shifted-down band instead.
    non_lens = disc.difference(lens_union)
    v4 = disc_r0.difference(lens_union)                         # centre, non-lens
    v3 = disc_r1.difference(disc_r0).difference(lens_union)     # mid band, non-lens
    v2 = non_lens.difference(disc_r1)                            # outer band, non-lens (already excludes lens)

    # within each lens: v1 = outer part (>r1), v2 += mid part (r0..r1), v3 += inner part (<r0)
    v1_lens, v2_lens, v3_lens = [], [], []
    for lp in lens_polys:
        v1_lens.append(lp.difference(disc_r1))
        v2_lens.append(lp.intersection(disc_r1).difference(disc_r0))
        v3_lens.append(lp.intersection(disc_r0))
    v1 = unary_union(v1_lens)
    v2 = unary_union([v2] + v2_lens)
    v3 = unary_union([v3] + v3_lens)

    # line strokes: rings as full annuli, side-arcs as arc-wedge annuli, all at real print width
    lw = edge_u * LINE_WIDTH_FRAC
    ring_strokes = [circle_poly(0, 0, r + lw/2).difference(circle_poly(0, 0, r - lw/2)) for r in RINGS]
    ring_strokes = [rs.intersection(disc) for rs in ring_strokes]
    arc_strokes = [arc_ring_poly(a["cx"], a["cy"], a["r"] - lw/2, a["r"] + lw/2, a["a0"], a["a1"]).intersection(disc)
                   for a in SIDE_ARCS]
    lines = unary_union(ring_strokes + arc_strokes)

    # 6 start dots: two tripods' feet at the start pose (hub at +-startX on the x-axis, one foot
    # pointing at centre, the other two at +-120deg) -- exactly CFG.startDots's construction.
    pad_r = edge_u * PAD_RADIUS_FRAC
    dots = []
    for hub_x, facing in ((-START_X, 0.0), (START_X, math.pi)):
        for k in range(3):
            ang = facing + k * (2 * math.pi / 3)
            fx, fy = hub_x + FOOT_R * math.cos(ang), FOOT_R * math.sin(ang)
            dots.append((fx, fy, k == 0))   # k==0 is the centre-facing foot (front)
    dot_polys_blue = [circle_poly(x, y, pad_r) for x, y, _ in dots[:3]]
    dot_polys_red = [circle_poly(x, y, pad_r) for x, y, _ in dots[3:]]

    return {
        "outline": disc, "v1": v1, "v2": v2, "v3": v3, "v4": v4,
        "lines": lines, "dots_blue": unary_union(dot_polys_blue), "dots_red": unary_union(dot_polys_red),
    }


def polys_of(geom):
    """Flatten a shapely Polygon/MultiPolygon (skip empties) into a list of Polygons."""
    if geom.is_empty:
        return []
    return list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]


def export_dxf(geo, mm_scale, skin, path):
    doc = ezdxf.new("R2010")
    doc.units = ezdxf.units.MM
    msp = doc.modelspace()
    layers = [
        ("OUTLINE", 7), ("ZONE_V1", 1), ("ZONE_V2", 2), ("ZONE_V3", 3), ("ZONE_V4", 4),
        ("LINES", 6), ("DOTS_BLUE", 5), ("DOTS_RED", 1),
    ]
    for name, color in layers:
        doc.layers.add(name=name, color=color)

    def add(geom, layer):
        for poly in polys_of(geom):
            pts = [(x * mm_scale, y * mm_scale) for x, y in poly.exterior.coords]
            msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": layer})
            for ring in poly.interiors:
                pts = [(x * mm_scale, y * mm_scale) for x, y in ring.coords]
                msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": layer})

    add(geo["outline"], "OUTLINE")
    add(geo["v1"], "ZONE_V1"); add(geo["v2"], "ZONE_V2")
    add(geo["v3"], "ZONE_V3"); add(geo["v4"], "ZONE_V4")
    add(geo["lines"], "LINES")
    add(geo["dots_blue"], "DOTS_BLUE"); add(geo["dots_red"], "DOTS_RED")
    doc.saveas(path)


def export_pdf(geo, mm_scale, skin, path, colour_space="rgb"):
    disc_r_mm = BASE_EDGE_U * mm_scale  # for the outer bound; recomputed properly below per-call
    bounds = geo["outline"].bounds
    w_mm = (bounds[2] - bounds[0]) * mm_scale
    h_mm = (bounds[3] - bounds[1]) * mm_scale
    margin = 8 * mm
    page_w, page_h = w_mm * mm + 2 * margin, h_mm * mm + 2 * margin
    cx0, cy0 = margin - bounds[0] * mm_scale * mm, margin - bounds[1] * mm_scale * mm

    c = pdfcanvas.Canvas(path, pagesize=(page_w, page_h))

    def mkcolor(hexval):
        r, g, b = hex_to_rgb01(hexval)
        if colour_space == "cmyk":
            cc, mm_, yy, kk = rgb_to_cmyk(r, g, b)
            return CMYKColor(cc, mm_, yy, kk)
        return Color(r, g, b)

    def draw(geom, hexval, stroke=None):
        col = mkcolor(hexval)
        c.setFillColor(col)
        if stroke:
            c.setStrokeColor(mkcolor(stroke)); c.setLineWidth(0.1)
        for poly in polys_of(geom):
            p = c.beginPath()
            xs, ys = poly.exterior.coords.xy
            p.moveTo(cx0 + xs[0] * mm_scale * mm, cy0 + ys[0] * mm_scale * mm)
            for x, y in zip(xs[1:], ys[1:]):
                p.lineTo(cx0 + x * mm_scale * mm, cy0 + y * mm_scale * mm)
            p.close()
            for ring in poly.interiors:
                rx, ry = ring.coords.xy
                p.moveTo(cx0 + rx[0] * mm_scale * mm, cy0 + ry[0] * mm_scale * mm)
                for x, y in zip(rx[1:], ry[1:]):
                    p.lineTo(cx0 + x * mm_scale * mm, cy0 + y * mm_scale * mm)
                p.close()
            c.drawPath(p, fill=1, stroke=1 if stroke else 0)

    draw(geo["v2"], skin["v2"]); draw(geo["v3"], skin["v3"]); draw(geo["v4"], skin["v4"])
    draw(geo["v1"], skin["v1"])
    draw(geo["lines"], skin["lines"])
    draw(geo["dots_blue"], skin["pb"])
    draw(geo["dots_red"], skin["pr"])
    c.showPage()
    c.save()


def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    os.makedirs(out, exist_ok=True)
    report = []
    for sku_label, disk_d in SKUS.items():
        sku_scale = disk_d / 266.7
        edge_u = BASE_EDGE_U                                 # geometry stays in base board-units...
        mm_scale = MM_PER_UNIT * sku_scale                    # ...scaled to real mm here
        geo = build_geometry(edge_u)
        real_diam = 2 * edge_u * mm_scale
        report.append(f"SKU {sku_label}: board diameter {real_diam:.2f} mm (target {disk_d} mm)")
        for skin_name, skin in SKINS.items():
            tag = f"{sku_label}_{skin_name}"
            dxf_path = os.path.join(out, f"tau_board_{tag}.dxf")
            export_dxf(geo, mm_scale, skin, dxf_path)
            pdf_rgb = os.path.join(out, f"tau_board_{tag}_RGB.pdf")
            export_pdf(geo, mm_scale, skin, pdf_rgb, colour_space="rgb")
            pdf_cmyk = os.path.join(out, f"tau_board_{tag}_CMYK.pdf")
            export_pdf(geo, mm_scale, skin, pdf_cmyk, colour_space="cmyk")
            report.append(f"  {skin['label']}: {os.path.basename(dxf_path)}, "
                           f"{os.path.basename(pdf_rgb)}, {os.path.basename(pdf_cmyk)}")
    print("\n".join(report))
    print(f"\nWritten to {out}")


if __name__ == "__main__":
    main()
