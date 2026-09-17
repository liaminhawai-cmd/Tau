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
// --keep overrides the frontier width (default 2): the certifier found the depth-2 verdicts of a
// keep-2 search to be greedy-selection artefacts in 24 of 25 forced-loss cells, so a searched map
// at a wider keep is the control for how much of the ply-2 texture is the search rather than the game.
const SEARCH_KEEP_DEFAULT = 2, SEARCH_SWEEP_DEG = 9;
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

// Cell centres across a square window of half-width `half` centred on `c`. The default window is
// the whole board box (c = 0, half = edgeU), which reproduces the original full-board axis exactly.
//
// WHY A WINDOW EXISTS AT ALL: the cost of a searched map is set by the CELL COUNT, not by the area
// it covers, and the deep plies are expensive enough that a full board at a pitch fine enough to
// see anything is days. Cropping to a window buys pitch at constant cost -- the same 64^2 budget
// that renders an eighth of the board at 0.13u renders the whole board at 0.52u. Since the question
// is whether deeper search puts structure at scales a shallow search leaves smooth, pitch is the
// axis worth spending on, so the deep plies are run zoomed rather than not at all.
function gridAxis(res, c, half) {
  const a = new Float64Array(res);
  for (let i = 0; i < res; i++) a[i] = c - half + (i + 0.5) * (2 * half / res);
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
function sweepRows(model, pose, res, rows, onRow, ply, rung, win, keep) {
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
  const axX = gridAxis(res, win.cx, win.half);
  const axY = gridAxis(res, win.cy, win.half);
  const inside = makeMask(CFG);
  const D = ply || 0;
  const evalFn = net
    ? ((e, side) => { const v = net.value(features(e)); return e.getG().active === side ? v : -v; })
    : ((e, side) => e.ladderEval(side, topW));
  const top = [];

  for (const j of rows) {
    const row = new Float32Array(res);
    const y = axY[j];
    for (let i = 0; i < res; i++) {
      const x = axX[i];
      if (!inside(x, y, ref.op)) { row[i] = NaN; continue; }
      me.x = x; me.y = y; me.rot = ref.meRot;
      if (D < 1) { row[i] = evalFn(eng, ref.active); continue; }
      g.active = ref.active;
      top.length = 0;
      const plan = nnPlanFor(eng, null, ref.active, {
        temperature: 0, depth: D, keepForDepth: keep, rawRoot: true, evalFn,
        sweepDeg: SEARCH_SWEEP_DEG, captureTop: top, captureTopN: 1,
      });
      // A FORCED WIN OR LOSS is scored +-1e6 by the engine rather than by the evaluator, and those
      // cells are the most interesting ones in a searched map, not noise: they are where the search
      // proved "I can throw them next move" or "they can throw me". Masking them out (which this
      // line used to do) deletes exactly the structure a depth-2 map exists to show. They cannot be
      // left at 1e6 either -- one of those sets the colour scale for the whole field -- so they are
      // CLAMPED to a sentinel just outside the evaluator's own range, which renders as saturated at
      // the right end while leaving the graded interior readable. `throwClamp` is applied after the
      // sweep, once the finite range is known; here they are recorded verbatim.
      row[i] = (!plan || !top.length) ? NaN : top[0].score;
    }
    onRow(j, row);
  }
}

if (!isMainThread) {
  // Every finished row goes home immediately rather than being accumulated and shipped at the end.
  // A deep-ply sweep runs for hours, and this box has lost two multi-hour runs to container
  // restarts; streaming rows lets the parent checkpoint, so a restart costs minutes instead of the
  // whole map.
  const { model, pose, res, rows, ply, rung, win, keep } = workerData;
  sweepRows(model, pose, res, rows, (j, row) => {
    parentPort.postMessage({ row: j, buf: row.buffer }, [row.buffer]);
  }, ply, rung, win, keep);
  parentPort.postMessage({ done: true });
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
  const keep = +arg('keep', SEARCH_KEEP_DEFAULT);
  const outDir = arg('out', 'nn/brain-maps');
  const threads = +arg('threads', Math.max(1, Math.min(os.cpus().length, 4)));

  fs.mkdirSync(outDir, { recursive: true });
  const eng = createEngine();
  const ref = setupPose(eng, pose);
  const E = eng.CFG.edgeU;
  // Window: defaults to the whole board box, so an existing command line is unchanged.
  const half = +arg('half', E), cx = +arg('cx', 0), cy = +arg('cy', 0);
  const zoomed = half !== E || cx !== 0 || cy !== 0;
  const tag = arg('tag', (model === '__engine' ? 'L' + (rung == null ? 11 : rung)
                                              : path.basename(String(model)).replace(/\.json$/, '')) +
                         (ply >= 1 ? '-p' + ply : '') + (ply >= 1 && keep !== SEARCH_KEEP_DEFAULT ? '-k' + keep : '') +
                         (zoomed ? `-z${half.toFixed(1)}` : ''));
  const info = model === '__engine'
    ? { kind: `engine-L${rung == null ? eng.AI_LADDER.length : rung}`, params: 0, sizes: [],
         note: `ladder rung L${rung == null ? eng.AI_LADDER.length : rung}'s own eval, as a ground-truth field` }
    : loadValueNet(model);
  if (info.note) console.log(`  note: ${info.note}`);

  const win = { cx, cy, half };
  const cell = 2 * half / res;
  console.log(`${tag}: ${res}x${res} over x[${(cx - half).toFixed(2)},${(cx + half).toFixed(2)}] ` +
              `y[${(cy - half).toFixed(2)},${(cy + half).toFixed(2)}]  cell=${cell.toFixed(4)}u  ` +
              `crossEps=${eng.CFG.crossEps}u = ${(eng.CFG.crossEps / cell).toFixed(1)} cells`);

  const base = path.join(outDir, `${tag}__${pose}__${res}`);
  const field = new Float32Array(res * res);
  const rowDone = new Uint8Array(res);

  // RESUME. A part file is only reusable if it describes the same sweep, so its stamp carries every
  // parameter that changes the field. Anything that does not match is ignored rather than merged --
  // half a map of one surface glued to half of another is worse than starting over, because it
  // still looks like a map.
  const stamp = JSON.stringify({ model, pose, res, ply, rung, cx, cy, half, keep, sweep: SEARCH_SWEEP_DEG });
  let carried = 0;
  if (fs.existsSync(base + '.part.json') && fs.existsSync(base + '.part.bin')) {
    try {
      const meta = JSON.parse(fs.readFileSync(base + '.part.json', 'utf8'));
      if (meta.stamp === stamp) {
        const buf = fs.readFileSync(base + '.part.bin');
        field.set(new Float32Array(buf.buffer, buf.byteOffset, res * res));
        for (const j of meta.rows) { rowDone[j] = 1; carried++; }
        console.log(`  resuming: ${carried}/${res} rows already on disk`);
      } else {
        console.log('  ignoring stale part file (different sweep)');
      }
    } catch (e) { console.log('  unreadable part file, starting over:', e.message); }
  }

  const t0 = Date.now();
  const pending = [];
  for (let j = 0; j < res; j++) if (!rowDone[j]) pending.push(j);

  // Round-robin rather than contiguous blocks: rows differ wildly in cost (a row through the middle
  // of the board is all legal cells, a row near the rim is mostly masked), so contiguous blocks
  // leave one worker grinding for an hour after the others have finished.
  const lanes = Array.from({ length: threads }, () => []);
  pending.forEach((j, k) => lanes[k % threads].push(j));

  let doneRows = carried, lastSave = Date.now();
  const saveMs = 30000;
  const savePart = () => {
    const rows = [];
    for (let j = 0; j < res; j++) if (rowDone[j]) rows.push(j);
    fs.writeFileSync(base + '.part.bin.tmp', Buffer.from(field.buffer));
    fs.renameSync(base + '.part.bin.tmp', base + '.part.bin');
    fs.writeFileSync(base + '.part.json.tmp', JSON.stringify({ stamp, rows }));
    fs.renameSync(base + '.part.json.tmp', base + '.part.json');
  };

  await Promise.all(lanes.map(rows => new Promise((resolve, reject) => {
    if (!rows.length) return resolve();
    const w = new Worker(__filename, { workerData: { model, pose, res, rows, ply, rung, win, keep } });
    w.on('message', m => {
      if (m.done) return;
      field.set(new Float32Array(m.buf), m.row * res);
      rowDone[m.row] = 1;
      doneRows++;
      if (Date.now() - lastSave > saveMs) { savePart(); lastSave = Date.now(); }
      const pct = (100 * doneRows / res).toFixed(0);
      process.stdout.write(`\r  ${pct}%  ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
    });
    w.on('error', reject);
    w.on('exit', c => c === 0 ? resolve() : reject(new Error('worker exit ' + c)));
  })));

  const secs = (Date.now() - t0) / 1000;
  // Pull the +-1e6 forced-win/loss cells in to just past the finite range, so they saturate the
  // colour ramp instead of collapsing it. Reported, because how much of a searched map is decided
  // rather than evaluated is itself a result.
  let decidedWin = 0, decidedLoss = 0;
  if (ply >= 1) {
    let fmn = Infinity, fmx = -Infinity;
    for (const v of field) if (Number.isFinite(v) && Math.abs(v) < 1e5) { if (v < fmn) fmn = v; if (v > fmx) fmx = v; }
    const pad = (fmx - fmn) * 0.12 || 1;
    for (let i = 0; i < field.length; i++) {
      if (!Number.isFinite(field[i])) continue;
      if (field[i] >= 1e5) { field[i] = fmx + pad; decidedWin++; }
      else if (field[i] <= -1e5) { field[i] = fmn - pad; decidedLoss++; }
    }
    console.log(`  decided by search: ${decidedWin} forced-win cells, ${decidedLoss} forced-loss cells`);
  }

  // Stats AFTER the clamp, so the recorded min/max describe the field actually written to the .bin
  // rather than the +-1e6 sentinels the clamp just removed.
  let n = 0, mn = Infinity, mx = -Infinity, sum = 0;
  for (const v of field) if (Number.isFinite(v)) { n++; sum += v; if (v < mn) mn = v; if (v > mx) mx = v; }

  fs.writeFileSync(base + '.bin', Buffer.from(field.buffer));
  fs.writeFileSync(base + '.json', JSON.stringify({
    tag, model, pose, res, ply, rung, keep: ply >= 1 ? keep : null,
    extent: half, cx, cy, half, boardEdge: E, cell, crossEps: eng.CFG.crossEps,
    kind: info.kind, params: info.params, sizes: info.sizes,
    live: n, min: mn, max: mx, mean: sum / n, seconds: secs, decidedWin, decidedLoss,
    opponent: ref.op, meRot: ref.meRot, active: ref.active,
  }, null, 1));
  for (const f of [base + '.part.bin', base + '.part.json']) if (fs.existsSync(f)) fs.unlinkSync(f);
  console.log(`\r  done ${secs.toFixed(0)}s  live=${n}  range=[${mn.toFixed(4)}, ${mx.toFixed(4)}]  -> ${base}.bin`);
}
