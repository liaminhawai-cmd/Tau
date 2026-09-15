// Walk a value net along straight lines across the board, sampled far finer than any 2-D map can
// afford, and record the raw trace.
//
// WHY NOT JUST A BIGGER MAP
// The question is what the value surface does at SMALL separations -- below the engine's own
// crossEps of 0.81u, where two poses are the same pose as far as the rules are concerned. A 2-D
// map answers that badly: doubling its resolution costs 4x the evaluations and buys only 2x the
// reach downward in scale, and on the slowest net here (8.5ms per evaluation) that is hours for a
// single decade. A line costs M evaluations for M samples, and a uniformly sampled line gives the
// structure function EXACTLY at every lag k*h -- every pair at that separation, not a random
// subsample. Twenty short lines at 0.002u spacing cost a couple of minutes and reach two and a
// half decades below crossEps, which no affordable 2-D map does.
//
// Two span modes, because two different questions:
//   --span full   chords right across the legal disc: the overall shape, coarse to fine.
//   --span <u>    short segments centred on random legal points: a microscope on one scale band.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');

const { createEngine } = require('./engine.js');
const { features } = require('./features.js');
const { loadValueNet } = require('./load-value-net.js');

function mulberry(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Same pose table as brain-map.js, kept in step so a transect and a map describe the same board.
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

// Pick a line to walk. `full` takes a chord of the legal disc; a numeric span takes a short segment
// whose endpoints are both legal, so the trace never runs off the board mid-line (a NaN in the
// middle of a transect would silently bias every lag that straddles it).
function pickLine(rnd, CFG, op, span) {
  const hubR = CFG.edgeU - CFG.footR - CFG.edgeEps;
  for (let t = 0; t < 4000; t++) {
    const th = rnd() * Math.PI;
    const ux = Math.cos(th), uy = Math.sin(th);
    if (span === 'full') {
      const off = (rnd() * 2 - 1) * hubR * 0.8;
      const nx = -uy, ny = ux;
      const half = Math.sqrt(Math.max(0, hubR * hubR - off * off)) * 0.98;
      if (half < hubR * 0.25) continue;
      const cx = nx * off, cy = ny * off;
      const a = { x: cx - ux * half, y: cy - uy * half }, b = { x: cx + ux * half, y: cy + uy * half };
      if (legalAt(CFG, a.x, a.y, op) && legalAt(CFG, b.x, b.y, op)) return { a, b };
    } else {
      const r = hubR * 0.92 * Math.sqrt(rnd()), ang = rnd() * 2 * Math.PI;
      const cx = r * Math.cos(ang), cy = r * Math.sin(ang);
      const h = span / 2;
      const a = { x: cx - ux * h, y: cy - uy * h }, b = { x: cx + ux * h, y: cy + uy * h };
      if (legalAt(CFG, a.x, a.y, op) && legalAt(CFG, b.x, b.y, op)) return { a, b };
    }
  }
  return null;
}

function runLines(model, pose, span, samples, lines, seed, onLine) {
  const eng = createEngine();
  const ref = setupPose(eng, pose);
  const CFG = eng.CFG, g = eng.getG(), me = g.pieces[g.active];
  const net = model === '__engine' ? null : loadValueNet(model);
  const topW = eng.AI_LADDER[eng.AI_LADDER.length - 1].w;
  const rnd = mulberry(seed);
  for (let L = 0; L < lines; L++) {
    const seg = pickLine(rnd, CFG, ref.op, span);
    if (!seg) { onLine(L, null, null); continue; }
    const len = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
    const v = new Float64Array(samples);
    let bad = false;
    for (let i = 0; i < samples; i++) {
      const f = i / (samples - 1);
      const x = seg.a.x + (seg.b.x - seg.a.x) * f, y = seg.a.y + (seg.b.y - seg.a.y) * f;
      if (!legalAt(CFG, x, y, ref.op)) { bad = true; break; }
      me.x = x; me.y = y; me.rot = ref.meRot;
      v[i] = net ? net.value(features(eng)) : eng.ladderEval(g.active, topW);
    }
    onLine(L, bad ? null : v, bad ? null : { len, a: seg.a, b: seg.b });
  }
}

if (!isMainThread) {
  const { model, pose, span, samples, lines, seed } = workerData;
  const traces = [], metas = [];
  runLines(model, pose, span, samples, lines, seed, (L, v, m) => {
    if (v) { traces.push(Array.from(v)); metas.push(m); }
    parentPort.postMessage({ progress: 1 });
  });
  parentPort.postMessage({ done: true, traces, metas });
} else main();

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

async function main() {
  const model = arg('model', 'nn/models/best.json');
  const pose = arg('pose', 'swing1');
  const spanArg = arg('span', 'full');
  const span = spanArg === 'full' ? 'full' : +spanArg;
  const samples = +arg('samples', 2048);
  const lines = +arg('lines', 24);
  const outDir = arg('out', 'nn/brain-maps');
  const threads = Math.max(1, Math.min(+arg('threads', 4), lines));
  const tag = arg('tag', path.basename(String(model)).replace(/\.json$/, ''));

  fs.mkdirSync(outDir, { recursive: true });
  const info = model === '__engine'
    ? { kind: 'engine', params: 0, sizes: [], note: "L11's own eval, as a ground-truth field" }
    : loadValueNet(model);
  if (info.note) console.log(`  note: ${info.note}`);

  const eng = createEngine();
  const ref = setupPose(eng, pose);
  const spanU = span === 'full' ? 2 * (eng.CFG.edgeU - eng.CFG.footR - eng.CFG.edgeEps) * 0.8 : span;
  const h = spanU / (samples - 1);
  console.log(`${tag}: ${lines} lines x ${samples} samples, span=${spanArg}  ` +
              `spacing~${h.toFixed(5)}u = crossEps/${(eng.CFG.crossEps / h).toFixed(0)}`);

  const t0 = Date.now();
  let done = 0;
  const per = Math.ceil(lines / threads);
  const chunks = [];
  for (let t = 0; t < threads; t++) {
    const n = Math.min(per, lines - t * per);
    if (n > 0) chunks.push({ n, seed: 9001 + t * 7717 });
  }
  const all = [], allMeta = [];
  await Promise.all(chunks.map(c => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { model, pose, span, samples, lines: c.n, seed: c.seed } });
    w.on('message', m => {
      if (m.done) { all.push(...m.traces); allMeta.push(...m.metas); return; }
      done++; process.stdout.write(`\r  ${done}/${lines} lines  ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
    });
    w.on('error', rej);
    w.on('exit', c2 => c2 === 0 ? res() : rej(new Error('worker exit ' + c2)));
  })));

  const secs = (Date.now() - t0) / 1000;
  const base = path.join(outDir, `${tag}__${pose}__T${spanArg}__${samples}`);
  fs.writeFileSync(base + '.json', JSON.stringify({
    tag, model, pose, span: spanArg, samples, lines: all.length, spacing: h, spanU,
    crossEps: eng.CFG.crossEps, kind: info.kind, params: info.params, sizes: info.sizes,
    seconds: secs, meta: allMeta, traces: all,
  }));
  console.log(`\r  done ${secs.toFixed(0)}s  ${all.length} usable lines -> ${base}.json`);
}
