"""Local real-geometry chart bound, not a reachable-set or floating-engine proof."""
import itertools,json,time
from pathlib import Path
import interval_geometry as g
HERE=Path(__file__).resolve().parent
results=[];start=time.time()
for k in range(74,105):
 row=g.REFERENCES[k-1];pre=row['pre'];post=row['pose']
 # Candidate boxes around both ends; whether true uncertain trajectories stay
 # inside is a separate proof obligation. Alpha covers the entire sweep slab.
 g.REFCONTACT=row['closest']
 domain=[g.V(g.down(min(pre[key],post[key])-h),g.up(max(pre[key],post[key])+h)) for key,h in [('x',.125),('y',.125),('rot',.01)]]
 domain.append(g.V((g.DEG*(k-1)/3).lo,(g.DEG*k/3).hi))
 n=2;cells=[]
 for v in domain:
  m=(v.lo+v.hi)/2;cells.append([g.V(v.lo,m),g.V(m,v.hi)])
 rr=[g.evaluate(c) for c in itertools.product(*cells)]
 rec={'k':k,'domain':[v.bounds() for v in domain],'subboxes':len(rr),
      'radialDerivative':[min(x['radialDerivative'][0] for x in rr),max(x['radialDerivative'][1] for x in rr)],
      'g':[min(x['g'][0] for x in rr),max(x['g'][1] for x in rr)]}
 results.append(rec);print(k,rec['radialDerivative'],flush=True)
out={'scope':'Outward-rounded real-geometry bounds for closest distance of leg pair (0,0). Every endpoint/interior candidate retained. Candidate boxes do not prove trajectory containment, other-contact exclusion, root existence or floating-point correspondence.',
 'candidateHalfWidths':[.125,.125,.01],'steps':[74,104],'lowerBound':min(x['radialDerivative'][0] for x in results),'results':results,'seconds':time.time()-start}
(HERE/'park-bounds.json').write_text(json.dumps(out,indent=2)+'\n')
