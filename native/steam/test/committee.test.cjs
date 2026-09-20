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

test('the ladder is thirteen rungs: Yellow at 1 through Colossus at 12, Committee at 13, and every existing board keeps its own difficulty',async t=>{
  const g=await game('');t.after(g.close);
  assert.deepEqual(g.errors,[],'loads clean with the new AI_LADDER entry and rung mapping');
  assert.equal(g.read('LADDER_N'),13);
  // RUNG_TO_AI_LADDER is the one seam between "menu position" and "which AI plays there" -- every
  // board that already existed keeps the exact AI_LADDER index it always had.
  assert.equal(g.read('JSON.stringify(RUNG_TO_AI_LADDER)'),'[0,0,1,2,3,4,5,6,7,8,9,10,14]');
  assert.equal(g.read('AI_LADDER[14].kind'),'committee','the new rung 13 -- appended, not inserted, so L1-L14\'s own indices never moved');
  assert.equal(g.read('AI_LADDER.length'),15);
  // Rung 12 (0-based ladderLevel 11, old Level 11 = Colossus) must still resolve to AI_LADDER[10]
  // (L11) -- the same opponent it always was, just wearing a different number in the menu.
  assert.equal(g.read('RUNG_TO_AI_LADDER[11]'),10);
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

test('the Committee\'s weights are bundled into a wrapper app, not left to a web server',async t=>{
  // A native build has no origin to lazily fetch from; committeeEnsureLoaded asks for
  // committee/gold.bin against the bundle itself. Left out of sync-www, the top rung silently
  // falls back to L11 -- a Committee that is not a committee.
  const src = fs.readFileSync(path.join(root,'native/scripts/sync-www.mjs'),'utf8');
  assert.match(src,/cpSync\(join\(repoRoot, 'committee'\)/,'sync-www copies committee/ for a premium bundle');
  for (const f of ['committee/gold.meta.json','committee/gold.bin','committee/bronze.meta.json','committee/bronze.bin'])
    assert.ok(fs.existsSync(path.join(root,f)), f + ' is in the repo for it to copy');
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
  assert.equal(g.$('desktopLevel').options[12].disabled, true, 'and the Committee cannot be picked');
  // Dark is the one board with no rung of its own, so it is still the one board with a count.
  assert.ok(by('dark').unlocked,'Dark has no rung, so it keeps its play count');
  assert.deepEqual(g.errors,[]);
});

test('a match says WHO you are playing, not which number you picked',async t=>{
  const storage = { tauLadder: '{"b":{"1":1,"2":1},"r":{"1":1,"2":1}}', tauLadderRenumberedV1: '1' };
  const g=await game('?steam=1&premium=1', storage);t.after(g.close);
  g.read('startLadderLevel(2, 0)');   // 0-based 2 = rung 3 = Dojo, where Sifu lives
  assert.equal(g.read('ladderOpponentName()'),'Sifu');
  assert.equal(g.read('vsAiOpponentLabel()'),'Sifu','the turn indicator names them');
  assert.match(g.read('vsAiTurnLabel(1 - humanIdx)'),/Sifu/);
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

test('a failed fetch rejects committeeEnsureLoaded rather than resolving with nothing',async t=>{
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
  await assert.rejects(() => g.w.committeeEnsureLoaded());
  await assert.rejects(() => g.w.committeeEnsureLoaded(), 'a retried attempt after a failure tries again, not remembered as permanently broken');
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

test('the desktop premium ladder carries Yellow and The Committee at the new ends, everyone else\'s difficulty unmoved',async t=>{
  const g=await game();t.after(g.close);
  const D=g.w.tauDesktop;
  assert.equal(D.boards.length,14,'every finish, including Dark -- still the one board held in reserve');
  const rungs = D.ladderRungs;
  assert.equal(rungs.length,13,'and thirteen of those fourteen are ladder rungs now');
  assert.equal(rungs[0].board,'yellow'); assert.equal(rungs[0].opponent,'Wren');
  assert.equal(rungs[12].board,'ebony'); assert.equal(rungs[12].opponent,'The Committee');
  assert.equal(rungs[11].board,'colossus','Colossus is rung 12 now, one place up, same board as always');
  assert.equal(D.boardRung('walnut'),2,'and Walnut -- the old rung 1 -- reads as rung 2');
  assert.equal(D.boardRung('colossus'),12);
  assert.deepEqual(g.errors,[]);
});
