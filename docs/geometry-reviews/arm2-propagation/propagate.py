"""Composed enclosure for the fixed-attacker, one-leg-pair real map.
This is a conditional model experiment, not an engine or dead-zone certificate.
"""
import sys,json,math,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'arm2-bounds'))
from interval_core import V,up,down,PI,I,R,norm,dot
from branch_bounds import candidates,jet_branch
from dominance_bounds import close
from bounds import maxabs,minabs
D=V(2.88);SQI=I.sqrt()

def mid(v):return (v.lo+v.hi)/2

def width(v,c):return maxabs(v-V(c))

def safe_norm(v):
 s=sum((q.sq() for q in v),V(0));return V(max(0,s.lo),s.hi).sqrt()

def pack(centre,columns,extra=0):
 # Round all newly stored coefficients outward into three additional generators.
 c=[mid(q) for q in centre];r=[V(width(q,c[i]))+extra for i,q in enumerate(centre)];M=[]
 for column in columns:
  m=[mid(q) for q in column];M.append(m)
  for i in range(3):r[i]=r[i]+width(column[i],m[i])
 for i in range(3):
  v=[0.,0.,0.];v[i]=r[i].hi
  if v[i]>0:M.append(v)
 M=[v for v in M if any(v)]
 # Outer zonotope reduction: retained directions plus axis hull of discarded columns.
 if len(M)>48:
  M.sort(key=lambda v:sum(x*x for x in v),reverse=True);keep=M[:45];drop=M[45:]
  for i in range(3):
   a=sum((V(abs(v[i])) for v in drop),V(0));q=[0.,0.,0.];q[i]=a.hi;keep.append(q)
  M=keep
 return c,M

def box_of(c,M):
 h=[sum((V(abs(v[i])) for v in M),V(0)).hi for i in range(3)]
 z=[V(c[i])+V(-h[i],h[i]) for i in range(3)]
 return [z[0],z[1],z[2]/SQI],safe_norm([V(x) for x in h]).hi,h

def image(c,M,box,radius,A,key):
 bounds=jet_branch(box,A,key);dj=jet_branch(box,A,key,raw=True)
 if dj.v.lo>=D.hi:return (c,M),{'branch':key,'inactive':True}
 hf=safe_norm([V(minabs(x)) for x in dj.g[:2]]).lo
 if dj.v.lo<=.3 or hf<=.35 or ((D-dj.v)/V(hf)).hi>=.8:raise ValueError('ordinary-push guard')
 point=[V(c[0]),V(c[1]),V(c[2])/SQI];pjet=jet_branch(point,A,key,raw=True)
 gp=pjet.g;ss=sum((x.sq() for x in gp),V(0));hp=[x/ss for x in gp]
 gh=[mid(q) for q in gp];hh=[mid(q) for q in hp];pc=D-pjet.v;ph=mid(pc)
 dg=safe_norm([V(width(q,gh[i])) for i,q in enumerate(gp)])
 dh=safe_norm([V(width(q,hh[i])) for i,q in enumerate(hp)])
 rr=V(radius);B=V(bounds['B']);m=V(bounds['m']);G=V(bounds['G'])
 dp=V(width(pc,ph))+dg*rr+B*rr*rr/2
 pu=(pc+G*rr).hi;pu=V(max(0,pu))
 error=(safe_norm([V(x) for x in hh])*dp+pu*(dh+B*rr/(m*m))).hi
 pr=sum((V(maxabs(dot([V(x) for x in gh],[V(x) for x in col]))) for col in M),V(0)).hi
 lo=(V(ph)-pr).lo;hi=(V(ph)+pr).hi
 if lo>=0:alpha=V(1);beta=V(0);eta=V(0)
 elif hi<=0:alpha=V(0);beta=V(0);eta=V(0)
 else:
  alpha=V(hi)/(V(hi)-lo);beta=-V(hi)*lo/(2*(V(hi)-lo));eta=beta
 centre=[V(c[i])+hh[i]*(alpha*ph+beta) for i in range(3)]
 columns=[]
 for col in M:
  a=dot([V(x) for x in gh],[V(x) for x in col])
  columns.append([V(col[i])-alpha*hh[i]*a for i in range(3)])
 columns.append([eta*hh[i] for i in range(3)])
 return pack(centre,columns,error),{'branch':key,'inactive':False,'m':bounds['m'],'B':bounds['B'],'remainder':error,'penetration':(D-dj.v).bounds(),'clip':[lo,hi]}

def merge(images):
 if len(images)==1:return images[0]
 n=max(len(M) for _,M in images)
 centres=[V(min(c[i] for c,_ in images),max(c[i] for c,_ in images)) for i in range(3)]
 cols=[]
 for j in range(n):
  cols.append([V(min(M[j][i] if j<len(M) else 0 for _,M in images),max(M[j][i] if j<len(M) else 0 for _,M in images)) for i in range(3)])
 return pack(centres,cols)

def main():
 data=json.loads(Path(sys.argv[1]).read_text());scale=float(sys.argv[2]) if len(sys.argv)>2 else 1.
 assert math.isfinite(scale) and scale>=0
 attackerPath=json.loads(Path(sys.argv[3]).read_text())['steps'] if len(sys.argv)>3 else data['steps']
 actualAtt={r['k']:r['att'] for r in attackerPath}
 first=next(r for r in data['rows'] if r['k']==75 and r['iter']==0);q=first['before']
 hr=V(.002)*PI/180*scale
 c,M=pack([V(q['x']),V(q['y']),V(q['rot'])*SQI],[[V(.0002)*scale,V(0),V(0)],[V(0),V(.0002)*scale,V(0)],[V(0),V(0),hr*SQI]])
 initialBox=box_of(c,M)[0]
 log=[];start=time.time();failure=None
 try:
  for k in range(75,113):
   row={**next(r for r in data['rows'] if r['k']==k and r['iter']==0),'att':actualAtt[k]}
   for it in range(10):
    box,rad,h=box_of(c,M)
    if rad>.1:raise ValueError('enclosure radius exceeds 0.1u exploration limit')
    keys,A,_=candidates(row,box)
    # Discard endpoints by exact dominance only when all of close()'s guards pass.
    try:
     dom=close(row,box);keys=[tuple(dom['selected'])]
    except (AssertionError,ValueError,ZeroDivisionError):pass
    ims=[];info=[]
    for key in keys:
     im,rec=image(c,M,box,rad,A,key);ims.append(im);info.append(rec)
    c,M=merge(ims);after,rout,hw=box_of(c,M)
    rec={'k':k,'iteration':it,'inputBox':[v.bounds() for v in box],'outputBox':[v.bounds() for v in after],'inputRadius':rad,'outputRadius':rout,'centre':c,'halfWidthsMass':hw,'branches':info,'generators':len(M)};log.append(rec)
   print(k,'radius',rout,'branches',len(keys),flush=True)
 except (ValueError,AssertionError,ZeroDivisionError) as e:failure={'k':k,'iteration':it,'reason':str(e)}
 box,rad,hw=box_of(c,M)
 # Geometry lower bound for exposed foot 1, on the final represented set.
 from interval_core import sin,cos
 th=box[2]+2*PI/3;foot=[box[0]+R*cos(th),box[1]+R*sin(th)]
 lower=safe_norm([V(minabs(x)) for x in foot]).lo
 out={'scope':'Conditional real-map composition from pre-k75: one leg pair only, fixed recorded attacker poses, ten contact/no-contact corrections per substep. Other contacts, pre-k75 path and floating engine correspondence are NOT certified.', 'attackerPath':attackerPath,'attackerPathSource':'pinned engine trace' if len(sys.argv)>3 else 'nominal replica','initialBox':[v.bounds() for v in initialBox],'initialScale':scale,'completedCorrections':len(log),'failure':failure,'finalExposedFootRadiusLower':lower,'edge':67.167,'finalBox':[x.bounds() for x in box],'seconds':time.time()-start,'log':log}
 (HERE/('propagation-'+str(scale)+'.json')).write_text(json.dumps(out,indent=2)+'\n');print({k:v for k,v in out.items() if k!='log'})
if __name__=='__main__':main()
