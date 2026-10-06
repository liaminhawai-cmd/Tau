'use strict';

// Search-leaf labels: training rows for the positions a search actually decides on.
//
// Every training row today is a position some real game reached. A search spends nearly all of its
// evaluations somewhere else: it tries its best few moves, lets the opponent reply, and scores the
// hypothetical positions at the end of those lines -- positions no game ever reached, so the net has
// never been taught anything about them. The search then picks the move whose end position the net
// likes most, which is exactly where a net that overrates some unfamiliar position gets caught out,
// and the deeper the search, the more unfamiliar positions it looks at.
//
// So this replays stored game positions through the teacher's own search (--rootDepth, scored at the
// end of each line -- nnai.js `backup`), records the position each searched candidate was finally
// scored at, and asks the teacher's --depth search what that position is really worth. Each leaf
// becomes a row whose label is that score (z = sv: no game reached it, so there is no result). The
// root rows get the same --depth search score as search-label.js gives them, so a net trained on the
// root rows alone and one trained on root rows + leaves differ only in the leaves.
//
// The run is fixed at its start (selection + teacher copied into --out) and resumes where it stopped.
//
//   node nn/leaf-label.js [--positions 10000] [--rootDepth 3] [--depth 2] [--workers N] [--out nn/lfx]
//                         [--model nn/models/best.json] [--data nn/data]
//
// Writes, in --out: rows-games/games.jsonl (root rows + sv) and rows-leaves/leaves.jsonl (leaf rows),
// so a trainer glob of rows-games/*.jsonl is the game arm and rows-*/*.jsonl the leaf arm.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');
const { selectRows, KEEP_FOR_DEPTH } = require('./search-label.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const sha1 = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

async function main() {
  const out = path.resolve(arg('out', path.join(__dirname, 'lfx')));
  const model = path.resolve(arg('model', path.join(__dirname, 'models', 'best.json')));
  const dataDir = path.resolve(arg('data', path.join(__dirname, 'data')));
  const want = +arg('positions', 10000);
  const rootDepth = +arg('rootDepth', 3), depth = +arg('depth', 2);
  const workers = Math.max(1, +arg('workers', Math.max(1, Math.floor(os.cpus().length / 2))));
  const selFile = path.join(out, 'selection.jsonl'), metaFile = path.join(out, 'meta.json');
  const teacher = path.join(out, 'teacher.json');
  const gamesFile = path.join(out, 'rows-games', 'games.jsonl'), leavesFile = path.join(out, 'rows-leaves', 'leaves.jsonl');
  fs.mkdirSync(path.dirname(gamesFile), { recursive: true });
  fs.mkdirSync(path.dirname(leavesFile), { recursive: true });

  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) {}
  if (meta && fs.existsSync(selFile) && fs.existsSync(teacher)) {
    if (meta.depth !== depth || meta.rootDepth !== rootDepth)
      throw new Error(`${out} was started at root D${meta.rootDepth}, label D${meta.depth}; finish it that way or use a new --out`);
    console.log(`resuming ${out}: ${meta.positions} positions, teacher ${meta.teacherFrom} (sha1 ${meta.teacherSha1.slice(0, 10)})`);
  } else {
    console.log(`selecting the newest ${want} positions from ${dataDir} ...`);
    const { rows, used } = selectRows(dataDir, want);
    if (!rows.length) throw new Error(`no eligible rows in ${dataDir}`);
    fs.copyFileSync(model, teacher);
    fs.writeFileSync(selFile, rows.join('\n') + '\n');
    for (const f of [gamesFile, leavesFile]) try { fs.unlinkSync(f); } catch (e) {}
    meta = { teacherFrom: model, teacherSha1: sha1(teacher), rootDepth, depth, positions: rows.length,
             keepForDepth: KEEP_FOR_DEPTH, files: used, created: new Date().toISOString() };
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
    console.log(`selected ${rows.length} positions from ${used.length} file(s); teacher copied from ${model}`);
  }

  // A root is done once its game row is written; leaves are written first, so leaves of a root
  // whose game row never landed are dropped here and redone.
  const lines = fs.readFileSync(selFile, 'utf8').split('\n').filter(l => l.trim());
  const done = new Set();
  const readSvi = f => { const out = []; if (!fs.existsSync(f)) return out;
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l.trim()) continue; try { out.push([JSON.parse(l).svi, l]); } catch (e) {} }
    return out; };
  for (const [i] of readSvi(gamesFile)) done.add(i);
  const kept = readSvi(leavesFile).filter(([i]) => done.has(i)).map(([, l]) => l);
  fs.writeFileSync(leavesFile, kept.length ? kept.join('\n') + '\n' : '');
  const queue = [];
  for (let i = 0; i < lines.length; i++) if (!done.has(i)) queue.push(i);
  if (!queue.length) { console.log(`all ${lines.length} positions done`); return summarise(gamesFile, leavesFile); }
  console.log(`searching ${queue.length} of ${lines.length} positions at D${rootDepth} and labelling their leaves at D${depth} ` +
              `with ${workers} worker(s) ...`);

  const total = queue.length, t0 = Date.now();
  let finished = 0, leafRows = kept.length, lastLog = 0;
  const CHUNK = 4;
  await new Promise((resolve, reject) => {
    let live = 0;
    const take = () => { const jobs = []; while (jobs.length < CHUNK && queue.length) { const i = queue.shift(); jobs.push([i, lines[i]]); } return jobs; };
    for (let w = 0; w < Math.min(workers, Math.ceil(total / CHUNK)); w++) {
      const child = fork(__filename, ['--worker', teacher, String(rootDepth), String(depth)], { stdio: 'inherit' });
      live++;
      let inflight = [];
      const feed = () => { inflight = take(); child.send(inflight.length ? { jobs: inflight } : { stop: true }); };
      child.on('message', msg => {
        if (msg.leaves.length) fs.appendFileSync(leavesFile, msg.leaves.join('\n') + '\n');
        fs.appendFileSync(gamesFile, msg.games.join('\n') + '\n');
        finished += msg.games.length; leafRows += msg.leaves.length;
        const now = Date.now();
        if (now - lastLog > 30000 || finished === total) {
          lastLog = now;
          const rate = finished / ((now - t0) / 60000), eta = (total - finished) / Math.max(rate, 1e-9);
          console.log(`  ${finished}/${total} positions, ${leafRows} leaf rows (${rate.toFixed(1)}/min, about ` +
                      `${eta >= 90 ? (eta/60).toFixed(1) + ' h' : Math.round(eta) + ' min'} left)`);
        }
        feed();
      });
      child.on('exit', code => {
        if (code !== 0 && inflight.length) { queue.push(...inflight.map(j => j[0])); console.log(`  worker exited ${code}; requeued ${inflight.length}`); }
        if (--live === 0) resolve();
      });
      child.on('error', reject);
      feed();
    }
  });
  console.log(`done in ${((Date.now() - t0)/60000).toFixed(1)} min`);
  summarise(gamesFile, leavesFile);
}

// How far the net's own one-look value at a leaf is from what the deeper search says it is worth --
// the error a search walks into, and the thing the leaf rows teach.
function summarise(gamesFile, leavesFile) {
  let n = 0, se = 0, flips = 0, roots = 0;
  for (const l of fs.readFileSync(leavesFile, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    let j; try { j = JSON.parse(l); } catch (e) { continue; }
    n++; se += (j.tv - j.sv) ** 2; if (Math.sign(j.tv) !== Math.sign(j.sv) && Math.abs(j.sv) > 0.1) flips++;
  }
  for (const l of fs.readFileSync(gamesFile, 'utf8').split('\n')) if (l.trim()) roots++;
  if (!n) { console.log(`${roots} root rows, no leaf rows`); return; }
  console.log(`${roots} root rows, ${n} leaf rows (${(n/Math.max(1, roots)).toFixed(1)} per root). At the leaves the net's ` +
              `own value is off the D-search score by mse ${(se/n).toFixed(4)}, and has the sign wrong on ${(100*flips/n).toFixed(1)}%`);
}

function worker() {
  const i = process.argv.indexOf('--worker');
  const modelPath = process.argv[i + 1], rootDepth = +process.argv[i + 2], depth = +process.argv[i + 3];
  const { createEngine } = require('./engine.js');
  const { features } = require('./features.js');
  const { MLP } = require('./net.js');
  const { nnPlanFor } = require('./nnai.js');
  const net = MLP.fromJSON(JSON.parse(fs.readFileSync(modelPath, 'utf8')));
  const eng = createEngine();
  const setPose = (p, m) => {
    eng.newGame();
    const g = eng.getG();
    g.pieces.forEach((pc, k) => { pc.x = p[3*k]; pc.y = p[3*k + 1]; pc.rot = p[3*k + 2]; });
    g.turnDir = 0; g.crossings = 0; g.atLimit = false; g.netRad = 0; g.contact = null;
    g.pinned = null; g.pivot = null; g.over = false; g.winner = null;
    eng.setActive(m);
  };
  // Same tolerance as search-label.js: a rounded pose moves a feature by ~0.001; past 0.01 the pose
  // does not rebuild the position and a score would describe some other one.
  const rebuilds = f => { const g = features(eng); let off = 0; for (let k = 0; k < g.length; k++) off = Math.max(off, Math.abs(g[k] - f[k])); return off <= 0.01; };
  const score = plan => {
    let s = Number.isFinite(plan.deep) ? plan.deep : plan.s;
    if (!Number.isFinite(s)) s = plan.v;
    return Number.isFinite(s) ? Math.max(-1, Math.min(1, s)) : null;
  };
  const search = (m, d, leaves) => nnPlanFor(eng, net, m, { depth: d, keepForDepth: KEEP_FOR_DEPTH, backup: true,
                                                             ...(leaves ? { captureLeaves: leaves } : {}) });
  const r4 = v => +v.toFixed(4);
  const label = (idx, line) => {
    const j = JSON.parse(line);
    setPose(j.p, j.m);
    if (!rebuilds(j.f)) return { game: { ...j, svi: idx }, leaves: [] };
    const captured = [];
    const rootPlan = search(j.m, rootDepth, captured);
    let rootSv = null;
    if (rootPlan && rootDepth === depth) rootSv = score(rootPlan);
    else if (rootPlan) { setPose(j.p, j.m); const p2 = search(j.m, depth); rootSv = p2 ? score(p2) : null; }
    const game = { ...j, ...(rootSv != null ? { sv: r4(rootSv), svd: depth } : {}), tv: r4(net.value(j.f)), svi: idx };
    const leaves = [], seen = new Set();
    for (const lf of captured) {
      const key = lf.f.map(v => v.toFixed(4)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      setPose(lf.p, lf.m);
      if (!rebuilds(lf.f)) continue;
      const plan = search(lf.m, depth);
      const sv = plan && score(plan);
      if (sv == null) continue;
      leaves.push({ f: lf.f.map(v => +v.toFixed(5)), z: r4(sv), sv: r4(sv), svd: depth, tv: r4(net.value(lf.f)),
                    p: lf.p.map(r4), m: lf.m, g: `${j.g}~leaf`, src: 'leaf', lp: lf.plies, svi: idx });
    }
    return { game, leaves };
  };
  process.on('message', msg => {
    if (msg.stop) process.exit(0);
    const games = [], leaves = [];
    for (const [idx, line] of msg.jobs) {
      const r = label(idx, line);
      games.push(JSON.stringify(r.game));
      for (const l of r.leaves) leaves.push(JSON.stringify(l));
    }
    process.send({ games, leaves });
  });
}

if (require.main === module) {
  if (process.argv.includes('--worker')) worker();
  else main().catch(e => { console.error('[leaf-label] FAILED: ' + e.message); process.exitCode = 1; });
}
