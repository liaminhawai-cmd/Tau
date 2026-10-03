@echo off
setlocal
cd /d "%~dp0.."

echo.
echo Search-score labels: does training on the search's opinion make a stronger net? (experiment)
echo   1. Freezes a copy of best.json as the teacher and takes the newest 20,000 positions.
echo      The teacher's own D2 search scores every one. This is the long part: the ETA
echo      prints after the first few hundred. Close the window any time; rerun to resume.
echo   2. Trains two copies of the teacher on exactly those positions, same everything
echo      except the label: svx-result-NNN on the game result (as today), svx-search-NNN
echo      on half search score + half result. Both land in nn\models and the running
echo      trainer seats them in the league by itself.
echo   3. Plays them head to head from random openings (D1 and D2), plus each against the
echo      teacher, and writes nn\svx\report.txt. Safe to run alongside the trainer.
echo.
echo   Options:  --positions 10000 (faster)   --workers 6   --lanes 6   --blend 0.7
echo.
node nn\svx-experiment.js %*
pause
