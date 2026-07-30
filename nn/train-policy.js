// Train the policy head (policy.js) on targets minted by policy-targets.js. Same GAME-LEVEL
// train/val split discipline as train.js -- positions from one game are near-duplicates, so a
// row-level split would leak most "held-out" rows' twins into training and validation would stop
// being held out (the exact failure train.js documents from iteration 63).
//
// Row weighting: winners' moves teach, losers' moves mislead half the time (they lost). --loserW
// down-weights rows whose mover went on to lose (z<0); draws sit between. Not zero: losers still
// play mostly reasonable moves, and the arm distribution needs to see them.
//
// Reports: val cross-entropy, arm top-1/top-3 accuracy, bin top-1 and within-1 accuracy, and the
// combined "arm right AND bin within 1" rate -- the number that decides whether policy pruning can
// safely narrow the search (see nnai.js). Baselines to beat: 1/6 = 17% arm, 1/16 = 6% bin.
//
//   node nn/train-policy.js [--targets nn/data/policy-targets.jsonl] [--epochs 20]
//                           [--hidden 96,64] [--out nn/models/policy.json] [--loserW 0.4]
'use strict';
const fs = require('fs');
const path = require('path');
const { PolicyMLP, N_ARMS, N_BINS } = require('./policy.js');
const { N_FEATURES } = require('./features.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function main() {
  const targetsPath = arg('targets', path.join(__dirname, 'data', 'policy-targets.jsonl'));
  const epochs = +arg('epochs', 20);
  const hidden = arg('hidden', '96,64').split(',').map(Number);
  const outPath = arg('out', path.join(__dirname, 'models', 'policy.json'));
  const loserW = +arg('loserW', 0.4);
  const drawW = +arg('drawW', 0.7);
  const batchSize = +arg('batch', 64);
  const lr0 = +arg('lr', 1e-3);
  const valFrac = +arg('valFrac', 0.1);

  const rows = [];
  for (const line of fs.readFileSync(targetsPath, 'utf8').split('\n')) {
    if (!line) continue;
    let j;
    try { j = JSON.parse(line); } catch (e) { continue; }
    if (!j.f || j.f.length !== N_FEATURES) continue;   // stale-feature rows: skip, don't crash
    rows.push({ x: j.f, arm: j.arm, bin: j.bin,
                w: j.z > 0 ? 1 : j.z < 0 ? loserW : drawW, g: j.g });
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

  const net = new PolicyMLP([N_FEATURES, ...hidden, N_ARMS + N_BINS]);

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

  let best = { ce: Infinity }, bestEpoch = 0;
  const t0 = Date.now();
  for (let e = 1; e <= epochs; e++) {
    // cosine decay to lr/10, same shape train.js uses
    const lr = lr0*(0.55 + 0.45*Math.cos(Math.PI*Math.min(1, (e - 1)/Math.max(1, epochs - 1))));
    for (let i = train.length - 1; i > 0; i--) {         // shuffle each epoch
      const k = Math.floor(Math.random()*(i + 1));
      const t = train[i]; train[i] = train[k]; train[k] = t;
    }
    let ceSum = 0, nb = 0;
    for (let i = 0; i < train.length; i += batchSize) {
      ceSum += net.trainBatch(train.slice(i, i + batchSize), lr, { wd: 1e-4 });
      nb++;
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
}

main();
