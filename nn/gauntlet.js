'use strict';
// Fixed reference matches for experimental models, OUTSIDE the live league. An experiment arm
// must never enter the shared Elo pool (it would eat the league's measurement budget and the
// roster would adopt it as a face), so this plays a dedicated, identical match set for each
// candidate instead: colour-balanced temp-0 arena games against fixed opponents -- by default
// best.json, L10 and L11, the exact yardsticks the project cares about.
//
//   node nn/gauntlet.js --models nn/experiments/x/arm-1.json,nn/experiments/x/arm-0.json
//                       [--opponents best,L10,L11] [--games 24] [--depths 1,2] [--workers 3]
//                       [--out nn/experiments/x/gauntlet.json]
//
// Candidates play at each depth in --depths; an nn opponent plays at the same depth (like for
// like), a ladder opponent plays its native game. Results are the arena's own summary numbers --
// no Elo fit, just per-opponent scores every arm shares, which is what an ablation needs.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const dir = __dirname;
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };

const models = String(arg('models', arg('model', ''))).split(',').map(s => s.trim()).filter(Boolean);
const oppSpecs = String(arg('opponents', 'best,L10,L11')).split(',').map(s => s.trim()).filter(Boolean);
const games = Math.max(2, +arg('games', 24) & ~1);   // even: arena alternates colours per game
const depths = String(arg('depths', '1,2')).split(',').map(Number).filter(d => d >= 1 && d <= 4);
const workers = Math.max(1, +arg('workers', 3));
const openingPlies = Math.max(0, +arg('openingPlies', 4));
const outPath = arg('out', null);

function opponent(spec) {
  if (/^L\d+$/i.test(spec)) return { id: spec.toUpperCase(), spec: spec.toUpperCase(), ladder: true };
  const p = spec === 'best' ? path.join(dir, 'models', 'best.json') : path.resolve(spec);
  return { id: path.basename(p, '.json'), spec: `nn:0:${p}`, ladder: false, path: p };
}

function jobList() {
  const jobs = [];
  for (const m of models) {
    const mp = path.resolve(m);
    if (!fs.existsSync(mp)) { console.error(`[gauntlet] missing model: ${mp}`); continue; }
    const name = path.basename(mp, '.json');
    for (const d of depths) for (const os of oppSpecs) {
      const o = opponent(os);
      if (!o.ladder && !fs.existsSync(o.path)) { console.error(`[gauntlet] missing opponent: ${o.path}`); continue; }
      jobs.push({ name, model: mp, depth: d, opp: o });
    }
  }
  return jobs;
}

function play(job) {
  const args = [path.join(dir, 'arena.js'),
    '--a', `nn:0:${job.model}`, '--depthA', String(job.depth),
    '--b', job.opp.spec, ...(job.opp.ladder ? [] : ['--depthB', String(job.depth)]),
    '--games', String(games), '--openingPlies', String(openingPlies),
    '--idA', `${job.name}@D${job.depth}`, '--idB', job.opp.ladder ? job.opp.id : `${job.opp.id}@D${job.depth}`];
  return new Promise(resolve => execFile(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 24 },
    (err, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr);
      // Same summary-line parse elorank-legacy.js relies on. `% of decided` already folds komi
      // wins at their discounted value, so it is the honest single score for a fixed match set.
      const m = [...String(stdout || '').matchAll(/:\s*(\d+)-(\d+)(?:-(\d+))?\s+\((?:komi (\d+)-(\d+), )?(\d+)% of decided/g)];
      if (err || !m.length) { console.error(`[gauntlet] no result: ${job.name}@D${job.depth} vs ${job.opp.id}`); return resolve(null); }
      const q = m.at(-1);
      resolve({ name: job.name, depth: job.depth, opp: job.opp.id, games,
                w: +q[1], l: +q[2], d: +(q[3] || 0), komiW: +(q[4] || 0), komiL: +(q[5] || 0),
                decidedPct: +q[6] });
    }));
}

async function main() {
  const jobs = jobList();
  if (!jobs.length) { console.error('[gauntlet] nothing to play; pass --models'); process.exitCode = 1; return; }
  console.log(`[gauntlet] ${jobs.length} pairings x ${games} games, ${workers} parallel`);
  const results = [];
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      console.log(`[gauntlet] ${job.name}@D${job.depth} vs ${job.opp.id} (${games} games)...`);
      const r = await play(job);
      if (r) { results.push(r); console.log(`[gauntlet]   -> ${r.w}-${r.l}${r.d ? '-' + r.d : ''}` +
        (r.komiW + r.komiL ? ` (komi ${r.komiW}-${r.komiL})` : '') + `, ${r.decidedPct}% of decided`); }
    }
  };
  await Promise.all(Array.from({ length: workers }, lane));

  console.log('\n=== gauntlet ===');
  console.log('candidate            depth  opponent        W-L-D (komi)   decided%');
  for (const r of results.sort((a, b) => a.name.localeCompare(b.name) || a.depth - b.depth || a.opp.localeCompare(b.opp)))
    console.log(`${r.name.padEnd(20)} D${r.depth}     ${r.opp.padEnd(15)} ` +
                `${`${r.w}-${r.l}-${r.d}`.padEnd(9)}${(r.komiW + r.komiL ? `(${r.komiW}-${r.komiL})` : '').padEnd(6)} ${r.decidedPct}%`);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), games, depths, results }, null, 1));
    console.log(`[gauntlet] saved ${outPath}`);
  }
}
main().catch(e => { console.error('[gauntlet] failed:', e.stack || e.message); process.exitCode = 1; });
