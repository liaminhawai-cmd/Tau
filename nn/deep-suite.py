#!/usr/bin/env python3
"""Run four deep experiments sequentially with one parent and corpus snapshot.

python nn/deep-suite.py                    # ~4M models, all stable data, one GPU job at a time
python nn/deep-suite.py --styles residual,wispy --rounds 3
Remaining arguments are forwarded to grow-train.py (e.g. --shardMB 512 --device cpu).
Suite logs and the copied parent live under nn/grow-cache/deep-suite-*/.
"""
import argparse, datetime, glob, json, os, shutil, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
STYLES = ('plain', 'residual', 'bridges', 'wispy')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--from', dest='parent', default=os.path.join(HERE, 'models', 'best.json'))
    ap.add_argument('--width', type=int, default=400)
    ap.add_argument('--depth', type=int, default=22)
    ap.add_argument('--plainDepth', type=int, default=26, help='plain needs 26 layers to reach about 4M without packet weights')
    ap.add_argument('--styles', default=','.join(STYLES))
    ap.add_argument('--data', default=os.path.join(HERE, 'data', '*.jsonl'))
    ap.add_argument('--batch', type=int, default=1024, help='conservative default for a GTX 1080 alongside the trainer')
    args, extra = ap.parse_known_args()
    for option in ('--deepStyle', '--fileList', '--out'):
        if any(value == option or value.startswith(option+'=') for value in extra):
            ap.error(f'{option} is controlled by the suite')
    styles = args.styles.split(',')
    if not styles or len(set(styles)) != len(styles) or any(style not in STYLES for style in styles):
        ap.error('--styles must be a comma-separated, unique subset of '+','.join(STYLES))
    # Preflight before spending hours on a job.
    try:
        import torch, numpy
    except ImportError as error:
        ap.error(f'PyTorch and numpy are required: {error}')
    if not shutil.which('node'):
        ap.error('node is required for export verification')
    with open(args.parent, encoding='utf-8') as fh:
        parent_doc = json.load(fh)
    if args.depth <= len(parent_doc['sizes']) - 2 or args.width < max(parent_doc['sizes'][1:-1]):
        ap.error('depth must exceed parent depth and width must cover the widest parent layer')
    now = time.time()
    files = sorted(os.path.abspath(path) for path in glob.glob(args.data)
                   if os.path.getmtime(path) < now - 120)
    if not files:
        ap.error('no stable data files found (files modified in the last two minutes are excluded)')
    run = os.path.join(HERE, 'grow-cache', 'deep-suite-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+str(os.getpid()))
    os.makedirs(run)
    parent = os.path.join(run, 'best.json')
    shutil.copy2(args.parent, parent)  # preserves original mtime for the holdout rule
    # Copy bytes, not hardlinks: retromine/league may append or replace source files.
    # Keep original creation times separately, because Windows gives copied files new birth times.
    data_dir = os.path.join(run, 'data')
    os.makedirs(data_dir)
    required = sum(os.path.getsize(path) for path in files)
    if shutil.disk_usage(run).free < required + (512 << 20):
        raise SystemExit(f'Corpus snapshot needs {required/(1<<30):.1f} GiB plus 512 MiB spare disk space; no jobs started.')
    frozen, born = [], {}
    print(f'Copying a stable corpus snapshot ({required/(1<<30):.1f} GiB extra disk space)...', flush=True)
    for index, path in enumerate(files, 1):
        target = os.path.join(data_dir, os.path.basename(path))
        copied = False
        for attempt in range(3):
            try:
                before = os.stat(path)
                creation = getattr(before, 'st_birthtime', None)
                if creation is None:
                    creation = before.st_ctime if os.name == 'nt' else before.st_mtime
                shutil.copy2(path, target)
                after = os.stat(path)
                if (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns):
                    frozen.append(target); born[target] = creation; copied = True
                    break
            except FileNotFoundError:
                pass
        if not copied:
            if os.path.exists(target):
                os.remove(target)
            print('Skipping a file that kept changing: '+os.path.basename(path), flush=True)
        if index % 1000 == 0:
            print(f'Corpus snapshot: {index}/{len(files)} files', flush=True)
    if not frozen:
        raise SystemExit('No stable files could be copied; no jobs started.')
    manifest = os.path.join(run, 'files.json')
    with open(manifest, 'w', encoding='utf-8') as fh:
        json.dump({'files': frozen, 'createdAt': born}, fh)
    files = frozen
    if args.plainDepth <= len(parent_doc['sizes']) - 2:
        ap.error('plainDepth must exceed parent depth')
    print(f'Suite: {len(files)} stable files, one fixed parent, width {args.width}; plain depth {args.plainDepth}, residual depths {args.depth}.', flush=True)
    print(f'Requested jobs run SEQUENTIALLY. Logs and parent snapshot: {run}', flush=True)
    for style in styles:
        cmd = [sys.executable, '-u', os.path.join(HERE, 'grow-train.py'), '--from', parent,
               '--deepStyle', style, '--width', str(args.width), '--depth', str(args.plainDepth if style == 'plain' else args.depth),
               '--batch', str(args.batch), '--fileList', manifest] + extra
        print('\nStarting '+style, flush=True)
        with open(os.path.join(run, style+'.log'), 'w', encoding='utf-8') as log:
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True, encoding='utf-8', errors='replace')
            try:
                for line in process.stdout:
                    print(line, end='', flush=True); log.write(line); log.flush()
                code = process.wait()
            except KeyboardInterrupt:
                process.terminate(); process.wait()
                raise SystemExit('Suite interrupted; verified completed models remain, partials stay out of the league.')
        if code:
            raise SystemExit(f'{style} failed (exit {code}); suite stopped. See {run}. Completed verified models remain in the pool.')
    print('\nAll requested experiments verified and exported. The usual league, gate and retirement rules decide their future.', flush=True)


if __name__ == '__main__':
    main()
