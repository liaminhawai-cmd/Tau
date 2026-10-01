"""Recompute every interval query and reject altered certificate claims.

Shared arithmetic with the generator; the separate JS checker executes the
original crossing function on these certified predicates.
"""
import copy
import json
import platform
from pathlib import Path
import arm1_crossing as c

HERE = Path(__file__).resolve().parent


def check(data, expected):
    assert data == expected, 'geometric certificate differs from recomputation'


if __name__ == '__main__':
    data = json.loads((HERE/'arm1-crossing.json').read_text())
    expected = c.certify()
    check(data, expected)
    bad = []
    item = copy.deepcopy(data)
    item['points'].pop(36)
    bad.append(item)
    item = copy.deepcopy(data)
    item['points'][36]['near'][1] = []
    bad.append(item)
    item = copy.deepcopy(data)
    item['radialMarginLower'] += .01
    bad.append(item)
    item = copy.deepcopy(data)
    item['stopping']['throwMarginLowerFromPoseBox'] += 1
    bad.append(item)
    for item in bad:
        try:
            check(item, expected)
        except AssertionError:
            pass
        else:
            raise AssertionError('altered certificate accepted')
    print(json.dumps({'python': platform.python_version(), 'pointsRecomputed': len(data['points']),
        'radialPredicatesRecomputed': data['radialPredicates'], 'rejectionControlsPassed': len(bad),
        'certificateSha256': c.sha(HERE/'arm1-crossing.json')}, indent=2))
