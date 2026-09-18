@echo off
rem Double-click this file. Plays 432 sampled positions to the end with each mover brain
rem (L11, L8, best.json at depth 1 and depth 2) against a fixed opponent (L8), one worker
rem per CPU core. Safe to close the worker windows and rerun -- each worker skips games
rem already written to its own output file.
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found on PATH. Install it from https://nodejs.org and try again.
    pause
    exit /b 1
)
set OPP=L8
set MOVERS=L11,L8,best@D1,best@D2
set /a LAST=%NUMBER_OF_PROCESSORS%-1
for /L %%i in (0,1,%LAST%) do start "playoff worker %%i" /min cmd /c "node playoff.js positions-all.jsonl out-w%%i.jsonl %%i %NUMBER_OF_PROCESSORS% 2> out-w%%i.log"
echo Started %NUMBER_OF_PROCESSORS% worker(s) in the background (minimized windows).
echo When every "playoff worker" window has closed on its own, run analyze-results.bat.
pause
