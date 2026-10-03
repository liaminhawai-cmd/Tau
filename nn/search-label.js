'use strict';

// Search-score labels: what a net's own search says each position is worth, written next to who
// eventually won.
//
// Every training row is labelled with the game's result alone, and an early position whose side
// later blundered is labelled a loss however good it was. A search already knows better: the same
// weights play ~150 Elo stronger at D2 than at D1, and that gap is information the net does not
// hold. This replays stored positions through the teacher's search and records its score (sv) so
// torch-train-core.py --svBlend can train toward a blend of search and result -- the net learns to
// see at D1 what its search sees at D2.
//
// Positions are rebuilt from each row's stored pose, and a row is only labelled when the rebuilt
// position reproduces its stored feature vector, so a label always describes the row it sits on.
// Rows that cannot be rebuilt are kept unlabelled (the trainer then uses the result) so that a
// labelled and an unlabelled training run see exactly the same positions.
//
// The run is fixed at its start: the newest --positions rows are copied to <out>/selection.jsonl
// and the teacher to <out>/teacher.json. A killed run resumes where it stopped, against that same
// teacher and those same positions, however far best.json or the corpus has moved meanwhile.
//
//   node nn/search-label.js [--positions 40000] [--depth 2] [--workers N] [--out nn/svx]
//                           [--model nn/models/best.json] [--data nn/data]
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

const N_FEATURES = require('./features.js').N_FEATURES || 94;

// The league's own fixed-depth settings (arena.js defaults), so a label is what a league face of
// the teacher at this depth actually computes.
const KEEP_FOR_DEPTH = 4;

function eligible(j) {
  return j && Array.isArray(j.f) && j.f.length === N_FEATURES && Number.isFinite(j.z) &&
         typeof j.g === 'string' && Array.isArray(j.p) && j.p.length === 6 &&
         (j.m === 0 || j.m === 1) && j.arm == null && j.bin == null;
}

// Newest whole games first, until `want` rows. Files touched in the last two minutes are left alone
// (the league appends to them as it plays), the same rule the deep suite uses.
function selectRows(dataDir, want) {
  const now = Date.now();
  const files = fs.readdirSync(dataDir)
    .filter(n => n.endsWith('.jsonl'))
    .map(n => { const p = path.join(dataDir, n); return { p, n, mtime: fs.statSync(p).mtimeMs }; })
    .filter(f => now - f.mtime > 2*60*1000)
    .sort((a, b) => b.mtime - a.mtime);
  const picked = [], used = [];
  for (const file of files) {
    if (picked.length >= want) break;
    const games = new Map();
    for (const line of fs.readFileSync(file.p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch (e) { continue; }
      if (!eligible(j)) continue;
      if (!games.has(j.g)) games.set(j.g, []);
      games.get(j.g).push(line.trim());
    }
    const order = [...games.keys()].reverse();      // a file's newest games are appended last
    let took = 0;
    for (const g of order) {
      if (picked.length >= want) break;
      picked.push(...games.get(g));
      took += games.get(g).length;
    }
    if (took) used.push({ file: file.n, rows: took });
  }
  return { rows: picked, used };
}

const sha1 = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

async function main() {
  const out = path.resolve(arg('out', path.join(__dirname, 'svx')));
  const model = path.resolve(arg('model', path.join(__dirname, 'models', 'best.json')));
  const dataDir = path.resolve(arg('data', path.join(__dirname, 'data')));
  const want = +arg('positions', 40000);
  const depth = +arg('depth', 2);
  const workers = Math.max(1, +arg('workers', Math.max(1, Math.floor(os.cpus().length / 2))));
  const selFile = path.join(out, 'selection.jsonl');
  const labFile = path.join(out, 'labels.jsonl');
  const metaFile = path.join(out, 'meta.json');
  const teacher = path.join(out, 'teacher.json');
  fs.mkdirSync(out, { recursive: true });

  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) {}
  if (meta && fs.existsSync(selFile) && fs.existsSync(teacher)) {
    if (meta.depth !== depth)
      throw new Error(`${out} was started at depth ${meta.depth}; finish it at that depth or use a new --out`);
    console.log(`resuming ${out}: ${meta.positions} positions, teacher ${meta.teacherFrom} (sha1 ${meta.teacherSha1.slice(0, 10)})`);
  } else {
    console.log(`selecting the newest ${want} positions from ${dataDir} ...`);
    const { rows, used } = selectRows(dataDir, want);
    if (!rows.length) throw new Error(`no eligible rows (features ${N_FEATURES}, pose, game id) in ${dataDir}`);
    fs.copyFileSync(model, teacher);
    fs.writeFileSync(selFile, rows.join('\n') + '\n');
    try { fs.unlinkSync(labFile); } catch (e) {}
    meta = { teacherFrom: model, teacherSha1: sha1(teacher), depth, positions: rows.length,
             keepForDepth: KEEP_FOR_DEPTH, files: used, created: new Date().toISOString() };
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
    console.log(`selected ${rows.length} positions from ${used.length} file(s); teacher copied from ${model}`);
  }

  const lines = fs.readFileSync(selFile, 'utf8').split('\n').filter(l => l.trim());
  const done = new Set();
  if (fs.existsSync(labFile)) {
    for (const l of fs.readFileSync(labFile, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { done.add(JSON.parse(l).svi); } catch (e) {}   // a torn last line is simply redone
    }
  }
  const queue = [];
  for (let i = 0; i < lines.length; i++) if (!done.has(i)) queue.push(i);
  if (!queue.length) { console.log(`all ${lines.length} positions already labelled -> ${labFile}`); return summarise(labFile); }
  console.log(`labelling ${queue.length} of ${lines.length} positions at D${depth} with ${workers} worker(s) ...`);

  const total = queue.length, t0 = Date.now();
  let finished = 0, unlabelled = 0, lastLog = 0;
  const CHUNK = 8;
  await new Promise((resolve, reject) => {
    let live = 0;
    const take = () => {
      const jobs = [];
      while (jobs.length < CHUNK && queue.length) { const i = queue.shift(); jobs.push([i, lines[i]]); }
      return jobs;
    };
    for (let w = 0; w < Math.min(workers, Math.ceil(total / CHUNK)); w++) {
      const child = fork(__filename, ['--worker', teacher, String(depth)], { stdio: 'inherit' });
      live++;
      let inflight = [];
      const feed = () => {
        inflight = take();
        if (inflight.length) child.send({ jobs: inflight });
        else child.send({ stop: true });
      };
      child.on('message', msg => {
        fs.appendFileSync(labFile, msg.results.map(r => r[1]).join('\n') + '\n');
        finished += msg.results.length;
        unlabelled += msg.unlabelled;
        const now = Date.now();
        if (now - lastLog > 30000 || finished === total) {
          lastLog = now;
          const rate = finished / ((now - t0) / 60000);
          const eta = (total - finished) / Math.max(rate, 1e-9);
          console.log(`  ${finished}/${total} labelled (${rate.toFixed(1)}/min, ` +
                      `about ${eta >= 90 ? (eta/60).toFixed(1) + ' h' : Math.round(eta) + ' min'} left` +
                      (unlabelled ? `, ${unlabelled} kept unlabelled` : '') + ')');
        }
        feed();
      });
      child.on('exit', code => {
        // A worker that dies hands its unfinished positions back; the others pick them up, and
        // anything still missing is redone on the next run.
        if (code !== 0 && inflight.length) { queue.push(...inflight.map(j => j[0])); console.log(`  worker exited ${code}; requeued ${inflight.length}`); }
        if (--live === 0) resolve();
      });
      child.on('error', reject);
      feed();
    }
  });
  console.log(`done in ${((Date.now() - t0)/60000).toFixed(1)} min -> ${labFile}`);
  summarise(labFile);
}

// How different the search's opinion is from the result it is blended with -- if the two agreed,
// the experiment would have nothing to test.
function summarise(labFile) {
  let n = 0, nsv = 0, dSv = 0, dTv = 0, flips = 0;
  for (const l of fs.readFileSync(labFile, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    let j; try { j = JSON.parse(l); } catch (e) { continue; }
    n++;
    if (j.sv == null) continue;
    nsv++;
    dSv += (j.sv - j.z) ** 2;
    dTv += (j.tv - j.z) ** 2;
    if (j.z !== 0 && Math.sign(j.sv) !== Math.sign(j.z)) flips++;
  }
  if (!nsv) { console.log('no labelled rows'); return; }
  console.log(`${nsv}/${n} rows carry a search score. Against the result: static-eval mse ${(dTv/nsv).toFixed(4)}, ` +
              `search mse ${(dSv/nsv).toFixed(4)}; the search disagrees with the result's sign on ${(100*flips/nsv).toFixed(1)}% of rows`);
}

function worker() {
  const i = process.argv.indexOf('--worker');
  const modelPath = process.argv[i + 1], depth = +process.argv[i + 2];
  const { createEngine } = require('./engine.js');
  const { features } = require('./features.js');
  const { MLP } = require('./net.js');
  const { nnPlanFor } = require('./nnai.js');
  const net = MLP.fromJSON(JSON.parse(fs.readFileSync(modelPath, 'utf8')));
  const eng = createEngine();
  const label = (idx, line) => {
    const j = JSON.parse(line);
    eng.newGame();
    const g = eng.getG();
    g.pieces.forEach((pc, k) => { pc.x = j.p[3*k]; pc.y = j.p[3*k + 1]; pc.rot = j.p[3*k + 2]; });
    g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
    g.pinned = null; g.pivot = null; g.over = false; g.winner = null;
    eng.setActive(j.m);
    // The stored pose is rounded to 4 decimals, which moves a rebuilt feature by up to ~0.0012
    // (99.9th percentile over 5,803 rows); the rare real mismatch is off by tenths. Past 0.01 the
    // pose does not rebuild this row's position, and a score for some other position is a wrong label.
    const f = features(eng);
    let off = 0;
    for (let k = 0; k < f.length; k++) off = Math.max(off, Math.abs(f[k] - j.f[k]));
    if (off > 0.01) return { j: { ...j, svi: idx }, ok: false };
    const plan = nnPlanFor(eng, net, j.m, { depth, keepForDepth: KEEP_FOR_DEPTH });
    if (!plan) return { j: { ...j, svi: idx }, ok: false };
    // `deep` is the recursive D2+ score of the chosen move, `s` the D1 one; both are the mover's
    // view on the value net's scale, except a proven throw (+-1e6), which is a sure win or loss.
    let s = Number.isFinite(plan.deep) ? plan.deep : plan.s;
    if (!Number.isFinite(s)) s = plan.v;
    const sv = Math.max(-1, Math.min(1, s));
    const tv = net.value(j.f);
    return { j: { ...j, sv: +sv.toFixed(4), svd: depth, tv: +tv.toFixed(4), svi: idx }, ok: true };
  };
  process.on('message', msg => {
    if (msg.stop) process.exit(0);
    let unlabelled = 0;
    const results = msg.jobs.map(([idx, line]) => {
      const r = label(idx, line);
      if (!r.ok) unlabelled++;
      return [idx, JSON.stringify(r.j)];
    });
    process.send({ results, unlabelled });
  });
}

if (process.argv.includes('--worker')) worker();
else main().catch(e => { console.error('[search-label] FAILED: ' + e.message); process.exitCode = 1; });
