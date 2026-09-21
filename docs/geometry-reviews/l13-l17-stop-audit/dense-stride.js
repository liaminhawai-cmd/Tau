'use strict';
// Opus task A, step 3: audit internal L17's dense-check stride, budget and early exits.
//
// Run: node dense-stride.js /path/to/a/checkout/with/L17 [--n 100] [--corpus <file>] [--json out]
//
// For each sampled position it computes three things and compares them:
//   truth    -- every stop the side to move can reach on its six arms, sampled at 0.25 degrees,
//               classified by ladderDeadEscape's OWN punishment test (can the attacker throw it
//               with one of its six swing-to-the-jam answers). This is the escape set the dense
//               test is trying to detect.
//   shipped  -- ladderDeadEscape exactly as it ships (mark when `a - lastMark >= step`).
//   tolerant -- the same function with the mark comparison given a 1e-9 rad tolerance.
//
// The two differ because |netRad| is accumulated through applySwing's substep loop and lands a few
// ULPs BELOW the nominal multiple of the 3-degree call, so an exact `>=` drops the mark and the
// stride silently becomes 9 degrees instead of 6 at those points.
const fs = require('fs'), path = require('path'), Module = require('module');
const DEG = 180 / Math.PI;

const WANT = ['ladderScore3', 'ladderRestore', 'ladderOppReplies', 'ladderDeadEscape', 'DEAD_STATS',
  'HARD_WIN_BONUS', 'HARD_MIN_MOVE_RAD', 'AI_STEP_RAD', 'AI_SAFETY_CAP_RAD'];

function build(root) {
  const enginePath = path.resolve(root, 'nn/engine.js');
  const indexPath = path.resolve(root, 'index.html');
  const indexSrc = fs.readFileSync(indexPath, 'utf8');
  const has = n => new RegExp(`^(?:function\\s*\\*?|class|const|let)\\s+${n}\\b`, 'm').test(indexSrc);
  const present = WANT.filter(has);
  if (!has('ladderDeadEscape')) throw new Error(`${root} has no ladderDeadEscape -- internal L17 is not in this checkout`);

  const markNeedle = 'if (a-lastMark >= step && a >= HARD_MIN_MOVE_RAD && !G.pieces[victim].anyFootOff()){';
  if (indexSrc.split(markNeedle).length - 1 !== 1) throw new Error('dense-check mark line not found exactly once');
  let patchedIndex = indexSrc
    .replace(markNeedle, 'if (a-lastMark >= step-(REC.markEps||0) && a >= HARD_MIN_MOVE_RAD && !G.pieces[victim].anyFootOff()){')
    .replace('lastMark=a; stops.push({pivotIdx:pv,dir,targetRad:a,snap:takeSnap()}); }',
             'lastMark=a; stops.push({pivotIdx:pv,dir,targetRad:a,snap:takeSnap()}); REC.marks=(REC.marks||0)+1; }');

  let src = fs.readFileSync(enginePath, 'utf8')
    .replace('const SEEDS = [', `const SEEDS = [${present.map(n => `'${n}',`).join('')}`)
    .replace('if (cached.key === cacheKey', 'if (false && cached.key === cacheKey')
    .replace('fs.writeFileSync(ENGINE_CACHE_PATH,', 'false && fs.writeFileSync(ENGINE_CACHE_PATH,')
    .replace('const sandbox = { Math, console };',
             'const sandbox = { Math, console, REC: (globalThis.__TAU_REC = globalThis.__TAU_REC || {}) };')
    .replace('__exports = {', `__exports = {${present.map(n => `${n},`).join('')}`);

  const realRead = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) {
    if (typeof p === 'string' && path.resolve(p) === indexPath) return patchedIndex;
    return realRead.call(this, p, ...rest);
  };
  let E;
  try {
    const m = new Module(enginePath, module);
    m.filename = enginePath; m.paths = Module._nodeModulePaths(path.dirname(enginePath));
    m._compile(src, enginePath);
    E = m.exports.createEngine();
  } finally { fs.readFileSync = realRead; }
  return { E, REC: globalThis.__TAU_REC };
}

function main() {
  const root = path.resolve(process.argv[2] || process.cwd());
  const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const N = +argOf('--n', 100);
  const corpus = argOf('--corpus', path.join(root, 'docs/dead-regions/screened-not-dead.jsonl'));
  // Optional: restrict to one side of the frozen split (see freeze-sets.js). Measuring on `dev` and
  // leaving `held-out` untouched is what keeps a later held-out number honest.
  const wantSplit = argOf('--split', null);
  let splitMap = null;
  if (wantSplit) splitMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'frozen-sets.json'), 'utf8')).split;
  const familyOf = g => {
    if (!g) return '(no id)';
    let m = /^(.*)-j\d+-\d+-\d+$/.exec(g); if (m) return m[1];
    m = /^(.*)-\d+$/.exec(g);               if (m) return m[1];
    return g;
  };
  const { E, REC } = build(root);

  const rows = [];
  for (const line of fs.readFileSync(corpus, 'utf8').split('\n')) {
    if (line[0] !== '{') continue;
    const j = JSON.parse(line);
    if (!Array.isArray(j.p) || j.p.length !== 6) continue;
    if (j.mover !== 0 && j.mover !== 1) continue;
    if (splitMap && splitMap[familyOf(j.g)] !== wantSplit) continue;
    rows.push(j);
  }
  // deterministic even spread across the file rather than the first N, which are one game's family
  const pick = [];
  for (let i = 0; i < Math.min(N, rows.length); i++) pick.push(rows[Math.floor(i * rows.length / Math.min(N, rows.length))]);

  const load = r => {
    E.newGame(); const g = E.getG();
    g.pieces.forEach((q, i) => { q.x = r.p[3 * i]; q.y = r.p[3 * i + 1]; q.rot = r.p[3 * i + 2]; });
    g.active = r.mover; return g;
  };

  const out = { checkout: root, corpus, split: wantSplit || 'all', sampled: pick.length, positions: [] };
  for (const r of pick) {
    const victim = r.mover, att = 1 - victim;
    const punished = () => {
      const s1 = E.takeSnap(); let hit = false;
      for (let ap = 0; ap < 3 && !hit; ap++) for (const ad of [1, -1]) {
        E.ladderRestore(s1); E.setActive(att);
        const anet = E.simMoveToLimit(ap, ad);
        if (Math.abs(anet) < E.HARD_MIN_MOVE_RAD) continue;
        if (E.getG().pieces[att].anyFootOff()) continue;
        if (E.getG().pieces[victim].anyFootOff()) { hit = true; break; }
      }
      return hit;
    };
    // arm limits, swept the way the searches sweep
    const lim = {};
    for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
      load(r); E.pinFoot(pv); const G = E.getG(); let g = 0;
      while (Math.abs(G.netRad) < E.AI_SAFETY_CAP_RAD && !G.atLimit && g++ < 500) E.applySwing(dir * E.AI_STEP_RAD);
      lim[`${pv},${dir}`] = Math.abs(G.netRad);
    }
    // truth at 0.25 degrees, replayed with the searches' own 3-degree call schedule
    let truthEscapes = 0, firstTruth = null;
    for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
      const L = lim[`${pv},${dir}`] * DEG;
      for (let deg = 2; deg <= L + 1e-9; deg = +(deg + 0.25).toFixed(6)) {
        load(r); E.pinFoot(pv);
        const G = E.getG(); const target = deg / DEG; let g = 0;
        while (!G.atLimit && Math.abs(G.netRad) < target - 1e-12 && g++ < 5000)
          E.applySwing(dir * Math.min(E.AI_STEP_RAD, target - Math.abs(G.netRad)));
        if (Math.abs(G.netRad) < E.HARD_MIN_MOVE_RAD) continue;
        if (Math.abs(Math.abs(G.netRad) * DEG - deg) > 1e-6) continue;
        if (G.pieces[victim].anyFootOff()) continue;
        const esc = G.pieces[att].anyFootOff() ? true : !punished();
        if (esc) { truthEscapes++; if (!firstTruth) firstTruth = { pivotIdx: pv, dir, deg }; }
      }
    }
    const run = eps => {
      load(r); REC.markEps = eps; REC.marks = 0;
      for (const k of Object.keys(E.DEAD_STATS)) if (typeof E.DEAD_STATS[k] === 'number' && k.indexOf('nearest') !== 0) E.DEAD_STATS[k] = 0;
      const esc = E.ladderDeadEscape(victim, 6, 160);
      return { marks: REC.marks, budgetOut: E.DEAD_STATS.budgetOut,
               found: !!esc, at: esc ? { pivotIdx: esc.pivotIdx, dir: esc.dir, deg: Math.abs(esc.targetRad) * DEG } : null };
    };
    const shipped = run(0), tolerant = run(1e-9);
    out.positions.push({ g: r.g, k: r.k, mover: r.mover, status: r.status,
                         truthEscapes, firstTruth, shipped, tolerant });
  }

  const agg = { sampled: out.positions.length };
  const has = p => p.truthEscapes > 0;
  agg.withEscapes = out.positions.filter(has).length;
  agg.shippedFound = out.positions.filter(p => has(p) && p.shipped.found).length;
  agg.tolerantFound = out.positions.filter(p => has(p) && p.tolerant.found).length;
  agg.shippedMissed = agg.withEscapes - agg.shippedFound;
  agg.tolerantMissed = agg.withEscapes - agg.tolerantFound;
  agg.verdictDiffers = out.positions.filter(p => p.shipped.found !== p.tolerant.found).length;
  agg.marksShipped = out.positions.reduce((a, p) => a + p.shipped.marks, 0);
  agg.marksTolerant = out.positions.reduce((a, p) => a + p.tolerant.marks, 0);
  agg.falseDeadRateShipped = agg.withEscapes ? agg.shippedMissed / agg.withEscapes : null;
  agg.falseDeadRateTolerant = agg.withEscapes ? agg.tolerantMissed / agg.withEscapes : null;
  agg.budgetOutShipped = out.positions.filter(p => p.shipped.budgetOut > 0).length;
  out.summary = agg;

  const j = argOf('--json', null);
  if (j) { fs.writeFileSync(j, JSON.stringify(out, null, 1) + '\n'); console.error(`wrote ${j}`); }
  console.log(JSON.stringify(agg, null, 2));
}
main();
