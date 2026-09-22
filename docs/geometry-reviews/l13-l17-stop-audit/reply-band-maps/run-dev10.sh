#!/bin/bash
set -e
SP=/tmp/claude-0/-home-user-Tau/fe0b5237-cc45-5aea-9508-41f6a56c60fe/scratchpad
node -e '
const rows = require("/tmp/dev10-rows.json");
rows.forEach((r,i)=>console.log(i, r.family, r.mover, r.p.join(",")));
' > /tmp/dev10-list.txt
while read -r i fam mover pose; do
  echo "=== [$i] $fam mover=$mover ===" >&2
  TAU_ROOT=$SP/abl node map-position.js --pose "$pose" --victim "$mover" --label "$fam" \
    --json results/dev10-${fam}.json > results/dev10-${fam}.summary.json 2>>results/dev10-run.log
done < /tmp/dev10-list.txt
echo "all done" >&2
