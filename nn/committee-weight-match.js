'use strict';
// The weighted committee, measured as a DIFFERENCE instead of as two pool ratings.
//
//   node nn/committee-weight-match.js [--games 48] [--openingPlies 2] [--print]
//
// d2w is d2 plus @posw (net 1.35x / ladder 0.75x inside 10u, ramping to 1.0 at 21.5u). Whether
// that weighting is worth anything is a question about the gap between the two, and the league
// answers it badly: each one is rated against whoever the pool happened to pair it with, so on
// desktop-2b7iqhn d2 (112 games) and d2w (44 games) shared exactly TWO opponents and had never
// met, leaving two overlapping intervals -- 49 [-45, 143] and 97 [-6, 200] -- that cannot be
// subtracted. Playing them against each other answers the same question in one match, because
// every game is a direct comparison and the members are identical on both sides.
//
// Members come from the live committee state (models/.committee-state.json) so the match is the
// pair the league is actually rating, not a hand-typed guess at it. --members overrides for a
// machine that has no state file yet, e.g.
//   --members "L11;nn:0:nn/models/ultra-m3-319.json;nn:0:nn/models/resume-239.json"
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const dir = __dirname;
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };

function membersFromState() {
  const p = path.join(dir, 'models', '.committee-state.json');
  let st;
  try { st = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
  const rows = [].concat(st.actives || [], st.history || []);
  // Prefer a live d2/d2w pair; fall back to the most recent d2 of any vintage. Both variants are
  // built from one donor's members, so either row names the pair.
  const pick = rows.find(r => r && !r.swept && (r.variant === 'd2w' || r.variant === 'd2') && (r.members || []).length >= 2)
            || rows.find(r => r && (r.variant === 'd2w' || r.variant === 'd2') && (r.members || []).length >= 2);
  return pick ? pick.members : null;
}

const override = arg('members', '');
const members = override ? override.split(';').map(s => s.trim()).filter(Boolean) : membersFromState();
if (!members || members.length < 2) {
  console.error('[weight-match] no committee members found. Run this on a training box that has\n' +
                '               nn/models/.committee-state.json, or pass --members "L11;nn:0:a.json;nn:0:b.json".');
  process.exitCode = 1;
  return;
}
const body = 'committee:' + members.join(';');
const a = body + '@d2';          // unweighted
const b = body + '@d2,posw';     // weighted
const games = String(arg('games', '48'));
const plies = String(arg('openingPlies', '2'));
const argv = ['--a', a, '--b', b, '--games', games, '--openingPlies', plies];

console.log('[weight-match] members: ' + members.join(', '));
console.log('[weight-match] A (plain)    ' + a);
console.log('[weight-match] B (weighted) ' + b);
console.log('[weight-match] a positive Elo for B is what @posw is worth over the same members\n');
if (process.argv.includes('--print')) {
  console.log('node ' + path.relative(process.cwd(), path.join(dir, 'arena.js')) + ' ' +
              argv.map(s => /[\s;]/.test(s) ? JSON.stringify(s) : s).join(' '));
  return;
}
const ch = spawn(process.execPath, [path.join(dir, 'arena.js'), ...argv], { stdio: 'inherit' });
ch.on('exit', c => { process.exitCode = c == null ? 1 : c; });
