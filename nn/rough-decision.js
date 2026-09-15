// Does the structure BELOW the engine's epsilon change what a net actually does?
//
// This is the behavioural test, and it is sharper than playing games. crossEps (0.81u) is the
// distance below which the rules cannot tell two poses apart: a foot moved by less than that
// crosses nothing it would not otherwise cross. So take the net's own evaluator and blur it over a
// disc of that radius. Everything coarser than epsilon survives the blur untouched; everything
// finer is averaged away. Then run the SAME search twice, once on the raw evaluator and once on
// the blurred one, and ask whether the net picks a different move.
//
//   move unchanged  ->  the sub-epsilon detail was decorative; the decision rode on coarser structure
//   move changed    ->  the net's choice is being steered by detail finer than the rules can resolve
//
// A changed move is not automatically a bad move -- the blur is a crude instrument and averaging
// costs real information near a genuine cliff. What makes the number interpretable is COMPARISON:
// between nets of different capacity on identical poses, and between rough and smooth regions of
// the same net's own map. A net whose decisions are driven by sub-epsilon structure far more often
// than its peers' is the signature the study is looking for.
'use strict';
const fs = require('fs');
const { createEngine } = require('./engine.js');
const { features } = require('./features.js');
const { loadValueNet } = require('./load-value-net.js');
const { nnPlanFor } = require('./nnai.js');

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const modelPath = arg('model', 'nn/models/best.json');
const posesFile = arg('poses', null);
const depth = +arg('depth', 1);
const limit = +arg('limit', 0);
const tag = arg('tag', modelPath);

if (!posesFile) { console.error('need --poses <file>'); process.exit(1); }
const poses = JSON.parse(fs.readFileSync(posesFile, 'utf8'));

const eng = createEngine();
eng.newGame();
const info = loadValueNet(modelPath);
const EPS = eng.CFG.crossEps;

// A fixed, deterministic blur stencil: two rings inside the epsilon disc plus the centre. Fixed
// rather than random so every model and every pose is blurred by exactly the same operator --
// a resampled stencil would add its own variance to the very thing being measured.
const STENCIL = [[0, 0]];
for (const [rad, k] of [[EPS * 0.5, 6], [EPS, 6]])
  for (let i = 0; i < k; i++) {
    const a = 2 * Math.PI * i / k + (rad > EPS * 0.6 ? Math.PI / k : 0);
    STENCIL.push([rad * Math.cos(a), rad * Math.sin(a)]);
  }

// The net as-is, matching nnai's default evaluator contract exactly (score for `side`, whoever's
// turn it is).
const rawEval = (e, side) => {
  const v = info.value(features(e));
  return e.getG().active === side ? v : -v;
};

// The same evaluator, averaged over the stencil applied to the moving side's hub.
const blurEval = (e, side) => {
  const g = e.getG(), p = g.pieces[side];
  const ox = p.x, oy = p.y;
  let s = 0;
  for (const [dx, dy] of STENCIL) { p.x = ox + dx; p.y = oy + dy; s += info.value(features(e)); }
  p.x = ox; p.y = oy;
  const v = s / STENCIL.length;
  return g.active === side ? v : -v;
};

const setPose = P => {
  eng.newGame();
  const G = eng.getG();
  const put = (pc, q) => { pc.x = q.x; pc.y = q.y; pc.rot = q.rot; };
  put(G.pieces[0], P.blue); put(G.pieces[1], P.red);
  G.turnDir = 0; G.crossings = 0; G.atLimit = false; G.netRad = 0; G.contact = null;
  eng.setActive(P.active | 0);
};

const same = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  // Same arm, and a stopping angle inside one sweep step -- a sub-step difference is the search
  // resolution, not a different idea about the position.
  return a.pivotIdx === b.pivotIdx && a.dir === b.dir &&
         Math.abs(a.targetRad - b.targetRad) < 3.01 * Math.PI / 180;
};

const N = limit ? Math.min(limit, poses.length) : poses.length;
let changed = 0, armChanged = 0, done = 0, sumAngle = 0;
// Per-pose outcomes, because rough-poses.js emits the two sets as MATCHED PAIRS: rough[i] and
// smooth[i] are the same position geometrically and differ in the net's roughness. Throwing that
// pairing away and comparing two rates treats matched data as independent, which is both wrong and
// weaker than the paired test the design already paid for.
const per = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  setPose(poses[i]);
  const idx = eng.getG().active;
  const a = nnPlanFor(eng, null, idx, { depth, evalFn: rawEval });
  setPose(poses[i]);
  const b = nnPlanFor(eng, null, idx, { depth, evalFn: blurEval });
  done++;
  const ch = !same(a, b);
  const armCh = !!(a && b && (a.pivotIdx !== b.pivotIdx || a.dir !== b.dir));
  const dAng = a && b ? Math.abs(a.targetRad - b.targetRad) * 180 / Math.PI : 0;
  if (ch) changed++;
  if (armCh) armChanged++;
  sumAngle += dAng;
  per.push({ i, changed: ch, armChanged: armCh, dAngleDeg: dAng });
  process.stdout.write(`\r  ${done}/${N}  changed ${changed}  ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
}
const pct = 100 * changed / done, armPct = 100 * armChanged / done;
console.log(`\r${tag}  (${info.params} params, ${info.kind})`);
console.log(`  poses ${done}   move changed by the epsilon blur: ${changed} (${pct.toFixed(1)}%)` +
            `   arm changed: ${armChanged} (${armPct.toFixed(1)}%)` +
            `   mean |dAngle| ${(sumAngle / done).toFixed(2)} deg   ${((Date.now() - t0) / 1000).toFixed(0)}s`);
const out = { tag, model: modelPath, poses: posesFile, params: info.params,
              n: done, changed, changedPct: pct, armChanged, armChangedPct: armPct,
              meanAbsAngleDeg: sumAngle / done, per };
const saveTo = arg('save', null);
if (saveTo) fs.writeFileSync(saveTo, JSON.stringify(out));
console.log(JSON.stringify({ ...out, per: undefined }));
