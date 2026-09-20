"""Outward-rounded branch enumeration for a local H2/H3 geometry box.

Uses binary64 interval endpoints, one outward nextafter after every arithmetic
operation, and Taylor enclosures for sin/cos (no libm sin/cos for proof bounds).
This is a local real-geometry bound, not a certificate of trajectory containment
or a bound on every rounding operation of the game's floating-point solver.
"""
import math,itertools,json
from pathlib import Path
from functools import lru_cache

HERE=Path(__file__).resolve().parent
down=lambda x:math.nextafter(x,-math.inf)
up=lambda x:math.nextafter(x,math.inf)
class V:
    __slots__=('lo','hi')
    def __init__(self,a,b=None):self.lo=float(a);self.hi=float(a if b is None else b)
    def __add__(a,b):
        b=cv(b);return V(down(a.lo+b.lo),up(a.hi+b.hi))
    __radd__=__add__
    def __neg__(a):return V(-a.hi,-a.lo)
    def __sub__(a,b):return a+-cv(b)
    def __rsub__(a,b):return cv(b)+-a
    def __mul__(a,b):
        b=cv(b);p=[a.lo*b.lo,a.lo*b.hi,a.hi*b.lo,a.hi*b.hi];return V(down(min(p)),up(max(p)))
    __rmul__=__mul__
    def __truediv__(a,b):
        b=cv(b)
        if b.lo<=0<=b.hi:raise ZeroDivisionError()
        return a*V(down(1/b.hi),up(1/b.lo))
    def __rtruediv__(a,b):return cv(b)/a
    def sq(a):
        if a.lo<=0<=a.hi:return V(0,up(max(a.lo*a.lo,a.hi*a.hi)))
        return V(down(min(a.lo*a.lo,a.hi*a.hi)),up(max(a.lo*a.lo,a.hi*a.hi)))
    def sqrt(a):
        if a.lo<0:raise ValueError('negative sqrt lower endpoint')
        return V(max(0,down(math.sqrt(a.lo))),up(math.sqrt(a.hi)))
    def bounds(a):return [a.lo,a.hi]
cv=lambda x:x if isinstance(x,V) else V(x)
dot=lambda a,b:sum((x*y for x,y in zip(a,b)),V(0))
sub=lambda a,b:[x-y for x,y in zip(a,b)]
add=lambda a,b:[x+y for x,y in zip(a,b)]
scale=lambda a,t:[x*t for x in a]
norm=lambda a:sum((x.sq() for x in a),V(0)).sqrt()

@lru_cache(None)
def point_trig(x,cosine):
    # Degree 40/41 Taylor polynomial; derivative remainder bounded by
    # |x|^(degree+1)/(degree+1)! since all derivatives of sin/cos have norm <=1.
    v=V(x);term=V(1) if cosine else v;out=term;degree=0 if cosine else 1
    for _ in range(20):
        term=-term*v*v/((degree+1)*(degree+2));degree+=2;out=out+term
    rem=V(1)
    for j in range(1,degree+2):rem=rem*abs(x)/j
    return V(down(out.lo-rem.hi),up(out.hi+rem.hi))
def trig(a,cosine=False):
    m=(a.lo+a.hi)/2;r=up(max(abs(m-a.lo),abs(a.hi-m)))
    c=point_trig(m,cosine)
    return V(max(-1,down(c.lo-r)),min(1,up(c.hi+r)))
sin=lambda x:trig(cv(x));cos=lambda x:trig(cv(x),True)

R=V(23.095);I=V(373.36531749999995);PI=V(down(math.pi),up(math.pi));DEG=PI/180
ELL=2*R*sin(PI/48)
PHI=[PI*k/24 for k in range(13)]
SP=[sin(p) for p in PHI];CP=[cos(p) for p in PHI]
SM=[sin(PI*(2*k+1)/48) for k in range(12)];CM=[cos(PI*(2*k+1)/48) for k in range(12)]
pcs=json.loads((HERE/'pieces.json').read_text());at=pcs[1]
pa0=[V(at['x']),V(at['y'])]
P=[pa0[0]+R*cos(V(at['rot'])),pa0[1]+R*sin(V(at['rot']))]
REFERENCES=json.loads((HERE/'reference-poses.json').read_text())['arm0']
REF=REFERENCES[83]['pre']
REFCONTACT=REFERENCES[83]['closest']

def vtx(hub,theta,k):return [hub[0]+R*SP[k]*cos(theta),hub[1]+R*SP[k]*sin(theta),R*CP[k]]
def tangent(theta,k):return [CM[k]*cos(theta),CM[k]*sin(theta),-SM[k]]
def aabb(p0,p1):return [V(min(x.lo,y.lo),max(x.hi,y.hi)) for x,y in zip(p0,p1)]
def lower_box_distance(a,b):
    d=[]
    for x,y in zip(a,b):
        z=sub([x],[y])[0];d.append(V(max(0,z.lo,-z.hi)))
    return norm(d).lo
def clip(x):
    if x.hi<0 or x.lo>ELL.hi:return None
    return V(max(0,x.lo),min(ELL.hi,x.hi))

def proposed_parameters(a0,a1,b0,b1):
    # Floating-point optimization only PROPOSES parameters in [0,1]. Every
    # proposed point is then evaluated with proof intervals, so optimizer
    # accuracy is unnecessary for validity of the distance upper bound.
    a0,a1,b0,b1=[[.5*(x.lo+x.hi) for x in p] for p in [a0,a1,b0,b1]]
    u=[y-x for x,y in zip(a0,a1)];v=[y-x for x,y in zip(b0,b1)];r=[x-y for x,y in zip(a0,b0)]
    dp=lambda a,b:sum(x*y for x,y in zip(a,b))
    aa=dp(u,u);ee=dp(v,v);ff=dp(v,r);cc=dp(u,r);bb=dp(u,v);den=aa*ee-bb*bb
    clamp=lambda x:max(0,min(1,x))
    s=clamp((bb*ff-cc*ee)/den) if den>1e-12 else 0;t=(bb*s+ff)/ee
    if t<0:t=0;s=clamp(-cc/aa)
    elif t>1:t=1;s=clamp((bb-cc)/aa)
    return s,t

def evaluate(domain):
    x,y,theta,alpha=domain;ta=V(at['rot'])-alpha
    # Pivot 0: hub = P - R e(theta_attacker).
    hubA=[P[0]-R*cos(ta),P[1]-R*sin(ta)]
    A=[vtx(hubA,ta,k) for k in range(13)];W=[vtx([x,y],theta,k) for k in range(13)]
    ua=[tangent(ta,k) for k in range(12)];vb=[tangent(theta,k) for k in range(12)]
    # A fixed admissible point pair supplies a global minimum-distance upper bound.
    ca,cb=REFCONTACT['a'],REFCONTACT['b']
    candidateA=add(A[ca],scale(sub(A[ca+1],A[ca]),V(REFCONTACT['s'])))
    candidateV=add(W[cb],scale(sub(W[cb+1],W[cb]),V(REFCONTACT['t'])))
    upper=norm(sub(candidateV,candidateA)).hi
    for ai in range(max(0,ca-1),min(12,ca+2)):
      for bi in range(max(0,cb-1),min(12,cb+2)):
        ss,tt=proposed_parameters(A[ai],A[ai+1],W[bi],W[bi+1])
        pp=add(A[ai],scale(sub(A[ai+1],A[ai]),V(ss)))
        vv=add(W[bi],scale(sub(W[bi+1],W[bi]),V(tt)))
        upper=min(upper,norm(sub(vv,pp)).hi)
    ft=theta+2*PI/3;f=[cos(ft),sin(ft)];F=[x+R*f[0],y+R*f[1]];fr=norm(F);u=[v/fr for v in F]
    loRad=math.inf;hiRad=-math.inf;loG=math.inf;hiG=-math.inf;loA=math.inf;hiA=-math.inf;loC=math.inf;hiC=-math.inf;rnMax=0;count=0;regimes=set()
    for ai in range(12):
      for bi in range(12):
        if lower_box_distance(aabb(A[ai],A[ai+1]),aabb(W[bi],W[bi+1]))>upper:continue
        aa,bb=ua[ai],vb[bi];r=sub(W[bi],A[ai]);c=dot(aa,bb);ar=dot(aa,r);br=dot(bb,r)
        for sa,tb in itertools.product([-1,0,1],repeat=2):
          if sa==0 and tb==0:
            den=1-c.sq()
            if den.lo<=0:raise RuntimeError('Unresolved parallel candidate')
            t=(c*ar-br)/den;s=ar+c*t
          elif sa==0:
            t=V(0) if tb<0 else ELL;s=ar+c*t
          elif tb==0:
            s=V(0) if sa<0 else ELL;t=c*s-br
          else:s=V(0) if sa<0 else ELL;t=V(0) if tb<0 else ELL
          s=clip(s);t=clip(t)
          if s is None or t is None:continue
          w=sub(add(r,scale(bb,t)),scale(aa,s));dwA=dot(w,aa);dwV=dot(w,bb)
          if (sa<0 and dwA.lo>0) or (sa>0 and dwA.hi<0) or (tb<0 and dwV.hi<0) or (tb>0 and dwV.lo>0):continue
          d=norm(w)
          if d.lo>upper:continue
          wh=norm(w[:2])
          if wh.lo<=0 or d.lo<=0:raise RuntimeError('Unresolved zero normal')
          nh=[w[0]/wh,w[1]/wh]
          if sa==0 and tb==0:
            cross=[aa[1]*bb[2]-aa[2]*bb[1],aa[2]*bb[0]-aa[0]*bb[2],aa[0]*bb[1]-aa[1]*bb[0]]
            orientation=dot(w,cross)
            if orientation.lo>0 or orientation.hi<0:
              if orientation.hi<0:cross=[-v for v in cross]
              ch=norm(cross[:2])
              if ch.lo>0:nh=[cross[0]/ch,cross[1]/ch]
          lever=[R*SP[bi]*cos(theta)+t*bb[0],R*SP[bi]*sin(theta)+t*bb[1]]
          rn=lever[0]*nh[1]-lever[1]*nh[0]
          rad=(wh/d)*dot(nh,u)
          loRad=min(loRad,rad.lo);hiRad=max(hiRad,rad.hi)
          g=dot(nh,u)+rn/I*R*dot([-f[1],f[0]],u)
          contactA=add(A[ai],scale(aa,s));rr=[contactA[0]-P[0],contactA[1]-P[1]]
          ah=dot([rr[1],-rr[0]],nh);closing=(wh/d)*ah
          loG=min(loG,g.lo);hiG=max(hiG,g.hi);loA=min(loA,ah.lo);hiA=max(hiA,ah.hi);loC=min(loC,closing.lo);hiC=max(hiC,closing.hi)
          rnMax=max(rnMax,abs(rn.lo),abs(rn.hi));count+=1;regimes.add((ai,bi,sa,tb))
    if not count:raise RuntimeError('No surviving minimizer: coverage failure')
    return dict(radialDerivative=[loRad,hiRad],g=[loG,hiG],horizontalAdvancePerRadian=[loA,hiA],closingPerRadian=[loC,hiC],rnMax=rnMax,regimes=sorted(regimes),branchCount=count)

