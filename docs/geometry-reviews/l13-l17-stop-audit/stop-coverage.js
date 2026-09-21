'use strict';
// Opus task A, steps 2-3: what defender stops do L11, internal L13 and internal L17 actually
// enumerate at the SAME post-root position, and is the audited foot-0/+1/2-degree defence among
// them?
//
// Run: node stop-coverage.js /path/to/a/Tau/checkout [--json out.json]
//
// The three searches do not coexist in any one revision. Internal L13 (AI_LADDER[12], kind 'opp2')
// is on main; internal L17 (AI_LADDER[16], kind 'dead') is not, so a checkout that has L17 must be
// given explicitly. Whatever is missing is reported as absent rather than silently skipped.
//
// Nothing here changes a game or search function. The engine source is patched in memory only to
// (a) seed and export the internal functions, (b) push a record at the exact line where each
// search commits to a reply, and (c) disable the engine cache so a run is reproducible.
const fs = require('fs'), path = require('path'), Module = require('module');

const DEG = 180 / Math.PI;
// The audited position. Pose is x, y, rot(rad) for piece 0 then piece 1; piece 0 (the defender) is
// to move, piece 1 is the attacker whose continuation score claims a win.
const POSE = [-40.2848, 3.7263, 1.8209, -30.2905, 12.3529, 1.5755];
const VICTIM = 0;
const WITNESS = { pivotIdx: 0, dir: 1, deg: 2 };

// Every internal name this probe wants seeded into the extraction closure and exported. Names that
// do not exist in the given checkout are dropped, and their absence is part of the report.
const WANT = ['ladderScore3', 'ladderScore3Gen', 'ladderRestore', 'ladderOppReplies', 'ladderRoots3',
  'ladderDeadEscape', 'ladderDeadGuard', 'ladderPlanDead', 'deadCertVerdict', 'DEAD_CERTS',
  'DEAD_STATS', 'HARD_WIN_BONUS', 'HARD_MIN_MOVE_RAD', 'AI_STEP_RAD', 'AI_SAFETY_CAP_RAD',
  'PARK_LO', 'PARK_HI', 'SHOVE_EPS'];

function loadEngine(root) {
  const enginePath = path.resolve(root, 'nn/engine.js');
  const indexSrc = fs.readFileSync(path.resolve(root, 'index.html'), 'utf8');
  const has = n => new RegExp(`^(?:function\\s*\\*?|class|const|let)\\s+${n}\\b`, 'm').test(indexSrc);
  const present = WANT.filter(has), missing = WANT.filter(n => !has(n));

  let src = fs.readFileSync(enginePath, 'utf8');
  src = src
    .replace('const SEEDS = [', `const SEEDS = [${present.map(n => `'${n}',`).join('')}`)
    // reproducibility: never read or write the on-disk extraction cache
    .replace('if (cached.key === cacheKey', 'if (false && cached.key === cacheKey')
    .replace('fs.writeFileSync(ENGINE_CACHE_PATH,', 'false && fs.writeFileSync(ENGINE_CACHE_PATH,')
    // a recorder the extracted code can reach, shared by identity with this module
    .replace('const sandbox = { Math, console };',
             'const sandbox = { Math, console, REC: (globalThis.__TAU_REC = globalThis.__TAU_REC || {}) };')
    .replace('__exports = {', `__exports = {${present.map(n => `${n},`).join('')}`);

  // (b) the two recording points. Both are the line on which a search commits to a reply, so a
  // recorded entry is a reply that search really examined, not one this probe reconstructed.
  //   L11: ladderScore3Gen's opponent loop, right after the swing-to-the-jam that defines the reply.
  const l11Needle = 'const onet=simMoveToLimit(op,od);';
  const l11Hit = src.indexOf(l11Needle) >= 0 || true;   // lives in index.html, patched below instead
  return { enginePath, src, present, missing, indexSrc };
}

// The index.html text is what actually carries the searches, and nn/engine.js evals it. Patch the
// two recording points in the HTML text the extractor reads, by wrapping fs.readFileSync for that
// one path while the engine module is compiled.
function instrumentIndex(indexSrc) {
  const notes = [];
  let out = indexSrc;
  const sub = (needle, replacement, tag) => {
    const n = out.split(needle).length - 1;
    notes.push({ tag, sites: n });
    if (n > 0) out = out.split(needle).join(replacement);
  };
  // L11 -- ladderScore3Gen: the opponent's six swing-to-the-jam endpoints.
  sub('const onet=simMoveToLimit(op,od);',
      'const onet=simMoveToLimit(op,od);' +
      'if(REC.on)(REC.l11=REC.l11||[]).push({pivotIdx:op,dir:od,deg:Math.abs(G.netRad)*180/Math.PI,' +
      'legal:Math.abs(onet)>=HARD_MIN_MOVE_RAD&&!G.pieces[1-idx].anyFootOff()});',
      'l11-reply');
  // L17 -- ladderDeadEscape: every stop the dense test puts on its list, interior grid and endpoint.
  sub('lastMark=a; stops.push({pivotIdx:pv,dir,targetRad:a,snap:takeSnap()}); }',
      'lastMark=a; stops.push({pivotIdx:pv,dir,targetRad:a,snap:takeSnap()});' +
      'if(REC.on)(REC.l17=REC.l17||[]).push({pivotIdx:pv,dir,deg:a*180/Math.PI,kind:"grid"}); }',
      'l17-grid');
  sub('stops.push({pivotIdx:pv,dir,targetRad:Math.abs(G.netRad),snap:takeSnap()});',
      'stops.push({pivotIdx:pv,dir,targetRad:Math.abs(G.netRad),snap:takeSnap()});' +
      'if(REC.on)(REC.l17=REC.l17||[]).push({pivotIdx:pv,dir,deg:Math.abs(G.netRad)*180/Math.PI,kind:"endpoint"});',
      'l17-endpoint');
  return { out, notes };
}

function build(root) {
  const { enginePath, src, present, missing, indexSrc } = loadEngine(root);
  const { out: patchedIndex, notes } = instrumentIndex(indexSrc);
  const indexPath = path.resolve(root, 'index.html');
  const realRead = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) {
    if (typeof p === 'string' && path.resolve(p) === indexPath) return patchedIndex;
    return realRead.call(this, p, ...rest);
  };
  let E;
  try {
    const m = new Module(enginePath, module);
    m.filename = enginePath;
    m.paths = Module._nodeModulePaths(path.dirname(enginePath));
    m._compile(src, enginePath);
    E = m.exports.createEngine();
  } finally { fs.readFileSync = realRead; }
  return { E, present, missing, notes, REC: globalThis.__TAU_REC };
}

const key = s => `${s.pivotIdx}${s.dir > 0 ? '+' : '-'}@${s.deg.toFixed(3)}`;
const isWitness = (s, tol) => s.pivotIdx === WITNESS.pivotIdx && s.dir === WITNESS.dir &&
                              Math.abs(s.deg - WITNESS.deg) <= (tol == null ? 1e-6 : tol);

function main() {
  const root = path.resolve(process.argv[2] || process.cwd());
  const jsonAt = process.argv.indexOf('--json');
  const { E, present, missing, notes, REC } = build(root);
  const report = { checkout: root, present, missing, patchSites: notes };

  const load = () => {
    E.newGame();
    const g = E.getG();
    g.pieces.forEach((q, i) => { q.x = POSE[3 * i]; q.y = POSE[3 * i + 1]; q.rot = POSE[3 * i + 2]; });
    g.active = VICTIM;
    return g;
  };
  const att = 1 - VICTIM;

  // --- ladder mapping, from the live table rather than from a document ------------------------
  report.ladder = E.AI_LADDER.map((d, i) => ({
    aiLadderIndex: i, internalName: `L${i + 1}`, kind: d.kind,
    label: d.label || null, experimental: d.experimental || null,
  }));
  const byInternal = n => E.AI_LADDER[n - 1] || null;
  const L11 = byInternal(11), L13 = byInternal(13), L17 = byInternal(17);
  report.mapping = {
    L11: L11 && { kind: L11.kind, o: L11.o },
    L13: L13 && { kind: L13.kind, label: L13.label, o: L13.o },
    L17: L17 ? { kind: L17.kind, label: L17.label, o: L17.o } : 'ABSENT from this checkout',
  };

  // --- L11: the six endpoints ladderScore3 actually scores -------------------------------------
  load();
  REC.on = true; REC.l11 = []; REC.l17 = [];
  const score = E.ladderScore3(att, L11.w, E.takeSnap());
  REC.on = false;
  report.l11 = {
    continuationScore: score,
    claimsWin: score > E.HARD_WIN_BONUS / 2,
    repliesExamined: REC.l11.slice(),
    witnessPresent: REC.l11.some(s => isWitness(s)),
    minInteriorStopDeg: null,   // L11 has no interior stops by construction
  };

  // --- L13: ladderOppReplies, then its own oppKeep pre-filter -----------------------------------
  if (E.ladderOppReplies && L13) {
    load();
    const s1 = E.takeSnap();
    const raw = E.ladderOppReplies(1 - att, att, L13.o, s1)
      .map(r => ({ pivotIdx: r.pivotIdx, dir: r.dir, deg: Math.abs(r.targetRad) * DEG }));
    // L13 ranks replies by one cheap eval and gives the follow-up ply to the oppKeep worst.
    const scored = [];
    for (const r of raw) {
      E.ladderRestore(s1); E.setActive(1 - att); E.pinFoot(r.pivotIdx);
      let g = 0;
      const target = r.deg / DEG;
      while (!E.getG().atLimit && Math.abs(E.getG().netRad) < target && g++ < 500)
        E.applySwing((r.dir) * Math.min(E.AI_STEP_RAD, target - Math.abs(E.getG().netRad)));
      const G = E.getG();
      if (Math.abs(G.netRad) < E.HARD_MIN_MOVE_RAD) continue;
      if (G.pieces[1 - att].anyFootOff()) continue;
      scored.push({ ...r, v: G.pieces[att].anyFootOff() ? -E.HARD_WIN_BONUS : E.ladderEval(att, L13.w) });
    }
    scored.sort((a, b) => a.v - b.v);
    const keep = scored.slice(0, L13.o.oppKeep || 6);
    const interior = raw.filter(r => !raw.some(q => q.pivotIdx === r.pivotIdx && q.dir === r.dir && q.deg > r.deg));
    report.l13 = {
      oppKeep: L13.o.oppKeep || 6,
      generated: raw.length, survivedReplay: scored.length, keptForFollowUp: keep.length,
      replies: raw,
      witnessGenerated: raw.some(r => isWitness(r, 1e-6)),
      witnessKept: keep.some(r => isWitness(r, 1e-6)),
      minStopDegPerArm: [0, 1, 2].flatMap(p => [1, -1].map(d => {
        const on = raw.filter(r => r.pivotIdx === p && r.dir === d).map(r => r.deg).sort((a, b) => a - b);
        return { pivotIdx: p, dir: d, stopsDeg: on };
      })),
    };
    void interior;
  } else report.l13 = 'ladderOppReplies ABSENT from this checkout';

  // --- L17: the dense escape test's own stop list -----------------------------------------------
  if (E.ladderDeadEscape && L17) {
    load();
    REC.on = true; REC.l17 = [];
    if (E.DEAD_STATS) for (const k of Object.keys(E.DEAD_STATS)) if (typeof E.DEAD_STATS[k] === 'number' && k.indexOf('nearest') !== 0) E.DEAD_STATS[k] = 0;
    const esc = E.ladderDeadEscape(VICTIM, L17.o.deadDeg || 6, L17.o.deadStops || 160);
    REC.on = false;
    report.l17 = {
      deadDeg: L17.o.deadDeg, deadStops: L17.o.deadStops,
      guardCands: L17.o.guardCands, guardReplies: L17.o.guardReplies,
      stopsEnumerated: REC.l17.length,
      stops: REC.l17.slice(),
      witnessEnumerated: REC.l17.some(s => isWitness(s, 1e-6)),
      verdict: esc ? 'escape found (refuses to certify)' : 'no escape found on its grid (certifies dead)',
      escape: esc ? { pivotIdx: esc.pivotIdx, dir: esc.dir, deg: Math.abs(esc.targetRad) * DEG } : null,
      budgetOut: E.DEAD_STATS ? E.DEAD_STATS.budgetOut : null,
      stats: E.DEAD_STATS ? { ...E.DEAD_STATS } : null,
    };
  } else report.l17 = 'ladderDeadEscape ABSENT from this checkout (internal L17 is not in AI_LADDER here)';

  // --- ground truth: the full escape set at fine resolution --------------------------------------
  // The same punishment test ladderDeadEscape applies (can the attacker throw the defender with one
  // of its six swing-to-the-jam answers), applied to a fine sweep of the defender's own stops.
  // Two calling schedules, because they are different finite maps: `coarse` replays a stop the way
  // both searches replay theirs (3-degree applySwing calls, last call short), `fine` replays it the
  // way the published reproduce.js built the witness pose (1-degree calls).
  const punished = () => {
    const s1 = E.takeSnap(); let hit = false;
    for (let ap = 0; ap < 3 && !hit; ap++) for (const ad of [1, -1]) {
      E.ladderRestore(s1); E.setActive(att);
      const anet = E.simMoveToLimit(ap, ad);
      if (Math.abs(anet) < E.HARD_MIN_MOVE_RAD) continue;
      if (E.getG().pieces[att].anyFootOff()) continue;
      if (E.getG().pieces[1 - att].anyFootOff()) { hit = true; break; }
    }
    return hit;
  };
  const replay = (pv, dir, deg, callDeg) => {
    load(); E.pinFoot(pv);
    const target = deg / DEG, call = callDeg / DEG;
    const G = E.getG(); let g = 0;
    while (!G.atLimit && Math.abs(G.netRad) < target - 1e-12 && g++ < 5000)
      E.applySwing(dir * Math.min(call, target - Math.abs(G.netRad)));
    return { reached: Math.abs(G.netRad) * DEG, atLimit: G.atLimit,
             legal: Math.abs(G.netRad) >= E.HARD_MIN_MOVE_RAD && !G.pieces[1 - att].anyFootOff() };
  };
  const sweepMax = {};
  for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
    load(); E.pinFoot(pv);
    const G = E.getG(); let g = 0;
    while (Math.abs(G.netRad) < E.AI_SAFETY_CAP_RAD && !G.atLimit && g++ < 500) E.applySwing(dir * E.AI_STEP_RAD);
    sweepMax[`${pv}${dir > 0 ? '+' : '-'}`] = Math.abs(G.netRad) * DEG;
  }
  report.armLimitsDeg = sweepMax;

  const escapesFor = callDeg => {
    const rows = [];
    for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
      const lim = sweepMax[`${pv}${dir > 0 ? '+' : '-'}`];
      for (let deg = 2; deg <= lim + 1e-9; deg = +(deg + 0.25).toFixed(6)) {
        const r = replay(pv, dir, deg, callDeg);
        if (!r.legal) continue;
        if (Math.abs(r.reached - deg) > 1e-6) continue;   // arm jammed short of the asked angle
        if (E.getG().pieces[att].anyFootOff()) { rows.push({ pivotIdx: pv, dir, deg, escapes: true, why: 'threw the attacker' }); continue; }
        rows.push({ pivotIdx: pv, dir, deg, escapes: !punished(), why: null });
      }
    }
    return rows;
  };
  for (const [name, callDeg] of [['coarse3deg', 3], ['fine1deg', 1]]) {
    const rows = escapesFor(callDeg);
    const esc = rows.filter(r => r.escapes);
    report[`groundTruth_${name}`] = {
      callScheduleDeg: callDeg, sampledStops: rows.length, escapingStops: esc.length,
      escapesByArm: [0, 1, 2].flatMap(p => [1, -1].map(d => {
        const on = esc.filter(r => r.pivotIdx === p && r.dir === d).map(r => r.deg);
        return { pivotIdx: p, dir: d, count: on.length, minDeg: on.length ? Math.min(...on) : null,
                 maxDeg: on.length ? Math.max(...on) : null, stopsDeg: on };
      })),
      witnessEscapes: esc.some(r => isWitness(r, 1e-9)),
    };
  }

  // --- why the dense grid's first mark is where it is ------------------------------------------
  // ladderDeadEscape marks a stop when |netRad| has advanced `deadDeg` since the last mark AND the
  // defender has no foot off board. The sweep itself advances in AI_STEP_RAD calls, so the marks
  // land on whatever the sweep can actually reach, not on multiples of deadDeg.
  report.sweepTrace = [];
  for (let pv = 0; pv < 3; pv++) for (const dir of [1, -1]) {
    load(); E.pinFoot(pv);
    const G = E.getG(); let g = 0; const steps = [];
    while (Math.abs(G.netRad) < E.AI_SAFETY_CAP_RAD && !G.atLimit && g++ < 500) {
      E.applySwing(dir * E.AI_STEP_RAD);
      steps.push({ deg: +(Math.abs(G.netRad) * DEG).toFixed(4),
                   defenderFootOff: G.pieces[VICTIM].anyFootOff(), atLimit: G.atLimit });
    }
    report.sweepTrace.push({ pivotIdx: pv, dir, steps });
  }

  // --- what each search's node verdict actually is ------------------------------------------------
  // L13's minimax is inline in ladderPlan13Gen, so this replicates that block exactly (see the
  // `reply:` loop there) with no sibling alpha, which is the right reading for one isolated node.
  const bestAnswerFor = snapTaken => {
    const s2 = snapTaken; let bf = -Infinity;
    for (let fp = 0; fp < 3 && bf < E.HARD_WIN_BONUS / 2; fp++) for (const fd of [1, -1]) {
      E.ladderRestore(s2); E.setActive(att);
      const fnet = E.simMoveToLimit(fp, fd);
      if (Math.abs(fnet) < E.HARD_MIN_MOVE_RAD) continue;
      if (E.getG().pieces[att].anyFootOff()) continue;
      const fs = E.getG().pieces[1 - att].anyFootOff()
        ? E.HARD_WIN_BONUS + E.ladderEval(att, L11.w) : E.ladderEval(att, L11.w);
      if (fs > bf) bf = fs;
    }
    return bf;
  };
  if (report.l13 && report.l13.replies) {
    load();
    const s1 = E.takeSnap();
    let worst = Infinity, argmin = null;
    for (const r of report.l13.replies) {
      E.ladderRestore(s1); E.setActive(1 - att); E.pinFoot(r.pivotIdx);
      const target = r.deg / DEG; const G = E.getG(); let g = 0;
      while (!G.atLimit && Math.abs(G.netRad) < target && g++ < 500)
        E.applySwing(r.dir * Math.min(E.AI_STEP_RAD, target - Math.abs(G.netRad)));
      if (Math.abs(G.netRad) < E.HARD_MIN_MOVE_RAD) continue;
      if (G.pieces[1 - att].anyFootOff()) continue;
      let rs;
      if (G.pieces[att].anyFootOff()) rs = -E.HARD_WIN_BONUS;
      else { const bf = bestAnswerFor(E.takeSnap()); rs = bf === -Infinity ? E.ladderEval(att, L11.w) : bf; }
      if (rs < worst) { worst = rs; argmin = { ...r, rs }; }
    }
    report.l13.nodeScore = worst;
    report.l13.claimsWin = worst > E.HARD_WIN_BONUS / 2;
    report.l13.worstReply = argmin;
  }

  // --- each search's grid against the ground-truth escape set --------------------------------------
  const truth = new Set(report.groundTruth_coarse3deg.escapesByArm
    .flatMap(a => a.stopsDeg.map(d => `${a.pivotIdx}${a.dir > 0 ? '+' : '-'}@${d}`)));
  const inTruth = s => {
    // nearest sampled ground-truth stop, since the searches' stops are not on the 0.25-degree grid
    const arm = `${s.pivotIdx}${s.dir > 0 ? '+' : '-'}`;
    const row = report.groundTruth_coarse3deg.escapesByArm
      .find(a => a.pivotIdx === s.pivotIdx && a.dir === s.dir);
    if (!row || !row.count) return false;
    return row.minDeg - 0.25 <= s.deg && s.deg <= row.maxDeg + 0.25;
  };
  report.gridVsEscape = {
    note: 'a search stop counts as escaping when it falls inside that arm\'s sampled escape band',
    L11: report.l11.repliesExamined.map(s => ({ ...s, inEscapeBand: inTruth(s) })),
    L13: report.l13.replies ? report.l13.replies.map(s => ({ ...s, inEscapeBand: inTruth(s) })) : null,
    L17: report.l17.stops ? report.l17.stops.map(s => ({ ...s, inEscapeBand: inTruth(s) })) : null,
  };
  void truth;

  const out = JSON.stringify(report, null, 2);
  if (jsonAt > 0 && process.argv[jsonAt + 1]) { fs.writeFileSync(process.argv[jsonAt + 1], out + '\n'); console.error(`wrote ${process.argv[jsonAt + 1]}`); }
  else console.log(out);
}
main();
