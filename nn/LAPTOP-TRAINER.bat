@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
title Tau trainer (second machine)

rem The full league-first trainer on a machine that has never run it -- a laptop, a fresh clone, or
rem the desktop rebuilt. Same trainer RESTART-TRAINER.bat launches; the difference is one step
rem before it, without which this machine would train from nothing.
rem
rem A clone gets only what git carries. nn\.gitignore excludes data\ and models\ wholesale and the
rem trainer force-adds a handful of named exceptions -- but every one of those is invisible to the
rem roster: the five aliases (best, wide, ultra, deep, l15_value) and the ten pool slots are all
rem excluded by name in evolution-roster's stableModelEntries, and the medal checkpoints sit in
rem nn\medals\, which it never scans. Measured on a clean clone: 20 distinct networks present,
rem population zero. seed-population.js copies each distinct one in under a name the roster sees.
rem
rem The rating store (nn\elo-results.json) is local and untracked, so this machine starts a FRESH
rem league over that seeded population rather than inheriting the desktop's ~400 faces. That is the
rem point: a small dense field measures far better than a big sparse one.

echo ================================================
echo   Tau: second-machine trainer (seed, then train)
echo ================================================
echo.
echo   Run this only when the desktop's trainer is NOT running. Both machines push to the
echo   same branch and each keeps its own local rating store, so two live trainers means
echo   two disagreeing leagues writing one nn\elo-summary.json.
echo.
pause

rem Same git probe RESTART-TRAINER.bat uses: this box may pull with GitHub Desktop, which bundles
rem its own git and can leave nothing on PATH.
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
  for /f "delims=" %%B in ('"%GIT%" rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%B"
  echo   branch: !BRANCH!
  "%GIT%" pull --no-edit --no-rebase
) else (
  echo   no git found -- skipping the pull. Pull in GitHub Desktop first, then run this again.
)

echo.
echo === seeding the starting population ===
node nn\seed-population.js
if errorlevel 1 (
  echo.
  echo   Seeding failed -- not starting the trainer, because it would train from nothing.
  pause
  exit /b 1
)

rem Dual training needs python + torch; without them the trainer runs value-only on CPU, which is
rem the normal case on a laptop.
set "DUALFLAG="
where python >nul 2>nul
if errorlevel 1 set "DUALFLAG=--noDual"
if not defined DUALFLAG (
  python -c "import torch" >nul 2>nul
  if errorlevel 1 set "DUALFLAG=--noDual"
)
if defined DUALFLAG (
  echo.
  echo   No python+torch here: running value-only on CPU. That is fine -- the league still
  echo   rates, mutates and culls; only the GPU dual branch is off.
)

echo.
echo === starting the league-first trainer ===
echo   main   : official temp-0 red/blue league -- rating AND training data
echo   side   : seeded/random exploration + retromine
echo   this machine keeps its OWN nn\elo-results.json; the desktop's ratings are not inherited
echo.
if defined DUALFLAG (
  node nn\league-trainer.js --gamesPerBatch 1000 --scratchHidden 96,64,48 %DUALFLAG%
) else (
  node nn\league-trainer.js --gamesPerBatch 1000 --scratchHidden 96,64,48 --dualEpochs 20,40,60 --dualPopulationMin 4
)
echo.
echo Trainer stopped. Close this window, or run this file again to restart.
pause
