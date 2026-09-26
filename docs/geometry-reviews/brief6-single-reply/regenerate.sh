#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node probe-single-reply.js --pattern 0.25 --label quarter-plus-partial --out quarter-plus-partial.json
node probe-single-reply.js --pattern 1 --label one-plus-partial --out one-plus-partial.json
node probe-single-reply.js --pattern 3 --label three-plus-partial --out three-plus-partial.json
node probe-single-reply.js --pattern 0.17,0.83,1.7,2.9 --label mixed-plus-partial --out mixed-plus-partial.json
python free_motion.py
