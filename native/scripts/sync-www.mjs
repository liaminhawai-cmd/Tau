#!/usr/bin/env node
// Copies the playable game from the repo root into a wrapper app's www/ dir
// so it can be bundled offline. The game is self-contained (Three.js is
// inlined in index.html), so only these files are needed.
//
// Usage: node sync-www.mjs <dest-dir> [--steam]   (dest is wiped and recreated)
// --steam additionally bundles the premium showcase (steam.html + vendor/three),
// which only the desktop/Steam wrapper ships.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dest = process.argv[2];
if (!dest) {
  console.error('usage: node sync-www.mjs <dest-dir>');
  process.exit(1);
}
const www = resolve(dest);

const FILES = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'apple-touch-icon.png',
  'favicon-32.png',
  'icon-192.png',
  'icon-512.png',
  'tau-logo.png',
];

const steam = process.argv.includes('--steam');
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
for (const f of FILES) {
  cpSync(join(repoRoot, f), join(www, f));
}
if (steam) {
  cpSync(join(repoRoot, 'steam.html'), join(www, 'steam.html'));
  cpSync(join(repoRoot, 'vendor'), join(www, 'vendor'), { recursive: true });
}
console.log(`Synced ${FILES.length}${steam ? ' + steam.html + vendor/' : ''} files into ${www}`);
