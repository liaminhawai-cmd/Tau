@echo off
rem Architecture bake-off -- double-click to run. Trains several net SHAPES from scratch on the same
rem data and settles which plays best with actual games. Safe to run while START.bat's training loop
rem is going: nothing here writes to best.json, value.json or ckpt-*.json, and the models it does
rem write (models\arch-*.json) are invisible to tournament.js and to run.js's iteration counter,
rem which only look at ckpt-NNN/best/value.json. Worst case is that both run a bit slower.
rem
rem   ARCHTEST.bat              depth 1, 40 games/pair  (~80 min)
rem   ARCHTEST.bat 2            depth 2, 40 games/pair  (~4 hours -- overnight job)
rem   ARCHTEST.bat 1 20         depth 1, 20 games/pair  (quicker, noisier)
rem
rem The shapes below are chosen to separate DEPTH from CAPACITY, which "just add another layer"
rem does not: 64,64,64,64 has 17,857 parameters against 96,96's 17,377 -- within 3% -- so if it wins
rem that is depth paying off, not extra parameters. 96,96,96 (26,689) and 48x5 (13,441) bracket it.
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer - please call Liam.
  echo.
  pause
  exit /b 1
)

set DEPTH=%1
if "%DEPTH%"=="" set DEPTH=1
set GAMES=%2
if "%GAMES%"=="" set GAMES=40

echo.
echo Architecture bake-off: search depth %DEPTH%, %GAMES% games per pairing.
echo Results are also written to archtest-result.txt, so you do not have to copy this window.
echo.
rem --skipTrain reuses any models\arch-*.json already on disk, so a second run (e.g. at depth 2)
rem goes straight to the games instead of retraining everything. Delete models\arch-*.json for a
rem clean rebuild.
node archtest.js --hidden 96,96 --hidden 96,96,96 --hidden 64,64,64,64 --hidden 48,48,48,48,48 --epochs 30 --seed 1 --games %GAMES% --depth %DEPTH% --vs models\best.json --skipTrain

echo.
echo Done. The summary above is also saved in archtest-result.txt (open it in Notepad to copy).
pause
