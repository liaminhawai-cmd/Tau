"""Compose replayed ordinary cells and exhaustively branched gap certificates.

This is the inexpensive composition check. The two component replay programs
must first produce finished, source-matching validation artifacts. This program
does not describe reading an archived validation as re-executing its trajectory.
"""
import copy
import json
from pathlib import Path
import arm1_crossing as c
from check_arm1_extension import validate_cover, digest
from cover_arm1_reply import sources
import reply_branches as branches

HERE = Path(__file__).resolve().parent
ORDINARY = 'arm1-one-degree-cover.json'
VALIDATION = 'arm1-one-degree-validation.json'
GAPS = [('arm1-gap-branches.json', 'arm1-gap-validation.json'),
        ('arm1-gap2-branches.json', 'arm1-gap2-validation.json')]


def load(name):
    return json.loads((HERE/name).read_text())


def check_artifacts(validation):
    assert validation['decimalFailures'] == 0
    for name, expected in validation['artifactSha256'].items():
        assert c.sha(HERE/name) == expected, ('artifact changed', name)


def terminal_bounds(domain, box):
    """Recompute the cheap geometric composition bounds from archived poses."""
    initial = c.p.f.pose_at(1, -1, *domain)
    final = [c.V(*v) for v in box]
    assert max(c.p.f.norm(foot).hi for foot in c.feet(initial)) < c.EDGE.lo
    radii = [c.p.f.norm(foot).bounds() for foot in c.feet(final)]
    margin = (c.V(max(r[0] for r in radii))-c.EDGE).lo
    displacement = c.p.f.norm([final[i]-initial[i] for i in range(2)]).lo
    return margin, displacement


def partition(cells, domain):
    assert cells and cells[0]['domainDeg'][0] == domain[0]
    assert cells[-1]['domainDeg'][1] == domain[1]
    assert all(a['domainDeg'][1] == b['domainDeg'][0] for a, b in zip(cells, cells[1:]))
    assert all(r['domainDeg'][0] < r['domainDeg'][1] and r['throwMarginLower'] > 0
        and r['koHubDisplacementLower'] > c.PARAMS['koEps'] for r in cells)


def inspect():
    cover, checked = load(ORDINARY), load(VALIDATION)
    validate_cover(cover)
    assert not cover['pending'], 'ordinary sweep still pending'
    assert checked['invocationFinished'] and checked['verificationComplete']
    assert not checked['unverifiedAcceptedIntervals']
    assert checked['domainDeg'] == cover['domainDeg'] == [8., 9.]
    assert checked['sourceHashes'] == cover['sourceHashes'] == sources()
    assert len(checked['leaves']) == len(cover['leaves']) == checked['leavesReplayed']
    check_artifacts(checked)
    cells = []
    for row, validation in zip(cover['leaves'], checked['leaves']):
        assert row['defenderDomainDeg'] == validation['domainDeg']
        assert validation['inputRowSha256'] == digest(row)
        assert validation['canonicalPropagationSha256'] == row['propagationSha256']
        margin, displacement = terminal_bounds(validation['domainDeg'], row['lastBox'])
        assert margin == validation['throwMarginLowerFromPoseBox']
        assert displacement == validation['koHubDisplacementLower']
        cells.append({'domainDeg': validation['domainDeg'], 'method': 'single zonotope',
            'throwMarginLower': margin, 'koHubDisplacementLower': displacement,
            'propagationSha256': row['propagationSha256'], 'validationArtifact': VALIDATION})
    gap_domains, gap_reports = [], []
    for filename, validation_name in GAPS:
        gap, validation = load(filename), load(validation_name)
        assert gap['sourceHashes'] == validation['sourceHashes'] == branches.source_hashes()
        assert gap['failure'] is None and gap['completedSubsteps'] == 123
        assert validation['complete'] and validation['completedSubsteps'] == 123
        assert validation['domainDeg'] == gap['domainDeg']
        assert validation['canonicalPropagationSha256'] == gap['propagationSha256']
        assert len(gap['finalBranches']) == validation['finalBranches']
        assert len(gap['finalBranches']) == len(validation['branchBounds'])
        bounds = []
        for branch, bound in zip(gap['finalBranches'], validation['branchBounds']):
            assert branch['id'] == bound['id']
            margin, displacement = terminal_bounds(gap['domainDeg'], branch['box'])
            assert margin == bound['throwMarginLower']
            assert displacement == bound['koHubDisplacementLower']
            assert margin > 0 and displacement > c.PARAMS['koEps']
            bounds.append((margin, displacement))
        assert validation['minimumThrowMarginFromPoseBox'] == min(v[0] for v in bounds)
        assert validation['minimumKoHubDisplacement'] == min(v[1] for v in bounds)
        for event in gap['forks']:
            branches.check_tree(event['nodes'], [r['path'] for r in event['children']])
        check_artifacts(validation)
        gap_domains.append(gap['domainDeg'])
        gap_reports.append(validation)
        cells.append({'domainDeg': gap['domainDeg'], 'method': 'separate zonotopes',
            'throwMarginLower': validation['minimumThrowMarginFromPoseBox'],
            'koHubDisplacementLower': validation['minimumKoHubDisplacement'],
            'propagationSha256': gap['propagationSha256'], 'validationArtifact': validation_name,
            'finalBranches': validation['finalBranches']})
    assert sorted(gap_domains) == sorted(cover['unresolved'])
    cells.sort(key=lambda r: r['domainDeg'])
    partition(cells, cover['domainDeg'])
    controls = 0
    for bad in ([r for r in cells if r['domainDeg'] != gap_domains[0]],
                sorted(cells+[cells[0]], key=lambda r: r['domainDeg'])):
        try:
            partition(bad, cover['domainDeg'])
        except AssertionError:
            controls += 1
        else:
            raise AssertionError('incomplete/overlapping cover accepted')
    bad = copy.deepcopy(cells)
    bad[0]['throwMarginLower'] = 0
    try:
        partition(bad, cover['domainDeg'])
    except AssertionError:
        controls += 1
    else:
        raise AssertionError('nonpositive throw margin accepted')
    inputs = [ORDINARY, VALIDATION, *[n for pair in GAPS for n in pair], Path(__file__).name]
    all_reports = [checked]+gap_reports
    return {
        'scope': 'Complete continuous 8–9 degree cover on defender arm (1,−) for the prescribed shared attacker reply (0,−), in the specified real-arithmetic model only. Stored seed. Full arm, other arms and uniform floating-engine correspondence remain open.',
        'domainDeg': cover['domainDeg'], 'complete': True,
        'cells': len(cells), 'singleZonotopeCells': len(cover['leaves']),
        'separateZonotopeCells': len(gap_reports),
        'gapForkEvents': sum(r['forkEvents'] for r in gap_reports),
        'gapFinalBranches': sum(r['finalBranches'] for r in gap_reports),
        'minimumThrowMargin': min(r['throwMarginLower'] for r in cells),
        'minimumKoHubDisplacement': min(r['koHubDisplacementLower'] for r in cells),
        'decimalTrajectoryCases': sum(r['decimalTrajectoryCases'] for r in all_reports),
        'decimalCoordinateChecks': sum(r['decimalCoordinateChecks'] for r in all_reports),
        'decimalFailures': sum(r['decimalFailures'] for r in all_reports),
        'componentRejectionControlsPassed': sum(r['rejectionControlsPassed'] for r in all_reports),
        'compositionRejectionControlsPassed': controls,
        'sourceHashes': sources(), 'branchSourceHashes': branches.source_hashes(),
        'artifactSha256': {name: c.sha(HERE/name) for name in inputs},
        'proofCells': cells,
    }


if __name__ == '__main__':
    report = inspect()
    (HERE/'arm1-one-degree-certificate.json').write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    print(json.dumps({k: v for k, v in report.items() if k not in (
        'sourceHashes', 'branchSourceHashes', 'artifactSha256', 'proofCells')}, indent=2))
