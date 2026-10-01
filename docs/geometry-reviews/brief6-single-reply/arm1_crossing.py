"""Bound the geometric predicates for the shared attacker response.

The path uses exact real rotations of stored binary64 inputs. Each queried
foot is additionally allowed an independent +/-1e-7u perturbation in x and y.
This is a robust geometric certificate, NOT a proof that floating engine
trajectories stay in the boxes. The pinned JS state machine is replayed by
check_arm1_crossing.js; no Python port of that state machine is used.
"""
import hashlib
import json
from pathlib import Path
import arm1_prefix as p

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
V, PI = p.f.V, p.f.PI
PIN = 'ce0e61d1e7482e3d1252aadadf97bd4269f71e29'
PINS = {
    'index.html': '3cee71df1f26afd79cbbc83a5c208780e29e170cd7111fabaafb4ab75bc479c4',
    'nn/engine.js': '106b90e0a6981c817c2789f88b175a546f9a7fc229af20f50218495533af443e',
}
PARAMS = {
    'edgeU': 66.667, 'edgeEps': .5, 'footR': 23.095,
    'rings': [40, 53.3],
    'sideArcs': [
        {'cx': -66.667, 'cy': 0, 'r': 40, 'a0': -72.542, 'a1': 72.542},
        {'cx': 66.667, 'cy': 0, 'r': 40, 'a0': 107.458, 'a1': 252.542},
    ],
    'touchEps': .81, 'crossEps': .81, 'holdEps': .81,
    'lineStick': 0, 'cornerEps': .81, 'maxCrossingsPerTurn': 1,
    'substepDeg': .4, 'minMoveDeg': 2, 'lockDeg': 2,
    'koRule': True, 'koEps': .25, 'koDeg': 2,
}
PAD = 1e-7
EDGE = V(PARAMS['edgeU']) + V(PARAMS['edgeEps'])


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sources():
    for name, expected in PINS.items():
        assert sha(ROOT / name) == expected, ('source mismatch', name)
    return {name: sha(HERE / name) for name in (
        'arm1_crossing.py', 'arm1_prefix.py', 'free_motion.py', 'interval_core.py')}


def abs_bound(a):
    if a.lo >= 0:
        return a
    if a.hi <= 0:
        return -a
    return V(0, max(-a.lo, a.hi))


def feet(q, pad=0.):
    e = V(-pad, pad)
    return [[q[0] + p.f.R*p.f.cos(q[2] + 2*PI*j/3) + e,
             q[1] + p.f.R*p.f.sin(q[2] + 2*PI*j/3) + e]
            for j in range(3)]


def span_bounds(x, y, arc):
    # Both specified CCW spans have width strictly between 0 and pi.
    # v is in such a closed wedge iff cross(e0,v)>=0 and cross(v,e1)>=0.
    assert 0 < arc['a1'] - arc['a0'] < 180
    a, b = V(arc['a0'])*PI/180, V(arc['a1'])*PI/180
    return [p.f.cos(a)*y - p.f.sin(a)*x,
            x*p.f.sin(b) - y*p.f.cos(b)]


def query(f, cx, cy, radius, arc=None):
    x, y = f[0] - cx, f[1] - cy
    gap = p.f.norm([x, y]) - radius
    d = abs_bound(gap)
    eps = V(PARAMS['touchEps'])
    if d.hi < eps.lo:
        radial, margin = True, (eps-d).lo
    elif d.lo > eps.hi:
        radial, margin = False, (d-eps).lo
    else:
        raise ValueError(('unresolved radial guard', gap.bounds()))
    if gap.lo > 0:
        side, side_margin = 1, gap.lo
    elif gap.hi < 0:
        side, side_margin = -1, -gap.hi
    else:
        raise ValueError(('unresolved centreline side', gap.bounds()))
    # Match the source's short circuit: no span test outside the radial band.
    span = None
    near = radial
    if radial and arc is not None:
        tests = span_bounds(x, y, arc)
        if all(t.lo > 0 for t in tests):
            near = True
        elif any(t.hi < 0 for t in tests):
            near = False
        else:
            raise ValueError(('unresolved span', [t.bounds() for t in tests]))
        span = [t.bounds() for t in tests]
    return {'gap': gap.bounds(), 'radiallyNear': radial, 'radialMarginLower': margin,
            'side': side, 'sideMarginLower': side_margin, 'spanCrossBounds': span,
            'near': near}


def point(k):
    beta = .375*k  # Exact dyadic degrees, not an accumulated float angle.
    fs = feet(p.attacker_at(beta, beta), PAD)
    queries = []
    for foot in fs:
        row = {f'r{i}': query(foot, 0, 0, r) for i, r in enumerate(PARAMS['rings'])}
        for i, arc in enumerate(PARAMS['sideArcs']):
            row[f'a{i}'] = query(foot, arc['cx'], arc['cy'], arc['r'], arc)
        queries.append(row)
    return {'step': k, 'betaDeg': beta, 'feet': [[v.bounds() for v in foot] for foot in fs],
            'radii': [p.f.norm(foot).bounds() for foot in fs], 'queries': queries,
            'near': [[line for line, v in row.items() if v['near']] for row in queries],
            'sides': [{line: v['side'] for line, v in row.items()} for row in queries]}


def stopping():
    contact_path = HERE / 'arm1-local-reply-cover.json'
    contact = json.loads(contact_path.read_text())
    # The contact propagation is separately rechecked. This composition binds
    # to its exact artifact and to the evaluator sources recorded in it.
    for name, expected in contact['sourceHashes'].items():
        assert sha(HERE/name) == expected
    assert contact['complete'] and contact['domainDeg'] == [8., 8.01]
    assert len(contact['leaves']) == 1
    row = contact['leaves'][0]
    assert row['completedSubsteps'] == 123 and row['failure'] is None
    initial = p.f.pose_at(1, -1, 8., 8.01)
    final = [V(*v) for v in row['lastBox']]
    displacement = p.f.norm([final[i]-initial[i] for i in range(2)])
    assert displacement.lo > PARAMS['koEps']
    initial_radii = [p.f.norm(foot).bounds() for foot in feet(initial)]
    assert max(r[1] for r in initial_radii) < EDGE.lo
    final_radii = [p.f.norm(foot).bounds() for foot in feet(final)]
    throw_margin = (V(*final_radii[1])-EDGE).lo
    assert throw_margin > 0
    next_feet = feet(p.attacker_at(46.5, 46.5), PAD)
    next_radii = [p.f.norm(foot).bounds() for foot in next_feet]
    off_foot = max(range(3), key=lambda i: next_radii[i][0])
    off_margin = (V(*next_radii[off_foot])-EDGE).lo
    assert off_margin > 0
    minimum_move_margin = (V(46.125)-PARAMS['minMoveDeg'])*PI/180
    assert minimum_move_margin.lo > 0
    return {
        'contactArtifactSha256': sha(contact_path),
        'defenderDomainDeg': [8., 8.01],
        'initialDefenderRadii': initial_radii,
        'finalDefenderRadiiFromPoseBox': final_radii,
        'throwMarginLowerFromPoseBox': throw_margin,
        'defenderHubDisplacement': displacement.bounds(),
        'koDistanceThreshold': PARAMS['koEps'],
        'minimumMoveMarginRad': minimum_move_margin.bounds(),
        'rejectedStep': {'step': 124, 'betaDeg': 46.5, 'feet': [[v.bounds() for v in foot] for foot in next_feet],
                         'radii': next_radii, 'offFoot': off_foot, 'offMarginLower': off_margin},
    }


def certify():
    source_hashes = sources()
    points = [point(k) for k in range(124)]
    assert all(max(r[1] for r in q['radii']) < EDGE.lo for q in points)
    predicates = [v for q in points for foot in q['queries'] for v in foot.values()]
    return {
        'scope': 'Shared exact-real attacker path with independent +/-1e-7u per-foot coordinate boxes at each query. No floating trajectory containment theorem.',
        'enginePin': PIN, 'engineSourceHashes': PINS, 'sourceHashes': source_hashes,
        'pose': p.f.POSE, 'parameters': PARAMS, 'attackerArm': [0, -1],
        'commandDeg': -3, 'substepsPerFullCall': 8, 'acceptedSubsteps': 123,
        'footCoordinatePadding': PAD, 'edgeThreshold': EDGE.bounds(),
        'radialPredicates': len(predicates),
        'radialMarginLower': min(v['radialMarginLower'] for v in predicates),
        'sideMarginLower': min(v['sideMarginLower'] for v in predicates),
        'sideArcSpanQueries': sum(v['spanCrossBounds'] is not None for v in predicates),
        'attackerRadiusUpperAtQueries': max(r[1] for q in points for r in q['radii']),
        'points': points, 'stopping': stopping(),
    }


if __name__ == '__main__':
    data = certify()
    (HERE/'arm1-crossing.json').write_text(json.dumps(data, indent=2)+'\n')
    print(json.dumps({k: v for k, v in data.items() if k not in ('points', 'sourceHashes', 'parameters', 'pose')}, indent=2))
