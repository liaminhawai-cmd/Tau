'use strict';
// Per-region reliability of each candidate committee member, measured the way committee.js
// actually uses them: every member turns its verdict into a win probability, and the committee
// sums the LOGS. So the quantity that decides how much a member should be trusted in a region is
// its LOG-LOSS there -- exactly the term pool() adds up.
//
// For each recorded position with a decided outcome: ask every member for its win probability for
// the side to move, score it against what actually happened, and bin by region.
//
// CAVEAT, stated up front: best.json was TRAINED on this corpus, so its absolute loss here is
// in-sample and flattered. Two things survive that: (a) differences BETWEEN regions for the same
// member pair (the training bias is spread over all regions), and (b) the error CORRELATION
// between members, which is what decides whether an extra committee seat buys anything.
const fs = require('fs'), path = require('path'), readline = require('readline');
const REPO = process.env.TAU_REPO || '/home/user/Tau';
const { createEngine } = require(path.join(REPO, 'nn/engine.js'));
const { MLP } = require(path.join(REPO, 'nn/net.js'));
const WSLICE = +(process.argv[2] || 0), NSLICE = +(process.argv[3] || 1);
const TARGET = +(process.env.TARGET || 20000);
const OUT = process.argv[4] || `rel-w${WSLICE}.json`;

const eng = createEngine();
eng.newGame();
const G = eng.getG();
const EPS = 1e-3, clampP = p => Math.min(1 - EPS, Math.max(EPS, p));
const LW = {
  L9:  { margin:1, zone:2.2, park:1.9, center:0.12, oppFree:-0.2 },
  L10: { margin:1, zone:12, park:8, oppFree:-1.1, triMe:0.15 },
  L11: { margin:1, zone:12, park:8, oppFree:-1.1, triMe:0.2 },
};
const NETFILES = (process.env.NETS || 'best,deep,wide,ultra').split(',');
const nets = {};
for (const n of NETFILES) {
  const f = path.join(REPO, 'nn/models', n + '.json');
  if (!fs.existsSync(f)) { console.error('missing net ' + f); continue; }
  nets[n] = MLP.fromJSON(JSON.parse(fs.readFileSync(f, 'utf8')));
}
const MEMBERS = [...Object.keys(LW), ...Object.keys(nets)];
const isNet = m => !!nets[m];

// Region binning. dm = the mover's hub distance from the board centre, the axis the game-level
// playoff found a real split on; refined here into 8 bins instead of 3.
const RINGS = [40, 53.3];
const EDGE = 66.667;
const dmBin = d => Math.min(7, Math.floor(d / 8));            // 0-8u, 8-16u, ... 56u+
const advBin = a => a < -65 ? 0 : a > 40 ? 2 : 1;
const lineBin = d => d < 1 ? 0 : d < 3 ? 1 : d < 8 ? 2 : 3;   // how close the mover's nearest foot is to a printed line
const plyBin = p => p <= 5 ? 0 : p <= 15 ? 1 : 2;

function nearestLineDist(feet) {
  let best = 1e9;
  for (const f of feet) {
    const r = Math.hypot(f.x, f.y);
    for (const R of RINGS) best = Math.min(best, Math.abs(r - R));
    best = Math.min(best, Math.abs(r - EDGE));
    for (const a of eng.CFG.sideArcs) {
      const ang = Math.atan2(f.y - a.cy, f.x - a.cx) * 180 / Math.PI;
      if (eng.angInSpan(ang, a.a0, a.a1)) best = Math.min(best, Math.abs(Math.hypot(f.x - a.cx, f.y - a.cy) - a.r));
    }
  }
  return best;
}

// acc[dim][cell][member] = {n, loss, right}
const acc = {};
const bump = (dim, cell, m, loss, right) => {
  acc[dim] ||= {}; acc[dim][cell] ||= {};
  const a = acc[dim][cell][m] ||= { n: 0, loss: 0, right: 0 };
  a.n++; a.loss += loss; a.right += right;
};
// pairwise error correlation accumulators
const pairAcc = {};
const errSum = {}, errSq = {}, errN = { n: 0 };

const files = fs.readdirSync(path.join(REPO, 'nn/data')).filter(f => f.endsWith('.jsonl')).sort();
let seen = 0, used = 0;
(async () => {
  for (const file of files) {
    if (used >= TARGET) break;
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(REPO, 'nn/data', file)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (used >= TARGET) break;
      if (!line || line[0] !== '{') continue;
      let r; try { r = JSON.parse(line); } catch (_) { continue; }
      if (!r.f || r.f.length !== 94 || !r.p || r.p.length !== 6 || typeof r.z !== 'number' || !r.z) continue;
      if ((seen++ % NSLICE) !== WSLICE) continue;
      if (seen % 7 !== 0) continue;                       // thin the stream so the sample spans the whole corpus
      const m = r.m | 0, y = r.z > 0 ? 1 : 0;
      const ps = G.pieces;
      ps[0].x = r.p[0]; ps[0].y = r.p[1]; ps[0].rot = r.p[2];
      ps[1].x = r.p[3]; ps[1].y = r.p[4]; ps[1].rot = r.p[5];
      G.active = m;
      let probs = {};
      try {
        for (const L of Object.keys(LW)) probs[L] = clampP(1 / (1 + Math.exp(-eng.ladderEval(m, LW[L]) / 100)));
        for (const n of Object.keys(nets)) probs[n] = clampP((nets[n].value(r.f) + 1) / 2);
      } catch (_) { continue; }
      const me = ps[m];
      const dm = Math.hypot(me.x, me.y);
      let adv; try { adv = eng.ladderEval(m, LW.L11) - eng.ladderEval(1 - m, LW.L11); } catch (_) { continue; }
      const nl = nearestLineDist(me.feet());
      const cells = { dm: dmBin(dm), adv: advBin(adv), line: lineBin(nl), ply: plyBin(0), all: 0 };
      const errs = {};
      for (const mem of MEMBERS) {
        const p = probs[mem];
        const loss = -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
        const right = ((p > 0.5) === (y === 1)) ? 1 : 0;
        errs[mem] = p - y;                                 // signed error, for correlation
        for (const dim in cells) bump(dim, cells[dim], mem, loss, right);
      }
      errN.n++;
      for (const a of MEMBERS) {
        errSum[a] = (errSum[a] || 0) + errs[a];
        errSq[a] = (errSq[a] || 0) + errs[a] * errs[a];
        for (const b of MEMBERS) {
          if (a >= b) continue;
          pairAcc[a + '|' + b] = (pairAcc[a + '|' + b] || 0) + errs[a] * errs[b];
        }
      }
      used++;
      if (used % 2000 === 0) process.stderr.write(`[w${WSLICE}] ${used}/${TARGET}\n`);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({ members: MEMBERS, acc, pairAcc, errSum, errSq, n: errN.n, used }));
  console.log(JSON.stringify({ worker: WSLICE, used, n: errN.n }));
})();
