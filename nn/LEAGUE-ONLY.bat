@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

rem Overnight measurement run. One loop and nothing else:
rem   measure (official temp-0 league) -> cull -> mint/mutate -> GPU train -> measure again.
rem No retromine, no exploration self-play: every core but one plays RATED games. That is not a
rem loss of training data -- every rated game's positions are saved as training rows exactly as
rem before (see league-loop.js), so the corpus keeps growing; it grows from measured play only.
rem Use FULL-TRAINER.bat when you want the side streams back.
rem The preamble is the same safety work RESTART-TRAINER.bat does: node check, pull, machine name,
rem medal seeding. A launcher that skips those is how a machine ends up training on stale code.

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

echo.
echo Tau LEAGUE-ONLY trainer
echo   loop  : measure -^> cull -^> mint/mutate -^> GPU train -^> measure
echo   games : official temp-0 two-colour league ONLY; every core but one
echo   off   : retromine and exploration self-play
echo   data  : every rated game still saves its positions as training rows
echo.
node nn\league-trainer.js --noSelfplay --retroWorkers 0 --scratchHidden 96,64,48 %DUALFLAG%
echo.
echo Trainer stopped. Close this window, or run this file again to restart.
pause
