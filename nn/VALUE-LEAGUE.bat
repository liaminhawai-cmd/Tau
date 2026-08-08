@echo off
setlocal
cd /d "%~dp0.."

rem Standalone file, so it can't call menu.bat's :dogit -- same pull logic inlined instead, same
rem reason every other loop in this project pulls before launching: this machine's local models/
rem code could be stale after a restart, and the league's own fix history (equal epoch budgets)
rem is exactly the kind of change worth actually having before another cycle trains anything.
set "GIT=git"
where git >nul 2>nul
if errorlevel 1 (
  set "GIT="
  for /f "delims=" %%d in ('dir /b /ad /o-n "%LOCALAPPDATA%\GitHubDesktop\app-*" 2^>nul') do (
    if not defined GIT if exist "%LOCALAPPDATA%\GitHubDesktop\%%d\resources\app\git\cmd\git.exe" set "GIT=%LOCALAPPDATA%\GitHubDesktop\%%d\resources\app\git\cmd\git.exe"
  )
)
if defined GIT (
  echo === pulling latest ===
  "%GIT%" pull
) else (
  echo git not found on PATH or under GitHub Desktop -- skipping pull.
)
echo.

rem Dual net training needs Python + PyTorch (torch-train-dual.py), same requirement as menu.bat's
rem option 41/39. Checked here rather than left to fail mid-league: without this, a machine with no
rem Python would die on the FIRST ensureModel('dual', ...) call, hours into an unattended overnight
rem run, instead of degrading gracefully to the value-net-only league it could already run fine.
set "DUALFLAG="
where python >nul 2>nul
if errorlevel 1 (
  echo Python not found on this machine -- running WITHOUT the dual value+policy net ^(--noDual^).
  echo Install Python + `pip install torch` and rerun to add it to the rated pool.
  echo.
  set "DUALFLAG=--noDual"
)

echo ================================================
echo   Tau adaptive value league
echo ================================================
echo.
echo 4 frozen value nets x depths 1,2,3 = 12 rated NN players
if not defined DUALFLAG echo plus the joint value+policy dual net, rated bare AND fused with its own
if not defined DUALFLAG echo policy head, x depths 1,2,3 = 12 more rated NN players (see nn\GLOSSARY.md).
echo plus L7-L11 as about 10%% of games.
echo.
echo Matchmaking follows the live Elo table, cross-depth games are allowed,
echo completed games are added to training data, and standings/90%% CI are
echo checkpointed continuously. Close or Ctrl-C whenever you want; rerun to resume.
echo.
choice /M "Start/resume league"
if errorlevel 2 exit /b 0

echo.
echo Both JS and Torch baselines now train at the SAME epoch budget (used to be 8 vs 40 --
echo an unfair fight, not a framework comparison). If your frozen JS models predate that
echo fix, retrain them fresh -- this also resets standings, since every game a JS player
echo was in got decided by an undertrained model.
choice /M "Retrain both baselines fresh and reset standings"
if errorlevel 2 (
  echo.
  node nn\value-league.js %DUALFLAG%
) else (
  echo.
  node nn\value-league.js --fresh %DUALFLAG%
)

echo.
pause