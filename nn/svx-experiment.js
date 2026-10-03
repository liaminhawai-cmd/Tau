'use strict';

// Does training on search scores make a stronger net? One controlled A/B, end to end.
//
//   1. search-label.js: the newest --positions rows, each scored by the champion's own D2 search.
//   2. Two resumes of that same champion on exactly those rows, same seed, same epochs, same
//      everything -- one trained on the game result alone (what every net trains on today), one on
//      --blend*search + (1-blend)*result. The label is the only difference between them.
//   3. Head-to-head matches from random openings: search arm vs result arm at D1 and D2, and each
//      arm vs the teacher at D1, so a gain can be told apart from both arms merely drifting.
//
// Both nets are written to nn/models as svx-result-NNN.json and svx-search-NNN.json, where the
// running trainer seats them in the league like any other model and the normal gate applies.
// Every step resumes: rerun the same command after a stop and finished work is kept.
//
//   node nn/svx-experiment.js [--positions 20000] [--depth 2] [--blend 0.5] [--epochs 20]
//                             [--games 200] [--games2 80] [--workers N] [--lanes N] [--out nn/svx]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

const HERE = __dirname, ROOT = path.join(HERE, '..');
const out = path.resolve(arg('out', path.join(HERE, 'svx')));
const half = String(Math.max(1, Math.floor(os.cpus().length / 2)));
const positions = arg('positions', '20000');
const depth = arg('depth', '2');
const blend = arg('blend', '0.5');
const epochs = arg('epochs', '20');
const seed = arg('seed', '12345');
const games1 = +arg('games', 200), games2 = +arg('games2', 80);
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
  if (arms && fs.existsSync(arms.result) && fs.existsSync(arms.search) && !process.argv.includes('--retrain')) {
    console.log(`\nusing the trained pair from ${armsFile}: ${path.basename(arms.result)}, ${path.basename(arms.search)}`);
    return arms;
  }
  const models = path.join(HERE, 'models');
  let n = 1;
  const taken = new Set(fs.readdirSync(models).map(f => (/^svx-(?:result|search)-(\d+)\.json$/.exec(f) || [])[1]).filter(Boolean).map(Number));
  while (taken.has(n)) n++;
  const tag = String(n).padStart(3, '0');
  arms = { result: path.join(models, `svx-result-${tag}.json`), search: path.join(models, `svx-search-${tag}.json`),
           blend: +blend, epochs: +epochs, seed: +seed, teacher: path.join(out, 'teacher.json') };
  const common = ['--epochs', epochs, '--resume', arms.teacher, '--data', path.join(out, 'labels.jsonl'), '--seed', seed];
  console.log(`\n=== training the pair from the teacher: result labels vs ${blend}*search + ${1 - blend}*result ===`);
  await run('node', [path.join(HERE, 'train-value.js'), ...common, '--svBlend', '0', '--out', arms.result]);
  await run('node', [path.join(HERE, 'train-value.js'), ...common, '--svBlend', blend, '--svMinDepth', depth, '--out', arms.search]);
  fs.writeFileSync(armsFile, JSON.stringify(arms, null, 1));
  return arms;
}

// One pairing, split over lanes, each lane appending one line per game to its own results file
// (arena.js --resultsJsonl). A rerun tops every lane up to its share instead of starting over.
async function match(tag, a, b, d, games) {
  const per = Math.ceil(games / lanes);
  const jobs = [];
  for (let k = 0; k < lanes; k++) {
    const res = path.join(out, `match-${tag}-lane${k}.jsonl`);
    const left = per - lineCount(res);
    if (left <= 0) continue;
    const log = fs.openSync(path.join(out, `match-${tag}-lane${k}.log`), 'a');
    jobs.push(run('node', [path.join(HERE, 'arena.js'), '--a', `nn:0:${a}`, '--b', `nn:0:${b}`,
                           '--depthA', String(d), '--depthB', String(d), '--games', String(left),
                           '--openingPlies', openingPlies, '--resultsJsonl', res],
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
  console.log(`=== search-score labels: ${positions} positions at D${depth} ===`);
  await run('node', [path.join(HERE, 'search-label.js'), '--positions', positions, '--depth', depth,
                     '--workers', arg('workers', half), '--out', out]);
  const arms = await train();
  const teacher = arms.teacher;
  const pairings = [
    ['search-vs-result-D1', arms.search, arms.result, 1, games1],
    ['search-vs-teacher-D1', arms.search, teacher, 1, games1],
    ['result-vs-teacher-D1', arms.result, teacher, 1, games1],
    ['search-vs-result-D2', arms.search, arms.result, 2, games2],
  ];
  if (!process.argv.includes('--noMatch'))
    for (const [tag, a, b, d, g] of pairings) await match(tag, a, b, d, g);

  const lines = [`Search-score experiment (${new Date().toISOString()})`,
    `teacher ${JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8')).teacherFrom}, ` +
    `${lineCount(path.join(out, 'labels.jsonl'))} positions labelled at D${depth}, ` +
    `blend ${arms.blend}, ${arms.epochs} epochs, seed ${arms.seed}`,
    `search arm ${path.basename(arms.search)}, result arm ${path.basename(arms.result)}`, ''];
  for (const [tag] of pairings) {
    const t = tally(tag);
    if (!t) continue;
    const f = x => (x >= 0 ? '+' : '') + Math.round(x);
    lines.push(`${tag.padEnd(22)} ${t.w}-${t.l}-${t.d} of ${t.n}   ${f(t.elo)} Elo [${f(t.lo)}, ${f(t.hi)}] for the first-named net`);
  }
  const report = lines.join('\n');
  fs.writeFileSync(path.join(out, 'report.txt'), report + '\n');
  console.log('\n' + report + `\n\n(saved to ${path.join(out, 'report.txt')})`);
}

main().catch(e => { console.error('[svx-experiment] FAILED: ' + e.message); process.exitCode = 1; });
