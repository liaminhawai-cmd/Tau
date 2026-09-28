"""Recheck continuous claims and cover completeness; test deliberate corruptions.

Independent cover checking, shared outward geometric evaluator. Not an
independently implemented arithmetic verifier or a floating-engine proof.
"""
import copy,json,hashlib
from pathlib import Path
import arm1_prefix as p
HERE=Path(__file__).resolve().parent

def cover(domain,rects):
    a,b,c,d=domain
    assert rects and all(a<=x<y<=b and c<=z<w<=d for x,y,z,w in rects)
    xs=sorted({a,b,*[v for r in rects for v in r[:2]]})
    # All endpoints are exact binary64 values. On each open x stripe, the
    # closed y intervals must cover [c,d]. Closed cells include boundaries.
    for x,y in zip(xs,xs[1:]):
        intervals=sorted((z,w) for lo,hi,z,w in rects if lo<=x and hi>=y)
        reached=c
        for lo,hi in intervals:
            assert lo<=reached, ('gap',x,y,reached,lo)
            reached=max(reached,hi)
        assert reached==d, ('uncovered stripe',x,y,reached)

def check(data):
    assert data['pose']==p.f.POSE
    assert data['domain']==[2.,18.,0.,5.625]
    assert data['defenderArm']==[1,-1] and data['attackerArm']==[0,-1]
    assert data['complete'] and not data['unchecked'] and not data['unresolved']
    cover(data['domain'],[r['rect'] for r in data['cells']])
    for row in data['cells']:
        actual=p.check_rect(row['rect'])
        assert actual is not None
        assert row=={'rect':row['rect'],**actual}
    edge=p.f.V(66.667)+p.f.V(.5)
    assert data['edgeThreshold']==edge.bounds()
    assert data['attackerRimDomain']==[0.,46.125]
    rim=data['attackerRimCells'];assert rim[0]['lo']==0 and rim[-1]['hi']==46.125
    assert all(r['lo']<r['hi'] for r in rim)
    assert all(a['hi']==b['lo'] for a,b in zip(rim,rim[1:]))
    for r in rim:
        assert r['radiusUpper']==p.rim_upper(r['lo'],r['hi'])
        assert r['radiusUpper']<(edge-p.f.V(.0003)).lo
    assert data['attackerRadiusUpper']==max(r['radiusUpper'] for r in rim)
    witness=p.contact_witness()
    assert data['contactWitness']==witness
    assert witness['distanceUpper']<witness['contactThresholdLower']

if __name__=='__main__':
    data=json.loads((HERE/'arm1-prefix.json').read_text());check(data)
    corrupt=copy.deepcopy(data);corrupt['cells'].pop(0)
    try:check(corrupt)
    except AssertionError:pass
    else:raise AssertionError('missing-cell control unexpectedly accepted')
    corrupt=copy.deepcopy(data);corrupt['cells'][0]['legLower']+=1
    try:check(corrupt)
    except AssertionError:pass
    else:raise AssertionError('altered-bound control unexpectedly accepted')
    print(json.dumps({'prefixCells':len(data['cells']),'rimCells':len(data['attackerRimCells']),
      'noContactRectangle':data['domain'],'attackerRadiusUpper':data['attackerRadiusUpper'],
      'contactWitnessDistanceUpper':data['contactWitness']['distanceUpper'],
      'negativeControlsPassed':2,'sha256':hashlib.sha256((HERE/'arm1-prefix.json').read_bytes()).hexdigest()},indent=2))
