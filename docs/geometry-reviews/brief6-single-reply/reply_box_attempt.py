"""Experimental axis-box contact propagation, not a published certificate.

Unlike the old single-pair proof, enumerate all leg pairs and hub contacts in
source order, with geometry cached at the start of each pass. Ordinary pushes
only; any possible deep, degenerate, floor or cap branch returns unresolved.
The deliberate radius cutoff is a computational guard, never a failure witness.
"""
import json,sys,time
from pathlib import Path
import free_motion as f
from arm1_prefix import attacker_at
V=f.V

def hull(xs):return V(min(x.lo for x in xs),max(x.hi for x in xs))
def vhull(qs):return [hull([q[i] for q in qs]) for i in range(3)]
def sub(a,b):return [x-y for x,y in zip(a,b)]
def lerp(a,b,t):return [x+(y-x)*t for x,y in zip(a,b)]
def clamp(x):return V(max(0,min(1,x.lo)),max(0,min(1,x.hi)))
def closest(a,b,c,d):
    u,v,w=sub(b,a),sub(d,c),sub(a,c)
    aa,ee,ff,cc,bb=f.dot(u,u),f.dot(v,v),f.dot(v,w),f.dot(u,w),f.dot(u,v)
    den=aa*ee-bb*bb
    if aa.lo<=1e-12 or ee.lo<=1e-12:raise ValueError('degenerate segment guard')
    if den.lo>1e-12:ss=clamp((bb*ff-cc*ee)/den)
    elif den.hi<=1e-12:ss=V(0)
    else:raise ValueError('near-parallel branch unresolved')
    tt=(bb*ss+ff)/ee;cases=[]
    if tt.lo<0:cases.append((clamp(-cc/aa),V(0)))
    if tt.hi>1:cases.append((clamp((bb-cc)/aa),V(1)))
    if tt.hi>=0 and tt.lo<=1:cases.append((ss,V(max(0,tt.lo),min(1,tt.hi))))
    pa=vhull([lerp(a,b,s) for s,t in cases]);pb=vhull([lerp(c,d,t) for s,t in cases])
    return pa,pb,f.norm(sub(pb,pa))

def arc_contact(A,B,D):
    candidates=[]
    for i in range(12):
        for j in range(12):
            if f.segment_lower(A[i],A[i+1],B[j],B[j+1],D.hi)>D.hi:continue
            pa,pb,dist=closest(A[i],A[i+1],B[j],B[j+1])
            if dist.lo<D.hi:candidates.append((pa,pb,dist))
    if not candidates:return []
    upper=min(c[2].hi for c in candidates)
    return [c for c in candidates if c[2].lo<=upper]

def point_contact(p,A,D,reverse=False):
    cs=[]
    for i in range(12):
        if f.segment_lower(p,p,A[i],A[i+1],D.hi)>D.hi:continue
        u=sub(A[i+1],A[i]);t=clamp(f.dot(sub(p,A[i]),u)/f.dot(u,u))
        q=lerp(A[i],A[i+1],t);dist=f.norm(sub(q,p))
        if dist.lo<D.hi:cs.append((q,p,dist) if reverse else (p,q,dist))
    if not cs:return []
    upper=min(c[2].hi for c in cs)
    return [c for c in cs if c[2].lo<=upper]

def push(q,contacts,D,stats):
    if not contacts:return q
    images=[]
    if all(d.hi>=D.lo for pa,pb,d in contacts):images.append(q)
    for pa,pb,d in contacts:
        if d.lo<=.3:raise ValueError('deep / zero-distance branch unresolved')
        delta=sub(pb,pa);horizontal=f.norm(delta[:2]);hf=horizontal/d
        if hf.lo<=.35:raise ValueError('horizontal-floor branch unresolved')
        gap=D-d;gap=V(max(0,gap.lo),max(0,gap.hi));sep=gap/hf
        if sep.hi>=.8:raise ValueError('correction-cap branch unresolved')
        nx,ny=delta[0]/horizontal,delta[1]/horizontal
        rn=(pb[0]-q[0])*ny-(pb[1]-q[1])*nx
        inertia=V(.7)*f.R*f.R
        lam=sep/(1+rn.sq()/inertia)
        images.append([q[0]+lam*nx,q[1]+lam*ny,q[2]+lam*rn/inertia])
    stats['candidateImages']+=len(images)
    return vhull(images)

def solve_pass(att,q,stats):
    A,B=f.arcs(att),f.arcs(q);ah=[att[0],att[1],f.R];bh=[q[0],q[1],f.R]
    D=V(1.44)*2;HD=V(1.44)*(V(1.9)+1)
    for i in range(3):
        for j in range(3):q=push(q,arc_contact(A[i],B[j],D),D,stats)
    for j in range(3):q=push(q,point_contact(ah,B[j],HD),HD,stats)
    for i in range(3):q=push(q,point_contact(bh,A[i],HD,True),HD,stats)
    # Source uses the LIVE hub after all cached-geometry pushes.
    if f.norm([q[0]-att[0],q[1]-att[1]]).lo <= (V(1.44)*V(1.9)*2).hi:
        raise ValueError('hub-hub contact not yet implemented')
    return q

def attempt(lo,hi):
    q=f.pose_at(1,-1,lo,hi);stats={'candidateImages':0};log=[];failure=None;start=time.time()
    try:
        for k in range(1,124):
            att=attacker_at(k*.375,k*.375)
            # All possible contact types are excluded before deciding to skip.
            excluded=f.check(1,-1,lo,hi,f.arcs(att),[att[0],att[1],f.R]) if not stats['candidateImages'] else None
            if excluded:
                log.append({'k':k,'free':True,'box':[x.bounds() for x in q]});continue
            for it in range(10):
                q=solve_pass(att,q,stats)
                if max(q[0].hi-q[0].lo,q[1].hi-q[1].lo,(q[2].hi-q[2].lo)*23.095)>.1:
                    raise ValueError('axis-box width exceeded 0.1u exploration limit')
            log.append({'k':k,'free':False,'box':[x.bounds() for x in q]})
    except (ValueError,ZeroDivisionError) as e:
        failure={'step':k,'iteration':locals().get('it'),'reason':str(e)}
    return {'scope':'Experimental real-model axis-box propagation; not a certificate. Branch gaps fail closed.',
      'defenderDomainDeg':[lo,hi],'replyStepDeg':.375,'failure':failure,'completedSubsteps':len(log),
      'stats':stats,'seconds':time.time()-start,'lastBox':[x.bounds() for x in q],'log':log}

if __name__=='__main__':
    if '--suite' in sys.argv:
        results=[attempt(8,8),attempt(8,8.000001)]
        Path(__file__).with_name('arm1-box-attempt.json').write_text(json.dumps(
            {'scope':'Failed exploration only, not a certificate','attempts':results},indent=2)+'\n')
        for row in results:print(row['defenderDomainDeg'],row['failure'])
        sys.exit(1 if any(r['failure'] for r in results) else 0)
    lo=float(sys.argv[1]) if len(sys.argv)>1 else 8.
    hi=float(sys.argv[2]) if len(sys.argv)>2 else lo
    out=attempt(lo,hi)
    Path(__file__).with_name('arm1-box-attempt.json').write_text(json.dumps(out,indent=2)+'\n')
    print({k:v for k,v in out.items() if k!='log'})
    if out['failure']:sys.exit(1)
