// A turn is handed over deliberately now -- letting go of a swing parks it instead of playing it.
// These pin the three things that has to keep true: releasing does not move the game on, the swing
// can be taken back to where the turn started, and the commit path still enforces the rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const { game } = require('./game-harness.cjs');

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
