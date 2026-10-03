"""Adaptive, checkpointed cover using the exhaustive branch enclosure.

Every candidate contact image is retained by the unchanged reply_branches
kernel. Failed interval bounds trigger subdivision, never branch pruning.
The accepted/pending/unresolved lists always partition the requested domain.
"""
import argparse
import hashlib
import json
import time
from concurrent.futures import ProcessPoolExecutor, wait, FIRST_COMPLETED
from decimal import Decimal
from pathlib import Path
import reply_branches as b

HERE = Path(__file__).resolve().parent


def partition(data):
    assert data['sourceHashes'] == b.source_hashes()
    rows = data['leaves']
    assert all(r['sourceHashes'] == data['sourceHashes'] and r['failure'] is None
        and r['completedSubsteps'] == 123 and r['minimumThrowMargin'] > 0 for r in rows)
    assert all(r['threshold'] == data['threshold'] and r['branchLimit'] == data['branchLimit'] for r in rows)
    intervals = sorted([r['domainDeg'] for r in rows]+data['pending']+data['unresolved'])
    assert intervals and intervals[0][0] == data['domainDeg'][0] and intervals[-1][1] == data['domainDeg'][1]
    assert all(a < e for a, e in intervals)
    assert all(a[1] == e[0] for a, e in zip(intervals, intervals[1:]))
    assert data['complete'] == (not data['pending'] and not data['unresolved'])
    assert data['marginLower'] == (min(r['minimumThrowMargin'] for r in rows) if data['complete'] else None)


def save(data, filename):
    data['leaves'].sort(key=lambda r: r['domainDeg'])
    data['failedAttempts'].sort(key=lambda r: r['domainDeg'])
    data['pending'].sort()
    data['unresolved'].sort()
    data['complete'] = not data['pending'] and not data['unresolved']
    data['marginLower'] = min(r['minimumThrowMargin'] for r in data['leaves']) if data['complete'] else None
    partition(data)
    temporary = filename.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, indent=2, allow_nan=False)+'\n')
    temporary.replace(filename)


def attempt(domain, threshold, limit):
    return b.record(b.run(*domain, threshold, limit))


def cover(filename, lo=9., hi=10., step=.02, workers=4, max_attempts=256,
          minimum_width=1e-6, threshold=1e-4, limit=32, seed_path=None):
    assert 0 <= lo < hi <= 18 and step > 0 and workers > 0
    seed_hash = hashlib.sha256(seed_path.read_bytes()).hexdigest() if seed_path else None
    if filename.exists():
        data = json.loads(filename.read_text())
        partition(data)
        assert data['domainDeg'] == [lo, hi] and data['initialStepDeg'] == step
        assert data['threshold'] == threshold and data['branchLimit'] == limit
        assert data['minimumWidth'] == minimum_width and data['seedArtifactSha256'] == seed_hash
    else:
        pending, a = [], lo
        while a < hi:
            e = min(hi, float(Decimal(str(a))+Decimal(str(step))))
            assert a < e
            pending.append([a, e])
            a = e
        data = {'scope': 'Continuous real-model proposal cover using exhaustive contact branches. Full replay and stopping/ko composition are required separately. No floating-engine correspondence.',
            'domainDeg': [lo, hi], 'sourceHashes': b.source_hashes(),
            'initialStepDeg': step, 'threshold': threshold, 'branchLimit': limit,
            'minimumWidth': minimum_width, 'leaves': [], 'pending': pending,
            'unresolved': [], 'failedAttempts': [], 'attempts': 0, 'seconds': 0.,
            'seedArtifact': seed_path.name if seed_path else None,
            'seedArtifactSha256': seed_hash, 'seedLeaves': 0}
        if seed_path:
            for proposal in json.loads(seed_path.read_text())['proposals']:
                row = proposal['record']
                assert row['sourceHashes'] == data['sourceHashes']
                assert row['failure'] is None and row['completedSubsteps'] == 123 and row['minimumThrowMargin'] > 0
                assert row['domainDeg'] in data['pending']
                data['pending'].remove(row['domainDeg'])
                data['leaves'].append(row)
                data['seedLeaves'] += 1
    data['attemptLimit'], data['workers'] = max_attempts, workers
    data['coordinatorSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    save(data, filename)
    started, elapsed = time.monotonic(), data['seconds']
    with ProcessPoolExecutor(max_workers=workers) as pool:
        active = {}
        while data['pending'] or active:
            assigned = {tuple(d) for d in active.values()}
            ready = [d for d in data['pending'] if tuple(d) not in assigned]
            while ready and len(active) < workers and data['attempts']+len(active) < max_attempts:
                domain = ready.pop(0)
                active[pool.submit(attempt, domain, threshold, limit)] = domain
            if not active:
                break
            finished, _ = wait(active, return_when=FIRST_COMPLETED)
            for future in sorted(finished, key=lambda f: active[f]):
                domain = active.pop(future)
                row = future.result()
                assert row['domainDeg'] == domain
                data['pending'].remove(domain)
                data['attempts'] += 1
                if row['failure'] is None and row['completedSubsteps'] == 123 and row['minimumThrowMargin'] > 0:
                    data['leaves'].append(row)
                    print('covered', domain, 'branches', len(row['finalBranches']), 'margin', row['minimumThrowMargin'], flush=True)
                else:
                    data['failedAttempts'].append(row)
                    a, e = domain
                    middle = (a+e)/2
                    if e-a <= minimum_width or not a < middle < e:
                        data['unresolved'].append(domain)
                        print('unresolved', domain, row['failure'], flush=True)
                    else:
                        data['pending'].extend([[a, middle], [middle, e]])
                        print('split', domain, row['failure'], flush=True)
                data['seconds'] = elapsed+time.monotonic()-started
                save(data, filename)
    print(json.dumps({k: data[k] for k in ('domainDeg', 'complete', 'attempts', 'marginLower', 'pending', 'unresolved', 'seconds')}, indent=2))
    return data


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lo', type=float, default=9.)
    parser.add_argument('--hi', type=float, default=10.)
    parser.add_argument('--step', type=float, default=.02)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--attempts', type=int, default=256)
    parser.add_argument('--output', default='arm1-nine-ten-cover.json')
    parser.add_argument('--seed', default='arm1-nine-ten-probes.json')
    args = parser.parse_args()
    result = cover(HERE/args.output, args.lo, args.hi, args.step, args.workers, args.attempts,
                   seed_path=HERE/args.seed if args.seed else None)
    if not result['complete']:
        raise SystemExit(1)
