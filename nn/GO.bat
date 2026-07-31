@echo off
rem ============================================================================================
rem  GO.bat -- THE ONE FILE. Close the trainer, pull in GitHub Desktop, double-click this.
rem  Everything below happens by itself, in order, and the window then trains until closed.
rem
rem  1. MIGRATE (runs in seconds once already migrated -- safe to leave in permanently)
rem     Latest bump: the net's inputs grew 88 -> 94. Zone score was only given as a per-side SUM
rem     of the 3 feet; now each foot's own zone value is also handed over individually, since two
rem     tripods can share a sum (foot-back-two-middle vs. all-three-outer can both total 9) while
rem     being different tactical situations the sum alone can't distinguish. (Earlier bump, still
rem     in effect: 82 -> 88 added zone/line-freedom/triangle-angle -- L11's own heaviest eval
rem     terms -- plus fixed the swing-angle inputs to normalise by the real 170-degree cap.)
rem     migrate88.js rebuilds every stored position's features from the raw poses (nothing is
rem     lost; originals are backed up in data\backup-preNN), archives the old incompatible models
rem     into models\archive-preNN, and trains a fresh 96,64,48 best.json on ALL accumulated data
rem     with the full current recipe -- the same 30-epoch budget the scratch challenger gets,
rem     which beat the whole accumulated lineage in both of the last two round robins.
rem
rem  2. MEASURE (~20 min, results appended to probe-results.txt -- open it in Notepad, the
rem     trainer's scroll can't bury a file)
rem       - feature importance: which inputs the fresh net actually leans on, including whether
rem         the new per-foot zone inputs pull real weight
rem       - throw probe: how often the net's top move hangs an immediate throw (this decides
rem         whether the quiescence result below means anything -- a 50/50 arena with zero hangs
rem         means "never fired", not "doesn't work")
rem       - quiescence A/B: same net, depth 1 + throw-screen vs plain depth 1, 40 games
rem
rem  3. TRAIN until the window is closed. Same loop as START.bat: self-play runs continuously in
rem     the background, chaining itself into a fresh batch as soon as one finishes; retraining
rem     (from scratch, every cycle -- see run.js's header for why) + round robin + pinned
rem     96,64,48 scratch challenger + ladder sweep all run on their own independent clock,
rem     seeded games, game-weighted loss -- all of it.
rem ============================================================================================
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer - please call Liam.
  echo.
  pause
  exit /b 1
)

echo.
echo ================================================================
echo  Step 1 of 3: migration check (first time ~10 min, else seconds)
echo ================================================================
echo.
node migrate88.js
if errorlevel 1 (
  echo.
  echo   Migration failed - nothing was trained. Scroll up for the error,
  echo   then ping Claude with a photo of it. Your old data and models are
  echo   safe in data\backup-pre82 and models\archive-pre82.
  echo.
  pause
  exit /b 1
)

echo. >> probe-results.txt
echo ============================================================ >> probe-results.txt
node -e "console.log('GO.bat run: ' + new Date().toISOString())" >> probe-results.txt
echo ============================================================ >> probe-results.txt

echo.
echo ================================================================
echo  Step 2 of 3: measurements (~20 min) -- see probe-results.txt
echo ================================================================
echo.
echo   [a] which inputs does the net lean on?
echo. >> probe-results.txt
echo --- feature importance ------------------------------------------ >> probe-results.txt
node feature-importance.js models\best.json >> probe-results.txt 2>&1

echo   [b] how often does the top move hang a throw? (~5 min)
echo. >> probe-results.txt
echo --- throw probe (does quiescence have anything to do?) ---------- >> probe-results.txt
node throwprobe.js --model models\best.json --games 20 --depth 1 --opponent self >> probe-results.txt 2>&1

echo   [c] quiescence head-to-head, 40 games (~15 min)
echo. >> probe-results.txt
echo --- quiescence A/B: depth 1.5 vs depth 1 ------------------------ >> probe-results.txt
node arena.js --a nn:0:models\best.json --b nn:0:models\best.json --depthA 1 --quiesceA --depthB 1 --games 40 >> probe-results.txt 2>&1

echo. >> probe-results.txt
echo (measurements complete; training started) >> probe-results.txt

echo.
echo ================================================================
echo  Step 3 of 3: training - runs until you close this window.
echo  Results of the measurements are in probe-results.txt
echo ================================================================
echo.
set GAMES=1000
set SHAPE=96,64,48
set SHAPEFLAG=
if not "%SHAPE%"=="" set SHAPEFLAG=--scratchHidden %SHAPE%
node run.js --gamesPerBatch %GAMES% %SHAPEFLAG%
pause
