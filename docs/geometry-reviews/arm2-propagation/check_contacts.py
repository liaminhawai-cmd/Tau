"""Check excluded leg/hub contacts on every recorded enclosure input, plus early free motion."""
import json,sys,itertools,time,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'arm2-bounds'))
from interval_core import V,PI,R,ELL,up,down,dot,sub,add,scale,norm
from bounds import vertex,tangent,chord_branches
from propagate import safe_norm
LEG=(V(1.44)*2).hi;HUB=V(1.44)*V(1.9);HUBLEG=(HUB+V(1.44)).hi;HUBHUB=(2*HUB).hi

def box_lower(A0,A1,B0,B1):
 ds=[]
 for i in range(len(A0)):
  ds.append(V(max(0,down(min(A0[i].lo,A1[i].lo)-max(B0[i].hi,B1[i].hi)),down(min(B0[i].lo,B1[i].lo)-max(A0[i].hi,A1[i].hi)))))
 return safe_norm(ds).lo

def legs(q):
 P=[];U=[]
 for j in range(3):
  t=q[2]+2*PI*j/3;P.append([vertex(q[:2],t,k) for k in range(13)]);U.append([tangent(t,k) for k in range(12)])
 return P,U

def leg_min(A,B,u,v,threshold):
 bound=1e99
 for i,j in itertools.product(range(12),repeat=2):
  d=box_lower(A[i],A[i+1],B[j],B[j+1])
  if d<threshold:
   bs=chord_branches(A[i],B[j],u[i],v[j])
   if not bs:raise ValueError('unresolved segment minimum')
   d=min(x.lo for x in bs)
  bound=min(bound,d)
  if d<threshold:return d
 return bound

def point_min(p,B,v,threshold):
 bound=1e99
 for j in range(12):
  d=box_lower(p,p,B[j],B[j+1])
  if d<threshold:
   t=dot(v[j],sub(p,B[j]));t=V(max(0,min(ELL.lo,t.lo)),max(0,min(ELL.hi,t.hi)))
   d=safe_norm(sub(add(B[j],scale(v[j],t)),p)).lo
  bound=min(bound,d)
  if d<threshold:return d
 return bound

def check(att,box,free=False):
 aq=[V(att[k]) for k in ['x','y','rot']];A,u=legs(aq);B,v=legs(box)
 lo=1e99
 for i,j in itertools.product(range(3),repeat=2):
  if not free and (i,j)==(1,0):continue
  d=leg_min(A[i],B[j],u[i],v[j],LEG);lo=min(lo,d)
  if d<LEG:raise ValueError('leg contact not excluded: '+str((i,j,d)))
 ah=[aq[0],aq[1],R];bh=[box[0],box[1],R];hl=1e99
 for j in range(3):
  for d in [point_min(ah,B[j],v[j],HUBLEG),point_min(bh,A[j],u[j],HUBLEG)]:
   hl=min(hl,d)
   if d<HUBLEG:raise ValueError('hub/leg contact not excluded: '+str(d))
 hh=safe_norm(sub(box[:2],aq[:2])).lo
 if hh<HUBHUB:raise ValueError('hub/hub contact not excluded')
 # The kinematic attacker must stay on the board.
 from interval_core import sin,cos
 ar=0
 for j in range(3):
  th=aq[2]+2*PI*j/3;ft=[aq[0]+R*cos(th),aq[1]+R*sin(th)];ar=max(ar,safe_norm(ft).hi)
 return {'otherLegDistanceLower':lo,'hubLegDistanceLower':hl,'hubHubDistanceLower':hh,'attackerFootRadiusUpper':ar}

def main():
 trace=json.loads(Path(sys.argv[1]).read_text());pr=json.loads(Path(sys.argv[2]).read_text());steps={r['k']:r for r in pr['attackerPath']};out=[];start=time.time();failure=None
 try:
  for k in range(1,75):
   rec=check(steps[k]['att'],[V(*v) for v in pr['initialBox']],True);out.append({'k':k,'iteration':None,**rec})
  print('Initial 74 substeps free',flush=True)
  for r in pr['log']:
   k=r['k'];att=steps[k]['att'];rec=check(att,[V(*v) for v in r['inputBox']])
   # hub-hub check uses the updated live hub later in the pass; other tests use cached pre-pass geometry.
   post=[V(*v) for v in r['outputBox']];hh=safe_norm([post[0]-att['x'],post[1]-att['y']]).lo
   if hh<HUBHUB:raise ValueError('post-push hub-hub contact not excluded')
   rec['hubHubDistanceLower']=min(rec['hubHubDistanceLower'],hh);out.append({'k':k,'iteration':r['iteration'],**rec})
   if r['iteration']==9:print(k,'all excluded',flush=True)
 except (ValueError,ZeroDivisionError) as e:failure={'k':k,'reason':str(e)}
 summary={'scope':'Real-geometry exclusions on the proposed propagated enclosures, with fixed recorded attacker poses; no floating execution or crossing-rule correspondence proof.', 'propagationSHA256':hashlib.sha256(Path(sys.argv[2]).read_bytes()).hexdigest(),'checked':len(out),'failure':failure,'minimumOtherLegDistance':min((r['otherLegDistanceLower'] for r in out),default=None),'minimumHubLegDistance':min((r['hubLegDistanceLower'] for r in out),default=None),'minimumHubHubDistance':min((r['hubHubDistanceLower'] for r in out),default=None),'maximumAttackerFootRadius':max((r['attackerFootRadiusUpper'] for r in out),default=None),'thresholds':{'leg':LEG,'hubLeg':HUBLEG,'hubHub':HUBHUB,'edge':(V(66.667)+V(.5)).hi},'seconds':time.time()-start,'rows':out}
 (HERE/'contact-exclusions.json').write_text(json.dumps(summary,indent=2)+'\n');print({k:v for k,v in summary.items() if k!='rows'})
if __name__=='__main__':main()
