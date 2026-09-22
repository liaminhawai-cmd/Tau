// A turn is handed over deliberately now -- letting go of a swing parks it instead of playing it.
// These pin the three things that has to keep true: releasing does not move the game on, the swing
// can be taken back to where the turn started, and the commit path still enforces the rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const { game, root } = require('./game-harness.cjs');
const fs = require('node:fs');
const path = require('node:path');

const localMatch = g => { g.read('tauDesktop.startMatch(true)'); g.$('desktopPickSkip').click(); g.tick(); };

// One swing, played the way a hand would: pin a foot, turn it, let go.
const swing = (g, foot, deg) => g.read(
  `pinFoot(${foot}); G.snap = takeSnap(); applySwing(${deg}*Math.PI/180); G.handle = null; render();`);

test('letting go of a swing parks it -- it does not hand the turn over', async t => {
  const g = await game(); t.after(g.close);
  localMatch(g);
  const who = g.read('G.active');
  swing(g, 0, 30);
  assert.equal(g.read('G.active'), who, 'still the same player to move');
  assert.equal(g.read('turnCommittable()'), true, 'and the swing is sitting there waiting to be ended');
  assert.deepEqual(g.errors, []);
});

test('a parked swing can be taken back to the start of the turn', async t => {
  const g = await game(); t.after(g.close);
  localMatch(g);
  const before = g.read('JSON.stringify(poseNow())');
  swing(g, 0, 30);
  assert.notEqual(g.read('JSON.stringify(poseNow())'), before, 'the swing moved the piece');
  g.read('undoTurn()');
  assert.equal(g.read('JSON.stringify(poseNow())'), before, 'undo puts the board back');
  assert.equal(g.read('G.pinned'), null, 'and releases the foot, so a different one can be tried');
  assert.equal(g.read('turnCommittable()'), false, 'with nothing left to hand over');
  assert.deepEqual(g.errors, []);
});

test('ending the turn is what moves the game on', async t => {
  const g = await game(); t.after(g.close);
  localMatch(g);
  const who = g.read('G.active');
  swing(g, 0, 30);
  g.read('commitPlayerTurn()');
  assert.notEqual(g.read('G.active'), who, 'the other player is up');
  assert.equal(g.read('G.pinned'), null, 'and the turn state is cleared');
  assert.deepEqual(g.errors, []);
});

test('neither control offers itself when there is no turn to act on', async t => {
  const g = await game(); t.after(g.close);
  localMatch(g);
  assert.equal(g.read('turnCommittable()'), false, 'nothing swung yet');
  assert.equal(g.read('turnUndoable()'), false, 'and no foot held');
  assert.equal(g.read("document.getElementById('turnBtns').style.display"), 'none');
  // A foot held but not yet swung is undoable (it un-picks the foot) but not committable.
  g.read('pinFoot(0); G.snap = takeSnap(); render();');
  assert.equal(g.read('turnUndoable()'), true);
  assert.equal(g.read('turnCommittable()'), false, 'a turn with no move in it cannot be handed over');
  assert.deepEqual(g.errors, []);
});

test('a swing too small to count is not a turn', async t => {
  const g = await game(); t.after(g.close);
  localMatch(g);
  swing(g, 0, 1);   // under CFG.minMoveDeg
  assert.equal(g.read('turnCommittable()'), false);
  assert.deepEqual(g.errors, []);
});

test('a private match runs on whatever clock its row says', async t => {
  const g = await game(); t.after(g.close);
  g.read(`document.getElementById('game').style.display = 'flex';`);
  // The column missing entirely (a server that has not run private_match_clock.sql) must mean the
  // ordinary clock -- NOT no clock, or every ranked match on an un-migrated server goes untimed.
  g.read(`onlineMatch = { myColor:'blue', spectator:false };`);
  assert.equal(g.read('turnClockUntimed()'), false, 'an absent column is not a choice');
  assert.equal(g.read('turnClockLimitMs()'), 60000);
  g.read(`onlineMatch.turn_seconds = 120;`);
  assert.equal(g.read('turnClockLimitMs()'), 120000, 'two minutes when the row says so');
  g.read(`onlineMatch.turn_seconds = null;`);
  assert.equal(g.read('turnClockUntimed()'), true, 'null IS the no-clock choice');
  assert.deepEqual(g.errors, []);
});

test('a no-clock match checks in rather than running for ever', async t => {
  // "No clock" must not mean a match can sit open indefinitely: an abandoned game holds a live row
  // and a realtime subscription server-side until a timeout settles it. So the ten minutes is a
  // question -- answer it and you get another ten, ignore it and the turn times out as usual.
  const g = await game(); t.after(g.close);
  g.read(`onlineMatch = { turn_seconds:null, myColor:'blue', spectator:false };
          document.getElementById('game').style.display = 'flex';`);
  assert.equal(g.read('turnClockLimitMs()'), 10*60*1000, 'ten minutes at a time');
  assert.equal(g.read('turnClockMode()'), 'online',
    'still clocked, so checkOnlineTimeout runs and a walked-away-from match settles itself');

  // My turn, ten minutes up: I am ASKED. My own clock is not resolved by me.
  g.read(`G.active = 0; onlineTurnDeadline = performance.now() - 1; checkOnlineTimeout();`);
  assert.equal(g.read("document.getElementById('modalTitle').textContent"), 'Still playing?');
  assert.notEqual(g.read('onlineTurnDeadline'), null, 'and nothing is forfeited while it is asked');

  // Saying yes buys another ten and closes the question.
  g.read('stillHere()');
  assert.equal(g.read('stillHereAskedAt'), 0);
  assert.ok(g.read('onlineTurnDeadline - performance.now()') > 9*60*1000, 'ten more minutes');
  assert.deepEqual(g.errors, []);
});

test('the clock the picker offers is the clock the server accepts', async t => {
  const g = await game(); t.after(g.close);
  const offered = JSON.parse(g.read('JSON.stringify(PRIVATE_CLOCKS.map(c => c.secs))'));
  assert.deepEqual(offered, [60, 120, null], 'one minute, two minutes, or none');
  // private_match_clock.sql rejects anything else, so the two lists must not drift apart.
  const sql = fs.readFileSync(path.join(root, 'WebPrototype/server/private_match_clock.sql'), 'utf8');
  for (const s of offered.filter(x => x !== null))
    assert.ok(sql.includes(String(s)), 'the server allows ' + s + 's');
  assert.match(sql, /not in \(60, 120\)/, 'and refuses anything the picker does not offer');
  assert.deepEqual(g.errors, []);
});

test('an open match is in the URL, so a refresh does not lose it', async t => {
  const g = await game('?steam=1&premium=1'); t.after(g.close);
  g.read(`setMatchUrl('abc-123')`);
  let q = g.read('location.search');
  assert.match(q, /match=abc-123/, 'the match id is there to come back to');
  assert.ok(/steam=1/.test(q) && /premium=1/.test(q), 'and the wrapper params survived it: ' + q);
  g.read(`setMatchUrl(null)`);
  q = g.read('location.search');
  assert.doesNotMatch(q, /match=/, 'it goes when the match ends');
  assert.ok(/steam=1/.test(q) && /premium=1/.test(q), 'without taking the others with it: ' + q);
  assert.deepEqual(g.errors, []);
});

test('a ?match= that is not mine to resume is dropped, not argued with', async t => {
  const g = await game('?match=nope'); t.after(g.close);
  g.read('sbUser = null; checkResumeMatch();');
  assert.doesNotMatch(g.read('location.search'), /match=/);
  assert.deepEqual(g.errors, []);
});
