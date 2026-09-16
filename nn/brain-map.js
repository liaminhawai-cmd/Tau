// Sweep a value net across the board and dump the raw scalar field, so the "brain map" can be
// measured instead of eyeballed.
//
// The picture the browser visualiser draws is a value surface: freeze the opponent, walk MY hub
// over every cell of the board, ask the net how good that is. Small nets draw something smooth and
// ring-symmetric; big nets draw something visibly rougher. Whether that roughness is structure or
// noise is a question about the FIELD, not the picture, so this writes float32 cells to disk and
// leaves the judging to map-analyze.js.
//
// Only the mover's hub moves. Rotation is held at the pose's value because sweeping rotation too
// would mix a 3-fold-symmetric coordinate into a 2-D picture and put periodic structure in the map
// that has nothing to do with board geometry.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');

const { createEngine } = require('./engine.js');
const { nnPlanFor } = require('./nnai.js');

// Held in step with brain-depth.js so a searched map and a searched transect are the same surface.
// keep 2 is the only frontier width the deep plies fit in; 9 degrees is the sweep resolution the
// cost study was run at.
const SEARCH_KEEP = 2, SEARCH_SWEEP_DEG = 9;
const { features } = require('./features.js');
const { loadValueNet } = require('./load-value-net.js');

// Poses are named and deterministic: a map is only comparable across models if every model saw the
// exact same opponent placement, and a random opening would make each run its own experiment.
const POSES = {
  start: eng => { eng.newGame(); },
  // One swing in from the opening, the position the study actually cares about: the opponent has
  // committed to something and the board is no longer mirror-symmetric.
  swing1: eng => {
    eng.newGame();
    const lim = eng.simMoveToLimit(0, 1);
    eng.applyPlan({ pivotIdx: 0, dir: 1, targetRad: lim * 0.6 });
  },
  // Two swings in -- a midgame-ish shape, used to check the findings aren't an artefact of one pose.
  swing2: eng => {
    POSES.swing1(eng);
    const lim = eng.simMoveToLimit(0, -1);
    eng.applyPlan({ pivotIdx: 0, dir: -1, targetRad: lim * 0.5 });
  },
};

function setupPose(eng, name) {
  const fn = POSES[name];
  if (!fn) throw new Error(`unknown pose "${name}". Known: ${Object.keys(POSES).join(', ')}`);
  fn(eng);
  const g = eng.getG();
  const me = g.pieces[g.active], op = g.pieces[1 - g.active];
  return {
    active: g.active,
    meRot: me.rot,
    op: { x: op.x, y: op.y, rot: op.rot },
  };
}

// A hub position is mappable only if the piece could actually be there: every foot on the board,
// and hubs not inside one another.
//
// The obvious separation bound, 2*footR, is the one randomStartPose uses -- but that one is
// deliberately far too strong for this job. Tau is a contact game whose legs are thin tubes
// (legRadius 1.44 against a footR of 23.1), so tripods routinely interleave; at 2*footR the mask
// blanks 94% of the board, including every position where the two pieces are actually fighting,
// which is precisely where a danger map is worth looking at. The real floor is the two hub balls
// touching -- 2*1.9*legRadius, the same hub geometry the engine's own contact solver uses.
function makeMask(CFG) {
  const hubR = CFG.edgeU - CFG.footR - CFG.edgeEps;
  const minSep = 3.8 * CFG.legRadius;
  return (x, y, op) => Math.hypot(x, y) <= hubR && Math.hypot(x - op.x, y - op.y) >= minSep;
}

function gridAxis(res, E) {
  // Cell centres across the full board box, so cell size is exactly 2E/res.
  const a = new Float64Array(res);
  for (let i = 0; i < res; i++) a[i] = -E + (i + 0.5) * (2 * E / res);
  return a;
}

// `ply` >= 1 records the root value of an N-ply search instead of the leaf evaluation, and `rung`
// picks which AI_LADDER weights drive it. Both default to the old behaviour (leaf eval, top rung),
// so an existing sweep is unchanged. It is called `ply` and not `depth` deliberately: a LEAF map
// and a ONE-PLY SEARCH map are different surfaces (the first is what the evaluator says here, the
// second is what it says after playing its best move), and numbering both of them "depth 1" is
// exactly the kind of collision that makes two runs silently incomparable. Leaf is ply 0. Cost is the reason this is a knob rather than the default:
// measured per cell, d1 costs ~70ms and d3 ~10s, so a 256^2 searched map is hours where a leaf map
// is seconds. rawRoot matches brain-depth.js, so a searched map and a searched transect describe
// the same surface.
function sweepRows(model, pose, res, rowStart, rowEnd, onRow, ply, rung) {
  const eng = createEngine();
  const ref = setupPose(eng, pose);
  const CFG = eng.CFG, E = CFG.edgeU;
  const g = eng.getG();
  const me = g.pieces[g.active];
  const net = model === '__engine'
    ? null
    : loadValueNet(model);
  const rIdx = rung == null ? eng.AI_LADDER.length - 1
                            : Math.max(0, Math.min(eng.AI_LADDER.length - 1, rung - 1));
  const topW = eng.AI_LADDER[rIdx].w;
  const ax = gridAxis(res, E);
  const inside = makeMask(CFG);
  const D = ply || 0;
  const evalFn = net
    ? ((e, side) => { const v = net.value(features(e)); return e.getG().active === side ? v : -v; })
    : ((e, side) => e.ladderEval(side, topW));
  const top = [];

  for (let j = rowStart; j < rowEnd; j++) {
    const row = new Float32Array(res);
    const y = ax[j];
    for (let i = 0; i < res; i++) {
      const x = ax[i];
      if (!inside(x, y, ref.op)) { row[i] = NaN; continue; }
      me.x = x; me.y = y; me.rot = ref.meRot;
      if (D < 1) { row[i] = evalFn(eng, ref.active); continue; }
      g.active = ref.active;
      top.length = 0;
      const plan = nnPlanFor(eng, null, ref.active, {
        temperature: 0, depth: D, keepForDepth: SEARCH_KEEP, rawRoot: true, evalFn,
        sweepDeg: SEARCH_SWEEP_DEG, captureTop: top, captureTopN: 1,
      });
      // Wedged (no legal waypoint) or a throw: a throw is scored 1e6 by the engine rather than by
      // the evaluator, and one of those in a field would set the colour scale for the whole map.
      row[i] = (!plan || !top.length || Math.abs(top[0].score) >= 1e5) ? NaN : top[0].score;
    }
    onRow(j, row);
  }
}

if (!isMainThread) {
  const { model, pose, res, rowStart, rowEnd, ply, rung } = workerData;
  const out = new Float32Array((rowEnd - rowStart) * res);
  sweepRows(model, pose, res, rowStart, rowEnd, (j, row) => {
    out.set(row, (j - rowStart) * res);
    if ((j - rowStart) % 16 === 0) parentPort.postMessage({ progress: j - rowStart });
  }, ply, rung);
  parentPort.postMessage({ done: true, rowStart, rowEnd, buf: out.buffer }, [out.buffer]);
} else {
  main();
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

async function main() {
  const model = arg('model', 'nn/models/best.json');
  const pose = arg('pose', 'swing1');
  const res = +arg('res', 1024);
  const ply = +arg('ply', 0);   // 0 = leaf evaluation (the original behaviour); N >= 1 = root value of an N-ply search
  const rung = arg('rung', null) == null ? null : +arg('rung');
  const outDir = arg('out', 'nn/brain-maps');
  const threads = +arg('threads', Math.max(1, Math.min(os.cpus().length, 4)));
  const tag = arg('tag', (model === '__engine' ? 'L' + (rung == null ? 11 : rung)
                                              : path.basename(String(model)).replace(/\.json$/, '')) +
                         (ply >= 1 ? '-p' + ply : ''));

  fs.mkdirSync(outDir, { recursive: true });
  const eng = createEngine();
  const ref = setupPose(eng, pose);
  const E = eng.CFG.edgeU;
  const info = model === '__engine'
    ? { kind: `engine-L${rung == null ? eng.AI_LADDER.length : rung}`, params: 0, sizes: [],
         note: `ladder rung L${rung == null ? eng.AI_LADDER.length : rung}'s own eval, as a ground-truth field` }
    : loadValueNet(model);
  if (info.note) console.log(`  note: ${info.note}`);

  const cell = 2 * E / res;
  console.log(`${tag}: ${res}x${res} over [-${E},${E}]  cell=${cell.toFixed(4)}u  ` +
              `crossEps=${eng.CFG.crossEps}u = ${(eng.CFG.crossEps / cell).toFixed(1)} cells`);

  const field = new Float32Array(res * res);
  const t0 = Date.now();

  const bounds = [];
  for (let t = 0; t < threads; t++)
    bounds.push([Math.floor(t * res / threads), Math.floor((t + 1) * res / threads)]);

  let doneRows = 0;
  await Promise.all(bounds.map(([a, b]) => new Promise((resolve, reject) => {
    if (a >= b) return resolve();
    const w = new Worker(__filename, { workerData: { model, pose, res, rowStart: a, rowEnd: b, ply, rung } });
    let last = 0;
    w.on('message', m => {
      if (m.done) {
        field.set(new Float32Array(m.buf), m.rowStart * res);
        return;
      }
      doneRows += m.progress - last; last = m.progress;
      const pct = (100 * doneRows / res).toFixed(0);
      process.stdout.write(`\r  ${pct}%  ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
    });
    w.on('error', reject);
    w.on('exit', c => c === 0 ? resolve() : reject(new Error('worker exit ' + c)));
  })));

  const secs = (Date.now() - t0) / 1000;
  let n = 0, mn = Infinity, mx = -Infinity, sum = 0;
  for (const v of field) if (Number.isFinite(v)) { n++; sum += v; if (v < mn) mn = v; if (v > mx) mx = v; }

  const base = path.join(outDir, `${tag}__${pose}__${res}`);
  fs.writeFileSync(base + '.bin', Buffer.from(field.buffer));
  fs.writeFileSync(base + '.json', JSON.stringify({
    tag, model, pose, res, ply, rung, keep: ply >= 1 ? SEARCH_KEEP : null,
    extent: E, cell, crossEps: eng.CFG.crossEps,
    kind: info.kind, params: info.params, sizes: info.sizes,
    live: n, min: mn, max: mx, mean: sum / n, seconds: secs,
    opponent: ref.op, meRot: ref.meRot, active: ref.active,
  }, null, 1));
  console.log(`\r  done ${secs.toFixed(0)}s  live=${n}  range=[${mn.toFixed(4)}, ${mx.toFixed(4)}]  -> ${base}.bin`);
}
