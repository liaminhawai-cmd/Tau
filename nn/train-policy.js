// Train the policy head (policy.js) on targets minted by policy-targets.js. Same GAME-LEVEL
// train/val split discipline as train.js -- positions from one game are near-duplicates, so a
// row-level split would leak most "held-out" rows' twins into training and validation would stop
// being held out (the exact failure train.js documents from iteration 63).
//
// Row weighting: winners' moves teach, losers' moves mislead half the time (they lost). --loserW
// down-weights rows whose mover went on to lose (z<0); draws sit between. Not zero: losers still
// play mostly reasonable moves, and the arm distribution needs to see them. Multiplied together with
// the mover's Elo weight (eloweight.js) and the row's source weight (policy-targets.js's `sw`, see
// its header) -- three independent partial-credit signals, none of them a hard exclude.
//
// Reports: val cross-entropy, arm top-1/top-3 accuracy, bin top-1 and within-1 accuracy, and the
// combined "arm right AND bin within 1" rate -- the number that decides whether policy pruning can
// safely narrow the search (see nnai.js). Baselines to beat: 1/6 = 17% arm, 1/16 = 6% bin.
//
//   node nn/train-policy.js [--targets nn/data/policy-targets.jsonl] [--epochs 20]
//                           [--hidden 96,64] [--out nn/models/policy.json] [--loserW 0.4]
//                           [--noEloWeight] [--noSourceWeight] [--workers N]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { PolicyMLP, N_ARMS, N_BINS } = require('./policy.js');
const { N_FEATURES } = require('./features.js');
const { makeEloWeighter } = require('./eloweight.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function main() {
  const targetsPath = arg('targets', path.join(__dirname, 'policy-targets.jsonl'));
  const epochs = +arg('epochs', 20);
  const hidden = arg('hidden', '96,64').split(',').map(Number);
  const outPath = arg('out', path.join(__dirname, 'models', 'policy.json'));
  const loserW = +arg('loserW', 0.4);
  const drawW = +arg('drawW', 0.7);
  const batchSize = +arg('batch', 64);
  const lr0 = +arg('lr', 1e-3);
  const valFrac = +arg('valFrac', 0.1);
  // The policy head is imitation: "copy this move". Who is being imitated matters as much as
  // whether they went on to win -- a strong mover's choices teach, a weak mover's mislead even in
  // games they won. The z-weight below cannot see this (L2 beating L1 counts as a winner), so rows
  // are ALSO weighted by the mover's current pool rating, looked up fresh each run from
  // elo-summary.json. Multiplicative with the z-weight: "winning move by a strong player" is the
  // gold standard, either alone is partial credit. --noEloWeight restores flat imitation.
  const eloW = process.argv.includes('--noEloWeight')
    ? { enabled: false, note: 'disabled by --noEloWeight', weight: () => 1 }
    : makeEloWeighter(arg('eloSummary', path.join(__dirname, 'elo-summary.json')),
                      { scale: +arg('eloScale', 250), floor: +arg('eloFloor', 0.25) });
  console.log(`elo weighting: ${eloW.note}`);
  // policy-targets.js also stamps a per-row `sw` (source weight: how much to trust the MOVE itself,
  // e.g. a ladder brain's play vs a real depth-2+ search pick) on rows where it isn't 1 -- same
  // multiplicative-partial-credit pattern as eloW above, just keyed to the move's source rather than
  // the mover's rating. --noSourceWeight restores flat trust in every row's source.
  const noSourceWeight = process.argv.includes('--noSourceWeight');
  const srcW = j => noSourceWeight ? 1 : (j.sw != null ? j.sw : 1);

  const rows = [];
  for (const line of fs.readFileSync(targetsPath, 'utf8').split('\n')) {
    if (!line) continue;
    let j;
    try { j = JSON.parse(line); } catch (e) { continue; }
    if (!j.f || j.f.length !== N_FEATURES) continue;   // stale-feature rows: skip, don't crash
    rows.push({ x: j.f, arm: j.arm, bin: j.bin,
                w: (j.z > 0 ? 1 : j.z < 0 ? loserW : drawW)*eloW.weight(j.mv)*srcW(j), g: j.g });
  }
  if (!rows.length) { console.error(`no usable rows in ${targetsPath}`); process.exit(1); }

  // game-level split, deterministic by game id hash so reruns keep the same split
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h*31 + s.charCodeAt(i)) | 0; return (h >>> 0)/4294967296; };
  const train = [], val = [];
  for (const r of rows) (hash(String(r.g)) < valFrac ? val : train).push(r);
  // normalise weights to mean 1 over the train set, same convention as net.js expects
  const wMean = train.reduce((a, r) => a + r.w, 0)/train.length;
  for (const r of train) r.w /= wMean;
  console.log(`policy data: ${train.length} train / ${val.length} val moves ` +
              `(game-level split, loserW ${loserW}, drawW ${drawW})`);

  // --workers: gradient lanes for the training pass (1 = the original single-threaded path).
  // Worth having because this is the one phase of a policy-loop cycle that used a single core --
  // measured ~20 minutes of every ~60-minute cycle, with the other 15 threads idle. The model is
  // small (~19k params) but the data is not (~350MB of features), so lanes share ONE copy of
  // everything via SharedArrayBuffer and a per-batch barrier; nothing is copied per step.
  // Capped at 8 by default: past that the fixed per-batch barrier starts to outweigh the shrinking
  // per-lane slice, and this often runs beside the value trainer or the loop's own tournament.
  const nLanes = Math.max(1, Math.min(+arg('workers', Math.min(Math.max(1, os.cpus().length - 1), 8)),
                                      64));
  console.log(`gradient lanes: ${nLanes}${nLanes === 1 ? ' (serial)' : ''}`);

  const sizes = [N_FEATURES, ...hidden, N_ARMS + N_BINS];
  const net = new PolicyMLP(sizes);

  // --- parallel gradient lanes ---------------------------------------------------------------
  // Set up only when asked for. Everything the lanes read lives in SharedArrayBuffers; the net's
  // own parameters are re-pointed into one of them so a lane's forward pass reads exactly the
  // weights the main thread last wrote, with no copy and no staleness.
  let lanesCtx = null;
  if (nLanes > 1) {
    const nParams = PolicyMLP.paramCount(sizes);
    const sab = n => new SharedArrayBuffer(n);
    const sabs = {
      ctrl: sab(4*4), idx: sab(batchSize*4), params: sab(nParams*8),
      grads: sab(nLanes*nParams*8), ce: sab(nLanes*8),
      x: sab(train.length*N_FEATURES*8), arm: sab(train.length*4),
      bin: sab(train.length*4), wt: sab(train.length*8),
    };
    const X = new Float64Array(sabs.x), ARM = new Int32Array(sabs.arm);
    const BIN = new Int32Array(sabs.bin), WT = new Float64Array(sabs.wt);
    for (let i = 0; i < train.length; i++) {
      X.set(train[i].x, i*N_FEATURES);
      ARM[i] = train[i].arm; BIN[i] = train[i].bin; WT[i] = train[i].w;
    }
    // Hand the net's parameters over to shared memory BEFORE spawning, so every lane maps the
    // same bytes. Copy the freshly-initialised random weights across first -- useSharedParams
    // repoints the views, it does not carry the old values over.
    const flat = new Float64Array(sabs.params);
    {
      let off = 0;
      for (const w of net.W) { flat.set(w, off); off += w.length; }
      for (const b of net.b) { flat.set(b, off); off += b.length; }
    }
    net.useSharedParams(sabs.params, 0);
    const workers = [];
    for (let lane = 0; lane < nLanes; lane++) {
      workers.push(new Worker(path.join(__dirname, 'policy-train-worker.js'),
                              { workerData: { sizes, lane, lanes: nLanes, sabs } }));
    }
    const CTRL = new Int32Array(sabs.ctrl), IDX = new Int32Array(sabs.idx);
    const CE = new Float64Array(sabs.ce), GRADS = new Float64Array(sabs.grads);
    // Gradient buffers the main thread hands to applyAdam, filled by summing the lane slots.
    const gW = net.W.map(w => new Float64Array(w.length));
    const gB = net.b.map(b => new Float64Array(b.length));
    lanesCtx = {
      workers,
      // Run one batch across every lane and take the optimiser step. Returns the batch's weighted
      // CE sum, matching what the serial accumGrads path returns.
      step(indices, from, to, lr, opts) {
        const len = to - from;
        for (let i = 0; i < len; i++) IDX[i] = indices[from + i];
        Atomics.store(CTRL, 1, len);
        Atomics.store(CTRL, 2, nLanes);
        Atomics.add(CTRL, 0, 1);
        Atomics.notify(CTRL, 0);
        while (Atomics.load(CTRL, 2) > 0) Atomics.wait(CTRL, 2, Atomics.load(CTRL, 2), 50);
        // Sum the lane slots into one gradient, then a single Adam step on the main thread.
        let off = 0, ce = 0;
        for (let l = 0; l < gW.length; l++) {
          const g = gW[l];
          g.fill(0);
          for (let k = 0; k < nLanes; k++) {
            const base = k*nParams + off;
            for (let i = 0; i < g.length; i++) g[i] += GRADS[base + i];
          }
          off += g.length;
        }
        for (let l = 0; l < gB.length; l++) {
          const g = gB[l];
          g.fill(0);
          for (let k = 0; k < nLanes; k++) {
            const base = k*nParams + off;
            for (let i = 0; i < g.length; i++) g[i] += GRADS[base + i];
          }
          off += g.length;
        }
        for (let k = 0; k < nLanes; k++) ce += CE[k];
        net.applyAdam(gW, gB, len, lr, opts);
        return ce;
      },
      shutdown() {
        Atomics.store(CTRL, 3, 1);
        Atomics.add(CTRL, 0, 1);
        Atomics.notify(CTRL, 0);
        for (const w of workers) w.terminate();
      },
    };
  }

  const evalVal = () => {
    let ce = 0, a1 = 0, a3 = 0, b1 = 0, bNear = 0, both = 0;
    for (const r of val) {
      const { arms, bins } = net.predict(r.x);
      ce += -Math.log(Math.max(arms[r.arm], 1e-12)) - Math.log(Math.max(bins[r.bin], 1e-12));
      const aOrder = [...arms.keys()].sort((p, q) => arms[q] - arms[p]);
      const bTop = bins.indexOf(Math.max(...bins));
      const armTop1 = aOrder[0] === r.arm;
      if (armTop1) a1++;
      if (aOrder.slice(0, 3).includes(r.arm)) a3++;
      if (bTop === r.bin) b1++;
      const near = Math.abs(bTop - r.bin) <= 1;
      if (near) bNear++;
      if (armTop1 && near) both++;
    }
    const n = val.length || 1;
    return { ce: ce/n, a1: a1/n, a3: a3/n, b1: b1/n, bNear: bNear/n, both: both/n };
  };

  // Shuffled per epoch instead of the rows themselves: the parallel path's feature matrix lives in
  // shared memory the lanes are reading, so a batch is published as a list of row indices and the
  // data never moves. The serial path indexes through the same order, so both see identical batches.
  const order = new Int32Array(train.length);
  for (let i = 0; i < order.length; i++) order[i] = i;

  let best = { ce: Infinity }, bestEpoch = 0;
  const t0 = Date.now();
  for (let e = 1; e <= epochs; e++) {
    // cosine decay to lr/10, same shape train.js uses
    const lr = lr0*(0.55 + 0.45*Math.cos(Math.PI*Math.min(1, (e - 1)/Math.max(1, epochs - 1))));
    for (let i = order.length - 1; i > 0; i--) {         // shuffle each epoch, by index
      const k = Math.floor(Math.random()*(i + 1));
      const t = order[i]; order[i] = order[k]; order[k] = t;
    }
    let ceSum = 0, nb = 0;
    if (lanesCtx) {
      // Shuffling moves the INDEX array, not the rows: the feature matrix in shared memory stays
      // put (it is ~350MB and the lanes are reading it), so a batch is published as a list of row
      // indices rather than by moving any data.
      for (let i = 0; i < train.length; i += batchSize) {
        const to = Math.min(i + batchSize, train.length);
        ceSum += lanesCtx.step(order, i, to, lr, { wd: 1e-4 })/(to - i);
        nb++;
      }
    } else {
      for (let i = 0; i < train.length; i += batchSize) {
        const to = Math.min(i + batchSize, train.length);
        const batch = [];
        for (let k = i; k < to; k++) batch.push(train[order[k]]);
        ceSum += net.trainBatch(batch, lr, { wd: 1e-4 });
        nb++;
      }
    }
    const v = evalVal();
    console.log(`epoch ${e}/${epochs}: train ce ${(ceSum/nb).toFixed(4)}, val ce ${v.ce.toFixed(4)}, ` +
                `arm top1 ${(100*v.a1).toFixed(1)}% top3 ${(100*v.a3).toFixed(1)}%, ` +
                `bin top1 ${(100*v.b1).toFixed(1)}% ±1 ${(100*v.bNear).toFixed(1)}%, ` +
                `move(arm+bin±1) ${(100*v.both).toFixed(1)}% ` +
                `(lr ${lr.toFixed(5)}, ${((Date.now() - t0)/1000).toFixed(0)}s)`);
    if (v.ce < best.ce) { best = v; bestEpoch = e; fs.writeFileSync(outPath, JSON.stringify(net.toJSON())); }
  }
  console.log(`saved ${outPath} (best val ce ${best.ce.toFixed(4)} from epoch ${bestEpoch}; ` +
              `arm top3 ${(100*best.a3).toFixed(1)}%, move ${(100*best.both).toFixed(1)}%)`);
  if (lanesCtx) lanesCtx.shutdown();
}

main();
