// Train the value net on selfplay data.
//   node nn/train.js --data "nn/data/*.jsonl" --out nn/models/value.json
//                    [--epochs 8] [--lr 0.001] [--batch 256] [--hidden 64,64] [--resume path]
'use strict';
const fs = require('fs');
const path = require('path');
const { MLP } = require('./net.js');
const { N_FEATURES } = require('./features.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function loadData(pattern) {
  const dir = path.dirname(pattern), base = path.basename(pattern);
  const rx = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const rows = [];
  for (const f of fs.readdirSync(dir)) {
    if (!rx.test(f)) continue;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line) continue;
      try { const j = JSON.parse(line); rows.push({ x: j.f, y: j.z }); } catch (e) {}
    }
  }
  return rows;
}

function main() {
  const dataPat = arg('data', path.join(__dirname, 'data', '*.jsonl'));
  const outPath = arg('out', path.join(__dirname, 'models', 'value.json'));
  const epochs = +arg('epochs', 8);
  const lr = +arg('lr', 0.001);
  const batchSize = +arg('batch', 256);
  const hidden = arg('hidden', '64,64').split(',').map(Number);
  const resume = arg('resume', null);

  const rows = loadData(dataPat);
  if (rows.length < 500) { console.error('not enough data (' + rows.length + ' rows) — run selfplay first'); process.exit(1); }
  // shuffle once, hold out 10% for validation
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const nVal = Math.floor(rows.length*0.1);
  const val = rows.slice(0, nVal), train = rows.slice(nVal);
  console.log(`data: ${train.length} train / ${val.length} val positions`);

  const net = resume && fs.existsSync(resume)
    ? MLP.fromJSON(JSON.parse(fs.readFileSync(resume, 'utf8')))
    : new MLP([N_FEATURES, ...hidden, 1]);

  const evalSet = set => {
    let mse = 0, signOk = 0;
    for (const r of set) {
      const v = net.value(r.x);
      mse += (v - r.y)*(v - r.y);
      if (Math.sign(v) === Math.sign(r.y)) signOk++;
    }
    return { mse: mse/set.length, acc: signOk/set.length };
  };

  const t0 = Date.now();
  for (let e = 1; e <= epochs; e++) {
    for (let i = train.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random()*(i + 1));
      [train[i], train[j]] = [train[j], train[i]];
    }
    let trainMse = 0, nb = 0;
    for (let i = 0; i + batchSize <= train.length; i += batchSize) {
      trainMse += net.trainBatch(train.slice(i, i + batchSize), lr);
      nb++;
    }
    const v = evalSet(val);
    console.log(`epoch ${e}/${epochs}: train mse ${(trainMse/nb).toFixed(4)}, ` +
                `val mse ${v.mse.toFixed(4)}, val sign-acc ${(v.acc*100).toFixed(1)}% ` +
                `(${((Date.now() - t0)/1000).toFixed(0)}s)`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(net.toJSON()));
  console.log('saved', outPath);
}

main();
