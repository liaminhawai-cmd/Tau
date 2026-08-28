@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
title Tau trainer (league-first)

echo ================================================
echo   Tau: pull latest, then restart the trainer
echo ================================================
echo.
echo   CLOSE THE OLD TRAINER WINDOW FIRST if one is still running --
echo   two trainers on one machine fight over cores and the Elo writer.
echo   (The Live Ladder window can stay open; it is a separate process.)
echo.
pause

rem Find a git this machine can actually run. This box pulls with GitHub Desktop,
rem which bundles its own git and may leave nothing on PATH, so probe like run.js does:
rem plain git first, then Desktop's bundle (newest app-* dir), then a normal install.
set "GIT="
where git >nul 2>nul && set "GIT=git"
if not defined GIT if exist "%LOCALAPPDATA%\GitHubDesktop" (
  for /f "delims=" %%G in ('dir /b /o-n "%LOCALAPPDATA%\GitHubDesktop\app-*" 2^>nul') do (
    if not defined GIT if exist "%LOCALAPPDATA%\GitHubDesktop\%%G\resources\app\git\cmd\git.exe" (
      set "GIT=%LOCALAPPDATA%\GitHubDesktop\%%G\resources\app\git\cmd\git.exe"
    )
  )
)
if not defined GIT if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"
if not defined GIT if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "GIT=%ProgramFiles(x86)%\Git\cmd\git.exe"

echo.
echo === pulling latest ===
if defined GIT (
  "%GIT%" pull --no-edit --no-rebase
) else (
  echo   no git found on this machine -- skipping the pull.
  echo   Pull in GitHub Desktop first, then run this again.
)


rem Name this machine once, on first run. Medals are published per machine
rem (nn\medals\<machine>\gold.json), so each trainer keeps its own top three instead of
rem overwriting the shared three filenames every other trainer also writes -- and seeding below
rem then imports EVERY machine's medals, so the best few from any training run anywhere end up in
rem this box's population. The id lives in nn\.machine-id, which is gitignored: it is the one file
rem that has to differ between clones.
if not exist "nn\.machine-id" (
  echo.
  echo   This machine has no name yet. It is used to file its medals separately from the
  echo   other trainers', so nothing overwrites anything.
  set "MNAME="
  set /p MNAME="Name this machine, Enter for %COMPUTERNAME%: "
  if "!MNAME!"=="" set "MNAME=%COMPUTERNAME%"
  node nn\machine-id.js --set "!MNAME!"
)
for /f "delims=" %%M in ('node nn\machine-id.js') do set "MACHINE=%%M"
echo.
echo   machine: !MACHINE!

rem Import every machine's published medals before training. Without this the roster never sees
rem them: it scans nn\models only, and nn\medals is a different directory it has no idea exists.
rem Idempotent -- anything already in the population is left alone -- so it is safe every launch,
rem and it is how a second trainer's findings actually reach this box rather than just sitting in
rem the working tree after a pull.
echo.
echo === importing medals from every machine ===
node nn\seed-population.js

rem Dual training needs python + torch; without them the trainer runs value-only.
set "DUALFLAG="
where python >nul 2>nul
if errorlevel 1 set "DUALFLAG=--noDual"
if not defined DUALFLAG (
  python -c "import torch" >nul 2>nul
  if errorlevel 1 set "DUALFLAG=--noDual"
)

echo.
echo === starting the league-first trainer ===
echo   main   : official temp-0 red/blue league -- rating AND training data
echo   pairs  : drawn by score (strong + uncertain favoured), rent by MEASURED compute
echo   side   : 2-worker seeded/random exploration + 1-worker retromine
echo   data   : Elo-weighted by default (nn\train-value.js --eloWeight off to disable)
echo.
if defined DUALFLAG (
  node nn\league-trainer.js --gamesPerBatch 1000 --scratchHidden 96,64,48 %DUALFLAG%
) else (
  node nn\league-trainer.js --gamesPerBatch 1000 --scratchHidden 96,64,48 --dualEpochs 20,40,60 --dualPopulationMin 4
)
echo.
echo Trainer stopped. Close this window, or run this file again to restart.
pause
