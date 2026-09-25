/* Cosmetic clay heightfield. No game state, collision or movement dependencies.
   Units are board units; transported volume stays in the grid, including old ridges. */
(function (root) {
  'use strict';
  class ClaySurface {
    constructor(radius, size = 129) {
      this.radius = radius; this.size = size; this.cell = 2 * radius / (size - 1);
      this.height = new Float32Array(size * size);
      this.wear = new Float32Array(size * size);
      this.inside = new Uint8Array(size * size);
      this.bed = -0.18; this.ceiling = 0.65; this.revision = 0;
      for (let z = 0; z < size; z++) for (let x = 0; x < size; x++)
        this.inside[z * size + x] = Math.hypot(x * this.cell - radius, z * this.cell - radius) <= radius;
    }
    reset() { this.height.fill(0); this.wear.fill(0); this.revision++; }
    scrape(x0, z0, x1, z1, width = 2.4) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (!Number.isFinite(len) || len < 0.001) return false;
      // A discontinuity is a restored position/new replay frame, not a foot dragged across the ring.
      if (len > this.radius * 0.35) return false;
      const steps = Math.ceil(len / (this.cell * 0.45)), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      let changed = false;
      for (let step = 1; step <= steps; step++) {
        const x = x0 + (x1 - x0) * step / steps, z = z0 + (z1 - z0) * step / steps;
        if (Math.hypot(x, z) > this.radius) continue;
        const sources = [], targets = [], extent = width * 2.0;
        const loX = Math.max(0, Math.floor((x - extent + this.radius) / this.cell));
        const hiX = Math.min(this.size - 1, Math.ceil((x + extent + this.radius) / this.cell));
        const loZ = Math.max(0, Math.floor((z - extent + this.radius) / this.cell));
        const hiZ = Math.min(this.size - 1, Math.ceil((z + extent + this.radius) / this.cell));
        let amount = 0, room = 0;
        const pressure = Math.min(0.6, len / steps / width * 0.65);
        for (let iz = loZ; iz <= hiZ; iz++) for (let ix = loX; ix <= hiX; ix++) {
          const i = iz * this.size + ix;
          if (!this.inside[i]) continue;
          const rx = ix * this.cell - this.radius - x, rz = iz * this.cell - this.radius - z;
          const d = Math.hypot(rx, rz) / width, ahead = (rx * dx + rz * dz) / width;
          if (d < 1) {
            const take = (this.height[i] - this.bed) * (1 - d * d) * pressure;
            if (take > 0) { sources.push([i, take]); amount += take; }
          } else if (d < 2 && ahead > -0.35) {
            // Most clay collects at the leading lip; the rest forms shoulders beside the groove.
            const capacity = Math.max(0, this.ceiling - this.height[i]);
            const weight = capacity * (2 - d) * (0.3 + Math.max(0, ahead));
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
          this.wear[i] = Math.min(1, this.wear[i] + removed * 3);
        }
        for (const [i, weight] of targets) this.height[i] += transfer * weight / room;
        changed = true;
      }
      if (changed) this.revision++;
      return changed;
    }
    settle() {
      // Cohesive clay holds shallow ridges. Only steep local lips slump; there is no global fade.
      const h = this.height, n = this.size, slope = this.cell * 0.16;
      let changed = false;
      const pair = (a, b) => {
        if (!this.inside[a] || !this.inside[b]) return;
        const diff = h[a] - h[b], excess = Math.abs(diff) - slope;
        if (excess < 0.0005) return;
        const flow = Math.sign(diff) * excess * 0.24;
        h[a] -= flow; h[b] += flow; changed = true;
      };
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
        const i = z * n + x;
        if (x + 1 < n) pair(i, i + 1);
        if (z + 1 < n) pair(i, i + n);
      }
      if (changed) this.revision++;
      return changed;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = ClaySurface;
  else root.TauClaySurface = ClaySurface;
})(typeof window !== 'undefined' ? window : globalThis);
