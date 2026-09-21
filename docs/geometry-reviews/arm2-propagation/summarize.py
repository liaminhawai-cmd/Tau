"""Summarize only the claims actually discharged by the two enclosure calculations."""
import json,hashlib,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'arm2-bounds'))
from interval_core import V
p=json.loads((HERE/'propagation-1.0.json').read_text());e=json.loads((HERE/'contact-exclusions.json').read_text());n=json.loads((HERE/'engine-check.json').read_text())
digest=hashlib.sha256((HERE/'propagation-1.0.json').read_bytes()).hexdigest()
assert e['propagationSHA256']==digest and n['propagationSHA256']==digest
assert p['attackerPathSource']=='pinned engine trace'
assert p['attackerPath']==json.loads((HERE/'engine-attacker-path.json').read_text())['steps']
assert p['failure'] is None and p['completedCorrections']==380
assert [(r['k'],r['iteration']) for r in p['log']]==[(k,i) for k in range(75,113) for i in range(10)]
assert e['failure'] is None and e['checked']==454
assert [(r['k'],r['iteration']) for r in e['rows']]==[(k,None) for k in range(1,75)]+[(k,i) for k in range(75,113) for i in range(10)]
assert e['minimumOtherLegDistance']>e['thresholds']['leg']
assert e['minimumHubLegDistance']>e['thresholds']['hubLeg']
assert e['minimumHubHubDistance']>e['thresholds']['hubHub']
assert e['maximumAttackerFootRadius']<e['thresholds']['edge']
clearance=V(p['finalExposedFootRadiusLower'])-V(e['thresholds']['edge'])
assert clearance.lo>0
out={'claim':'Composed local throw enclosure for the real-arithmetic contact program with the fixed recorded attacker poses. NOT a universal floating-engine or dead-region certificate.', 'source':'18efad5398798b65b477f9af4be17947a358d3ce','initialVictimBox':p['initialBox'],'freeSubsteps':74,'substepsTotal':112,'correctionPassesEnclosed':380,'finalFootRadiusLower':p['finalExposedFootRadiusLower'],'edgeUpper':e['thresholds']['edge'],'clearanceLower':clearance.lo,'maxEnclosureMassRadius':max(r['outputRadius'] for r in p['log']),'maxFeatureBranches':max(len(r['branches']) for r in p['log']),'excludedContacts':{k:e[k] for k in ['minimumOtherLegDistance','minimumHubLegDistance','minimumHubHubDistance']},'engineDiagnostics':n,'openObligations':['Uniform correspondence to floating contact calculations; portability of the pinned-runtime attacker path','All legal defender replies from the original seed','Variation of both pieces for a six-dimensional dead region'],'artifactSHA256':{name:hashlib.sha256((HERE/name).read_bytes()).hexdigest() for name in ['propagation-1.0.json','contact-exclusions.json','engine-check.json','engine-attacker-path.json']}}
(HERE/'summary.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
