// How a cell is retried after a plain run fails, in order. Each mode is tried only on cells up to
// its width: separate branches that give up at the cap rather than merge distinct outcomes; then,
// on narrow cells (contact-switch jumps), separate branches merged into hulls past the cap.
'use strict';
module.exports = {
  MODES: [
    ['branch', 0.25, { branch: true, branchStraddle: false, tolHull: 1e-7, maxBranches: 8, failOnForcedMerge: true }],
    ['branch+merge', 2e-3, { branch: true, branchStraddle: false, tolHull: 1e-7, maxBranches: 8 }],
  ],
};
