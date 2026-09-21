"""Independent interval check of the shared-endpoint squared-gap identity at centres."""
import json,sys
from pathlib import Path
from branch_bounds import candidates,jet_branch
from bounds import tangent,vertex
from interval_core import V,PI,ELL,dot,sub
here=Path(__file__).resolve().parent
trace=json.loads(Path(sys.argv[1]).read_text());boxes=json.loads((here/'input-bounds.json').read_text())
for k in [111,112]:
 row=next(r for r in trace['rows'] if r['k']==k and r['iter']==0)
 box=[V(row['before'][key]) for key in ['x','y','rot']];kept,A,_=candidates(row,box)
 a,b=row['a'],row['b'];selected=(a,b,0,0);endpoint=(a+1,b,-1,0) if k==111 else (a-1,b,1,0)
 d=jet_branch(box,A,selected);dv=jet_branch(box,A,endpoint)
 actual=V(*dv['distance']).sq()-V(*d['distance']).sq()
 u=tangent(V(row['att']['rot'])+2*PI/3,a);v=tangent(box[2],b);r=sub(vertex(box[:2],box[2],b),A[a]);c=dot(u,v);den=1-c.sq();t=(c*dot(u,r)-dot(v,r))/den;s=dot(u,r)+c*t
 delta=ELL-s if k==111 else s;predicted=den*delta.sq();error=actual-predicted
 assert error.lo<=0<=error.hi
 assert actual.lo>0
 print(k,{'squaredDistanceGap':actual.bounds(),'formula':predicted.bounds(),'identityResidual':error.bounds()})
