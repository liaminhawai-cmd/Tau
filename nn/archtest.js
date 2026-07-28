// Does a different net SHAPE actually play better? Trains two or more architectures under
// identical conditions and settles it with games, not validation loss.
//
//   node nn/archtest.js --hidden 96,96 --hidden 96,96,96 [--epochs 30] [--seed 1]
//                       [--games 40] [--depth 1] [--vs models/best.json] [--data "nn/data/*.jsonl"]
//                       [--workers N]
//
// WHY THIS EXISTS RATHER THAN JUST RUNNING train.js TWICE BY HAND
// Two traps make the hand-rolled version answer the wrong question:
//
//   1. Comparing a from-scratch net against models/best.json confounds ARCHITECTURE with TRAINING
//      HISTORY. best.json is not "the 96,96 architecture" -- it is one specific 96,96 net that got
//      where it is via 60 resumed iterations on data that grew underneath it. A fresh 30-epoch net
//      losing to it says nothing about shape. So every architecture here is trained from scratch,
//      same data, same epoch budget, same --seed (same train/val split), and they are compared to
//      EACH OTHER. --vs adds the incumbent as an extra entrant, which answers the separate and also
//      interesting question "is a clean retrain on all accumulated data better than the
//      incrementally-grown net?" -- but it is never the architecture comparison itself.
//
//   2. Validation mse is not playing strength. It is the training objective, so it is the thing
//      most likely to improve for reasons that do not translate into won games (a net can shave mse
//      on quiet positions it already handles while getting no better at the sharp ones that decide
//      games). Every conclusion here is drawn from arena results; the val numbers train.js prints
//      along the way are context, not the verdict.
//
// Colours alternate inside arena.js and openings are randomised, so a pairing is a real sample
// rather than one deterministic line replayed.
//
// WHY --workers: training each architecture and playing each pairing are both embarrassingly
// parallel -- one architecture's training touches nothing another's does, and one pairing's games
// don't touch another's -- but this used to drive both through execFileSync, one process at a time,
// leaving every core but one idle for the whole run. That is exactly the trap tournament.js's own
// header comment describes hitting first (a 12-model round robin still running after an hour,
// single-threaded, next to selfplay.js forking one worker per core). Same fix here: a small promise
// pool runs up to --workers of these `node script.js` child processes at once. Output is buffered
// per task and printed as a whole block when that task finishes rather than streamed live, since
// several of these interleaved live (arena.js updates its line with \r) would just be noise.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
// --hidden is repeatable: collect every occurrence, not just the first.
function allArgs(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++)
    if (process.argv[i] === '--' + name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  return out;
}

const dir = __dirname;
const modelsDir = path.join(dir, 'models');
const hiddens = allArgs('hidden');
const epochs = arg('epochs', '30');
const seed = arg('seed', '1');
const games = arg('games', '40');
const depth = arg('depth', '1');
const dataPat = arg('data', path.join(dir, 'data', '*.jsonl'));
const vsModel = arg('vs', null);
const skipTrain = process.argv.includes('--skipTrain');
// Same default as run.js/tournament.js: most of the machine's cores, capped since the gain flattens
// and each worker here is a whole extra `node` process (loading the data file, its own engine, etc).
const workers = Math.max(1, +arg('workers', String(Math.max(1, Math.min(os.cpus().length - 1, 8)))));

if (hiddens.length < 1) {
  console.error('need at least one --hidden (e.g. --hidden 96,96 --hidden 96,96,96)');
  process.exit(1);
}

// Runs a script as a child process and resolves with its buffered stdout+stderr once it exits.
// Buffered rather than piped straight to this process's stdout because several of these can be
// in flight at once -- interleaved live output (arena.js's \r-updated progress line especially)
// would be unreadable across concurrent children.
function runAsync(script, args) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(dir, script), ...args]);
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('error', reject);
    child.on('exit', code => {
      const secs = (Date.now() - t0)/1000;
      if (code === 0) resolve({ out, secs });
      else reject(new Error(`node nn/${script} ${args.join(' ')} exited ${code}\n${out.slice(-2000)}`));
    });
  });
}

// Runs `tasks` (zero-arg functions returning promises) with at most `limit` in flight at once,
// preserving each task's own index in the returned array regardless of finish order -- same
// round-robin-over-workers idea as tournament.js/selfplay.js, just over promises instead of forked
// processes, since each unit of work here is a whole `node script.js` invocation rather than
// in-process work a fork would need to split.
async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function drain() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length || 1)) }, drain));
  return results;
}

async function main() {
  // ---- 1. train each architecture from scratch, identical budget and split ----
  // No --resume anywhere: resuming would inherit the checkpoint's shape and silently ignore
  // --hidden, which would make every entrant here the same architecture wearing different labels.
  const entrants = hiddens.map(h => {
    const label = 'arch-' + h.replace(/,/g, 'x');
    return { label, file: path.join(modelsDir, label + '.json'), hidden: h };
  });
  const toTrain = entrants.filter(e => !(skipTrain && fs.existsSync(e.file)));
  for (const e of entrants) {
    if (!toTrain.includes(e))
      // Note the risk this trades against: the existing file might have been trained at a
      // different --epochs/--seed, and nothing in it records that. Reusing it then silently
      // compares nets trained under different budgets. Delete models/arch-*.json to force a
      // clean rebuild.
      console.log(`\n(--skipTrain: reusing existing ${e.label}.json -- delete it to retrain)`);
  }
  if (toTrain.length) {
    console.log(`\ntraining ${toTrain.length} architecture(s), up to ${workers} at once...`);
    await pool(toTrain.map(e => async () => {
      console.log(`  start: ${e.label} (--hidden ${e.hidden})`);
      const { out, secs } = await runAsync('train.js', ['--data', dataPat, '--out', e.file,
        '--epochs', epochs, '--seed', seed, '--hidden', e.hidden]);
      console.log(`\n--- ${e.label} trained in ${secs.toFixed(0)}s ---\n${out}`);
      return e;
    }), workers);
  }

  if (vsModel) {
    const p = path.isAbsolute(vsModel) ? vsModel : path.join(process.cwd(), vsModel);
    if (fs.existsSync(p)) entrants.push({ label: 'incumbent(' + path.basename(p) + ')', file: p });
    else console.warn(`\nwarning: --vs ${vsModel} not found, continuing without it`);
  }

  if (entrants.length < 2) {
    console.error('\nneed at least 2 entrants to play a head-to-head -- add another --hidden or a --vs');
    process.exit(1);
  }

  // ---- 2. round robin, every entrant against every other, several pairings in flight at once ----
  // Same summary-line shape run.js's sweep parses: "... : 7-3  (70% of decided, ...)". Take the LAST
  // match on the line, since the live per-game tally has the same "N-M" shape earlier in the output.
  const score = out => {
    const m = [...out.matchAll(/:\s*(\d+)-(\d+)(?:-\d+)?\s+\(/g)];
    return m.length ? { w: +m[m.length - 1][1], l: +m[m.length - 1][2] } : null;
  };
  const pairs = [];
  for (let i = 0; i < entrants.length; i++)
    for (let j = i + 1; j < entrants.length; j++) pairs.push([entrants[i], entrants[j]]);
  console.log(`\n${pairs.length} pairing(s), up to ${workers} at once, ${games} games/pair, depth ${depth}...`);
  const pairResults = await pool(pairs.map(([A, B]) => async () => {
    const { out, secs } = await runAsync('arena.js', ['--a', 'nn:0:' + A.file, '--b', 'nn:0:' + B.file,
                                                       '--games', games, '--depth', depth]);
    const s = score(out);
    console.log(s ? `  done: ${A.label} vs ${B.label}: ${s.w}-${s.l}  (${secs.toFixed(0)}s)`
                  : `  done: ${A.label} vs ${B.label}: (no result, ${secs.toFixed(0)}s)`);
    return { A, B, s };
  }), workers);

  const wins = {}, decided = {};
  for (const e of entrants) { wins[e.label] = 0; decided[e.label] = 0; }
  const lines = [];
  for (const { A, B, s } of pairResults) {
    if (!s) { lines.push(`${A.label} vs ${B.label}: (no result)`); continue; }
    wins[A.label] += s.w; decided[A.label] += s.w + s.l;
    wins[B.label] += s.l; decided[B.label] += s.w + s.l;
    lines.push(`${A.label} vs ${B.label}: ${s.w}-${s.l}`);
  }

  // ---- 3. verdict ----
  console.log(`\n=== head-to-head (${games} games/pair, depth ${depth}, ${epochs} epochs, seed ${seed}) ===`);
  for (const l of lines) console.log('  ' + l);
  const ranked = entrants
    .map(e => ({ ...e, w: wins[e.label], d: decided[e.label],
                 rate: decided[e.label] ? wins[e.label]/decided[e.label] : 0 }))
    .sort((a, b) => b.rate - a.rate);
  console.log('\n=== ranking ===');
  ranked.forEach((r, i) => console.log(
    `${i + 1}. ${r.label}: ${r.w}/${r.d} decided (${(100*r.rate).toFixed(0)}%)`));
  console.log(`\nstrongest: ${ranked[0].label}`);
  // Deliberately no auto-promotion. Adopting a shape means every later iteration inherits it (run.js
  // resumes from best.json, so its shape becomes the run's shape), and one arena at one depth is a
  // thinner basis than that deserves -- rerun at --depth 2 before deciding.
  console.log('(nothing was promoted -- to adopt, copy the winner over models/best.json yourself)');

  // Also write the summary to a file. This run takes a while, so the console has usually
  // scrolled (or been frozen by a QuickEdit selection, which is how you'd copy it) by the time
  // anyone reads it. A file survives both, and can be opened without touching the running window.
  const stamp = new Date().toISOString();
  const report =
    `Tau architecture bake-off\n${stamp}\n\n` +
    `settings: ${epochs} epochs, seed ${seed}, ${games} games/pair, search depth ${depth}, ${workers} workers\n` +
    `data:     ${dataPat}\n\n` +
    `head-to-head:\n` + lines.map(l => '  ' + l).join('\n') + '\n\n' +
    `ranking:\n` + ranked.map((r, i) =>
      `  ${i + 1}. ${r.label}: ${r.w}/${r.d} decided (${(100*r.rate).toFixed(0)}%)`).join('\n') +
    `\n\nstrongest: ${ranked[0].label}\n`;
  const reportPath = path.join(dir, 'archtest-result.txt');
  try {
    fs.appendFileSync(reportPath, report + '\n' + '-'.repeat(60) + '\n\n');
    console.log(`\nsummary appended to ${reportPath}`);
  } catch (e) {
    console.warn(`\n(could not write ${reportPath}: ${e.message})`);
  }
}

main().catch(e => { console.error('\n' + (e && e.message || e)); process.exit(1); });
