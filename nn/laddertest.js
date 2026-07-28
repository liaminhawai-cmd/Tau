// Where does a net actually sit on the ladder, and how much does search depth move it?
//
//   node nn/laddertest.js [--model models/best.json] [--levels 9,10,11] [--depths 1,2,3]
//                         [--games 6] [--workers N] [--openingPlies 2]
//
// WHAT THIS IS FOR: adding rungs ABOVE L11. The ladder currently tops out at L11, and the question
// "can the net be L12" is not answered by how it scores against other nets -- it is answered by
// playing the top rungs directly. This plays a (level x depth) grid, the same shape run.js's
// benchmark sweep uses, because one cell is nearly useless on its own: "0-6 vs L11" says "weaker
// than L11" and nothing about how much weaker, while the CONTOUR across depths says exactly how
// far off it is and what it would cost to close.
//
// WHY DEPTH IS THE AXIS: measured elsewhere in this repo, a same-net depth-2 vs depth-1 A/B went
// 19-5, and run.js keeps a separate ladder window per depth precisely because each extra ply buys
// roughly another rung -- strength runs as a DIAGONAL across this grid, not a vertical line. So if
// the net clears L11 at depth 3 but not depth 1, then depth 2 / depth 3 / depth 4 of the SAME net
// are themselves candidate rungs, and no retraining is needed to add them.
//
// COST WARNING: search cost grows ~3.6x per ply (measured 5.6x at depth 2, ~20x at depth 3), and
// L9-L11 are themselves slow multi-second-per-move brains that search the swing finely. Depth 4 is
// ~47x a depth-1 game and depth 5 ~168x, so the default stops at 3. Every cell is an independent
// arena.js process, so --workers runs the grid concurrently (same pattern as archtest.js).
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const dir = __dirname;
const modelsDir = path.join(dir, 'models');
// Default to whatever archtest.js last crowned, so FULLTEST.bat can run the bake-off and this
// straight afterwards without the batch file having to parse a winner out of console output.
// Falls back to best.json when no bake-off has run.
const winnerFile = path.join(modelsDir, '.archtest-winner');
let dfltModel = path.join(modelsDir, 'best.json');
try {
  const w = fs.readFileSync(winnerFile, 'utf8').trim();
  if (w && fs.existsSync(w)) dfltModel = w;
} catch (e) {}
const model = arg('model', dfltModel);
const levels = arg('levels', '9,10,11').split(',').map(Number).filter(n => Number.isFinite(n) && n >= 1);
const depths = arg('depths', '1,2,3').split(',').map(Number).filter(n => Number.isFinite(n) && n >= 1);
const games = arg('games', '6');
const openingPlies = arg('openingPlies', '2');
const workers = Math.max(1, +arg('workers', String(Math.max(1, Math.min(os.cpus().length - 1, 8)))));

if (!fs.existsSync(model)) {
  console.error(`no such model: ${model}\n(pass --model, or run archtest.js first so ${path.basename(winnerFile)} exists)`);
  process.exit(1);
}

function runAsync(script, args) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(dir, script), ...args]);
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('error', reject);
    child.on('exit', code => {
      const secs = (Date.now() - t0)/1000;
      if (code === 0) resolve({ out, secs });
      else reject(new Error(`node nn/${script} ${args.join(' ')} exited ${code}\n${out.slice(-2000)}`));
    });
  });
}

async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function drain() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length || 1)) }, drain));
  return results;
}

// arena.js's closing line: "nn(best.json,D2) vs L11: 3-0  (100% of decided, ...)". Take the LAST
// match -- the live per-game tally earlier in the output has the same "N-M" shape.
const score = out => {
  const m = [...out.matchAll(/:\s*(\d+)-(\d+)(?:-\d+)?\s+\(/g)];
  return m.length ? { w: +m[m.length - 1][1], l: +m[m.length - 1][2] } : null;
};

async function main() {
  const cells = [];
  for (const d of depths) for (const lvl of levels) cells.push({ d, lvl });
  // Longest-processing-time-first. Cell cost here is wildly uneven -- search grows ~3.6x per ply,
  // so a depth-3 cell is ~13x a depth-1 cell before the opponent's own cost is counted. Feeding a
  // worker pool in natural order (D1 first) burns through the cheap cells early and then strands
  // the single most expensive cell running alone at the end while every other core sits idle;
  // total wall time ends up bounded by that one straggler. Starting the expensive cells FIRST lets
  // the cheap ones backfill around them, which is the standard LPT heuristic and provably lands
  // within 4/3 of the optimal schedule. Order doesn't affect results -- the grid below is keyed by
  // (depth, level), not by completion order.
  const cost = c => Math.pow(3.6, c.d - 1)*(1 + 0.15*c.lvl);
  cells.sort((a, b) => cost(b) - cost(a));
  console.log(`ladder placement: ${path.basename(model)}`);
  console.log(`${levels.length} level(s) x ${depths.length} depth(s) = ${cells.length} cells, ` +
              `${games} games each, up to ${workers} at once`);
  console.log(`(deeper cells are much slower -- ~5.6x per ply, and L9+ are slow brains themselves)\n`);

  const results = await pool(cells.map(c => async () => {
    const { out, secs } = await runAsync('arena.js', ['--a', 'nn:0:' + model, '--b', 'L' + c.lvl,
      '--games', games, '--depth', String(c.d), '--openingPlies', openingPlies]);
    const s = score(out);
    console.log(`  done: D${c.d} vs L${c.lvl}: ${s ? s.w + '-' + s.l : '(no result)'}  (${secs.toFixed(0)}s)`);
    return { ...c, s };
  }), workers);

  const grid = {};
  for (const r of results) grid[r.d + ':' + r.lvl] = r.s;

  // The grid, laid out the way run.js's sweep prints it: depths down, levels across, so the
  // diagonal is visible by eye.
  console.log(`\n=== ladder placement (${path.basename(model)}, ${games} games/cell) ===`);
  console.log('      ' + levels.map(l => ('L' + l).padStart(10)).join(''));
  for (const d of depths) {
    const row = levels.map(l => {
      const s = grid[d + ':' + l];
      return (s ? `${s.w}-${s.l}` : '-').padStart(10);
    }).join('');
    console.log(`  D${d}${row}`);
  }

  // Verdict per depth: the highest rung this depth beats convincingly. 60% of decided is a
  // deliberately soft bar at these sample sizes -- with only `games` games a cell cannot resolve a
  // small edge, so this is a placement, not a proof. A rung a depth wins outright is a rung that
  // depth could plausibly SIT ABOVE on the ladder.
  console.log('\n=== verdict ===');
  const clears = [];
  for (const d of depths) {
    const beaten = levels.filter(l => {
      const s = grid[d + ':' + l];
      return s && (s.w + s.l) > 0 && s.w/(s.w + s.l) >= 0.6;
    });
    const top = beaten.length ? Math.max(...beaten) : null;
    console.log(`  depth ${d}: ` + (top ? `beats up to L${top}` : `does not clearly beat L${levels[0]}`) +
                `  (${levels.map(l => { const s = grid[d + ':' + l];
                   return `L${l} ${s ? Math.round(100*s.w/Math.max(1, s.w + s.l)) + '%' : '-'}`; }).join(', ')})`);
    if (top === Math.max(...levels)) clears.push(d);
  }
  const topLevel = Math.max(...levels);
  console.log('');
  if (clears.length)
    console.log(`This net clears L${topLevel} at depth ${clears.join(', ')} — those depths are candidate rungs\n` +
                `above L${topLevel} without retraining anything. Cost is the tax: roughly 5.6x per ply per move.`);
  else
    console.log(`Nothing here clears L${topLevel} yet. The cheapest lever is another ply (each one is worth\n` +
                `roughly a rung); after that it's label quality, not net shape — see selfplay.js's own\n` +
                `capacity probe, where 3.5x the parameters bought +0.8 sign-acc.`);

  const stamp = new Date().toISOString();
  const report =
    `Tau ladder placement\n${stamp}\n\n` +
    `model: ${model}\nsettings: ${games} games/cell, openingPlies ${openingPlies}, ${workers} workers\n\n` +
    '      ' + levels.map(l => ('L' + l).padStart(10)).join('') + '\n' +
    depths.map(d => `  D${d}` + levels.map(l => {
      const s = grid[d + ':' + l];
      return (s ? `${s.w}-${s.l}` : '-').padStart(10);
    }).join('')).join('\n') + '\n';
  const reportPath = path.join(dir, 'archtest-result.txt');
  try {
    fs.appendFileSync(reportPath, report + '\n' + '-'.repeat(60) + '\n\n');
    console.log(`\nsummary appended to ${reportPath}`);
  } catch (e) {
    console.warn(`\n(could not write ${reportPath}: ${e.message})`);
  }
}

main().catch(e => { console.error('\n' + (e && e.message || e)); process.exit(1); });
