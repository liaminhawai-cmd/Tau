@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
title Tau trainer (second machine)

rem Everything below is node. Checked up front so a machine that does not have it gets one clear
rem sentence and a URL, not a screenful of "'node' is not recognized" from every later step --
rem which is exactly what the first fresh machine got.
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this machine ^(or not on PATH^).
  echo   Install the LTS from https://nodejs.org ^(defaults are fine^), then run this again.
  echo.
  pause
  exit /b 1
)

rem The full league-first trainer on a machine that has never run it -- a laptop, a fresh clone, or
rem the desktop rebuilt. Same trainer RESTART-TRAINER.bat launches; the difference is one step
rem before it, without which this machine would train from nothing.
rem
rem A clone gets only what git carries. nn\.gitignore excludes data\ and models\ wholesale and the
rem trainer force-adds a handful of named exceptions -- but every one of those is invisible to the
rem roster: the five aliases (best, wide, ultra, deep, l15_value) and the ten pool slots are all
rem excluded by name in evolution-roster's stableModelEntries, and the medal checkpoints sit in
rem nn\medals\, which it never scans. Measured on a clean clone: 20 distinct networks present,
rem population zero. seed-population.js copies each distinct one in under a name the roster sees.
rem
rem The rating store (nn\elo-results.json) is local and untracked, so this machine starts a FRESH
rem league over that seeded population rather than inheriting the desktop's ~400 faces. That is the
rem point: a small dense field measures far better than a big sparse one.

echo ================================================
echo   Tau: second-machine trainer (seed, then train)
echo ================================================
echo.
echo   Run this only when the desktop's trainer is NOT running. Both machines push to the
echo   same branch and each keeps its own local rating store, so two live trainers means
echo   two disagreeing leagues writing one nn\elo-summary.json.
echo.
pause

rem Same git probe RESTART-TRAINER.bat uses: this box may pull with GitHub Desktop, which bundles
rem its own git and can leave nothing on PATH.
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
if not defined GIT if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "GIT=%ProgramFiles(x86)%\Git\cmd\git.exe"

echo.
echo === pulling latest ===
if defined GIT (
  for /f "delims=" %%B in ('"%GIT%" rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%B"
  echo   branch: !BRANCH!
  "%GIT%" pull --no-edit --no-rebase
) else (
  echo   no git found -- skipping the pull. Pull in GitHub Desktop first, then run this again.
)


rem Name this machine once, on first run. Medals are published per machine
rem (nn\medals\<machine>\gold.json), so each trainer keeps its own top three instead of
rem overwriting the shared three filenames every other trainer also writes -- and seeding below
rem then imports EVERY machine's medals, so the best few from any training run anywhere end up in
rem this box's population. The id lives in nn\.machine-id, which is gitignored: it is the one file
rem that has to differ between clones.
if not exist "nn\.machine-id" (
  echo.
  echo   This machine has no name yet. It is used to file its medals separately from the
  echo   other trainers', so nothing overwrites anything.
  set "MNAME="
  set /p MNAME="Name this machine, Enter for %COMPUTERNAME%: "
  if "!MNAME!"=="" set "MNAME=%COMPUTERNAME%"
  node nn\machine-id.js --set "!MNAME!"
)
for /f "delims=" %%M in ('node nn\machine-id.js') do set "MACHINE=%%M"
echo.
echo   machine: !MACHINE!

echo.
echo === seeding the starting population (every machine's medals) ===
node nn\seed-population.js
if errorlevel 1 (
  echo.
  echo   Seeding failed -- not starting the trainer, because it would train from nothing.
  pause
  exit /b 1
)

rem Free disk, checked rather than assumed. Self-play appends to nn\data all day and git keeps
rem every pushed batch forever, so a run that starts with a nearly-full drive does not fail
rem cleanly -- it wedges, usually hours in and usually overnight.
for /f "delims=" %%D in ('node -e "try{const s=require(`fs`).statfsSync(process.cwd());console.log(Math.round(s.bavail*s.bsize/1e9));}catch(e){console.log(-1);}"') do set "FREEGB=%%D"
if not "!FREEGB!"=="-1" (
  echo.
  echo   free disk: !FREEGB! GB
  if !FREEGB! LSS 20 (
    echo.
    echo   WARNING: under 20 GB free. This run appends training data continuously and git
    echo   keeps every pushed batch. Clear space before leaving it unattended overnight.
    echo.
    pause
  )
)

rem Worker sizing, which is the whole difference between this and RESTART-TRAINER.bat on a thin
rem machine. league-trainer's own defaults are tuned for the desktop: leagueWorkers defaults to
rem cores-4, plus 2 exploration and 1 retromine, so a 12-thread laptop gets 11 permanently-busy
rem node processes -- 92%% of its threads, sustained, with nothing left for Windows. On a 15W
rem part that thermally throttles under all-core load, and with each process holding its own
rem engine in a shared 16 GB, that is a freeze rather than a slow run. Confirmed on this laptop.
rem Target ~60%% of threads instead: slower per hour, but it finishes the night.
set "CORES=%NUMBER_OF_PROCESSORS%"
if not defined CORES set "CORES=4"
set /a CORES=CORES
if !CORES! LSS 2 set /a CORES=2
set /a LEAGUEW=CORES/2-1
if !LEAGUEW! LSS 2 set /a LEAGUEW=2
set /a TOTALW=LEAGUEW+2

echo.
echo   !CORES! threads -^> !LEAGUEW! league + 1 exploration + 1 retromine = !TOTALW! processes
echo   (its own default here would be !CORES! processes' worth, which froze this box)
set "OVERRIDE="
set /p OVERRIDE="Enter to accept, or type a different league-worker count: "
if not "!OVERRIDE!"=="" set /a LEAGUEW=!OVERRIDE!

rem Dual training needs python + torch AND an NVIDIA GPU; without them the trainer runs value-only
rem on CPU, which is the normal case on a laptop.
set "DUALFLAG="
where python >nul 2>nul
if errorlevel 1 set "DUALFLAG=--noDual"
if not defined DUALFLAG (
  python -c "import torch" >nul 2>nul
  if errorlevel 1 set "DUALFLAG=--noDual"
)
if defined DUALFLAG (
  echo.
  echo   No python+torch here: running value-only on CPU. The league still rates, mutates and
  echo   culls, and scratch/mutant births still train. What CANNOT run without a verified
  echo   PyTorch path is resume-training from a structured-topology checkpoint -- best.json is
  echo   dense-memory-v1, so expect a recurring "resume-train failed" warning. It is soft:
  echo   nothing else stops. See train-value.js, which refuses that shape on the CPU fallback
  echo   rather than silently producing a wrong net.
)

echo.
echo === starting the league-first trainer ===
echo   main   : official temp-0 red/blue league -- rating AND training data
echo   side   : seeded/random exploration + retromine
echo   this machine keeps its OWN nn\elo-results.json; the desktop's ratings are not inherited
echo.
if defined DUALFLAG (
  node nn\league-trainer.js --gamesPerBatch 1000 --scratchHidden 96,64,48 ^
    --leagueWorkers !LEAGUEW! --exploreWorkers 1 --retroWorkers 1 %DUALFLAG%
) else (
  node nn\league-trainer.js --gamesPerBatch 1000 --scratchHidden 96,64,48 ^
    --leagueWorkers !LEAGUEW! --exploreWorkers 1 --retroWorkers 1 --dualEpochs 20,40,60 --dualPopulationMin 4
)
echo.
echo Trainer stopped. Close this window, or run this file again to restart.
pause
