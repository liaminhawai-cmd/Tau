// Validate a generated Taylor cover cell-by-cell.
// This is a finite validation layer on top of the certificate cover:
//   - audit2 proves each stored margin reproduces,
//   - containment checks sampled shipped-engine trajectories against the exact cell model,
//   - legal-red checks the witness swing's line-contact episode from the cell's red enclosure.
//   node validate-cover2.js <bluePivot> <blueDir> <from> <to> [samples=3] [degree=4]
'use strict';
const fs = require('fs'), path = require('path');
const { fromEnv, armResultsDir } = require('./problem.js');
const { containment } = require('./contain2.js');
const { checkCell } = require('./legal-red.js');

const [bp, bd, fromArg, toArg, samplesArg, degArg] = process.argv.slice(2, 8).map(Number);
const samples = Number.isFinite(samplesArg) ? samplesArg : 3;
const deg = Number.isFinite(degArg) ? degArg : 4;
const PR = fromEnv(), dir = armResultsDir(PR, bp, bd);
if (!fs.existsSync(dir)) throw new Error('no cover result directory: ' + dir);

const leaves = [];
for (const f of fs.readdirSync(dir))
  if (/^cover_.*_d\d+\.json$/.test(f))
    leaves.push(...JSON.parse(fs.readFileSync(path.join(dir, f))).leaves);
leaves.sort((a, b) => a.a - b.a);
const from = Number.isFinite(fromArg) ? fromArg : leaves[0].a;
const to = Number.isFinite(toArg) ? toArg : leaves[leaves.length - 1].b;
const cells = leaves.filter(l => l.a >= from && l.b <= to);

const oldSym = process.env.SYMREM, oldVtx = process.env.VTX;
const setFlag = (k, on) => { if (on) process.env[k] = '1'; else delete process.env[k]; };

let containBad = 0, legalBad = 0, stopped = 0, checks = 0, outside = 0;
let worst = 0, minMargin = Infinity, minHub = Infinity;
const bad = [], crossingKinds = {};
for (const c of cells) {
  setFlag('SYMREM', !!c.sym); setFlag('VTX', !!c.vtx);
  minMargin = Math.min(minMargin, c.m); minHub = Math.min(minHub, c.hub);
  try {
    const q = containment(bp, bd, c.a, c.b, c.mode, samples, deg);
    checks += q.checks; outside += q.fails; worst = Math.max(worst, q.worst);
    if (q.fails) { containBad++; if (bad.length < 8) bad.push({a:c.a,b:c.b,type:'containment',detail:q.bad.slice(0,2)}); }
  } catch (e) {
    stopped++; if (bad.length < 8) bad.push({a:c.a,b:c.b,type:'containment-stopped',detail:e.message});
  }
  let v;
  try { v = checkCell(bp, bd, c.a, c.b, deg, c.mode, c.sym, c.vtx); }
  catch (e) { stopped++; if (bad.length < 8) bad.push({a:c.a,b:c.b,type:'legal-stopped',detail:e.message}); continue; }
  if (!v.ok) { legalBad++; if (bad.length < 8) bad.push({a:c.a,b:c.b,type:'legal',detail:v.why}); }
  for (const k of v.crossings) crossingKinds[k] = (crossingKinds[k] || 0) + 1;
}
if (oldSym === undefined) delete process.env.SYMREM; else process.env.SYMREM = oldSym;
if (oldVtx === undefined) delete process.env.VTX; else process.env.VTX = oldVtx;

const out = { problem: PR.name, arm:[bp,bd], range:[from,to], cells:cells.length, containBad, legalBad,
  stopped, containment:{samples,degree:deg,checks,outside,worstExcess:worst}, minMargin, minHub, crossingKinds,
  firstBad:bad };
console.log(JSON.stringify(out,null,2));
