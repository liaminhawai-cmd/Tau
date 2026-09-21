'use strict';
// The same dropped-mark defect as dense-stride.js, but at the site that is on production `main`:
// ladderRoots3 / ladderSampledPlanGen's `a - lastMark >= o.sampleDeg*Math.PI/180`. Measures whether
// giving that comparison a 1e-9 rad tolerance changes the move a rung plays.
//
// Run: node root-stride.js /path/to/checkout [--n 60] [--split dev] [--rungs 11,13] [--json out]
//
// Deterministic: rungs are called through ladderPlanRung, so the corner-opening coin is never
// tossed, and no rung measured here carries `noise`.
const fs = require('fs'), path = require('path'), Module = require('module');
const DEG = 180 / Math.PI;
const WANT = ['ladderPlanRung', 'ladderRoots3', 'ladderRestore', 'DEAD_STATS', 'HARD_MIN_MOVE_RAD'];
const NEEDLE = 'if (o.sampleDeg && a-lastMark >= o.sampleDeg*Math.PI/180 && a >= HARD_MIN_MOVE_RAD';
const FIXED  = 'if (o.sampleDeg && a-lastMark >= o.sampleDeg*Math.PI/180-(REC.markEps||0) && a >= HARD_MIN_MOVE_RAD';

function build(root) {
  const enginePath = path.resolve(root, 'nn/engine.js');
  const indexPath = path.resolve(root, 'index.html');
  const indexSrc = fs.readFileSync(indexPath, 'utf8');
  const sites = indexSrc.split(NEEDLE).length - 1;
  if (sites < 1) throw new Error('root sampler mark line not found');
  const has = n => new RegExp(`^(?:function\\s*\\*?|class|const|let)\\s+${n}\\b`, 'm').test(indexSrc);
  const present = WANT.filter(has);
  const patchedIndex = indexSrc.split(NEEDLE).join(FIXED);
  const src = fs.readFileSync(enginePath, 'utf8')
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
  return { E, REC: globalThis.__TAU_REC, sites };
}

const familyOf = g => {
  if (!g) return '(no id)';
  let m = /^(.*)-j\d+-\d+-\d+$/.exec(g); if (m) return m[1];
  m = /^(.*)-\d+$/.exec(g);              if (m) return m[1];
  return g;
};

function main() {
  const root = path.resolve(process.argv[2] || process.cwd());
  const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const N = +argOf('--n', 60), wantSplit = argOf('--split', null);
  const rungNums = String(argOf('--rungs', '11')).split(',').map(Number);
  const { E, REC, sites } = build(root);
  const splitMap = wantSplit ? JSON.parse(fs.readFileSync(path.join(__dirname, 'frozen-sets.json'), 'utf8')).split : null;

  const rows = [];
  for (const line of fs.readFileSync(path.join(root, 'docs/dead-regions/screened-not-dead.jsonl'), 'utf8').split('\n')) {
    if (line[0] !== '{') continue;
    const j = JSON.parse(line);
    if (!Array.isArray(j.p) || j.p.length !== 6) continue;
    if (j.mover !== 0 && j.mover !== 1) continue;
    if (splitMap && splitMap[familyOf(j.g)] !== wantSplit) continue;
    rows.push(j);
  }
  const pick = [];
  for (let i = 0; i < Math.min(N, rows.length); i++) pick.push(rows[Math.floor(i * rows.length / Math.min(N, rows.length))]);

  const out = { checkout: root, patchedSites: sites, split: wantSplit || 'all', positions: pick.length, rungs: [] };
  for (const n of rungNums) {
    const def = E.AI_LADDER[n - 1];
    if (!def) { out.rungs.push({ internal: `L${n}`, absent: true }); continue; }
    const tag = p => p ? `${p.pivotIdx}${p.dir > 0 ? '+' : '-'}@${(Math.abs(p.targetRad) * DEG).toFixed(4)}` : 'null';
    const play = eps => pick.map(r => {
      E.newGame(); const g = E.getG();
      g.pieces.forEach((q, i) => { q.x = r.p[3 * i]; q.y = r.p[3 * i + 1]; q.rot = r.p[3 * i + 2]; });
      g.active = r.mover; REC.markEps = eps;
      return tag(E.ladderPlanRung(def, r.mover));
    });
    const shipped = play(0), tolerant = play(1e-9);
    const diff = shipped.reduce((a, v, i) => a + (v === tolerant[i] ? 0 : 1), 0);
    out.rungs.push({
      internal: `L${n}`, kind: def.kind, label: def.label || null, sampleDeg: def.o && def.o.sampleDeg,
      movesChangedByFix: diff, changeRate: +(diff / shipped.length).toFixed(4),
      examples: pick.map((r, i) => ({ g: r.g, shipped: shipped[i], tolerant: tolerant[i] }))
                    .filter((_, i) => shipped[i] !== tolerant[i]).slice(0, 10),
    });
  }
  const j = argOf('--json', null);
  if (j) { fs.writeFileSync(j, JSON.stringify(out, null, 1) + '\n'); console.error(`wrote ${j}`); }
  const { rungs, ...head } = out;
  console.log(JSON.stringify({ ...head, rungs: rungs.map(({ examples, ...r }) => r) }, null, 2));
}
main();
