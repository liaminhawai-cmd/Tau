@echo off
setlocal EnableExtensions
rem Tau NN launcher.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer - please call Liam.
  echo.
  pause
  exit /b 1
)

git pull >nul 2>nul

:MENU
cls
echo.
echo   ==========================================
echo              TAU NN TRAINING
echo   ==========================================
echo.
echo   1. Full training loop
echo   2. Retromine ratchet-only loop ^(multicore^)
echo   3. Exit
echo.
choice /c 123 /n /m "Choose 1-3: "
if errorlevel 3 goto END
if errorlevel 2 goto RETROMINE
if errorlevel 1 goto TRAIN

:TRAIN
cls
rem Games per self-play BATCH. A bigger batch pays the straggler tail less often.
set GAMES=1000
rem Architecture for the from-scratch challenger. Blank SHAPE to follow best.json.
set SHAPE=96,64,48
set SHAPEFLAG=
if not "%SHAPE%"=="" set SHAPEFLAG=--scratchHidden %SHAPE%
rem Fraction of self-play games started from a fully random legal pose.
set RANDSTART=0.15
echo.
echo Full Tau NN training started.
echo Leave this window open. Close it any time to stop - progress is saved.
echo.
node run.js --gamesPerBatch %GAMES% --randomStartFrac %RANDSTART% %SHAPEFLAG%
echo.
pause
goto MENU

:RETROMINE
cls
rem Retromine is CPU-bound. Use all logical cores except one, capped at the same 14 lanes
rem used by the full trainer so Windows and disk I/O still have breathing room.
set /a RETROWORKERS=%NUMBER_OF_PROCESSORS%-1
if %RETROWORKERS% LSS 1 set RETROWORKERS=1
if %RETROWORKERS% GTR 14 set RETROWORKERS=14
rem One seed per lane is intentional: a complete ratchet walk is more valuable than many
rem truncated seeds. Each lane immediately begins another seed when it finishes.
set RETROSEEDS=1
set RETROREPLAYS=400
echo.
echo Retromine ratchet-only loop started with %RETROWORKERS% workers.
echo Every completed probe game is appended immediately.
echo Close this window or press Ctrl-C to stop.
echo.
node retroloop.js --workers %RETROWORKERS% --seedsPerJob %RETROSEEDS% --maxReplaysPerSeed %RETROREPLAYS%
echo.
pause
goto MENU

:END
endlocal
exit /b 0
