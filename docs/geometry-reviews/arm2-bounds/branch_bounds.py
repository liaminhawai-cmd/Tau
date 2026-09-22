"""Enumerate every surviving closest-feature branch and bound each smooth formula."""
import json,sys,itertools,math
from pathlib import Path
from bounds import J,jdot,cross,vertex,tangent,clip,maxabs,minabs
from interval_core import V,R,I,PI,ELL,SP,CP,SM,CM,up,down,dot,sub,add,scale,norm
HERE=Path(__file__).resolve().parent

def candidates(row,box):
 x,y,th=box;at=row['att'];ta=V(at['rot'])+2*PI/3
 A=[vertex([V(at['x']),V(at['y'])],ta,k) for k in range(13)];B=[vertex([x,y],th,k) for k in range(13)]
 ua=[tangent(ta,k) for k in range(12)];vb=[tangent(th,k) for k in range(12)]
 a,b=row['a'],row['b']
 ap=add(A[a],scale(sub(A[a+1],A[a]),V(row['s'])));bp=add(B[b],scale(sub(B[b+1],B[b]),V(row['t'])))
 upper=norm(sub(bp,ap)).hi
 kept=[]
 for ai,bi in itertools.product(range(12),repeat=2):
  low=[]
  for j in range(3):
   low.append(V(max(0,down(min(A[ai][j].lo,A[ai+1][j].lo)-max(B[bi][j].hi,B[bi+1][j].hi)),down(min(B[bi][j].lo,B[bi+1][j].lo)-max(A[ai][j].hi,A[ai+1][j].hi)))))
  sq=sum((v.sq() for v in low),V(0))
  if V(max(0,sq.lo),sq.hi).sqrt().lo>upper:continue
  u,v=ua[ai],vb[bi];r=sub(B[bi],A[ai]);c=dot(u,v);ar=dot(u,r);br=dot(v,r)
  for sa,tb in itertools.product([-1,0,1],repeat=2):
   if sa==0 and tb==0:
    den=1-c.sq()
    if den.lo<=0:raise ValueError('Unresolved parallel pair')
    t=(c*ar-br)/den;s=ar+c*t
   elif sa==0:t=V(0) if tb<0 else ELL;s=ar+c*t
   elif tb==0:s=V(0) if sa<0 else ELL;t=c*s-br
   else:s=V(0) if sa<0 else ELL;t=V(0) if tb<0 else ELL
   s=clip(s);t=clip(t)
   if s is None or t is None:continue
   w=sub(add(r,scale(v,t)),scale(u,s));da=dot(w,u);db=dot(w,v)
   if (sa<0 and da.lo>0) or (sa>0 and da.hi<0) or (tb<0 and db.hi<0) or (tb>0 and db.lo>0):continue
   if norm(w).lo>upper:continue
   kept.append((ai,bi,sa,tb))
 if not kept:raise ValueError('Empty closest-feature cover')
 return kept,A,upper

def jet_branch(box,A,key,raw=False):
 x,y,th=box;a,b,sa,tb=key
 X=J(x,[V(1),V(0),V(0)]);Y=J(y,[V(0),V(1),V(0)]);T=J(th,[V(0),V(0),1/I.sqrt()])
 # Compute the attacker unit direction from its endpoints and the common real chord length.
 U=[J((A[a+1][i]-A[a][i])/ELL) for i in range(3)]
 VJ=[T.cos()*CM[b],T.sin()*CM[b],J(-SM[b])]
 BJ=[X+T.cos()*(R*SP[b]),Y+T.sin()*(R*SP[b]),J(R*CP[b])]
 W=[BJ[i]-A[a][i] for i in range(3)]
 if sa==0 and tb==0:
  N=cross(U,VJ);d=jdot(W,N)/jdot(N,N).sqrt()
  if d.v.hi<0:d=-d
 elif sa==0:
  end=J(0) if tb<0 else J(ELL);W=[W[i]+VJ[i]*end for i in range(3)];s=jdot(U,W)
  W=[W[i]-U[i]*s for i in range(3)];d=jdot(W,W).sqrt()
 elif tb==0:
  end=J(0) if sa<0 else J(ELL);W=[W[i]-U[i]*end for i in range(3)];t=-jdot(VJ,W)
  W=[W[i]+VJ[i]*t for i in range(3)];d=jdot(W,W).sqrt()
 else:
  s=J(0) if sa<0 else J(ELL);t=J(0) if tb<0 else J(ELL)
  W=[W[i]+VJ[i]*t-U[i]*s for i in range(3)];d=jdot(W,W).sqrt()
 if d.v.lo<=0:raise ValueError('No positive distance bound')
 if raw:return d
 m=norm([V(minabs(q)) for q in d.g]).lo;G=norm([V(maxabs(q)) for q in d.g]).hi
 if sa==0 and tb==0:
  aa=V(maxabs(d.h[0][2]));bb=V(maxabs(d.h[1][2]));cc=V(maxabs(d.h[2][2]));H=((cc+(cc.sq()+4*(aa.sq()+bb.sq())).sqrt())/2).hi
 else:H=norm([V(maxabs(q)) for r in d.h for q in r]).hi
 if m<=0:raise ValueError('No positive gradient bound')
 return {'branch':list(key),'m':m,'G':G,'B':H,'distance':d.v.bounds(),'gradient':[q.bounds() for q in d.g]}

def run():
 data=json.loads(Path(sys.argv[1]).read_text());old=json.loads((HERE/'input-bounds.json').read_text());out=[]
 for k in [111,112]:
  row=next(r for r in data['rows'] if r['k']==k and r['iter']==0)
  box=[V(*q) for q in next(r for r in old['results'] if r['k']==k)['box']]
  kept,A,upper=candidates(row,box);branches=[jet_branch(box,A,key) for key in kept]
  rec={'k':k,'domain':[q.bounds() for q in box],'admissibleDistanceUpper':upper,'m':min(r['m'] for r in branches),'G':max(r['G'] for r in branches),'B':max(r['B'] for r in branches),'branches':branches}
  out.append(rec);print(json.dumps(rec,indent=2),flush=True)
 result={'scope':'Uniform derivative bounds for each surviving smooth closest-feature formula. This alone does not establish differentiability of the minimum across feature switches, trajectory containment, other-contact exclusion or a throw.', 'results':out}
 (HERE/'branch-bounds.json').write_text(json.dumps(result,indent=2)+'\n')
if __name__=='__main__':run()
