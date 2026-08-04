// Crunch everything local-only into ONE markdown file Claude can read from git, instead of a
// screenshot or a manual zip. Four things this pulls that never otherwise reach a pushed branch:
//
//   1. elo-results.json's RAW per-pair W/L/D store -- elo-summary.json only ever ships the fitted
//      Elo, and cross-fit Elo has already been shown (this session) to swing 300-700 points on
//      zero code change. The raw counts underneath it don't swing; they're just more counts.
//   2. Local training-data COMPOSITION: how many rows in nn/data/*.jsonl were actually produced by
//      each mover (L1..L11, or a net@depth). If the corpus barely contains L11-mover rows, that's
//      a real, checkable reason self-play might be slow to learn what beats L11 -- distinct from
//      "the net hasn't found it yet."
//   3. A FRESH mine of every local nn/arena-logs/*.txt -- the folder keeps growing between manual
//      hand-offs; this reads whatever's on disk right now, not a stale zip.
//   4. status.md and archtest-result.txt verbatim (small, already human-readable).
//
// Deliberately read-only: no games played, nothing retrained, nothing else touched. Safe to run
// with the trainer going, same reasoning as menu.bat's other read-only options.
'use strict';
const fs = require('fs');
const path = require('path');
const dir = __dirname;

function arg(name, dflt) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; }
const outPath = arg('out', path.join(dir, 'claude-digest.md'));
const stamp = new Date().toISOString();
const sections = [];
const say = (...a) => console.log(...a);

// ---------- 1. elo-results.json: raw pairwise store ----------
(function eloResults() {
  const p = path.join(dir, 'elo-results.json');
  if (!fs.existsSync(p)) {
    sections.push(`## Raw pairwise ratings (elo-results.json)\n\nNot found at ${p} -- either elorank.js/RANK.bat has never run on this machine, or the store lives elsewhere.\n`);
    say('elo-results.json: not found, skipping');
    return;
  }
  let store;
  try { store = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { say('elo-results.json: unreadable -- ' + e.message); return; }
  const results = store.results || {};
  const pairs = Object.entries(results);
  const totalGames = pairs.reduce((s, [, r]) => s + r.w + r.l + (r.d || 0), 0);

  // every pair touching L11 specifically -- the ground-truth games behind every L11 comparison
  // made this session, not a fitted number
  const l11 = pairs
    .filter(([k]) => k.split('|').some(id => id === 'L11'))
    .map(([k, r]) => {
      const [a, b] = k.split('|');
      const other = a === 'L11' ? b : a;
      const w = a === 'L11' ? r.w : r.l, l = a === 'L11' ? r.l : r.w;
      return { other, w, l, d: r.d || 0, n: w + l + (r.d || 0) };
    })
    .filter(x => x.n > 0)
    .sort((x, y) => y.n - x.n);

  let out = `## Raw pairwise ratings (elo-results.json)\n\n`;
  out += `${pairs.length} pairs on record, ${Math.round(totalGames).toLocaleString()} games total.\n\n`;
  out += `### Every pair on record touching L11 (ground truth, not a fit)\n\n`;
  out += `| opponent | record | n | win% |\n|---|---|---|---|\n`;
  for (const x of l11.slice(0, 80))
    out += `| ${x.other} | ${x.w}-${x.l}${x.d ? '-' + x.d : ''} | ${x.n} | ${(100 * x.w / x.n).toFixed(0)}% |\n`;
  if (l11.length > 80) out += `\n_(${l11.length - 80} more pairs omitted)_\n`;
  sections.push(out);
  say(`elo-results.json: ${pairs.length} pairs, ${l11.length} touch L11`);
})();

// ---------- 2. local training-data composition ----------
(function dataComposition() {
  const dd = path.join(dir, 'data');
  if (!fs.existsSync(dd)) { say('data/: not found'); return; }
  const files = fs.readdirSync(dd).filter(f => f.endsWith('.jsonl'));
  let totalRows = 0, totalBytes = 0;
  const byMover = new Map();     // 'L7' or 'ckpt-105@D2' -> row count
  const byLevel = new Map();     // 'L7' -> row count (ladder movers only)
  const byLineage = new Map();   // 'ckpt' / 'scratch' / 'mut' / 'deep' / 'wide' -> row count (net movers only)

  for (const f of files) {
    const fp = path.join(dd, f);
    let stat; try { stat = fs.statSync(fp); } catch (e) { continue; }
    totalBytes += stat.size;
    let text; try { text = fs.readFileSync(fp, 'utf8'); } catch (e) { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      totalRows++;
      // avoid a full JSON.parse per row across half a gig -- the mover id is a short quoted
      // string right after "mv":, cheap to pull with a regex instead of parsing every row
      const m = /"mv":"([^"]+)"/.exec(line);
      if (!m) continue;
      const mv = m[1];
      byMover.set(mv, (byMover.get(mv) || 0) + 1);
      const lvl = /^L\d+$/.exec(mv);
      if (lvl) byLevel.set(mv, (byLevel.get(mv) || 0) + 1);
      else {
        // mover ids look like best@D1 / ckpt-105@D2 / scratch-105@D1 -- the lineage is the leading
        // alpha run, before any -NNN or @Dk. (Greedy: a lazy +? here matches a single letter and
        // buckets everything under 'b'/'c'/'s'.)
        const lin = /^([a-zA-Z_]+)/.exec(mv);
        if (lin) byLineage.set(lin[1], (byLineage.get(lin[1]) || 0) + 1);
      }
    }
  }

  let out = `## Local training-data composition\n\n`;
  out += `${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB, ${totalRows.toLocaleString()} rows.\n\n`;
  out += `### Rows per ladder-brain mover (how much L-vs-net play is actually in the corpus)\n\n`;
  out += `| level | rows |\n|---|---|\n`;
  for (const lvl of [...byLevel.keys()].sort((a, b) => +a.slice(1) - +b.slice(1)))
    out += `| ${lvl} | ${byLevel.get(lvl).toLocaleString()} |\n`;
  out += `\n### Rows per net lineage (excluding ladder movers)\n\n`;
  out += `| lineage | rows |\n|---|---|\n`;
  for (const [lin, n] of [...byLineage.entries()].sort((a, b) => b[1] - a[1]))
    out += `| ${lin} | ${n.toLocaleString()} |\n`;
  const tagged = [...byMover.values()].reduce((s, n) => s + n, 0);
  out += `\n_${tagged.toLocaleString()} of ${totalRows.toLocaleString()} rows carry a mover id (older rows predate the field and are untagged)._\n`;
  sections.push(out);
  say(`data/: ${files.length} files, ${totalRows.toLocaleString()} rows, ${byMover.size} distinct movers`);
})();

// ---------- 3. fresh full-corpus arena-log mine ----------
(function arenaLogs() {
  const ld = path.join(dir, 'arena-logs');
  if (!fs.existsSync(ld)) { say('arena-logs/: not found'); return; }
  const isL = s => /^L\d+$/.test(s);
  const recs = [];
  for (const f of fs.readdirSync(ld)) {
    if (!f.endsWith('.txt')) continue;
    let body; try { body = fs.readFileSync(path.join(ld, f), 'utf8'); } catch (e) { continue; }
    let m = body.match(/^(.+?) vs (.+?): (\d+)-(\d+)(?:-(\d+))?\s+\(/m);
    let a, b, w, l;
    if (m) { a = m[1].trim(); b = m[2].trim(); w = +m[3]; l = +m[4]; }
    else {
      m = body.match(/^(.+?) (\d+) - (\d+) (.+)$/m);
      if (!m) continue;
      a = m[1].trim(); b = m[4].trim(); w = +m[2]; l = +m[3];
    }
    let net, lvl, W, L;
    if (isL(b) && !isL(a)) { net = a; lvl = b; W = w; L = l; }
    else if (isL(a) && !isL(b)) { net = b; lvl = a; W = l; L = w; }
    else continue;
    if (lvl !== 'L11') continue;
    recs.push({ date: f.slice(0, 10), net, W, L });
  }
  const byDay = new Map();
  for (const r of recs) {
    const v = byDay.get(r.date) || { w: 0, l: 0 };
    v.w += r.W; v.l += r.L; byDay.set(r.date, v);
  }
  let out = `## Fresh mine of local arena-logs/ (vs L11 only, by day, all nets pooled)\n\n`;
  out += `${recs.length} game-log entries touch L11.\n\n`;
  out += `| date | record | n | win% |\n|---|---|---|---|\n`;
  for (const [d, v] of [...byDay.entries()].sort()) {
    const n = v.w + v.l;
    out += `| ${d} | ${v.w}-${v.l} | ${n} | ${(100 * v.w / n).toFixed(0)}% |\n`;
  }
  sections.push(out);
  say(`arena-logs/: ${recs.length} vs-L11 entries across ${byDay.size} days`);
})();

// ---------- 4. status.md and archtest-result.txt, verbatim ----------
(function verbatim() {
  for (const [name, title, tailChars] of [
    ['status.md', 'Live run.js status (status.md)', 4000],
    ['archtest-result.txt', 'Ladder-placement / bake-off history (archtest-result.txt, tail)', 6000],
  ]) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) { sections.push(`## ${title}\n\nNot found.\n`); continue; }
    let text; try { text = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }
    const tail = text.length > tailChars ? '...(truncated)...\n' + text.slice(-tailChars) : text;
    sections.push(`## ${title}\n\n\`\`\`\n${tail}\n\`\`\`\n`);
    say(`${name}: included (${text.length} bytes)`);
  }
})();

// ---------- write ----------
const header = `# Tau -- local digest for Claude\n\n_Generated ${stamp} on ${process.env.COMPUTERNAME || 'unknown host'}._\n\n` +
  `Read-only snapshot: no games played, nothing retrained. Regenerate any time with menu.bat option 18.\n\n---\n\n`;
fs.writeFileSync(outPath, header + sections.join('\n---\n\n'));
say(`\nwrote ${outPath}`);
