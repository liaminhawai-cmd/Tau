const test = require('node:test');
const assert = require('node:assert/strict');
const Clay = require('../../../desktop/clay.js');
const mass = f => f.height.reduce((a, b) => a + b, 0);

test('scraping conserves clay, leaves grooves and accumulates moveable ridges', () => {
  const f = new Clay(66.667);
  for (let k = 0; k < 5; k++) f.scrape(-18, 0, 0, 0);
  const first = new Float64Array(f.height), peak = Math.max(...first);
  assert.ok(Math.min(...first) < -0.1);
  assert.ok(peak > 0.1);
  assert.ok(Math.abs(mass(f)) < 1e-5, 'excavated volume is deposited');
  // Measured as the volume standing above the surface, not the peak: a pile that has reached the
  // ceiling keeps growing by spreading wider, as a real one does, so its peak stops moving while
  // the clay heaped on it does not.
  const piled = a => a.reduce((s, v) => s + Math.max(0, v), 0);
  const before = piled(first);
  for (let k = 0; k < 5; k++) f.scrape(-18, 0, 0, 0);
  assert.ok(piled(f.height) > before, 'repeated passes heap more clay onto the piles');
  f.scrape(0, 0, 18, 0);
  assert.notDeepEqual(f.height, first, 'a later stroke can push an existing ridge');
  for (let k = 0; k < 60; k++) f.settle();
  assert.ok(Math.abs(mass(f)) < 1e-5, 'slumping also conserves volume');
  assert.ok(Math.min(...f.height) >= f.bed - 1e-6);
  assert.ok(Math.max(...f.height) <= f.ceiling + 1e-6);
  const settled = new Float64Array(f.height);
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
  const before = new Float64Array(f.height);
  assert.equal(f.scrape(-50, 0, 50, 0), false);
  assert.equal(f.scrape(NaN, 0, 0, 0), false);
  assert.deepEqual(f.height, before);
});

test('the same line dug again goes deeper, and levels off at the bed', () => {
  // What the look depends on: a single pass has to cut a trench that reads (not a 0.08 dimple),
  // and going over it again has to keep cutting rather than stop dead after one stroke.
  const f = new Clay(66.667), n = f.size;
  const floor = () => f.height[Math.round(f.radius / f.cell) * n + Math.round((-5 + f.radius) / f.cell)];
  const stroke = () => { for (let s = 0; s < 30; s++) f.scrape(-15 + s * 0.6, 0, -15 + (s + 1) * 0.6, 0); };
  const depths = [];
  for (let k = 0; k < 4; k++) { stroke(); depths.push(floor()); }
  assert.ok(depths[0] < -0.35, 'one pass cuts a real trench: ' + depths[0]);
  for (let k = 1; k < 4; k++) assert.ok(depths[k] < depths[k - 1], 'each pass goes deeper: ' + depths);
  assert.ok(depths[3] >= f.bed, 'and never past the bed');
  assert.ok(Math.max(...f.height) > 0.4, 'the clay it moved stands up as a lip');
});

test('clay holds a steep wall instead of melting into a hump', () => {
  // The first version let slopes stand at ~9 degrees, so every ridge slumped round within a second.
  const f = new Clay(66.667);
  for (let s = 0; s < 30; s++) f.scrape(-15 + s * 0.6, 0, -15 + (s + 1) * 0.6, 0);
  const before = Math.max(...f.height);
  for (let k = 0; k < 60; k++) f.settle();
  assert.ok(Math.max(...f.height) > before * 0.8, 'the lip is still standing after it settles');
});

test('the physics is per unit of board, so every quality tier digs the same trench', () => {
  const depth = N => {
    const f = new Clay(66.667, N), n = f.size;
    for (let s = 0; s < 30; s++) f.scrape(-15 + s * 0.6, 0, -15 + (s + 1) * 0.6, 0);
    return f.height[Math.round(f.radius / f.cell) * n + Math.round((-5 + f.radius) / f.cell)];
  };
  const coarse = depth(97), fine = depth(257);
  assert.ok(Math.abs(coarse - fine) < 0.08, 'low and high tiers agree on depth: ' + coarse + ' vs ' + fine);
});

test('only the patch a foot touched is marked for redrawing', () => {
  const f = new Clay(66.667, 257);
  f.takeDirty();
  f.scrape(0, 0, 0.5, 0);
  const d = f.takeDirty();
  assert.ok(d, 'a stroke marks something');
  const cells = (d.x1 - d.x0 + 1) * (d.z1 - d.z0 + 1);
  assert.ok(cells < f.size * f.size / 50, 'a small patch, not the whole board: ' + cells + ' cells');
  assert.equal(f.takeDirty(), null, 'and taking it clears it');
});
