"""Keep separated contact images in a finite union of zonotopes.

The five existing enclosure modules are unchanged. Within one solver pass,
vunion may be replaced by EACH of its candidate images in turn. Every child is
retained, including an identity child if present. Small unions use the original
enclosure. No branch is chosen from a scalar trace or discarded as unlikely.

The centre-spread threshold only chooses between two enclosing representations;
it is not a geometry predicate. A resource limit or unsupported guard fails the
entire attempt. This proves nothing about floating-engine roundoff.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
import reply_jet as j
import reply_zonotope as z
from arm1_prefix import attacker_at
from cover_arm1_reply import sources

HERE = Path(__file__).resolve().parent


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True,
        separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def source_hashes():
    return {**sources(), Path(__file__).name: hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}


class Fork(Exception):
    def __init__(self, site, images, spread):
        self.site, self.images, self.spread = site, images, spread


def propagate_all(c, generators, att, threshold, limit):
    """Exhaust the decision tree for this one cached-geometry solver pass."""
    original_union = j.vunion
    nodes, outputs = [], []

    def explore(path):
        cursor, site = 0, 0

        def choose(images):
            nonlocal cursor, site
            site += 1
            spread = [max(q[i].c.hi for q in images)-min(q[i].c.lo for q in images)
                      for i in range(3)]
            scaled = max(spread[0], spread[1], 23.095*spread[2])
            if len(images) > 1 and scaled > threshold:
                if cursor == len(path):
                    raise Fork(site, len(images), spread)
                selected = path[cursor]
                cursor += 1
                assert 0 <= selected < len(images)
                return images[selected]
            return original_union(images)

        j.vunion = choose
        try:
            state = z.propagate(c, generators, att)
        except Fork as fork:
            nodes.append({'prefix': path, 'site': fork.site, 'arity': fork.images,
                          'centreSpread': fork.spread})
            for selected in range(fork.images):
                explore(path+[selected])
        else:
            assert cursor == len(path)
            outputs.append({'path': path, 'c': state[0], 'M': state[1], 'counts': state[2]})
            if len(outputs) > limit:
                raise ValueError('per-pass branch limit exceeded; no children may be discarded')
        finally:
            j.vunion = original_union

    explore([])
    check_tree(nodes, [r['path'] for r in outputs])
    return outputs, nodes


def check_tree(nodes, leaves):
    """Every enumerated fork must have every child, exactly once."""
    forks = {tuple(n['prefix']): n['arity'] for n in nodes}
    tips = {tuple(p) for p in leaves}
    assert len(forks) == len(nodes) and len(tips) == len(leaves)
    assert not (set(forks) & tips)
    visited = set()

    def visit(path):
        assert path not in visited
        visited.add(path)
        if path in tips:
            return
        assert path in forks and forks[path] >= 2
        for i in range(forks[path]):
            visit(path+(i,))

    visit(())
    assert visited == set(forks) | tips


def final_bounds(state):
    box, _ = z.box_of(state['c'], state['M'])
    radii = []
    for foot in range(3):
        angle = box[2]+2*z.f.PI*foot/3
        radii.append(z.f.norm([box[0]+z.f.R*z.f.cos(angle),
                              box[1]+z.f.R*z.f.sin(angle)]).bounds())
    edge = z.V(66.667)+z.V(.5)
    return {'id': state['id'], 'box': [v.bounds() for v in box],
            'footRadii': radii, 'throwMarginLower': (z.V(max(r[0] for r in radii))-edge).lo}


def run(lo, hi, threshold=1e-4, limit=32, verbose=False):
    assert lo < hi and threshold > 0 and limit > 0
    centre, generators = z.initial_family(lo, hi)
    forest = [{'id': 0, 'c': centre, 'M': generators}]
    next_id, logs, forks, counts = 1, [], [], {}
    k = iteration = 0
    failure = None
    started = time.monotonic()
    try:
        for k in range(1, 124):
            att = attacker_at(k*.375, k*.375)
            active, stopped = forest, []
            for iteration in range(10):
                following = []
                for parent in active:
                    children, nodes = propagate_all(parent['c'], parent['M'], att, threshold, limit)
                    child_ids = []
                    for child in children:
                        child_id = parent['id'] if not nodes else next_id
                        if nodes:
                            next_id += 1
                        child_ids.append({'path': child['path'], 'id': child_id})
                        state = {'id': child_id, 'c': child['c'], 'M': child['M']}
                        _, h = z.box_of(state['c'], state['M'])
                        if max(h[0], h[1], 23.095*h[2]) > 1:
                            raise ValueError('branch halfwidth exceeded 1u exploration limit')
                        for key, value in child['counts'].items():
                            counts[key] = counts.get(key, 0)+value
                        if child['counts'].get('contactMaps'):
                            following.append(state)
                        else:
                            stopped.append(state)
                    if nodes:
                        forks.append({'step': k, 'iteration': iteration, 'parentId': parent['id'],
                                      'nodes': nodes, 'children': child_ids})
                        if verbose:
                            print('fork', k, iteration, parent['id'], '->', child_ids, flush=True)
                    if len(following)+len(stopped) > limit:
                        raise ValueError('forest limit exceeded; no states may be discarded')
                active = following
                if not active:
                    break
            forest = sorted(stopped+active, key=lambda r: r['id'])
            assert forest
            logs.append({'step': k, 'branches': [dict(state,
                box=[v.bounds() for v in z.box_of(state['c'], state['M'])[0]]) for state in forest]})
            if verbose and k % 20 == 0:
                print('step', k, 'branches', len(forest), flush=True)
    except (ValueError, ZeroDivisionError) as exc:
        failure = {'step': k, 'iteration': iteration, 'reason': str(exc)}
    final = [final_bounds(state) for state in forest] if not failure else []
    return {'scope': 'Finite-union enclosure of the prescribed ordinary real contact program; no floating-engine correspondence.',
        'domainDeg': [lo, hi], 'sourceHashes': source_hashes(),
        'threshold': threshold, 'branchLimit': limit, 'completedSubsteps': len(logs),
        'failure': failure, 'forks': forks, 'counts': counts,
        'finalBranches': final,
        'minimumThrowMargin': min((r['throwMarginLower'] for r in final), default=None),
        'log': logs, 'seconds': time.monotonic()-started}


def record(result):
    canonical = {k: v for k, v in result.items() if k != 'seconds'}
    return {k: v for k, v in canonical.items() if k != 'log'} | {'propagationSha256': digest(canonical)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lo', type=float, default=8.23744140625)
    parser.add_argument('--hi', type=float, default=8.237442016601562)
    parser.add_argument('--output', default='arm1-gap-branches.json')
    parser.add_argument('--threshold', type=float, default=1e-4)
    parser.add_argument('--limit', type=int, default=32)
    args = parser.parse_args()
    result = run(args.lo, args.hi, args.threshold, args.limit, True)
    (HERE/args.output).write_text(json.dumps(record(result), indent=2, allow_nan=False)+'\n')
    print(json.dumps({k: result[k] for k in ('domainDeg', 'completedSubsteps', 'failure', 'minimumThrowMargin', 'seconds')}, indent=2))
    if result['failure'] or result['minimumThrowMargin'] <= 0:
        raise SystemExit(1)
