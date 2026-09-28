"""Detect two fighters' skeletons in a video clip and save them for the editor.

Usage:
    python detect.py fight.mp4            # writes fight.pose.json next to the clip
    python detect.py fight.mp4 --start 12 --end 18   # only 0:12 to 0:18
    python detect.py fight.mp4 --people 1 # single-person clip

The first run downloads MediaPipe's pose model (~30 MB for heavy) into this folder.
"""
import argparse
import json
import os
import sys
import itertools
import urllib.request

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
             "pose_landmarker_{0}/float16/latest/pose_landmarker_{0}.task")

# Subset of MediaPipe's 33 landmarks that we keep (face detail is dropped).
JOINTS = {
    "nose": 0,
    "l_shoulder": 11, "r_shoulder": 12,
    "l_elbow": 13, "r_elbow": 14,
    "l_wrist": 15, "r_wrist": 16,
    "l_hip": 23, "r_hip": 24,
    "l_knee": 25, "r_knee": 26,
    "l_ankle": 27, "r_ankle": 28,
    "l_heel": 29, "r_heel": 30,
    "l_toe": 31, "r_toe": 32,
}
NAMES = list(JOINTS)


def ensure_model(name):
    path = os.path.join(HERE, f"pose_landmarker_{name}.task")
    if not os.path.exists(path):
        print(f"Downloading the {name} pose model (one time only)...")
        urllib.request.urlretrieve(MODEL_URL.format(name), path)
    return path


def centroid(pose):
    pts = [p for p in pose if p is not None]
    if not pts:
        return None
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def pose_dist(a, b):
    """Mean joint distance between two poses (joints present in both)."""
    d, n = 0.0, 0
    for p, q in zip(a, b):
        if p is not None and q is not None:
            d += ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** 0.5
            n += 1
    return d / n if n else float("inf")


def assign(tracks, detections, people):
    """Match detections to tracks so identities stay stable frame to frame."""
    out = [None] * people
    if not detections:
        return out
    known = [i for i, t in enumerate(tracks) if t is not None]
    # Match detections to people we've already seen, by closest pose.
    best, best_cost = (), float("inf")
    k = min(len(detections), len(known))
    best_slots = ()
    for dets in itertools.permutations(range(len(detections)), k):
        for slots in itertools.permutations(known, k):
            cost = sum(pose_dist(detections[d], tracks[s]) for d, s in zip(dets, slots))
            if cost < best_cost:
                best, best_slots, best_cost = dets, slots, cost
    for d, s in zip(best, best_slots):
        out[s] = detections[d]
    # New people: red (0) takes the left of the screen, blue (1) the right.
    for d in sorted(set(range(len(detections))) - set(best), key=lambda d: centroid(detections[d])[0]):
        free = [s for s in range(people) if tracks[s] is None and out[s] is None]
        if not free:
            break
        side = 0 if centroid(detections[d])[0] < 0.5 else people - 1
        out[side if side in free else free[0]] = detections[d]
    return out


def timestamp(text):
    """Seconds from '83', '83.5', '1:23' or '0:01:23'."""
    secs = 0.0
    for part in str(text).strip().split(":"):
        secs = secs * 60 + float(part)
    return secs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--people", type=int, default=2)
    ap.add_argument("--out", help="output JSON path (default: <video>.pose.json)")
    ap.add_argument("--start", type=timestamp, default=0, help="start time, e.g. 83 or 1:23")
    ap.add_argument("--end", type=timestamp, help="end time (default: end of video)")
    ap.add_argument("--model", choices=["heavy", "full", "lite"], default="heavy",
                    help="heavy is slowest and most accurate (default)")
    args = ap.parse_args()

    model_path = ensure_model(args.model)
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

    options = vision.PoseLandmarkerOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=args.people,
        min_pose_detection_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    frames = []
    tracks = [None] * args.people
    with vision.PoseLandmarker.create_from_options(options) as lm:
        i = 0
        while i < total:
            ok, img = cap.read()
            if not ok:
                break
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb),
                                      int(i * 1000 / fps))
            dets = []
            for pose in res.pose_landmarks:
                dets.append([
                    [round(pose[k].x, 5), round(pose[k].y, 5)] if pose[k].visibility > 0.2 else None
                    for k in JOINTS.values()
                ])
            people = assign(tracks, dets, args.people)
            for p, pose in enumerate(people):
                if pose is not None:
                    tracks[p] = pose
            frames.append(people)
            i += 1
            if i % 30 == 0:
                print(f"\r{i}/{total} frames", end="", flush=True)
    print(f"\r{i}/{total} frames")

    out = args.out or os.path.splitext(args.video)[0] + ".pose.json"
    with open(out, "w") as f:
        json.dump({"version": 1, "video": os.path.basename(args.video), "fps": fps,
                   "start_frame": start, "width": w, "height": h, "people": args.people,
                   "joints": NAMES, "frames": frames}, f, separators=(",", ":"))
    missing = sum(1 for fr in frames for p in fr if p is None)
    print(f"Saved {out} ({len(frames)} frames, {missing} person-frames not detected)")


if __name__ == "__main__":
    main()
