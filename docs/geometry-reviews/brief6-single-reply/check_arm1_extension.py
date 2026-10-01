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
    return {'domainDeg': [lo, hi], 'canonicalPropagationSha256': actual['propagationSha256'],
        'initialDefenderRadii': initial_radii, 'finalDefenderRadiiFromPoseBox': final_radii,
        'throwMarginLowerFromPoseBox': throw_margin,
        'koHubDisplacementLower': displacement.lo, 'samples': samples}


def rejections(data, results):
    controls = 0
    bad = copy.deepcopy(data)
    bad['leaves'].pop(len(bad['leaves'])//2)
    try:
        structural(bad)
    except AssertionError:
        controls += 1
    else:
        raise AssertionError('missing internal leaf accepted')
    bad = copy.deepcopy(data)
    bad['marginLower'] += 1
    try:
        structural(bad)
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


def verify(filename, output, workers, follow=False):
    data = json.loads(filename.read_text())
    expected_sources = sources()
    expected_domain = data['domainDeg']
    assert data['sourceHashes'] == expected_sources
    if data['complete']:
        structural(data)
    else:
        assert follow, 'cover incomplete; --follow waits for additional leaves'
        partial_partition(data)
    geometry = json.loads((HERE/'arm1-crossing.json').read_text())
    assert c.certify() == geometry
    subprocess.run(['node', str(HERE/'check_arm1_crossing.js')], check=True, capture_output=True, text=True)
    crossing = json.loads((HERE/'arm1-crossing-validation.json').read_text())
    assert crossing['acceptedSubsteps'] == 123 and crossing['finalCrossings'] == 1
    results = {}
    with ProcessPoolExecutor(max_workers=workers) as pool:
        active = {}
        while True:
            data = json.loads(filename.read_text())
            assert data['sourceHashes'] == expected_sources and data['domainDeg'] == expected_domain
            partial_partition(data)
            if data['complete']:
                structural(data)
            assigned = set(active.values()) | set(results)
            for row in data['leaves']:
                key = tuple(row['defenderDomainDeg'])
                if key in results:
                    assert results[key]['canonicalPropagationSha256'] == row['propagationSha256']
                if key not in assigned and len(active) < workers:
                    active[pool.submit(check_leaf, row)] = key
                    assigned.add(key)
            if not active:
                if data['complete']:
                    break
                assert data['attempts'] < data['attemptLimit'], 'generator reached its limit with gaps still open'
                time.sleep(2)
                continue
            finished, _ = wait(active, timeout=2, return_when=FIRST_COMPLETED)
            for future in finished:
                key = active.pop(future)
                result = future.result()
                results[key] = result
                print('verified', result['domainDeg'], 'margin', result['throwMarginLowerFromPoseBox'],
                      'Decimal coordinates', sum(s['coordinateChecks'] for s in result['samples']), flush=True)
    assert sources() == expected_sources
    results = sorted(results.values(), key=lambda r: r['domainDeg'][0])
    assert len(results) == len(data['leaves'])
    controls = rejections(data, results)
    report = {
        'scope': 'Continuous real-model contact cover, shared source-rule legality and per-leaf stopping/ko composition. Decimal samples are consistency checks. No uniform floating-engine correspondence.',
        'python': platform.python_version(), 'node': crossing['node'],
        'domainDeg': data['domainDeg'], 'leavesReplayed': len(results),
        'substepsPerLeaf': 123, 'complete': True,
        'minimumThrowMarginFromPoseBox': min(r['throwMarginLowerFromPoseBox'] for r in results),
        'minimumKoHubDisplacement': min(r['koHubDisplacementLower'] for r in results),
        'decimalPrecision': d.getcontext().prec,
        'decimalTrajectoryCases': sum(len(r['samples']) for r in results),
        'distinctSampleAngles': len({s['angle'] for r in results for s in r['samples']}),
        'decimalCoordinateChecks': sum(s['coordinateChecks'] for r in results for s in r['samples']),
        'decimalFailures': 0, 'rejectionControlsPassed': controls,
        'sourceHashes': data['sourceHashes'],
        'artifactSha256': {p.name: c.sha(p) for p in (filename,
            HERE/'arm1-crossing.json', HERE/'arm1-crossing-validation.json',
            HERE/'decimal_reply.py', Path(__file__))},
        'leaves': results,
    }
    output.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('leaves', 'artifactSha256', 'sourceHashes')}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', default='arm1-expanded-reply-cover.json')
    parser.add_argument('--output', default='arm1-expanded-validation.json')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--follow', action='store_true', help='verify accepted leaves while the generator continues')
    args = parser.parse_args()
    verify(HERE/args.input, HERE/args.output, args.workers, args.follow)
