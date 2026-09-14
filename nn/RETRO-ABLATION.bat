@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
title Tau -- does Retromine data make models better?

rem The test this project has argued about but never run. Retromine's rows have only ever been
rem MITIGATED -- game-level val-split leakage through replay families, and --familyWeight sqrt
rem because "large failed-rescue families dominate the corpus". Both assume the data helps and try
rem to stop it hurting. Nobody measured whether it helps.
rem
rem What this does: builds four training corpora of IDENTICAL size at retro shares 0 / 30 / 60 / 90
rem percent, trains one net per share FROM SCRATCH with the same shape, epochs and seed, then plays
rem all four against each other in a round robin plus a fixed anchor set (best.json, L10, L11).
rem
rem Runs entirely outside the live league: arms land in nn\experiments\, nothing enters the Elo
rem pool, mints a face, or touches best.json or nn\data.

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this machine ^(or not on PATH^).
  echo   Install the LTS from https://nodejs.org ^(defaults are fine^), then run this again.
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo   Retromine data ablation -- equal volume, 0/30/60/90%% retro
echo ============================================================
echo.

rem The equal-volume cap is set by the scarce class: there are ~220k retro rows, so a 90%% arm is
rem ~244k rows and every arm is built to that. Printed up front because it decides whether the run
rem is worth starting -- if the retro corpus has grown a lot since, the arms get bigger and slower.
echo   === corpus on this machine ===
echo   ^(reading nn\data -- this takes a minute^)
node nn\data-slice.js --class retro --share 0.9 --census
echo.

rem Does this box actually run CUDA? train-value.js REFUSES a CPU fallback for a dense-memory
rem birth -- a plain net wearing the experiment's filename would fake the comparison -- so the
rem best.json-shaped arm simply cannot be built without a working GPU. Better to find that out
rem here than after an hour of slicing.
set "HASCUDA="
python -c "import torch; assert torch.cuda.is_available(); x = torch.zeros(1, device='cuda') + 1" >nul 2>nul && set "HASCUDA=1"

echo   Architecture for the four arms:
echo     1. best.json's shape ^(400x10 dense-memory^) -- the definitive answer, hours per arm, needs CUDA
echo     2. compact 96,96 -- same question, minutes per arm, may be too small to use retro at all
if defined HASCUDA (echo   CUDA: available on this machine.) else (echo   CUDA: NOT available -- option 1 will fail here, use option 2.)
set "ARCH="
set /p ARCH="Choose 1 or 2, Enter for 2: "
if "!ARCH!"=="" set "ARCH=2"
set "ARCHARGS="
if "!ARCH!"=="2" set "ARCHARGS=--hidden 96,96"
if "!ARCH!"=="1" if not defined HASCUDA (
  echo.
  echo   This machine cannot run the CUDA path, and the dense-memory arm is refused rather than
  echo   silently downgraded. Re-run and choose 2, or run this on the desktop.
  echo.
  pause
  exit /b 1
)

set "SHARES="
set /p SHARES="Retro shares, Enter for 0,0.3,0.6,0.9: "
if "!SHARES!"=="" set "SHARES=0,0.3,0.6,0.9"

set "EPOCHS="
set /p EPOCHS="Epochs per arm, Enter for 8: "
if "!EPOCHS!"=="" set "EPOCHS=8"

set "GAMES="
set /p GAMES="Games per pairing, Enter for 40: "
if "!GAMES!"=="" set "GAMES=40"

set "DEPTH="
set /p DEPTH="Search depth for the played games, Enter for 1: "
if "!DEPTH!"=="" set "DEPTH=1"

rem One arena pairing is single-threaded, so without shards a round robin would use one core per
rem pairing and take as long as its slowest matchup. Shard at the core count and the whole machine
rem stays fed; gauntlet.js sums the shards back into one match at the end.
set /a CORES=%NUMBER_OF_PROCESSORS%
if "!CORES!"=="" set /a CORES=4
set /a WORKERS=CORES-1
if !WORKERS! LSS 1 set /a WORKERS=1

for /f "delims=" %%S in ('node -e "console.log(new Date().toISOString().replace(/[-:T]/g,'').slice(0,12))"') do set "STAMP=%%S"
set "NAME=retro-!STAMP!"

echo.
echo   shares    : !SHARES!
echo   arch      : !ARCHARGS! ^(blank = best.json's own shape^)
echo   epochs    : !EPOCHS!    games per pairing: !GAMES!    depth: D!DEPTH!
echo   machine   : !CORES! cores -^> !WORKERS! parallel, !WORKERS! shards per pairing
echo   output    : nn\experiments\!NAME!\summary.md
echo.
echo   This is a long run: four trainings, then six head-to-head pairings and four anchor
echo   pairings. For a clean read, stop the full trainer first -- otherwise wall-clock (not
echo   results) will stretch. Nothing is written to the live pool, so closing the window only
echo   costs the run; re-running with --skipTrain reuses any arms that finished.
echo.
pause

node nn\experiment-retro.js --name "!NAME!" --shares !SHARES! --epochs !EPOCHS! --games !GAMES! ^
  --depths !DEPTH! --workers !WORKERS! --shards !WORKERS! !ARCHARGS! %*

echo.
echo   Summary: nn\experiments\!NAME!\summary.md
echo.
echo   Reading the call:
echo     The round robin's POINTS column is the headline -- highest points is the best retro share.
echo     A head-to-head Elo interval that straddles 0 proves nothing, however lopsided the points
echo     look; with 40 games a real difference has to be large to show. If every interval straddles
echo     0, the honest answer is "retro share does not matter much at this corpus size", and the
echo     next move is more games, not a bigger claim.
echo.
pause
