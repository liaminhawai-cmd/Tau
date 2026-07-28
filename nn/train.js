// Train the value net on selfplay data.
//   node nn/train.js --data "nn/data/*.jsonl" --out nn/models/value.json
//                    [--epochs 8] [--lr 0.001] [--batch 256] [--hidden 64,64] [--resume path]
//                    [--seed N]
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
// the default Math.random() shuffle below, two separate runs land on different held-out rows, and
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
  const stale = new Map();          // file -> rows whose feature vector is the wrong length
  for (const f of fs.readdirSync(dir)) {
    if (!rx.test(f)) continue;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const j = JSON.parse(line);
        if (!j.f || j.f.length !== N_FEATURES) { stale.set(f, (stale.get(f) || 0) + 1); continue; }
        rows.push({ x: j.f, y: j.z });
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
  return rows;
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

  const rows = loadData(dataPat);
  if (rows.length < 500) { console.error('not enough data (' + rows.length + ' rows) — run selfplay first'); process.exit(1); }
  // shuffle once, hold out 10% for validation
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rand()*(i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const nVal = Math.floor(rows.length*0.1);
  const val = rows.slice(0, nVal), train = rows.slice(nVal);
  console.log(`data: ${train.length} train / ${val.length} val positions`);

  // Same trap as the stale-data check above, via the other door: resuming from a checkpoint built
  // for a different input width silently produces a net that can never read its own inputs.
  let net;
  if (resume && fs.existsSync(resume)) {
    const j = JSON.parse(fs.readFileSync(resume, 'utf8'));
    if (!j.sizes || j.sizes[0] !== N_FEATURES) {
      console.error(`\nERROR: ${resume} takes ${j.sizes ? j.sizes[0] : '?'} inputs, but the feature ` +
                    `set now produces ${N_FEATURES}.\nMove nn/models aside and start a fresh run.\n`);
      process.exit(1);
    }
    net = MLP.fromJSON(j);
  } else net = new MLP([N_FEATURES, ...hidden, 1]);

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
