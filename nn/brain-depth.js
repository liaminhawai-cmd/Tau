// Does the value surface get MORE fractal the deeper you search?
//
// THE GAP THIS CLOSES
// Everything in BRAIN-MAP-REPORT.md measures a LEAF EVALUATOR: the net's opinion of a position with
// no search at all. Two things follow from that and both are limitations:
//   1. the nets were trained on games played at depth 1-3, so their surface is only meaningful in
//      the band of play they saw, and
//   2. a leaf evaluator's roughness is a fact about the ENCODING (features.js), not about the game.
//      That is exactly what the report found: slope ~1.0 for trained champions, untrained random
//      nets and the hand-written L11 alike, because blocks A/C/D of the feature vector step.
// Neither limitation touches the question anyone actually cares about, which is whether TAU is
// deep -- whether its value landscape keeps revealing structure as you look further ahead.
//
// So this walks the same transects, but the number recorded at each point is the ROOT VALUE OF A
// d-PLY SEARCH rather than a leaf evaluation. Any extra roughness that appears as d grows cannot
// be the encoding (the encoding is identical at every depth): it is the game's own decision
// boundaries -- the places where one more ply flips which line is best -- becoming visible.
//
// WHY L11 IS THE PRIMARY SUBJECT
// L11 is hand-written. It has no training distribution at all, so the "only trained on d1-3" caveat
// simply does not apply to it, and its d1..d6 ladder is a clean measurement of search structure. A
// trained net is worth running as the contrast: if the NET's surface stops changing past d3 while
// L11's keeps changing, that is direct evidence the training distribution capped what the net knows.
//
// WHY THE ROOT VALUE AND NOT THE CHOSEN MOVE'S SCORE
// nnPlanFor smooths the root scores at depth 1 (3-point plateau smoothing along each arm) but ranks
// on the raw recursive score at depth >= 2. Left alone that would put a low-pass filter on the first
// rung of the ladder and none of the others, which is an artefact of the instrument shaped exactly
// like the effect being looked for. `rawRoot: true` turns the smoothing off at every depth.
//
// WHY abCut IS OFF
// Alpha-beta would pay for itself several times over here, but nnPlanFor's cutoff fires on a raw
// 1-ply bound (`bestRaw > cutIfAbove`), so a cut branch returns a value that is good enough to
// refute rather than exact. That is fine for choosing a move and wrong for measuring a surface.
//
// THE BUDGET, MEASURED NOT ASSUMED
// One point, L11 eval, sweepDeg 9, keepForDepth 2, no pruning:
//     d1 72ms   d2 1.22s   d3 3.5s   d4 9.4s   d5 17.5s   d6 42.3s
// keepForDepth 3 costs 36s at d4 alone, so the whole ladder is only affordable at keep 2. ~74s per
// point for the full d1..d6 ladder means a few hundred points, not the tens of thousands a leaf-eval
// transect can buy -- which is why this runs SHORT lines: the scale band that matters is around and
// below crossEps, and a short line spends every sample there instead of on the coarse end.
'use strict';
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');

const { createEngine } = require('./engine.js');
const { features } = require('./features.js');
const { nnPlanFor } = require('./nnai.js');
const { loadValueNet } = require('./load-value-net.js');

function mulberry(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Kept byte-for-byte in step with brain-map.js / brain-transect.js so a depth trace and a leaf-eval
// trace describe the same board.
function setupPose(eng, name) {
  eng.newGame();
  if (name === 'start') { /* canonical opening */ }
  else if (name === 'swing1' || name === 'swing2') {
    eng.applyPlan({ pivotIdx: 0, dir: 1, targetRad: eng.simMoveToLimit(0, 1) * 0.6 });
    if (name === 'swing2')
      eng.applyPlan({ pivotIdx: 0, dir: -1, targetRad: eng.simMoveToLimit(0, -1) * 0.5 });
  } else throw new Error(`unknown pose "${name}"`);
  const g = eng.getG(), me = g.pieces[g.active], op = g.pieces[1 - g.active];
  return { active: g.active, meRot: me.rot, op: { x: op.x, y: op.y, rot: op.rot } };
}

function legalAt(CFG, x, y, op) {
  return Math.hypot(x, y) <= CFG.edgeU - CFG.footR - CFG.edgeEps &&
         Math.hypot(x - op.x, y - op.y) >= 3.8 * CFG.legRadius;
}

// Lines are chosen ONCE in the main thread and handed to the workers, so every depth walks exactly
// the same points. The d1..d6 comparison is then paired at every sample, which matters more here
// than anywhere else in the study: a few hundred points is far too few to rely on two independent
// line sets landing on comparably interesting parts of the board.
function pickLines(rnd, CFG, op, span, n) {
  const hubR = CFG.edgeU - CFG.footR - CFG.edgeEps;
  const out = [];
  for (let t = 0; t < 200000 && out.length < n; t++) {
    const th = rnd() * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
    const r = hubR * 0.92 * Math.sqrt(rnd()), ang = rnd() * 2 * Math.PI;
    const cx = r * Math.cos(ang), cy = r * Math.sin(ang), h = span / 2;
    const a = { x: cx - ux * h, y: cy - uy * h }, b = { x: cx + ux * h, y: cy + uy * h };
    if (legalAt(CFG, a.x, a.y, op) && legalAt(CFG, b.x, b.y, op)) out.push({ a, b });
  }
  return out;
}

function makeEval(eng, model) {
  if (model === '__engine') {
    const topW = eng.AI_LADDER[eng.AI_LADDER.length - 1].w;
    // ladderEval already answers "score for `side`, whoever's turn it is" -- it is NOT antisymmetric
    // (see the evalFn contract note in nnai.js), so it must be passed through unnegated.
    return { evalFn: (e, side) => e.ladderEval(side, topW), info: { kind: 'engine', params: 0, sizes: [] } };
  }
  const info = loadValueNet(model);
  return {
    evalFn: (e, side) => { const v = info.value(features(e)); return e.getG().active === side ? v : -v; },
    info,
  };
}

// ---------------------------------------------------------------------------- worker

if (!isMainThread) {
  const { model, pose, keep, sweepDeg } = workerData;
  const eng = createEngine();
  const ref = setupPose(eng, pose);
  const CFG = eng.CFG, g = eng.getG(), me = g.pieces[g.active];
  const { evalFn } = makeEval(eng, model);
  const top = [];

  // The root value of a d-ply search from this hub position. `captureTop` is the only way out of
  // nnPlanFor that carries a score, and with rawRoot on the top entry's score is max(v) at d=1 and
  // max(deep) at d>=2 -- the negamax root value under both, which is the point.
  function rootValue(x, y, depth) {
    me.x = x; me.y = y; me.rot = ref.meRot;
    g.active = ref.active;
    top.length = 0;
    const plan = nnPlanFor(eng, null, ref.active, {
      temperature: 0, depth, keepForDepth: keep, rawRoot: true, evalFn,
      sweepDeg, captureTop: top, captureTopN: 1,
    });
    if (!plan || !top.length) return NaN;      // wedged: no legal waypoint at all
    return top[0].score;
  }

  parentPort.on('message', job => {
    if (job.stop) { process.exit(0); }
    const { seg, samples, depth, lineIdx } = job;
    const v = new Float64Array(samples);
    let bad = false;
    for (let i = 0; i < samples; i++) {
      const f = i / (samples - 1);
      const x = seg.a.x + (seg.b.x - seg.a.x) * f, y = seg.a.y + (seg.b.y - seg.a.y) * f;
      if (!legalAt(CFG, x, y, ref.op)) { bad = true; break; }
      const s = rootValue(x, y, depth);
      if (!Number.isFinite(s)) { bad = true; break; }
      // A throw is scored 1e6 by the engine rather than by the evaluator. One of those inside a
      // trace would dominate the structure function by twelve orders of magnitude and say nothing
      // about the value surface, so the line is dropped rather than silently swamping every lag.
      if (Math.abs(s) >= 1e5) { bad = true; break; }
      v[i] = s;
    }
    parentPort.postMessage({ depth, lineIdx, trace: bad ? null : Array.from(v) });
  });
  parentPort.postMessage({ ready: true });
  return;
}

// ---------------------------------------------------------------------------- main

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

async function main() {
  const model = arg('model', '__engine');
  const pose = arg('pose', 'swing1');
  const span = +arg('span', 2);
  const samples = +arg('samples', 65);
  const lines = +arg('lines', 8);
  const keep = +arg('keep', 2);
  const sweepDeg = +arg('sweepDeg', 9);
  const depths = String(arg('depths', '1,2,3,4,5,6')).split(',').map(Number);
  const outDir = arg('out', 'nn/brain-maps');
  const threads = Math.max(1, +arg('threads', 4));
  const tag = arg('tag', model === '__engine' ? 'L11' : path.basename(String(model)).replace(/\.json$/, ''));

  fs.mkdirSync(outDir, { recursive: true });
  const eng = createEngine();
  const ref = setupPose(eng, pose);
  const { info } = makeEval(eng, model);
  const segs = pickLines(mulberry(20260915), eng.CFG, ref.op, span, lines);
  if (segs.length < lines) console.log(`  only ${segs.length}/${lines} lines fit at span ${span}`);
  const h = span / (samples - 1);
  console.log(`${tag}: depths ${depths.join(',')}  ${segs.length} lines x ${samples} samples  ` +
              `span=${span}u  spacing ${h.toFixed(5)}u = crossEps/${(eng.CFG.crossEps / h).toFixed(1)}  ` +
              `keep=${keep} sweepDeg=${sweepDeg}`);

  // Jobs are dispatched one at a time to whichever worker is free, rather than split into fixed
  // chunks up front: a d6 line costs ~600x a d1 line, and a static split would leave three cores
  // idle for most of the run. Shallow depths first so partial output is useful early.
  const jobs = [];
  for (const d of depths) for (let L = 0; L < segs.length; L++) jobs.push({ depth: d, lineIdx: L });
  const got = new Map(depths.map(d => [d, new Array(segs.length).fill(null)]));
  const left = new Map(depths.map(d => [d, segs.length]));
  const t0 = Date.now();
  let next = 0, done = 0;

  function writeDepth(d) {
    const traces = got.get(d).filter(Boolean);
    const meta = got.get(d).map((t, L) => t ? { len: span, a: segs[L].a, b: segs[L].b } : null).filter(Boolean);
    const base = path.join(outDir, `${tag}-d${d}__${pose}__T${span}__${samples}`);
    fs.writeFileSync(base + '.json', JSON.stringify({
      tag: `${tag}-d${d}`, model, pose, depth: d, keep, sweepDeg,
      span, samples, lines: traces.length, spacing: h, spanU: span,
      crossEps: eng.CFG.crossEps, kind: info.kind, params: info.params, sizes: info.sizes,
      seconds: (Date.now() - t0) / 1000, meta, traces,
    }));
    console.log(`\n  depth ${d}: ${traces.length}/${segs.length} usable lines -> ${base}.json`);
  }

  await new Promise((resolve, reject) => {
    const feed = w => {
      if (next >= jobs.length) { w.postMessage({ stop: true }); return; }
      const j = jobs[next++];
      w.postMessage({ seg: segs[j.lineIdx], samples, depth: j.depth, lineIdx: j.lineIdx });
    };
    for (let t = 0; t < threads; t++) {
      const w = new Worker(__filename, { workerData: { model, pose, keep, sweepDeg } });
      w.on('message', m => {
        if (m.ready) { feed(w); return; }
        got.get(m.depth)[m.lineIdx] = m.trace;
        done++;
        process.stdout.write(`\r  ${done}/${jobs.length} lines  ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
        // Write a depth out the moment its last line lands, so a run that has to be stopped early
        // still leaves every finished rung of the ladder on disk.
        left.set(m.depth, left.get(m.depth) - 1);
        if (left.get(m.depth) === 0) writeDepth(m.depth);
        if (done >= jobs.length) resolve();
        else feed(w);
      });
      w.on('error', reject);
    }
  });

  console.log(`\nALL DONE  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(0);
}

main();
