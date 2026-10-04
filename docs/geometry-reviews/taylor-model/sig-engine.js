// The shipped engine, extracted from index.html as nn/engine.js does, with logging added to
// resolvePush so every run leaves a "contact signature": which segment pair or hub pair was the
// closest contact at each substep, counting only penetrations over 1e-3u so the rounding-level
// residual passes do not show up. Two stop angles with the same signature followed the
// same contact program; a change between them is a contact event. Used only to choose where to cut
// the cells of a cover; nothing a certificate relies on depends on it.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ENGINE = path.join(__dirname, '../../../nn/engine.js');
const { buildEngineSource } = require(ENGINE);

function patch(src) {
  const rep = (re, to, what) => { if (!re.test(src)) throw new Error('signature patch did not apply: ' + what); src = src.replace(re, to); };
  rep(/if \(c\.dist<bestD\)\{ best=c; bestD=c\.dist; \}/, 'if (c.dist<bestD){ best=c; c.si=i; c.sj=j; bestD=c.dist; }', 'arcClosest');
  rep(/if \(!best \|\| d<best\.dist\) best=\{pt, dist:d\};/, 'if (!best || d<best.dist) best={pt, dist:d, si:i, t};', 'pointArcClosest');
  rep(/return \{ pa, pb, dist:Math\.sqrt\(dx\*dx\+dy\*dy\+dh\*dh\) \};/, 'return { pa, pb, dist:Math.sqrt(dx*dx+dy*dy+dh*dh), s, t };', 'segClosest3');
  rep(/function resolvePush\(active, opp\) \{/, "function resolvePush(active, opp) {\n    __SIG.push('/');", 'resolvePush entry');
  rep(/(const c = arcClosest\(aArc\(i\), oArc\(j\), minD\);\s*if \(!c\) continue;[^\n]*)/, "$1\n            if (minD - c.dist > 1e-3) __SIG.push('L'+i+j+'.'+__fe(c.si,c.s)+'.'+__fe(c.sj,c.t)+(c.dist<0.3?'D':''));", 'leg contact');
  rep(/\{ any=true; noteContact\(c\.dist, H\); push3d\(aHub, c\.pt, c\.dist, hubLegD - c\.dist\); \}/, "{ any=true; if (hubLegD - c.dist > 1e-3) __SIG.push('H'+j+'.'+__fe(c.si,c.t)); noteContact(c.dist, H); push3d(aHub, c.pt, c.dist, hubLegD - c.dist); }", 'pusher hub');
  rep(/\{ any=true; noteContact\(c\.dist, c\.pt\.h\); push3d\(c\.pt, oHub, c\.dist, hubLegD - c\.dist\); \}/, "{ any=true; if (hubLegD - c.dist > 1e-3) __SIG.push('G'+i+'.'+__fe(c.si,c.t)); noteContact(c.dist, c.pt.h); push3d(c.pt, oHub, c.dist, hubLegD - c.dist); }", 'pushed hub');
  rep(/\{ any=true; noteContact\(d, H\); apply\(opp\.x, opp\.y, dx\/d, dy\/d, 2\*hubR - d\); \}/, "{ any=true; if (2*hubR - d > 1e-3) __SIG.push('HH'); noteContact(d, H); apply(opp.x, opp.y, dx/d, dy/d, 2*hubR - d); }", 'hub-hub');
  return "function __fe(k, x) { return x === 0 ? 'v' + k : x === 1 ? 'v' + (k + 1) : 's' + k; }\n" + src;
}

function createSigEngine() {
  const text = fs.readFileSync(ENGINE, 'utf8');
  const open = "vm.runInContext(buildEngineSource() + `", close = "`, sandbox, { filename: 'tau-engine-extract.js' });";
  const a = text.indexOf(open), b = text.indexOf(close);
  if (a < 0 || b < 0) throw new Error('could not find the engine wrapper in nn/engine.js');
  const wrapper = text.slice(a + open.length, b);
  const sandbox = { Math, console, __SIG: [] };
  vm.createContext(sandbox);
  vm.runInContext(patch(buildEngineSource()) + wrapper, sandbox, { filename: 'tau-engine-sig.js' });
  return { eng: sandbox.__exports, sig: sandbox.__SIG };
}

const SEED = [-27.3934, -36.4088, 1.2052, -11.7593, -23.2838, 2.9442];
const STEP3 = 3 * Math.PI / 180, DELTA = STEP3 / 8;

// the contact signature of blue arm (bp, bd) stopped at alpha degrees, then red's (0,-) reply for
// 123 substeps
function makeSignature() {
  const { eng, sig } = createSigEngine();
  return function signature(bp, bd, alpha) {
    sig.length = 0;
    const G = eng.newGame(); const [b, r] = G.pieces;
    b.x = SEED[0]; b.y = SEED[1]; b.rot = SEED[2]; r.x = SEED[3]; r.y = SEED[4]; r.rot = SEED[5]; G.active = 0;
    eng.applyPlanSearch({ pivotIdx: bp, dir: bd, targetRad: alpha * Math.PI / 180 });
    const split = sig.length;
    eng.pinFoot(0);
    for (let k = 0; k < 123 && !G.atLimit; k++) eng.applySwing(-DELTA);
    return { all: sig.join(','), a: sig.slice(0, split).join(','), b: sig.slice(split).join(',') };
  };
}
module.exports = { makeSignature, createSigEngine };

if (require.main === module) {
  const [bp, bd, a0, a1, step] = process.argv.slice(2).map(Number);
  const signature = makeSignature();
  let prev = null, events = 0;
  for (let a = a0; a <= a1 + 1e-12; a += step) {
    const s = signature(bp, bd, a).all;
    if (prev !== null && s !== prev) events++;
    prev = s;
  }
  console.log(`arm (${bp},${bd}) ${a0}..${a1} every ${step} deg: ${events} signature changes between neighbouring samples`);
}
