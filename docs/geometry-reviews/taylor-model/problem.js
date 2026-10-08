// A proof problem: the continuous seed position, which side moves first, the witness arm that
// throws the mover, and the witness's swing length. cert2.js (and its helpers contain2.js,
// legal-red.js, six-arms/samples123.js) read exactly this instead of hard-coding the Brief 6 seed.
// Values must reproduce the shipped engine's binary64 numbers exactly: the seed components are
// written as decimal literals so JSON.parse yields the same doubles as the code literals they replace.
'use strict';
const fs = require('fs');
const path = require('path');

// Brief 6 is the default problem. Its values are the ones cert2.js has always used.
const BRIEF6 = {
  name: 'brief6',
  seed: {
    blue: { x: -27.3934, y: -36.4088, rot: 1.2052 },
    red:  { x: -11.7593, y: -23.2838, rot: 2.9442 },
  },
  firstMover: 0,                // 0 = blue (the reply side) moves first, 1 = red
  witness: { pivot: 0, dir: -1 }, // the mover's opponent: red pins foot 0 and swings direction -1
  kRed: 123,                    // witness swing length, substeps of DELTA (0.375 degrees)
  ko: 0,                        // ko / move-cap state (the dead-point record's `k` field)
};

// Resolve opts.problem to a problem object. Accepts nothing (default Brief 6), a name like
// "target1" (loaded from problems/<name>.json), a path to a .json file, or an object.
function resolveProblem(opts) {
  const p0 = opts && opts.problem;
  // Existing library callers may omit opts.problem; in that case honor PROBLEM so CLI runs
  // cannot silently fall back to the Brief 6 seed.
  const p = p0 == null ? process.env.PROBLEM : p0;
  if (p == null || p === '') return BRIEF6;
  if (typeof p === 'string') {
    const file = path.isAbsolute(p) ? p : path.join(__dirname, 'problems', p.endsWith('.json') ? p : p + '.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return p;
}

// The problem named by the PROBLEM env var (used by the CLI tools), defaulting to Brief 6.
function fromEnv() {
  return resolveProblem();
}

// Keep the legacy Brief 6 result layout for existing corpora; named problems get an isolated subtree.
// This also keeps independent problem covers from ever reusing another problem's labels or cells.
// The isolation is part of the proof-input provenance: a named problem never consumes Brief 6 cover cells.
function armResultsDir(problem, bp, bd) {
  const root = problem && problem.name && problem.name !== BRIEF6.name ? problem.name : null;
  return path.join(__dirname, 'results', ...(root ? [root] : []), 'arm_' + bp + '_' + (bd > 0 ? 'p' : 'm'));
}

module.exports = { BRIEF6, resolveProblem, fromEnv, armResultsDir };
