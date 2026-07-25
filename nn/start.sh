#!/bin/sh
# Tau NN training — run from anywhere. Ctrl-C to stop; progress is saved every stage.
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed — install it first."; exit 1; }
git pull >/dev/null 2>&1 || true
echo "Training started. Ctrl-C any time to stop — progress is saved."
exec node run.js
