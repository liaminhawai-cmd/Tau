"""Plot the checked interval cover; no interpolation of sampled successes.

Matplotlib is optional and needed only for this figure, not the proof checkers.
Horizontal segments are lower bounds valid on their entire angle intervals.
"""
import argparse
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from check_arm1_one_degree import inspect

HERE = Path(__file__).resolve().parent


def plot(certificate_path, output, preview=None):
    certificate = json.loads(certificate_path.read_text())
    assert certificate == inspect(), 'certificate differs from checked composition'
    cells = [r['domainDeg'] for r in certificate['proofCells']]
    margins = [r['throwMarginLower'] for r in certificate['proofCells']]
    widths = [b-a for a, b in cells]
    branches = [r for r in certificate['proofCells'] if r['method'] == 'separate zonotopes']
    lo, hi = certificate['domainDeg']
    colour, ink, muted = '#007d79', '#152936', '#536673'
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11,
        'axes.labelcolor': ink, 'xtick.color': muted, 'ytick.color': muted,
        'axes.edgecolor': '#c5d0d5', 'svg.hashsalt': 'tau-arm1-certified-cover'})
    fig, axes = plt.subplots(2, 1, figsize=(10, 7.0), sharex=True,
        gridspec_kw={'height_ratios': [1.5, 1], 'hspace': .24})
    fig.subplots_adjust(left=.12, right=.97, top=.83, bottom=.20)
    fig.text(.12, .945, f'A complete continuous band: {lo:g}°–{hi:g}°',
             fontsize=20, fontweight='bold', color=ink)
    fig.text(.12, .895, f'{len(cells)} adjoining intervals  ·  every angle covered  ·  specified real-arithmetic model',
             fontsize=11, color=muted)
    for ax in axes:
        ax.set_xlim(lo, hi)
        ax.spines[['top', 'right']].set_visible(False)
        ax.grid(axis='y', color='#e3e9ec', linewidth=.7)
        ax.set_axisbelow(True)
    axes[0].add_collection(LineCollection([[(a, m), (b, m)] for (a, b), m in zip(cells, margins)],
                                         colors=colour, linewidths=2.4))
    axes[0].set_ylim(0, max(margins)*1.13)
    axes[0].axhline(0, color=ink, linewidth=1)
    axes[0].set_ylabel('Guaranteed throw margin (u)')
    axes[0].text(.02, .08, 'Above 0 = guaranteed beyond the fall threshold',
                 transform=axes[0].transAxes, color=muted, fontsize=9)
    axes[0].text(.02, .55, f'Minimum lower bound: {min(margins):.6f} u',
                 transform=axes[0].transAxes, color=ink, fontsize=13)
    axes[1].add_collection(LineCollection([[(a, w), (b, w)] for (a, b), w in zip(cells, widths)],
                                         colors=colour, linewidths=2.4))
    axes[1].set_yscale('log')
    levels = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2]
    axes[1].set_yticks(levels, ['10⁻⁶°', '10⁻⁵°', '10⁻⁴°', '10⁻³°', '10⁻²°'])
    axes[1].set_ylim(min(widths)*.7, max(widths)*1.45)
    axes[1].set_ylabel('Certified interval width')
    axes[1].set_xlabel('Defender angle: foot 1, negative rotation (degrees)', labelpad=10)
    for row in branches:
        a, b = row['domainDeg']
        for ax in axes:
            ax.axvline((a+b)/2, color='#b87016', alpha=.8, linewidth=.9, linestyle=':')
        axes[0].scatter([(a+b)/2], [row['throwMarginLower']], color='#b87016', s=22, zorder=3)
        axes[1].scatter([(a+b)/2], [b-a], color='#b87016', s=22, zorder=3)
        axes[0].text((a+b)/2, max(margins)*1.04, f'{(a+b)/2:.5f}°',
                     color='#9a5a0b', fontsize=9, ha='center')
    fig.text(.12, .09, 'Orange dots: two contact-switch cells, each enclosing all three possible contact images.',
             fontsize=10, color=muted)
    fig.text(.12, .05, 'Stored seed; shared reply (0,−). Full-arm coverage and floating-engine correspondence remain open.',
             fontsize=9, color=muted)
    fig.savefig(output, format='svg', metadata={'Date': None, 'Creator': 'Tau interval-cover research'})
    # Matplotlib leaves spaces before path-data newlines; normalise only that
    # whitespace so the generated vector artifact passes the repository check.
    output.write_text('\n'.join(line.rstrip() for line in output.read_text().splitlines())+'\n')
    if preview:
        fig.savefig(preview, dpi=160, facecolor='white')
    plt.close(fig)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--certificate', default='arm1-one-degree-certificate.json')
    parser.add_argument('--output', default='arm1-one-degree-cover.svg')
    parser.add_argument('--preview')
    args = parser.parse_args()
    plot(HERE/args.certificate, HERE/args.output, args.preview)
