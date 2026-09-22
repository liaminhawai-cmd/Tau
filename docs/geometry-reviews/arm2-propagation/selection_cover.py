"""Conditional near-minimum feature cover on the disturbed pass domains.
Does not establish errors of the engine's segment solver or pruning gates.
"""
import sys,json,hashlib,math
from pathlib import Path
import propagate as P
from interval_core import V
HERE=Path(__file__).resolve().parent

def run(slack):
 if not math.isfinite(slack) or slack<=0:raise ValueError('positive finite slack required')
 source=HERE/'robustness-1e-08.json';j=json.loads(source.read_text())
 if not j['conditionalSuccess'] or len(j['log'])!=380:raise ValueError('complete robust enclosure required')
 trace=json.loads((HERE.parent/'contact-map/trace.json').read_text())
 attacker={r['k']:r['att'] for r in json.loads((HERE/'engine-attacker-path.json').read_text())['steps']}
 records=[];failure=None
 for r in j['log']:
  row={**next(v for v in trace['rows'] if v['k']==r['k'] and v['iter']==0),'att':attacker[r['k']]}
  box=[V(*v) for v in r['inputBox']]
  try:
   near,A,upper=P.candidates(row,box,distance_slack=slack)
   covered={tuple(b['branch']) for b in r['branches']}
   extras=[key for key in near if key not in covered];excluded=[];unresolved=[]
   try:dom=P.close(row,box)
   except (ValueError,AssertionError,ZeroDivisionError):dom=None
   bykey={tuple(b['branch']):b for b in dom['dominated']} if dom else {}
   for key in extras:
    if key not in bykey:unresolved.append(list(key));continue
    # Exact dominance supplies squared gap Q_other-Q_selected >= gap2.
    # Divide by a uniform upper bound for d_other+d_selected.
    other=P.jet_branch(box,A,key,raw=True).v
    selected=V(*dom['distance'])
    gap=(V(bykey[key]['squaredDistanceGapLower'])/(other+selected)).lo
    if gap>slack:excluded.append({'branch':list(key),'distanceGapLower':gap})
    else:unresolved.append(list(key))
   records.append({'k':r['k'],'iteration':r['iteration'],'nearCandidates':[list(k) for k in near],'coveredBranches':[list(k) for k in sorted(covered)],'excludedByGap':excluded,'unresolved':unresolved})
  except (ValueError,AssertionError,ZeroDivisionError) as e:
   failure={'k':r['k'],'iteration':r['iteration'],'reason':str(e)};break
 gaps=[b['distanceGapLower'] for r in records for b in r['excludedByGap']]
 unresolved=[{'k':r['k'],'iteration':r['iteration'],'branches':r['unresolved']} for r in records if r['unresolved']]
 out={'scope':'Conditional exact-segment near-minimum cover on the previously certified disturbed input boxes; floating segment-solver and pruning correspondence remain open.',
 'distanceSlack':slack,'robustnessSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'checkedPasses':len(records),'failure':failure,
 'extraBranchesExcludedByGap':len(gaps),'minimumExcludedDistanceGap':min(gaps) if gaps else None,
 'passesWithMultipleCoveredBranches':sum(len(r['coveredBranches'])>1 for r in records),'unresolved':unresolved,
 'conditionalSuccess':failure is None and len(records)==380 and not unresolved,'records':records}
 dest=HERE/('selection-cover-'+str(slack)+'.json');dest.write_text(json.dumps(out,indent=2)+'\n')
 print(json.dumps({k:v for k,v in out.items() if k!='records'},indent=2));return out
if __name__=='__main__':sys.exit(0 if run(float(sys.argv[1]) if len(sys.argv)>1 else 2e-9)['conditionalSuccess'] else 1)
