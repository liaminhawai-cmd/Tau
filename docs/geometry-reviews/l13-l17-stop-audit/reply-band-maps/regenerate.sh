#!/bin/bash
# Regenerate every map in results/ from positions.tsv against a pinned engine.
#   PIN=ce0e61d1e7482e3d1252aadadf97bd4269f71e29 ./regenerate.sh
# Extracts index.html and nn/engine.js at $PIN into a scratch dir, so the working tree's own
# revision never leaks into the maps. Four positions at a time.
set -euo pipefail
cd "$(dirname "$0")"
PIN=${PIN:-ce0e61d1e7482e3d1252aadadf97bd4269f71e29}
SRC=$(mktemp -d); mkdir -p "$SRC/nn"
git show "$PIN:index.html" > "$SRC/index.html"
git show "$PIN:nn/engine.js" > "$SRC/nn/engine.js"
grep -v '^#' positions.tsv | while IFS=$'\t' read -r out label victim pose source; do
  printf '%s\t%s\t%s\t%s\n' "$out" "$label" "$victim" "$pose"
done | xargs -P 4 -L 1 -d '\n' bash -c 'IFS=$'"'"'\t'"'"' read -r out label victim pose <<< "$0"
  TAU_ROOT='"$SRC"' TAU_SOURCE_REV='"$PIN"' node map-position.js --pose "$pose" --victim "$victim" --label "$label" \
    --json "$out.json" > "$out.summary.json"'
node cover.js results/brief6-seed.json > results/brief6-seed.cover.json
rm -rf "$SRC"
