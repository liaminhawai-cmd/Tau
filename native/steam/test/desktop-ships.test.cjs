// Every file the shells ship must be a file CI builds on.
//
// native/scripts/sync-www.mjs decides what goes into a wrapper's www/ directory, and the push
// filter in .github/workflows/native-builds.yml decides which commits get an Android, iOS or Steam
// build. Those are two hand-kept lists describing the same thing, and they had drifted: the filter
// named index.html, steam.html and desktop/** and nothing else, so a commit touching sw.js, the web
// manifest, an icon or the three.js bundle produced no build on any platform and left its pull
// request with no checks at all -- green by absence.
//
// Rather than compare two lists of strings, this runs the real sync script into a scratch directory
// and asks of every file that actually lands there: would a commit to this have built anything?
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

// The workflow's push filter, read as the workflow reader sees it: the `paths:` block of the `push:`
// trigger, stopping at the next key. Parsed rather than duplicated, so editing the workflow is the
// only place this rule is written down.
function pushPaths() {
  const yml = fs.readFileSync(path.join(root, '.github/workflows/native-builds.yml'), 'utf8');
  const block = /\n {2}push:\n([\s\S]*?)\njobs:/.exec(yml);
  assert.ok(block, 'native-builds.yml still has a push: trigger above jobs:');
  const paths = /\n {4}paths:\n((?: {6}- .*\n)+)/.exec(block[1]);
  assert.ok(paths, 'the push: trigger still has a paths: filter');
  return paths[1].trim().split('\n').map(line => line.trim().replace(/^- /, '').replace(/^'|'$/g, ''));
}

// GitHub's filter globs, narrowed to the two shapes this file uses: an exact path, or a prefix
// ending in /**. Anything fancier should be matched properly rather than guessed at here.
function matches(file, pattern) {
  if (pattern.endsWith('/**')) return file.startsWith(pattern.slice(0, -2));
  assert.ok(!pattern.includes('*'), `unsupported glob in the workflow filter: ${pattern}`);
  return file === pattern;
}

// What actually ships: run the real script, walk what it produced. --premium is what the Steam
// wrapper and the native app both pass, so it is the widest shipped set.
function shippedFiles() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'tau-ships-'));
  try {
    execFileSync(process.execPath, [path.join(root, 'native/scripts/sync-www.mjs'), dest, '--premium'],
                 { stdio: 'pipe' });
    const out = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else out.push(path.relative(dest, full).split(path.sep).join('/'));
      }
    })(dest);
    return out;
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

test('every file the shells ship is a file the native builds trigger on', async t => {
  const paths = pushPaths();
  const shipped = shippedFiles();
  assert.ok(shipped.includes('index.html'), 'the sync script still ships the game');
  assert.ok(shipped.length > 8, 'and rather more than the game');
  const unbuilt = shipped.filter(f => !paths.some(p => matches(f, p)));
  assert.deepEqual(unbuilt, [],
    'these ship to players but no native build runs when they change -- add them to the paths: '
    + 'filter in .github/workflows/native-builds.yml');
});

test('the wrappers and the workflow itself also trigger a build', async t => {
  const paths = pushPaths();
  // Not shipped into www/, but a change to either plainly needs building: the wrapper source is the
  // app around the game, and a workflow that cannot rebuild itself cannot be trusted to have run.
  for (const f of ['native/steam/main.js', 'native/app/capacitor.config.json',
                   'native/scripts/sync-www.mjs', '.github/workflows/native-builds.yml'])
    assert.ok(paths.some(p => matches(f, p)), `${f} should trigger a native build`);
});
