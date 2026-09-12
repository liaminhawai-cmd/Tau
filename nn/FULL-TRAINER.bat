@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

rem This file used to be the one trap in the set: the most obvious name, and the only launcher that
rem did none of the safety work. No node check, no pull, no machine name, no seeding -- so a machine
rem started from here ran whatever code happened to be on disk. That is how a desktop came back from
rem a repair and started training on pre-data-cap code against a 1.9 GB corpus. Everything below is
rem the same preamble RESTART-TRAINER.bat runs; only the dual-epoch prompt is still this file's own.

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this machine ^(or not on PATH^).
  echo   Install the LTS from https://nodejs.org ^(defaults are fine^), then run this again.
  echo.
  pause
  exit /b 1
)

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

echo.
echo === importing medals from every machine ===
node nn\seed-population.js
if errorlevel 1 (
  echo.
  echo   Seeding failed -- not starting the trainer, because it would train from nothing.
  pause
  exit /b 1
)

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
echo   side: 1 exploration lane (top nets, unseen starts) + 1 retromine lane; every other core is league
echo   evolution: existing GPU training, mutations and compute-aware culling unchanged
echo.
if defined DUALFLAG (
  node nn\league-trainer.js --scratchHidden 96,64,48 %DUALFLAG%
) else (
  node nn\league-trainer.js --scratchHidden 96,64,48 --dualEpochs %DUEPOCHS% --dualPopulationMin 4
)
pause
