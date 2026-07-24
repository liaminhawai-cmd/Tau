// Tau engine for Node — extracted LIVE from ../index.html so training can never drift from the
// shipped rules. We scan the game's script for top-level definitions, seed the exact functions
// the AI needs (rules engine + the whole AI ladder), pull in their dependency closure, and eval
// the result in a bare sandbox. No DOM, no stubs needed: everything below the seed set is pure.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SEEDS = [
  'CFG', 'Piece', 'norm', 'radU',
  'pinFoot', 'applySwing', 'clearTurn', 'endTurn', 'takeSnap', 'restoreSnap',
  'directionToward', 'aiChoosePlan', 'aiSwingDir', 'searchedPlanFor', 'simMoveToLimit',
  'AI_LADDER', 'ladderPlanFor',
];

function topLevelDefs(src) {
  // top-level defs in index.html sit at column 0; capture each one's full text by brace/paren
  // balancing (const/let run to the first ';' at depth 0 — handles multiline object and IIFE
  // initializers like LINE_INTERSECTIONS)
  const defs = [];
  const re = /^(function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) {
    const kind = m[1], start = m.index;
    let i = start, depth = 0, end = -1, inStr = null, inCom = null;
    for (; i < src.length; i++) {
      const c = src[i], c2 = src.substr(i, 2);
      if (inCom === '//') { if (c === '\n') inCom = null; continue; }
      if (inCom === '/*') { if (c2 === '*/') { inCom = null; i++; } continue; }
      if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
      if (c2 === '//' || c2 === '/*') { inCom = c2; i++; continue; }
      if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') {
        depth--;
        if (depth === 0 && (kind === 'function' || kind === 'class') && c === '}') { end = i + 1; break; }
      } else if (c === ';' && depth === 0 && (kind === 'const' || kind === 'let')) { end = i + 1; break; }
      else if (c === '\n' && depth === 0 && (kind === 'const' || kind === 'let') &&
               /^(function|class|const|let)\s/.test(src.slice(i + 1, i + 12))) { end = i; break; }
    }
    if (end < 0) continue;
    const text = src.slice(start, end);
    // register every name a multi-declarator line introduces (let a = 1, b = 2;)
    const names = [m[2]];
    if (kind === 'const' || kind === 'let') {
      const flat = text.replace(/\n/g, ' ');
      const extra = flat.match(/,\s*([A-Za-z_$][\w$]*)\s*=/g) || [];
      for (const e of extra) names.push(e.replace(/[,=\s]/g, ''));
    }
    defs.push({ names, text, pos: start });
    re.lastIndex = end;
  }
  return defs;
}

// comments and strings mention identifiers all the time ("…raced a reset…"), so dependency
// matching runs on a stripped copy of each definition, and only on bare identifiers (not .props)
function stripCommentsAndStrings(s) {
  let out = '', inStr = null, inCom = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], c2 = s.substr(i, 2);
    if (inCom === '//') { if (c === '\n') { inCom = null; out += c; } continue; }
    if (inCom === '/*') { if (c2 === '*/') { inCom = null; i++; } continue; }
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
    if (c2 === '//' || c2 === '/*') { inCom = c2; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; out += ' '; continue; }
    out += c;
  }
  return out;
}

function buildEngineSource() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const defs = topLevelDefs(html);
  for (const d of defs) d.bare = stripCommentsAndStrings(d.text);
  const byName = new Map();
  for (const d of defs) for (const n of d.names) if (!byName.has(n)) byName.set(n, d);
  for (const s of SEEDS) if (!byName.has(s)) throw new Error('seed not found in index.html: ' + s);
  // the i18n helpers are named t/tf — one-letter names collide with every local loop variable,
  // and no engine function genuinely translates strings, so they're barred from the closure
  const DENY = new Set(['t', 'tf', 'LANG', 'LANGS', 'I18N']);
  const picked = new Set();
  const queue = SEEDS.map(s => byName.get(s));
  while (queue.length) {
    const d = queue.pop();
    if (picked.has(d)) continue;
    picked.add(d);
    for (const [name, dep] of byName)
      if (!picked.has(dep) && !DENY.has(name) &&
          new RegExp('(?<![.\\w$])' + name.replace(/\$/g, '\\$') + '\\b').test(d.bare))
        queue.push(dep);
  }
  const code = [...picked].sort((a, b) => a.pos - b.pos).map(d => d.text).join('\n');
  const bare = stripCommentsAndStrings(code);
  if (/document\.|getElementById|localStorage/.test(bare))
    throw new Error('extracted engine pulled in DOM code — the closure reached too far');
  if (!/(^|\n)let G;/.test(code)) throw new Error("closure missed the game's `let G;` declaration");
  return code + '\n';
}

function createEngine() {
  const sandbox = { Math, console };
  vm.createContext(sandbox);
  vm.runInContext(buildEngineSource() + `
function __newGame() {
  const blue = new Piece(0), red = new Piece(1);
  blue.x = -CFG.startX; blue.rot = 0;
  red.x  =  CFG.startX; red.rot  = Math.PI;
  G = { pieces: [blue, red], active: 0, pinned: null, pivot: null, handle: null, turnDir: 0,
        crossings: 0, atLimit: false, netRad: 0, ptrAngle: null, over: false, winner: null,
        snap: null, contact: null, justCrossed: [] };
  return G;
}
// play one full turn from a { pivotIdx, dir, targetRad } plan (the shape every brain returns)
function __applyPlan(plan) {
  if (!plan || Math.abs(plan.targetRad) < 1e-9) { clearTurn(); G.active = 1 - G.active; return; }
  pinFoot(plan.pivotIdx);
  let guard = 0;
  while (!G.atLimit && Math.abs(G.netRad) < Math.abs(plan.targetRad) && guard++ < 5000) {
    const rem = Math.abs(plan.targetRad) - Math.abs(G.netRad);
    applySwing(plan.dir * Math.min(AI_STEP_RAD, rem));
  }
  endTurn();
}
__exports = {
  CFG, Piece, radU, norm,
  pinFoot, applySwing, clearTurn, endTurn, takeSnap, restoreSnap,
  directionToward, aiChoosePlan, simMoveToLimit, searchedPlanFor,
  AI_LADDER, ladderPlanFor,
  newGame: __newGame, applyPlan: __applyPlan,
  getG: () => G, setActive: a => { G.active = a; },
};`, sandbox, { filename: 'tau-engine-extract.js' });
  return sandbox.__exports;
}

module.exports = { createEngine, buildEngineSource };
