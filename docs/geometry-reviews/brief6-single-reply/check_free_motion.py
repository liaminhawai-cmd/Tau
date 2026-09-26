"""Recheck every archived enclosure cell and reject an overlapping-segment control."""
import json
from pathlib import Path
import free_motion as f

# Cancellation distinguishes explicit left-to-right addition from compensated
# float sum(). Only the proposal uses this; interval proof arithmetic is separate.
assert f.fixed_dot([1e16,1.0,-1e16],[1.0,1.0,1.0])==0.0

data=json.loads(Path(__file__).with_name('free-motion.json').read_text())
assert data['pose']==f.POSE
assert data['thresholdUpper']=={'leg':f.LEG,'hubLeg':f.HUBLEG,'hubHub':f.HUBHUB}
cells=0
for arm in data['arms']:
    assert arm['complete'] and not arm['unresolved'] and not arm['unchecked']
    rows=arm['cover'];lo,hi=arm['domainDeg']
    assert rows[0]['loDeg']==lo and rows[-1]['hiDeg']==hi
    assert all(a['hiDeg']==b['loDeg'] for a,b in zip(rows,rows[1:]))
    att=[f.V(*v) for v in arm['attackerBox']]
    A=f.arcs(att);AH=[att[0],att[1],f.R]
    for row in rows:
        actual=f.check(arm['pivotIdx'],arm['dir'],row['loDeg'],row['hiDeg'],A,AH)
        assert actual==row
        cells+=1

# A separating-axis proposal must not certify identical segments as separated.
p=[f.V(0),f.V(0),f.V(0)];q=[f.V(1),f.V(0),f.V(0)]
assert f.segment_lower(p,q,p,q,f.LEG)<=0
# Known parallel segments: bounds must not exceed the true distance.
r=[f.V(0),f.V(3),f.V(0)];s=[f.V(1),f.V(3),f.V(0)]
bound=f.segment_lower(p,q,r,s,f.LEG)
assert f.LEG<bound<=3
print(f'{cells} continuous cells rechecked; overlap and known-distance controls passed')
