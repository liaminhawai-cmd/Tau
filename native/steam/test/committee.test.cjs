const test = require('node:test');
const assert = require('node:assert/strict');
const {game, root} = require('./game-harness.cjs');
const fs = require('node:fs');
const path = require('node:path');

// A tiny, valid (but meaningless) value net -- enough shape for nnForwardGame to run without
// throwing, standing in for the real ~45MB gold/bronze checkpoints so these tests never touch the
// network or wait on a real forward pass.
function fakeNet(seed) {
  const rnd = (() => { let s = seed; return () => (s = (s*1103515245+12345)&0x7fffffff)/0x7fffffff*2-1; })();
  const sizes = [94, 4, 1], fanIns = [94, 4];
  const W = [Array.from({length:94*4}, rnd), Array.from({length:4*1}, rnd)];
  const b = [Array.from({length:4}, rnd), [0]];
  return { sizes, fanIns, topology: null, W, b };
}

test('the ladder is thirteen rungs, and the top two carry the trained brains',async t=>{
  const g=await game('');t.after(g.close);
  assert.deepEqual(g.errors,[],'loads clean with the new AI_LADDER entries and rung mapping');
  assert.equal(g.read('LADDER_N'),13);
  // RUNG_TO_AI_LADDER is the one seam between "menu position" and "which AI plays there". Rungs
  // 1-11 still point at exactly the AI_LADDER indices they always did; only the top two moved.
  assert.equal(g.read('JSON.stringify(RUNG_TO_AI_LADDER)'),'[0,0,1,2,3,4,5,6,7,8,9,15,14]');
  assert.equal(g.read('AI_LADDER.length'),16);
  assert.equal(g.read('AI_LADDER[14].kind'),'committee','rung 13 -- appended, not inserted, so L1-L14\'s own indices never moved');
  assert.equal(g.read('AI_LADDER[15].kind'),'net','rung 12 -- likewise appended');
  assert.equal(g.read('RUNG_TO_AI_LADDER[11]'),15,'rung 12 is the champion net, not the hand-tuned rung it replaced');
  assert.equal(g.read('RUNG_TO_AI_LADDER[12]'),14,'and the Committee still sits above it');
  // Both top rungs keep their weights out of line and fetch them on demand. The Committee votes
  // with the champion as one of its members, so climbing 12 then 13 fetches that file once.
  assert.equal(g.read('JSON.stringify(AI_LADDER[15].nets)'),'["champion"]');
  assert.equal(g.read('JSON.stringify(AI_LADDER[14].nets)'),'["pw-silver","pw-gold","lean"]');
  // Rungs 1-11 must still be the plain in-line brains -- nothing below the top two may depend on
  // a download, or a mid-ladder rung could silently fall back on a bad deploy.
  for (let r = 0; r <= 10; r++)
    assert.equal(g.read(`!!AI_LADDER[RUNG_TO_AI_LADDER[${r}]].nets`),false,`rung ${r+1} needs no download`);
});

test('a save written under the old 11-rung numbering is migrated once, not read back under the wrong rung',async t=>{
  // Old numbering: Cosy/Vesper was rung 5. It is now rung 6 (Yellow took rung 1 and pushed
  // everything else up one). An unmigrated save would show rung 5 (now Slate) cleared instead.
  const storage = { tauLadder: '{"b":{"5":1},"r":{"5":1,"1":1}}', tauRankedLevel: '9' };
  const g=await game('', storage);t.after(g.close);
  assert.deepEqual(g.errors,[]);
  assert.equal(g.read('ladderCleared(6,0)'),true,'the old rung-5 clear now lives at rung 6');
  assert.equal(g.read('ladderCleared(6,1)'),true);
  assert.equal(g.read('ladderCleared(2,1)'),true,'old rung-1 Red clear now lives at rung 2 (Walnut\'s new number)');
  assert.equal(g.read('ladderCleared(5,0)'),false,'nothing reads back at the OLD number any more');
  assert.equal(g.read('ladderCleared(1,0)'),false,'rung 1 (Yellow) starts uncleared -- nobody has played the new rung yet');
  assert.equal(g.read("localStorage.getItem('tauRankedLevel')"),'11','ranked subrank shifts by +2 (one full level) with it');
  assert.equal(g.read("localStorage.getItem('tauLadderRenumberedV1')"),'1','and the migration is marked done');
  // The old rung 1's clear carries DOWN onto Yellow as well as up onto Walnut, because both rungs
  // are the same opponent (RUNG_TO_AI_LADDER sends each to AI_LADDER[0]).
  assert.equal(g.read('ladderCleared(1,1)'),true,'the old rung-1 Red clear also lands on Yellow, the same opponent');
});

test('a returning player is pointed at the rung they were actually on, not back at the pushover',async t=>{
  // The regression this exists to stop: ladderFrontier is the first rung NOT cleared on both
  // colours, and a brand-new rung 1 has no clears on it -- so inserting Yellow at the bottom sent
  // EVERY returning player's suggested rung back to 1, however far up they had climbed. On the
  // pushover the opponent answers instantly, which also meant the between-moves camera drift
  // (easeDrift, which needs a second or so of someone thinking) never had time to show at all.
  const storage = { tauLadder: '{"b":{"1":1,"2":1,"3":1,"4":1,"5":1},"r":{"1":1,"2":1,"3":1,"4":1}}' };
  const g=await game('?steam=1&premium=1', storage);t.after(g.close);
  assert.equal(g.read('ladderFrontier()'),6,'mid-way through the old Level 5 is mid-way through the new Level 6');
  assert.equal(g.$('desktopLevel').value,'6','and that is the rung the menu comes up on');
  assert.equal(g.read('tauDesktop.board'),'cosy','wearing the same board and opponent as before the renumber');
  assert.notEqual(g.read('RUNG_TO_AI_LADDER[5]'),0,'which is emphatically not the pushover');
  assert.deepEqual(g.errors,[]);
});

test('the top rungs\' weights are bundled into a wrapper app, not left to a web server',async t=>{
  // A native build has no origin to lazily fetch from; ladderNetsEnsureLoaded asks for
  // committee/<name>.bin against the bundle itself. Left out of sync-www, the top rungs silently
  // fall back to L11 -- a Committee that is not a committee, and a Champion that is not one.
  const src = fs.readFileSync(path.join(root,'native/scripts/sync-www.mjs'),'utf8');
  assert.match(src,/cpSync\(join\(repoRoot, 'committee'\)/,'sync-www copies committee/ for a premium bundle');
  // Read the names off the shipped ladder rather than repeating them here, so renaming a net or
  // reseating a member can never leave this check quietly guarding files nobody fetches any more.
  const g=await game('');t.after(g.close);
  const names = new Set(JSON.parse(g.read('JSON.stringify(AI_LADDER.flatMap(d => (d && d.nets) || []))')));
  assert.ok(names.size, 'at least one rung declares weights');
  for (const n of names) for (const ext of ['.meta.json','.bin'])
    assert.ok(fs.existsSync(path.join(root,'committee',n+ext)), 'committee/'+n+ext+' is in the repo for it to copy');
  // ...and nothing is carried that no rung asks for: these are multi-megabyte files, and a native
  // wrapper pays for every one of them whether or not anything ever fetches it.
  const orphans = fs.readdirSync(path.join(root,'committee'))
    .filter(f => !names.has(f.replace(/\.(meta\.json|bin)$/,'')));
  assert.deepEqual(orphans, [], 'committee/ carries no weights the ladder never asks for');
});

test('no board opens out of order, whatever else the profile has done',async t=>{
  // The report: "some of the boards were unlocked prematurely... i skipped ahead to committee
  // level cos that was unlocked for some reason". Ebony carried an old {wins:5} counter, and
  // Ebony is now the Committee's board at rung 13 -- so five wins anywhere walked a player past
  // eleven rungs to the hardest opponent in the game.
  const storage = { tauDesktopProgress: '{"played":200,"wins":150,"topLevel":11}',
                    tauLadder: '{"b":{},"r":{}}', tauLadderRenumberedV1: '1' };
  const g=await game('?steam=1&premium=1', storage);t.after(g.close);
  const D=g.w.tauDesktop, by=id=>D.boards.find(b=>b.id===id);
  assert.ok(by('yellow').unlocked,'rung 1 is always open');
  for (const id of ['walnut','dojo','ebony','colossus','marble'])
    assert.ok(!by(id).unlocked, id + ' stays shut on a profile that has climbed nothing');
  assert.equal(g.$('desktopLevel').options[12].disabled, true, 'and the top rung cannot be picked');
  // Dark is the one board with no rung of its own, so it is still the one board with a count.
  assert.ok(by('dark').unlocked,'Dark has no rung, so it keeps its play count');
  assert.deepEqual(g.errors,[]);
});

test('a match says WHO you are playing, not which number you picked',async t=>{
  const storage = { tauLadder: '{"b":{"1":1,"2":1},"r":{"1":1,"2":1}}', tauLadderRenumberedV1: '1' };
  const g=await game('?steam=1&premium=1', storage);t.after(g.close);
  g.read('startLadderLevel(6, 0)');   // 0-based 6 = rung 7 = Dojo, where Sensei lives
  assert.equal(g.read('ladderOpponentName()'),'Sensei');
  assert.equal(g.read('vsAiOpponentLabel()'),'Sensei','the turn indicator names them');
  assert.match(g.read('vsAiTurnLabel(1 - humanIdx)'),/Sensei/);
  assert.equal(g.read('vsAiTurnLabel(humanIdx)'),'You');
  assert.deepEqual(g.errors,[]);
});

test('the plain web build, which has no names for its rungs, still says the number',async t=>{
  const g=await game('');t.after(g.close);   // no desktop layer at all
  g.read('startLadderLevel(2, 0)');
  assert.equal(g.read('ladderOpponentName()'),'','nothing to ask');
  assert.equal(g.read('vsAiOpponentLabel()'),'Level 3 AI','so it falls back to the rung');
  assert.deepEqual(g.errors,[]);
});

test('the renumbering migration never runs twice on the same save',async t=>{
  const storage = { tauLadder: '{"b":{"5":1},"r":{}}', tauLadderRenumberedV1: '1' };
  const g=await game('', storage);t.after(g.close);
  assert.equal(g.read('ladderCleared(5,0)'),true,'already-migrated (or never-migrated-because-fresh) data is left exactly as saved');
  assert.equal(g.read('ladderCleared(6,0)'),false);
});

test('a failed fetch rejects ladderNetsEnsureLoaded rather than resolving with nothing',async t=>{
  // The harness's own fetch always rejects ("Offline test" -- see game-harness.cjs), standing in
  // for a real network failure. This is committeePlanGen's actual escape hatch: it races the wait
  // loop against this promise settling and falls back to L11's own move the moment `failed` flips.
  // The wait loop itself is bounded by real wall-clock time (performance.now()), which this
  // harness's stepped fake clock cannot usefully simulate (its clock only advances between whole
  // animation frames, never during one, so a generator that yields without doing any work in
  // between never sees it move) -- that half is a property of the browser's real clock, not
  // something worth faking here. What IS testable without a real clock is that the promise this
  // relies on genuinely rejects, and does so again on a fresh attempt rather than staying broken.
  const g=await game('');t.after(g.close);
  for (const rung of [14, 15]) {
    await assert.rejects(() => g.w.ladderNetsEnsureLoaded(rung), `rung ${rung} reports the failure`);
    await assert.rejects(() => g.w.ladderNetsEnsureLoaded(rung), 'a retried attempt after a failure tries again, not remembered as permanently broken');
  }
  assert.deepEqual(g.errors,[]);
});

test('committeePlanFor: a proven throw is taken outright, no vote needed',async t=>{
  const g=await game('');t.after(g.close);
  g.read(`AI_LADDER[14]._nets = [${JSON.stringify(fakeNet(1))}, ${JSON.stringify(fakeNet(2))}];`);
  // Set up a position one swing away from throwing Red's outermost foot off the rim, so the sweep
  // is guaranteed to contain at least one isThrow candidate.
  g.read(`
    G.pieces[1].x = ${'CFG.edgeU'}; G.pieces[1].y = 0; G.pieces[1].rot = 0;
    G.pieces[0].x = ${'CFG.edgeU'}*0.4; G.pieces[0].y = 0; G.pieces[0].rot = 0;
    G.active = 0;
  `);
  const plan = g.read('JSON.stringify(committeePlanFor(0, AI_LADDER[14]))');
  assert.notEqual(plan, 'null', 'a real plan came back');
  assert.deepEqual(g.errors,[]);
});

test('committeePlanFor: three members pooling their votes never crashes and returns a legal plan',async t=>{
  const g=await game('');t.after(g.close);
  g.read(`AI_LADDER[14]._nets = [${JSON.stringify(fakeNet(3))}, ${JSON.stringify(fakeNet(4))}];`);
  const plan = g.read('JSON.stringify(committeePlanFor(G.active, AI_LADDER[14]))');
  assert.notEqual(plan, 'null');
  const p = JSON.parse(plan);
  assert.ok([0,1,2].includes(p.pivotIdx));
  assert.ok(p.dir === 1 || p.dir === -1);
  assert.ok(Number.isFinite(p.targetRad) && p.targetRad > 0);
  assert.deepEqual(g.errors,[]);
});

test('a net member is read from the side whose turn it actually is',async t=>{
  // The bug this exists to stop, and the reason the top rung measured WEAKER than the rung below
  // it: nnFeaturesGame builds all 94 inputs relative to G.active, so a value net answers "how good
  // is this for the side to move". The first Committee parked G.active on itself and read the
  // value straight, at leaves where the opponent was actually to play -- quietly awarding itself a
  // free tempo in every single evaluation. nnPlanForGame has always negated instead; this is the
  // same convention, made explicit.
  const g=await game('');t.after(g.close);
  g.read(`__n = ${JSON.stringify(fakeNet(7))};`);
  const idx = g.read('G.active');
  // Read straight, with the opponent genuinely to move...
  const raw = g.read(`(function(){ G.active = ${1-idx}; const v = nnForwardGame(nnFeaturesGame(), __n); G.active = ${idx}; return v; })()`);
  const viaHelper = g.read(`committeeNetEval(__n, ${idx}, ${1-idx})`);
  assert.ok(Math.abs(viaHelper - (-raw)) < 1e-12, 'a leaf with the opponent to move is negated, not taken at face value');
  assert.equal(g.read('G.active'), idx, 'and G.active is handed back exactly as it was found');
  // ...and when it really is our turn, the value stands as the net gives it.
  const ours = g.read(`(function(){ G.active = ${idx}; return nnForwardGame(nnFeaturesGame(), __n); })()`);
  assert.ok(Math.abs(g.read(`committeeNetEval(__n, ${idx}, ${idx})`) - ours) < 1e-12);
  // The two readings must genuinely differ, or this test would pass on a net that ignores the
  // board and the whole convention would be untested.
  assert.ok(Math.abs(raw - ours) > 1e-9, 'the fake net does depend on which side is to move');
  assert.deepEqual(g.errors,[]);
});

test('the Champion rung searches with its own net, and falls back rather than crashing without one',async t=>{
  const g=await game('');t.after(g.close);
  g.read(`AI_LADDER[15]._nets = [${JSON.stringify(fakeNet(9))}];`);
  const p = JSON.parse(g.read('JSON.stringify(ladderPlanRung(AI_LADDER[15], G.active))'));
  assert.ok(p && [0,1,2].includes(p.pivotIdx) && (p.dir === 1 || p.dir === -1), 'plays a legal plan');
  assert.ok(Number.isFinite(p.targetRad) && p.targetRad > 0);
  assert.deepEqual(g.errors,[]);
});

test('committeeMemberProb matches committee.js\'s own two conversions',async t=>{
  const g=await game('');t.after(g.close);
  // chair: logistic squash at T=100 (laddereval.js's observed +-400 range)
  assert.ok(Math.abs(g.read("committeeMemberProb('chair', 0)") - 0.5) < 1e-9);
  assert.ok(g.read("committeeMemberProb('chair', 400)") > 0.9, 'a strongly-favoured chair position reads as a high probability');
  // net: linear (v+1)/2 remap from the trained value net's [-1,1]
  assert.ok(Math.abs(g.read("committeeMemberProb('net', 0)") - 0.5) < 1e-9);
  assert.ok(Math.abs(g.read("committeeMemberProb('net', 1)") - (1-1e-3)) < 1e-9);
  assert.ok(Math.abs(g.read("committeeMemberProb('net', -1)") - 1e-3) < 1e-9);
});

test('the desktop premium ladder puts its faces in the chosen order, easiest to hardest by rung',async t=>{
  const g=await game();t.after(g.close);
  const D=g.w.tauDesktop;
  assert.equal(D.boards.length,14,'every finish, including Dark -- still the one board held in reserve');
  const rungs = D.ladderRungs;
  assert.equal(rungs.length,13,'and thirteen of those fourteen are ladder rungs now');
  assert.equal(rungs[0].board,'yellow'); assert.equal(rungs[0].opponent,'Wren');
  const faces = rungs.map(r => r.opponent + '@' + r.board).join(' ');
  assert.equal(faces, 'Wren@yellow Lily@maple Corvin@ebony Hazel@walnut Flint@slate Vesper@cosy '
    + 'Sensei@dojo Marlowe@noir Rikishi@sumo Alabaster@marble Euclid@math Chorus@alien Titan@colossus');
  assert.equal(D.boardRung('colossus'),13,'Titan\'s arena is the top rung');
  // The faces moved; the brains did not. Rung n is still the nth difficulty, whoever wears it.
  assert.equal(g.read('JSON.stringify(RUNG_TO_AI_LADDER)'), JSON.stringify([0,0,1,2,3,4,5,6,7,8,9,15,14]));
  assert.deepEqual(g.errors,[]);
});

// ---------- the walkthrough, after the reshape ----------
test('the walkthrough teaches the rules in the order they build on each other', async t => {
  const g = await game(''); t.after(g.close);
  assert.deepEqual(g.errors, []);
  // Hold a foot, swing around it, then what the printed lines do to that swing, then the win.
  assert.equal(g.read('JSON.stringify(HTP_STEPS.map(s=>s.tryKey))'),
    '["pivot","swing","cross","double","twofeet","off"]');
  // Every slide is a do-it slide now -- the watch-a-recorded-game opener is gone, and so is the
  // bare "shove Red", which was never a rule of its own.
  assert.equal(g.read('HTP_STEPS.every(s=>!!s.tryKey)'), true, 'nothing is just watched');
  assert.equal(g.read("JSON.stringify(HTP_STEPS.map(s=>s.tryKey)).includes('push')"), false);
  assert.equal(g.read("typeof TUTOR_GAME"), 'undefined', 'and the recorded game it played is gone with it');
  // The clause that read as nonsense is not in the swing slide any more.
  assert.equal(g.read("HTP_STEPS[1].text.includes('live from your very first move')"), false);
});

test('a walkthrough slide freezes once its goal lands, and Reset re-arms it', async t => {
  const g = await game(''); t.after(g.close);
  // Earn the slide before it: htpShowStep clamps to the furthest slide whose goal is outstanding,
  // so without this, Reset would land on the pivot slide instead of the one under test.
  g.read(`openHowToPlay(); const p = htpState('pivot'); p.done = true; p.touched = true;`);
  const rot0 = g.read("htpState('swing').p.rot");
  g.read(`const st = htpState('swing'); st.pinned = 0; st.lastT = 1; htpGoalDone('swing', st, {x:0,y:0});`);
  assert.equal(g.read("htpState('swing').locked"), true, 'the goal freezes the board');
  g.read(`htpTrySwing(htpState('swing'), 'swing', 0.4);`);
  assert.equal(g.read("htpState('swing').p.rot"), rot0, 'a frozen slide cannot be shuffled about');
  g.read(`htpShowStep(HTP_STEPS.findIndex(s=>s.tryKey==='swing')); htpResetSlide();`);
  assert.equal(g.read("htpState('swing').locked"), false, 'Reset gives it back');
  assert.equal(g.read("htpState('swing').done"), true, 'without taking the earned goal away');
  assert.deepEqual(g.errors, []);
});

test('the one-line slide wants the same position tried from all three feet', async t => {
  const g = await game(''); t.after(g.close);
  const st = `htpState('cross')`;
  for (const foot of [0, 1, 2]) {
    assert.equal(g.read(`${st}.done`), false, 'not finished before all three');
    g.read(`(()=>{ const s = ${st}; s.pinned = ${foot}; s.lastT = 1; s.netAng = 20*Math.PI/180;
      s.dragging = true; htpTurnOver('cross', s); })()`);
  }
  assert.equal(g.read(`${st}.done`), true, 'the third foot completes it');
  assert.deepEqual(g.errors, []);
});

test('the same foot twice does not count as two of the three', async t => {
  const g = await game(''); t.after(g.close);
  for (let i = 0; i < 3; i++)
    g.read(`(()=>{ const s = htpState('cross'); s.pinned = 0; s.lastT = 1; s.netAng = 20*Math.PI/180;
      s.dragging = true; htpTurnOver('cross', s); })()`);
  assert.equal(g.read("htpState('cross').done"), false);
  assert.equal(g.read("JSON.stringify(htpState('cross').feetTried)"), '[0]');
  assert.deepEqual(g.errors, []);
});

test('a shove that only moves the opponent is a good try, not a win', async t => {
  const g = await game(''); t.after(g.close);
  g.read(`(()=>{ const s = htpState('off'); s.lastT = 1; s.pinned = 0;
    s.red.x = s.red0.x - 6;            // moved, but nowhere near the rim
    s.netAng = 20*Math.PI/180; s.dragging = true; htpTurnOver('off', s); })()`);
  assert.equal(g.read("htpState('off').done"), false, 'bumping them is not the goal');
  assert.ok(/another way/i.test(g.read("htpState('off').say") || ''), 'it says so, and invites another try');
  assert.ok(g.read("htpState('off').rewindAt") > 0, 'and puts the board back to try it from');
  assert.deepEqual(g.errors, []);
});

test('winning a slide mid-swing does not stop the piece dead in the corner', async t => {
  // The corner and two-feet goals fire from inside the substep loop, the instant the contact sets
  // show the right pattern -- which is halfway through the very motion being rewarded. Freezing
  // the board on `locked` alone stopped the piece there, so the player never got to ride through
  // the corner they had just been congratulated for finding.
  const g = await game(''); t.after(g.close);
  g.read(`(()=>{ const s = htpState('double'); s.pinned = 0; s.lastT = 1; s.dragging = true;
    htpGoalDone('double', s, {x:0,y:0}); window.__r0 = s.p.rot; })()`);
  assert.equal(g.read("htpState('double').locked"), true, 'the goal does arm the lock');
  g.read(`htpTrySwing(htpState('double'), 'double', 0.25)`);
  assert.notEqual(g.read("htpState('double').p.rot"), g.read('window.__r0'),
    'but the stroke already in hand carries on through');
  // Once the finger is up, the lock bites and a fresh swing is refused.
  g.read(`htpState('double').dragging = false; window.__r1 = htpState('double').p.rot;`);
  g.read(`htpTrySwing(htpState('double'), 'double', 0.25)`);
  assert.equal(g.read("htpState('double').p.rot"), g.read('window.__r1'), 'a new swing is not');
  assert.deepEqual(g.errors, []);
});
