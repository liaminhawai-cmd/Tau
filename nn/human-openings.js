'use strict';
// The openings of the games you WON in the league (human-league.js / PLAY-LEAGUE.bat), as starting
// positions for the nets to play on from (selfplay-legacy.js --humanOpeningFrac).
//
// Your saved rows are a handful of positions in a corpus of about a million, so on their own they
// barely move a net. A position you won from is worth more as a place to START: self-play replays
// it hundreds of times with every pairing and both colours, so the nets work out for themselves
// what happens from there -- including the defence to whatever you found -- in their own games.
//
// A win's position after its first `plies` moves is read back from what the play server already
// saved: the result line in human-results.jsonl names the session and how many lines it had, and
// the final line's rows in nn/data/human-*.jsonl are that game in order, so row `plies` IS the
// position after `plies` moves. Wins with take-backs count too -- the final line is the one that
// won. A game that was over inside the opening has no such position and is skipped.
const fs = require('fs');
const path = require('path');

// Same as human-league.js's session-id cleaning, which is how the rows' game ids were built.
const clean = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 24);

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n'); } catch (e) { return []; }
}

function loadHumanOpenings(dir, plies = 3) {
  const wins = new Map();
  for (const l of readLines(path.join(dir, 'human-results.jsonl'))) {
    if (!l.trim()) continue;
    let r; try { r = JSON.parse(l); } catch (e) { continue; }
    if (r && r.id && +r.w > 0 && +r.lines >= 1) wins.set(`human-${clean(r.id)}-${+r.lines - 1}`, r);
  }
  if (!wins.size) return [];
  const rows = new Map();
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'data')).filter(f => /^human-.*\.jsonl$/.test(f)); } catch (e) {}
  for (const f of files) for (const l of readLines(path.join(dir, 'data', f))) {
    if (!l.trim()) continue;
    let j; try { j = JSON.parse(l); } catch (e) { continue; }
    if (!wins.has(j.g) || !Array.isArray(j.p) || j.p.length !== 6 || (j.m !== 0 && j.m !== 1)) continue;
    if (!rows.has(j.g)) rows.set(j.g, []);
    rows.get(j.g).push({ p: j.p, m: j.m });
  }
  const out = [];
  for (const [g, list] of rows) {
    if (list.length <= plies) continue;
    const r = wins.get(g);
    out.push({ p: list[plies].p, m: list[plies].m, game: g, face: r.face, human: r.human });
  }
  return out;
}

module.exports = { loadHumanOpenings };

if (require.main === module) {
  const plies = +(process.argv[process.argv.indexOf('--plies') + 1] || 3) || 3;
  const list = loadHumanOpenings(__dirname, plies);
  console.log(`${list.length} opening position(s) after ${plies} move(s) of your league wins`);
  for (const o of list) console.log(`  ${o.game}  vs ${o.face}  (${o.human}), ${o.m === 0 ? 'Blue' : 'Red'} to move`);
}
