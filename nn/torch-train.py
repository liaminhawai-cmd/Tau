#!/usr/bin/env python3
"""Safety wrapper around torch-train-core.py.

menu.bat option 39 historically wrote every PyTorch value net to one generic
`torch-<PC>.json` filename. Training a second shape therefore replaced the first.
This wrapper keeps the menu contract intact, but archives the existing generic
model by its actual hidden shape before training and, after a successful run,
keeps a shape-named copy of the new model as well.
"""
import datetime
import json
import os
import shutil
import socket
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.join(HERE, 'torch-train-core.py')


def arg(name, default=None):
    try:
        return sys.argv[sys.argv.index(name) + 1]
    except (ValueError, IndexError):
        return default


def hidden_tag(model_path):
    try:
        with open(model_path, 'r', encoding='utf-8') as fh:
            j = json.load(fh)
        sizes = j.get('sizes')
        if not isinstance(sizes, list) or len(sizes) < 3:
            return None
        return 'x'.join(str(x) for x in sizes[1:-1])
    except Exception:
        return None


def version_existing(path):
    if not os.path.exists(path):
        return
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    root, ext = os.path.splitext(path)
    backup = f'{root}-old-{stamp}{ext}'
    shutil.copy2(path, backup)
    print(f'preserved previous shape copy -> {backup}')


host = os.environ.get('COMPUTERNAME') or socket.gethostname()
default_out = os.path.join(HERE, 'models', f'torch-{host}.json')
out = os.path.abspath(arg('--out', default_out))
base = os.path.basename(out).lower()
generic_names = {f'torch-{host}.json'.lower(), 'torch.json'}
is_generic = base in generic_names

if is_generic and os.path.exists(out):
    old_tag = hidden_tag(out)
    if old_tag:
        old_named = os.path.join(os.path.dirname(out), f'torch-{old_tag}-{host}.json')
        if os.path.abspath(old_named) != out:
            if os.path.exists(old_named):
                version_existing(old_named)
            shutil.copy2(out, old_named)
            print(f'preserved existing Torch {old_tag} -> {old_named}')
    else:
        print(f'warning: could not read existing model shape from {out}; leaving it in place until core save')

rc = subprocess.call([sys.executable, CORE, *sys.argv[1:]])
if rc:
    raise SystemExit(rc)

if is_generic and os.path.exists(out):
    new_tag = hidden_tag(out)
    if new_tag:
        new_named = os.path.join(os.path.dirname(out), f'torch-{new_tag}-{host}.json')
        if os.path.abspath(new_named) != out:
            if os.path.exists(new_named):
                version_existing(new_named)
            shutil.copy2(out, new_named)
            print(f'shape-safe copy -> {new_named}')

raise SystemExit(0)
