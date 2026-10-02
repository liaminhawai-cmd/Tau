"""Recheck the continuous cover and compose it with shared rule legality.

Each leaf is replayed once and compared against its complete propagation hash.
Independent 80-digit trajectories at its endpoints and midpoint then check
every substep's containment. Finite samples supplement the interval argument.
"""
import argparse
import copy
import hashlib
import json
import platform
import subprocess
import time
from concurrent.futures import ProcessPoolExecutor, wait, FIRST_COMPLETED
from decimal import Decimal as D
from pathlib import Path
import arm1_crossing as c
import decimal_reply as d
from cover_arm1_reply import record, sources
from check_reply_cover import structural
from reply_zonotope import run

HERE = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def check_leaf(row):
    lo, hi = row['defenderDomainDeg']
    assert 0 <= lo < hi <= 18  # Within the original attacker-fixed family.
    enclosure = run(lo, hi)
    actual = record(enclosure)
    assert actual == row, ('propagation differs', [lo, hi])
    assert len(enclosure['log']) == 123
    initial = c.p.f.pose_at(1, -1, lo, hi)
    final = [c.V(*v) for v in row['lastBox']]
    displacement = c.p.f.norm([final[i]-initial[i] for i in range(2)])
    assert displacement.lo > c.PARAMS['koEps']
    initial_radii = [c.p.f.norm(foot).bounds() for foot in c.feet(initial)]
    assert max(r[1] for r in initial_radii) < c.EDGE.lo
    final_radii = [c.p.f.norm(foot).bounds() for foot in c.feet(final)]
    throw_margin = (c.V(max(r[0] for r in final_radii))-c.EDGE).lo
    assert throw_margin > 0
    samples = []
    for angle in [lo, (lo+hi)/2, hi]:
        assert lo <= angle <= hi
        point = d.trace(angle)
        assert len(point['steps']) == 123
        checks = 0
        for k, (bounds, step) in enumerate(zip(enclosure['log'], point['steps']), 1):
            assert bounds['step'] == step['step'] == k
            assert len(step['pose']) == 3
            for i in range(3):
                a, b = map(D.from_float, bounds['box'][i])
                value = D(step['pose'][i])
                assert value.is_finite() and a <= value <= b, ('Decimal containment failure', angle, k, i)
                checks += 1
        samples.append({'angle': angle, 'coordinateChecks': checks,
            'trajectorySha256': digest(point), 'finalPose': point['steps'][-1]['pose'],
            'contactCounts': point['contactCounts']})
    return {'domainDeg': [lo, hi], 'inputRowSha256': digest(row),
        'canonicalPropagationSha256': actual['propagationSha256'],
        'initialDefenderRadii': initial_radii, 'finalDefenderRadiiFromPoseBox': final_radii,
        'throwMarginLowerFromPoseBox': throw_margin,
        'koHubDisplacementLower': displacement.lo, 'samples': samples}


def rejections(data, results):
    controls = 0
    bad = copy.deepcopy(data)
    bad['leaves'].pop(len(bad['leaves'])//2)
    try:
        validate_cover(bad)
    except AssertionError:
        controls += 1
    else:
        raise AssertionError('missing internal leaf accepted')
    bad = copy.deepcopy(data)
    bad['marginLower'] = (bad['marginLower'] or 0)+1
    try:
        validate_cover(bad)
    except AssertionError:
        controls += 1
    else:
        raise AssertionError('inflated margin accepted')
    # Compare to the already re-executed canonical result; no second long run
    # is needed to show that a forged propagation digest differs from it.
    bad = copy.deepcopy(data['leaves'][0])
    bad['propagationSha256'] = '0'*64
    try:
        assert bad['propagationSha256'] == results[0]['canonicalPropagationSha256']
    except AssertionError:
        controls += 1
    else:
        raise AssertionError('forged propagation digest accepted')
    return controls


def partial_partition(data):
    """Every unproved interval must still be explicitly pending or unresolved."""
    intervals = sorted([r['defenderDomainDeg'] for r in data['leaves']]+data['pending']+data['unresolved'])
    assert intervals and intervals[0][0] == data['domainDeg'][0]
    assert intervals[-1][1] == data['domainDeg'][1]
    assert all(a < b for a, b in intervals)
    assert all(a[1] == b[0] for a, b in zip(intervals, intervals[1:]))


def validate_cover(data):
    assert data['sourceHashes'] == sources()
    partial_partition(data)
    if data['complete']:
        structural(data)
    else:
        assert data['pending'] or data['unresolved']
        assert data['marginLower'] is None
        assert all(r['completedSubsteps'] == 123 and r['failure'] is None
            and r['finalMarginLower'] > 0 for r in data['leaves'])


def components(intervals):
    out = []
    for a, b in sorted(intervals):
        if out and out[-1][1] == a:
            out[-1][1] = b
        else:
            out.append([a, b])
    return out


def verify(filename, output, workers, follow=False, partial=False, resume=False):
    data = json.loads(filename.read_text())
    expected_sources = sources()
    expected_domain = data['domainDeg']
    assert data['sourceHashes'] == expected_sources
    validate_cover(data)
    assert data['complete'] or follow or partial, 'cover incomplete; use --partial or --follow'
    geometry = json.loads((HERE/'arm1-crossing.json').read_text())
    assert c.certify() == geometry
    subprocess.run(['node', str(HERE/'check_arm1_crossing.js')], check=True, capture_output=True, text=True)
    crossing = json.loads((HERE/'arm1-crossing-validation.json').read_text())
    assert crossing['acceptedSubsteps'] == 123 and crossing['finalCrossings'] == 1
    fixed_artifacts = {p.name: c.sha(p) for p in (
        HERE/'arm1-crossing.json', HERE/'arm1-crossing-validation.json',
        HERE/'decimal_reply.py', Path(__file__))}
    results, resumed = {}, None
    if resume and output.exists():
        previous_bytes = output.read_bytes()
        previous = json.loads(previous_bytes)
        assert previous['sourceHashes'] == expected_sources
        assert previous['domainDeg'] == expected_domain
        assert all(previous['artifactSha256'][name] == value for name, value in fixed_artifacts.items())
        rows = {tuple(r['defenderDomainDeg']): r for r in data['leaves']}
        for result in previous['leaves']:
            key = tuple(result['domainDeg'])
            assert key in rows and digest(rows[key]) == result['inputRowSha256']
            assert result['canonicalPropagationSha256'] == rows[key]['propagationSha256']
            assert key not in results
            results[key] = result
        resumed = {'sha256': hashlib.sha256(previous_bytes).hexdigest(), 'leaves': len(results)}
    reused = len(results)

    def save_report(snapshot_bytes, final=False):
        snapshot = json.loads(snapshot_bytes)
        checked = sorted(results.values(), key=lambda r: r['domainDeg'][0])
        remaining = [r['defenderDomainDeg'] for r in snapshot['leaves']
            if tuple(r['defenderDomainDeg']) not in results]
        controls = rejections(snapshot, checked) if checked else 0
        report = {
            'scope': 'Continuous real-model contact enclosures on verified components only, with shared source-rule legality and per-leaf stopping/ko composition. Decimal samples are consistency checks. No uniform floating-engine correspondence.',
            'python': platform.python_version(), 'node': crossing['node'],
            'domainDeg': snapshot['domainDeg'], 'leavesReplayed': len(checked),
            'leavesReplayedThisInvocation': len(checked)-reused, 'resumedFrom': resumed,
            'substepsPerLeaf': 123,
            'complete': snapshot['complete'] and not remaining,
            'verificationComplete': not remaining,
            'invocationFinished': final,
            'verifiedComponentsDeg': components([r['domainDeg'] for r in checked]),
            'pending': snapshot['pending'], 'unresolved': snapshot['unresolved'],
            'unverifiedAcceptedIntervals': remaining,
            'minimumThrowMarginFromPoseBox': min((r['throwMarginLowerFromPoseBox'] for r in checked), default=None),
            'minimumKoHubDisplacement': min((r['koHubDisplacementLower'] for r in checked), default=None),
            'decimalPrecision': d.getcontext().prec,
            'decimalTrajectoryCases': sum(len(r['samples']) for r in checked),
            'distinctSampleAngles': len({s['angle'] for r in checked for s in r['samples']}),
            'decimalCoordinateChecks': sum(s['coordinateChecks'] for r in checked for s in r['samples']),
            'decimalFailures': 0, 'rejectionControlsPassed': controls,
            'sourceHashes': expected_sources,
            'artifactSha256': {filename.name: hashlib.sha256(snapshot_bytes).hexdigest(), **fixed_artifacts},
            'leaves': checked,
        }
        temporary = output.with_suffix('.tmp')
        temporary.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
        temporary.replace(output)
        return report

    with ProcessPoolExecutor(max_workers=workers) as pool:
        active = {}
        while True:
            snapshot_bytes = filename.read_bytes()
            data = json.loads(snapshot_bytes)
            assert data['sourceHashes'] == expected_sources and data['domainDeg'] == expected_domain
            validate_cover(data)
            assigned = set(active.values()) | set(results)
            for row in data['leaves']:
                key = tuple(row['defenderDomainDeg'])
                if key in results:
                    assert results[key]['canonicalPropagationSha256'] == row['propagationSha256']
                    assert results[key]['inputRowSha256'] == digest(row)
                if key not in assigned and len(active) < workers:
                    active[pool.submit(check_leaf, row)] = key
                    assigned.add(key)
            if not active:
                if data['complete'] or not follow or not data['pending'] or data['attempts'] >= data['attemptLimit']:
                    break
                time.sleep(2)
                continue
            finished, _ = wait(active, timeout=2, return_when=FIRST_COMPLETED)
            for future in finished:
                key = active.pop(future)
                result = future.result()
                results[key] = result
                print('verified', result['domainDeg'], 'margin', result['throwMarginLowerFromPoseBox'],
                      'Decimal coordinates', sum(s['coordinateChecks'] for s in result['samples']), flush=True)
                save_report(snapshot_bytes)
    assert sources() == expected_sources
    assert len(results) == len(data['leaves'])
    assert all(c.sha(HERE/name) == value for name, value in fixed_artifacts.items())
    report = save_report(snapshot_bytes, final=True)
    print(json.dumps({k: v for k, v in report.items() if k not in ('leaves', 'artifactSha256', 'sourceHashes')}, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', default='arm1-expanded-reply-cover.json')
    parser.add_argument('--output', default='arm1-expanded-validation.json')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--follow', action='store_true', help='verify accepted leaves while the generator continues')
    parser.add_argument('--partial', action='store_true', help='report verified components and preserve every gap explicitly')
    parser.add_argument('--resume', action='store_true', help='reuse this output checkpoint after checking source and per-input hashes; omit for a fresh replay')
    args = parser.parse_args()
    report = verify(HERE/args.input, HERE/args.output, args.workers, args.follow, args.partial, args.resume)
    if not report['complete'] and not args.partial:
        raise SystemExit('Partial verification saved; requested domain still has uncovered intervals.')
