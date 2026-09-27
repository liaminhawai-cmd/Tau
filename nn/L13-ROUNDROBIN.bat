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
echo   %WORKERS% workers, 72 games. The depth-3 games take the longest -- expect most of an hour
echo   on a few cores, much less on many. Every game's positions are saved as training data.
echo.

if not exist "%HERE%\nn\data" mkdir "%HERE%\nn\data"
if not exist "%HERE%\nn\arena-logs" mkdir "%HERE%\nn\arena-logs"
pushd "%RR%"
node nn\l13-roundrobin.js --workers %WORKERS% --saveData "%HERE%\nn\data\l13-roundrobin-%COMPUTERNAME%.jsonl"
copy /y "nn\arena-logs\l13-roundrobin-*.*" "%HERE%\nn\arena-logs\" >nul 2>nul
popd

echo.
echo   Results:        %HERE%\nn\arena-logs\l13-roundrobin-*.txt
echo   Training rows:  %HERE%\nn\data\l13-roundrobin-%COMPUTERNAME%.jsonl
echo.
pause
