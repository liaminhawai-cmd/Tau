#!/bin/bash
# Cover one blue arm in pieces, four at a time.
#   ./run-arm.sh <bluePivot> <blueDir> <from> <to> <pieceDeg> [degree=4]
# Pieces that already have a result file are skipped, so an interrupted run can be repeated.
set -e
cd "$(dirname "$0")"
bp=$1; bd=$2; from=$3; to=$4; piece=$5; deg=${6:-4}
dir="results/arm_${bp}_$([ "$bd" -gt 0 ] && echo p || echo m)"
mkdir -p "$dir"
node -e "
const [from, to, piece] = [$from, $to, $piece];
const n = Math.ceil((to - from) / piece - 1e-9);
for (let i = 0; i < n; i++) {
  // piece edges are dyadic-friendly sums computed once, so neighbouring pieces share an edge exactly
  const a = i === 0 ? from : from + i * piece, b = i === n - 1 ? to : from + (i + 1) * piece;
  console.log(a + ' ' + b);
}" | while read a b; do
  [ -f "$dir/cover_${a}_${b}_d${deg}.json" ] || echo "$a $b"
done | xargs -P 4 -L 1 bash -c "( time node cover2.js $bp $bd \$0 \$1 $deg 1e-5 ) > $dir/cover_\$0_\$1.out 2>&1"
echo "arm ($bp,$bd) $from..$to done"
