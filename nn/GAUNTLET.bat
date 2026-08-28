@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
title Tau gauntlet -- is this candidate really stronger than the ladder?

rem Answers one question the live league structurally cannot: is a specific model actually stronger
rem than L10/L11, by enough to ship as a ladder rung? The league is a sparse round robin over ~400
rem faces where the median face has 8 games and the median 90%% interval is ~400 Elo wide, so its
rem headline numbers are point estimates nothing supports -- a gold medal needs only 5 games at D3.
rem This plays ONE frozen candidate a fixed, colour-balanced, temp-0 match set against fixed
rem opponents and reads the interval, which is the only thing that can carry a ship decision.
rem
rem Runs entirely outside the live league: nothing here enters the Elo pool, mints a face, or
rem touches best.json. Safe to run on a second machine while the desktop trains -- or, as now, on
rem its own while the desktop is away.

echo ================================================
echo   Tau gauntlet -- fixed match set, honest interval
echo ================================================
echo.

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

if defined GIT (
  for /f "delims=" %%B in ('"%GIT%" rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%B"
  echo   branch: !BRANCH!
  echo   === pulling latest ===
  "%GIT%" pull --no-edit --no-rebase
) else (
  echo   no git found -- skipping the pull. Pull in GitHub Desktop first if this clone is stale.
)

rem The medal aliases are committed by publish-medals.js, so a fresh pull is all this machine needs:
rem no local checkpoint is required to test any machine's gold, silver or bronze. Medals are filed
rem per machine (nn\medals\<machine>\), so a pull brings in every trainer's findings, not just
rem whichever one pushed last -- and any of them can be the candidate here.
echo.
echo   === medal sets on this branch ===
dir /b /ad "nn\medals" 2>nul
for /f "delims=" %%M in ('node nn\machine-id.js --medaldir') do set "MYMEDALS=%%M"
set "DEFCAND=!MYMEDALS!\gold.json"
if not exist "!DEFCAND!" set "DEFCAND=nn\medals\gold.json"
if exist "!MYMEDALS!\medals.json" (
  echo.
  echo   === what THIS machine's medals point at ===
  type "!MYMEDALS!\medals.json"
)

echo.
echo   Any machine's medal works: nn\medals\^<machine^>\gold.json
set "CAND="
set /p CAND="Candidate model, Enter for !DEFCAND!: "
if "!CAND!"=="" set "CAND=!DEFCAND!"
if not exist "!CAND!" (
  echo.
  echo   Not found: !CAND!
  echo   Give a path relative to the repo root, e.g. nn\medals\silver.json or nn\models\best.json
  pause
  exit /b 1
)

set "DEPTH="
set /p DEPTH="Search depth for the candidate, Enter for 3: "
if "!DEPTH!"=="" set "DEPTH=3"

set "OPPS="
set /p OPPS="Opponents, Enter for L11,L10,best: "
if "!OPPS!"=="" set "OPPS=L11,L10,best"

rem 60 first, not 200. If the candidate is genuinely a rung clear (75%%+) the lower bound already
rem clears +100 Elo at 60 games, so a short run SHIPS it outright. If it is merely good (65%%) no
rem realistic number of games ever proves a full rung -- ~11k -- so a long run would only spend a
rem laptop-week confirming a MARGINAL it could have called in an hour. The run prints what it would
rem actually take at the score it saw, which is the honest way to decide whether to go again longer.
set "GAMES="
set /p GAMES="Games per opponent, Enter for 60 (a short run can still ship it -- see below): "
if "!GAMES!"=="" set "GAMES=60"

rem One arena pairing is a single-threaded process, so without --shards a 3-opponent run would use
rem exactly 3 cores and take as long as its slowest matchup. Sharding at the core count keeps every
rem lane fed even for a one-opponent run; the shards are summed back into one match at the end.
set /a CORES=%NUMBER_OF_PROCESSORS%
if "!CORES!"=="" set /a CORES=4
set /a WORKERS=CORES-1
if !WORKERS! LSS 1 set /a WORKERS=1
set /a SHARDS=WORKERS

for /f "delims=" %%S in ('node -e "console.log(new Date().toISOString().replace(/[-:T]/g,'').slice(0,14))"') do set "STAMP=%%S"
set "RUNDIR=nn\gauntlet-runs\!STAMP!"
for %%F in ("!CAND!") do set "CNAME=%%~nF"
mkdir "!RUNDIR!" 2>nul

rem Freeze the candidate before playing it. nn\medals\gold.json is an ALIAS: publish-medals.js
rem overwrites and re-pushes it every cycle, so a long run started against "gold" could otherwise
rem finish against a different model than it began with, and the result would mean nothing. Copied
rem OUTSIDE nn\models on purpose -- the roster scans that directory and would adopt a copy as a
rem live face, which is exactly the pollution gauntlet.js exists to avoid.
copy /y "!CAND!" "!RUNDIR!\!CNAME!.json" >nul
if errorlevel 1 ( echo   could not freeze the candidate & pause & exit /b 1 )

echo.
echo   candidate : !CAND!
echo   frozen to : !RUNDIR!\!CNAME!.json
echo   depth     : D!DEPTH!    opponents: !OPPS!    games each: !GAMES!
echo   machine   : !CORES! cores -^> !WORKERS! parallel, !SHARDS! shards per pairing
echo.
echo   Ladder opponents play their own native game; an nn opponent plays at the same depth.
echo   Leave this running -- it prints each shard's score as it lands. Nothing is written to the
echo   live pool, so closing the window only costs the run.
echo.

node nn\gauntlet.js --models "!RUNDIR!\!CNAME!.json" --opponents !OPPS! --games !GAMES! ^
  --depths !DEPTH! --shards !SHARDS! --workers !WORKERS! --out "!RUNDIR!\gauntlet.json"

echo.
echo   Saved to !RUNDIR!\gauntlet.json
echo.
echo   Reading the call:
echo     CLEAR     - the 2-sigma LOWER bound clears +100 Elo. A real new rung; ship it.
echo     MARGINAL  - provably stronger, but not provably a whole rung. A sideways rung is
echo                 worse than no rung: a ladder has to keep getting harder.
echo     UNDECIDED - the interval still straddles even. The printed games figure is what it
echo                 would take to settle at this score.
echo     WEAKER    - provably worse than that opponent.
echo.
echo   Why 60 games is a real answer and not a shortcut -- lower bound by true score:
echo       true 85%% -^> +170     true 70%% -^> +47      true 60%% -^> -22
echo       true 75%% -^> +84      true 65%% -^> +12      true 55%% -^> -56
echo   A candidate that deserves to be a rung clears the bar on a short run. One that needs
echo   thousands of games to prove +100 is, by that fact, not +100.
echo.
pause
