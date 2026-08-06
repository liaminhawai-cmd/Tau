// The POLICY half of the split, for a second machine. Where run.js evolves the value net, this
// evolves the policy head against a value net it never touches: it pulls whatever the trainer has
// promoted, pairs it with competing policy heads, and hill-climbs the policy's SHAPE the same way
// run.js's shape fight hill-climbs the value net's -- one small random edit per cycle, adopted only
// on a clear win.
//
// Why this shape of thing, on this machine:
//   - It never trains a value net, never rates a model into the pool, never promotes best.json.
//     The desktop stays the single writer for all of that (the one rule that makes a multi-machine
//     setup safe). This machine only ever writes policy files and game data.
//   - Every tournament game is saved with --saveData, so a cycle produces training rows as a side
//     effect of measuring. The games are real games at a real think-time; reducing them to a
//     win-loss tally and discarding them would waste the most expensive compute here (the same
//     reasoning run.js's ladder sweep already applies to its own arena games).
//   - Everything is EQUAL THINK-TIME, never equal depth. arena.js's own header explains why: a
//     policy prunes, so at equal depth it sees a subset of what full search sees and can tie or
//     lose but never win. Its entire payoff is reaching further on the same clock.
//
// A cycle:
//   pull -> pick the newest value net -> mint policy targets from accumulated data ->
//   train a mutant of the champion's shape -> tournament (champion, mutant, and NO policy at all,
//   against each other and against ladder rungs) -> adopt the mutant only if it clearly beat the
//   champion -> push the games and the history -> repeat.
//
// The "no policy" entrant is not decoration: it is the control that keeps the whole exercise
// honest. A champion that beats its mutant but loses to a bare net has not earned anything.
//
// The shape fight itself is gated on that control once it has enough pooled evidence (see
// TARGET_SCHEME/gateFloor/poolStats below): no point paying for a shape hill-climb between two
// classifiers neither of which has been shown to beat no policy at all.
//
//   node nn/policyloop.js [--cycles 0] [--budgetHours 1] [--workers N] [--timeMs 2000]
//                         [--games 6] [--epochs 20] [--hidden 96,64] [--levels 5,7,9]
//                         [--gateFloor 150] [--noGate]
//   --cycles 0 (the default) means keep going forever.
'use strict';
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PolicyMLP } = require('./policy.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const dir = __dirname;
const repoRoot = path.join(dir, '..');
const log = m => console.log(`\n=== [${new Date().toISOString()}] ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cycles = Math.max(0, +arg('cycles', 0));            // 0 = forever
const budgetHours = Math.max(0.05, +arg('budgetHours', 1));
// One arena process per lane: arena.js is single-process, so parallelism here is N of them at once
// rather than anything inside it. cores-1 capped, same reasoning as worker.js's lanes.
const workers = Math.max(1, +arg('workers', Math.max(1, Math.min(os.cpus().length - 1, 12))));
const timeMs = arg('timeMs', '2000');
const gamesPerMatch = arg('games', '6');
const epochs = arg('epochs', '20');
const baseHidden = arg('hidden', '96,64');
const levels = arg('levels', '5,7,9').split(',').map(s => s.trim()).filter(Boolean);
const openingPlies = arg('openingPlies', '2');
// Fraction of tournament games starting from a random legal pose instead of the canonical opening.
// Two reasons, and the second is the one that made this non-optional. First, it widens where the
// policy is TESTED: a policy judged only on positions reachable from the standard opening says
// nothing about the rest of the board, and search spends most of its time off the played line
// anyway. Second, this machine's games are now the only ones it contributes to the corpus, and
// without this they are all the same value net against itself from the same opening -- far
// narrower than the self-play worker this replaces. Both sides of a game start from the same
// pose, so this widens coverage without biasing the comparison either way.
const randomStartFrac = arg('randomStartFrac', '0.35');
// Policy pruning (hard-drop to the top arms) is the default because at equal TIME that is the
// aggressive speed play the whole test is about. --ab 1 switches to ordering + cutoff instead,
// which is never blind but buys less. Both are legitimate; they are different questions.
const useAb = arg('ab', '0') !== '0';
// --timeMsLo/--timeMsHi: run every tournament match on a clock DRAWN PER GAME instead of a fixed
// one, both sides matched (see arena.js's flag for the full reasoning). Worth having in the loop
// rather than only as a one-off, because whether a search saving becomes strength depends on where
// the clock sits relative to the next ply boundary, and a loop pinned at one clock re-measures that
// single point forever -- 102 pooled games at 2000ms is a very precise answer to a narrow question.
// With a range, every cycle adds games across the whole curve and clocksweep.js can bin them.
const timeMsLo = arg('timeMsLo', null), timeMsHi = arg('timeMsHi', null);
const randomClock = !!(timeMsLo && timeMsHi);
// --policyArms: how many arms a PRUNING side keeps in recursion. Passed through because it was
// silently fixed at nnai.js's default of 3 for every result ever pooled; measured, 2 buys ~1.8x
// against a ~4-6x ply cost, so it does not rescue pruning -- but it is a real axis and a pool that
// does not record it cannot be compared against one that used a different value.
const policyArms = +arg('policyArms', 3);
// Floor on decided games before the head-to-head is allowed to move the champion at all. Not a
// significance test (see the verdict below) -- just a guard against 0-0 or a single fluke game
// deciding which shape the next cycle trains from.
const minDecided = Math.max(1, +arg('minDecided', 4));

// SIGNIFICANCE GATE: mutateHidden's shape fight is a deliberately loose, non-significant hill-climb
// (see the verdict comment below for why) -- fine when there is a true policy-vs-nopolicy effect to
// climb, wasted compute when there isn't, because champion and mutant are then just two equally
// uninformative classifiers and "which one won this cycle" is coinflip noise stacked on a null. The
// pooled champ-vs-nopolicy counter already answers that question with a real significance band
// (see realResult below) -- gateFloor wires it to skip the (expensive: a full retrain plus a
// multi-matchup tournament) shape fight once enough pooled evidence says there is nothing there yet,
// falling back to just the control match so the pooled counter keeps moving cheaply. Pass --noGate
// to force every cycle to run the full shape fight regardless (e.g. right after a change to how
// policy targets are mined, when old pooled evidence no longer describes the current system).
const gateFloor = Math.max(0, +arg('gateFloor', 150));
const noGate = process.argv.includes('--noGate');
// Bumped whenever a change to policy-target mining would make OLD pooled evidence non-comparable to
// new evidence (a different target distribution is a different experiment). Old history entries
// don't carry this field, so they are naturally excluded from a fresh scheme's pool -- nothing is
// deleted, the gate just starts counting again from zero for the new scheme. Current scheme: the
// mv/depth SOURCE WEIGHT (not a hard filter -- see policy-targets.js's header for why the filter
// version was reverted after a live A/B lost to both the unfiltered champion and no policy at all)
// + throw-target reconstruction, both in policy-targets.js.
const TARGET_SCHEME = 'search-weighted-v1';

const modelsDir = path.join(dir, 'models');
const dataDir = path.join(dir, 'data');
const champPath = path.join(modelsDir, 'policy-champ.json');
const mutantPath = path.join(modelsDir, 'policy-mutant.json');
// The champion's SHAPE lives in a file next to it, not in a variable: it has to survive restarts,
// and it is the thing actually being hill-climbed. Delete it to restart the climb from --hidden.
const champShapeFile = path.join(modelsDir, '.policy-champ-shape');
const historyFile = path.join(dir, 'policy-loop-history.jsonl');
const targetsPath = path.join(dir, 'policy-targets.jsonl');
const machine = (arg('name', os.hostname()) || 'local')
  .toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'local';

fs.mkdirSync(modelsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

// --- git, copied from worker.js's battle-tested path ------------------------------------------
// shell:true so Windows resolves `git` the way a typed command would; every arg quoted by hand
// because shell:true joins them with bare spaces; GitHub-Desktop-bundled git probed because that
// is the only git some machines have.
const q = s => '"' + String(s).replace(/"/g, '\\"') + '"';
let gitCmd;
function findGit() {
  if (gitCmd !== undefined) return gitCmd;
  const works = cmd => {
    try {
      execFileSync(cmd === 'git' ? 'git' : q(cmd), ['--version'],
                   { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return true;
    } catch (e) { return false; }
  };
  const candidates = ['git'];
  try {
    const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
    const ver = f => f.slice(4).split('.').map(Number);
    const apps = fs.readdirSync(base).filter(f => /^app-/.test(f))
      .sort((a, b) => { const va = ver(a), vb = ver(b);
        for (let i = 0; i < 3; i++) if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0);
        return 0; });
    for (const a of apps) candidates.push(path.join(base, a, 'resources', 'app', 'git', 'cmd', 'git.exe'));
  } catch (e) {}
  candidates.push('C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe');
  gitCmd = candidates.find(works) || null;
  return gitCmd;
}
function git(args) {
  const g = findGit();
  if (!g) throw new Error('git not found');
  return execFileSync(g === 'git' ? 'git' : q(g), args.map(q),
                      { cwd: repoRoot, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function gitSoft(args, what) {
  try { git(args); return true; }
  catch (e) {
    const raw = String((e && (e.stderr || e.stdout)) || (e && e.message) || e).trim().split('\n')[0];
    log(`${what} failed (${raw}) — continuing`);
    return false;
  }
}

// --- child processes ---------------------------------------------------------------------------
function run(script, args) {
  console.log(`\n$ node nn/${script} ${args.join(' ')}`);
  execFileSync('node', [path.join(dir, script), ...args], { stdio: 'inherit' });
}
function runSoft(script, args) {
  try { run(script, args); return true; }
  catch (e) { log(`WARNING: ${script} failed (${e.message}) — continuing`); return false; }
}
// One arena matchup as a promise. stdout captured (not inherited) because N of these run at once
// and interleaved progress lines from a dozen arenas are unreadable; the score line is what matters
// and it is parsed out and logged once, per matchup, on completion.
function runArena(args) {
  return new Promise(resolve => {
    let out = '';
    const ch = spawn('node', [path.join(dir, 'arena.js'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    ch.stdout.on('data', d => { out += d; });
    ch.stderr.on('data', d => { out += d; });
    ch.on('exit', () => resolve(out));
    ch.on('error', e => resolve(`arena failed to start: ${e.message}`));
  });
}
// arena.js's closing line: "nn(a) vs nn(b): 3-1  (75% of decided, ...)". Take the LAST such pair --
// the earlier ones are the live running tally, which has the same "N-M" shape.
// Komi wins (the move cap scored by the komi rule) arrive in their own "(komi A-B, ...)" field and
// count as KOMI_LOSS of a win each, so w/l come back fractional -- fine for every ratio and
// comparison here, and it stops a cap-scored game swinging a shape fight like a real one.
const KOMI_LOSS = 0.3;                    // must track CFG.komiLoss in index.html
const KOMI_W = 0.5 + KOMI_LOSS/2;
const arenaScore = out => {
  const m = [...out.matchAll(/:\s*(\d+)-(\d+)(?:-(\d+))?\s+\(/g)];
  if (!m.length) return null;
  const k = [...out.matchAll(/\(komi (\d+)-(\d+)/g)];
  const kA = k.length ? +k[k.length - 1][1] : 0, kB = k.length ? +k[k.length - 1][2] : 0;
  return { w: +m[m.length - 1][1] + KOMI_W*kA + (1 - KOMI_W)*kB,
           l: +m[m.length - 1][2] + KOMI_W*kB + (1 - KOMI_W)*kA,
           d: +(m[m.length - 1][3] || 0) };
};

// --- policy shape hill-climb -------------------------------------------------------------------
// Same edit vocabulary and the same one-edit-per-cycle discipline as run.js's value-net shape
// fight: change two things at once and a win says nothing about either.
function mutateHidden(spec) {
  const shape = spec.split(',').map(Number).filter(n => n > 0);
  if (!shape.length) return null;
  const snap = n => Math.max(8, Math.round(n/4)*4);
  const ops = ['widen', 'narrow', 'add'];
  if (shape.length > 2) ops.push('drop');
  for (let tries = 0; tries < 8; tries++) {
    const op = ops[Math.floor(Math.random()*ops.length)];
    const next = shape.slice();
    const i = Math.floor(Math.random()*next.length);
    if (op === 'widen') next[i] = snap(next[i]*(1.15 + Math.random()*0.2));
    else if (op === 'narrow') next[i] = snap(next[i]*(0.7 + Math.random()*0.15));
    else if (op === 'add') {
      const j = Math.floor(Math.random()*(next.length + 1));
      const a = next[j - 1] || next[0], b = next[j] || next[next.length - 1];
      next.splice(j, 0, snap(Math.sqrt(a*b)));
    } else next.splice(i, 1);
    const out = next.join(',');
    if (out !== spec) return { shape: out, op };
  }
  return null;
}
const champShape = () => {
  try { return JSON.parse(fs.readFileSync(champShapeFile, 'utf8')).shape || baseHidden; }
  catch (e) { return baseHidden; }
};
// The record carries the EPOCH COUNT the champion actually finished, and is written only after a
// training run returns successfully. train-policy.js rewrites its output file on every epoch that
// improves val CE, so a champion whose training was interrupted is still a complete-looking file on
// disk -- just undertrained. Without this record the next cycle would fight that 3-epoch champion
// against a full 20-epoch mutant and adopt the mutant on training budget rather than on shape,
// which is not a shape result at all. Observed live after a window was closed mid-training.
const setChampRecord = (shape, cycle, ep) => {
  try {
    fs.writeFileSync(champShapeFile,
      JSON.stringify({ shape, cycle, epochs: +ep, at: new Date().toISOString() }));
  } catch (e) {}
};
const champRecord = () => {
  try { return JSON.parse(fs.readFileSync(champShapeFile, 'utf8')); } catch (e) { return null; }
};

// The value net is PULLED, never trained here. Newest numbered checkpoint first, for the same
// reason worker.js prefers one: a numbered checkpoint is a frozen snapshot, so a result stays
// attributable even when the desktop promotes something new mid-cycle. best.json is the fallback.
function pickValueNet() {
  let best = null;
  try {
    const ck = fs.readdirSync(modelsDir).filter(f => /^ckpt-\d+\.json$/.test(f)).sort();
    if (ck.length) best = path.join(modelsDir, ck[ck.length - 1]);
  } catch (e) {}
  if (!best) {
    const b = path.join(modelsDir, 'best.json');
    if (fs.existsSync(b)) best = b;
  }
  return best;
}

// Sums champ-vs-nopolicy W/L across every history entry tagged with the CURRENT target scheme (see
// TARGET_SCHEME above) -- entries from an old scheme are silently excluded, not deleted, so changing
// how targets are mined starts the significance read over from zero instead of mixing two different
// experiments into one number. Same 2-sigma-band convention as the per-cycle verdict already uses.
// Shared by the pre-cycle gate check and the post-cycle log line so the two never drift apart.
// How the policy is USED is a second, independent experiment axis alongside TARGET_SCHEME (how
// targets are MINED), and pooling across it is just as wrong. policyPrune deletes arms outright;
// abCut orders them and cuts off once refuted. nnai.js's header gives the structural reason they
// cannot share a pool: pruning 6 arms to 3 saves ~30-40% while one more ply costs 4-6x, so at
// equal think time prune can never bank the depth it paid accuracy for, whereas abCut is never
// blind and its downside is wasted time rather than lost strength. Averaging the two answers a
// question nobody asked.
// Entries written before this field existed are treated as 'prune': it has been the default since
// the --ab flag was added and menu.bat has never passed --ab, so every historical entry really is
// a prune entry. That keeps the games already banked instead of discarding them.
const useMode = useAb ? 'abcut' : 'prune';
// The CLOCK is a third axis, and mixing a fixed-clock pool with a swept-clock one would average
// exactly the structure a sweep exists to expose. The arm count is a fourth, but only for a
// pruning side -- abcut orders rather than deletes, so arms do not apply and including it there
// would fragment the pool for no reason.
const clockTag = randomClock ? `t${timeMsLo}-${timeMsHi}` : `t${timeMs}`;
const armTag = useAb ? '' : `+a${policyArms}`;
// Entries predating these fields were all the defaults: fixed 2000ms (menu.bat never overrode it)
// and 3 arms (unreachable without editing nnai.js). Reading them as such keeps the banked games
// instead of discarding them.
const poolKey = h => `${h.scheme}+${h.use || 'prune'}+${h.clock || 't2000'}` +
                     ((h.use || 'prune') === 'abcut' ? '' : `+a${h.arms || 3}`);
const POOL_KEY = `${TARGET_SCHEME}+${useMode}+${clockTag}${armTag}`;

function poolStats(extra) {
  let w = 0, l = 0;
  try {
    for (const line of fs.readFileSync(historyFile, 'utf8').split('\n').filter(Boolean)) {
      const h = JSON.parse(line);
      if (poolKey(h) !== POOL_KEY) continue;
      const c = h.results && h.results['champ-vs-nopolicy'];
      if (c) { w += c.w; l += c.l; }
    }
  } catch (e) {}
  if (extra) { w += extra.w; l += extra.l; }
  const dec = w + l;
  if (!dec) return { w, l, dec, rate: null, band: null, verdict: 'no data yet' };
  const rate = w/dec, band = Math.sqrt(0.25/dec)*2;
  const verdict = rate - band > 0.5 ? 'beats' : rate + band < 0.5 ? 'loses' : 'undecided';
  return { w, l, dec, rate, band, verdict };
}

// --- one cycle -----------------------------------------------------------------------------------
async function runCycle(num) {
  const t0 = Date.now();
  const budgetMs = budgetHours*3600000;
  log(`policy cycle ${num}: pulling latest`);
  gitSoft(['pull', '--no-edit', '--no-rebase'], 'pull');

  const value = pickValueNet();
  if (!value) { log('no value net yet (need nn/models/best.json or a ckpt) — waiting 10 min'); await sleep(600000); return; }

  log(`policy cycle ${num}: minting policy targets from accumulated self-play data`);
  if (!runSoft('policy-targets.js', ['--out', targetsPath]) || !fs.existsSync(targetsPath)) {
    log('no targets minted — waiting 10 min'); await sleep(600000); return;
  }
  const targetRows = fs.readFileSync(targetsPath, 'utf8').split('\n').filter(Boolean).length;

  // The champion has to exist before it can be challenged. First cycle on a fresh machine trains it.
  const shape = champShape();
  const rec = champRecord();
  // A champion that loads and matches the record can still be UNUSABLE: PolicyMLP.fromJSON throws
  // if the net's input width doesn't match the live feature vector or its output width isn't
  // N_ARMS+N_BINS, which happens if the file predates a features.js/policy.js change. Observed live:
  // every champ-vs-* matchup silently returned "no result" for 12 straight cycles (~7h) while every
  // mutant-/nopolicy-only matchup ran fine, because the stale champion crashed arena.js before it
  // ever printed a score line -- and nothing here checked the champion itself, only its paperwork.
  const loadable = (() => {
    if (!fs.existsSync(champPath)) return true;   // the existsSync branch below already explains this
    try {
      PolicyMLP.fromJSON(JSON.parse(fs.readFileSync(champPath, 'utf8')));
      return true;
    } catch (e) { return e.message; }
  })();
  // Retrain the champion when it is missing, when it has no completion record (interrupted), when
  // it was trained for a different number of epochs than the mutant is about to get, or when it no
  // longer loads. All four are the same failure: a head-to-head that is not actually about the shape.
  const why = !fs.existsSync(champPath) ? 'no champion yet'
            : loadable !== true ? `champion no longer loads (${loadable}) — schema drifted since it was trained`
            : !rec ? 'champion has no completion record (training was interrupted)'
            : +rec.epochs !== +epochs ? `champion was trained for ${rec.epochs} epochs, mutant gets ${epochs}`
            : null;
  if (why) {
    log(`policy cycle ${num}: ${why} — training a champion at ${shape} (${targetRows} targets)`);
    if (!runSoft('train-policy.js', ['--targets', targetsPath, '--epochs', epochs,
                                     '--hidden', shape, '--out', champPath])) return;
    setChampRecord(shape, num, epochs);
  }

  // The challenger: one edit away from the champion, trained on the same targets, same epochs.
  // The fight is fair because everything except the shape is shared. Skipped entirely once the
  // pooled control (see poolStats/gateFloor above) says there is nothing yet to hill-climb: a shape
  // fight between two equally-uninformative classifiers is coinflip noise, and it is not cheap --
  // a full retrain plus its own tournament slots, every cycle, indefinitely.
  const priorPool = poolStats();
  const gated = !noGate && priorPool.dec >= gateFloor && priorPool.verdict !== 'beats';
  let mut = null, mutantOk = false;
  if (gated) {
    log(`policy cycle ${num}: GATED — pooled control is ${priorPool.verdict} at ` +
        `${(100*priorPool.rate).toFixed(0)}% +/- ${(100*priorPool.band).toFixed(0)} on ${priorPool.dec} ` +
        `decided (${POOL_KEY}) — skipping the mutant train + shape fight, ` +
        `keeping the control and ladder-anchor matches`);
  } else {
    mut = mutateHidden(shape);
    if (mut) {
      log(`policy cycle ${num}: shape fight — champion ${shape} vs mutant ${mut.shape} (${mut.op})`);
      mutantOk = runSoft('train-policy.js', ['--targets', targetsPath, '--epochs', epochs,
                                             '--hidden', mut.shape, '--out', mutantPath])
                 && fs.existsSync(mutantPath);
    }
  }

  // --- the tournament ----------------------------------------------------------------------------
  // Every entrant is the SAME value net; only the policy attached to it differs (or is absent).
  // That is what makes a result attributable to the policy rather than to the weights.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const saveData = path.join(dataDir, `policy-loop-${machine}-${stamp}.jsonl`);
  const side = (p, ab, which) => p
    ? [`--policy${which}`, p, ...(ab ? [`--ab${which}`] : [])]
    : [];
  const nn = 'nn:0:' + value;
  // Per-game records accumulate in ONE file per machine across every cycle, so clocksweep.js can
  // bin the whole run rather than a single cycle's handful of games -- which is the entire point of
  // sweeping the clock from inside a loop.
  const resultsPath = path.join(dataDir, `clocksweep-loop-${machine}.jsonl`);
  const clockArgs = randomClock
    ? ['--timeMsLo', timeMsLo, '--timeMsHi', timeMsHi]
    : ['--timeMs', timeMs];
  const base = ['--games', gamesPerMatch, ...clockArgs, '--openingPlies', openingPlies,
                '--policyArms', policyArms,
                '--randomStartFrac', randomStartFrac, '--saveData', saveData,
                ...(randomClock ? ['--resultsJsonl', resultsPath] : [])];
  const matches = [];
  const add = (tag, args) => matches.push({ tag, args });

  // The decisive comparison: champion vs mutant, same net, same clock, only the policy differs.
  if (mutantOk) add('champ-vs-mutant',
    ['--a', nn, '--b', nn, ...side(champPath, useAb, 'A'), ...side(mutantPath, useAb, 'B'), ...base]);
  // The control. A champion that beats its mutant but loses to a bare net has earned nothing.
  add('champ-vs-nopolicy', ['--a', nn, '--b', nn, ...side(champPath, useAb, 'A'), ...base]);
  if (mutantOk) add('mutant-vs-nopolicy',
    ['--a', nn, '--b', nn, ...side(mutantPath, useAb, 'A'), ...base]);
  // Ladder rungs: absolute grounding that cannot drift, plus varied opponents for the saved games.
  for (const L of levels) {
    add(`champ-vs-L${L}`, ['--a', nn, '--b', 'L' + L, ...side(champPath, useAb, 'A'), ...base]);
    if (mutantOk) add(`mutant-vs-L${L}`, ['--a', nn, '--b', 'L' + L, ...side(mutantPath, useAb, 'A'), ...base]);
    add(`nopolicy-vs-L${L}`, ['--a', nn, '--b', 'L' + L, ...base]);
  }

  log(`policy cycle ${num}: ${matches.length} matchups, ${workers} at a time, ${timeMs}ms/move, ` +
      `${gamesPerMatch} games each, budget ${budgetHours}h — all games saved to ` +
      path.relative(repoRoot, saveData).replace(/\\/g, '/'));

  // Dispatch pool: lanes pull the next matchup the moment they are free, and stop pulling once the
  // budget is spent. In-flight matchups are allowed to finish rather than being killed -- a killed
  // arena would leave a half-written score line and its games unattributed.
  const results = {};
  let next = 0, skipped = 0;
  async function lane() {
    for (;;) {
      if (next >= matches.length) return;
      if (Date.now() - t0 >= budgetMs) { skipped += matches.length - next; next = matches.length; return; }
      const m = matches[next++];
      const raw = await runArena(m.args);
      const s = arenaScore(raw);
      results[m.tag] = s;
      // A silent "no result" hid a real bug for 12 straight cycles once: every champ-vs-* matchup
      // was crashing (a stale/incompatible policy-champ.json) while every other matchup ran fine,
      // and there was nothing in the log to tell the two apart from a genuine engine hiccup. Same
      // fix elorank.js already applies to its own "no result" case -- print the tail of whatever
      // the child actually said, once, instead of nothing.
      const why = s ? '' : (() => {
        const line = String(raw || '').trim().split('\n').filter(Boolean).slice(-2).join(' | ');
        return line ? `: ${line}` : ': (arena produced no output at all)';
      })();
      log(`  ${m.tag}: ${s ? `${s.w}-${s.l}${s.d ? '-' + s.d : ''}` : 'no result' + why}` +
          ` [${Object.keys(results).length}/${matches.length}, ${((Date.now() - t0)/60000).toFixed(0)}m]`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, matches.length) }, () => lane()));
  if (skipped) log(`policy cycle ${num}: budget spent — ${skipped} matchup(s) not played this cycle`);

  // --- verdict -------------------------------------------------------------------------------------
  // Same discipline as run.js's shape fight: a clear margin or no change. The margin here is the
  // 2-sigma band on the decided games, the same convention arena.js's own summary prints, so the
  // bar automatically tightens as more games accumulate instead of being a fixed guess.
  // ADOPTION IS A CHEAP, REVERSIBLE HILL-CLIMB STEP, and is deliberately NOT a significance test.
  // Requiring a 2-sigma margin here sounds rigorous and is actually fatal: at 6 games a mutant
  // would need ~91% to clear the band, so the climb would essentially never move and every cycle
  // would retrain the same shape forever. Simply being ahead is the right bar for "which shape do
  // we train from next", because a mutant adopted on luck is beaten back by the next cycle's
  // comparison at no cost. Ties keep the champion -- free incumbency, which is what stops a purely
  // neutral edit from random-walking the shape.
  // The statistical bar belongs on the CLAIM, not the climb: that is champ-vs-nopolicy below, plus
  // the ladder rungs, which are absolute anchors that catch a drift the head-to-head cannot see.
  const hh = results['champ-vs-mutant'];
  let verdict = 'no head-to-head played', adopted = false;
  if (hh) {
    const dec = hh.w + hh.l;
    const mutWins = hh.l;                 // side A is the champion, so B's wins are the mutant's
    if (dec < minDecided) {
      verdict = `only ${dec} decided game(s), under the ${minDecided} floor — keeping the champion`;
    } else if (mutWins > hh.w) {
      verdict = `mutant ${mut.shape} (${mut.op}) won ${mutWins}-${hh.w} — ADOPTED as the shape to train from`;
      adopted = true;
    } else {
      verdict = `mutant ${mut.shape} (${mut.op}) did not win (${mutWins}-${hh.w}) — keeping the champion`;
    }
  }
  if (adopted) {
    try {
      fs.copyFileSync(mutantPath, champPath);
      setChampRecord(mut.shape, num, epochs);
    } catch (e) { log(`WARNING: could not adopt the mutant (${e.message}) — keeping the champion`); }
  }
  log(`policy cycle ${num} verdict: ${verdict}`);

  // Is the policy worth having at all? Reported every cycle, separately from the shape question,
  // because they are genuinely different questions and only this one can end the whole exercise.
  // THE actual result. Beating a mutant only says which of two policies is less bad; beating a
  // bare net at the same clock is the only thing that says a policy head is worth having at all.
  // This one DOES carry a significance bar, and it accumulates across cycles rather than being
  // re-judged from one cycle's handful of games -- a real effect should survive being pooled.
  const ctl = results['champ-vs-nopolicy'];
  // Same helper the pre-cycle gate check used, now folding THIS cycle's control result in -- pooled
  // only over history entries tagged with the current TARGET_SCHEME, same reasoning as the gate.
  const pool = poolStats(ctl);
  const REAL_RESULT = { beats: 'policy beats no-policy', loses: 'policy is a net LOSS',
                         undecided: 'not yet distinguishable from no policy' };
  const realResult = pool.dec ? REAL_RESULT[pool.verdict] : null;
  if (pool.dec) {
    log(`policy cycle ${num}: champion vs NO policy, POOLED over ${POOL_KEY} so far — ` +
        `${pool.w}-${pool.l}, ${(100*pool.rate).toFixed(0)}% +/- ${(100*pool.band).toFixed(0)} on ` +
        `${pool.dec} decided => ${realResult}`);
  }

  const rows = fs.existsSync(saveData)
    ? fs.readFileSync(saveData, 'utf8').split('\n').filter(Boolean).length : 0;
  try {
    fs.appendFileSync(historyFile, JSON.stringify({
      cycle: num, at: new Date().toISOString(), machine, value: path.basename(value),
      targets: targetRows, scheme: TARGET_SCHEME, use: useMode,
      clock: clockTag, arms: policyArms, gated,
      // the shape that FOUGHT, captured before any adoption overwrote it -- reporting the
      // post-adoption shape here made the log read as though a mutant had beaten itself
      champShape: shape, newChampShape: champShape(), mutant: mut ? mut.shape : null,
      op: mut ? mut.op : null, adopted, verdict, results, rows,
      realResult, pooledNoPolicy: { w: pool.w, l: pool.l },
      minutes: +((Date.now() - t0)/60000).toFixed(1),
    }) + '\n');
  } catch (e) {}

  // Push the GAMES and the history. Never the policy models: those stay local candidates until a
  // person promotes one, exactly like policyfight.js's rule.
  const rel = p => path.relative(repoRoot, p).replace(/\\/g, '/');
  const toPush = [saveData, historyFile].filter(fs.existsSync).map(rel);
  if (toPush.length) {
    let staged = false;
    for (const f of toPush) staged = gitSoft(['add', '-f', f], 'add') || staged;
    if (staged) {
      gitSoft(['commit', '-m', `nn: policy loop cycle ${num} from ${machine} (${rows} rows)`], 'commit');
      let pushed = false;
      for (const wait of [0, 2000, 4000, 8000, 16000]) {
        if (wait) await sleep(wait);
        gitSoft(['pull', '--no-edit', '--no-rebase'], 'pre-push pull');
        if (gitSoft(['push'], 'push')) { pushed = true; break; }
      }
      log(`policy cycle ${num}: ${rows} training rows ` +
          (pushed ? 'pushed' : 'committed locally — will ride along next cycle'));
    }
  }
  log(`policy cycle ${num} done in ${((Date.now() - t0)/60000).toFixed(0)}m`);
}

async function main() {
  log(`policy loop up on "${machine}": ${workers} arena lanes, ` +
      `policy used as ${useMode === 'abcut' ? 'ORDERING + cutoff (--ab 1)' : `hard PRUNING keeping ${policyArms} arms`}, ` +
      `clock ${randomClock ? `RANDOM ${timeMsLo}-${timeMsHi}ms per game` : `${timeMs}ms/move fixed`}, ` +
      `pooling under ${POOL_KEY}, ` +
      `${budgetHours}h per cycle, ${cycles || 'unlimited'} cycle(s). ` +
      `Close this window any time — everything already pushed is shared, and the champion policy ` +
      `on disk survives for the next run.`);
  log(`this machine never trains a value net and never writes the rating pool: it pulls whatever ` +
      `the trainer promoted and only evolves the policy head against it.`);
  for (let n = 1; !cycles || n <= cycles; n++) {
    try { await runCycle(n); }
    catch (e) { log(`WARNING: policy cycle ${n} failed (${e && e.message}) — continuing`); await sleep(60000); }
  }
  log('policy loop: requested cycles complete');
}

main().catch(e => { log(`FATAL: ${(e && e.message) || e}`); process.exitCode = 1; });
