// Generate labeled training positions. Every turn records the mover's feature vector; when the
// game ends, every position gets labeled with the outcome from its mover's perspective
// (+1 the mover went on to win, -1 they lost), optionally discounted toward 0 for positions far
// from the end. Sparring is a mix: ladder-vs-ladder games (bulk from the fast levels, a garnish
// of deep ones) and, once a model exists, NN-vs-ladder and NN-vs-NN games with exploration
// temperature so the net sees its own play.
//
//   node nn/selfplay.js --games 200 --out nn/data/run1.jsonl [--model nn/models/best.json]
//                       [--levels 2,3,4,5,6] [--deep 7,8] [--deepEvery 12] [--discount 0.995]
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { features } = require('./features.js');
const { MLP } = require('./net.js');
const { nnPlanFor } = require('./nnai.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function playGame(eng, brainA, brainB, maxPlies) {
  eng.newGame();
  const rows = [];
  let plies = 0, nulls = 0;
  while (!eng.getG().over && plies < maxPlies) {
    const idx = eng.getG().active;
    rows.push({ f: features(eng), mover: idx });
    const plan = (idx === 0 ? brainA : brainB)(idx);
    if (!plan) {
      rows.pop();
      nulls++;
      if (nulls > 4) break;                        // both wedged — abandon as a draw
      eng.clearTurn(); eng.setActive(1 - idx);
      continue;
    }
    nulls = 0;
    eng.applyPlan(plan);
    plies++;
  }
  const G = eng.getG();
  return { rows, winner: G.over ? G.winner : null, plies };
}

function main() {
  const games = +arg('games', 100);
  const out = arg('out', path.join(__dirname, 'data', 'selfplay.jsonl'));
  const modelPath = arg('model', path.join(__dirname, 'models', 'best.json'));
  const levels = arg('levels', '2,3,4,5,6').split(',').map(Number);   // 1-based ladder levels
  const deep = arg('deep', '7,8').split(',').map(Number);
  const deepEvery = +arg('deepEvery', 12);
  const discount = +arg('discount', 0.995);
  const temperature = +arg('temperature', 0.08);
  const selfRatio = +arg('selfRatio', 0.5);   // share of games the net itself plays in (once it exists)
  const workers = Math.max(1, Math.floor(+arg('workers', 1)));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // Parallel mode: split the games across worker processes (each with its own engine sandbox),
  // then stitch their part-files together. Games are independent, so this is a clean N-way split
  // — the way to actually use a desktop's cores, since one game only ever busies one.
  if (workers > 1) {
    const { fork } = require('child_process');
    const t0 = Date.now();
    const per = Math.floor(games/workers), extra = games % workers, parts = [];
    let live = 0;
    const finish = () => {
      const ws = fs.createWriteStream(out, { flags: 'a' });
      let positions = 0;
      for (const part of parts) {
        if (!fs.existsSync(part)) continue;
        const d = fs.readFileSync(part, 'utf8');
        ws.write(d); positions += d.split('\n').filter(Boolean).length;
        // a transient Windows file lock (antivirus/indexing) on a just-closed part file must never
        // abort this loop -- that would orphan every LATER part unmerged (silent data loss) and,
        // since this runs inside a child.on('exit') handler, crash the whole selfplay process.
        // The data is already safely appended to `out` above; a leftover .w<n> file is just clutter.
        try { fs.unlinkSync(part); }
        catch (e) { console.warn(`warning: couldn't remove temp file ${part} (${e.message}) -- safe to delete by hand`); }
      }
      ws.end(() => console.log(`all ${parts.length} workers done: ${positions} positions -> ${out} ` +
                               `(${((Date.now() - t0)/1000).toFixed(0)}s)`));
    };
    for (let w = 0; w < workers; w++) {
      const n = per + (w < extra ? 1 : 0);
      if (!n) continue;
      const part = out + '.w' + w;
      parts.push(part);
      try { fs.unlinkSync(part); } catch (e) {}
      live++;
      const ch = fork(__filename, ['--games', String(n), '--out', part, '--model', modelPath,
        '--levels', levels.join(','), '--deep', deep.join(','), '--deepEvery', String(deepEvery),
        '--discount', String(discount), '--temperature', String(temperature),
        '--selfRatio', String(selfRatio)],
        { env: Object.assign({}, process.env, { TAU_WORKER: String(w + 1) }) });
      ch.on('exit', () => { if (--live === 0) finish(); });
    }
    console.log(`spawned ${parts.length} selfplay workers (${games} games total)`);
    return;
  }

  const TAG = process.env.TAU_WORKER ? `[w${process.env.TAU_WORKER}] ` : '';
  const eng = createEngine();
  let net = null;
  if (fs.existsSync(modelPath)) {
    net = MLP.fromJSON(JSON.parse(fs.readFileSync(modelPath, 'utf8')));
    if (!TAG) console.log('sparring with model:', modelPath);
  }
  const ladderBrain = lvl => idx => eng.ladderPlanFor(lvl - 1, idx);
  const nnBrain = idx => nnPlanFor(eng, net, idx, { temperature });
  const pick = a => a[Math.floor(Math.random()*a.length)];

  const ws = fs.createWriteStream(out, { flags: 'a' });
  let positions = 0, decided = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    let brainA, brainB, tag;
    const useDeep = deepEvery > 0 && g % deepEvery === deepEvery - 1;
    if (net && Math.random() < selfRatio) {
      // at high selfRatio most of these are pure self-play — the ramp run.js drives
      if (Math.random() < selfRatio) { brainA = nnBrain; brainB = nnBrain; tag = 'nn vs nn'; }
      else {
        const lvl = useDeep ? pick(deep) : pick(levels);
        if (Math.random() < 0.5) { brainA = nnBrain; brainB = ladderBrain(lvl); tag = 'nn vs L' + lvl; }
        else { brainA = ladderBrain(lvl); brainB = nnBrain; tag = 'L' + lvl + ' vs nn'; }
      }
    } else {
      const la = useDeep ? pick(deep) : pick(levels), lb = useDeep ? pick(deep) : pick(levels);
      brainA = ladderBrain(la); brainB = ladderBrain(lb); tag = 'L' + la + ' vs L' + lb;
    }
    const { rows, winner, plies } = playGame(eng, brainA, brainB, 300);
    if (winner !== null) {
      decided++;
      for (let i = 0; i < rows.length; i++) {
        const pliesToEnd = rows.length - i;
        const z = (rows[i].mover === winner ? 1 : -1)*Math.pow(discount, pliesToEnd);
        ws.write(JSON.stringify({ f: rows[i].f.map(v => +v.toFixed(5)), z: +z.toFixed(4) }) + '\n');
        positions++;
      }
    }
    if ((g + 1) % 10 === 0 || g === games - 1)
      console.log(`${TAG}game ${g + 1}/${games} (${tag}, ${plies} plies, winner ${winner}) — ` +
                  `${positions} positions, ${((Date.now() - t0)/1000).toFixed(0)}s`);
  }
  ws.end();
  console.log(`${TAG}done: ${decided}/${games} decided games, ${positions} positions -> ${out}`);
}

main();
