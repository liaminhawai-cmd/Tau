'use strict';
// Cross-run numeric identity check; summarize.py retains within-run byte checks.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const assert = require('assert');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'replay-canonical.json'), 'utf8'));
function canonical(x) {
  if (x === null) return 'N';
  if (typeof x === 'boolean') return x ? 'T' : 'F';
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) throw new Error('Non-finite number');
    const b = Buffer.alloc(8); b.writeDoubleBE(x); return 'D' + b.toString('hex');
  }
  if (typeof x === 'string') {
    let s = 'S';
    for (let i = 0; i < x.length; i++) s += x.charCodeAt(i).toString(16).padStart(4, '0');
    return s + ';';
  }
  if (Array.isArray(x)) return '[' + x.map(canonical).join('') + ']';
  if (typeof x === 'object') return '{' + Object.keys(x).sort().map(k => canonical(k) + canonical(x[k])).join('') + '}';
  throw new Error('Unsupported value');
}
function semantic(name, value) {
  const copy = {...value};
  for (const key of manifest.ignoredRootFields[name] || []) delete copy[key];
  return copy;
}
const hash = s => crypto.createHash('sha256').update(s, 'ascii').digest('hex');
const fingerprint = (name, value) => hash(canonical(semantic(name, value)));
function selfTest() {
  assert.equal(hash(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(canonical({a:1,b:2}), canonical({b:2,a:1}));
  assert.notEqual(canonical(0), canonical(-0));
  assert.notEqual(canonical([1,2]), canonical([2,1]));
  for (const name of Object.keys(manifest.files)) {
    const a = {result:1}, b = {...a};
    for (const key of manifest.ignoredRootFields[name]) b[key] = 'different metadata';
    assert.equal(fingerprint(name,a), fingerprint(name,b));
  }
  assert.notEqual(fingerprint('propagation-1.0.json',{result:1}), fingerprint('propagation-1.0.json',{result:1+1e-9}));
  assert.notEqual(fingerprint('propagation-1.0.json',{log:[{}]}), fingerprint('propagation-1.0.json',{log:[{seconds:0}]}));
  assert.notEqual(fingerprint('engine-attacker-path.json',{steps:[{att:{x:1}}]}), fingerprint('engine-attacker-path.json',{steps:[{att:{x:1+1e-9}}]}));
  assert.throws(() => canonical(Infinity));
  console.log('13 canonicalization checks passed');
}
if (require.main === module) {
  try {
    if (manifest.format !== 'tau-replay-binary64-v1') throw new Error('Unknown canonical format');
    const args = process.argv.slice(2), test = args.includes('--self-test');
    const dirs = args.filter(a => a !== '--self-test');
    if (dirs.length > 1 || dirs.some(a => a.startsWith('--'))) throw new Error('Usage: node verify_replay.js [--self-test] [replay-directory]');
    if (test) selfTest();
    const dir = path.resolve(dirs[0] || __dirname);
    for (const [name, expected] of Object.entries(manifest.files)) {
      const actual = fingerprint(name, JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
      if (actual !== expected) throw new Error(name + ': numeric/structural mismatch: ' + actual);
      console.log(name + ': matches archive');
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = {canonical, semantic, fingerprint, selfTest};
