"""Continuous two-angle contact exclusion before the reply's first push.

Real rotations of the stored binary64 seed, not floating engine execution.
Adaptive subdivision proposes a rectangular cover; check_prefix.py rechecks it.
"""
import json, sys
from pathlib import Path
import free_motion as f

HERE = Path(__file__).resolve().parent

def attacker_at(lo, hi):
    q = [f.V(v) for v in f.POSE[3:]]
    px = q[0] + f.R*f.cos(q[2])
    py = q[1] + f.R*f.sin(q[2])
    angle = -f.V(lo, hi)*f.PI/180
    c, s = f.cos(angle), f.sin(angle)
    rx, ry = q[0]-px, q[1]-py
    return [px+rx*c-ry*s, py+rx*s+ry*c, q[2]+angle]

def check_rect(rect):
    alo, ahi, blo, bhi = rect
    q = attacker_at(blo, bhi)
    row = f.check(1, -1, alo, ahi, f.arcs(q), [q[0], q[1], f.R])
    return None if row is None else {k: row[k] for k in ('legLower','hubLegLower','hubHubLower')}

def rim_upper(lo,hi):
    q=attacker_at(lo,hi)
    return max(f.norm([q[0]+f.R*f.cos(q[2]+2*f.PI*j/3),
                       q[1]+f.R*f.sin(q[2]+2*f.PI*j/3)]).hi for j in range(3))

def contact_witness():
    # Proposal parameters only; these arbitrary segment points establish an
    # upper distance bound, without trusting that they are true closest points.
    A=f.arcs(attacker_at(6,6))[0]
    B=f.arcs(f.pose_at(1,-1,2,2))[0]
    s,t=.6107821754171837,.9790235544297097
    pa=[x+(y-x)*s for x,y in zip(A[3],A[4])]
    pb=[x+(y-x)*t for x,y in zip(B[4],B[5])]
    upper=f.norm(f.sub(pa,pb)).hi
    return {'defenderDeg':2.,'attackerDeg':6.,'legPair':[0,0],
      'segments':[3,4],'parameters':[s,t],'distanceUpper':upper,
      'contactThresholdLower':(f.V(1.44)*2).lo}

def certify(end=5.625):
    pending = [[2.,18.,0.,end]]
    accepted = []
    unresolved = []
    while pending:
        rect = pending.pop()
        result = check_rect(rect)
        if result:
            accepted.append({'rect':rect, **result})
        elif max(rect[1]-rect[0],rect[3]-rect[2]) <= 1/4096:
            unresolved.append(rect)
            break
        else:
            axis = 0 if rect[1]-rect[0] >= rect[3]-rect[2] else 2
            mid = (rect[axis]+rect[axis+1])/2
            a,b = rect[:],rect[:]
            a[axis+1],b[axis] = mid,mid
            pending.extend([b,a])
        if len(accepted) % 50 == 0 and accepted:
            print('accepted',len(accepted),'pending',len(pending),flush=True)
    # Independent attacker rim bound throughout the candidate response arc.
    rim=[]
    rim_pending=[(0.,46.125)]
    edge=f.V(66.667)+f.V(.5)
    while rim_pending:
        lo,hi=rim_pending.pop()
        upper=rim_upper(lo,hi)
        if upper<(edge-f.V(.0003)).lo:
            rim.append({'lo':lo,'hi':hi,'radiusUpper':upper})
        elif hi-lo>1/1048576:
            mid=(lo+hi)/2
            rim_pending.extend([(mid,hi),(lo,mid)])
        else:
            raise ValueError('Attacker rim unresolved at '+str((lo,hi)))
    return {'scope':'Real-model no-contact rectangle only; no throw or floating-engine certificate.',
      'pose':f.POSE, 'defenderArm':[1,-1], 'attackerArm':[0,-1],
      'domain':[2.,18.,0.,end], 'complete':not pending and not unresolved,
      'cells':accepted,'unresolved':unresolved,'unchecked':pending,
      'attackerRimDomain':[0.,46.125], 'attackerRimCells':rim,
      'attackerRadiusUpper':max(r['radiusUpper'] for r in rim),
      'edgeThreshold':edge.bounds(), 'contactWitness':contact_witness()}

if __name__=='__main__':
    end=float(sys.argv[1]) if len(sys.argv)>1 else 5.625
    result=certify(end)
    name='arm1-prefix.json' if end==5.625 else 'arm1-prefix-attempt.json'
    (HERE/name).write_text(json.dumps(result,indent=2)+'\n')
    print({k:v for k,v in result.items() if k not in ('cells','attackerRimCells','unchecked')})
    if not result['complete']:sys.exit(1)
