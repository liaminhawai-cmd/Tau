'use strict';
// One durable small-file writer for every piece of shared trainer state.
//
// The old inline version was `writeFileSync(tmp); renameSync(tmp, path)`. On Windows that rename
// fails with EPERM/EBUSY/EACCES whenever ANOTHER process merely has the destination open -- even
// just for reading -- and Tau runs several processes over the same few state files at once: the
// league's elorank pass, run.js's periodic `--cullOnly` pass, the medals publisher, and
// live-ladder.js polling to draw the dashboard. A virus scanner or the search indexer touching
// the file does it too.
//
// It bit for real: a rename of .evolution-roster.json threw straight out of ingestSummary, past
// elorank.js, and killed a whole 15-minute rating window before a single game was played
// ("[league] rating pass exited 1"). The window is tiny but there are hundreds of writes an hour,
// so "rare" becomes "several times a night".
//
// So: retry briefly (the conflicting handle is always short-lived), and if the rename still will
// not go through, write in place instead. Losing the atomic swap on a small JSON file that is
// rewritten every few seconds is much cheaper than losing the process -- and a torn read is
// already handled everywhere these files are consumed, since every reader wraps JSON.parse in a
// try/catch and falls back to a default.
const fs = require('fs');
const path = require('path');

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
// Sync sleep: these writers are all synchronous, and the whole point is to hold still for a few
// ms while somebody else's handle closes.
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch (e) { const end = Date.now() + ms; while (Date.now() < end); }
}

function atomicWrite(p, s, { mkdir = false, attempts = 12 } = {}) {
  if (mkdir) fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, s);
  for (let i = 0; i < attempts; i++) {
    try { fs.renameSync(tmp, p); return true; }
    catch (e) {
      if (!e || !RETRYABLE.has(e.code)) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
      sleepSync(20 + i * 15);            // ~1.4s total across the default 12 attempts
    }
  }
  // Still blocked after ~1.4s. Do NOT write through: every reader of these files swallows a parse
  // error and substitutes a blank default (loadState -> empty roster, read() -> empty store), so a
  // torn read would silently wipe the population history or the entire match record, and the next
  // save would persist that emptiness. Leaving the destination's last-good bytes alone is strictly
  // safer -- these files are rewritten every few seconds, so a skipped update is recovered almost
  // immediately, while a corrupt one is not recoverable at all.
  try { fs.unlinkSync(tmp); } catch (_) {}
  console.warn(`[atomic] could not replace ${path.basename(p)} (file busy); skipped this update`);
  return false;
}

module.exports = { atomicWrite };
