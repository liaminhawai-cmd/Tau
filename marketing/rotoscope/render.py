"""Render corrected skeletons as a stylised Tau-coloured video.

Usage:
    python render.py fight.corrected.json               # -> fight_tau.mp4
    python render.py fight.corrected.json --smooth 3    # light smoothing (frames)
    python render.py fight.corrected.json --width 1080 --height 1920   # phone framing

Accepts a .corrected.json from the editor (or a raw .pose.json from detect.py).
"""
import argparse
import json
import os

import cv2
import numpy as np

BG = (17, 14, 12)                          # #0c0e11 in BGR
COLORS = [(107, 107, 255), (255, 158, 107)]  # red #ff6b6b, blue #6b9eff in BGR
BONES = [
    ("l_shoulder", "r_shoulder"), ("l_hip", "r_hip"), ("l_shoulder", "l_hip"), ("r_shoulder", "r_hip"),
    ("l_shoulder", "l_elbow"), ("l_elbow", "l_wrist"), ("r_shoulder", "r_elbow"), ("r_elbow", "r_wrist"),
    ("l_hip", "l_knee"), ("l_knee", "l_ankle"), ("r_hip", "r_knee"), ("r_knee", "r_ankle"),
    ("l_ankle", "l_heel"), ("l_heel", "l_toe"), ("l_ankle", "l_toe"),
    ("r_ankle", "r_heel"), ("r_heel", "r_toe"), ("r_ankle", "r_toe"),
]


def smooth(frames, people, nj, radius):
    """Centred moving average per joint; skips missing points."""
    if radius <= 0:
        return frames
    out = []
    for f in range(len(frames)):
        fr = []
        for p in range(people):
            if frames[f][p] is None:
                fr.append(None)
                continue
            pts = []
            for j in range(nj):
                acc = [frames[g][p][j] for g in range(max(0, f - radius), min(len(frames), f + radius + 1))
                       if frames[g][p] is not None and frames[g][p][j] is not None]
                pts.append([sum(a[0] for a in acc) / len(acc), sum(a[1] for a in acc) / len(acc)]
                           if frames[f][p][j] is not None and acc else None)
            fr.append(pts)
        out.append(fr)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("json")
    ap.add_argument("--out")
    ap.add_argument("--smooth", type=int, default=1, help="smoothing radius in frames (0 = off)")
    ap.add_argument("--width", type=int)
    ap.add_argument("--height", type=int)
    args = ap.parse_args()

    data = json.load(open(args.json))
    if data["frames"] and isinstance(data["frames"][0], dict):
        # A raw detect.py file (every tracked person): keep just the two auto-picked fighters.
        ids = data.get("fighters", ["0", "1"])
        data["frames"] = [[fr.get(i) if i else None for i in ids] for fr in data["frames"]]
    J = {n: i for i, n in enumerate(data["joints"])}
    src_w, src_h = data["width"], data["height"]
    W, H = args.width or src_w, args.height or src_h
    # Fit the source frame inside the output frame, centred.
    s = min(W / src_w, H / src_h)
    ox, oy = (W - src_w * s) / 2, (H - src_h * s) / 2
    frames = smooth(data["frames"], data["people"], len(J), args.smooth)

    out = args.out or os.path.splitext(args.json)[0].replace(".corrected", "").replace(".pose", "") + "_tau.mp4"
    vw = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"mp4v"), data["fps"], (W, H))
    lw = max(2, int(10 * s * src_h / 720))

    def px(q):
        return int(ox + q[0] * src_w * s), int(oy + q[1] * src_h * s)

    for fr in frames:
        img = np.full((H, W, 3), BG, np.uint8)
        for p, sk in enumerate(fr):
            if sk is None:
                continue
            c = COLORS[p % 2]
            for a, b in BONES:
                qa, qb = sk[J[a]], sk[J[b]]
                if qa and qb:
                    cv2.line(img, px(qa), px(qb), c, lw, cv2.LINE_AA)
            n, ls, rs = sk[J["nose"]], sk[J["l_shoulder"]], sk[J["r_shoulder"]]
            if n:
                r = int(np.hypot((ls[0] - rs[0]) * src_w, (ls[1] - rs[1]) * src_h) * 0.3 * s) if ls and rs else lw * 2
                cv2.circle(img, px(n), max(r, lw), c, -1, cv2.LINE_AA)
        vw.write(img)
    vw.release()
    print(f"Saved {out}")


if __name__ == "__main__":
    main()
