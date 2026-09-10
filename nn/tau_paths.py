"""Per-machine file names shared with nn/machine-id.js.

The rating summary is named per machine (elo-summary-<machine>.json) because two trainers on one
branch used to rewrite the single shared name and wedge each other's pulls; see machine-id.js for
the whole story. The Python trainers only READ it (Elo-weighted rows), and they used to default to
the shared name -- which after that change is a stale file nothing writes any more. This resolves
the same way summaryPath does there: this machine's summary if it exists, else the old shared file
so history stays readable. The machine id is taken from nn/.machine-id, which machine-id.js writes
on first use (TAU_MACHINE overrides it, sanitised the same way); a clone with neither simply falls
back to the shared file rather than guessing an identity the JS side might not agree with.
"""
import os
import re


def _sanitize(s):
    s = re.sub(r'[^a-z0-9._-]+', '-', str(s or '').strip().lower())
    return re.sub(r'^[-.]+|[-.]+$', '', s)[:40]


def machine_id(nn_dir):
    env = _sanitize(os.environ.get('TAU_MACHINE', ''))
    if env:
        return env
    try:
        with open(os.path.join(nn_dir, '.machine-id'), encoding='utf-8') as f:
            return _sanitize(f.read())
    except OSError:
        return ''


def elo_summary_path(nn_dir):
    mid = machine_id(nn_dir)
    mine = os.path.join(nn_dir, 'elo-summary-%s.json' % mid) if mid else None
    if mine and os.path.exists(mine):
        return mine
    return os.path.join(nn_dir, 'elo-summary.json')
