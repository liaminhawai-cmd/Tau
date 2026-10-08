// Plays AI-vs-AI games at three strengths and writes replay links for video.
//
//   node showcase.js --root <checkout of main> [--games 6] [--tiers low,mid,high] [--out dir]
//
// Each tier pits brains of similar strength against each other, so the games are close:
//   low   hand-tuned levels 4, 5 and 6 (the early web ladder)
//   mid   hand-tuned levels 9, 10 and 11 (deep search, no neural net)
//   high  the retired neural-net rungs: the Committee and the Champion, at depth 1 and 3
// The current rungs 11 to 14 (the resume-607 and resume-619 nets) are refused, so the challenge
// opponents never appear in a video.
//
// Links are the same #r= format the game's Share button makes, so they open straight into the
// replay viewer. Each game gets two: a plain one, and one that also switches on Director mode.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const ROOT = path.resolve(arg('root', path.join(__dirname, '..', '..')));
const { createEngine } = require(path.join(ROOT, 'nn', 'engine.js'));

// Brains by AI_LADDER index (arena.js's L<n> is index + 1). Names are what the replay shows.
const BRAINS = {
  L4: { idx: 3, name: 'Centre-dancer' }, L5: { idx: 4, name: 'Corner-cutter' }, L6: { idx: 5, name: 'Solid' },
  L9: { idx: 8, name: 'Deep' }, L10: { idx: 9, name: 'Territory' }, L11: { idx: 10, name: 'Triangle' },
  committee: { idx: 14, name: 'Committee' }, champion: { idx: 15, name: 'Champion' },
  champion3: { idx: 16, name: 'Champion (deep)' },
};
// Every pairing is played with each brain as Blue once. There are no random moves, and most brains
// always play the same move in the same position, so a given matchup and colour gives one game.
const TIERS = {
  low: ['L4', 'L5', 'L6'],
  mid: ['L9', 'L10', 'L11'],
  high: ['committee', 'champion', 'champion3'],
};
const matchups = names => names.flatMap(a => names.filter(b => b !== a).map(b => [a, b]));
const BASE = arg('url', 'https://tau-game.com/');

const eng = createEngine();
for (const [key, b] of Object.entries(BRAINS)) {
  const def = eng.AI_LADDER[b.idx];
  if (!def) throw new Error(`${key}: no ladder entry ${b.idx} in this checkout's index.html`);
  if (b.idx >= 17 || (def.nets || []).some(n => /^resume-/.test(n)))
    throw new Error(`${key} is one of the current top rungs, which stay out of videos`);
  b.label = def.label || '';
}
if (Object.values(BRAINS).some(b => eng.AI_LADDER[b.idx].nets))
  require(path.join(ROOT, 'nn', 'committee-nets.js')).equipLadderNets(eng);
const STEP = 3 * Math.PI / 180;   // AI_STEP_RAD, the same step applyPlan swings in

// One turn, recording a frame after every step of the swing (what the browser's recorder sees).
function playTurn(plan, frames) {
  const G = eng.getG();
  const snap = () => { const [b, r] = G.pieces; frames.push([b.x, b.y, b.rot, r.x, r.y, r.rot]); };
  if (!plan || Math.abs(plan.targetRad) < 1e-9) { eng.clearTurn(); G.active = 1 - G.active; return; }
  plan = eng.koLegalizePlan(plan);
  eng.pinFoot(plan.pivotIdx);
  let guard = 0;
  while (!G.atLimit && Math.abs(G.netRad) < Math.abs(plan.targetRad) && guard++ < 5000) {
    eng.applySwing(plan.dir * Math.min(STEP, Math.abs(plan.targetRad) - Math.abs(G.netRad)));
    snap();
  }
  eng.commitTurn();
  snap();
}

function playGame(blue, red) {
  eng.CFG.moveCap = 300;
  eng.newGame();
  const G = eng.getG();
  const frames = [];
  { const [b, r] = G.pieces; frames.push([b.x, b.y, b.rot, r.x, r.y, r.rot]); }
  const brains = [blue, red];
  let plies = 0;
  while (!G.over && plies < 300) {
    playTurn(eng.ladderPlanFor(brains[G.active].idx, G.active), frames);
    plies++;
  }
  return { frames, winner: G.over ? G.winner : null, plies };
}

// encodeReplay from index.html, byte for byte, minus the browser's deflate call.
function dist(f, g) {
  const r = eng.CFG.footR;
  return Math.max(Math.hypot(g[0] - f[0], g[1] - f[1]) + Math.abs(g[2] - f[2]) * r,
                  Math.hypot(g[3] - f[3], g[4] - f[4]) + Math.abs(g[5] - f[5]) * r);
}
function encodeRaw(frames, winner, names) {
  const kept = [frames[0]];
  for (let i = 1; i < frames.length; i++)
    if (dist(kept[kept.length - 1], frames[i]) >= 0.15 || i === frames.length - 1) kept.push(frames[i]);
  const n = kept.length;
  const nb = Buffer.from(names[0].slice(0, 40)), nr = Buffer.from(names[1].slice(0, 40));
  const buf = Buffer.alloc(1 + 4 + 24 + (n - 1) * 12 + 2 + nb.length + nr.length + 2);
  buf.writeUInt8(winner === 0 ? 0 : winner === 1 ? 1 : 255, 0);
  buf.writeUInt32LE(n, 1);
  const recon = kept[0].slice();
  for (let k = 0; k < 6; k++) buf.writeFloatLE(kept[0][k], 5 + k * 4);
  let off = 29;
  for (let i = 1; i < n; i++) for (let k = 0; k < 6; k++) {
    const q = k === 2 || k === 5 ? 0.0002 : 0.002;
    let d = Math.max(-32768, Math.min(32767, Math.round((kept[i][k] - recon[k]) / q)));
    recon[k] += d * q;
    buf.writeInt16LE(d, off); off += 2;
  }
  buf.writeUInt8(nb.length, off++); nb.copy(buf, off); off += nb.length;
  buf.writeUInt8(nr.length, off++); nr.copy(buf, off); off += nr.length;
  buf.writeUInt8(255, off++); buf.writeUInt8(0, off++);   // no sharer id
  return buf;
}
const b64u = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The plain link is compressed, like the Share button's. The Director link has to carry the word
// "director" somewhere in the hash for the page to switch Director mode on, and any text after a
// compressed payload breaks it. So that one is uncompressed (the 'p' form the page also reads),
// padded to a whole base64 group, with the six bytes that spell "director" in base64 on the end.
// The page stops reading after the names and sharer fields, so those bytes are never looked at.
function links(raw) {
  const plain = BASE + '#r=d' + b64u(zlib.deflateRawSync(raw, { level: 9 }));
  const pad = Buffer.alloc((3 - raw.length % 3) % 3);
  const tail = Buffer.from('director', 'base64');
  const dir = BASE + '#r=p' + b64u(Buffer.concat([raw, pad, tail]));
  if (!dir.endsWith('director')) throw new Error('director link encoding failed');
  return { plain, dir };
}

function main() {
  const games = +arg('games', 6);
  const tiers = arg('tiers', 'low,mid,high').split(',');
  const out = path.resolve(arg('out', path.join(__dirname, 'showcase')));
  fs.mkdirSync(out, { recursive: true });
  const rows = [];
  for (const tier of tiers) {
    if (!TIERS[tier]) throw new Error('unknown tier: ' + tier);
    const pairs = matchups(TIERS[tier]).slice(0, games);
    for (let g = 0; g < pairs.length; g++) {
      const [a, b] = pairs[g];
      const blue = BRAINS[a], red = BRAINS[b];
      const t0 = Date.now();
      const r = playGame(blue, red);
      const names = [blue.name, red.name];
      const l = links(encodeRaw(r.frames, r.winner, names));
      const result = r.winner === 0 ? blue.name + ' (Blue) wins' : r.winner === 1 ? red.name + ' (Red) wins' : 'no result';
      rows.push({ tier, blue: blue.name, red: red.name, result, plies: r.plies, ...l });
      console.log(`${tier.padEnd(4)} game ${g + 1}: ${blue.name} vs ${red.name}: ${result}, ${r.plies} moves, ` +
                  `${((Date.now() - t0) / 1000).toFixed(0)}s`);
      write(out, rows);
    }
  }
  console.log('\nSaved ' + path.join(out, 'index.html'));
}

function write(out, rows) {
  fs.writeFileSync(path.join(out, 'games.json'), JSON.stringify(rows, null, 1));
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = rows.map(r => `<tr><td>${r.tier}</td><td><b style="color:#6b9eff">${esc(r.blue)}</b> vs ` +
    `<b style="color:#ff6b6b">${esc(r.red)}</b></td><td>${esc(r.result)}</td><td>${r.plies}</td>` +
    `<td><a href="${r.dir}" target="_blank">Director</a> · <a href="${r.plain}" target="_blank">Plain</a> · ` +
    `<button onclick="navigator.clipboard.writeText(this.dataset.u)" data-u="${r.plain}">Copy</button></td></tr>`).join('\n');
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Tau AI games</title>
<style>body{font:15px system-ui,sans-serif;background:#0c0e11;color:#e6e6e6;margin:24px}a{color:#7aa2ff}
td,th{padding:6px 12px;border-bottom:1px solid #2c3138;text-align:left}button{font:inherit;cursor:pointer}</style>
<h1>Tau AI vs AI</h1>
<p>low: hand-tuned early levels. mid: hand-tuned deep search. high: retired neural-net rungs.
Every move is the brain's own choice.</p>
<p><b>Director</b> opens the replay with Director mode on (Hide UI, safe areas, logo). <b>Plain</b> is the
short link, for posting.</p>
<table><tr><th>Tier</th><th>Game</th><th>Result</th><th>Moves</th><th>Open</th></tr>
${body}</table>`);
}

main();
