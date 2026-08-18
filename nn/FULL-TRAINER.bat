@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

set "DUALFLAG="
where python >nul 2>nul
if errorlevel 1 set "DUALFLAG=--noDual"
if not defined DUALFLAG (
  python -c "import torch" >nul 2>nul
  if errorlevel 1 set "DUALFLAG=--noDual"
)
set "DUEPOCHS=20,40,60"
if not defined DUALFLAG set /p DUEPOCHS="Dual epoch budgets to rotate through, Enter for 20,40,60: "
if not defined DUALFLAG if "%DUEPOCHS%"=="" set "DUEPOCHS=20,40,60"

echo.
echo Tau league-first trainer
echo   main: official temp-0 red/blue league -- rating + training data
echo   side: 2-worker randomized/seeded exploration + 1-worker retromine
echo   evolution: existing GPU training, mutations and compute-aware culling unchanged
echo.
if defined DUALFLAG (
  node nn\league-trainer.js --gamesPerBatch 1000 --scratchHidden 96,64,48 %DUALFLAG%
) else (
  node nn\league-trainer.js --gamesPerBatch 1000 --scratchHidden 96,64,48 --dualEpochs %DUEPOCHS% --dualPopulationMin 4
)
pause
