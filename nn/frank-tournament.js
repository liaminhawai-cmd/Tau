// Round robin between hybrid nn+hand-tuned "franken" brains (frank.js), pure nn (D1/D3), and pure
// L10/L11 -- exploratory: does combining the trained net with the top ladder rung's hand-tuned eval
// add anything over either alone? Also logs the most-divergent positions between the net's and
// L11's favourite move (disagree.js) at a thinned ply sample, independent of who's actually playing,
// for later inspection -- not a controlled experiment, a sample of where the two models disagree.
//
//   node nn/frank-tournament.js --model path/to/best.json [--games 4] [--openingPlies 2]
//                                [--players C1,C2,C3,C4,L10,L11,nnD1,nnD3] [--disagreeEvery 2]
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine.js');
const { MLP } = require('./net.js');
const { nnPlanFor } = require('./nnai.js');
const { playRandomOpening } = require('./opening.js');
const { makeC1, makeC2, makeC3, makeC4 } = require('./frank.js');
const { makeDisagreeProbe, TopKLog } = require('./disagree.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function main() {
  const modelPath = arg('model', path.join(__dirname, 'models', 'best.json'));
  const gamesPerSide = Math.max(1, +arg('games', 4));
  const openingPlies = +arg('openingPlies', 2);
  const disagreeEvery = Math.max(0, +arg('disagreeEvery', 2));   // 0 disables
  const topK = +arg('topKDisagree', 40);
  const outPath = arg('out', path.join(__dirname, 'frank-results.json'));
  const disagreeOutPath = arg('disagreeOut', path.join(__dirname, 'frank-disagreements.json'));
  const wantedPlayers = arg('players', null);

  const eng = createEngine();
  const net = MLP.fromJSON(JSON.parse(fs.readFileSync(modelPath, 'utf8')));
  const L11w = eng.AI_LADDER[10].w;

  const allPlayers = {
    C1: { name: 'C1-nnRoot-L11Reply', fn: makeC1(eng, net, L11w) },
    C2: { name: 'C2-altNNHandNN3ply', fn: makeC2(eng, net, L11w) },
    C3: { name: 'C3-rankFusion', fn: makeC3(eng, net, L11w) },
    C4: { name: 'C4-linearBlend', fn: makeC4(eng, net, L11w) },
    L10: { name: 'L10', fn: idx => eng.ladderPlanFor(9, idx) },
    L11: { name: 'L11', fn: idx => eng.ladderPlanFor(10, idx) },
    nnD1: { name: 'nnD1', fn: idx => nnPlanFor(eng, net, idx, { temperature: 0, depth: 1 }) },
    nnD3: { name: 'nnD3', fn: idx => nnPlanFor(eng, net, idx, { temperature: 0, depth: 3, keepForDepth: 4 }) },
  };
  const keys = wantedPlayers ? wantedPlayers.split(',') : Object.keys(allPlayers);
  const players = keys.map(k => allPlayers[k]);
  if (players.some(p => !p)) throw new Error('unknown player key in --players (want one of ' + Object.keys(allPlayers).join(',') + ')');

  const disagreeProbe = disagreeEvery > 0 ? makeDisagreeProbe(eng, net, L11w) : null;
  const disagreeLog = new TopKLog(topK);

  const pairs = [];
  for (let i = 0; i < players.length; i++)
    for (let j = i + 1; j < players.length; j++) pairs.push([i, j]);

  const wins = {}, decided = {}, gamesPlayed = {};
  for (const k of keys) { wins[k] = 0; decided[k] = 0; gamesPlayed[k] = 0; }
  const pairResults = [];

  const t0 = Date.now();
  let totalGames = 0;
  const perPair = gamesPerSide*2;
  for (const [i, j] of pairs) {
    const A = players[i], B = players[j], ka = keys[i], kb = keys[j];
    let aw = 0, bw = 0, draws = 0, pliesSum = 0;
    const pairT0 = Date.now();
    for (let g = 0; g < perPair; g++) {
      const aIsBlue = g % 2 === 0;
      eng.newGame();
      playRandomOpening(eng, openingPlies);
      let plies = 0, nulls = 0;
      while (!eng.getG().over && plies < 300) {
        const idx = eng.getG().active;
        if (disagreeProbe && plies % disagreeEvery === 0) {
          const d = disagreeProbe(idx);
          disagreeLog.offer(d, { pair: `${ka} vs ${kb}`, gameIdx: g, ply: plies });
        }
        const brain = (idx === 0) === aIsBlue ? A : B;
        const plan = brain.fn(idx);
        if (!plan) { if (++nulls > 4) break; eng.clearTurn(); eng.setActive(1 - idx); continue; }
        nulls = 0;
        eng.applyPlan(plan);
        plies++;
      }
      const G = eng.getG();
      pliesSum += plies; totalGames++;
      if (!G.over) draws++;
      else if ((G.winner === 0) === aIsBlue) aw++;
      else bw++;
    }
    wins[ka] += aw; decided[ka] += aw + bw; gamesPlayed[ka] += perPair;
    wins[kb] += bw; decided[kb] += aw + bw; gamesPlayed[kb] += perPair;
    const secs = (Date.now() - pairT0)/1000;
    console.log(`${A.name} vs ${B.name}: ${aw}-${bw}` + (draws ? ` (${draws} draws)` : '') +
                `  avg ${(pliesSum/perPair).toFixed(0)} plies, ${secs.toFixed(0)}s`);
    pairResults.push({ a: ka, b: kb, aName: A.name, bName: B.name, aWins: aw, bWins: bw, draws, avgPlies: pliesSum/perPair, secs });
    fs.writeFileSync(outPath, JSON.stringify({
      players: keys.map(k => allPlayers[k].name), wins, decided, gamesPlayed, pairResults,
      elapsedSec: (Date.now() - t0)/1000, done: false,
    }, null, 2));
    if (disagreeProbe) fs.writeFileSync(disagreeOutPath, JSON.stringify(disagreeLog.items, null, 2));
  }

  const ranked = keys.map(k => ({ k, name: allPlayers[k].name, w: wins[k], d: decided[k], rate: decided[k] ? wins[k]/decided[k] : 0 }))
    .sort((a, b) => b.rate - a.rate);
  console.log(`\n=== ranking (${((Date.now() - t0)/1000).toFixed(0)}s, ${totalGames} games) ===`);
  ranked.forEach((r, i) => console.log(`${i + 1}. ${r.name}: ${r.w}/${r.d} decided (${(100*r.rate).toFixed(0)}%)`));
  fs.writeFileSync(outPath, JSON.stringify({
    players: keys.map(k => allPlayers[k].name), wins, decided, gamesPlayed, pairResults, ranked,
    elapsedSec: (Date.now() - t0)/1000, done: true,
  }, null, 2));
  if (disagreeProbe) console.log(`\nlogged ${disagreeLog.items.length} high-disagreement positions -> ${disagreeOutPath}`);
}

main();
