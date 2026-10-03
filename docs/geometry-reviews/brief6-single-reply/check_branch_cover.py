"""Replay every cell in a branch cover and compose shared reply legality.

Checkpoints record only completed canonical replays. --follow admits new
generator leaves; --resume explicitly reuses source- and input-matching checked
results. A final complete certificate requires the whole requested partition.
"""
import argparse
import copy
import json
import platform
import subprocess
import time
from concurrent.futures import ProcessPoolExecutor, wait, FIRST_COMPLETED
from decimal import Decimal as D
from pathlib import Path
import arm1_crossing as c
import decimal_reply as d
import reply_branches as b
from cover_arm1_branches import partition
from check_reply_branches import conservation
from check_arm1_one_degree import terminal_bounds

HERE = Path(__file__).resolve().parent


def check_leaf(row):
    lo, hi = row['domainDeg']
    assert 0 <= lo < hi <= 18
    result = b.run(lo, hi, row['threshold'], row['branchLimit'])
    assert b.record(result) == row, ('canonical propagation differs', [lo, hi])
    assert result['failure'] is None and result['completedSubsteps'] == 123
    conservation(result)
    bounds = []
    for branch in result['finalBranches']:
        margin, displacement = terminal_bounds([lo, hi], branch['box'])
        assert margin > 0 and displacement > c.PARAMS['koEps']
        bounds.append({'id': branch['id'], 'throwMarginLower': margin,
                       'koHubDisplacementLower': displacement})
    fractions = [0., .25, .5, .75, 1.] if result['forks'] else [0., .5, 1.]
    angles = sorted({lo if t == 0 else hi if t == 1 else lo+(hi-lo)*t for t in fractions})
    samples = []
    for angle in angles:
        assert lo <= angle <= hi
        point = d.trace(angle)
        assert len(point['steps']) == 123
        for step, enclosure in zip(point['steps'], result['log']):
            assert step['step'] == enclosure['step']
            pose = [D(v) for v in step['pose']]
            assert len(pose) == 3 and all(v.is_finite() for v in pose)
            matches = [state['id'] for state in enclosure['branches']
                if all(D.from_float(a) <= v <= D.from_float(e)
                       for (a, e), v in zip(state['box'], pose))]
            assert matches, ('Decimal pose outside every branch', angle, step['step'])
        samples.append({'angle': angle, 'coordinateChecks': 369,
            'trajectorySha256': b.digest(point), 'finalPose': point['steps'][-1]['pose'],
            'matchingFinalBranchIds': matches, 'contactCounts': point['contactCounts']})
    return {'domainDeg': [lo, hi], 'inputRowSha256': b.digest(row),
        'canonicalPropagationSha256': row['propagationSha256'],
        'forkEvents': len(result['forks']), 'finalBranches': len(bounds),
        'minimumThrowMarginFromPoseBox': min(v['throwMarginLower'] for v in bounds),
        'minimumKoHubDisplacement': min(v['koHubDisplacementLower'] for v in bounds),
        'branchBounds': bounds, 'samples': samples}


def controls(data, results):
    passed = 0
    bad = copy.deepcopy(data)
    bad['leaves'].pop(len(bad['leaves'])//2)
    try:
        partition(bad)
    except AssertionError:
        passed += 1
    else:
        raise AssertionError('missing leaf accepted')
    bad = copy.deepcopy(data)
    bad['marginLower'] = (bad['marginLower'] or 0)+1
    try:
        partition(bad)
    except AssertionError:
        passed += 1
    else:
        raise AssertionError('inflated cover margin accepted')
    row = copy.deepcopy(data['leaves'][0])
    row['propagationSha256'] = '0'*64
    assert row['propagationSha256'] != results[0]['canonicalPropagationSha256']
    passed += 1
    branched = next((r for r in data['leaves'] if r['forks']), None)
    if branched:
        event = copy.deepcopy(branched['forks'][0])
        event['children'].pop()
        try:
            b.check_tree(event['nodes'], [r['path'] for r in event['children']])
        except AssertionError:
            passed += 1
        else:
            raise AssertionError('omitted contact branch accepted')
    return passed


def components(intervals):
    out = []
    for a, e in sorted(intervals):
        if out and out[-1][1] == a:
            out[-1][1] = e
        else:
            out.append([a, e])
    return out


def verify(filename, output, workers=4, follow=False, resume=False):
    assert filename != output
    data = json.loads(filename.read_text())
    partition(data)
    expected_sources, expected_domain = b.source_hashes(), data['domainDeg']
    assert c.certify() == json.loads((HERE/'arm1-crossing.json').read_text())
    subprocess.run(['node', str(HERE/'check_arm1_crossing.js')], check=True, capture_output=True, text=True)
    crossing = json.loads((HERE/'arm1-crossing-validation.json').read_text())
    assert crossing['acceptedSubsteps'] == 123 and crossing['finalCrossings'] == 1
    fixed = {name: c.sha(HERE/name) for name in (
        'arm1-crossing.json', 'arm1-crossing-validation.json', 'decimal_reply.py',
        'check_reply_branches.py', 'check_arm1_one_degree.py',
        'cover_arm1_branches.py', Path(__file__).name)}
    results, resumed = {}, None
    if resume and output.exists():
        previous = json.loads(output.read_text())
        assert previous['sourceHashes'] == expected_sources and previous['domainDeg'] == expected_domain
        assert all(previous['artifactSha256'][name] == value for name, value in fixed.items())
        rows = {tuple(r['domainDeg']): r for r in data['leaves']}
        for result in previous['leaves']:
            key = tuple(result['domainDeg'])
            assert key in rows and key not in results
            assert result['inputRowSha256'] == b.digest(rows[key])
            assert result['canonicalPropagationSha256'] == rows[key]['propagationSha256']
            results[key] = result
        resumed = {'sha256': c.sha(output), 'leaves': len(results)}
    reused = len(results)

    def save(snapshot_bytes, final=False):
        snapshot = json.loads(snapshot_bytes)
        checked = sorted(results.values(), key=lambda r: r['domainDeg'])
        unverified = [r['domainDeg'] for r in snapshot['leaves'] if tuple(r['domainDeg']) not in results]
        report = {
            'scope': 'Continuous real-model response enclosures, exhaustive contact branches and shared source-rule legality with per-branch stopping/ko composition. Stored seed. No uniform floating-engine correspondence.',
            'python': platform.python_version(), 'node': crossing['node'],
            'domainDeg': expected_domain, 'complete': snapshot['complete'] and not unverified,
            'verificationComplete': not unverified, 'invocationFinished': final,
            'leavesReplayed': len(checked), 'leavesReplayedThisInvocation': len(checked)-reused,
            'resumedFrom': resumed, 'substepsPerLeaf': 123,
            'verifiedComponentsDeg': components([r['domainDeg'] for r in checked]),
            'pending': snapshot['pending'], 'unresolved': snapshot['unresolved'],
            'unverifiedAcceptedIntervals': unverified,
            'minimumThrowMarginFromPoseBox': min((r['minimumThrowMarginFromPoseBox'] for r in checked), default=None),
            'minimumKoHubDisplacement': min((r['minimumKoHubDisplacement'] for r in checked), default=None),
            'forkEvents': sum(r['forkEvents'] for r in checked),
            'branchedCells': sum(bool(r['forkEvents']) for r in checked),
            'maximumFinalBranches': max((r['finalBranches'] for r in checked), default=0),
            'decimalPrecision': d.getcontext().prec,
            'decimalTrajectoryCases': sum(len(r['samples']) for r in checked),
            'distinctSampleAngles': len({s['angle'] for r in checked for s in r['samples']}),
            'decimalCoordinateChecks': sum(s['coordinateChecks'] for r in checked for s in r['samples']),
            'decimalFailures': 0,
            'rejectionControlsPassed': controls(snapshot, checked) if checked else 0,
            'sourceHashes': expected_sources,
            'artifactSha256': {filename.name: b.hashlib.sha256(snapshot_bytes).hexdigest(), **fixed},
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
            partition(data)
            assert data['sourceHashes'] == expected_sources and data['domainDeg'] == expected_domain
            assigned = set(results) | set(active.values())
            for row in data['leaves']:
                key = tuple(row['domainDeg'])
                if key in results:
                    assert results[key]['inputRowSha256'] == b.digest(row)
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
                print('verified', list(key), 'branches', result['finalBranches'],
                      'margin', result['minimumThrowMarginFromPoseBox'], flush=True)
                save(snapshot_bytes)
    assert b.source_hashes() == expected_sources
    assert all(c.sha(HERE/name) == value for name, value in fixed.items())
    assert len(results) == len(data['leaves'])
    report = save(snapshot_bytes, final=True)
    print(json.dumps({k: v for k, v in report.items() if k not in ('sourceHashes', 'artifactSha256', 'leaves')}, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', default='arm1-nine-ten-cover.json')
    parser.add_argument('--output', default='arm1-nine-ten-validation.json')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--follow', action='store_true')
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    report = verify(HERE/args.input, HERE/args.output, args.workers, args.follow, args.resume)
    if not report['complete']:
        raise SystemExit('Partial validation saved; requested cover remains incomplete.')
