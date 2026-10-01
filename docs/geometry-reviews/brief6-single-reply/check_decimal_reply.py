"""Compare independent 80-digit point trajectories against archived cover leaves."""
import json,hashlib
from decimal import Decimal as D
from pathlib import Path
import decimal_reply as d
from reply_zonotope import run
from cover_arm1_reply import record
from check_reply_cover import structural
HERE=Path(__file__).resolve().parent
data=json.loads((HERE/'arm1-local-reply-cover.json').read_text());structural(data)
results=[]
for angle in [8.,8.005,8.01]:
    leaf=next(r for r in data['leaves'] if r['defenderDomainDeg'][0]<=angle<=r['defenderDomainDeg'][1])
    enclosure=run(*leaf['defenderDomainDeg']);assert record(enclosure)==leaf
    point=d.trace(angle);failures=[];checked=0
    for row,step in zip(enclosure['log'],point['steps']):
        assert row['step']==step['step']
        for i,key in enumerate(['x','y','rot']):
            checked+=1;lo,hi=map(D.from_float,row['box'][i]);value=D(step['pose'][i])
            if not lo<=value<=hi:failures.append({'step':step['step'],'coordinate':key,'bounds':[str(lo),str(hi)],'actual':str(value)})
    results.append({'angle':angle,'leaf':leaf['defenderDomainDeg'],'coordinateChecks':checked,
      'failures':failures,'trajectory':point})
    print('decimal check',angle,checked,'coordinates, failures',len(failures),flush=True)
out={'scope':'Independent high-precision sampled consistency check; not the continuous proof or an engine correspondence theorem.',
  'precision':d.getcontext().prec,'sourceSha256':hashlib.sha256((HERE/'decimal_reply.py').read_bytes()).hexdigest(),
  'totalCoordinateChecks':sum(r['coordinateChecks'] for r in results),'failureCount':sum(len(r['failures']) for r in results),'results':results}
(HERE/'arm1-decimal-check.json').write_text(json.dumps(out,indent=2)+'\n')
assert out['failureCount']==0
