// The champion's search depth, remembered by the bytes it was promoted with.
//
// A promoted net has a strongest face (resume-533@D2), but the model that defends the seat next is
// ckpt-N, a fresh byte copy whose own file starts with only a D1 face rated -- and the copy it was
// promoted from is a resume-N file that the roster drops a cycle later. Reading the defender's depth
// off whichever twins are still rated therefore drifts: ckpt-621 defended at D2 in cycle 621, D1 in
// 622-627 (its twin had left), and D3 in 628 off six games. A defender playing below its strongest
// face is easy to clear, so the seat moved on search depth instead of strength. Recording the face
// at promotion, keyed by the sha1 of best.json, pins it for as long as those bytes hold the seat.
// The gate then re-measures the champion at several depths and moves the record to its best one
// (source 'panel'), with `ruledOut` listing depths it measured confidently worse at.
const fs = require('fs');
const crypto = require('crypto');

const sha1 = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

// The recorded depth for the bytes currently at `bestPath`, or null if there is no record or the
// seat has changed hands some other way since it was written.
function load(recordFile, bestPath) {
  try {
    const rec = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    if (rec && Number.isInteger(rec.depth) && rec.depth >= 1 && rec.sha1 === sha1(bestPath)) return rec;
  } catch (e) {}
  return null;
}

function save(recordFile, bestPath, info) {
  try {
    const tmp = `${recordFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...info, sha1: sha1(bestPath), at: new Date().toISOString() }));
    fs.renameSync(tmp, recordFile);
  } catch (e) {}
}

module.exports = { sha1, load, save };
