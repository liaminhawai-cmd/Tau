@echo off
setlocal
cd /d "%~dp0.."

echo.
echo Grow best.json wider and train it on ALL the data (experiment)
echo   Copies best.json into a 640-wide net that plays identically at birth, then
echo   trains it on every data file, one RAM-sized shard at a time, scoring games
echo   best.json never saw after each shard. When a full pass brings no new best it
echo   goes back to its best weights at half the learning rate; after 4 drops it stops.
echo   The result lands in nn\models\grow-w640-NNN.json and the running trainer
echo   seats it in the league by itself. Safe to run alongside the trainer.
echo.
echo   The first pass parses every data file (10-20 min). nn\grow-cache\ keeps the
echo   parsed rows (~half the data's size) so later passes are fast; delete it after.
echo   Options:  --width 560   --shardMB 2000 (bigger shards if the trainer is stopped)
echo.
python nn\grow-train.py %*
pause
