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
