"""Continuous real-geometry exclusion certificate for two defender arcs.

Proof bounds use outward intervals. Floating closest points only propose a
separating direction; the direction's projections are then interval-checked.
This does not prove game-rule reachability, a throw, or floating execution.
"""
import json, math, sys
from pathlib import Path
from interval_core import V, PI, R, sin, cos, dot, sub, down

POSE = [-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442]
LEG = (V(1.44)*2).hi
HUBLEG = (V(1.44)*(V(1.9)+1)).hi
HUBHUB = (V(1.44)*V(1.9)*2).hi
S = [R*sin(PI*k/24) for k in range(13)]
H = [R*cos(PI*k/24) for k in range(13)]

def mid(v): return (v.lo+v.hi)/2
def norm(v):
    q=sum((x.sq() for x in v),V(0))
    return V(max(0,q.lo),q.hi).sqrt()
def arcs(q):
    out=[]
    for j in range(3):
        angle=q[2]+2*PI*j/3; c=cos(angle); s=sin(angle)
        out.append([[q[0]+c*S[k],q[1]+s*S[k],H[k]] for k in range(13)])
    return out
def pose_at(pivot, direction, lo, hi):
    q=[V(x) for x in POSE[:3]]
    th=q[2]+2*PI*pivot/3
    px=q[0]+R*cos(th); py=q[1]+R*sin(th)
    a=direction*V(lo,hi)*PI/180; c=cos(a); s=sin(a)
    rx=q[0]-px; ry=q[1]-py
    return [px+rx*c-ry*s,py+rx*s+ry*c,q[2]+a]

def proposed_axis(A0,A1,B0,B1):
    a,b,c,d=[[mid(x) for x in p] for p in [A0,A1,B0,B1]]
    u=[b[i]-a[i] for i in range(3)];v=[d[i]-c[i] for i in range(3)];w=[a[i]-c[i] for i in range(3)]
    dp=lambda p,q:sum(x*y for x,y in zip(p,q))
    aa=dp(u,u);bb=dp(u,v);cc=dp(v,v);dd=dp(u,w);ee=dp(v,w)
    clamp=lambda x:max(0,min(1,x))
    den=aa*cc-bb*bb
    t0=clamp((bb*ee-cc*dd)/den) if den>1e-20 else 0
    t1=(bb*t0+ee)/cc if cc>1e-20 else 0
    if t1<0:t1=0;t0=clamp(-dd/aa) if aa>1e-20 else 0
    elif t1>1:t1=1;t0=clamp((bb-dd)/aa) if aa>1e-20 else 0
    return [c[i]+t1*v[i]-a[i]-t0*u[i] for i in range(3)]

def segment_lower(A0,A1,B0,B1, threshold):
    # The interval AABB contains every segment point throughout the angle cell.
    gaps=[]
    for i in range(3):
        gaps.append(V(max(0,
            down(min(B0[i].lo,B1[i].lo)-max(A0[i].hi,A1[i].hi)),
            down(min(A0[i].lo,A1[i].lo)-max(B0[i].hi,B1[i].hi)))))
    lower=norm(gaps).lo
    if lower>threshold:return lower
    n=[V(x) for x in proposed_axis(A0,A1,B0,B1)]
    den=norm(n)
    if den.lo<=0:return lower
    ap=[dot(n,A0),dot(n,A1)];bp=[dot(n,B0),dot(n,B1)]
    sep=max((V(min(x.lo for x in bp))-max(x.hi for x in ap)).lo,
            (V(min(x.lo for x in ap))-max(x.hi for x in bp)).lo,0)
    return max(lower,(V(sep)/den).lo)

def check(pivot,direction,lo,hi,A,AH):
    q=pose_at(pivot,direction,lo,hi);B=arcs(q);BH=[q[0],q[1],R]
    leg=math.inf;hubleg=math.inf
    for i in range(3):
        for j in range(3):
            for a in range(12):
                for b in range(12):
                    d=segment_lower(A[i][a],A[i][a+1],B[j][b],B[j][b+1],LEG)
                    if d<=LEG:return None
                    leg=min(leg,d)
    for j in range(3):
        for k in range(12):
            for p,u,v in [(AH,B[j][k],B[j][k+1]),(BH,A[j][k],A[j][k+1])]:
                d=segment_lower(p,p,u,v,HUBLEG)
                if d<=HUBLEG:return None
                hubleg=min(hubleg,d)
    hubhub=norm(sub(BH,AH)).lo
    if hubhub<=HUBHUB:return None
    return {'loDeg':lo,'hiDeg':hi,'legLower':leg,'hubLegLower':hubleg,'hubHubLower':hubhub}

def certify(pivot,direction,start,hi,attacker_box):
    att=[V(*v) for v in attacker_box];A=arcs(att);AH=[att[0],att[1],R]
    pending=[(start,hi)];leaves=[];unresolved=[]
    while pending:
        lo,upper=pending.pop()
        c=check(pivot,direction,lo,upper,A,AH)
        if c:leaves.append(c)
        elif upper-lo<=1/4096:unresolved.append([lo,upper]);break
        else:
            m=(lo+upper)/2;pending.extend([(m,upper),(lo,m)])
    leaves.sort(key=lambda r:r['loDeg'])
    complete=not unresolved and not pending
    if complete:
        assert leaves[0]['loDeg']==start and leaves[-1]['hiDeg']==hi
        assert all(a['hiDeg']==b['loDeg'] for a,b in zip(leaves,leaves[1:]))
    return {'pivotIdx':pivot,'dir':direction,'domainDeg':[start,hi],'attackerBox':attacker_box,
      'complete':complete,'unresolved':unresolved,'unchecked':pending,
      'cells':len(leaves),'minimumLegLower':min((r['legLower'] for r in leaves),default=None),
      'minimumHubLegLower':min((r['hubLegLower'] for r in leaves),default=None),
      'minimumHubHubLower':min((r['hubHubLower'] for r in leaves),default=None),'cover':leaves}

def main():
    out={'scope':'Continuous real-geometry contact exclusion only; exact real rotations and ideal quarter-circle polylines with 12 segments; does not certify floating execution, legality limits or a winning reply.',
      'pose':POSE,'thresholdUpper':{'leg':LEG,'hubLeg':HUBLEG,'hubHub':HUBHUB},'arms':[]}
    initial=[[x,x] for x in POSE[3:]]
    shifted=[[-11.762,-11.760],[-23.279,-23.276],[2.9440,2.9441]]
    cases=[(1,0.0,18.0,initial),(2,2.0,16.0,shifted)]
    if '--test-unshifted-arm2' in sys.argv:cases=[(2,0.0,18.0,initial)]
    for pivot,start,end,box in cases:
        row=certify(pivot,-1,start,end,box);out['arms'].append(row)
        print({k:v for k,v in row.items() if k not in ['cover','unchecked']},flush=True)
    filename='unshifted-arm2.json' if '--test-unshifted-arm2' in sys.argv else 'free-motion.json'
    Path(__file__).with_name(filename).write_text(json.dumps(out,indent=2)+'\n')
    if not all(r['complete'] for r in out['arms']):sys.exit(1)
if __name__=='__main__':main()
