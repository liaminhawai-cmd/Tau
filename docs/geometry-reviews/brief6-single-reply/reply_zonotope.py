"""Experimental mean-value/zonotope composition of the full ordinary solver.

All coefficient storage error is enclosed. Generator reduction preserves an
outer enclosure. This is a real-model experiment; no engine correspondence.
"""
import json,sys,time
from pathlib import Path
import reply_jet as j
import free_motion as f
from arm1_prefix import attacker_at
V=f.V
HERE=Path(__file__).resolve().parent

def mid(x):return (x.lo+x.hi)/2
def error(x,c):return j.maxabs(x-V(c))
def pack(centre,columns):
    c=[mid(x) for x in centre];errors=[V(error(x,c[i])) for i,x in enumerate(centre)];M=[]
    for column in columns:
        v=[mid(x) for x in column];M.append(v)
        for i in range(3):errors[i]=errors[i]+error(column[i],v[i])
    for i,e in enumerate(errors):
        v=[0.,0.,0.];v[i]=e.hi;M.append(v)
    M=[v for v in M if any(v)]
    if len(M)>48:
        # Ordering is a heuristic only. Dropped columns are all retained in
        # the outward axis hull, independent of how the ordering was chosen.
        M.sort(key=lambda v:v[0]**2+v[1]**2+(23.095*v[2])**2,reverse=True)
        keep,drop=M[:45],M[45:]
        for i in range(3):
            v=[0.,0.,0.];v[i]=sum((V(abs(x[i])) for x in drop),V(0)).hi;keep.append(v)
        M=keep
    return c,M

def box_of(c,M):
    h=[sum((V(abs(col[i])) for col in M),V(0)).hi for i in range(3)]
    return [V(c[i])+V(-h[i],h[i]) for i in range(3)],h

def initial_family(lo,hi):
    """One shared angle generator plus rigorous second-order rotation error."""
    if lo>hi:raise ValueError('reversed angle domain')
    centre=(lo+hi)/2
    radius=max(j.maxabs(V(lo)-centre),j.maxabs(V(hi)-centre))
    q=f.pose_at(1,-1,centre,centre)
    original=[V(x) for x in f.POSE[:3]]
    th=original[2]+2*f.PI/3
    px,py=original[0]+f.R*f.cos(th),original[1]+f.R*f.sin(th)
    delta=V(radius)*f.PI/180
    column=[(q[1]-py)*delta,-(q[0]-px)*delta,-delta]
    remainder=(f.R*delta.sq()/2).hi
    return pack(q,[column,[V(remainder),V(0),V(0)],[V(0),V(remainder),V(0)]])

def propagate(c,M,att):
    box,h=box_of(c,M)
    jets,counts=j.solve_pass(att,c,box,h,M)
    if not counts.get('contactMaps'):return c,M,counts
    n=len(j.H)
    gradients=[[jet.g[k] if k<len(jet.g) else V(0) for k in range(n)] for jet in jets]
    J0=[[mid(x) for x in row] for row in gradients]
    errors=[]
    for i in range(3):
        delta=[gradients[i][k]-V(J0[i][k]) for k in range(n)]
        terms=[V(j.maxabs(sum((delta[k]*col[k] for k in range(3)),V(0)))) for col in M]
        terms.extend(V(j.maxabs(delta[k]))*j.H[k] for k in range(3,n))
        errors.append(sum(terms,V(0)).hi)
    columns=[]
    for col in M:
        columns.append([sum((V(J0[i][k])*col[k] for k in range(3)),V(0)) for i in range(3)])
    for k in range(3,n):columns.append([V(J0[i][k]) for i in range(3)])
    for i,e in enumerate(errors):
        col=[V(0),V(0),V(0)];col[i]=V(e);columns.append(col)
    c,M=pack([jet.c for jet in jets],columns)
    return c,M,counts

def run(lo,hi,verbose=False):
    c,M=initial_family(lo,hi);logs=[];failure=None;start=time.time();total={}
    k=it=0
    try:
        for k in range(1,124):
            att=attacker_at(k*.375,k*.375)
            for it in range(10):
                c,M,counts=propagate(c,M,att)
                for key,value in counts.items():total[key]=total.get(key,0)+value
                box,h=box_of(c,M)
                if max(h[0],h[1],23.095*h[2])>1:raise ValueError('zonotope halfwidth exceeded 1u exploration limit')
                if not counts.get('contactMaps'):break
            logs.append({'step':k,'box':[x.bounds() for x in box],'centre':c,'generators':M,'counts':total.copy()})
            if verbose and k%10==0:print(k,h,len(M),flush=True)
    except (ValueError,ZeroDivisionError) as e:failure={'step':k,'iteration':it,'reason':str(e)}
    box,h=box_of(c,M);radii=[]
    for foot in range(3):
        a=box[2]+2*f.PI*foot/3
        radii.append(f.norm([box[0]+f.R*f.cos(a),box[1]+f.R*f.sin(a)]).bounds())
    edge=V(66.667)+V(.5)
    margin=(V(max(r[0] for r in radii))-edge).lo if not failure else None
    return {'scope':'Experimental full ordinary real contact-program enclosure. No crossing-rule or floating-engine certificate.',
      'defenderDomainDeg':[lo,hi],'completedSubsteps':len(logs),'failure':failure,
      'finalFootRadii':radii,'finalMarginLower':margin,'lastBox':[x.bounds() for x in box],
      'counts':total,'seconds':time.time()-start,'log':logs}

if __name__=='__main__':
    lo=float(sys.argv[1]) if len(sys.argv)>1 else 8.
    hi=float(sys.argv[2]) if len(sys.argv)>2 else lo
    name=sys.argv[3] if len(sys.argv)>3 else 'arm1-zonotope-attempt.json'
    out=run(lo,hi,True)
    (HERE/name).write_text(json.dumps(out,indent=2)+'\n')
    print({k:v for k,v in out.items() if k!='log'})
    if out['failure']:sys.exit(1)
