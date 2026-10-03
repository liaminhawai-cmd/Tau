"""Join the completed 8–9 and 9–10 degree certificates at their shared endpoint.

This is a composition check over completed replay artifacts, not another
trajectory replay. All new terminal geometry bounds are recomputed here.
"""
import copy
import json
from pathlib import Path
import arm1_crossing as c
import reply_branches as b
from cover_arm1_branches import partition as branch_partition
from check_arm1_one_degree import inspect as inspect_old, terminal_bounds, check_artifacts

HERE = Path(__file__).resolve().parent


def partition(cells, domain):
    assert cells and cells[0]['domainDeg'][0] == domain[0] and cells[-1]['domainDeg'][1] == domain[1]
    assert all(a['domainDeg'][1] == e['domainDeg'][0] for a, e in zip(cells, cells[1:]))
    assert all(r['domainDeg'][0] < r['domainDeg'][1] and r['throwMarginLower'] > 0
        and r['koHubDisplacementLower'] > c.PARAMS['koEps'] for r in cells)


def inspect():
    previous_path = HERE/'arm1-one-degree-certificate.json'
    previous = json.loads(previous_path.read_text())
    assert previous == inspect_old()
    cover_path, validation_path = HERE/'arm1-nine-ten-cover.json', HERE/'arm1-nine-ten-validation.json'
    cover, validation = json.loads(cover_path.read_text()), json.loads(validation_path.read_text())
    branch_partition(cover)
    assert cover['complete'] and validation['complete']
    assert validation['invocationFinished'] and validation['verificationComplete']
    assert not validation['pending'] and not validation['unresolved'] and not validation['unverifiedAcceptedIntervals']
    assert cover['domainDeg'] == validation['domainDeg'] == [9., 10.]
    assert cover['sourceHashes'] == validation['sourceHashes'] == previous['branchSourceHashes'] == b.source_hashes()
    assert validation['leavesReplayed'] == len(cover['leaves']) == len(validation['leaves'])
    check_artifacts(validation)
    cells = copy.deepcopy(previous['proofCells'])
    for row, checked in zip(cover['leaves'], validation['leaves']):
        assert checked['domainDeg'] == row['domainDeg']
        assert checked['inputRowSha256'] == b.digest(row)
        assert checked['canonicalPropagationSha256'] == row['propagationSha256']
        assert checked['finalBranches'] == len(row['finalBranches']) == len(checked['branchBounds'])
        margins, displacements = [], []
        for branch, bound in zip(row['finalBranches'], checked['branchBounds']):
            assert branch['id'] == bound['id']
            margin, displacement = terminal_bounds(row['domainDeg'], branch['box'])
            assert margin == bound['throwMarginLower'] and displacement == bound['koHubDisplacementLower']
            assert margin > 0 and displacement > c.PARAMS['koEps']
            margins.append(margin)
            displacements.append(displacement)
        assert min(margins) == checked['minimumThrowMarginFromPoseBox']
        assert min(displacements) == checked['minimumKoHubDisplacement']
        cells.append({'domainDeg': row['domainDeg'],
            'method': 'separate zonotopes' if len(margins) > 1 else 'single zonotope',
            'finalBranches': len(margins), 'forkEvents': len(row['forks']),
            'throwMarginLower': min(margins), 'koHubDisplacementLower': min(displacements),
            'propagationSha256': row['propagationSha256'], 'validationArtifact': validation_path.name})
    domain = [8., 10.]
    partition(cells, domain)
    controls = 0
    variants = []
    bad = copy.deepcopy(cells)
    bad.pop(previous['cells'])
    variants.append(bad)
    bad = copy.deepcopy(cells)
    bad[previous['cells']]['domainDeg'][0] = 9.001
    variants.append(bad)
    bad = copy.deepcopy(cells)
    bad[-1]['throwMarginLower'] = 0
    variants.append(bad)
    for bad in variants:
        try:
            partition(bad, domain)
        except AssertionError:
            controls += 1
        else:
            raise AssertionError('broken band composition accepted')
    return {
        'scope': 'Complete continuous real-model winning-reply cover on defender arm (1,−), 8–10 degrees, for the stored seed and prescribed attacker reply (0,−). The whole arm, other arms and uniform floating-engine correspondence remain open.',
        'domainDeg': domain, 'complete': True, 'cells': len(cells),
        'components': [{'artifact': previous_path.name, 'domainDeg': previous['domainDeg'], 'cells': previous['cells']},
            {'artifact': validation_path.name, 'domainDeg': validation['domainDeg'], 'cells': validation['leavesReplayed']}],
        'minimumThrowMargin': min(r['throwMarginLower'] for r in cells),
        'minimumKoHubDisplacement': min(r['koHubDisplacementLower'] for r in cells),
        'maximumFinalBranches': max(r.get('finalBranches', 1) for r in cells),
        'decimalTrajectoryCases': previous['decimalTrajectoryCases']+validation['decimalTrajectoryCases'],
        'decimalCoordinateChecks': previous['decimalCoordinateChecks']+validation['decimalCoordinateChecks'],
        'decimalFailures': previous['decimalFailures']+validation['decimalFailures'],
        'compositionRejectionControlsPassed': controls,
        'sourceHashes': b.source_hashes(), 'enginePin': c.PIN, 'engineSourceHashes': c.PINS,
        'artifactSha256': {p.name: c.sha(p) for p in (previous_path, cover_path, validation_path, Path(__file__))},
        'proofCells': cells,
    }


if __name__ == '__main__':
    report = inspect()
    (HERE/'arm1-eight-ten-certificate.json').write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    print(json.dumps({k: v for k, v in report.items() if k not in (
        'sourceHashes', 'engineSourceHashes', 'artifactSha256', 'proofCells')}, indent=2))
