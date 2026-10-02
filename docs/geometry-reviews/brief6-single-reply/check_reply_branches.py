"""Replay every retained branch, check branch conservation and compose legality.

Decimal samples check entire poses against one member of the union at each
substep. They are diagnostics, not the continuous-coverage argument.
"""
import argparse
import copy
import json
import platform
import subprocess
from decimal import Decimal as D
from pathlib import Path
import arm1_crossing as c
import decimal_reply as d
import reply_branches as b

HERE = Path(__file__).resolve().parent


def conservation(result):
    live = {0}
    used = {0}
    for step in result['log']:
        for event in result['forks']:
            if event['step'] != step['step']:
                continue
            b.check_tree(event['nodes'], [r['path'] for r in event['children']])
            assert event['parentId'] in live
            live.remove(event['parentId'])
            children = [r['id'] for r in event['children']]
            assert len(set(children)) == len(children)
            assert not (set(children) & used)
            used.update(children)
            live.update(children)
        assert live == {r['id'] for r in step['branches']}
        assert len(live) == len(step['branches'])
    assert live == {r['id'] for r in result['finalBranches']}


def verify(filename, output):
    expected = json.loads(filename.read_text())
    assert expected['sourceHashes'] == b.source_hashes()
    lo, hi = expected['domainDeg']
    assert 0 <= lo < hi <= 18
    replay = b.run(lo, hi, expected['threshold'], expected['branchLimit'], True)
    actual = b.record(replay)
    assert actual == expected, 'full branch propagation differs'
    assert replay['completedSubsteps'] == 123 and replay['failure'] is None
    assert replay['minimumThrowMargin'] > 0
    conservation(replay)
    assert c.certify() == json.loads((HERE/'arm1-crossing.json').read_text())
    subprocess.run(['node', str(HERE/'check_arm1_crossing.js')], check=True,
                   capture_output=True, text=True)
    initial = c.p.f.pose_at(1, -1, lo, hi)
    initial_radii = [c.p.f.norm(foot).bounds() for foot in c.feet(initial)]
    assert max(r[1] for r in initial_radii) < c.EDGE.lo
    bounds = []
    for branch in replay['finalBranches']:
        final = [c.V(*v) for v in branch['box']]
        radii = [c.p.f.norm(foot).bounds() for foot in c.feet(final)]
        margin = (c.V(max(r[0] for r in radii))-c.EDGE).lo
        displacement = c.p.f.norm([final[i]-initial[i] for i in range(2)])
        assert margin > 0 and displacement.lo > c.PARAMS['koEps']
        bounds.append({'id': branch['id'], 'footRadii': radii,
            'throwMarginLower': margin, 'koHubDisplacementLower': displacement.lo})
    samples = []
    angles = sorted({lo, hi, *(lo+(hi-lo)*k/4 for k in range(1, 4))})
    for angle in angles:
        point = d.trace(angle)
        assert len(point['steps']) == 123
        for enclosure, step in zip(replay['log'], point['steps']):
            assert enclosure['step'] == step['step']
            values = [D(value) for value in step['pose']]
            assert all(value.is_finite() for value in values)
            matches = [branch['id'] for branch in enclosure['branches']
                if all(D.from_float(a) <= value <= D.from_float(e)
                    for (a, e), value in zip(branch['box'], values))]
            assert matches, ('Decimal pose outside every branch', angle, step['step'])
        samples.append({'angle': angle, 'coordinateChecks': 369,
            'trajectorySha256': b.digest(point), 'finalPose': point['steps'][-1]['pose'],
            'matchingFinalBranchIds': matches, 'contactCounts': point['contactCounts']})
    controls = 0
    if replay['forks']:
        bad = copy.deepcopy(replay['forks'][0])
        bad['children'].pop()
        try:
            b.check_tree(bad['nodes'], [r['path'] for r in bad['children']])
        except AssertionError:
            controls += 1
        else:
            raise AssertionError('dropped branch accepted')
    bad = copy.deepcopy(replay)
    bad['log'][-1]['branches'].pop()
    try:
        conservation(bad)
    except AssertionError:
        controls += 1
    else:
        raise AssertionError('lost terminal state accepted')
    bad = copy.deepcopy(expected)
    bad['propagationSha256'] = '0'*64
    assert bad != actual
    controls += 1
    assert expected['sourceHashes'] == b.source_hashes()
    report = {
        'scope': 'Continuous finite-union real-model enclosure, with shared source-rule legality and stopping/ko composition. No uniform floating-engine correspondence.',
        'python': platform.python_version(), 'complete': True,
        'domainDeg': [lo, hi], 'completedSubsteps': 123,
        'forkEvents': len(replay['forks']), 'finalBranches': len(bounds),
        'minimumThrowMarginFromPoseBox': min(r['throwMarginLower'] for r in bounds),
        'minimumKoHubDisplacement': min(r['koHubDisplacementLower'] for r in bounds),
        'initialDefenderRadii': initial_radii, 'branchBounds': bounds,
        'canonicalPropagationSha256': actual['propagationSha256'],
        'sourceHashes': expected['sourceHashes'],
        'artifactSha256': {p.name: c.sha(p) for p in (filename,
            HERE/'arm1-crossing.json', HERE/'arm1-crossing-validation.json',
            HERE/'decimal_reply.py', Path(__file__))},
        'decimalPrecision': d.getcontext().prec, 'decimalTrajectoryCases': len(samples),
        'decimalCoordinateChecks': sum(r['coordinateChecks'] for r in samples),
        'decimalFailures': 0, 'rejectionControlsPassed': controls, 'samples': samples,
    }
    output.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    print(json.dumps({k: v for k, v in report.items() if k not in (
        'sourceHashes', 'artifactSha256', 'samples', 'branchBounds')}, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', default='arm1-gap-branches.json')
    parser.add_argument('--output', default='arm1-gap-validation.json')
    args = parser.parse_args()
    verify(HERE/args.input, HERE/args.output)
