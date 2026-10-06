@echo off
setlocal
cd /d "%~dp0.."

echo.
echo Search-leaf labels: does training on the positions a search decides on make depth pay? (experiment)
echo   1. Freezes a copy of best.json as the teacher and takes the newest 10,000 game positions.
echo      The teacher searches each one at D3; every position its search scored a move at
echo      (3-4 per game position, none of them ever reached in a real game) is labelled with
echo      the teacher's D2 search, and so is the game position itself. This is the long part,
echo      several hours: the ETA prints after the first minute. Close the window any time;
echo      rerun to resume.
echo   2. Trains two copies of the teacher, same everything except the leaves: lfx-games-NNN
echo      on the game positions alone, lfx-leaves-NNN on the game positions plus the leaves.
echo      Both land in nn\models and the running trainer seats them in the league by itself.
echo   3. Plays them head to head at D1, D2 and D3 and writes nn\lfx\report.txt. The test is
echo      whether the leaf arm's lead GROWS with depth. Safe to run alongside the trainer.
echo.
echo   Options:  --positions 5000 (faster)   --workers 6   --lanes 6
echo.
node nn\lfx-experiment.js %*
pause
