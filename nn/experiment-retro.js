'use strict';
// The retromine-data ablation, end to end: does training on Retromine games make a net stronger,
// at EQUAL data volume?
//
// This is the test the project has argued about but never actually run. Retromine's rows have only
// ever been mitigated -- game-level val-split leakage through replay families, and --familyWeight
// sqrt because "large failed-rescue families dominate the corpus" -- both of which assume the data
// helps and try to stop it hurting. Nobody measured whether it helps.
//
// For each --shares value s it builds a corpus of identical total size whose composition is
// s retromine positions : (1-s) ordinary-pool positions (data-slice.js --class retro), trains one
// net per arm FROM SCRATCH with identical shape/epochs/seed (train-value.js --data), then plays
// every arm against every other arm in a round robin (gauntlet.js, one run per unordered pair)
// plus a fixed anchor set (best.json, L10, L11) so the arms land on the ladder's own scale.
//
//   node nn/experiment-retro.js                                  # 0/0.3/0.6/0.9, best.json's shape
//   node nn/experiment-retro.js --shares 0,0.9 --hidden 96,96 --epochs 12 --games 60
//
// Equal volume is enforced by the HIGHEST share: retro is the scarce class, so the cap is
// retroPositions/maxShare and every arm gets exactly that many rows. The question this answers is
// therefore "at a fixed corpus size, what retro fraction is best", NOT "does adding retro on top
// of everything else help" -- those are different experiments and only the first one is controlled.
//
// Nothing here touches nn/models, nn/data or the live league: arms live under nn/experiments/<name>/
// where the roster never scans, and gauntlet.js never enters the Elo pool.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const dir = __dirname;
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };

const shares = [...new Set(String(arg('shares', '0,0.3,0.6,0.9')).split(',').map(Number)
                  .filter(s => s >= 0 && s <= 1))].sort((a, b) => a - b);
const epochs = String(+arg('epochs', 8));
const seed = String(+arg('seed', 12345));
const games = String(Math.max(2, +arg('games', 40) & ~1));
const depthsArg = arg('depths', '1');
const anchors = arg('anchors', 'best,L10,L11');
const workers = String(Math.max(1, +arg('workers', 3)));
const shardsArg = String(Math.max(1, +arg('shards', 1)));
const name = arg('name', `retro-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`);
const expDir = path.join(dir, 'experiments', name);
const best = path.join(dir, 'models', 'best.json');
const skipTrain = process.argv.includes('--skipTrain');   // reuse arms from an interrupted run
// Lowers the equal-volume cap below what the corpus could support. Every arm still gets the same
// number of rows, so the comparison stays controlled -- it is just a smaller (and much faster)
// experiment. Mainly for smoke-testing the pipeline end to end before committing a machine-day.
const userCap = arg('positions');

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };

// "Train from scratch at the best model's architecture" is the default, because a data question
// asked at a toy width can answer differently than it does at the width that actually ships: a
// 96x96 net may be too small to exploit retro's rescue positions at all. --hidden overrides it
// (and --topology plain with it) for a fast read; the summary records which was used, since the
// two runs are not comparable to each other.
function archArgs() {
  const explicit = arg('hidden');
  if (explicit) {
    const topo = arg('topology', 'plain');
    return { hidden: explicit, extra: topo === 'plain' ? [] : ['--topology', topo],
             label: `${explicit} (${topo})` };
  }
  const b = readJson(best, null);
  if (!b || !Array.isArray(b.sizes) || b.sizes.length < 3)
    throw new Error(`cannot read an architecture from ${best}; pass --hidden`);
  const hidden = b.sizes.slice(1, -1).join(',');
  const t = b.topology;
  const extra = t && t.kind === 'dense-memory-v1'
    ? ['--topology', 'dense-memory', '--memoryWidth', String(t.memoryWidth), '--residualScale', String(t.residualScale)]
    : [];
  return { hidden, extra, label: `${b.sizes.join('-')}${t ? ` ${t.kind}` : ''} (from best.json)` };
}

function run(script, args) {
  return new Promise((ok, bad) => {
    console.log(`\n$ node nn/${script} ${args.join(' ')}`);
    const ch = spawn(process.execPath, [path.join(dir, script), ...args], { stdio: 'inherit' });
    ch.on('error', bad);
    ch.on('exit', c => c === 0 ? ok() : bad(new Error(`${script} exited ${c}`)));
  });
}

const tagOf = s => `retro${Math.round(s*100)}`;
const pct = x => `${(100*x).toFixed(1)}%`;

async function main() {
  if (!shares.length) { console.error('[retro] no valid --shares'); process.exitCode = 1; return; }
  const arch = archArgs();
  fs.mkdirSync(expDir, { recursive: true });
  console.log(`[retro] ${name}: shares ${shares.map(pct).join(', ')}; shape ${arch.label}, ` +
              `${epochs} epochs, seed ${seed}; under ${expDir}`);

  // Probe at the HIGHEST share: that is the one the scarce class has to fill entirely, so its
  // row count is the cap every other arm is built to. Probing at share=1 like the medalist
  // ablation does would cap everything at the retro corpus alone and make a 0% arm 10x smaller
  // than the experiment asks for.
  const top = shares[shares.length - 1];
  const probeOut = path.join(expDir, `data-${tagOf(top)}.jsonl`);
  // --skipTrain must not re-slice. nn/data grows continuously while the trainer runs, so a second
  // pass over an existing run would draw a DIFFERENT corpus and a different equal-volume cap -- and
  // the arms it is about to play were trained on the first one. Reusing the existing stats file
  // keeps a follow-up run (more games on the decisive pairing, say) describing the real experiment.
  const probeStats = probeOut.replace(/\.jsonl$/, '') + '.stats.json';
  if (!(skipTrain && fs.existsSync(probeStats)))
    await run('data-slice.js', ['--class', 'retro', '--share', String(top), '--seed', seed, '--out', probeOut,
                                ...(userCap != null ? ['--positions', userCap] : [])]);
  else
    console.log(`[retro] --skipTrain: reusing the corpus the arms were trained on (${probeStats})`);
  const probe = readJson(probeStats, null);
  if (!probe || !probe.selected.rows) { console.error('[retro] probe slice produced no rows'); process.exitCode = 1; return; }
  const cap = String(probe.selected.rows);
  console.log(`[retro] equal-volume cap: ${cap} positions per arm ` +
              `(corpus holds ${probe.corpus.strongGames} retro families / ${probe.corpus.strongPos} positions)`);

  const arms = [];
  for (const s of shares) {
    const tag = tagOf(s);
    const slice = s === top ? probeOut : path.join(expDir, `data-${tag}.jsonl`);
    if (s !== top && !(skipTrain && fs.existsSync(slice)))
      await run('data-slice.js', ['--class', 'retro', '--share', String(s), '--seed', seed,
                                  '--positions', cap, '--out', slice]);
    const model = path.join(expDir, `arm-${tag}.json`);
    if (!(skipTrain && fs.existsSync(model)))
      await run('train-value.js', ['--data', slice, '--epochs', epochs, '--hidden', arch.hidden,
                                   ...arch.extra, '--seed', seed, '--out', model]);
    arms.push({ share: s, tag, model, name: path.basename(model, '.json'),
                stats: readJson(slice.replace(/\.jsonl$/, '') + '.stats.json', {}) });
  }

  // Round robin, one gauntlet run per unordered pair. A single gauntlet over models=all,
  // opponents=all would also play every arm against ITSELF -- at temperature 0 that is a fixed
  // 50% by construction and pure wasted machine time.
  const rr = [];
  for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
    const out = path.join(expDir, `rr-${arms[i].tag}-vs-${arms[j].tag}.json`);
    await run('gauntlet.js', ['--models', arms[i].model, '--opponents', arms[j].model,
                              '--games', games, '--depths', depthsArg, '--workers', workers,
                              '--shards', shardsArg, '--out', out]);
    for (const r of readJson(out, { results: [] }).results) rr.push(r);
  }

  const anchorOut = path.join(expDir, 'gauntlet-anchors.json');
  await run('gauntlet.js', ['--models', arms.map(a => a.model).join(','), '--opponents', anchors,
                            '--games', games, '--depths', depthsArg, '--workers', workers,
                            '--shards', shardsArg, '--out', anchorOut]);
  const anchorRows = readJson(anchorOut, { results: [] }).results;

  // Round-robin table. `decidedPct` already folds komi wins at their engine-exact discounted
  // value, so it is the honest single score, and it is the same field both gauntlet halves report.
  const depths = [...new Set(rr.map(r => r.depth))].sort((a, b) => a - b);
  const byName = Object.fromEntries(arms.map(a => [a.name, a]));
  const lines = [`# ${name} -- does retromine data make models better?`, '',
    `Equal-volume ablation: **${cap} positions per arm**, shape ${arch.label}, ${epochs} epochs, seed ${seed}.`,
    `Corpus: ${probe.corpus.strongGames} retro families / ${probe.corpus.strongPos} retro positions, ` +
    `${probe.corpus.poolGames} pool games / ${probe.corpus.poolPos} pool positions.`, '',
    'Every arm is trained FROM SCRATCH on the same number of rows; the arms differ only in what ' +
    'fraction of those rows came from Retromine. This measures the best retro fraction at a fixed ' +
    'corpus size, not whether retro data helps when piled on top of everything else.', '',
    '## Corpus actually built', '',
    '| arm | target retro share | retro families | retro rows | pool games | pool rows | total rows |',
    '|---|---|---|---|---|---|---|'];
  for (const a of arms) {
    const sel = a.stats.selected || {};
    lines.push(`| ${a.name} | ${pct(a.share)} | ${sel.strongGames ?? '?'} | ${sel.strongPos ?? '?'} | ` +
               `${sel.poolGames ?? '?'} | ${sel.poolPos ?? '?'} | ${sel.rows ?? '?'} |`);
  }

  for (const d of depths) {
    lines.push('', `## Round robin, D${d} (cell = row arm's score against column arm)`, '',
               `| | ${arms.map(a => pct(a.share)).join(' | ')} | points |`,
               `|---|${arms.map(() => '---').join('|')}|---|`);
    const points = {};
    for (const a of arms) {
      const cells = arms.map(b => {
        if (a === b) return '--';
        const fwd = rr.find(r => r.depth === d && r.name === a.name && r.opp === b.name);
        const rev = rr.find(r => r.depth === d && r.name === b.name && r.opp === a.name);
        const score = fwd ? fwd.decidedPct : rev ? 100 - rev.decidedPct : null;
        if (score == null) return '?';
        points[a.name] = (points[a.name] || 0) + score/100;
        return `${score}%`;
      });
      lines.push(`| **${pct(a.share)}** | ${cells.join(' | ')} | ${(points[a.name] || 0).toFixed(2)} |`);
    }
    lines.push('', 'Head-to-head detail (Elo interval is 2 sigma; a lower bound above 0 is the only ' +
               'thing here that proves a difference):', '',
               '| pairing | W-L-D | komi | decided% | Elo | call |', '|---|---|---|---|---|---|');
    for (const r of rr.filter(r => r.depth === d))
      lines.push(`| ${pct(byName[r.name].share)} vs ${pct((byName[r.opp] || {}).share ?? 0)} | ` +
                 `${r.w}-${r.l}-${r.d} | ${r.komiW}-${r.komiL} | ${r.decidedPct}% | ` +
                 `${r.rating && r.rating.elo != null ? `${Math.round(r.rating.elo)} [${Math.round(r.rating.lo)}, ${Math.round(r.rating.hi)}]` : 'n/a'} | ${r.call} |`);
  }

  lines.push('', '## Against the fixed anchors', '',
             '| arm | share | depth | opponent | W-L-D | komi | decided% | Elo | call |',
             '|---|---|---|---|---|---|---|---|---|');
  for (const r of anchorRows.sort((a, b) => a.name.localeCompare(b.name) || a.depth - b.depth || a.opp.localeCompare(b.opp)))
    lines.push(`| ${r.name} | ${pct((byName[r.name] || {}).share ?? 0)} | D${r.depth} | ${r.opp} | ` +
               `${r.w}-${r.l}-${r.d} | ${r.komiW}-${r.komiL} | ${r.decidedPct}% | ` +
               `${r.rating && r.rating.elo != null ? `${Math.round(r.rating.elo)} [${Math.round(r.rating.lo)}, ${Math.round(r.rating.hi)}]` : 'n/a'} | ${r.call} |`);

  lines.push('', '## Reading it', '',
    '- The round-robin **points** column is the headline: highest points = best retro fraction.',
    '- A points spread with every head-to-head interval straddling 0 means this run could not tell',
    '  the arms apart, which is itself an answer -- retro share is not worth much at this volume.',
    '- The anchor rows say whether the arms are strong enough for the comparison to mean anything.',
    '  Four arms that all lose 0-40 to L11 are four arms that were trained too small or too short.',
    '- Val loss is deliberately not tabulated: torch-train-core splits train/val by GAME, so a',
    '  retro replay family straddles the split and high-retro arms get an optimistic val number.',
    '  Played games do not have that problem, which is why the whole verdict rests on them.');

  const summary = path.join(expDir, 'summary.md');
  fs.writeFileSync(summary, lines.join('\n') + '\n');
  console.log(`\n[retro] done -> ${summary}`);
  console.log(lines.join('\n'));
}
main().catch(e => { console.error('[retro] failed:', e.stack || e.message); process.exitCode = 1; });
