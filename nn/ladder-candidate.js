// Does the champion earn a NEW rung above the current top?
//
//   node nn/ladder-candidate.js [--net nn/models/best.json] [--rungs all|14,13] [--depth 3] [--keep 4]
//                               [--games 1] [--name best-ckpt-NNN]
//
// The bar: beat EVERY rung currently on the menu, as Red and as Blue (top rung first, so a loser is
// dropped after one game), at the face the rungs ship at. No draws, no losses. A net that does is a
// CANDIDATE: its weights are exported to nn/ladder-candidates/<name>.{bin,meta.json} and the verdict
// goes to nn/ladder-candidate.json. Nothing in the shipped game changes by itself -- appending the
// rung (index.html's AI_LADDER entry + RUNG_TO_AI_LADDER) is a reviewed pull request.
// Menu rungs are mapped to AI_LADDER indices with index.html's RUNG_TO_AI_LADDER, so the check always
// tests what players actually meet. A checkout whose index.html predates that map is skipped.
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
  let rungs = (opts.rungs || 'all').toString();
  rungs = rungs === 'all' ? null : rungs.split(',').map(Number);
  const depth = opts.depth || 3, keep = opts.keep || 4, games = opts.games || 1;
  const name = opts.name || 'best-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  let html = '';
  try { html = fs.readFileSync(path.join(dir, '..', 'index.html'), 'utf8'); } catch (e) {}
  const map = rungMap(html);
  if (!map) { log('ladder check skipped: index.html has no RUNG_TO_AI_LADDER (merge main into this checkout)'); return null; }
  if (!rungs) rungs = map.map((_, i) => map.length - i);   // every rung on the menu, top first
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
  // Strongest rung first, so a loser is dropped after one slow game. Both colours: the champion is
  // Red in one game (rung is --a, Blue by arena's rule) and Blue in the other (champion is --a).
  for (const rung of rungs) {
    const L = map[rung - 1] + 1;           // arena's L<n> is AI_LADDER[n-1]
    const rec = { rung, ladderIndex: L - 1, red: [0, 0, 0], blue: [0, 0, 0] };
    for (const colour of ['red', 'blue']) {
      for (let g = 0; g < games; g++) {
        const resFile = path.join(dir, 'arena-logs', `.ladder-check-${process.pid}-${rung}-${colour}.jsonl`);
        try { fs.unlinkSync(resFile); } catch (e) {}
        const rungA = colour === 'red';
        const r = spawnSync(process.execPath, [path.join(dir, 'arena.js'),
          '--a', rungA ? 'L' + L : 'nn:0:' + net, '--b', rungA ? 'nn:0:' + net : 'L' + L,
          rungA ? '--depthB' : '--depthA', String(depth), rungA ? '--keepB' : '--keepA', String(keep),
          '--games', '1', '--openingPlies', games > 1 ? '2' : '0', '--resultsJsonl', resFile],
          { encoding: 'utf8', timeout: 45 * 60 * 1000 });
        if (r.status !== 0) log(`ladder check: arena failed vs rung ${rung} (${colour}): ${(r.stderr || '').split('\n')[0]}`);
        const mine = rungA ? 'B' : 'A', theirs = rungA ? 'A' : 'B';
        try {
          for (const ln of fs.readFileSync(resFile, 'utf8').split('\n')) {
            if (!ln.trim()) continue;
            const o = JSON.parse(ln);
            rec[colour][o.outcome === mine ? 0 : o.outcome === theirs ? 1 : 2]++;
          }
          fs.unlinkSync(resFile);
        } catch (e) {}
      }
    }
    results.push(rec);
    if (rec.red[1] || rec.red[2] || rec.blue[1] || rec.blue[2] || !rec.red[0] || !rec.blue[0]) break;   // first failure ends it
  }
  const pass = results.length === rungs.length && results.every(r => !r.red[1] && !r.red[2] && !r.blue[1] && !r.blue[2] && r.red[0] && r.blue[0]);
  const verdict = { at: new Date().toISOString(), name, net, face: `D${depth} keep ${keep}`, vs: results, pass };
  done[key] = { name, at: verdict.at, pass };
  fs.writeFileSync(donePath, JSON.stringify(done, null, 1));
  fs.writeFileSync(path.join(dir, 'ladder-candidate.json'), JSON.stringify(verdict, null, 1));
  log(`ladder check ${name}@D${depth} as Red and Blue: ` + results.map(r => `rung ${r.rung} red ${r.red.join('-')} blue ${r.blue.join('-')}`).join(', ') +
      (pass ? ' -- CANDIDATE for a new top rung' : ' -- not a candidate'));
  if (pass) {
    const out = path.join(dir, 'ladder-candidates', name);
    const r = spawnSync(process.execPath, [path.join(dir, 'export-committee-net.js'), net, out], { encoding: 'utf8' });
    if (r.status !== 0) log('ladder check: export failed: ' + (r.stderr || '').split('\n')[0]);
  }
  return verdict;
}

module.exports = { check };
if (require.main === module) {
  check({ net: arg('net', null), rungs: arg('rungs', 'all'), depth: +arg('depth', 3), keep: +arg('keep', 4),
          games: +arg('games', 1), name: arg('name', null) });
}
