// Rank every brain we have -- ladder rungs AND neural nets at several search depths -- on ONE
// scale, so retromine.js's interleaved strength ladder can be built from measurement instead of
// guesswork. Output is a fractional rank per net ("wide.json at depth 2 plays like L4.6"), plus a
// live table; retromine.js reads the JSON summary directly for its strength axis.
//
//   node nn/elorank.js [--games 4] [--depths 1,2,3] [--levels 1,2,3,4,5,6,7,8,9,10,11]
//                      [--models a.json,b.json] [--spread 6] [--workers N]
//                      [--out nn/elo-results.json] [--saveData nn/data/elo.jsonl] [--refit]
//
// WHY ELO AND NOT A FULL ROUND ROBIN. A full matrix over ~20 brains is 190 pairs; at the depth-3
// game costs measured in this project (5-8 minutes each) that is days, and most of those cells are
// foregone anyway (L1 vs best-at-D3 tells you nothing you didn't know). Bradley-Terry only needs
// the comparison GRAPH to be connected -- ratings propagate transitively, so a well-chosen sparse
// subset yields the same global ordering for a fraction of the games. The pairing below is built
// for exactly that connectivity (see buildPairs).
//
// PRECISION IS DELIBERATELY LOW. These brains are spiky and non-transitive -- today's data has the
// same net beating L8 and losing to L7 in the same sweep -- so chasing tight confidence intervals
// on any single pairing is wasted compute. A single-number summary that is roughly right across
// the whole field is what the interleaved ladder actually needs; being half a rung off costs
// almost nothing there, while being unranked costs the whole design.
//
// LADDER RUNGS ARE THE ANCHOR. Fitting nets alone would give a self-consistent scale with no
// meaning ("net A is 120 Elo above net B" -- above WHAT?). Including L1..L11 as ordinary players
// makes the fitted ladder Elos a measured yardstick and every net's rank an interpolation against
// it. Permanent does NOT mean privileged scheduling: ladders and nets now use the same strength,
// freshness, uncertainty and pair-novelty score. Ladder identity is special only because rungs are
// never retired and continue to define the fixed yardstick.
//
// Raw per-pair results are checkpointed to --out after every pair, so a run that is interrupted
// (or a machine that gets closed) resumes where it stopped instead of replaying. --refit skips
// playing entirely and just re-runs the fit over whatever is already stored.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function atomicWrite(destPath, data) {
  const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, destPath);
}
function atomicCopy(srcPath, destPath) {
  const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(srcPath, tmp);
  fs.renameSync(tmp, destPath);
}

const dir = __dirname;
const modelsDir = path.join(dir, 'models');
const gamesPerPair = Math.max(1, +arg('games', 4));
// Compatibility knob only. Ladder pairs no longer receive a larger default batch than anything
// else; the adaptive score below decides whether they deserve to be picked at all.
const ladderGames = Math.max(1, +arg('ladderGames', gamesPerPair));
const depths = (arg('depths', '1,2,3') || '').split(',').map(Number).filter(d => d >= 1);
const levels = (arg('levels', '') || '').split(',').map(Number).filter(n => n >= 1);
const os = require('os');
const workers = Math.max(1, +arg('workers', Math.max(1, Math.min(os.cpus().length - 1, 14))));
const outPath = arg('out', path.join(dir, 'elo-results.json'));
const saveData = arg('saveData', null);
const refitOnly = process.argv.includes('--refit');
const spread = Math.max(0, +arg('spread', 6));
const openingPlies = +arg('openingPlies', 4);
const randomStartFrac = +arg('randomStartFrac', 0);
const budgetHours = +arg('budgetHours', 0);
const KOMI_LOSS = 0.3;
const dryRun = process.argv.includes('--dryrun');
const focusRaw = (arg('focus', '') || '').split(',').map(x => x.trim()).filter(Boolean);
const focusPaths = focusRaw.map(x => path.basename(x, '.json'));
const allowPlayers = new Set((arg('allowPlayers', '') || '').split(',').map(x => x.trim()).filter(Boolean));
const faceAllowed = id => !allowPlayers.size || allowPlayers.has(id);
const summaryPath = arg('summary', null);
const focusPairsOnly = arg('focusPairs', '1') !== '0';
// Kept as parsed compatibility arguments because older launchers may pass them. There is no anchor
// quota and no ladder-only need function anymore.
const anchorShare = Math.min(0.9, Math.max(0, +arg('anchorShare', 0)));
const ladderNeedGames = Math.max(1, +arg('ladderNeedGames', 12));
// Strength is intentionally the dominant term. Exponential Elo weighting avoids the field's weakest
// outlier changing everybody else's scale; the small floor still permits exploration and mandatory
// first coverage guarantees a brand-new face cannot be starved before it has a rating.
const strengthExplore = Math.min(0.5, Math.max(0.001, +arg('strengthExplore', 0.03)));
const STRENGTH_TEMP = Math.max(50, +arg('strengthTemp', 300));
const FRESHNESS_FLOOR = Math.min(0.9, Math.max(0, +arg('freshnessFloor', 0.10)));
const PAIR_NOVELTY_FLOOR = Math.min(0.9, Math.max(0, +arg('pairNoveltyFloor', 0.20)));
const CI_SHARE = Math.min(0.5, Math.max(0, +arg('ciShare', 0.15)));
const CLOSE_FLOOR = Math.min(0.9, Math.max(0, +arg('closeFloor', 0.25)));
const SEC_PER_WEIGHT = 55;
let totalWeight = 0;
void anchorShare; void ladderNeedGames;

// --- who is in the field ----------------------------------------------------------------------
function discoverModels() {
  const explicit = (arg('models', '') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (explicit.length) return explicit;
  let files = [];
  try { files = fs.readdirSync(modelsDir); } catch (e) { return []; }
  const pick = [];
  for (const n of ['best.json', 'wide.json', 'ultra.json', 'deep.json', 'l15_value.json', 'scratch.json'])
    if (files.includes(n)) pick.push(path.join(modelsDir, n));
  const ck = files.filter(f => /^ckpt-\d+\.json$/.test(f))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  if (spread > 0 && ck.length) {
    const step = Math.max(1, Math.floor(ck.length/spread));
    for (let i = 0; i < ck.length && pick.length < 40; i += step) pick.push(path.join(modelsDir, ck[i]));
    const last = path.join(modelsDir, ck[ck.length - 1]);
    if (!pick.includes(last)) pick.push(last);
  }
  let keepDual = [], haveDualRegistry = false;
  try {
    const pop = JSON.parse(fs.readFileSync(