// How a cell of a general arm is retried after a plain run fails, in order. Each mode is tried only
// on cells up to its width. 'straddle' keeps a contact that may or may not exist inside the cell as
// two exact outcomes instead of relaxing it.
'use strict';
module.exports = {
  MODES: [
    ['straddle', 0.25, { branch: true, branchStraddle: true, tolHull: 1e-5, maxBranches: 8, failOnForcedMerge: true }],
    ['branch', 0.25, { branch: true, branchStraddle: false, tolHull: 1e-7, maxBranches: 8, failOnForcedMerge: true }],
    ['straddle+merge', 2e-3, { branch: true, branchStraddle: true, tolHull: 1e-5, maxBranches: 8 }],
    ['branch+merge', 2e-3, { branch: true, branchStraddle: false, tolHull: 1e-7, maxBranches: 8 }],
  ],
};
