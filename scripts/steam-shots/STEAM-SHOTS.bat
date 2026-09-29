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

rem Double-clicked with no options: ask. Options typed after the name (a shortcut, a command line)
rem skip the questions entirely.
set "OPTS=%*"
if "%~1"=="" (
  echo.
  echo   How should it render?
  echo     1  Ray traced ^(Ultra^) -- best lighting, slowest. Works on any modern card, a GTX 1080 included.
  echo     2  High -- exactly the in-game look, much quicker
  set "Q=1"
  set /p "Q=  Pick 1 or 2 [1]: "
  echo.
  echo   What should it make?
  echo     1  Everything ^(screenshots + store capsules and library art^)
  echo     2  Just the gameplay screenshots
  echo     3  Just the store capsules and library art
  set "W=1"
  set /p "W=  Pick 1, 2 or 3 [1]: "
  echo.
  echo   Screenshot size?
  echo     1  4K ^(3840x2160^) -- sharpest
  echo     2  1080p ^(1920x1080^) -- about four times quicker
  set "R=1"
  set /p "R=  Pick 1 or 2 [1]: "
  set "OPTS="
  if "!Q!"=="2" set "OPTS=!OPTS! --raster"
  if "!W!"=="2" set "OPTS=!OPTS! --only shots"
  if "!W!"=="3" set "OPTS=!OPTS! --only art"
  if "!R!"=="2" set "OPTS=!OPTS! --scale 1"
  echo.
  echo   Running with:!OPTS!
)

echo.
echo   An Edge or Chrome window will open and play through the boards. Leave it alone while it works:
echo   each image waits until the ray tracer has finished refining it. Expect roughly 15-40 minutes
echo   depending on the graphics card. Close this window to stop.
echo.
node shots.mjs !OPTS!
echo.
if exist output explorer output
pause
