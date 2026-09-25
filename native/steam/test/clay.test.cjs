const test = require('node:test');
const assert = require('node:assert/strict');
const Clay = require('../../../desktop/clay.js');
const mass = f => f.height.reduce((a, b) => a + b, 0);

test('scraping conserves clay, leaves grooves and accumulates moveable ridges', () => {
  const f = new Clay(66.667);
  for (let k = 0; k < 5; k++) f.scrape(-18, 0, 0, 0);
  const first = new Float32Array(f.height), peak = Math.max(...first);
  assert.ok(Math.min(...first) < -0.1);
  assert.ok(peak > 0.1);
  assert.ok(Math.abs(mass(f)) < 1e-5, 'excavated volume is deposited');
  for (let k = 0; k < 5; k++) f.scrape(-18, 0, 0, 0);
  assert.ok(Math.max(...f.height) > peak, 'repeated passes stack existing clay');
  f.scrape(0, 0, 18, 0);
  assert.notDeepEqual(f.height, first, 'a later stroke can push an existing ridge');
  for (let k = 0; k < 60; k++) f.settle();
  assert.ok(Math.abs(mass(f)) < 1e-5, 'slumping also conserves volume');
  assert.ok(Math.min(...f.height) >= f.bed - 1e-6);
  assert.ok(Math.max(...f.height) <= f.ceiling + 1e-6);
  const settled = new Float32Array(f.height);
  assert.equal(f.scrape(0, 0, 0, 0), false);
  assert.deepEqual(f.height, settled, 'idle feet do not erase or churn the surface');
  assert.ok(Math.max(...settled) > 0.1, 'settling does not erase the piles');
  f.reset(); assert.ok(f.height.every(v => v === 0));
});

test('edge strokes stay in the ring; airborne/reset-sized jumps make no trench', () => {
  const f = new Clay(66.667, 65);
  for (let k = 0; k < 20; k++) f.scrape(60, k * 0.1, 66, k * 0.1);
  assert.ok(Math.abs(mass(f)) < 1e-5);
  for (let i = 0; i < f.height.length; i++) if (!f.inside[i]) assert.equal(f.height[i], 0);
  const before = new Float32Array(f.height);
  assert.equal(f.scrape(-50, 0, 50, 0), false);
  assert.equal(f.scrape(NaN, 0, 0, 0), false);
  assert.deepEqual(f.height, before);
});
