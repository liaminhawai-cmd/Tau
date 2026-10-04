// One table of where the proof stands: for each blue arm, the stop angles covered by proved cells, whether
// they tile, how many cells, the smallest margin, and what the audit, containment and legality checks found.
//   node status.js          (reads results/arm_*; arm (1,-) also from the first pipeline in results/)
'use strict';
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, 'results');
// the engine's largest fully executed target per arm (six-arms/blue-limits.js) and the 3-degree-call limit
const ARMS = [
  { bp: 0, bd: -1, L: 63.375, B: 63.692659668 }, { bp: 0, bd: 1, L: 44.25, B: 44.343482055 },
  { bp: 1, bd: -1, L: 16.5, B: 16.826501816 }, { bp: 1, bd: 1, L: 14.625, B: 14.788562189 },
  { bp: 2, bd: -1, L: 15.75, B: 15.975495885 }, { bp: 2, bd: 1, L: 4.875, B: 4.996359600 },
];
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
// the .out files hold a JSON object, followed by the shell's timing lines when run through `time`
const parseOut = f => {
  try { const t = fs.readFileSync(f, 'utf8'); return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1).replace(/\n/g, ' ')); } catch (e) { return null; }
};

function collect(a) {
  const tag = `${a.bp}_${a.bd > 0 ? 'p' : 'm'}`, dir = path.join(R, `arm_${tag}`);
  let covers = [], audits = [], contain = [], legal = null, source = `arm_${tag}`;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (/^cover_.*_d\d+\.json$/.test(f)) covers.push(path.join(dir, f));
      else if (/^audit_.*\.out$/.test(f)) audits.push(path.join(dir, f));
      else if (/^containment.*\.txt$/.test(f)) contain.push(path.join(dir, f));
      else if (f === 'legal.out') legal = path.join(dir, f);
    }
  }
  if (!covers.length && a.bp === 1 && a.bd < 0) {            // the first pipeline's results
    source = 'results (first pipeline)';
    for (const f of fs.readdirSync(R)) {
      if (/^cover_.*_d6\.json$/.test(f)) covers.push(path.join(R, f));
      else if (/^audit_.*\.out$/.test(f)) audits.push(path.join(R, f));
      else if (f === 'containment.txt') contain.push(path.join(R, f));
    }
  }
  return { covers, audits, contain, legal, source };
}

function summarise(a) {
  const c = collect(a);
  const leaves = []; let failRecords = 0;
  for (const f of c.covers) { const j = readJSON(f); leaves.push(...j.leaves); failRecords += j.fails.length; }
  if (!leaves.length) return { ...a, cells: 0 };
  leaves.sort((p, q) => p.a - q.a);
  const gaps = [];
  for (let i = 1; i < leaves.length; i++) if (leaves[i].a !== leaves[i - 1].b) gaps.push([leaves[i - 1].b, leaves[i].a]);
  const lo = leaves[0].a, hi = leaves[leaves.length - 1].b;
  const weakest = leaves.reduce((m, l) => (l.m < m.m ? l : m));
  // CPU seconds the covers took, from the "seconds" each piece's run printed (failed attempts included)
  let cpu = 0;
  for (const f of c.covers) { const o = parseOut(f.replace(/_d\d+\.json$/, '.out')); if (o && o.seconds) cpu += o.seconds; }
  let aud = { cells: 0, reproduced: 0, mismatches: 0 };
  for (const f of c.audits) { const o = parseOut(f); if (o) { aud.cells += o.cells; aud.reproduced += o.reproduced; aud.mismatches += o.mismatches; } }
  let con = { cells: 0, comparisons: 0, outside: 0 };
  for (const f of c.contain) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = /(\d+) comparisons at \d+ angles, (\d+) outside/.exec(line);
      if (m) { con.cells++; con.comparisons += +m[1]; con.outside += +m[2]; }
    }
  }
  let leg = null;
  if (c.legal) { const o = parseOut(c.legal); if (o) leg = { cells: o.cells, legal: o.legalCells, edge: (o.pivotAtBandEdge || []).length, other: o.smallestClearanceOfOtherPairs }; }
  const bySym = leaves.reduce((m, l) => { const k = l.sym ? 'sym' : 'std'; m[k] = (m[k] || 0) + 1; return m; }, {});
  return { ...a, source: c.source, lo, hi, tiled: gaps.length === 0, gaps, failRecords, cells: leaves.length, widest: Math.max(...leaves.map(l => l.b - l.a)),
    narrowest: Math.min(...leaves.map(l => l.b - l.a)), cpu, minMargin: weakest.m, weakest: [weakest.a, weakest.b], minHub: Math.min(...leaves.map(l => l.hub)), bySym, aud, con, leg };
}

const rows = ARMS.map(summarise);
const nm = a => `(${a.bp},${a.bd < 0 ? '−' : '+'})`;
console.log('| Blue arm | Engine range [2°, B] | Proved range | Tiled | Cells | Cover CPU | Smallest margin | Audit | Containment | Red swing legal |');
console.log('| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |');
for (const r of rows) {
  if (!r.cells) { console.log(`| ${nm(r)} | 2 – ${r.B.toFixed(4)} | none | – | 0 | – | – | – | – | – |`); continue; }
  const covered = r.lo <= 2 && r.hi >= r.B;
  console.log(`| ${nm(r)} | 2 – ${r.B.toFixed(4)} | ${r.lo} – ${r.hi}${covered ? '' : ' (partial)'} | ${r.tiled ? 'yes' : 'NO'} | ${r.cells}${r.bySym.sym ? ` (${r.bySym.sym} with remToSym)` : ''} | ${r.cpu ? (r.cpu / 60).toFixed(0) + ' min' : '–'} | ${r.minMargin.toFixed(4)}u | ${r.aud.cells ? `${r.aud.reproduced}/${r.aud.cells} reproduced` : 'not run'} | ${r.con.cells ? `${r.con.cells} cells, ${r.con.comparisons} comparisons, ${r.con.outside} outside` : 'not run'} | ${r.leg ? `${r.leg.legal}/${r.leg.cells}${r.leg.edge ? ` (${r.leg.edge} pivot-edge)` : ''}` : 'not run'} |`);
}
if (process.argv[2] === '--json') console.log(JSON.stringify(rows, null, 1));
