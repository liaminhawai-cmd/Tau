// Load "the value surface" out of whichever of the three export shapes a model file happens to be.
//
// Three incompatible things all live in nn/models as .json:
//   value net  -- net.js MLP, one tanh output, scores the position               -> map it directly
//   dual net   -- dualnet.js DualMLP, slot 0 is the value, 1..22 policy logits   -> map slot 0
//   policy net -- policy.js, predicts WHICH ARM to swing and how far             -> no value surface
// Handing a policy net to MLP.fromJSON either throws on a missing `sizes` or, worse, silently
// paints an arm logit as if it were an evaluation. So sniff the shape before constructing anything.
'use strict';
const fs = require('fs');
const { MLP } = require('./net.js');
const { DualMLP } = require('./dualnet.js');

const isNumArray = a => Array.isArray(a) && a.every(v => typeof v === 'number');
const looksLikeNet = j => !!j && Array.isArray(j.sizes) && Array.isArray(j.W) && Array.isArray(j.b);

// Returns { value(x), kind, note, sizes, params }.
function loadValueNet(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  let j = raw, note = '', via = '';

  // Wrapper files (joint-policy pairs, medal manifests) nest the real net one level down.
  if (!looksLikeNet(j)) {
    const key = Object.keys(j || {}).find(k => looksLikeNet(j[k]));
    if (!key) {
      const keys = Object.keys(j || {}).join(', ') || '(none)';
      throw new Error(`${file}: no net found. Top-level keys: ${keys}. ` +
        'Expected sizes/W/b, or a wrapper holding them.');
    }
    via = key; j = j[key];
  }

  const outs = j.sizes[j.sizes.length - 1];
  // A dual export is flagged by the `dual` marker on the file, or given away by its 23 outputs
  // (1 value + 6 arms + 16 bins). A value net has exactly 1.
  const dual = !!raw.dual || outs === DualMLP_OUT();
  if (!dual && outs !== 1)
    throw new Error(`${file}: ${outs} outputs -- this is a policy net. It predicts which arm to ` +
      'swing and how far, not how good a position is, so it has no value surface to map.');

  const net = dual ? DualMLP.fromJSON(j) : MLP.fromJSON(j);
  if (dual) note = 'dual net -- mapping its value head (slot 0)';
  if (via) note = (note ? note + '; ' : '') + `net read from the "${via}" field of a wrapper file`;

  let params = 0;
  for (const w of j.W) params += w.length;
  for (const b of j.b) params += b.length;

  return {
    value: x => net.value(x),
    kind: dual ? 'dual' : 'value',
    note, params,
    sizes: j.sizes,
    topology: j.topology || null,
  };
}

function DualMLP_OUT() { return require('./dualnet.js').OUT; }

module.exports = { loadValueNet, looksLikeNet, isNumArray };
