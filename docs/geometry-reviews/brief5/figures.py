"""Illustrate the proved two-response covering example, not measured Tau margins."""
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

HERE = Path(__file__).resolve().parent
(HERE / 'figures').mkdir(exist_ok=True)
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'svg.fonttype': 'none'})
t = np.linspace(0, 1, 501)
left, right = .6 - t, t - .4
fig, ax = plt.subplots(figsize=(9.2, 4.8), layout='constrained')
ax.axhline(0, color='#627181', linewidth=1)
ax.axvspan(.4, .6, color='#d4eee5', alpha=.9, label='Both responses win')
ax.plot(t, left, color='#2471a3', label='Response A: 0.6 − t', linewidth=2)
ax.plot(t, right, color='#b64a3b', label='Response B: t − 0.4', linewidth=2)
ax.plot(t, np.maximum(left, right), color='#186a4b', linewidth=3, linestyle='--', label='Choose the better response')
ax.scatter([.5], [.1], color='#186a4b', zorder=4)
ax.annotate('Worst available winning margin = 0.1', (.5, .1), (.51, .29),
            arrowprops={'arrowstyle': '->', 'color': '#186a4b'}, fontsize=10, color='#186a4b')
ax.set(xlim=(0, 1), ylim=(-.45, .68), xlabel='Victim stopping parameter t', ylabel='Winning margin',
       title='Every stop has a winning response; neither response covers every stop')
ax.spines[['top', 'right']].set_visible(False)
ax.grid(axis='y', alpha=.15)
ax.legend(loc='lower center', ncol=2, fontsize=9, frameon=False)
fig.savefig(HERE / 'figures/response-coverage.svg')
fig.savefig(HERE / 'figures/response-coverage.png', dpi=150)
