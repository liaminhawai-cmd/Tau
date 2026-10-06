"""Turn one corrected stick-figure clip into many ad-ready variations.

Usage:
    python animate.py throw.corrected.json                      # one default render
    python animate.py throw.corrected.json --batch              # every preset, into <name>_variants\\
    python animate.py throw.corrected.json --preset ghost --aspect phone
    python animate.py throw.corrected.json --impact 2.4 --caption "Kuzushi: break the balance"

Options you can mix:
    --preset    clean | ghost | neon | ink | board   (look of the figures)
    --aspect    wide (1920x1080) | phone (1080x1920) | square (1080x1080)
    --mirror    flip left/right (red and blue swap sides)
    --speed     overall playback speed, e.g. 0.5 for half speed
    --impact    time in seconds of the key moment: slow motion around it, then a short hold
    --caption   text along the bottom; --title text along the top
    --loop      play forward then hold on the last frame for this many seconds

Takes a .corrected.json from the editor, or a raw .pose.json from detect.py.
"""
import argparse
import json
import math
import os

import cv2
import numpy as np

BONES = [
    ("l_shoulder", "r_shoulder"), ("l_hip", "r_hip"), ("l_shoulder", "l_hip"), ("r_shoulder", "r_hip"),
    ("l_shoulder", "l_elbow"), ("l_elbow", "l_wrist"), ("r_shoulder", "r_elbow"), ("r_elbow", "r_wrist"),
    ("l_hip", "l_knee"), ("l_knee", "l_ankle"), ("r_hip", "r_knee"), ("r_knee", "r_ankle"),
]
ASPECTS = {"wide": (1920, 1080), "phone": (1080, 1920), "square": (1080, 1080)}
RED, BLUE = (72, 90, 208), (214, 75, 47)      # #d05a48 and #2f4bd6 in BGR, the sell sheet colours

# Each preset: background, figure colours, line weight scale, trail length, glow, board ring.
PRESETS = {
    "clean": dict(bg=(17, 14, 12), cols=[(107, 107, 255), (255, 158, 107)], lw=1.0, trail=0, glow=False, board=False),
    "ghost": dict(bg=(17, 14, 12), cols=[(107, 107, 255), (255, 158, 107)], lw=1.0, trail=8, glow=False, board=False),
    "neon":  dict(bg=(8, 6, 5), cols=[(90, 90, 255), (255, 190, 80)], lw=0.8, trail=4, glow=True, board=False),
    "ink":   dict(bg=(236, 240, 243), cols=[RED, BLUE], lw=1.2, trail=0, glow=False, board=False),
    "board": dict(bg=(17, 14, 12), cols=[(107, 107, 255), (255, 158, 107)], lw=1.0, trail=3, glow=False, board=True),
}


def load(path):
    data = json.load(open(path))
    if data["frames"] and isinstance(data["frames"][0], dict):
        ids = data.get("fighters", ["0", "1"])
        data["frames"] = [[fr.get(i) if i else None for i in ids] for fr in data["frames"]]
    io = data.get("inout")
    if io:
        data["frames"] = data["frames"][io[0]:io[1] + 1]
    return data


def smooth(frames, radius=1):
    out = []
    for f in range(len(frames)):
        fr = []
        for p, sk in enumerate(frames[f]):
            if sk is None:
                fr.append(None)
                continue
            pts = []
            for j, q in enumerate(sk):
                acc = [frames[g][p][j] for g in range(max(0, f - radius), min(len(frames), f + radius + 1))
                       if frames[g][p] is not None and frames[g][p][j] is not None]
                pts.append([sum(a[0] for a in acc) / len(acc), sum(a[1] for a in acc) / len(acc)] if q and acc else None)
            fr.append(pts)
        out.append(fr)
    return out


def bounds(frames, J):
    """Box around every fighter joint across the clip, so the figures fill the frame."""
    xs, ys = [], []
    for fr in frames:
        for sk in fr:
            for q in sk or []:
                if q:
                    xs.append(q[0]); ys.append(q[1])
    return min(xs), min(ys), max(xs), max(ys)


def timeline(n, fps, speed, impact, hold):
    """Source-frame index (float) for every output frame. Slow motion around the impact."""
    t, out, dur = 0.0, [], n - 1
    while t <= dur:
        out.append(t)
        rate = speed
        if impact is not None:
            d = abs(t / fps - impact)
            rate *= 0.25 + 0.75 * min(1.0, d / 0.6)      # 4x slower at the impact, easing back over 0.6 s
        t += rate
    if impact is not None:
        k = min(range(len(out)), key=lambda i: abs(out[i] / fps - impact))
        out[k:k] = [out[k]] * int(fps * 0.5)              # half-second hold on the moment
    out += [float(dur)] * int(fps * hold)
    return out


def lerp_frame(frames, t):
    a, b = int(math.floor(t)), min(len(frames) - 1, int(math.floor(t)) + 1)
    w = t - a
    fr = []
    for p in range(len(frames[a])):
        A, B = frames[a][p], frames[b][p]
        if A is None:
            fr.append(None)
            continue
        fr.append([[qa[0] + (qb[0] - qa[0]) * w, qa[1] + (qb[1] - qa[1]) * w] if qa and qb else qa
                   for qa, qb in zip(A, B if B else A)])
    return fr


def draw_fig(img, sk, J, to_px, col, lw):
    for a, b in BONES:
        qa, qb = sk[J[a]], sk[J[b]]
        if qa and qb:
            cv2.line(img, to_px(qa), to_px(qb), col, lw, cv2.LINE_AA)
    n, ls, rs = sk[J["nose"]], sk[J["l_shoulder"]], sk[J["r_shoulder"]]
    if n:
        r = int(math.dist(to_px(ls), to_px(rs)) * 0.32) if ls and rs else lw * 2
        cv2.circle(img, to_px(n), max(r, lw), col, -1, cv2.LINE_AA)


def text(img, s, y, scale, col):
    if not s:
        return
    H, W = img.shape[:2]
    f = cv2.FONT_HERSHEY_DUPLEX
    sc = scale * W / 1080
    th = max(1, int(sc * 2))
    (tw, _), _ = cv2.getTextSize(s, f, sc, th)
    cv2.putText(img, s, ((W - tw) // 2, int(y)), f, sc, col, th, cv2.LINE_AA)


def render(data, out, preset="clean", aspect="wide", mirror=False, speed=1.0, impact=None,
           caption="", title="", hold=0.6):
    P = PRESETS[preset]
    J = {n: i for i, n in enumerate(data["joints"])}
    sw, sh = data["width"], data["height"]
    frames = smooth(data["frames"])
    W, H = ASPECTS[aspect]
    x0, y0, x1, y1 = bounds(frames, J)
    bw, bh = (x1 - x0) * sw, (y1 - y0) * sh
    s = min(W * 0.8 / bw, H * 0.62 / bh)
    cx, cy = (x0 + x1) / 2 * sw, (y0 + y1) / 2 * sh

    def to_px(q):
        x = (q[0] * sw - cx) * s
        return int(W / 2 + (-x if mirror else x)), int(H * 0.5 + (q[1] * sh - cy) * s)

    lw = max(3, int(P["lw"] * 0.045 * min(bw, bh) * s / 4))
    cols = P["cols"][::-1] if mirror else P["cols"]
    ink = (40, 40, 40) if preset == "ink" else (230, 230, 230)
    fps = data["fps"]
    vw = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
    history = []
    for t in timeline(len(frames), fps, speed, impact, hold):
        fr = lerp_frame(frames, t)
        img = np.full((H, W, 3), P["bg"], np.uint8)
        if P["board"]:
            # Faint Tau-style ring under the fighters' feet.
            feet = [q for sk in fr if sk for q in (sk[J["l_ankle"]], sk[J["r_ankle"]]) if q]
            if feet:
                fy = max(to_px(q)[1] for q in feet)
                cv2.ellipse(img, (W // 2, fy), (int(W * 0.42), int(W * 0.07)), 0, 0, 360, (70, 66, 60), 3, cv2.LINE_AA)
                cv2.ellipse(img, (W // 2, fy), (int(W * 0.25), int(W * 0.042)), 0, 0, 360, (55, 52, 48), 2, cv2.LINE_AA)
        for k, old in enumerate(history[-P["trail"]:] if P["trail"] else []):
            a = (k + 1) / (P["trail"] + 1) * 0.35
            layer = img.copy()
            for p, sk in enumerate(old):
                if sk:
                    draw_fig(layer, sk, J, to_px, cols[p % 2], max(1, lw // 2))
            img = cv2.addWeighted(layer, a, img, 1 - a, 0)
        fig = img.copy()
        for p, sk in enumerate(fr):
            if sk:
                draw_fig(fig, sk, J, to_px, cols[p % 2], lw)
        if P["glow"]:
            blur = cv2.GaussianBlur(fig, (0, 0), lw * 1.5)
            fig = cv2.addWeighted(fig, 1.0, blur, 0.9, 0)
        img = fig
        text(img, title, H * 0.1, 1.5, ink)
        text(img, caption, H * 0.92, 1.1, ink)
        vw.write(img)
        history.append(fr)
    vw.release()
    print("Saved", out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("json")
    ap.add_argument("--out")
    ap.add_argument("--preset", default="clean", choices=PRESETS)
    ap.add_argument("--aspect", default="wide", choices=ASPECTS)
    ap.add_argument("--mirror", action="store_true")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--impact", type=float)
    ap.add_argument("--caption", default="")
    ap.add_argument("--title", default="")
    ap.add_argument("--loop", type=float, default=0.6, help="seconds to hold the last frame")
    ap.add_argument("--batch", action="store_true", help="render every preset in phone and wide")
    a = ap.parse_args()

    data = load(a.json)
    base = os.path.splitext(a.json)[0].replace(".corrected", "").replace(".pose", "")
    if a.batch:
        d = base + "_variants"
        os.makedirs(d, exist_ok=True)
        for p in PRESETS:
            for asp in ("phone", "wide"):
                for m in (False, True):
                    render(data, os.path.join(d, f"{p}_{asp}{'_mirror' if m else ''}.mp4"), p, asp, m,
                           a.speed, a.impact, a.caption, a.title, a.loop)
        return
    render(data, a.out or f"{base}_{a.preset}_{a.aspect}.mp4", a.preset, a.aspect, a.mirror,
           a.speed, a.impact, a.caption, a.title, a.loop)


if __name__ == "__main__":
    main()
