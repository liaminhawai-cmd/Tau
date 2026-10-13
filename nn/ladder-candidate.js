// Does the champion belong on the ladder's top rung?
//
//   node nn/ladder-candidate.js [--net nn/models/best.json] [--rungs 14,13,12] [--depth 3] [--keep 4]
//                               [--games 1] [--name best-ckpt-NNN]
//
// The champion plays each listed menu rung AS RED (the weak seat: rung 10 and the old rung 14 beat
// every net we tried there), at the same face the top rung ships at. If it wins every one it is a
// CANDIDATE: its weights are exported to nn/ladder-candidates/<name>.{bin,meta.json} and the verdict
// goes to nn/ladder-candidate.json. Nothing in the shipped game changes by itself -- swapping the
// rung is a pull request against index.html (see the Tau repo's rung-14 swap), reviewed by a person.
//
// Menu rungs are mapped to AI_LADDER indices with index.html's RUNG_TO_AI_LADDER, so the check always
// tests what players actually meet. A checkout whose index.html predates that map is skipped.
// Game 0 of the arena has A as Blue, so the rung is --a and the champion --b: one game = one Red game.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function arg(name, dflt) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; }

function rungMap(html) {
  const m = /RUNG_TO_AI_LADDER\s*=\s*\[([^\]]+)\]/.exec(html);
  return m ? m[1].split(',').map(s => +s.trim()) : null;
}

function check(opts = {}) {
  const dir = opts.dir || __dirname;
  const log = opts.log || console.log;
  const net = opts.net || path.join(dir, 'models', 'best.json');
  const rungs = (opts.rungs || '14,13,12').toString().split(',').map(Number);
  const depth = opts.depth || 3, keep = opts.keep || 4, games = opts.games || 1;
  const name = opts.name || 'best-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  let html = '';
  try { html = fs.readFileSync(path.join(dir, '..', 'index.html'), 'utf8'); } catch (e) {}
  const map = rungMap(html);
  if (!map) { log('ladder check skipped: index.html has no RUNG_TO_AI_LADDER (merge main into this checkout)'); return null; }
  if (!fs.existsSync(net)) { log(`ladder check skipped: ${net} not found`); return null; }
  // Already played? The record is keyed by the weights' hash plus the faces tested (rung -> ladder
  // index, depth, keepStops, games), so the same net is never re-run against the same rungs, while a
  // changed rung, face or game count counts as new. A re-promotion of identical weights is skipped.
  const hash = crypto.createHash('sha1').update(fs.readFileSync(net)).digest('hex').slice(0, 16);
  const key = hash + '|' + rungs.map(r => r + ':' + map[r - 1]).join(',') + `|D${depth}k${keep}g${games}`;
  const donePath = path.join(dir, 'ladder-checked.json');
  let done = {};
  try { done = JSON.parse(fs.readFileSync(donePath, 'utf8')); } catch (e) {}
  if (done[key]) { log(`ladder check skipped: ${name} already played rungs ${rungs.join('/')} at D${depth} (${done[key].name}, ${done[key].pass ? 'candidate' : 'not a candidate'})`); return null; }
  const results = [];
  for (const rung of rungs) {
    const L = map[rung - 1] + 1;           // arena's L<n> is AI_LADDER[n-1]
    const resFile = path.join(dir, 'arena-logs', `.ladder-check-${process.pid}-${rung}.jsonl`);
    try { fs.unlinkSync(resFile); } catch (e) {}
    let w = 0, l = 0, d = 0;
    // each game is one Red game for the champion; --openingPlies adds variety when games > 1
    for (let g = 0; g < games; g++) {
      const r = spawnSync(process.execPath, [path.join(dir, 'arena.js'),
        '--a', 'L' + L, '--b', 'nn:0:' + net, '--depthB', String(depth), '--keepB', String(keep),
        '--games', '1', '--openingPlies', games > 1 ? '2' : '0', '--resultsJsonl', resFile],
        { encoding: 'utf8', timeout: 45 * 60 * 1000 });
      if (r.status !== 0) { log(`ladder check: arena failed vs rung ${rung}: ${(r.stderr || '').split('\n')[0]}`); }
    }
    try {
      for (const ln of fs.readFileSync(resFile, 'utf8').split('\n')) {
        if (!ln.trim()) continue;
        const o = JSON.parse(ln);
        if (o.outcome === 'B') w++; else if (o.outcome === 'A') l++; else d++;
      }
      fs.unlinkSync(resFile);
    } catch (e) {}
    results.push({ rung, ladderIndex: L - 1, w, l, d });
  }
  const pass = results.length > 0 && results.every(r => r.l === 0 && r.d === 0 && r.w >= 1);
  const verdict = { at: new Date().toISOString(), name, net, face: `D${depth} keep ${keep}`, asRed: results, pass };
  done[key] = { name, at: verdict.at, pass };
  fs.writeFileSync(donePath, JSON.stringify(done, null, 1));
  fs.writeFileSync(path.join(dir, 'ladder-candidate.json'), JSON.stringify(verdict, null, 1));
  log(`ladder check ${name}@D${depth} as Red: ` + results.map(r => `rung ${r.rung} ${r.w}-${r.l}-${r.d}`).join(', ') +
      (pass ? ' -- CANDIDATE for the top rung' : ' -- not a candidate'));
  if (pass) {
    const out = path.join(dir, 'ladder-candidates', name);
    const r = spawnSync(process.execPath, [path.join(dir, 'export-committee-net.js'), net, out], { encoding: 'utf8' });
    if (r.status !== 0) log('ladder check: export failed: ' + (r.stderr || '').split('\n')[0]);
  }
  return verdict;
}

module.exports = { check };
if (require.main === module) {
  check({ net: arg('net', null), rungs: arg('rungs', '14,13,12'), depth: +arg('depth', 3), keep: +arg('keep', 4),
          games: +arg('games', 1), name: arg('name', null) });
}
