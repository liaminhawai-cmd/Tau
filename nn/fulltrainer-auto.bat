@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

rem Non-interactive equivalent of menu option 20, used after option 43 finishes its wild mint.
rem The official colour-balanced Elo league is now the main game factory AND the main training-data
rem factory. A small exploration stream keeps random/seeded positions, plus one retromine worker.
set "DUALFLAG="
where python >nul 2>nul
if errorlevel 1 set "DUALFLAG=--noDual"
if not defined DUALFLAG (
  python -c "import torch" >nul 2>nul
  if errorlevel 1 set "DUALFLAG=--noDual"
)

echo.
echo Full Tau trainer starting automatically after wild mint.
echo Main CPU: official temp-0 two-colour league; every rated game also becomes training data.
echo Small side streams: randomized/seeded self-play plus one retromine worker.
echo Compute-aware D1/D2/D3/D4 culling and GPU value/dual evolution are unchanged.
echo Close the window any time; completed work is checkpointed.
echo.
if defined DUALFLAG (
  node nn\league-trainer.js --gamesPerBatch 1000 --scratchHidden 96,64,48 %DUALFLAG%
) else (
  node nn\league-trainer.js --gamesPerBatch 1000 --scratchHidden 96,64,48 --dualEpochs 20,40,60 --dualPopulationMin 4
)
exit /b %errorlevel%
