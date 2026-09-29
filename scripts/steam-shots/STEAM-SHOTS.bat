@echo off
setlocal enabledelayedexpansion
title Tau -- Steam screenshots and store art (GPU, ray traced)
rem Renders Tau's Steam screenshots and store art on THIS PC's graphics card with the game's own
rem path tracer, in an Edge/Chrome window you can watch. Output: scripts\steam-shots\output\
rem Extra options go straight through, e.g.   STEAM-SHOTS.bat --only shots   or   --samples 512

cd /d "%~dp0..\.."

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed ^(or not on PATH^).
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

rem Always render the newest game from main. A checkout sitting on another branch (the trainer's)
rem keeps a separate copy of main beside it, in ..\Tau-shots, and runs from there.
if defined GIT if not defined TAU_SHOTS_INNER (
  for /f "delims=" %%B in ('"%GIT%" rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%B"
  if /i "!BRANCH!"=="main" (
    echo   === pulling the latest main ===
    "%GIT%" pull --ff-only
  ) else (
    set "WT=%CD%\..\Tau-shots"
    echo   === this folder is on "!BRANCH!" -- rendering from a copy of main in !WT! ===
    "%GIT%" fetch origin main
    if exist "!WT!\.git" (
      pushd "!WT!"
      "%GIT%" checkout --force --detach origin/main
      popd
    ) else (
      "%GIT%" worktree add --force --detach "!WT!" origin/main
    )
    if not exist "!WT!\scripts\steam-shots\shots.mjs" (
      echo   Could not set up the copy of main. Is this a clone of liaminhawai-cmd/Tau?
      pause
      exit /b 1
    )
    set "TAU_SHOTS_INNER=1"
    call "!WT!\scripts\steam-shots\STEAM-SHOTS.bat" %*
    exit /b
  )
)
if not defined GIT echo   No git found -- using this folder as it is. Pull in GitHub Desktop first if it is out of date.

cd scripts\steam-shots
if not exist node_modules\playwright-core (
  echo   === one-time setup: installing the browser driver ^(no browser download^) ===
  call npm install --no-audit --no-fund
)

echo.
echo   An Edge or Chrome window will open and play through the boards. Leave it alone while it works:
echo   each image waits until the ray tracer has finished refining it. Expect roughly 15-40 minutes
echo   depending on the graphics card. Close this window to stop.
echo.
node shots.mjs %*
echo.
if exist output explorer output
pause
