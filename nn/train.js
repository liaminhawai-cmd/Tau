// Train the value net on selfplay data.
//   node nn/train.js --data "nn/data/*.jsonl" --out nn/models/value.json
//                    [--epochs 8] [--lr 0.001] [--batch 256] [--hidden 64,64] [--resume path]
//                    [--seed N] [--gameWeight sqrt|game|row] [--familyWeight sqrt|off]
//                    [--drawWeight 0.25] [--eloWeight 0|1]
'use strict';
const fs = require('fs');
const path = require('path');
const { MLP } = require('./net.js');
const { N_FEATURES } = require('./features.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

// Deterministic PRNG (mulberry32), used only when --seed is passed. Point: comparing two --hidden
// architectures is only a clean read on CAPACITY if both see the identical train/val split -- with
// the default Math.random() shuffle below, two separate runs hold out different games, and
// that split noise gets baked into whatever val-mse/sign-acc gap you're trying to attribute to the
// architecture. Opt-in and off by default so normal training (where the split doesn't need to match
// anything) is unaffected.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadData(pattern) {
  const dir = path.dirname(pattern), base = path.basename(pattern);
  const rx = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const rows = [];
  const stale = new Map();          // file -> rows whose feature vector is the wrong LENGTH
  // file -> rows with no `f` at all. Distinct from `stale` on purpose, because they mean opposite
  // things and deserve opposite responses. A wrong-LENGTH f is a real training row from an older
  // feature set: the corpus is genuinely unusable and the run must stop (see the hard fail below).
  // A row with NO f was never a training row -- it is some other kind of record that landed in this
  // directory, e.g. arena.js's --resultsJsonl per-GAME records ({game, timeMs, outcome, plies}).
  // Treating those as a feature-set migration halts training on a corpus that is perfectly fine,
  // which is exactly what happened once: policyloop.js wrote its clocksweep results into nn/data
  // and every train.js call in the full trainer died on it -- self-play, rating and ladder sweeps
  // all kept running, so the loop looked healthy while the value net silently never trained.
  const notTraining = new Map();
  let tagged = 0, inferredGames = 0, policyRows = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!rx.test(f)) continue;
    // Game-boundary inference, for rows written before selfplay.js started stamping `g`.
    // selfplay labels a game's positions with z = ±discount^(plies to end), and plies-to-end
    // COUNTS DOWN through the game, so |z| rises monotonically from the game's first row to its
    // last and then drops at the next game's first row. A fall in |z| is therefore a game
    // boundary. Rows are read in the order selfplay appended them (one game's positions
    // contiguous), and this restarts per file so a file boundary can't fuse two games.
    // Only a fallback: a row carrying a real `g` always uses it.
    let prevAbs = Infinity, curInferred = null;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const j = JSON.parse(line);
        if (!j.f) { notTraining.set(f, (notTraining.get(f) || 0) + 1); continue; }
        if (j.f.length !== N_FEATURES) { stale.set(f, (stale.get(f) || 0) + 1); continue; }
        // Policy-head targets (policy-targets.js) carry a real `f` and `z` alongside `arm`/`bin`,
        // so they sail past the length check above and get trained on as ordinary value rows --
        // but they are re-mined from data already in this directory, so every position they cover
        // would count TWICE. Worse, the miner cannot reconstruct a game's final (usually throwing)
        // move, so the double-weighting spares exactly the positions that show how games end.
        // The miner now writes outside nn/data, but reject them here too so a stale or
        // hand-placed copy can never quietly reweight the corpus again.
        if (j.arm != null && j.bin != null) { policyRows++; continue; }
        let game;
        if (j.g != null) {
          game = j.g; tagged++; prevAbs = Infinity;   // reset: next untagged row starts fresh
        } else {
          const a = Math.abs(j.z);
          if (a < prevAbs) { curInferred = f + '#' + inferredGames++; }
          prevAbs = a;
          game = curInferred;
        }
        rows.push({ x: j.f, y: j.z, game, mv: j.mv, m: j.m });
      } catch (e) {}
    }
  }
  // A data file stores the FEATURE VECTOR, not the position, so a feature-set change cannot be
  // migrated -- those rows are dead. Without this check the net would be built with N_FEATURES
  // inputs and fed shorter arrays, reading undefined off the end and turning every weight to NaN:
  // training would "succeed", the gate would compare two broken nets, and hours would be spent
  // before anyone noticed. Fail loudly instead.
  if (stale.size) {
    const total = [...stale.values()].reduce((a, b) => a + b, 0);
    console.error(`\nERROR: ${total} rows in ${dir} were written with a different feature set ` +
                  `(this build expects ${N_FEATURES} numbers per position):`);
    for (const [f, n] of stale) console.error(`   ${f}: ${n} rows`);
    console.error(`\nThe feature set changed, so that data cannot be reused. Move nn/data and\n` +
                  `nn/models aside (e.g. into nn/archive-old-features/) and start a fresh run.\n`);
    process.exit(1);
  }
  // Skipped, not fatal: these carry no feature vector, so they cannot silently corrupt a fit the
  // way a wrong-length one could. Named loudly anyway -- a file landing here is usually a bug in
  // whatever wrote it, and the whole point is that it stops being invisible.
  if (notTraining.size) {
    const total = [...notTraining.values()].reduce((a, b) => a + b, 0);
    console.log(`skipped ${total} row(s) with no feature vector under ${dir} ` +
                `(not training data -- per-game records, or another tool's output):`);
    for (const [f, n] of notTraining) console.log(`   ${f}: ${n} rows`);
  }
  if (policyRows)
    console.log(`skipped ${policyRows} policy-head target rows found under ${dir} ` +
                `(they re-cover positions already here -- see policy-targets.js)`);
  return { rows, tagged, inferredGames };
}

function main() {
  const dataPat = arg('data', path.join(__dirname, 'data', '*.jsonl'));
  const outPath = arg('out', path.join(__dirname, 'models', 'value.json'));
  const epochs = +arg('epochs', 8);
  const lr = +arg('lr', 0.001);
  const batchSize = +arg('batch', 256);
  // 96,96 rather than 64,64: the feature vector went 16 -> 82, so the first layer has to be wide
  // enough to actually read it. ~17.4k params, which on ~30k positions is ~1.7 samples/param --
  // thinner than the ~5 the old capacity probe ran at, so this wants revisiting (and probably
  // weight decay, which train.js still has none of) once data accumulates.
  const hidden = arg('hidden', '96,96').split(',').map(Number);
  const resume = arg('resume', null);
  const seedArg = arg('seed', null);
  const rand = seedArg != null ? mulberry32(+seedArg) : Math.random;

  const { rows, tagged, inferredGames } = loadData(dataPat);
  if (rows.length < 500) { console.error('not enough data (' + rows.length + ' rows) — run selfplay first'); process.exit(1); }

  // Hold out 10% of GAMES, not 10% of rows. Splitting by row put positions from the same game on
  // both sides: consecutive positions differ by one move and carry almost the same label, so the
  // "held-out" set was really a paraphrase of the training set and val mse mostly measured
  // memorisation. That is how best.json spent 60+ iterations overfitting with its val numbers
  // still looking fine -- at iteration 63 it had better val mse AND better sign-acc than a
  // throwaway 5-layer net that then beat it 7-32 over the board.
  const byGame = new Map();
  for (const r of rows) {
    if (!byGame.has(r.game)) byGame.set(r.game, []);
    byGame.get(r.game).push(r);
  }
  // Guard against the inference above degenerating (e.g. --discount 1 makes every |z| equal, so no
  // fall is ever seen and the whole file reads as one game). Falling back to a row split is the
  // old, leaky behaviour -- but a leaky split beats holding out 10% of ONE group, which could put
  // most of the data in val or leave val empty.
  let ids = [...byGame.keys()];
  // reduce, not Math.max(...arr): the spread would pass one argument per game, which overflows the
  // call stack once a run has accumulated enough of them.
  const biggest = [...byGame.values()].reduce((m, g) => Math.max(m, g.length), 0);
  if (ids.length < 10 || biggest > rows.length*0.2) {
    console.warn(`warning: could not identify games (${ids.length} groups, largest ${biggest} rows) ` +
                 `— falling back to a row-level split, which leaks between train and val`);
    byGame.clear();
    for (const r of rows) byGame.set(r, [r]);   // each row is its own "game"
    ids = [...byGame.keys()];
  }
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand()*(i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const nValGames = Math.max(1, Math.floor(ids.length*0.1));
  const val = [], train = [];
  ids.forEach((id, i) => (i < nValGames ? val : train).push(...byGame.get(id)));
  console.log(`data: ${train.length} train / ${val.length} val positions ` +
              `(${ids.length - nValGames} / ${nValGames} games; ` +
              `${tagged} rows game-tagged, ${inferredGames} games inferred from older rows)`);

  // How much does one GAME get to shout? Every position of a decided game becomes a row, so with
  // flat per-row weighting a 139-ply shuffle-war outvotes a crisp 7-ply throw ~20:1 -- and the long
  // game's positions are near-duplicates of each other carrying the noisiest labels, so the loss
  // ends up dominated by exactly the rows with the least independent information. Rows within a
  // game aren't independent, but they aren't identical either, so the default splits the
  // difference: weight 1/sqrt(gameLen) per row means a game's total say grows as sqrt of its
  // length (the usual effective-sample-size shape for correlated clusters).
  //   --gameWeight sqrt   default, above
  //   --gameWeight game   every game exactly equal say (1/len per row)
  //   --gameWeight row    the old flat behaviour
  // Draw rows (z === 0 exactly -- a discounted decided label can never be 0) additionally get
  // --drawWeight (default 0.25): "this position is drawish" is worth teaching but shouldn't rival
  // decided outcomes, and a 300-ply cap game would otherwise be the heaviest game in the file.
  // Weights are normalised to MEAN 1 over the training set so the effective step size is unchanged
  // and mse numbers stay comparable across modes.
  const gwMode = arg('gameWeight', 'sqrt');
  const drawW = +arg('drawWeight', 0.25);
  // --eloWeight 1: additionally weight each row by the mover's current pool rating (eloweight.js).
  // OFF by default, unlike train-policy.js, and deliberately so: the policy head imitates the
  // mover, so mover skill is label quality; the value head predicts the OUTCOME, and a weak
  // mover's position still has a real outcome -- its label reliability depends on both players'
  // downstream play, not on who chose this move. Plausibly still worth something (weak-mover
  // games explore junk regions), which is why the flag exists for an A/B rather than the idea
  // being dismissed. Flip it on and compare val mse + a ladder sweep before believing either way.
  const eloWeightOn = arg('eloWeight', '0') === '1';
  const eloW = eloWeightOn
    ? require('./eloweight.js').makeEloWeighter(
        arg('eloSummary', path.join(__dirname, 'elo-summary.json')),
        { scale: +arg('eloScale', 250), floor: +arg('eloFloor', 0.25) })
    : null;
  if (eloW) console.log(`elo weighting: ${eloW.note}`);

  // --familyWeight (default sqrt): the SAME cluster problem gameWeight solves, one level up. A
  // "game" id is not always an independent game -- retromine replays one seed position against
  // every brain on its strength axis, and every one of those replays that fails to escape is
  // written under its own game id but is a near-duplicate of its siblings (confirmed live: several
  // sampled families run 71-6 or 32-5 in favour of "still lost" vs "escaped" from the SAME seed).
  // Flat per-game weighting -- which is what the game-length correction above already gives every
  // game, treating each as independent -- lets the common "still lost" outcome outvote the rare
  // "an escape was found here" outcome by exactly that ratio, and the escape is the one exception
  // that actually teaches the net something (the majority just repeats "yes, still dead" as many
  // times as there were opponents on the axis). A game whose id doesn't end in `-<n>` (regular
  // self-play, not a replay family) is its own family of one and this is a no-op for it.
  //   --familyWeight sqrt   default: a family's total say per OUTCOME grows as sqrt of how many
  //                         replays shared that outcome -- same shape as --gameWeight sqrt, just
  //                         grouping replays-of-one-seed instead of positions-of-one-game.
  //   --familyWeight off    restore flat per-game weighting (the old, unaware-of-replay behaviour)
  const fwMode = arg('familyWeight', 'sqrt');
  const familyOf = g => { const m = /^(.*)-(\d+)$/.exec(g); return m ? m[1] : g; };
  // One outcome per GAME (constant across all its rows, unlike y which flips sign with the mover),
  // so every row of a game must resolve to the same absolute winner -- pick it from whichever row
  // of that game is seen first while building `lens` below.
  const gameOutcome = new Map();   // game -> absolute winner index, or 'draw'
  const lens = new Map();
  for (const r of train) {
    lens.set(r.game, (lens.get(r.game) || 0) + 1);
    if (!gameOutcome.has(r.game)) gameOutcome.set(r.game, r.y === 0 ? 'draw' : (r.y > 0 ? r.m : 1 - r.m));
  }
  const outcomeGroupSize = new Map();   // "family|outcome" -> how many games share it
  if (fwMode !== 'off') {
    for (const [game, outcome] of gameOutcome) {
      const key = familyOf(game) + '|' + outcome;
      outcomeGroupSize.set(key, (outcomeGroupSize.get(key) || 0) + 1);
    }
  }
  let wSum = 0;
  for (const r of train) {
    const len = lens.get(r.game);
    r.w = gwMode === 'row' ? 1 : gwMode === 'game' ? 1/len : 1/Math.sqrt(len);
    if (fwMode !== 'off') {
      const key = familyOf(r.game) + '|' + gameOutcome.get(r.game);
      r.w /= Math.sqrt(outcomeGroupSize.get(key));
    }
    if (r.y === 0) r.w *= drawW;
    if (eloW) r.w *= eloW.weight(r.mv);
    wSum += r.w;
  }
  const wNorm = train.length/wSum;
  for (const r of train) r.w *= wNorm;
  console.log(`row weighting: --gameWeight ${gwMode}, --familyWeight ${fwMode}, --drawWeight ${drawW}`);

  // Same trap as the stale-data check above, via the other door: resuming from a checkpoint built
  // for a different input width silently produces a net that can never read its own inputs.
  let net, baseTrainedEpochs = 0;
  if (resume && fs.existsSync(resume)) {
    const j = JSON.parse(fs.readFileSync(resume, 'utf8'));
    if (!j.sizes || j.sizes[0] !== N_FEATURES) {
      console.error(`\nERROR: ${resume} takes ${j.sizes ? j.sizes[0] : '?'} inputs, but the feature ` +
                    `set now produces ${N_FEATURES}.\nMove nn/models aside and start a fresh run.\n`);
      process.exit(1);
    }
    // Old checkpoints predate epoch provenance. Do not manufacture a cumulative total for them;
    // once a fresh stamped lineage wins, every later resume remains exact.
    baseTrainedEpochs = Number.isFinite(+j.trainedEpochs) ? +j.trainedEpochs : null;
    net = MLP.fromJSON(j);
  } else net = new MLP([N_FEATURES, ...hidden, 1]);

  // sign-acc counts DECIDED positions only: a draw row's label is exactly 0, whose sign nothing
  // can match, so including them would just subtract a constant from the metric. Draws still count
  // toward mse -- predicting near-0 on them is exactly what the net is being asked to do.
  const evalSet = set => {
    let mse = 0, signOk = 0, decided = 0;
    for (const r of set) {
      const v = net.value(r.x);
      mse += (v - r.y)*(v - r.y);
      if (r.y !== 0) { decided++; if (Math.sign(v) === Math.sign(r.y)) signOk++; }
    }
    return { mse: mse/set.length, acc: decided ? signOk/decided : 0 };
  };

  // Keep the epoch that scored best on the HELD-OUT rows, not whichever epoch happened to be last.
  // Measured on 12 consecutive real iterations (48-59), epoch 1 beat epoch 6 on val mse in 11 of
  // them while train mse fell every time -- i.e. every one of those iterations trained past its own
  // best model and then saved the overfit one. That compounds: run.js resumes the NEXT iteration
  // from this file, so the drift accumulates for the whole 10 iterations between round robins. It
  // shows up in the tournament results as the checkpoint written immediately after a promotion
  // winning the following round robin (ckpt-031 won at iteration 40, ckpt-041 at iteration 50) --
  // that one carries 6 epochs of drift on top of a proven model where its successors carry 60.
  //
  // Selecting the best of `epochs` noisy val readings is mildly optimistic (the 10% val split is
  // small), but it is a far smaller error than knowingly saving a worse net, and the round robin
  // remains the real arbiter of which model is strongest.
  const keepLast = process.argv.includes('--keepLast');
  // AdamW-style decoupled weight decay (see net.js). train.js's own header has flagged the absence
  // of any regulariser as overdue since the 96,96 default landed; the iteration-63 bake-off then
  // measured what that costs. 1e-4 is deliberately light -- the round robin arbitrates, and
  // --wd 0 restores the old behaviour exactly.
  const wd = +arg('wd', 1e-4);
  // Cosine decay from lr to lr/10 across the epoch budget (--lrDecay flat restores constant lr).
  // A fixed lr that is right for epoch 1 is too coarse near a minimum; with 30-120-epoch scratch
  // runs now routine, the tail epochs were bouncing around the basin instead of settling into it.
  const lrDecay = arg('lrDecay', 'cosine');
  let best = null, bestMse = Infinity, bestEpoch = 0;
  const t0 = Date.now();
  for (let e = 1; e <= epochs; e++) {
    const t = epochs > 1 ? (e - 1)/(epochs - 1) : 0;
    const lrE = lrDecay === 'flat' ? lr : lr*(0.1 + 0.9*0.5*(1 + Math.cos(Math.PI*t)));
    for (let i = train.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random()*(i + 1));
      [train[i], train[j]] = [train[j], train[i]];
    }
    let trainMse = 0, nb = 0;
    for (let i = 0; i + batchSize <= train.length; i += batchSize) {
      trainMse += net.trainBatch(train.slice(i, i + batchSize), lrE, { wd });
      nb++;
    }
    const v = evalSet(val);
    if (v.mse < bestMse) { bestMse = v.mse; bestEpoch = e; best = net.toJSON(); }
    console.log(`epoch ${e}/${epochs}: train mse ${(trainMse/nb).toFixed(4)}, ` +
                `val mse ${v.mse.toFixed(4)}, val sign-acc ${(v.acc*100).toFixed(1)}% ` +
                `(lr ${lrE.toFixed(5)}, ${((Date.now() - t0)/1000).toFixed(0)}s)`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Atomic: write to a temp file beside outPath, then rename over it. outPath is frequently
  // best.json itself (run.js's resume-train cycle), and this console gets closed at the user's
  // will at any moment -- a direct writeFileSync caught mid-flight would leave a truncated model
  // with no automatic recovery, exactly when the epoch's worth of compute behind it is real.
  const atomicSave = (destPath, data) => {
    const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, destPath);
  };
  const stampEpochs = (doc, localEpoch) => {
    if (baseTrainedEpochs != null) doc.trainedEpochs = Math.round(baseTrainedEpochs + localEpoch);
    return doc;
  };
  if (keepLast || !best) {
    atomicSave(outPath, JSON.stringify(stampEpochs(net.toJSON(), epochs)));
    console.log(`saved ${outPath} (last epoch)`);
  } else {
    atomicSave(outPath, JSON.stringify(stampEpochs(best, bestEpoch)));
    console.log(`saved ${outPath} (best val mse ${bestMse.toFixed(4)}, from epoch ${bestEpoch}/${epochs})`);
    // Was the epoch budget BINDING? A net whose best epoch lands in the last stretch of its budget
    // was still improving when it ran out, so its saved weights are not that shape's best -- they
    // are that shape's best WITHIN N epochs. That matters most for the shape fight: control and
    // mutant get the same N, and bigger shapes generally need more epochs to converge, so a binding
    // budget quietly biases the fight toward whichever shape learns fastest rather than whichever
    // is better. Reported rather than silently corrected, because the fix is not simply "raise N":
    // the learning-rate schedule is a cosine over the budget, so changing N changes the LR at every
    // epoch. Tune it on the evidence this line collects, not on a guess.
    if (epochs > 3 && bestEpoch >= Math.ceil(epochs*0.85))
      console.log(`  NOTE: best epoch ${bestEpoch} is in the last 15% of a ${epochs}-epoch budget ` +
                  `-- still improving at the end, so --epochs is likely binding for this shape`);
  }
}

main();
