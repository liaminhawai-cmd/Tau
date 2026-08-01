@echo off
rem ============================================================================================
rem  RANK.bat -- put every brain we have on ONE scale: ladder rungs L1..L11 AND the neural nets
rem  at depths 1/2/3, all rated together, so retromine.js can interleave them by measured rank
rem  instead of guesswork.
rem
rem  Deliberately LOW sample size. These brains are spiky and non-transitive (the same net beat
rem  L8 and lost to L7 in one sweep), so chasing tight intervals on any single pairing is wasted
rem  compute. Bradley-Terry needs the comparison GRAPH connected, not every cell filled -- being
rem  half a rung off costs almost nothing downstream, being unranked costs the whole design.
rem
rem  Pairings are chosen ADAPTIVELY: after every result it refits the ratings and picks the
rem  matchup whose outcome is least predictable, among the brains measured least so far. A
rem  50/50 game is worth about a bit; a foregone one is worth nearly nothing, and a fixed pair
rem  list spent about a quarter of its budget on 2-0 blowouts against L1 and L4.
rem
rem  Safe to run alongside the trainer: fixed depths, no clocks, so sharing cores changes how
rem  long this takes but not a single move either side picks.
rem
rem  Interrupt-safe: every pair is written to nn\elo-results.json the moment it finishes. Re-run
rem  this file and it skips what is already stored. Close the window whenever you like.
rem ============================================================================================
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer - please call Liam.
  echo.
  pause
  exit /b 1
)

rem Games per pair. Low on purpose: the fit pools evidence across every path between two brains,
rem not just their direct games, so 2-3 per pair over a connected graph places everyone about as
rem well as 6 would.
set GAMES=2
rem Target wall-clock hours -- a hard stop, not a field trim. Pairings are now chosen adaptively
rem (closest-rated first, least-measured first), so whatever time you give it goes to the most
rem informative matchups available and it degrades gracefully: stopping early costs precision,
rem never coverage. Set to 0 to run until every brain has enough games.
set BUDGET=2
rem How many lineage checkpoints to sample, evenly spaced oldest-to-newest, on top of the named
rem architectures (best/wide/ultra/deep/l15_value/scratch, whichever exist).
set SPREAD=6
rem Concurrent arena processes. Each one is single-threaded, so this IS how many cores get used.
rem Blank means auto-detect (all cores but one). Set a low number only if you want the trainer,
rem which wants ~14 itself, to keep pace alongside this.
set WORKERS=

echo.
echo ================================================================
echo   Ranking every brain on one scale (ladder + nets x depths)
echo   Results stream to nn\elo-results.json as they land.
echo   Close this window any time - re-running resumes.
echo ================================================================
echo.
set /p GAMES="Games per pair, Enter for 2: "
set /p BUDGET="Target hours, Enter for 2 (0 = no limit): "
echo.
rem --saveData: these are real games with real outcomes, so they become training rows too rather
rem than being reduced to a win-loss tally and thrown away. Same schema selfplay.js writes.
set WORKERFLAG=
if not "%WORKERS%"=="" set WORKERFLAG=--workers %WORKERS%
node nn\elorank.js --games %GAMES% --spread %SPREAD% --budgetHours %BUDGET% %WORKERFLAG% --depths 1,2,3 --saveData nn\data\elo.jsonl

echo.
echo ================================================================
echo   Done. The --ensemble line above is what retromine.js wants.
echo   Re-print it any time without replaying:  node nn\elorank.js --refit
echo ================================================================
pause
