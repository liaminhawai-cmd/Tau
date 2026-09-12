'use strict';
// How a new population member is minted. A parent comes off the medal podium (gold half the
// time, silver a third, bronze the rest -- run.js draws it), then a random COMBINATION of edits is
// applied: usually one, sometimes two, occasionally three. Every edit is a real question the
// league can answer by rating the child against the field:
//   mutate   one hidden-layer size changed (mutateHidden), trained fresh
//   scratch  the parent's own shape, fresh init -- "was it the weights or the shape?"
//   skip     the dense-memory layer-skip topology added (or, on a parent that has it, removed or
//            re-sized) -- every layer sends a small packet straight to every later layer
//   extra    more epochs on the parent's own weights (or, in a fresh combo, a longer run)
//   recent   trained only on the newest rows -- "is old data from weaker players holding it back?"
//   policy   a joint value+policy head grown on the parent's trunk (a dual net); a dual parent
//            loses its head instead and its value trunk trains on alone
// Edits that need a fresh init (mutate/scratch/skip/policy) discard the parent's weights, so a
// combo that mixes them with extra/recent is a fresh run that is simply longer or on newer data.
// Pure and deterministic given `rnd`, so the distribution can be tested without training anything.
const OP_WEIGHTS = { mutate: .30, extra: .20, recent: .15, scratch: .12, skip: .13, policy: .10 };
const COUNT_WEIGHTS = [[1, .60], [2, .30], [3, .10]];
const MEMORY_WIDTHS = [4, 8, 16, 40];
const RESIDUAL_SCALE = 0.2;

function weightedPick(pairs, rnd) {
  let total = 0; for (const [, w] of pairs) total += w;
  let r = rnd()*total;
  for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][0];
}
function drawOps(rnd) {
  const n = weightedPick(COUNT_WEIGHTS, rnd);
  const left = Object.entries(OP_WEIGHTS), out = [];
  while (out.length < n && left.length) {
    const op = weightedPick(left, rnd);
    out.push(op); left.splice(left.findIndex(([k]) => k === op), 1);
  }
  return out;
}
const hiddenSizes = spec => String(spec).split(',').map(Number).filter(n => n > 0);
const dense = memoryWidth => ({ kind: 'dense-memory-v1', memoryWidth, residualScale: RESIDUAL_SCALE });

// parent: { name, file, shape, topo, dual }   topo: null | { memoryWidth, residualScale }
// ctx:    { scratchEpochs, epochs, dualEpochs, recentRows, mutateHidden }
function planMint(parent, ctx, rnd = Math.random) {
  const ops = new Set(drawOps(rnd));
  const notes = [];
  const drop = (op, why) => { if (ops.delete(op)) notes.push(`${op} dropped: ${why}`); };
  let hidden = parent.shape, topology = parent.topo || null, mode;
  if (ops.has('policy')) {
    if (parent.dual) {
      mode = 'strip';
      drop('mutate', 'a stripped trunk keeps its shape'); drop('scratch', 'strip resumes the trunk'); drop('skip', 'dual trunks are plain');
    } else {
      mode = 'dual';
      drop('skip', 'the dual trainer has no topology'); drop('recent', 'the dual trainer trains on policy targets');
      if (ops.has('mutate')) { const m = ctx.mutateHidden(hidden); if (m) { hidden = m.shape; notes.push(m.op); } else drop('mutate', 'no distinct edit found'); }
      if (topology) notes.push('skip packets dropped: the dual trainer has no topology');
      topology = null;
    }
  } else if (ops.has('mutate') || ops.has('scratch') || ops.has('skip')) {
    mode = 'fresh';
    if (ops.has('mutate')) { const m = ctx.mutateHidden(hidden); if (m) { hidden = m.shape; notes.push(m.op); } else drop('mutate', 'no distinct edit found'); }
    if (ops.has('skip')) {
      const sizes = hiddenSizes(hidden), narrowest = Math.min(...sizes);
      if (sizes.length < 2) drop('skip', 'needs two hidden layers');
      else if (!topology) {
        const fits = MEMORY_WIDTHS.filter(w => w <= narrowest);
        topology = dense(fits.length ? fits[Math.floor(rnd()*fits.length)] : narrowest);
        notes.push(`skip packets k=${topology.memoryWidth}`);
      } else if (rnd() < .5) { topology = null; notes.push('skip packets removed'); }
      else {
        const others = MEMORY_WIDTHS.filter(w => w <= narrowest && w !== topology.memoryWidth);
        topology = dense(others.length ? others[Math.floor(rnd()*others.length)] : Math.max(1, Math.min(narrowest, Math.round(topology.memoryWidth/2))));
        notes.push(`skip packets re-sized to k=${topology.memoryWidth}`);
      }
    }
    // A narrowed layer can undercut an inherited packet width; the trainer refuses that outright.
    if (topology) { const narrowest = Math.min(...hiddenSizes(hidden)); if (topology.memoryWidth > narrowest) topology = dense(narrowest); }
    if (!ops.size) return null;
  } else {
    mode = ops.has('recent') ? 'recent' : 'extra';
  }
  if (!ops.size) return null;
  const longer = ops.has('extra');
  const epochs = mode === 'dual' ? Math.round(ctx.dualEpochs*(longer ? 1.5 : 1))
               : mode === 'fresh' ? Math.round(ctx.scratchEpochs*(longer ? 1.5 : 1))
               : ctx.epochs;
  const recentRows = ops.has('recent') && mode !== 'dual' ? ctx.recentRows : 0;
  const kind = mode === 'fresh' ? 'mutant' : mode;      // extra | recent | dual | strip
  const prefix = kind;
  const opList = [...ops];
  const describe = () => {
    const top = t => t ? ` dense k${t.memoryWidth}` : '';
    const from = `${parent.name} [${parent.shape}${top(parent.topo)}${parent.dual ? ' dual' : ''}]`;
    const what = mode === 'strip' ? `policy head removed, trunk resumes ${epochs} epochs`
               : mode === 'dual' ? `policy head grown: dual ${hidden}, ${epochs} epochs fresh`
               : mode === 'fresh' ? `${hidden}${top(topology)}, ${epochs} epochs fresh`
               : `${epochs} more epochs on its own weights`;
    const data = recentRows ? ` on the newest ${recentRows} rows` : '';
    return `${from} -> ${opList.join('+')}: ${what}${data}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  };
  return { mode, kind, prefix, ops: opList, hidden, topology, epochs, recentRows,
           resumeFrom: mode === 'extra' || mode === 'recent' ? parent.file : null, notes, describe };
}

// A dual export is one trunk with 1 + N_ARMS + N_BINS outputs, output-major (dualnet.js): the value
// head is row 0 of the last layer. Keeping that row alone gives a plain value net over the same
// trunk -- the parent minus its policy head -- which then trains on as an ordinary resume.
function stripPolicyHead(doc) {
  if (!doc || doc.dual !== true || !Array.isArray(doc.sizes) || doc.sizes.length < 3) return null;
  const L = doc.sizes.length - 1, nIn = doc.sizes[L - 1];
  const W = doc.W.slice(0, L - 1).concat([doc.W[L - 1].slice(0, nIn)]);
  const b = doc.b.slice(0, L - 1).concat([doc.b[L - 1].slice(0, 1)]);
  return { sizes: doc.sizes.slice(0, L).concat([1]), W, b };
}

module.exports = { planMint, drawOps, stripPolicyHead, OP_WEIGHTS, COUNT_WEIGHTS, MEMORY_WIDTHS };
