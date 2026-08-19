'use strict';
// The medalist-data ablation, end to end: does training on strong-play games beat training on
// zoo games, at EQUAL data volume?
//
// For each --shares value s it builds a corpus of identical total size whose composition is
// s medalist-game positions : (1-s) pool-game positions (data-slice.js), trains one net per arm
// with identical shape/epochs/seed (train-value.js --data), then runs every arm through the same
// fixed gauntlet (gauntlet.js) against best.json, L10 and L11 -- plus best.json itself through
// the ladder part as the reference row. Nothing here touches nn/models or the live league: arms
// live under nn/experiments/<name>/ where the roster never scans.
//
//   node nn/experiment-medalist.js                       # shares 1,0.5,0.25,0 with defaults
//   node nn/experiment-medalist.js --shares 1,0 --epochs 12 --games 40 --rule both
//
// Equal volume is enforced by probing the share=1 slice first: its position count (the scarce
// class) caps every arm, so arms differ ONLY in composition. If that number is tiny the run
// still completes -- a weak result with 15k positions is the signal to grow the medalist corpus
// (elite league / best-model self-play) and rerun, not a verdict.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const dir = __dirname;
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };

const shares = String(arg('shares', '1,0.5,0.25,0')).split(',').map(Number).filter(s => s >= 0 && s <= 1);
const epochs = String(+arg('epochs', 8));
const seed = String(+arg('seed', 12345));
const games = String(Math.max(2, +arg('games', 24) & ~1));
const depthsArg = arg('depths', '1,2');
const rule = arg('rule', 'any');
const name = arg('name', `medalist-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`);
const expDir = path.join(dir, 'experiments', name);
const best = path.join(dir, 'models', 'best.json');

// Arms only need to be identical to EACH OTHER; a compact shape surfaces the data-quality
// signal just as well as best.json's big one and trains each arm in minutes, not hours.
const hidden = arg('hidden', '96,96');

function run(script, args) {
  return new Promise((ok, bad) => {
    console.log(`\n$ node nn/${script} ${args.join(' ')}`);
    const ch = spawn(process.execPath, [path.join(dir, script), ...args], { stdio: 'inherit' });
    ch.on('error', bad);
    ch.on('exit', c => c === 0 ? ok() : bad(new Error(`${script} exited ${c}`)));
  });
}
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const passThrough = [];
for (const n of ['medalists', 'top']) if (arg(n) != null) passThrough.push('--' + n, arg(n));
const userCap = arg('positions');

async function main() {
  if (!shares.length) { console.error('[experiment] no valid --shares'); process.exitCode = 1; return; }
  fs.mkdirSync(expDir, { recursive: true });
  console.log(`[experiment] ${name}: shares ${shares.join(', ')}; shape ${hidden}, ${epochs} epochs, ` +
              `rule ${rule}; arms and slices under ${expDir}`);

  // Probe: the share=1 slice defines the scarce-class size that every arm is capped to.
  const probeOut = path.join(expDir, 'data-share1.jsonl');
  await run('data-slice.js', ['--share', '1', '--rule', rule, '--seed', seed, '--out', probeOut,
                              ...(userCap != null ? ['--positions', userCap] : []), ...passThrough]);
  const probe = readJson(probeOut.replace(/\.jsonl$/, '') + '.stats.json', null);
  if (!probe || !probe.selected.rows) { console.error('[experiment] share=1 probe produced no rows'); process.exitCode = 1; return; }
  const cap = String(probe.selected.rows);
  console.log(`[experiment] equal-volume cap: ${cap} positions per arm ` +
              `(medalists: ${probe.medalists.join(', ')})`);

  const arms = [];
  for (const s of shares) {
    const tag = `share${s}`;
    const slice = s === 1 ? probeOut : path.join(expDir, `data-${tag}.jsonl`);
    if (s !== 1)
      await run('data-slice.js', ['--share', String(s), '--rule', rule, '--seed', seed,
                                  '--positions', cap, '--out', slice, ...passThrough]);
    const model = path.join(expDir, `arm-${tag}.json`);
    await run('train-value.js', ['--data', slice, '--epochs', epochs, '--hidden', hidden,
                                 '--seed', seed, '--out', model]);
    arms.push({ share: s, tag, model, stats: readJson(slice.replace(/\.jsonl$/, '') + '.stats.json', {}) });
  }

  const armGauntlet = path.join(expDir, 'gauntlet-arms.json');
  await run('gauntlet.js', ['--models', arms.map(a => a.model).join(','), '--opponents', 'best,L10,L11',
                            '--games', games, '--depths', depthsArg, '--out', armGauntlet]);
  const refGauntlet = path.join(expDir, 'gauntlet-best.json');
  await run('gauntlet.js', ['--models', best, '--opponents', 'L10,L11',
                            '--games', games, '--depths', depthsArg, '--out', refGauntlet]);

  const g = [...(readJson(armGauntlet, { results: [] }).results), ...(readJson(refGauntlet, { results: [] }).results)];
  const lines = [`# ${name}`, '',
    `Equal-volume ablation: ${cap} positions/arm, shape ${hidden}, ${epochs} epochs, seed ${seed}, rule ${rule}.`,
    `Medalists: ${probe.medalists.join(', ')}`, '',
    '| model | share | depth | opponent | W-L-D | komi | decided% |', '|---|---|---|---|---|---|---|'];
  const shareOf = n => { const a = arms.find(x => path.basename(x.model, '.json') === n); return a ? String(a.share) : 'ref'; };
  for (const r of g.sort((a, b) => a.name.localeCompare(b.name) || a.depth - b.depth || a.opp.localeCompare(b.opp)))
    lines.push(`| ${r.name} | ${shareOf(r.name)} | D${r.depth} | ${r.opp} | ${r.w}-${r.l}-${r.d} | ` +
               `${r.komiW}-${r.komiL} | ${r.decidedPct}% |`);
  const summary = path.join(expDir, 'summary.md');
  fs.writeFileSync(summary, lines.join('\n') + '\n');
  console.log(`\n[experiment] done -> ${summary}`);
}
main().catch(e => { console.error('[experiment] failed:', e.stack || e.message); process.exitCode = 1; });
