// One-time round robin across every saved checkpoint, to find the actual strongest model instead
// of trusting best.json to already be it. Why this is needed: until this fix, run.js's fresh-vs-best
// gate never really gated (it always promoted regardless of the arena result -- see run.js's git
// history), so best.json has been "whichever net trained most recently," not a ratchet that only
// ever went up. This plays every ckpt-NNN.json (+ best.json / value.json if present) against every
// other, all at temperature 0 (deterministic move choice -- no exploration noise once a game is
// under way), and ranks by win rate. A couple of forced random opening plies (opening.js) give
// each of the N games per pairing a genuinely different position to play out from, instead of
// replaying the same 2 deterministic games (one per starting colour) over and over. Pass --promote
// to back up the current best.json and replace it with the tournament winner, giving the now-real
// gate an honest net to defend from here on.
//
//   node nn/tournament.js [--dir nn/models] [--games 6] [--openingPlies 2] [--promote]
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { MLP } = require('./net.js');
const { nnPlanFor } = require('./nnai.js');
const { playRandomOpening } = require('./opening.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function playGame(eng, netA, netB, aIsBlue, openingPlies) {
  eng.newGame();
  playRandomOpening(eng, openingPlies);
  let plies = 0, nulls = 0;
  while (!eng.getG().over && plies < 300) {
    const idx = eng.getG().active;
    const net = (idx === 0) === aIsBlue ? netA : netB;
    const plan = nnPlanFor(eng, net, idx, { temperature: 0 });
    if (!plan) { if (++nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
    nulls = 0;
    eng.applyPlan(plan);
    plies++;
  }
  const G = eng.getG();
  if (!G.over) return null;              // draw (300-ply cap)
  return (G.winner === 0) === aIsBlue;   // true: A won, false: B won
}

function main() {
  const modelsDir = arg('dir', path.join(__dirname, 'models'));
  const gamesPerSide = Math.max(1, +arg('games', 6));   // each side plays first this many times
  const openingPlies = +arg('openingPlies', 2);
  const doPromote = process.argv.includes('--promote');

  const files = fs.readdirSync(modelsDir)
    .filter(f => /^(ckpt-\d+|best|value)\.json$/.test(f))
    .sort();
  if (files.length < 2) {
    console.error(`need at least 2 model files (ckpt-*.json / best.json / value.json) in ${modelsDir}`);
    process.exit(1);
  }

  const eng = createEngine();
  const nets = files.map(f => ({
    name: f,
    net: MLP.fromJSON(JSON.parse(fs.readFileSync(path.join(modelsDir, f), 'utf8'))),
  }));
  const wins = {}, decided = {};
  for (const f of files) { wins[f] = 0; decided[f] = 0; }

  const pairs = files.length*(files.length - 1)/2;
  const perPair = gamesPerSide*2;
  console.log(`tournament: ${files.length} models, ${pairs} pairs, ${perPair} games/pair ` +
              `(${pairs*perPair} games total), temperature 0`);
  const t0 = Date.now();

  for (let i = 0; i < nets.length; i++) {
    for (let j = i + 1; j < nets.length; j++) {
      let aw = 0, bw = 0, draws = 0;
      for (let g = 0; g < perPair; g++) {
        const aIsBlue = g % 2 === 0;
        const r = playGame(eng, nets[i].net, nets[j].net, aIsBlue, openingPlies);
        if (r === true) aw++; else if (r === false) bw++; else draws++;
      }
      wins[nets[i].name] += aw; decided[nets[i].name] += aw + bw;
      wins[nets[j].name] += bw; decided[nets[j].name] += aw + bw;
      console.log(`${nets[i].name} vs ${nets[j].name}: ${aw}-${bw}` + (draws ? ` (${draws} draws)` : ''));
    }
  }

  const ranked = files
    .map(f => ({ f, w: wins[f], d: decided[f], rate: decided[f] ? wins[f]/decided[f] : 0 }))
    .sort((a, b) => b.rate - a.rate);
  console.log(`\n=== ranking (${((Date.now() - t0)/1000).toFixed(0)}s) ===`);
  ranked.forEach((r, i) => console.log(
    `${i + 1}. ${r.f}: ${r.w}/${r.d} decided (${(100*r.rate).toFixed(0)}%)`));

  const champ = ranked[0].f;
  console.log(`\nstrongest: ${champ}`);
  if (!doPromote) {
    console.log(`(dry run -- pass --promote to back up models/best.json and replace it with ${champ})`);
    return;
  }
  const bestPath = path.join(modelsDir, 'best.json');
  if (champ === 'best.json') { console.log('best.json is already the strongest -- nothing to do'); return; }
  if (fs.existsSync(bestPath)) {
    const backup = path.join(modelsDir, `best.pre-tournament-${Date.now()}.json`);
    fs.copyFileSync(bestPath, backup);
    console.log(`backed up old best.json -> ${path.basename(backup)}`);
  }
  fs.copyFileSync(path.join(modelsDir, champ), bestPath);
  console.log(`promoted ${champ} -> best.json`);
}

main();
