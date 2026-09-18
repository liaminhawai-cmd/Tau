'use strict';
// node nn/physics-check.js [--ref <commit>] [--poses n] [--moves n] [--seed n]
//
// The push physics in index.html (resolvePush, arcClosest, Piece.legArcs) and its restatement in
// contact-law.js carry exact prunes: a piece-level distance gate, a flat chord pre-pass before any
// 3D arc is built, a bounding-sphere skip inside the 144-segment-pair loop, a trig table for the
// arc points, and arcs built lazily from the iteration-start pose. Each prune only skips work whose
// answer is already known, so the pushes must come out bit for bit the same as the plain code.
// This check proves that against the plain code itself: it rebuilds the engine and the contact law
// from an older commit (default: the last one before the prunes) and compares
//   1. every applySwing call of 3-degree sweeps from real positions, both pieces' poses, netRad,
//      atLimit and limitReason;
//   2. the ladder AI's plans (levels 8 and 11) and the net's plan, with Math.random seeded the same
//      way on both sides;
//   3. the contact law's swing, replica and ideal constants, trace, record and gap included.
// Exits 1 on any difference. Run it after any change to the push physics or to the contact law.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const REF = opt('--ref', '3feaf1392'), NPOSE = +opt('--poses', 60), NMOVE = +opt('--moves', 8);
let seed = +opt('--seed', 99); const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const NN = __dirname, ROOT = path.join(NN, '..');

// the reference tree: index.html and contact-law.js from the older commit, today's engine.js and
// opening.js beside them so only the physics differs
const refDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tau-physics-ref-')), refNN = path.join(refDir, 'nn');
fs.mkdirSync(refNN);
const show = f => cp.execFileSync('git', ['-C', ROOT, 'show', `${REF}:${f}`], { maxBuffer: 1 << 28 });
fs.writeFileSync(path.join(refDir, 'index.html'), show('index.html'));
fs.writeFileSync(path.join(refNN, 'contact-law.js'), show('nn/contact-law.js'));
for (const f of ['engine.js', 'opening.js']) fs.copyFileSync(path.join(NN, f), path.join(refNN, f));
process.on('exit', () => { try { fs.rmSync(refDir, { recursive: true, force: true }); } catch (e) { /* leave it */ } });

const eRef = require(path.join(refNN, 'engine.js')).createEngine(), eNew = require(path.join(NN, 'engine.js')).createEngine();
const lawRef = require(path.join(refNN, 'contact-law.js')), lawNew = require(path.join(NN, 'contact-law.js'));
const { MLP } = require(path.join(NN, 'net.js')), { nnPlanFor } = require(path.join(NN, 'nnai.js'));
const modelPath = ['best.json', 'value.json'].map(f => path.join(NN, 'models', f)).find(fs.existsSync);
const net = modelPath ? MLP.fromJSON(JSON.parse(fs.readFileSync(modelPath, 'utf8'))) : null;

// real positions from the game records
const files = fs.readdirSync(path.join(NN, 'data')).filter(f => /^(batch|retro).*\.jsonl$/.test(f)).sort();
if (!files.length) { console.error('no nn/data/*.jsonl game files to draw positions from'); process.exit(2); }
const poses = [];
while (poses.length < NPOSE) {
  const f = files[Math.floor(rnd() * files.length)];
  const L = fs.readFileSync(path.join(NN, 'data', f), 'utf8').split('\n').filter(l => l[0] === '{');
  const r = JSON.parse(L[Math.floor(rnd() * L.length)]); if (r.p && r.p.length === 6) poses.push(r.p);
}
const set = (e, p, idx) => { e.newGame(); const g = e.getG(); g.pieces.forEach((q, i) => { q.x = p[i * 3]; q.y = p[i * 3 + 1]; q.rot = p[i * 3 + 2]; }); g.active = idx; return g; };
const pose = g => g.pieces.map(q => [q.x, q.y, q.rot]).flat().concat([g.netRad, g.atLimit ? 1 : 0]);
const ms = (ns, n) => (Number(ns) / 1e6 / n).toFixed(3);
let failed = 0;

// 1. sweeps, every 3-degree call compared
{
  let calls = 0, bad = 0, moved = 0, t1 = 0n, t2 = 0n;
  for (const p of poses) for (const idx of [0, 1]) for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
    const g1 = set(eRef, p, idx), g2 = set(eNew, p, idx); eRef.pinFoot(pv); eNew.pinFoot(pv); let guard = 0;
    while (!g1.atLimit && Math.abs(g1.netRad) < 170 * Math.PI / 180 && guard++ < 200) {
      const o = g1.pieces[1 - idx].x;
      let t = process.hrtime.bigint(); eRef.applySwing(dir * 3 * Math.PI / 180); t1 += process.hrtime.bigint() - t;
      t = process.hrtime.bigint(); eNew.applySwing(dir * 3 * Math.PI / 180); t2 += process.hrtime.bigint() - t;
      calls++; if (g1.pieces[1 - idx].x !== o) moved++;
      const a = pose(g1), b = pose(g2);
      if (a.some((v, i) => v !== b[i]) || g1.limitReason !== g2.limitReason) { bad++; if (bad <= 5) console.log('DIFF sweep', JSON.stringify(p), idx, pv, dir, a, b); }
    }
  }
  failed += bad;
  console.log(`sweeps: ${calls} applySwing calls (${moved} moved the other piece), ${bad} differences; ref ${ms(t1, calls)} ms/call, new ${ms(t2, calls)} ms/call (${(Number(t1) / Number(t2)).toFixed(2)}x)`);
}
// 2. brains, with Math.random seeded the same way for both runs
{
  const realRandom = Math.random; let rs = 0; const seededRandom = () => (rs = (rs * 1103515245 + 12345) % 2147483648) / 2147483648;
  const brains = { 'L8': (e, idx) => e.ladderPlanFor(7, idx), 'L11': (e, idx) => e.ladderPlanFor(10, idx) };
  if (net) brains['net d1'] = (e, idx) => nnPlanFor(e, net, idx, { temperature: 0, depth: 1, keepForDepth: 4 });
  const M = Math.min(poses.length, NMOVE);
  for (const [name, fn] of Object.entries(brains)) {
    let diffs = 0, moves = 0, tt1 = 0n, tt2 = 0n;
    for (const p of poses.slice(0, M)) for (const idx of [0, 1]) {
      Math.random = seededRandom; rs = 7; set(eRef, p, idx); let t = process.hrtime.bigint(); const a = fn(eRef, idx); tt1 += process.hrtime.bigint() - t;
      rs = 7; set(eNew, p, idx); t = process.hrtime.bigint(); const b = fn(eNew, idx); tt2 += process.hrtime.bigint() - t;
      Math.random = realRandom; moves++;
      if (JSON.stringify(a) !== JSON.stringify(b)) { diffs++; if (diffs <= 3) console.log('DIFF plan', name, JSON.stringify(p), idx, JSON.stringify(a), JSON.stringify(b)); }
    }
    failed += diffs;
    console.log(`${name}: ${moves} moves, ${diffs} plan differences; ref ${ms(tt1, moves)} ms/move, new ${ms(tt2, moves)} ms/move (${(Number(tt1) / Number(tt2)).toFixed(2)}x)`);
  }
}
// 3. the contact law's swing, replica and ideal constants
{
  let n = 0, bad = 0, t1 = 0n, t2 = 0n, pushed = 0;
  for (const K of [lawRef.REPLICA, { ...lawRef.IDEAL, stepDeg: 0.4 }]) for (const p of poses) for (const idx of [0, 1]) for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
    const pieces = [{ x: p[0], y: p[1], rot: p[2] }, { x: p[3], y: p[4], rot: p[5] }], rad = (20 + 60 * rnd()) * Math.PI / 180;
    let t = process.hrtime.bigint(); const a = lawRef.swing(pieces, idx, pv, dir, rad, { ...K, trace: true, record: true, gap: true }); t1 += process.hrtime.bigint() - t;
    t = process.hrtime.bigint(); const b = lawNew.swing(pieces, idx, pv, dir, rad, { ...K, trace: true, record: true, gap: true }); t2 += process.hrtime.bigint() - t;
    n++; if (a.opp.x !== pieces[1 - idx].x || a.opp.rot !== pieces[1 - idx].rot) pushed++;
    const ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja !== jb) { bad++; if (bad <= 3) console.log('DIFF law', K === lawRef.REPLICA ? 'replica' : 'ideal', JSON.stringify(p), idx, pv, dir, ja.slice(0, 300), '\n   ', jb.slice(0, 300)); }
  }
  failed += bad;
  console.log(`contact law: ${n} sweeps (${pushed} pushed the other piece), ${bad} differences; ref ${ms(t1, n)} ms/sweep, new ${ms(t2, n)} ms/sweep (${(Number(t1) / Number(t2)).toFixed(2)}x)`);
}
console.log(failed ? `FAIL: ${failed} differences against ${REF}` : `OK: identical to ${REF}`);
process.exit(failed ? 1 : 0);
