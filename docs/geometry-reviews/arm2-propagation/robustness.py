"""Conditional disturbed real-map enclosure; NOT a floating-engine certificate.

Run from any directory: python robustness.py [per-coordinate disturbance]
Reuses existing outward interval geometry, recomputes all pass guards and
contact exclusions on enlarged sets, and writes a separate artifact.
"""
import sys,json,time,hashlib,math
from pathlib import Path
import propagate as P
import check_contacts as C
from interval_core import V,PI,R,sin,cos
from bounds import minabs
HERE=Path(__file__).resolve().parent

def run(epsilon):
 if not math.isfinite(epsilon) or epsilon<0:raise ValueError('finite nonnegative disturbance required')
 tracepath=HERE.parent/'contact-map/trace.json'
 pathfile=HERE/'engine-attacker-path.json'
 data=json.loads(tracepath.read_text());attacker=json.loads(pathfile.read_text())['steps']
 actual={r['k']:r['att'] for r in attacker}
 q=next(r for r in data['rows'] if r['k']==75 and r['iter']==0)['before']
 c,M=P.pack([V(q['x']),V(q['y']),V(q['rot'])*P.SQI],[[V(.0002),V(0),V(0)],[V(0),V(.0002),V(0)],[V(0),V(0),V(.002)*PI/180*P.SQI]])
 initial=P.box_of(c,M)[0];log=[];exclusions=[];failure=None;start=time.time();k=0;it=None
 try:
  # Early free-motion states are unchanged, NOT perturbed. A floating proof must
  # establish that the engine executes no correction in this stage.
  for k in range(1,75):exclusions.append({'k':k,'iteration':None,**C.check(actual[k],initial,True)})
  for k in range(75,113):
   row={**next(r for r in data['rows'] if r['k']==k and r['iter']==0),'att':actual[k]}
   for it in range(10):
    box,rad,_=P.box_of(c,M)
    if rad>.1:raise ValueError('enclosure radius exceeds exploration limit')
    exclusion=C.check(actual[k],box)
    keys,A,_=P.candidates(row,box)
    try:keys=[tuple(P.close(row,box)['selected'])]
    except (AssertionError,ValueError,ZeroDivisionError):pass
    if not keys:raise ValueError('no branch candidates')
    images=[];info=[]
    for key in keys:
     im,rec=P.image(c,M,box,rad,A,key);images.append(im);info.append(rec)
    c,M=P.merge(images)
    # Minkowski-add the coordinate cube [-epsilon,epsilon]^3 AFTER each
    # map, including inactive maps. No error is merely added to the final margin.
    c,M=P.pack([V(x) for x in c],[[V(x) for x in col] for col in M],V(epsilon))
    after,rout,hw=P.box_of(c,M)
    hh=P.safe_norm([after[0]-actual[k]['x'],after[1]-actual[k]['y']]).lo
    if hh<C.HUBHUB:raise ValueError('post-push hub contact not excluded')
    exclusion['hubHubDistanceLower']=min(exclusion['hubHubDistanceLower'],hh)
    exclusions.append({'k':k,'iteration':it,**exclusion})
    log.append({'k':k,'iteration':it,'inputBox':[v.bounds() for v in box],'outputBox':[v.bounds() for v in after],'inputRadius':rad,'outputRadius':rout,'branches':info})
 except (ValueError,AssertionError,ZeroDivisionError) as e:failure={'k':k,'iteration':it,'reason':str(e)}
 box,rad,_=P.box_of(c,M);th=box[2]+2*PI/3
 foot=[box[0]+R*cos(th),box[1]+R*sin(th)]
 lower=P.safe_norm([V(minabs(x)) for x in foot]).lo;edge=(V(66.667)+V(.5)).hi
 clearance=(V(lower)-V(edge)).lo
 active=[b for r in log for b in r['branches'] if not b['inactive']]
 out={'scope':'Conditional real-map robustness with arbitrary per-pass coordinate disturbances in mass coordinates. No floating arithmetic, feature-selection or runtime correspondence claim.',
 'epsilonPerMassCoordinate':epsilon,'traceSHA256':hashlib.sha256(tracepath.read_bytes()).hexdigest(),'attackerPathSHA256':hashlib.sha256(pathfile.read_bytes()).hexdigest(),
 'initialBox':[v.bounds() for v in initial],'completedCorrections':len(log),'checkedExclusions':len(exclusions),'failure':failure,
 'finalExposedFootRadiusLower':lower,'edgeUpper':edge,'clearanceLower':clearance,'finalRadius':rad,
 'minimumGradientLower':min((b['m'] for b in active),default=None),'maximumPenetrationUpper':max((b['penetration'][1] for b in active),default=None),
 'minimumOtherLegDistance':min((r['otherLegDistanceLower'] for r in exclusions),default=None),'minimumHubLegDistance':min((r['hubLegDistanceLower'] for r in exclusions),default=None),'minimumHubHubDistance':min((r['hubHubDistanceLower'] for r in exclusions),default=None),
 'conditionalSuccess':failure is None and len(log)==380 and len(exclusions)==454 and clearance>0,'seconds':time.time()-start,'log':log,'exclusions':exclusions}
 outpath=HERE/('robustness-'+format(epsilon,'.0e')+'.json');outpath.write_text(json.dumps(out,indent=2)+'\n')
 print(json.dumps({k:v for k,v in out.items() if k not in ['log','exclusions']},indent=2));return out
if __name__=='__main__':
 out=run(float(sys.argv[1]) if len(sys.argv)>1 else 1e-8)
 sys.exit(0 if out['conditionalSuccess'] else 1)
