"""Experimental interval first derivatives for the ordinary contact program.

Each jet carries an interval value, interval Jacobian row, and a centre-value
enclosure. Candidate branch extensions are unioned, never selected from a trace.
The global radius is fixed for one pass. This module does not claim engine
floating-point correspondence or legality of the prescribed attacker path.
"""
import free_motion as f
from itertools import zip_longest
V=f.V
H=[0.,0.,0.]
INPUT_M=None
COUNTS={}

def hull(xs):return V(min(x.lo for x in xs),max(x.hi for x in xs))
def maxabs(x):return max(abs(x.lo),abs(x.hi))
def count(name):COUNTS[name]=COUNTS.get(name,0)+1
def pairs(a,b):return zip_longest(a,b,fillvalue=V(0))

class J:
    __slots__=('v','g','c')
    def __init__(self,v,g=None,c=None):
        self.v=v if isinstance(v,V) else V(v)
        self.g=g if g is not None else [V(0),V(0),V(0)]
        self.c=self.v if c is None else c
        # Mean-value enclosure for every retained smooth branch extension.
        if INPUT_M is None:
            r=sum((V(maxabs(x))*h for x,h in zip(self.g,H)),V(0)).hi
        else:
            # Bound g dot (M epsilon) by columns, preserving cancellations
            # between translation and rotation inside geometric evaluations.
            terms=[V(maxabs(sum((self.g[i]*col[i] for i in range(3)),V(0)))) for col in INPUT_M]
            terms.extend(V(maxabs(x))*h for x,h in zip(self.g[3:],H[3:]))
            r=sum(terms,V(0)).hi
        mv=self.c+V(-r,r)
        lo,hi=max(self.v.lo,mv.lo),min(self.v.hi,mv.hi)
        if lo>hi:raise ValueError('inconsistent natural/mean-value bounds')
        self.v=V(lo,hi)
    def __add__(a,b):
        b=cv(b);return J(a.v+b.v,[x+y for x,y in pairs(a.g,b.g)],a.c+b.c)
    __radd__=__add__
    def __neg__(a):return J(-a.v,[-x for x in a.g],-a.c)
    def __sub__(a,b):return a+-cv(b)
    def __rsub__(a,b):return cv(b)+-a
    def __mul__(a,b):
        b=cv(b);return J(a.v*b.v,[x*b.v+y*a.v for x,y in pairs(a.g,b.g)],a.c*b.c)
    __rmul__=__mul__
    def reciprocal(a):
        value=1/a.v;return J(value,[-x/a.v.sq() for x in a.g],1/a.c)
    def __truediv__(a,b):return a*cv(b).reciprocal()
    def __rtruediv__(a,b):return cv(b)*a.reciprocal()
    def sq(a):return J(a.v.sq(),[2*a.v*x for x in a.g],a.c.sq())
    def sqrt(a):
        if a.v.lo<=0 or a.c.lo<=0:raise ValueError('sqrt derivative domain')
        value=a.v.sqrt();return J(value,[x/(2*value) for x in a.g],a.c.sqrt())

def cv(x):return x if isinstance(x,J) else J(x)
def union(xs):
    if len(xs)==1:return xs[0]
    return J(hull([x.v for x in xs]),[hull([x.g[i] if i<len(x.g) else V(0) for x in xs]) for i in range(len(H))],hull([x.c for x in xs]))
def vunion(xs):return [union([x[i] for x in xs]) for i in range(3)]
def sin(a):
    a=cv(a);return J(f.sin(a.v),[f.cos(a.v)*x for x in a.g],f.sin(a.c))
def cos(a):
    a=cv(a);return J(f.cos(a.v),[-f.sin(a.v)*x for x in a.g],f.cos(a.c))
def dot(a,b):return sum((x*y for x,y in zip(a,b)),J(0))
def norm(a):return sum((x.sq() for x in a),J(0)).sqrt()
def sub(a,b):return [x-y for x,y in zip(a,b)]
def lerp(a,b,t):return [x+(y-x)*t for x,y in zip(a,b)]
def positive(a):
    if a.v.lo>=0:return a
    if a.v.hi<=0:return J(0)
    count('positiveSwitches')
    # Lift max(t,0) into a family of smooth functions. For alpha in [0,1],
    # 0 <= max(t,0)-alpha*t <= max(-alpha*l,(1-alpha)*u).
    # A shared fresh eta in [-1,1] carries that error through every output.
    l,u=a.v.lo,a.v.hi
    alpha=max(0.,min(1.,u/(u-l)))
    error=max((-V(alpha)*l).hi,((1-V(alpha))*u).hi)
    beta=V(error)/2
    idx=len(H);H.append(1.)
    gradient=[V(0) for _ in H];gradient[idx]=beta
    noise=J(V(-beta.hi,beta.hi),gradient,V(0))
    # Do not intersect with the original clipped interval: the lifted smooth
    # family must remain enclosed on the WHOLE auxiliary-parameter box.
    return a*alpha+beta+noise
def clamp(a):
    if a.v.lo>=1:return J(1)
    if a.v.hi<=0:return J(0)
    if a.v.lo>=0 and a.v.hi<=1:return a
    count('clampSwitches')
    return positive(a)-positive(a-1)

def arcs(q):
    result=[]
    for j in range(3):
        angle=q[2]+2*f.PI*j/3;c,s=cos(angle),sin(angle)
        result.append([[q[0]+c*f.S[k],q[1]+s*f.S[k],J(f.H[k])] for k in range(13)])
    return result

def closest(a,b,c,d):
    u,v,w=sub(b,a),sub(d,c),sub(a,c)
    aa,ee,ff,cc,bb=dot(u,u),dot(v,v),dot(v,w),dot(u,w),dot(u,v)
    den=aa*ee-bb*bb
    if aa.v.lo<=1e-12 or ee.v.lo<=1e-12:raise ValueError('degenerate segment guard')
    if den.v.lo>1e-12:ss=clamp((bb*ff-cc*ee)/den)
    elif den.v.hi<=1e-12:ss=J(0)
    else:raise ValueError('near-parallel branch unresolved')
    tt=(bb*ss+ff)/ee;cases=[]
    if tt.v.lo<0:cases.append((clamp(-cc/aa),J(0)))
    if tt.v.hi>1:cases.append((clamp((bb-cc)/aa),J(1)))
    if tt.v.hi>=0 and tt.v.lo<=1:cases.append((ss,tt))
    if len(cases)>1:count('segmentBranches')
    return [(lerp(a,b,s),lerp(c,d,t)) for s,t in cases]

def arc_contact(A,B,D):
    cs=[];upper=float('inf')
    for i in range(12):
        for j in range(12):
            ends=[A[i],A[i+1],B[j],B[j+1]]
            if f.segment_lower(*[[x.v for x in q] for q in ends],D.hi)>D.hi:continue
            pair=[]
            branches=closest(*ends)
            for pa,pb in branches:
                dist=norm(sub(pb,pa))
                pair.append(dist.v.hi)
                if dist.v.lo<D.hi:cs.append((pa,pb,dist,len(branches)==1))
            # Union ALL algorithm branches of this pair, before filtering:
            # at each point one applies, hence max is a valid upper bound.
            upper=min(upper,max(pair))
    if not cs:return [],False
    cs=[c for c in cs if c[2].v.lo<=upper]
    if len(cs)>1:count('closestUnions')
    # A full-domain segment candidate also covers identity through its clipped
    # penetration when there is no contact. Otherwise retain explicit identity
    # unless the global upper bound proves a contact at every input.
    identity_covered=upper<D.lo or any(c[3] for c in cs)
    return [c[:3] for c in cs],identity_covered

def point_contact(p,A,D,reverse=False):
    cs=[]
    for i in range(12):
        if f.segment_lower(*[[x.v for x in q] for q in [p,p,A[i],A[i+1]]],D.hi)>D.hi:continue
        u=sub(A[i+1],A[i]);t=clamp(dot(sub(p,A[i]),u)/dot(u,u));q=lerp(A[i],A[i+1],t)
        dist=norm(sub(q,p))
        if dist.v.lo<D.hi:cs.append((q,p,dist) if reverse else (p,q,dist))
    if not cs:return [],False
    # These clamped projections remain on their segment everywhere in the box.
    upper=min(c[2].v.hi for c in cs)
    return [c for c in cs if c[2].v.lo<=upper],True

def push(q,selection,D):
    contacts,forced=selection
    if not contacts:return q
    images=[] if forced else [q]
    # A global contact bound or a full-domain clipped candidate covers identity.
    for pa,pb,d in contacts:
        if d.v.lo<=.3:raise ValueError('deep / zero-distance branch unresolved')
        delta=sub(pb,pa);horizontal=norm(delta[:2]);hf=horizontal/d
        if hf.v.lo<=.35:raise ValueError('horizontal-floor branch unresolved')
        sep=positive(J(D)-d)/hf
        if sep.v.hi>=.8:raise ValueError('correction-cap branch unresolved')
        nx,ny=delta[0]/horizontal,delta[1]/horizontal
        rn=(pb[0]-q[0])*ny-(pb[1]-q[1])*nx
        inertia=V(.7)*f.R*f.R
        lam=sep/(1+rn.sq()/inertia)
        images.append([q[0]+lam*nx,q[1]+lam*ny,q[2]+lam*rn/inertia])
    count('contactMaps')
    return vunion(images)

def solve_pass(att,c,box,h,M=None):
    global H,COUNTS,INPUT_M
    H=list(h);COUNTS={};INPUT_M=M
    q=[J(box[i],[V(int(i==j)) for j in range(3)],V(c[i])) for i in range(3)]
    att=[J(x) for x in att]
    A,B=arcs(att),arcs(q);ah=[att[0],att[1],J(f.R)];bh=[q[0],q[1],J(f.R)]
    D=V(1.44)*2;HD=V(1.44)*(V(1.9)+1)
    for i in range(3):
        for j in range(3):q=push(q,arc_contact(A[i],B[j],D),D)
    for j in range(3):q=push(q,point_contact(ah,B[j],HD),HD)
    for i in range(3):q=push(q,point_contact(bh,A[i],HD,True),HD)
    # Source checks live hub positions after the cached-geometry corrections.
    if f.norm([q[0].v-att[0].v,q[1].v-att[1].v]).lo <= (V(1.44)*V(1.9)*2).hi:
        raise ValueError('hub-hub contact not implemented')
    return q,COUNTS.copy()
