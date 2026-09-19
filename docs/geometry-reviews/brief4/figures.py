"""Figures from the saved nominal trajectories; no enclosure claim."""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE=Path(__file__).resolve().parent
out=HERE/'figures';out.mkdir(exist_ok=True)
refs=json.loads((HERE/'reference-poses.json').read_text())['arm0']
second=json.loads((HERE/'second-arm.json').read_text())
pieces=json.loads((HERE/'pieces.json').read_text())
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'svg.fonttype':'none','axes.spines.top':False,'axes.spines.right':False})
fig,axes=plt.subplots(1,2,figsize=(12,4.5),layout='constrained')
ax=axes[0]
tr=refs[:84]
ax.axhspan(-.125,.125,color='#b9decf',alpha=.8,label='Initial box: ±0.125u')
ax.plot([0]+[t['k']/3 for t in tr],[0]+[t['pose']['y']-pieces[0]['y'] for t in tr],color='#263f72',lw=2.4,label='Nominal y displacement')
ax.scatter([5],[-.14747453431859725],color='#b5443d',zorder=3)
ax.annotate('Leaves box at 5°',xy=(5,-.14747453431859725),xytext=(6,-1.6),arrowprops={'arrowstyle':'->','color':'#b5443d'},color='#b5443d')
ax.axvline(28,color='#89919c',ls='--',lw=1)
ax.set(title='A small initial box is not a path enclosure',xlabel='Attacker sweep (degrees)',ylabel='Victim y − initial y (u)',xlim=(0,29))
ax.legend(loc='lower left',fontsize=9,frameon=False)
ax=axes[1]
rows=[r for r in second if 108<=r['k']<=113]
ax.axhline(37.5,color='#b5443d',ls='--',label='Attacker vertex: 37.5°')
ax.plot([r['k'] for r in rows],[r['pre']['phiA'] for r in rows],'-o',color='#263f72',label='Closest point on attacker')
ax.plot([r['k'] for r in rows],[r['pre']['phiV'] for r in rows],'-o',color='#30775f',label='Closest point on victim')
ax.set(title='Second arm: an attacker-vertex transition',xlabel='Entering substep',ylabel='Leg arc coordinate (degrees)')
ax.set_xticks(range(108,114));ax.legend(loc='center left',fontsize=9,frameon=False)
fig.savefig(out/'trajectory-and-transition.svg')
plt.close(fig)

checks=json.loads((HERE/'map-checks.json').read_text())
sv=[{'k':r['k'],'singularValues':np.linalg.svd(np.array(r['fullMap']['J']),compute_uv=False).tolist()} for r in checks['jacobian']]
(HERE/'jacobian-singular-values.json').write_text(json.dumps(sv,indent=2)+'\n')
print('Wrote figure and singular-value diagnostics.')
