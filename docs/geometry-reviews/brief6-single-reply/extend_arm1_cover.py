"""Extend the checked local cover with resumable, independent process workers.

The enclosure kernel is unchanged. Every proposed angle interval must complete
all 123 substeps with a positive final margin, or it is split / left unresolved.
The pending list includes in-flight work, so interruption never erases a gap.
"""
import argparse
import hashlib
import json
import time
from concurrent.futures import ProcessPoolExecutor, wait, FIRST_COMPLETED
from decimal import Decimal
from pathlib import Path
from cover_arm1_reply import record, sources
from reply_zonotope import run
from check_reply_cover import structural

HERE = Path(__file__).resolve().parent
SEED = HERE/'arm1-local-reply-cover.json'


def attempt(domain):
    return record(run(*domain))


def checkpoint(out, filename):
    out['leaves'].sort(key=lambda r: r['defenderDomainDeg'][0])
    out['failedAttempts'].sort(key=lambda r: r['defenderDomainDeg'])
    out['pending'].sort()
    out['unresolved'].sort()
    out['complete'] = bool(out['leaves']) and not out['pending'] and not out['unresolved']
    out['marginLower'] = min(r['finalMarginLower'] for r in out['leaves']) if out['complete'] else None
    temp = filename.with_suffix('.tmp')
    temp.write_text(json.dumps(out, indent=2, allow_nan=False)+'\n')
    temp.replace(filename)


def extend(filename, upper=8.1, workers=4, max_attempts=64, minimum_width=1e-6):
    seed = json.loads(SEED.read_text())
    structural(seed)
    seed_hash = hashlib.sha256(SEED.read_bytes()).hexdigest()
    if filename.exists():
        out = json.loads(filename.read_text())
        assert out['sourceHashes'] == sources()
        assert out['seedArtifactSha256'] == seed_hash
        assert out['domainDeg'] == [seed['domainDeg'][0], upper]
        assert out['minimumWidth'] == minimum_width
    else:
        assert upper > seed['domainDeg'][1]
        pending = []
        a = seed['domainDeg'][1]
        while a < upper:
            b = min(upper, float(Decimal(str(a))+Decimal('0.01')))
            assert a < b
            pending.append([a, b])
            a = b
        out = {
            'scope': 'Continuous real contact-model cover for the prescribed shared attacker path. Rule and ko composition is checked separately; no floating-engine correspondence.',
            'domainDeg': [seed['domainDeg'][0], upper], 'sourceHashes': sources(),
            'seedArtifact': SEED.name, 'seedArtifactSha256': seed_hash,
            'seedLeaves': len(seed['leaves']), 'leaves': seed['leaves'],
            'failedAttempts': [], 'unresolved': [], 'pending': pending,
            'complete': False, 'minimumWidth': minimum_width, 'attempts': 0,
        }
    out['attemptLimit'] = max_attempts
    out['workers'] = workers
    out['coordinatorSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    checkpoint(out, filename)
    started = time.monotonic()
    previous_seconds = out.get('seconds', 0.)
    # reply_jet has per-pass globals; each process owns a separate interpreter.
    with ProcessPoolExecutor(max_workers=workers) as pool:
        active = {}
        while out['pending'] or active:
            assigned = {tuple(d) for d in active.values()}
            ready = [d for d in out['pending'] if tuple(d) not in assigned]
            while ready and len(active) < workers and out['attempts']+len(active) < max_attempts:
                domain = ready.pop(0)
                active[pool.submit(attempt, domain)] = domain
            if not active:
                break
            finished, _ = wait(active, return_when=FIRST_COMPLETED)
            for future in sorted(finished, key=lambda f: active[f]):
                a, b = active.pop(future)
                row = future.result()
                assert row['defenderDomainDeg'] == [a, b]
                out['pending'].remove([a, b])
                out['attempts'] += 1
                if row['failure'] is None and row['completedSubsteps'] == 123 and row['finalMarginLower'] > 0:
                    out['leaves'].append(row)
                    print('covered', [a, b], 'margin', row['finalMarginLower'], flush=True)
                else:
                    out['failedAttempts'].append(row)
                    middle = (a+b)/2
                    if b-a <= minimum_width or not a < middle < b:
                        out['unresolved'].append([a, b])
                        print('unresolved', [a, b], row['failure'], flush=True)
                    else:
                        out['pending'].extend([[a, middle], [middle, b]])
                        print('split', [a, b], row['failure'], flush=True)
                out['seconds'] = previous_seconds+time.monotonic()-started
                checkpoint(out, filename)
    if out['complete']:
        structural(out)
    print(json.dumps({k: out[k] for k in ('domainDeg', 'complete', 'attempts', 'marginLower', 'pending', 'unresolved', 'seconds')}, indent=2), flush=True)
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='arm1-expanded-reply-cover.json')
    parser.add_argument('--upper', type=float, default=8.1)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--attempts', type=int, default=64)
    args = parser.parse_args()
    result = extend(HERE/args.output, args.upper, args.workers, args.attempts)
    if not result['complete']:
        raise SystemExit(1)
