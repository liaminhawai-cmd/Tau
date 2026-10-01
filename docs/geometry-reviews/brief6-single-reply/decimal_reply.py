"""Independent 80-digit scalar replica for diagnostic containment checks.

Standard library only. Decimal samples do not prove continuous coverage; the
interval/zonotope computation supplies that argument. This replica deliberately
does not import the contact propagation, jet or interval arithmetic modules.
"""
from decimal import Decimal as D, localcontext, getcontext
import json,sys
from pathlib import Path
getcontext().prec=80
F=lambda x:D.from_float(float(x))
def atan(x):
    s=t=x;n=1
    while True:
        t=-t*x*x;n+=2;delta=t/n;s+=delta
        if abs(delta)<D('1e-85'):return s
PI=16*atan(D(1)/5)-4*atan(D(1)/239)
def trig(x,cos=False):
    term=D(1) if cos else x;result=term;n=0 if cos else 1
    while True:
        term=-term*x*x/((n+1)*(n+2));n+=2;result+=term
        if abs(term)<D('1e-85'):return result
sin=lambda x:trig(x)
cos=lambda x:trig(x,True)
R=F(23.095);LEG=F(1.44)*2;HUB=F(1.44)*F(1.9);HD=HUB+F(1.44)
INERTIA=F(.7)*R*R
SEED=list(map(F,[-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442]))
S=[R*sin(PI*k/24) for k in range(13)];HEIGHT=[R*cos(PI*k/24) for k in range(13)]
SEG_HALF=R*sin(PI/48)
def sub(a,b):return [x-y for x,y in zip(a,b)]
def dot(a,b):return sum((x*y for x,y in zip(a,b)),D(0))
def norm(v):return dot(v,v).sqrt()
def lerp(a,b,t):return [x+(y-x)*t for x,y in zip(a,b)]
def clamp(x):return max(D(0),min(D(1),x))
def rotate(q,pv,degrees):
    th=q[2]+2*PI*pv/3;px=q[0]+R*cos(th);py=q[1]+R*sin(th)
    a=-degrees*PI/180;rx=q[0]-px;ry=q[1]-py
    return [px+rx*cos(a)-ry*sin(a),py+rx*sin(a)+ry*cos(a),q[2]+a]
def arcs(q):
    rows=[]
    for leg in range(3):
        a=q[2]+2*PI*leg/3;c,s=cos(a),sin(a)
        rows.append([[q[0]+c*S[k],q[1]+s*S[k],HEIGHT[k]] for k in range(13)])
    return rows
def segment(a,b,c,d):
    u,v,w=sub(b,a),sub(d,c),sub(a,c)
    aa,ee,ff,cc,bb=dot(u,u),dot(v,v),dot(v,w),dot(u,w),dot(u,v)
    den=aa*ee-bb*bb
    ss=clamp((bb*ff-cc*ee)/den) if den>F(1e-12) else D(0)
    tt=(bb*ss+ff)/ee if ee>F(1e-12) else D(0)
    if tt<0:ss=clamp(-cc/aa);tt=D(0)
    elif tt>1:ss=clamp((bb-cc)/aa);tt=D(1)
    pa,pb=lerp(a,b,ss),lerp(c,d,tt)
    return pa,pb,norm(sub(pb,pa))
def arc_contact(A,B):
    best=None;bestd=LEG
    ac=[[(x+y)/2 for x,y in zip(a,b)] for a,b in zip(A,A[1:])]
    bc=[[(x+y)/2 for x,y in zip(a,b)] for a,b in zip(B,B[1:])]
    for i in range(12):
        for k in range(12):
            delta=sub(bc[k],ac[i])
            if dot(delta,delta)>(bestd+2*SEG_HALF)**2:continue
            row=segment(A[i],A[i+1],B[k],B[k+1])
            if row[2]<bestd:best=row;bestd=row[2]
    return best
def point_contact(p,A,reverse=False):
    best=None;bestd=HD
    for a,b in zip(A,A[1:]):
        u=sub(b,a);t=clamp(dot(sub(p,a),u)/dot(u,u));q=lerp(a,b,t);d=norm(sub(q,p))
        if d<bestd:best=(q,p,d) if reverse else (p,q,d);bestd=d
    return best
def push(q,row,DIST):
    pa,pb,d=row
    if d<=F(.3):raise ValueError('deep branch in decimal diagnostic')
    delta=sub(pb,pa);h=norm(delta[:2]);hf=h/d
    if hf<=F(.35):raise ValueError('floor branch in decimal diagnostic')
    sep=(DIST-d)/hf
    if sep>=F(.8):raise ValueError('cap branch in decimal diagnostic')
    nx,ny=delta[0]/h,delta[1]/h;rn=(pb[0]-q[0])*ny-(pb[1]-q[1])*nx
    lam=sep/(1+rn*rn/INERTIA)
    return [q[0]+lam*nx,q[1]+lam*ny,q[2]+lam*rn/INERTIA]
def solve(att,q):
    A=arcs(att);ah=[att[0],att[1],R];types={}
    for it in range(10):
        B=arcs(q);bh=[q[0],q[1],R];any_contact=False
        for i in range(3):
            for k in range(3):
                row=arc_contact(A[i],B[k])
                if row is not None:q=push(q,row,LEG);any_contact=True;types['leg']=types.get('leg',0)+1
        for k in range(3):
            row=point_contact(ah,B[k])
            if row is not None:q=push(q,row,HD);any_contact=True;types['attackerHub']=types.get('attackerHub',0)+1
        for i in range(3):
            row=point_contact(bh,A[i],True)
            if row is not None:q=push(q,row,HD);any_contact=True;types['defenderHub']=types.get('defenderHub',0)+1
        if norm(sub(q[:2],att[:2]))<2*HUB:raise ValueError('hub-hub branch in decimal diagnostic')
        if not any_contact:break
    return q,types
def trace(angle):
    q=rotate(SEED[:3],1,F(angle));rows=[];counts={}
    for k in range(1,124):
        att=rotate(SEED[3:],0,D(k)*D('0.375'));q,types=solve(att,q)
        for key,value in types.items():counts[key]=counts.get(key,0)+value
        rows.append({'step':k,'pose':[str(x) for x in q]})
    return {'angle':angle,'decimalPrecision':getcontext().prec,'steps':rows,'contactCounts':counts}
if __name__=='__main__':
    a=float(sys.argv[1]) if len(sys.argv)>1 else 8.0005
    result=trace(a)
    output=Path(__file__).with_name('arm1-decimal-trace.json')
    output.write_text(json.dumps(result,indent=2)+'\n')
    print('decimal trajectory',a,'steps',len(result['steps']),result['contactCounts'])
