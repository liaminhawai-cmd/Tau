@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
title Tau -- L13 round robin

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this machine ^(or not on PATH^).
  echo   Install the LTS from https://nodejs.org ^(defaults are fine^), then run this again.
  echo.
  pause
  exit /b 1
)

rem Which way of running the top rung is strongest? Nine brains, every pair twice (once each as
rem Blue and Red), all from the real starting position with the corner-opening coin seeded -- so a
rem rerun plays exactly the same games. See nn\l13-roundrobin.js for what each brain is.
rem   L10, L11 . . . . . . . . the menu's levels, as shipped
rem   L13-old  . . . . . . . . the Committee before the throw check
rem   L13  . . . . . . . . . . the Committee as shipped (vote, then "does this hand them a throw?")
rem   L13-d2, L13-d3 . . . . . each net picks, each net replies (and at d3 answers), worst case wins
rem   Champion-d1/d2/d3  . . . Level 12's net searching 1, 2, 3 plies
rem Nothing here touches the live league, the Elo pool or any model.

echo ================================================
echo   Tau -- L13 round robin
echo ================================================
echo.

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
if defined GIT (
  echo   === pulling latest ===
  "%GIT%" pull --no-edit --no-rebase
) else (
  echo   no git found -- skipping the pull. Pull in GitHub Desktop first if this clone is stale.
)

rem Every core but one. d3 is the slow brain (several seconds a move); its games start first.
set /a WORKERS=%NUMBER_OF_PROCESSORS%-1
if %WORKERS% LSS 1 set WORKERS=1
echo.
echo   %WORKERS% workers, 72 games. The depth-3 games take the longest -- expect most of an hour
echo   on a few cores, much less on many. Every game's positions are saved as training data.
echo.

node nn\l13-roundrobin.js --workers %WORKERS% --saveData "%CD%\nn\data\l13-roundrobin-%COMPUTERNAME%.jsonl"

echo.
echo   The table above is also saved in nn\arena-logs\l13-roundrobin-*.txt
echo   Training rows: nn\data\l13-roundrobin-%COMPUTERNAME%.jsonl
echo.
pause
