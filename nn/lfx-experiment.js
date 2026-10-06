'use strict';

// Does training on the positions a search decides on make a net that gains more from depth?
// One controlled A/B, end to end (leaf-label.js has the argument).
//
//   1. leaf-label.js: the newest --positions game rows, each searched by the champion at D3 (scored
//      at the end of each line); every position a searched candidate was scored at is labelled
//      with the champion's D2 search, and so is every game row.
//   2. Two resumes of that same champion, same seed, same epochs, same labels on the game rows --
//      one trained on the game rows alone, one on the game rows plus the leaf rows. The leaves are
//      the only difference between them.
//   3. Head to head from random openings at D1, D2 and D3 (D3 scored at the end of each line, like
//      the labels). The question is the TREND: if the leaf arm's lead grows with depth, the leaves
//      taught the net about the positions deeper search walks into.
//
// Both nets go to nn/models as lfx-games-NNN.json and lfx-leaves-NNN.json, where the running
// trainer seats them in the league like any other model, so their D1-D4 curves get rated there
// too. Every step resumes: rerun the same command after a stop and finished work is kept.
//
//   node nn/lfx-experiment.js [--positions 10000] [--rootDepth 3] [--depth 2] [--blend 0.5]
//                             [--epochs 20] [--games 200] [--games2 80] [--games3 40]
//                             [--workers N] [--lanes N] [--out nn/lfx]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

const HERE = __dirname, ROOT = path.join(HERE, '..');
const out = path.resolve(arg('out', path.join(HERE, 'lfx')));
const half = String(Math.max(1, Math.floor(os.cpus().length / 2)));
const positions = arg('positions', '10000');
const rootDepth = arg('rootDepth', '3'), depth = arg('depth', '2');
const blend = arg('blend', '0.5');
const epochs = arg('epochs', '20');
const seed = arg('seed', '12345');
const games1 = +arg('games', 200), games2 = +arg('games2', 80), games3 = +arg('games3', 40);
const lanes = +arg('lanes', half);
const openingPlies = arg('openingPlies', '4');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!opts.quiet) console.log('\n$ ' + cmd + ' ' + args.join(' '));
    const ch = spawn(cmd, args, { cwd: ROOT, stdio: opts.stdio || 'inherit' });
    ch.on('error', reject);
    ch.on('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(args[0])} exited ${code}`)));
  });
}

const lineCount = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).length; } catch (e) { return 0; } };

async function train() {
  const armsFile = path.join(out, 'arms.json');
  let arms = null;
  try { arms = JSON.parse(fs.readFileSync(armsFile, 'utf8')); } catch (e) {}
  if (arms && fs.existsSync(arms.games) && fs.existsSync(arms.leaves) && !process.argv.includes('--retrain')) {
    console.log(`\nusing the trained pair from ${armsFile}: ${path.basename(arms.games)}, ${path.basename(arms.leaves)}`);
    return arms;
  }
  const models = path.join(HERE, 'models');
  let n = 1;
  const taken = new Set(fs.readdirSync(models).map(f => (/^lfx-(?:games|leaves)-(\d+)\.json$/.exec(f) || [])[1]).filter(Boolean).map(Number));
  while (taken.has(n)) n++;
  const tag = String(n).padStart(3, '0');
  arms = { games: path.join(models, `lfx-games-${tag}.json`), leaves: path.join(models, `lfx-leaves-${tag}.json`),
           blend: +blend, epochs: +epochs, seed: +seed, teacher: path.join(out, 'teacher.json') };
  // Elo weighting is off for both: it weights a game by who played it, and a leaf was played by
  // nobody, so it would sit at full weight beside down-weighted games and the arms would differ in
  // more than the leaves.
  const common = ['--epochs', epochs, '--resume', arms.teacher, '--seed', seed, '--eloWeight', 'off',
                  '--svBlend', blend, '--svMinDepth', depth];
  console.log(`\n=== training the pair from the teacher: game rows alone vs game rows + search leaves ===`);
  await run('node', [path.join(HERE, 'train-value.js'), ...common, '--data', path.join(out, 'rows-games', '*.jsonl'), '--out', arms.games]);
  await run('node', [path.join(HERE, 'train-value.js'), ...common, '--data', path.join(out, 'rows-*', '*.jsonl'), '--out', arms.leaves]);
  fs.writeFileSync(armsFile, JSON.stringify(arms, null, 1));
  return arms;
}

// One pairing split over lanes, each lane appending one line per game to its own results file; a
// rerun tops every lane up to its share instead of starting over.
async function match(tag, a, b, d, games, extra = []) {
  const per = Math.ceil(games / lanes);
  const jobs = [];
  for (let k = 0; k < lanes; k++) {
    const res = path.join(out, `match-${tag}-lane${k}.jsonl`);
    const left = per - lineCount(res);
    if (left <= 0) continue;
    const log = fs.openSync(path.join(out, `match-${tag}-lane${k}.log`), 'a');
    jobs.push(run('node', [path.join(HERE, 'arena.js'), '--a', `nn:0:${a}`, '--b', `nn:0:${b}`,
                           '--depthA', String(d), '--depthB', String(d), '--games', String(left),
                           '--openingPlies', openingPlies, '--resultsJsonl', res, ...extra],
                  { stdio: ['ignore', log, log], quiet: true }));
  }
  if (!jobs.length) return;
  console.log(`\n=== ${tag}: ${games} games at D${d} from ${openingPlies}-ply random openings over ${jobs.length} lane(s) ===`);
  const timer = setInterval(() => {
    let played = 0;
    for (let k = 0; k < lanes; k++) played += lineCount(path.join(out, `match-${tag}-lane${k}.jsonl`));
    console.log(`  ${tag}: ${played}/${per * lanes} games`);
  }, 60000);
  try { await Promise.all(jobs); } finally { clearInterval(timer); }
}

function tally(tag) {
  let w = 0, l = 0, d = 0;
  for (let k = 0; k < 256; k++) {
    const f = path.join(out, `match-${tag}-lane${k}.jsonl`);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch (e) { continue; }
      if (j.outcome === 'A') w++; else if (j.outcome === 'B') l++; else d++;
    }
  }
  const n = w + l + d;
  if (!n) return null;
  const elo = s => { s = Math.min(1 - 0.5/n, Math.max(0.5/n, s)); return 400*Math.log10(s/(1 - s)); };
  const s = (w + d/2)/n, se = Math.sqrt(s*(1 - s)/n);
  return { w, l, d, n, elo: elo(s), lo: elo(s - 1.96*se), hi: elo(s + 1.96*se) };
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  console.log(`=== search-leaf labels: ${positions} positions searched at D${rootDepth}, labelled at D${depth} ===`);
  await run('node', [path.join(HERE, 'leaf-label.js'), '--positions', positions, '--rootDepth', rootDepth, '--depth', depth,
                     '--workers', arg('workers', half), '--out', out]);
  const arms = await train();
  const pairings = [
    ['leaves-vs-games-D1', arms.leaves, arms.games, 1, games1, []],
    ['leaves-vs-games-D2', arms.leaves, arms.games, 2, games2, []],
    ['leaves-vs-games-D3', arms.leaves, arms.games, 3, games3, []],
  ];
  if (!process.argv.includes('--noMatch'))
    for (const [tag, a, b, d, g, extra] of pairings) await match(tag, a, b, d, g, extra);

  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  const lines = [`Search-leaf experiment (${new Date().toISOString()})`,
    `teacher ${meta.teacherFrom}, ${lineCount(path.join(out, 'rows-games', 'games.jsonl'))} game rows + ` +
    `${lineCount(path.join(out, 'rows-leaves', 'leaves.jsonl'))} leaf rows (searched at D${meta.rootDepth}, labelled at D${meta.depth}), ` +
    `blend ${arms.blend}, ${arms.epochs} epochs, seed ${arms.seed}`,
    `leaf arm ${path.basename(arms.leaves)}, game arm ${path.basename(arms.games)}`, ''];
  for (const [tag] of pairings) {
    const t = tally(tag);
    if (!t) continue;
    const f = x => (x >= 0 ? '+' : '') + Math.round(x);
    lines.push(`${tag.padEnd(20)} ${t.w}-${t.l}-${t.d} of ${t.n}   ${f(t.elo)} Elo [${f(t.lo)}, ${f(t.hi)}] for the leaf arm`);
  }
  lines.push('', 'Read the trend, not one row: a leaf-arm lead that grows from D1 to D3 is the effect being tested.');
  const report = lines.join('\n');
  fs.writeFileSync(path.join(out, 'report.txt'), report + '\n');
  console.log('\n' + report + `\n\n(saved to ${path.join(out, 'report.txt')})`);
}

main().catch(e => { console.error('[lfx-experiment] FAILED: ' + e.message); process.exitCode = 1; });
