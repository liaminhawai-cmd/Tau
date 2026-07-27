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
rem
rem PARALLELISM HERE IS N SEPARATE node.exe PROCESSES (one console window each), NOT selfplay.js's
rem own --workers flag. On one laptop, selfplay.js's internal child_process.fork() workers ran for
rem 2+ hours -- real games, real varied timings and ply counts in the console -- and still produced
rem 0 bytes: their part files were never found anywhere on the C: drive, even while the run was
rem still live, not just after it ended. Windows Defender's own Protection History showed nothing,
rem so it wasn't that -- something else on that machine appears to isolate forked child processes
rem specifically. A plain --workers 1 run (no forking at all) worked immediately and correctly on
rem the SAME machine. So rather than depend on diagnosing an environment we don't control, this
rem script never calls fork(): every worker below is its own top-level node invocation, each with
rem --workers 1, the exact code path already confirmed to write real files. Costs nothing on a
rem machine where fork() was never broken -- N separate processes is still N-way parallel.
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

rem Timestamped run id, so this can be run again and again without ever overwriting a previous
rem batch -- each worker gets its own file, e.g. data\laptop-2026-07-27T09-14-03-w0.jsonl
for /f "delims=" %%T in ('node -e "console.log(new Date().toISOString().replace(/[:.]/g,'-'))"') do set STAMP=%%T

rem Total games -- override with: START-laptop.bat 3000
set GAMES=%1
if "%GAMES%"=="" set GAMES=5000

rem Same worker-count policy run.js uses on the desktop (cores-1, capped at 8: the gain flattens
rem past that and each worker holds its own engine sandbox).
for /f "delims=" %%W in ('node -e "console.log(Math.max(1, Math.min(require('os').cpus().length - 1, 8)))"') do set WORKERS=%%W

rem Split evenly; a remainder of up to WORKERS-1 games is simply not run (never more than a
rem fraction of a percent of GAMES) -- not worth the extra script complexity to claw it back.
set /a PER=%GAMES%/%WORKERS%

echo Generating ladder data: %WORKERS% x %PER% games (%GAMES% requested) in %WORKERS% separate windows.
echo Leave them all open overnight. Close any one any time -- whatever it's written so far is
echo valid; just copy the .jsonl file(s) across once you do.
echo.

set /a LAST=%WORKERS%-1
for /l %%i in (0,1,%LAST%) do (
  start "Tau ladder worker %%i" cmd /k "node selfplay.js --games %PER% --out data\laptop-%STAMP%-w%%i.jsonl --model nowhere.json --levels 3,4,5,6,7 --deep 8,9,10,11 --deepEvery 6 --workers 1 & echo. & echo Worker %%i done -- close this window any time, or leave it. & pause"
)

echo All %WORKERS% worker windows launched -- this window can be closed.
pause
