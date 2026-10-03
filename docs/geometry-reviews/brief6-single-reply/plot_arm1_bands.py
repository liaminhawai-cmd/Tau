"""Scientific figure of the completed composed angle bands and retained sets."""
import argparse
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.lines import Line2D
from compose_arm1_bands import inspect

HERE = Path(__file__).resolve().parent


def plot(output, preview=None):
    certificate = json.loads((HERE/'arm1-eight-ten-certificate.json').read_text())
    assert certificate == inspect()
    rows = certificate['proofCells']
    margins = [r['throwMarginLower'] for r in rows]
    counts = [r.get('finalBranches', 1) for r in rows]
    ink, muted, earlier, new = '#162c3a', '#506774', '#7a959d', '#007d79'
    colours = [earlier if r['domainDeg'][1] <= 9 else new for r in rows]
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11,
        'axes.labelcolor': ink, 'xtick.color': muted, 'ytick.color': muted,
        'axes.edgecolor': '#c5d0d5', 'svg.hashsalt': 'tau-arm1-eight-ten'})
    fig, axes = plt.subplots(2, 1, figsize=(10.5, 7.2), sharex=True,
        gridspec_kw={'height_ratios': [1.6, 1], 'hspace': .25})
    fig.subplots_adjust(left=.12, right=.96, top=.81, bottom=.24)
    fig.text(.12, .95, 'Certified winning-reply band: 8°–10°',
             fontsize=21, fontweight='bold', color=ink)
    fig.text(.12, .90, f"{certificate['cells']} adjoining intervals  ·  every angle covered  ·  specified real-arithmetic model",
             color=muted, fontsize=11)
    for ax in axes:
        ax.set_xlim(*certificate['domainDeg'])
        ax.axvspan(9, 10, color='#e8f4f1', zorder=0)
        ax.axvline(9, color='#a5b8be', linewidth=.8, linestyle=':')
        ax.spines[['top', 'right']].set_visible(False)
        ax.grid(axis='y', color='#e3e9ec', linewidth=.7)
        ax.set_axisbelow(True)
    def segments(values):
        return [[(r['domainDeg'][0], v), (r['domainDeg'][1], v)] for r, v in zip(rows, values)]
    axes[0].add_collection(LineCollection(segments(margins), colors=colours, linewidths=2.5))
    axes[0].set_ylim(0, max(margins)*1.14)
    axes[0].set_ylabel('Guaranteed throw margin (u)')
    axes[0].text(.02, .49, f"Minimum lower bound ≈ {certificate['minimumThrowMargin']:.6f} u",
                 transform=axes[0].transAxes, fontsize=13, color=ink)
    axes[0].text(.02, .08, 'Above 0 = guaranteed beyond the fall threshold',
                 transform=axes[0].transAxes, fontsize=9, color=muted)
    axes[0].legend(handles=[Line2D([0], [0], color=earlier, lw=3, label='Earlier: 8°–9°'),
                           Line2D([0], [0], color=new, lw=3, label='Extension: 9°–10°')],
                   loc='upper right', frameon=False, fontsize=9)
    axes[1].add_collection(LineCollection(segments(counts), colors=colours, linewidths=2.5))
    tiny = [(r, n) for r, n in zip(rows, counts) if r['domainDeg'][1]-r['domainDeg'][0] < 1e-5 and n > 1]
    if tiny:
        axes[1].scatter([(r['domainDeg'][0]+r['domainDeg'][1])/2 for r, _ in tiny],
                        [n for _, n in tiny], color=earlier, s=16, zorder=3)
    axes[1].set_ylim(.5, max(counts)+.65)
    levels = sorted(set(counts))
    axes[1].set_yticks(levels)
    axes[1].set_ylabel('Retained enclosures')
    axes[1].set_xlabel('Defender angle: foot 1, negative rotation (degrees)', labelpad=10)
    fig.text(.12, .13, 'Every retained contact enclosure must prove a throw. Counts describe proof sets, not game moves.',
             color=muted, fontsize=9.5)
    fig.text(.12, .085, 'Each horizontal segment certifies its entire angle interval; shared endpoints have no gaps.',
             color=muted, fontsize=9.5)
    fig.text(.12, .04, 'Stored seed; shared reply (0,−). Whole-arm coverage and floating-engine correspondence remain open.',
             color=muted, fontsize=9)
    fig.savefig(output, format='svg', metadata={'Date': None, 'Creator': 'Tau interval-cover research'})
    output.write_text('\n'.join(line.rstrip() for line in output.read_text().splitlines())+'\n')
    if preview:
        fig.savefig(preview, dpi=160, facecolor='white')
    plt.close(fig)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='arm1-eight-ten-cover.svg')
    parser.add_argument('--preview')
    args = parser.parse_args()
    plot(HERE/args.output, args.preview)
