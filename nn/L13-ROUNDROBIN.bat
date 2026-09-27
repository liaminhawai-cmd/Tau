@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
set "HERE=%CD%"
title Tau -- L13 round robin

rem The L13 round robin needs the GAME's current code -- the Committee, its nets, the throw check
rem and the deep-search experiment all live on main. This trainer branch runs an older copy of the
rem game that the trainer's own self-play reads, and it must not change under a running trainer.
rem So this checks main out into a SEPARATE folder next to this one (..\Tau-l13rr), runs the round
rem robin from there, and saves the results and training rows back into THIS folder's nn\. This
rem folder, its branch and its uncommitted training data are not touched.

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
if not defined GIT (
  echo.
  echo   No git found. Install GitHub Desktop or Git for Windows and run this again.
  pause
  exit /b 1
)

for %%P in ("%HERE%\..") do set "PARENT=%%~fP"
set "RR=%PARENT%\Tau-l13rr"

echo ================================================
echo   Tau -- L13 round robin (runs main in %RR%)
echo ================================================
echo.
echo   === fetching main ===
"%GIT%" fetch origin main
if errorlevel 1 ( echo   fetch failed -- check the connection and run this again. & pause & exit /b 1 )

if exist "%RR%\.git" (
  echo   === updating %RR% to the latest main ===
  "%GIT%" -C "%RR%" checkout --detach --force origin/main
) else (
  echo   === first run: checking main out into %RR% ^(a few minutes, a few GB^) ===
  "%GIT%" worktree prune
  "%GIT%" worktree add --detach "%RR%" origin/main
)
if errorlevel 1 ( echo   could not check main out into %RR%. & pause & exit /b 1 )

set /a WORKERS=%NUMBER_OF_PROCESSORS%-1
if %WORKERS% LSS 1 set WORKERS=1
echo.
echo   Brains: L10 L11 L13-old L13 L13-d2 L13-d2-wide L13-d3 Champion-d1 Champion-d2 Champion-d3
echo   Round 1 is the real start; every extra round starts each pairing from its own seeded
echo   two-move opening, so more rounds = more (still repeatable) games per pairing.
echo.
set "ROUNDS="
set /p ROUNDS="How many rounds? Enter for 1: "
if "!ROUNDS!"=="" set "ROUNDS=1"
set "ONLY="
set /p ONLY="Which brains, comma separated? Enter for all ten: "
set "ONLYARG="
if not "!ONLY!"=="" set "ONLYARG=--only !ONLY!"
echo.
echo   %WORKERS% workers, !ROUNDS! round^(s^). Depth-3 brains are by far the slowest.
echo   Every game's positions are saved as training data.
echo.

if not exist "%HERE%\nn\data" mkdir "%HERE%\nn\data"
if not exist "%HERE%\nn\arena-logs" mkdir "%HERE%\nn\arena-logs"
pushd "%RR%"
node nn\l13-roundrobin.js --workers %WORKERS% --rounds !ROUNDS! !ONLYARG! --saveData "%HERE%\nn\data\l13-roundrobin-%COMPUTERNAME%.jsonl"
copy /y "nn\arena-logs\l13-roundrobin-*.*" "%HERE%\nn\arena-logs\" >nul 2>nul
popd

echo.
echo   Results:        %HERE%\nn\arena-logs\l13-roundrobin-*.txt
echo   Training rows:  %HERE%\nn\data\l13-roundrobin-%COMPUTERNAME%.jsonl
echo.
pause
