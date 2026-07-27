@echo off
rem Ladder-data helper for a SECOND machine -- double-click to generate pure ladder-vs-ladder
rem training data in parallel with the desktop's own run.js loop. Copy the finished
rem nn/data/laptop-*.jsonl file(s) into the desktop's nn/data folder any time, even mid-run --
rem train.js rescans every *.jsonl there at the start of each iteration and picks it up
rem automatically, no restart needed on the desktop side.
rem
rem This does NOT replace anything run.js already does -- every desktop iteration already spends
rem 30%% of its games on pure ladder-vs-ladder (see run.js's --mix), filed alongside the rest.
rem This machine just adds more of that same kind of data, using its own CPU instead of the
rem desktop's.
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer - please call Liam.
  echo.
  pause
  exit /b 1
)
git pull >nul 2>nul

rem Timestamped output name, so running this again tonight or next week never overwrites a
rem previous batch -- e.g. data\laptop-2026-07-27T08-14-03.jsonl
for /f "delims=" %%T in ('node -e "console.log(new Date().toISOString().replace(/[:.]/g,'-'))"') do set STAMP=%%T
set OUT=data\laptop-%STAMP%.jsonl

rem How many games -- override with: START-laptop.bat 3000
set GAMES=%1
if "%GAMES%"=="" set GAMES=5000

rem Same worker cap run.js uses on the desktop (cores-1, capped at 8: the gain flattens past
rem that and each worker holds its own engine sandbox) -- consistent policy, not this machine's
rem full core count.
for /f "delims=" %%W in ('node -e "console.log(Math.max(1, Math.min(require('os').cpus().length - 1, 8)))"') do set WORKERS=%%W

rem --model nowhere.json is deliberate: no file exists at that path, so selfplay.js can't load a
rem net and every game falls back to ladder-vs-ladder -- no checkpoint needs to be synced here.
echo Generating ladder data to %OUT% (%WORKERS% workers)
echo Leave this window open overnight. Close it any time -- whatever's written so far is valid,
echo just copy the file across once you do.
node selfplay.js --games %GAMES% --out %OUT% --model nowhere.json --levels 3,4,5,6,7 --deep 8,9,10,11 --deepEvery 6 --workers %WORKERS%
pause
