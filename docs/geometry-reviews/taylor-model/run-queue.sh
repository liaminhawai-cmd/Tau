#!/bin/bash
# Cover several arms at once, four pieces at a time, from a list of jobs on stdin:
#   <bluePivot> <blueDir> <from> <to> <remToSym 0|1>
# Jobs whose result file already exists are skipped, so an interrupted queue can be repeated. A piece
# is one run of cover2.js; its output goes to results/arm_X/cover_<from>_<to>.out.
cd "$(dirname "$0")"
xargs -P 4 -L 1 bash -c '
bp=$0; bd=$1; a=$2; b=$3; sym=$4
dir="results/arm_${bp}_$([ "$bd" -gt 0 ] && echo p || echo m)"; mkdir -p "$dir"
[ -f "$dir/cover_${a}_${b}_d4.json" ] && exit 0
if [ "$sym" = 1 ]; then export SYMREM=1; else unset SYMREM; fi
( time node cover2.js $bp $bd $a $b 4 1e-5 ) > "$dir/cover_${a}_${b}.out" 2>&1
'
echo "queue done"
