"""Put a stick-figure throw next to a Tau clip, then add an end card.

Usage:
    python compose.py throw.mp4 tau.mp4                       # phone: throw on top, Tau below
    python compose.py throw.mp4 tau.mp4 --layout side         # widescreen, side by side
    python compose.py throw.mp4 tau.mp4 --layout cut          # throw, then Tau, full screen each
    python compose.py throw.mp4 tau.mp4 --top "Sumo" --bottom "Tau" --end "Beat level 13. Win a steel set."

The Tau clip is any screen recording: Director mode (tau-game.com/#director, Hide UI on) or the
Cinematic Studio both work. Use --tau-start / --tau-len (seconds) to pick the part you want.
Audio isn't carried over; add music in whatever app you post from.
"""
import argparse
import os

import cv2
import numpy as np

BG = (17, 14, 12)
INK = (230, 230, 230)
DIM = (150, 160, 170)
SIZES = {"stack": (1080, 1920), "side": (1920, 1080), "cut": (1080, 1920)}
HERE = os.path.dirname(os.path.abspath(__file__))


def frames(path, start=0.0, length=None):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    out = []
    while True:
        ok, f = cap.read()
        if not ok or (length and len(out) >= length * fps):
            break
        out.append(f)
    return out, fps


def fit(img, w, h):
    """Scale to fit inside w x h, centred on the background colour."""
    ih, iw = img.shape[:2]
    s = min(w / iw, h / ih)
    r = cv2.resize(img, (max(1, int(iw * s)), max(1, int(ih * s))), interpolation=cv2.INTER_AREA)
    canvas = np.full((h, w, 3), BG, np.uint8)
    y, x = (h - r.shape[0]) // 2, (w - r.shape[1]) // 2
    canvas[y:y + r.shape[0], x:x + r.shape[1]] = r
    return canvas


def label(img, s, x, y, scale, col=INK, centre=True):
    if not s:
        return
    f = cv2.FONT_HERSHEY_DUPLEX
    sc = scale * img.shape[1] / 1080
    th = max(1, int(sc * 2))
    (tw, _), _ = cv2.getTextSize(s, f, sc, th)
    cv2.putText(img, s, (int(x - tw / 2) if centre else int(x), int(y)), f, sc, col, th, cv2.LINE_AA)


def resample(fr, src_fps, fps):
    n = int(len(fr) * fps / src_fps)
    return [fr[min(len(fr) - 1, int(i * src_fps / fps))] for i in range(n)]


def end_card(W, H, line, url, secs, fps):
    logo = cv2.imread(os.path.join(HERE, "logo.png"), cv2.IMREAD_UNCHANGED)
    out = []
    for i in range(int(secs * fps)):
        img = np.full((H, W, 3), BG, np.uint8)
        a = min(1.0, i / (fps * 0.4))
        if logo is not None:
            lw = int(W * 0.45)
            lg = cv2.resize(logo, (lw, int(logo.shape[0] * lw / logo.shape[1])), interpolation=cv2.INTER_AREA)
            y, x = int(H * 0.38) - lg.shape[0] // 2, (W - lw) // 2
            roi = img[y:y + lg.shape[0], x:x + lw]
            if lg.shape[2] == 4:
                al = lg[:, :, 3:4] / 255.0 * a
                roi[:] = (roi * (1 - al) + lg[:, :, :3] * al).astype(np.uint8)
            else:
                roi[:] = cv2.addWeighted(lg, a, roi, 1 - a, 0)
        else:
            label(img, "TAU", W / 2, H * 0.4, 3.0)
        label(img, line, W / 2, H * 0.55, 1.1)
        label(img, url, W / 2, H * 0.62, 0.9, DIM)
        out.append(img)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("throw")
    ap.add_argument("tau")
    ap.add_argument("--layout", default="stack", choices=SIZES)
    ap.add_argument("--top", default="", help="label over the throw")
    ap.add_argument("--bottom", default="", help="label over the Tau clip")
    ap.add_argument("--tau-start", type=float, default=0.0)
    ap.add_argument("--tau-len", type=float)
    ap.add_argument("--end", default="Free to play at tau-game.com", help="end card line ('' for none)")
    ap.add_argument("--url", default="tau-game.com")
    ap.add_argument("--end-secs", type=float, default=2.5)
    ap.add_argument("--out")
    a = ap.parse_args()

    W, H = SIZES[a.layout]
    fps = 30
    A, fa = frames(a.throw)
    B, fb = frames(a.tau, a.tau_start, a.tau_len)
    A, B = resample(A, fa, fps), resample(B, fb, fps)
    out = a.out or os.path.splitext(a.throw)[0] + f"_x_tau_{a.layout}.mp4"
    vw = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))

    if a.layout == "cut":
        for f in A:
            img = fit(f, W, H); label(img, a.top, W / 2, H * 0.08, 1.4); vw.write(img)
        for f in B:
            img = fit(f, W, H); label(img, a.bottom, W / 2, H * 0.08, 1.4); vw.write(img)
    else:
        n = max(len(A), len(B))
        for i in range(n):
            fa_, fb_ = A[min(i, len(A) - 1)], B[min(i, len(B) - 1)]
            img = np.full((H, W, 3), BG, np.uint8)
            if a.layout == "stack":
                img[:H // 2] = fit(fa_, W, H // 2)
                img[H // 2:] = fit(fb_, W, H // 2)
                cv2.line(img, (int(W * 0.1), H // 2), (int(W * 0.9), H // 2), (60, 60, 60), 2)
                label(img, a.top, W / 2, H * 0.05, 1.3)
                label(img, a.bottom, W / 2, H * 0.55, 1.3)
            else:
                img[:, :W // 2] = fit(fa_, W // 2, H)
                img[:, W // 2:] = fit(fb_, W // 2, H)
                cv2.line(img, (W // 2, int(H * 0.1)), (W // 2, int(H * 0.9)), (60, 60, 60), 2)
                label(img, a.top, W / 4, H * 0.1, 1.0)
                label(img, a.bottom, W * 3 / 4, H * 0.1, 1.0)
            vw.write(img)
    if a.end:
        for img in end_card(W, H, a.end, a.url, a.end_secs, fps):
            vw.write(img)
    vw.release()
    print("Saved", out)


if __name__ == "__main__":
    main()
