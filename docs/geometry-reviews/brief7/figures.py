from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
here=Path(__file__).resolve().parent
rows=json.loads((here/'park-bounds.json').read_text())['results']
plt.rcParams.update({'svg.fonttype':'none','font.family':'DejaVu Sans'})
fig,ax=plt.subplots(figsize=(8.8,4.1),layout='constrained')
k=[r['k'] for r in rows];b=[r['radialDerivative'][0] for r in rows]
ax.plot(k,b,color='#167363',linewidth=2.5)
ax.axhline(0,color='#556375',linewidth=1)
ax.axvline(84,color='#8b4b35',linestyle='--',label='Nominal throw: k84')
ax.set(xlabel='Substep k',ylabel='Verified lower bound on ∂G/∂r',ylim=(-.006,.17),xlim=(74,104),title='The radial contact chart stays increasing across the candidate park domains')
ax.spines[['top','right']].set_visible(False)
ax.legend(frameon=False)
ax.grid(axis='y',alpha=.15)
(here/'figures').mkdir(exist_ok=True)
fig.savefig(here/'figures/radial-chart.svg')
fig.savefig(here/'figures/radial-chart.png',dpi=140)
