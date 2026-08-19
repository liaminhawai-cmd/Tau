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
