"""Adaptive continuous cover; replays and hashes the complete propagation.

Incomplete covers remain explicitly incomplete. No interpolation between leaves.
"""
import hashlib,json,sys,time
from pathlib import Path
import reply_zonotope as z
HERE=Path(__file__).resolve().parent

def canonical(result):
    return {k:v for k,v in result.items() if k!='seconds'}

def record(result):
    raw=json.dumps(canonical(result),sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    return {k:result[k] for k in ('defenderDomainDeg','completedSubsteps','failure',
      'finalFootRadii','finalMarginLower','lastBox','counts')}|{'propagationSha256':hashlib.sha256(raw).hexdigest()}

def sources():
    names=['reply_jet.py','reply_zonotope.py','free_motion.py','interval_core.py','arm1_prefix.py']
    return {n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in names}

def cover(lo,hi,filename,min_width=1e-7,max_attempts=160):
    out={'scope':'Continuous real contact-model response cover under the prescribed 123-step attacker path. Crossing legality and floating-engine correspondence not certified.',
      'domainDeg':[lo,hi],'sourceHashes':sources(),'complete':False,'leaves':[],
      'failedAttempts':[],'unresolved':[],'pending':[[lo,hi]],'minimumWidth':min_width,
      'attemptLimit':max_attempts,'attempts':0}
    started=time.time()
    while out['pending'] and out['attempts']<max_attempts:
        a,b=out['pending'].pop()
        result=z.run(a,b)
        row=record(result);out['attempts']+=1
        if row['failure'] is None and row['completedSubsteps']==123 and row['finalMarginLower']>0:
            out['leaves'].append(row)
            print('covered',a,b,'margin',row['finalMarginLower'],'leaves',len(out['leaves']),flush=True)
        else:
            out['failedAttempts'].append(row)
            if b-a<=min_width:out['unresolved'].append([a,b]);break
            m=(a+b)/2;out['pending'].extend([[m,b],[a,m]])
            print('split',a,b,row['failure'],flush=True)
        out['seconds']=time.time()-started
        Path(filename).write_text(json.dumps(out,indent=2,allow_nan=False)+'\n')
    out['leaves'].sort(key=lambda r:r['defenderDomainDeg'][0])
    out['complete']=not out['pending'] and not out['unresolved']
    out['marginLower']=min((r['finalMarginLower'] for r in out['leaves']),default=None) if out['complete'] else None
    out['seconds']=time.time()-started
    Path(filename).write_text(json.dumps(out,indent=2,allow_nan=False)+'\n')
    return out

if __name__=='__main__':
    lo=float(sys.argv[1]) if len(sys.argv)>1 else 8.
    hi=float(sys.argv[2]) if len(sys.argv)>2 else 8.01
    filename=HERE/(sys.argv[3] if len(sys.argv)>3 else 'arm1-local-reply-cover.json')
    result=cover(lo,hi,filename)
    print({k:v for k,v in result.items() if k not in ['leaves','failedAttempts','sourceHashes']})
    if not result['complete']:sys.exit(1)
