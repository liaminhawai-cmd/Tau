"""Close k111/112 by shared-endpoint dominance, with interval interior guards."""
import json,sys
from pathlib import Path
from branch_bounds import candidates,jet_branch
from bounds import tangent
from interval_core import V,PI,ELL,dot,sub
HERE=Path(__file__).resolve().parent

def close(row,box):
 kept,A,upper=candidates(row,box);a,b=row['a'],row['b'];x,y,th=box
 from bounds import vertex
 B0=vertex([x,y],th,b);u=tangent(V(row['att']['rot'])+2*PI/3,a);v=tangent(th,b)
 r=sub(B0,A[a]);c=dot(u,v);den=1-c.sq()
 assert den.lo>0
 t=(c*dot(u,r)-dot(v,r))/den;s=dot(u,r)+c*t
 assert s.lo>0 and s.hi<ELL.lo and t.lo>0 and t.hi<ELL.lo
 target=(a,b,0,0);assert target in kept
 dominated=[];unresolved=[]
 for key in kept:
  if key==target:continue
  ai,bi,sa,tb=key
  if bi==b and ((ai==a+1 and sa==-1) or (ai==a-1 and sa==1)):
   delta=ELL-s if ai==a+1 else s
   assert delta.lo>0
   gap=den*delta.sq()
   assert gap.lo>0
   dominated.append({'branch':list(key),'reason':'Shared attacker endpoint belongs to the selected chord; same victim chord', 'selectedEndpointDistance':delta.bounds(),'squaredDistanceGapLower':gap.lo})
  else:unresolved.append(list(key))
 assert not unresolved,unresolved
 result=jet_branch(box,A,target)
 return {'k':row['k'],'domain':[q.bounds() for q in box],'selected':list(target),'denominator':den.bounds(),'s':s.bounds(),'t':t.bounds(),'dominated':dominated,'unresolved':unresolved,**result}

def main():
 trace=json.loads(Path(sys.argv[1]).read_text());old=json.loads((HERE/'input-bounds.json').read_text());out=[]
 for k in [111,112]:
  row=next(r for r in trace['rows'] if r['k']==k and r['iter']==0)
  box=[V(*q) for q in next(r for r in old['results'] if r['k']==k)['box']]
  result=close(row,box);out.append(result);print(json.dumps(result,indent=2))
 previous=[r for r in old['results'] if r['status']=='bounded'];assert len(previous)==36
 combined=previous+out
 summary={'scope':'Uniform distance derivative bounds on all 38 independently proposed first-correction INPUT boxes; not a composed reachable tube or throw certificate.', 'inputBoxesBounded':len(combined),'m':min(r['m'] for r in combined),'G':max(r['G'] for r in combined),'B':max(r['B'] for r in combined),'newResults':out}
 (HERE/'dominance-bounds.json').write_text(json.dumps(summary,indent=2)+'\n');print({k:v for k,v in summary.items() if k!='newResults'})
if __name__=='__main__':main()
