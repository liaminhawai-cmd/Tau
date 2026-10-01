"""Recompute every leaf; validate a gap-free cover and all archived claims.

Shares the propagation implementation. Separate Decimal trajectories are an
implementation cross-check, not a replacement for the continuous enclosure.
"""
import copy,json,sys
from pathlib import Path
from cover_arm1_reply import sources,record
from reply_zonotope import run
HERE=Path(__file__).resolve().parent

def structural(data):
    assert data['complete'] and not data['pending'] and not data['unresolved']
    assert data['sourceHashes']==sources()
    leaves=data['leaves'];lo,hi=data['domainDeg']
    assert leaves and lo<hi
    assert leaves[0]['defenderDomainDeg'][0]==lo and leaves[-1]['defenderDomainDeg'][1]==hi
    assert all(a['defenderDomainDeg'][1]==b['defenderDomainDeg'][0] for a,b in zip(leaves,leaves[1:]))
    assert all(r['defenderDomainDeg'][0]<r['defenderDomainDeg'][1] and r['completedSubsteps']==123
        and r['failure'] is None and r['finalMarginLower']>0 for r in leaves)
    assert data['marginLower']==min(r['finalMarginLower'] for r in leaves)

def verify_row(row):
    actual=record(run(*row['defenderDomainDeg']))
    assert actual==row, ('propagation differs',row['defenderDomainDeg'])

if __name__=='__main__':
    filename=sys.argv[1] if len(sys.argv)>1 else 'arm1-local-reply-cover.json'
    data=json.loads((HERE/filename).read_text());structural(data)
    for i,row in enumerate(data['leaves']):
        verify_row(row)
        print('rechecked',i+1,'/',len(data['leaves']),row['defenderDomainDeg'],flush=True)
    bad=copy.deepcopy(data);bad['leaves'].pop(0)
    try:structural(bad)
    except AssertionError:pass
    else:raise AssertionError('missing-cell control accepted')
    bad=copy.deepcopy(data);bad['marginLower']+=1
    try:structural(bad)
    except AssertionError:pass
    else:raise AssertionError('altered-margin control accepted')
    row=copy.deepcopy(data['leaves'][0]);row['propagationSha256']='0'*64
    try:verify_row(row)
    except AssertionError:pass
    else:raise AssertionError('altered-trace control accepted')
    print(json.dumps({'leavesRechecked':len(data['leaves']),'minimumMargin':data['marginLower'],
      'negativeControlsPassed':3,'sourceHashesVerified':True},indent=2))
