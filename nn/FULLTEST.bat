@echo off
rem ============================================================================================
rem  THE ONE FILE. Double-click this and walk away. Runs all three outstanding experiments back
rem  to back and writes every result to archtest-result.txt (open it in Notepad afterwards --
rem  you never have to copy anything out of this window).
rem
rem    FULLTEST.bat          use most of this machine's cores
rem    FULLTEST.bat 4        cap at 4 workers (leave cores free for START.bat's training loop)
rem
rem  Budget roughly 3 hours with the whole machine, or most of a night sharing with the trainer.
rem
rem  ---- WHAT IT RUNS, AND WHY IN THIS ORDER ----
rem
rem  STAGE 1  Fair architecture bake-off, 120 epochs.
rem      The earlier bake-off gave every shape 30 epochs, which is NOT neutral between shapes:
rem      deeper nets converge slower, and the 5-layer net's best epoch was 30/30 -- still
rem      improving when the budget ran out, i.e. it never converged and the test was scored
rem      before it finished. 120 epochs is safe for everyone because train.js keeps the
rem      best-validation epoch, so a shape that peaks at epoch 12 still saves epoch 12; the
rem      extra epochs are wasted compute, never damage. No --skipTrain: the existing
rem      arch-*.json were trained on 30 epochs AND under the old leaky train/val split, so
rem      they have to be rebuilt to mean anything.
rem      96,64,48 is in the field because it has 17,345 parameters against 96,96's 17,377 --
rem      0.2% apart -- so it isolates "taper plus a layer" from capacity almost exactly.
rem
rem  STAGE 2  The same nets replayed at search depth 2.
rem      A ranking that only holds at depth 1 is a depth-1 artifact, and the net is used at
rem      several depths (run.js benchmarks at 1, 2 and 3). --skipTrain reuses stage 1's nets,
rem      so this is games only, no retraining.
rem
rem  STAGE 3  Ladder placement of stage 1's winner: does it beat L9/L10/L11, and at what depth?
rem      This is the one that speaks to "more rungs above 11". Each extra ply is worth roughly
rem      a rung, so if the net clears L11 at depth 3, then depths 2/3/4 of that same net are
rem      candidate rungs and nothing needs retraining. Picks up the winner automatically via
rem      models\.archtest-winner.
rem ============================================================================================
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer - please call Liam.
  echo.
  pause
  exit /b 1
)

set SHAPES=--hidden 96,96 --hidden 96,64,48 --hidden 82,64,48,32 --hidden 64,64,64,64
set WORKERS=
if not "%1"=="" set WORKERS=--workers %1

echo.
echo ================================================================
echo  Tau full test - 3 stages, roughly 3 hours. Safe to leave alone.
echo  Everything is also saved to archtest-result.txt.
echo ================================================================
echo.
echo IMPORTANT: if START.bat's training loop is running, this will fight it for cores and both
echo will crawl. Either close the trainer for the duration, or run: FULLTEST.bat 4
echo.

echo.
echo === STAGE 1 of 3: fair architecture bake-off (120 epochs) ===
echo.
node archtest.js %SHAPES% --epochs 120 --seed 1 --games 40 --depth 1 --vs models\best.json %WORKERS%
if errorlevel 1 goto failed

echo.
echo === STAGE 2 of 3: same nets, search depth 2 ===
echo.
node archtest.js %SHAPES% --epochs 120 --seed 1 --games 30 --depth 2 --vs models\best.json --skipTrain %WORKERS%
if errorlevel 1 goto failed

echo.
echo === STAGE 3 of 3: ladder placement of the winner ===
echo.
node laddertest.js --levels 9,10,11 --depths 1,2,3 --games 6 %WORKERS%
if errorlevel 1 goto failed

echo.
echo ================================================================
echo  ALL DONE. Open archtest-result.txt in Notepad and send it over.
echo ================================================================
echo.
pause
exit /b 0

:failed
echo.
echo A stage failed above. archtest-result.txt still holds whatever finished.
echo.
pause
exit /b 1
