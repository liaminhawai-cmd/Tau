"""Diagnostic comparison only: deliberately do not invent a rounding tolerance."""
import json,collections
from pathlib import Path
HERE=Path(__file__).resolve().parent
trace=json.loads((HERE/'arm1-eight-trace.json').read_text())
steps=[r for r in trace['trace'] if r['kind']=='step']
attempts=json.loads((HERE/'arm1-box-attempt.json').read_text())['attempts']
results=[]
for a in attempts:
    compared=0;failed=[]
    for row in a['log']:
        k=row['k']
        q=steps[k]['before'] if k<len(steps) else trace['final'][0]
        for i,key in enumerate(['x','y','rot']):
            compared+=1;lo,hi=row['box'][i];v=q[key]
            if not lo<=v<=hi:
                failed.append({'step':k,'coordinate':key,'lower':lo,'engine':v,'upper':hi,'excess':max(lo-v,v-hi)})
    results.append({'domain':a['defenderDomainDeg'],'coordinatesCompared':compared,
      'noncontained':len(failed),'maxExcess':max((r['excess'] for r in failed),default=0),
      'byCoordinate':dict(collections.Counter(r['coordinate'] for r in failed)),
      'firstNoncontainment':failed[0] if failed else None})
out={'scope':'Diagnostic mismatch between exact-rotation real initial family and floating quarter-degree engine path. No numerical tolerance or engine certificate is inferred. Only completed experimental substeps compared.','results':results}
(HERE/'arm1-engine-comparison.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
