"""Find every person in a video clip, track them, and save their skeletons for the editor.

Usage:
    python detect.py fight.mp4                      # writes fight.pose.json next to the clip
    python detect.py fight.mp4 --start 1:23 --end 1:29

Uses YOLO pose (Ultralytics), which handles crowds and overlapping bodies. The two
people who fill the most of the frame are picked as the fighters (red on the left,
blue on the right); in the editor you can click anyone else to reassign.
The first run downloads the model (~50 MB) into this folder.
"""
import argparse
import json
import os
import sys

import cv2

HERE = os.path.dirname(os.path.abspath(__file__))

# Our joint names, and the COCO keypoint each comes from. YOLO has no heels or toes.
JOINTS = {
    "nose": 0,
    "l_shoulder": 5, "r_shoulder": 6,
    "l_elbow": 7, "r_elbow": 8,
    "l_wrist": 9, "r_wrist": 10,
    "l_hip": 11, "r_hip": 12,
    "l_knee": 13, "r_knee": 14,
    "l_ankle": 15, "r_ankle": 16,
    "l_heel": None, "r_heel": None,
    "l_toe": None, "r_toe": None,
}
NAMES = list(JOINTS)
MODELS = {"large": "yolo11l-pose.pt", "medium": "yolo11m-pose.pt", "small": "yolo11s-pose.pt"}


def timestamp(text):
    """Seconds from '83', '83.5', '1:23' or '0:01:23'."""
    secs = 0.0
    for part in str(text).strip().split(":"):
        secs = secs * 60 + float(part)
    return secs


def centre(box):
    return ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)


def pick_fighters(boxes, n_frames):
    """The two tracks that cover the most of the frame over the clip, plus an
    assignment list that re-attaches each fighter when the tracker loses them
    and starts a new ID (common when bodies overlap)."""
    size = {}
    for f in range(n_frames):
        for tid, b in boxes[f].items():
            size[tid] = size.get(tid, 0) + (b[2] - b[0]) * (b[3] - b[1])
    top = sorted(size, key=size.get, reverse=True)[:2]
    if not top:
        return [None, None], []
    if len(top) == 2:
        # Red takes whoever is further left when both are first on screen together.
        both = next((f for f in range(n_frames) if top[0] in boxes[f] and top[1] in boxes[f]), None)
        if both is not None and centre(boxes[both][top[0]])[0] > centre(boxes[both][top[1]])[0]:
            top.reverse()
    else:
        top.append(None)

    first = {}
    last = {}
    for f in range(n_frames):
        for tid in boxes[f]:
            first.setdefault(tid, f)
            last[tid] = f

    assign = []
    for p, tid in enumerate(top):
        cur, used = tid, set(top)
        while cur is not None:
            end = last[cur]
            if end >= n_frames - 1:
                break
            cx, cy = centre(boxes[end][cur])
            w = boxes[end][cur][2] - boxes[end][cur][0]
            # A new track that appears soon after, close to where this one vanished.
            best, best_d = None, None
            for cand, f0 in first.items():
                if cand in used or not (end < f0 <= end + 20):
                    continue
                qx, qy = centre(boxes[f0][cand])
                d = ((qx - cx) ** 2 + (qy - cy) ** 2) ** 0.5
                if d < max(w, 0.08) and (best_d is None or d < best_d):
                    best, best_d = cand, d
            if best is None:
                break
            assign.append({"f": first[best], "p": p, "id": str(best)})
            used.add(best)
            cur = best
    return [str(t) if t is not None else None for t in top], assign


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--out", help="output JSON path (default: <video>.pose.json)")
    ap.add_argument("--start", type=timestamp, default=0, help="start time, e.g. 83 or 1:23")
    ap.add_argument("--end", type=timestamp, help="end time (default: end of video)")
    ap.add_argument("--model", choices=list(MODELS), default="medium",
                    help="large is slower and a bit more accurate; small is quicker")
    args = ap.parse_args()
    args.video = os.path.abspath(args.video)
    if args.out:
        args.out = os.path.abspath(args.out)

    from ultralytics import YOLO  # imported late so --help works without it
    os.chdir(HERE)  # Ultralytics downloads the model into the working directory
    model = YOLO(MODELS[args.model])

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"Can't open {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    start = max(0, int(round(args.start * fps)))
    end = min(total, int(round(args.end * fps))) if args.end else total
    if end <= start:
        sys.exit("The end time has to be after the start time.")
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    total = end - start

    frames, boxes = [], []
    i = 0
    while i < total:
        ok, img = cap.read()
        if not ok:
            break
        res = model.track(img, persist=True, tracker="bytetrack.yaml", conf=0.25, verbose=False)[0]
        people, fboxes = {}, {}
        if res.boxes is not None and res.boxes.id is not None and res.keypoints is not None:
            ids = res.boxes.id.int().tolist()
            xyxyn = res.boxes.xyxyn.tolist()
            kxy = res.keypoints.xyn.tolist()
            kconf = res.keypoints.conf.tolist() if res.keypoints.conf is not None else None
            for n, tid in enumerate(ids):
                pose = []
                for k in JOINTS.values():
                    if k is None or (kconf and kconf[n][k] < 0.3):
                        pose.append(None)
                    else:
                        x, y = kxy[n][k]
                        pose.append([round(x, 5), round(y, 5)] if (x or y) else None)
                people[str(tid)] = pose
                fboxes[tid] = xyxyn[n]
        frames.append(people)
        boxes.append(fboxes)
        i += 1
        if i % 10 == 0:
            print(f"\r{i}/{total} frames", end="", flush=True)
    print(f"\r{i}/{total} frames")

    fighters, assign = pick_fighters(boxes, len(frames))
    out = args.out or os.path.splitext(os.path.abspath(args.video))[0] + ".pose.json"
    with open(out, "w") as f:
        json.dump({"version": 2, "engine": "yolo", "video": os.path.basename(args.video), "fps": fps,
                   "start_frame": start, "width": w, "height": h, "people": 2, "joints": NAMES,
                   "fighters": fighters, "edits": {"keyframes": {}, "swaps": [], "assign": assign},
                   "frames": frames}, f, separators=(",", ":"))
    seen = len({tid for fr in frames for tid in fr})
    print(f"Saved {out}: {len(frames)} frames, {seen} people tracked, "
          f"fighters picked automatically ({len(assign)} re-links after lost tracking)")


if __name__ == "__main__":
    main()
