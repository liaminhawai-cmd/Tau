/* Cosmetic clay heightfield. No game state, collision or movement dependencies.
   Units are board units; transported volume stays in the grid, including old ridges.

   It should behave like the dohyo does on the broadcast: a foot dragged through it cuts a trench
   with walls, the clay it moves piles up as a lip in front and levees either side, going over the
   same line again cuts deeper, and a later stroke through an old ridge bulldozes that ridge along
   with it. Three numbers decide whether any of that reads on screen, and the first version of this
   had all three set so it could not:

     depth      the bed was 0.18 units on a board 133 units across -- a tenth of a percent, which
                changes the lighting by almost nothing. The bed is now half a leg's thickness down,
                and the ceiling tall enough for a proper lip.
     repose     settle() let a slope stand at about 9 degrees before it flowed, so every ridge
                melted into a round hump within a second -- the soft smudges, not ridges. Clay is
                cohesive; it now holds a steep wall and only a genuinely overhanging lip slumps.
     profile    grooves were a (1 - d^2) dimple and deposits a broad wash. A trench now has a flat
                floor and steep sides, and the displaced clay lands in a narrow band just outside
                the foot, which is what makes a crest.

   The grid resolution is the renderer's call (see presentation.js); the physics is written per unit
   of board, so a finer grid shows the same trench more sharply rather than digging a different one. */
(function (root) {
  'use strict';
  class ClaySurface {
    constructor(radius, size = 129) {
      this.radius = radius; this.size = size; this.cell = 2 * radius / (size - 1);
      // Float64: every stroke moves clay between cells, and at the finer grid enough single-precision
      // rounding accumulated over a match to break the one promise this class makes -- that clay
      // is only ever moved, never made or lost. The renderer copies it into a float32 buffer anyway.
      this.height = new Float64Array(size * size);
      this.wear = new Float32Array(size * size);
      this.inside = new Uint8Array(size * size);
      // Half a leg's thickness down (legRadius is 1.44), and a lip that can stand about as high.
      this.bed = -0.75; this.ceiling = 0.9; this.revision = 0;
      // Steepest slope settle() leaves standing, as rise over run. ~48 degrees: wet cohesive clay
      // keeps a cut wall, and only a lip pushed up past this slumps back.
      this.repose = 1.1;
      this.dirty = null;   // {x0, z0, x1, z1} in grid cells, since the renderer last cleared it
      for (let z = 0; z < size; z++) for (let x = 0; x < size; x++)
        this.inside[z * size + x] = Math.hypot(x * this.cell - radius, z * this.cell - radius) <= radius;
    }
    reset() {
      this.height.fill(0); this.wear.fill(0); this.revision++;
      this.dirty = { x0: 0, z0: 0, x1: this.size - 1, z1: this.size - 1 };
    }
    // Grow the region the renderer has to rebuild. Kept as one rectangle: every edit is local to a
    // foot, and rows are what the GPU upload is ranged over anyway.
    markDirty(x0, z0, x1, z1) {
      const d = this.dirty;
      if (!d) { this.dirty = { x0, z0, x1, z1 }; return; }
      if (x0 < d.x0) d.x0 = x0; if (z0 < d.z0) d.z0 = z0;
      if (x1 > d.x1) d.x1 = x1; if (z1 > d.z1) d.z1 = z1;
    }
    takeDirty() { const d = this.dirty; this.dirty = null; return d; }
    scrape(x0, z0, x1, z1, width = 2.4) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (!Number.isFinite(len) || len < 0.001) return false;
      // A discontinuity is a restored position/new replay frame, not a foot dragged across the ring.
      if (len > this.radius * 0.35) return false;
      const steps = Math.ceil(len / (this.cell * 0.45)), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      // Where the displaced clay can land: a band just outside the foot, peaking a little beyond
      // its edge. Narrow on purpose -- a wide wash is a smudge, a narrow band is a crest.
      const LIP_IN = 1.0, LIP_PEAK = 1.18, LIP_OUT = 1.75;
      // How wide the crest is, in units of `width` -- but never narrower than the grid can draw.
      // A band narrower than a cell aliases: each cell either catches it or misses it depending on
      // where it falls, and the lip comes out as a regular zipper along its length. This is the one
      // place the grid is allowed to shape the result, and only by blurring a crest it could not
      // have shown sharply anyway.
      const LIP_W = Math.max(0.24, 1.3 * this.cell / width);
      let changed = false;
      let bx0 = this.size, bz0 = this.size, bx1 = -1, bz1 = -1;
      for (let step = 1; step <= steps; step++) {
        const x = x0 + (x1 - x0) * step / steps, z = z0 + (z1 - z0) * step / steps;
        if (Math.hypot(x, z) > this.radius) continue;
        const sources = [], targets = [], extent = width * LIP_OUT;
        const loX = Math.max(0, Math.floor((x - extent + this.radius) / this.cell));
        const hiX = Math.min(this.size - 1, Math.ceil((x + extent + this.radius) / this.cell));
        const loZ = Math.max(0, Math.floor((z - extent + this.radius) / this.cell));
        const hiZ = Math.min(this.size - 1, Math.ceil((z + extent + this.radius) / this.cell));
        let amount = 0, room = 0;
        // Per substep, so the total a stroke removes is the same whatever the grid resolution:
        // steps scale as 1/cell and so does this. A single pass takes a good share of what is left
        // above the bed; the same line again takes a share of what remains, so repeat passes dig
        // deeper and deeper and level off at the bed rather than stopping dead after one.
        const pressure = Math.min(0.6, len / steps / width * 0.9);
        for (let iz = loZ; iz <= hiZ; iz++) for (let ix = loX; ix <= hiX; ix++) {
          const i = iz * this.size + ix;
          if (!this.inside[i]) continue;
          const rx = ix * this.cell - this.radius - x, rz = iz * this.cell - this.radius - z;
          const d = Math.hypot(rx, rz) / width, ahead = (rx * dx + rz * dz) / width;
          if (d < LIP_IN) {
            // Flat floor, steep walls: (1 - d^4) is nearly 1 across the foot and drops fast at its
            // rim, where (1 - d^2) sloped all the way from the centre and made a dimple.
            const d2 = d * d;
            const take = (this.height[i] - this.bed) * (1 - d2 * d2) * pressure;
            if (take > 0) { sources.push([i, take]); amount += take; }
          } else if (d < LIP_OUT && ahead > -0.4) {
            // The bulldozer lip: most of the clay goes ahead of the foot, the rest to levees at
            // the sides, nothing behind it (that is the trench being left).
            const capacity = Math.max(0, this.ceiling - this.height[i]);
            const u = (d - LIP_PEAK) / LIP_W, band = Math.exp(-u * u);
            const inner = Math.min(1, (d - LIP_IN) / (LIP_PEAK - LIP_IN)), rear = Math.min(1, (ahead + 0.4) / 0.4);
            const weight = capacity * band * inner * inner * rear * (0.35 + Math.max(0, ahead) * 1.4);
            if (weight > 0) { targets.push([i, weight, capacity]); room += weight; }
          }
        }
        if (!amount || !room) continue;
        // Cap the whole transfer so no target overflows; excavation and deposition stay equal.
        let transfer = amount;
        for (const [, weight, capacity] of targets) transfer = Math.min(transfer, capacity * room / weight);
        for (const [i, take] of sources) {
          const removed = take * transfer / amount;
          this.height[i] -= removed;
          this.wear[i] = Math.min(1, this.wear[i] + removed * 1.5);
        }
        for (const [i, weight] of targets) this.height[i] += transfer * weight / room;
        if (loX < bx0) bx0 = loX; if (loZ < bz0) bz0 = loZ;
        if (hiX > bx1) bx1 = hiX; if (hiZ > bz1) bz1 = hiZ;
        changed = true;
      }
      if (changed) { this.revision++; this.markDirty(bx0, bz0, bx1, bz1); }
      return changed;
    }
    // Let over-steep lips slump. Confined to the region the last strokes touched (plus a margin
    // for the slump to travel), because a whole-board pass at the finer grid would cost as much as
    // the rest of the frame -- and clay nobody has touched is already at rest by definition.
    settle(region) {
      const h = this.height, n = this.size, slope = this.cell * this.repose;
      const r = region || { x0: 0, z0: 0, x1: n - 1, z1: n - 1 }, m = 3;
      const x0 = Math.max(0, r.x0 - m), z0 = Math.max(0, r.z0 - m);
      const x1 = Math.min(n - 1, r.x1 + m), z1 = Math.min(n - 1, r.z1 + m);
      let changed = false;
      const pair = (a, b) => {
        if (!this.inside[a] || !this.inside[b]) return;
        const diff = h[a] - h[b], excess = Math.abs(diff) - slope;
        if (excess < 0.0005) return;
        const flow = Math.sign(diff) * excess * 0.24;
        h[a] -= flow; h[b] += flow; changed = true;
      };
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const i = z * n + x;
        if (x + 1 <= x1) pair(i, i + 1);
        if (z + 1 <= z1) pair(i, i + n);
      }
      if (changed) { this.revision++; this.markDirty(x0, z0, x1, z1); }
      return changed;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = ClaySurface;
  else root.TauClaySurface = ClaySurface;
})(typeof window !== 'undefined' ? window : globalThis);
