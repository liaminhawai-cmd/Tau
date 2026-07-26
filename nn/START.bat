@echo off
rem Tau NN training — double-click to start. Leave the black window open; close it to stop.
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer - please call Liam.
  echo.
  pause
  exit /b 1
)
git pull >nul 2>nul
rem Games per iteration. Was 200, but under the thin-leg / no-grace rules a single game runs far
rem longer (L2 ~53 plies, L4 ~120, vs ~15 before) and the depth mix costs ~4.3x per move on top,
rem so 200 would make one iteration take hours. Nothing is lost by going small: train.js always
rem re-reads every accumulated nn/data/*.jsonl file, so fewer games per iteration just means more
rem frequent gate checks, not less training data. Raise it if iterations feel too quick.
set GAMES=30
echo Training started. Leave this window open. Close it any time to stop - progress is saved.
node run.js --gamesPerIter %GAMES%
pause
