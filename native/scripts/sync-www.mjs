#!/usr/bin/env node
// Copies the playable game from the repo root into a wrapper app's www/ dir
// so it can be bundled offline. The game is self-contained (Three.js is
// inlined in index.html), so only these files are needed.
//
// Usage: node sync-www.mjs <dest-dir>   (dest is wiped and recreated)
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

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
for (const f of FILES) {
  cpSync(join(repoRoot, f), join(www, f));
}
console.log(`Synced ${FILES.length} files into ${www}`);
