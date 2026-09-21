"""Uniform real-geometry bounds on proposed arm-2 correction boxes, not reachable tubes."""
import sys,json,math,itertools
from pathlib import Path
from interval_core import V,cv,up,down,sin,cos,dot,sub,add,scale,norm,R,I,PI,ELL,SP,CP,SM,CM
HERE=Path(__file__).resolve().parent
class J:
 def __init__(self,v,g=None,h=None):
  self.v=cv(v);self.g=g or [V(0) for _ in range(3)];self.h=h or [[V(0) for _ in range(3)] for _ in range(3)]
 def __add__(a,b):
  b=jj(b);return J(a.v+b.v,[a.g[i]+b.g[i] for i in range(3)],[[a.h[i][j]+b.h[i][j] for j in range(3)] for i in range(3)])
 __radd__=__add__
 def __neg__(a):return J(-a.v,[-x for x in a.g],[[-x for x in r] for r in a.h])
 def __sub__(a,b):return a+-jj(b)
 def __rsub__(a,b):return jj(b)+-a
 def __mul__(a,b):
  b=jj(b);return J(a.v*b.v,[a.g[i]*b.v+a.v*b.g[i] for i in range(3)],[[a.h[i][j]*b.v+a.g[i]*b.g[j]+a.g[j]*b.g[i]+a.v*b.h[i][j] for j in range(3)] for i in range(3)])
 __rmul__=__mul__
 def chain(a,f,fp,fpp):return J(f,[fp*x for x in a.g],[[fp*a.h[i][j]+fpp*a.g[i]*a.g[j] for j in range(3)] for i in range(3)])
 def inv(a):return a.chain(1/a.v,-1/a.v.sq(),2/(a.v.sq()*a.v))
 def __truediv__(a,b):return a*jj(b).inv()
 def sqrt(a):
  s=a.v.sqrt();return a.chain(s,1/(2*s),-1/(4*s*s*s))
 def sin(a):return a.chain(sin(a.v),cos(a.v),-sin(a.v))
 def cos(a):return a.chain(cos(a.v),-sin(a.v),-cos(a.v))
jj=lambda x:x if isinstance(x,J) else J(x)
jdot=lambda a,b:sum((x*y for x,y in zip(a,b)),J(0))
cross=lambda a,b:[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
maxabs=lambda x:max(abs(x.lo),abs(x.hi))
minabs=lambda x:max(0,x.lo,-x.hi)
def vertex(hub,th,k):return [hub[0]+R*SP[k]*cos(th),hub[1]+R*SP[k]*sin(th),R*CP[k]]
def tangent(th,k):return [CM[k]*cos(th),CM[k]*sin(th),-SM[k]]
def clip(x):return None if x.hi<0 or x.lo>ELL.hi else V(max(0,x.lo),min(ELL.hi,x.hi))
def chord_branches(A,B,ua,vb):
 r=sub(B,A);c=dot(ua,vb);ar=dot(ua,r);br=dot(vb,r);out=[]
 for sa,tb in itertools.product([-1,0,1],repeat=2):
  if sa==0 and tb==0:
   den=1-c.sq()
   if den.lo<=0:return None
   t=(c*ar-br)/den;s=ar+c*t
  elif sa==0:t=V(0) if tb<0 else ELL;s=ar+c*t
  elif tb==0:s=V(0) if sa<0 else ELL;t=c*s-br
  else:s=V(0) if sa<0 else ELL;t=V(0) if tb<0 else ELL
  s=clip(s);t=clip(t)
  if s is None or t is None:continue
  w=sub(add(r,scale(vb,t)),scale(ua,s));da=dot(w,ua);db=dot(w,vb)
  if (sa<0 and da.lo>0) or (sa>0 and da.hi<0) or (tb<0 and db.hi<0) or (tb>0 and db.lo>0):continue
  out.append(norm(w))
 return out

def evaluate(row,box):
 x,y,th=box;at=row['att'];ta=V(at['rot'])+2*PI/3
 A=[vertex([V(at['x']),V(at['y'])],ta,k) for k in range(13)]
 B=[vertex([x,y],th,k) for k in range(13)]
 ua=[tangent(ta,k) for k in range(12)];vb=[tangent(th,k) for k in range(12)]
 a,b=row['a'],row['b'];u,v=ua[a],vb[b];r=sub(B[b],A[a]);c=dot(u,v);den=1-c.sq()
 if den.lo<=0:return {'status':'unresolved','reason':'parallelism'}
 t=(c*dot(u,r)-dot(v,r))/den;s=dot(u,r)+c*t
 if not (s.lo>0 and s.hi<ELL.lo and t.lo>0 and t.hi<ELL.lo):return {'status':'unresolved','reason':'interior guard','s':s.bounds(),'t':t.bounds()}
 # Scaled derivatives: coordinate 3 is sqrt(I)*theta, with the real I fixed by the source constant.
 X=J(x,[V(1),V(0),V(0)]);Y=J(y,[V(0),V(1),V(0)]);T=J(th,[V(0),V(0),1/I.sqrt()])
 U=[J(q) for q in u];VJ=[T.cos()*CM[b],T.sin()*CM[b],J(-SM[b])]
 BJ=[X+T.cos()*(R*SP[b]),Y+T.sin()*(R*SP[b]),J(R*CP[b])]
 W=[BJ[i]-A[a][i] for i in range(3)];N=cross(U,VJ);d=jdot(W,N)/jdot(N,N).sqrt()
 if d.v.hi<0:d=-d
 if d.v.lo<=0:return {'status':'unresolved','reason':'distance sign'}
 # All 143 competing chord pairs in the same leg pair must be farther away.
 competitor=math.inf
 for ai in range(12):
  for bi in range(12):
   if (ai,bi)==(a,b):continue
   lower=[]
   for dim in range(3):
    amin=min(A[ai][dim].lo,A[ai+1][dim].lo);amax=max(A[ai][dim].hi,A[ai+1][dim].hi)
    bmin=min(B[bi][dim].lo,B[bi+1][dim].lo);bmax=max(B[bi][dim].hi,B[bi+1][dim].hi)
    lower.append(V(max(0,down(amin-bmax),down(bmin-amax))))
   sq=sum((z.sq() for z in lower),V(0))
   if V(max(0,sq.lo),sq.hi).sqrt().lo>d.v.hi:continue
   bounds=chord_branches(A[ai],B[bi],ua[ai],vb[bi])
   if bounds is None:return {'status':'unresolved','reason':'competitor parallelism','other':[ai,bi]}
   if not bounds:return {'status':'unresolved','reason':'empty competitor cover','other':[ai,bi]}
   lo=min(z.lo for z in bounds);competitor=min(competitor,lo)
   if lo<=d.v.hi:return {'status':'unresolved','reason':'competing chord','other':[ai,bi],'otherLower':lo,'selectedDistance':d.v.bounds()}
 m=norm([V(minabs(v)) for v in d.g]).lo;G=norm([V(maxabs(v)) for v in d.g]).hi
 # Infinite-line distance is affine in x,y; only the last row/column can be nonzero.
 aa=V(maxabs(d.h[0][2]));bb=V(maxabs(d.h[1][2]));cc=V(maxabs(d.h[2][2]));Bnorm=((cc+(cc.sq()+4*(aa.sq()+bb.sq())).sqrt())/2).hi
 return {'status':'bounded','distance':d.v.bounds(),'m':m,'G':G,'B':Bnorm,'competitorLower':competitor,'s':s.bounds(),'t':t.bounds(),'grad':[v.bounds() for v in d.g],'hessian':[[v.bounds() for v in r] for r in d.h]}

def cover(row,box,depth=0):
 result=evaluate(row,box)
 if result['status']=='bounded':return [result],[],1
 if result['reason']!='competing chord' or depth>=9:return [],[result],1
 widths=[box[0].hi-box[0].lo,box[1].hi-box[1].lo,(box[2].hi-box[2].lo)*math.sqrt(I.hi)]
 axis=max(range(3),key=lambda i:widths[i]);v=box[axis];mid=(v.lo+v.hi)/2
 left=box.copy();right=box.copy();left[axis]=V(v.lo,mid);right[axis]=V(mid,v.hi)
 ga,ba,na=cover(row,left,depth+1);gb,bb,nb=cover(row,right,depth+1)
 return ga+gb,ba+bb,1+na+nb

def main():
 data=json.loads(Path(sys.argv[1] if len(sys.argv)>1 else '../contact-map/trace.json').read_text());out=[]
 input_only='--input-only' in sys.argv[2:]
 for row in data['rows']:
  if row['iter']!=0:continue
  # Same axis half-width as the Brief 6 target; corrected pose must be regenerated from the logged push.
  q=row['before'];lam=row['lambda'];hf=row['hf'];rn=row['rn']
  # Use the stored before/after hull of this nominal finite correction, never infer it from a rounded angle.
  after=q if input_only else row['after']
  assert (row['i'],row['j'],row['kind'])==(1,0,'leg')
  hr=V(.002)*PI/180
  widths=[V(.0002),V(.0002),hr]
  box=[V(down(min(q[k],after[k])-w.hi),up(max(q[k],after[k])+w.hi)) for k,w in zip(['x','y','rot'],widths)]
  good,bad,nodes=cover(row,box)
  result={'status':'bounded' if not bad else 'unresolved','subboxes':len(good)+len(bad),'nodes':nodes,'reasons':sorted(set(x['reason'] for x in bad)),'reason':bad[0]['reason'] if bad else '', 'm':min((x['m'] for x in good),default=None),'G':max((x['G'] for x in good),default=None),'B':max((x['B'] for x in good),default=None)};out.append({'k':row['k'],'a':row['a'],'b':row['b'],'box':[v.bounds() for v in box],**result})
  print(row['k'],result['status'],result.get('reason',''),flush=True)
 good=[r for r in out if r['status']=='bounded']
 summary={'scope':'Uniform real-geometry gradient/Hessian bounds on proposed first-correction boxes; only the attacker-leg-1/victim-leg-0 pair is considered. Not reachable-set containment, full engine contact exclusion, or floating-point correspondence.', 'mode':'input-only' if input_only else 'correction-hull','attempted':len(out),'bounded':len(good),'global_m':min((r['m'] for r in good),default=None),'global_G':max((r['G'] for r in good),default=None),'global_B':max((r['B'] for r in good),default=None),'results':out}
 (HERE/('input-bounds.json' if input_only else 'bounds.json')).write_text(json.dumps(summary,indent=2)+'\n');print({k:v for k,v in summary.items() if k!='results'})
if __name__=='__main__':main()
