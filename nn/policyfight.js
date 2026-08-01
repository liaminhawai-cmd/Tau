// One-shot: mine policy targets from whatever self-play data already exists, train a policy head
// on them, then fight it against the plain net at EQUAL THINK-TIME -- the only fair test (see
// arena.js's own header: at equal DEPTH a policy can tie or lose but never win, since pruning only
// ever sees a subset of what full search sees; its entire payoff is reaching further in the same
// clock, which only equal time exposes).
//
// Wall-clock bounded so this finishes on a schedule regardless of how busy the machine is --
// e.g. running alongside a self-play worker that already has every core doing something. Games
// are played in small batches; the loop checks the clock between batches and stops once
// --budgetHours is spent, reporting on however many games actually finished.
//
// Pure investigation, not part of the pipeline: nothing here touches git, and nothing here writes
// to a file worker.js or run.js read (see currentModelPool()'s allowlist in both -- pool-slot-N /
// wide / ultra / deep / l15_value only, so this candidate is invisible to self-play and the pool
// until a person promotes it on purpose). Same "measured, then a human decides" shape menu.bat's
// own policy options already use (options 2-9), just chained into one command with a time budget
// instead of several manual steps with no clock on any of them.
//
//   node nn/policyfight.js [--budgetHours 2] [--timeMs 500] [--epochs 20] [--hidden 96,64]
//                          [--model nn/models/best.json] [--out nn/models/policy-fight.json]
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const dir = __dirname;
const log = m => console.log(`\n=== [${new Date().toISOString()}] ${m}`);

const budgetHours = Math.max(0.05, +arg('budgetHours', 2));
const timeMs = arg('timeMs', '500');
const epochs = arg('epochs', '20');
const hidden = arg('hidden', '96,64');
const model = arg('model', path.join(dir, 'models', 'best.json'));
const outPolicy = arg('out', path.join(dir, 'models', 'policy-fight.json'));
const targetsPath = path.join(dir, 'policy-targets.jsonl');
const gamesPerBatch = Math.max(1, +arg('gamesPerBatch', 6));
const openingPlies = arg('openingPlies', '2');
// Plain filename, no leading dot, and in nn/ rather than buried in nn/data: the first version of
// this hid the only record of a run in a dotfile among hundreds of data files, and a closed console
// window then meant the result was effectively unrecoverable. Written at EVERY stage, not just at
// the end, so a run that dies during mining or training still says where it got to.
const resultPath = path.join(dir, 'policy-fight-result.txt');
let resultLines = [];
function note(line) {
  resultLines.push(`[${new Date().toISOString()}] ${line}`);
  try { fs.writeFileSync(resultPath, resultLines.join('\n') + '\n'); } catch (e) {}
}
const statusPath = path.join(dir, 'data', '.policy-fight-status.json');

function run(script, args) {
  console.log(`\n$ node nn/${script} ${args.join(' ')}`);
  execFileSync('node', [path.join(dir, script), ...args], { stdio: 'inherit' });
}
function runCaptured(script, args) {
  console.log(`\n$ node nn/${script} ${args.join(' ')}`);
  const out = execFileSync('node', [path.join(dir, script), ...args], { encoding: 'utf8' });
  process.stdout.write(out);
  return out;
}
// Best-effort progress file -- so the running score survives a closed window, and so it can be
// checked (by a person, or by pasting it back) without waiting for the whole budget to elapse.
// No atomic-write dance: this process is the only writer, unlike the multi-machine git-tracked
// files elsewhere, so a plain overwrite has nothing to race against.
function writeStatus(o) { try { fs.writeFileSync(statusPath, JSON.stringify(o, null, 2)); } catch (e) {} }

if (!fs.existsSync(model)) { console.error(`model not found: ${model}`); process.exit(1); }
try { fs.mkdirSync(path.dirname(outPolicy), { recursive: true }); } catch (e) {}

log(`policy fight -- budget ${budgetHours}h, ${timeMs}ms/move, base net ${path.basename(model)}`);
note(`policy fight started -- budget ${budgetHours}h, ${timeMs}ms/move, base net ${path.basename(model)}`);
log(`results are written to ${path.relative(path.join(dir, '..'), resultPath)} as they happen, so a closed window loses nothing`);
log('this window can be closed any time: the trained candidate below is saved after step 2, and ' +
    `the running score after every batch is saved to ${path.relative(path.join(dir, '..'), statusPath)}`);

log('step 1/3: mining policy targets from existing self-play data (no games replayed)');
run('policy-targets.js', ['--out', targetsPath]);
if (!fs.existsSync(targetsPath)) { console.error('no targets minted -- not enough tagged data yet'); process.exit(1); }
const targetRows = fs.readFileSync(targetsPath, 'utf8').split('\n').filter(Boolean).length;
log(`mined ${targetRows} targets`);
note(`step 1 done: mined ${targetRows} policy targets`);

log(`step 2/3: training policy head (hidden ${hidden}, ${epochs} epochs)`);
run('train-policy.js', ['--targets', targetsPath, '--epochs', epochs, '--hidden', hidden, '--out', outPolicy]);
if (!fs.existsSync(outPolicy)) { note('step 2 FAILED: training produced no model'); console.error('training did not produce a model'); process.exit(1); }
note(`step 2 done: trained ${path.basename(outPolicy)} (hidden ${hidden}, ${epochs} epochs)`);

log(`step 3/3: equal-think-time fight vs the plain net, ${timeMs}ms/move, ` +
    `${gamesPerBatch}-game batches until ${budgetHours}h is spent`);
const t0 = Date.now();
const budgetMs = budgetHours*3600000;
let aWins = 0, bWins = 0, draws = 0, batches = 0;
do {
  const out = runCaptured('arena.js', ['--a', 'nn:0:' + model, '--b', 'nn:0:' + model,
    '--policyA', outPolicy, '--timeMs', timeMs, '--games', String(gamesPerBatch),
    '--openingPlies', openingPlies]);
  const m = out.match(/:\s*(\d+)-(\d+)(?:-(\d+))?\s+\(/);
  if (m) { aWins += +m[1]; bWins += +m[2]; draws += +(m[3] || 0); }
  batches++;
  const dec = aWins + bWins;
  const elapsedH = (Date.now() - t0)/3600000;
  log(`running total after ${batches} batch(es), ${elapsedH.toFixed(2)}h: ` +
      `policy ${aWins} - ${bWins} plain` + (draws ? ` (${draws} draws)` : '') +
      (dec ? `, ${(100*aWins/dec).toFixed(0)}% of ${dec} decided` : ''));
  note(`batch ${batches}: policy ${aWins} - ${bWins} plain` + (draws ? ` (${draws} draws)` : '') +
       (dec ? `, ${(100*aWins/dec).toFixed(0)}% of ${dec} decided` : '') + `, ${elapsedH.toFixed(2)}h elapsed`);
  writeStatus({ startedAt: new Date(t0).toISOString(), updatedAt: new Date().toISOString(),
                model, policy: outPolicy, timeMs: +timeMs, batches, aWins, bWins, draws,
                elapsedHours: +elapsedH.toFixed(2), budgetHours });
} while (Date.now() - t0 < budgetMs);

const dec = aWins + bWins;
const winRate = dec ? aWins/dec : 0.5;
const band = dec ? Math.sqrt(0.25/dec)*2 : 1;   // 2-sigma, same convention arena.js's own summary uses
let verdict;
if (dec < 20)
  verdict = `not enough decided games (${dec}) yet to say anything -- rerun with a bigger --budgetHours`;
else if (winRate - band > 0.5)
  verdict = 'CLEAR WIN for the policy -- worth trying for real (copy over nn/models/policy.json, ' +
            'or hand this path to menu.bat option 6)';
else if (winRate + band < 0.5)
  verdict = 'CLEAR LOSS for the policy -- not worth it on this data yet';
else
  verdict = `INCONCLUSIVE (${(100*winRate).toFixed(0)}% +/- ${(100*band).toFixed(0)} points) -- ` +
            're-run later once more self-play data has accumulated; the mined targets are cheap, ' +
            'nothing here is wasted by waiting';

const totalH = (Date.now() - t0)/3600000;
log(`FINAL after ${batches} batch(es), ${totalH.toFixed(2)}h: ` +
    `policy ${aWins} - ${bWins} plain` + (draws ? ` (${draws} draws)` : ''));
console.log(`\n${verdict}\n`);
note(`FINAL: policy ${aWins} - ${bWins} plain` + (draws ? ` (${draws} draws)` : '') + ` over ${batches} batch(es), ${totalH.toFixed(2)}h`);
note(`VERDICT: ${verdict}`);
console.log(`Candidate saved at: ${outPolicy}`);
console.log(`Trained on ${targetRows} targets mined from whatever self-play data existed when this started.`);
