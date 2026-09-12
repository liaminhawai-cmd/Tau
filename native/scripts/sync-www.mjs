#!/usr/bin/env node
// Copies the playable game from the repo root into a wrapper app's www/ dir
// so it can be bundled offline. The game is self-contained apart from its
// three.js bundle (vendor/three/three.global.js), so only these files are needed.
//
// Usage: node sync-www.mjs <dest-dir> [--premium]   (dest is wiped and recreated)
// --premium additionally bundles the desktop presentation plus the six-board premium
// showcase (steam.html + vendor/three) -- the Steam wrapper and the native Android/iOS
// app both ship it; the plain web build does not.
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
  'vendor/three/three.global.js',   // the game's three.js (classic-script bundle); every shell needs it
];

const premium = process.argv.includes('--premium');
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
for (const f of FILES) {
  mkdirSync(dirname(join(www, f)), { recursive: true });
  cpSync(join(repoRoot, f), join(www, f));
}
if (premium) {
  cpSync(join(repoRoot, 'steam.html'), join(www, 'steam.html'));
  cpSync(join(repoRoot, 'desktop'), join(www, 'desktop'), { recursive: true });
  cpSync(join(repoRoot, 'vendor'), join(www, 'vendor'), { recursive: true });
}
console.log(`Synced ${FILES.length}${premium ? ' + steam.html + desktop/ + vendor/' : ''} files into ${www}`);
