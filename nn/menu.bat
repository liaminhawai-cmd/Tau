@echo off
setlocal enabledelayedexpansion
rem One-stop menu so nothing needs pasting into PowerShell/cmd again -- pick a number, hit Enter.
rem Lives in nn\, so the repo root is one level up.
cd /d "%~dp0.."

:menu
cls
echo ================================================
echo   Tau NN toolkit
echo ================================================
echo   Arena results are also written to nn\arena-logs\ as they go, so a closed
echo   window or a killed run never loses them.
echo.
echo   1. Pull latest from git
echo.
echo   2. Build policy net  (default shape 96,64)
echo   3. Build policy net  (pointy shape 80,44,32,18)
echo   4. Mint policy targets only (no training)
echo.
echo   5. Arena: policy vs plain, SAME DEPTH   (sanity check -- can tie/lose, never win)
echo   6. Arena: policy vs plain, SAME THINK-TIME  (the real test)
echo.
echo   7. Park weight A/B  (L11 park=8 vs park=0, 150 games, 4 workers)
echo   8. Quick CPU headroom check (1 game, 1s/move -- run before 6 if trainer's busy)
echo.
echo   9. Policy HEAD-TO-HEAD: pointy vs flat, ordering+cutoff  -- needs 2 and 3 done
echo.
echo  10. Check training data for duplicates (why did row count jump?)
echo.
echo  11. STRENGTH: best vs L11 at depth 3, 2, 1  -- is the net already a rung above L11?
echo  12. WIDTH A/B: keep 6 + policy cutoff vs plain keep 4  -- leave it running
echo  13. RANKS: current Elo chart of every rated brain (instant, no games played)
echo.
echo  15. POLICY LOOP: evolve the policy head forever -- multi-core, saves and pushes
echo      every game, hill-climbs the shape, never touches the value net
echo.
echo  16. POLICY CLAIM: policy-champ vs no policy, SAME NET SAME CLOCK, real sample size
echo      -- the question the loop's own control group cannot resolve at 6 games/cycle
echo.
echo  17. L12 CHECK: push everything local first, then best.json depth 2 vs L11, real sample size
echo      -- D1 is already resolved (loses), D3 is too slow to get a big n soon; D2 is cheap AND
echo      the one that keeps looking promising -- this fills that gap, not the ones already answered
echo.
echo  14. Exit
echo ================================================
set /p choice="Pick a number: "

if "%choice%"=="1" goto pull
if "%choice%"=="2" goto build96
if "%choice%"=="3" goto buildpointy
if "%choice%"=="4" goto targets
if "%choice%"=="5" goto arenadepth
if "%choice%"=="6" goto arenatimed
if "%choice%"=="7" goto park
if "%choice%"=="8" goto headroom
if "%choice%"=="9" goto policyduel
if "%choice%"=="10" goto datacheck
if "%choice%"=="11" goto vsl11
if "%choice%"=="12" goto widthab
if "%choice%"=="13" goto ranks
if "%choice%"=="15" goto policyloop
if "%choice%"=="16" goto policyclaim
if "%choice%"=="17" goto l12check
if "%choice%"=="14" goto :eof
goto menu

:vsl11
if not exist "nn\models\best.json" (
  echo nn\models\best.json not found.
  pause
  goto menu
)
rem Is the net already stronger than the top ladder rung -- effectively an L12 -- and at which
rem search depth? Everything measured so far says no at the cheap depths and unknown at 3:
rem D1 vs L11 went 3-9 and D2 went 1-7 over randomized openings, while D3 went 4-2, which is
rem 6 games and a 2-sigma band of plus or minus 41 points. That is the whole basis for the idea.
rem
rem DEPTH 3 RUNS FIRST, deliberately. It is the live hypothesis and by far the slowest cell, so
rem running it last would mean a part-finished session answers only the questions already
rem answered. D2 and D1 follow if there is time.
rem
rem Also worth rerunning after every promotion: the numbers above describe a champion the round
rem robin has since replaced twice over.
rem
rem --saveData is the point of doing this here rather than waiting for the sweep to crawl up to
rem L11: these are exactly the games self-play cannot make in quantity, and they now become
rem training rows instead of a win-loss tally. They land in nn\data\ so train.js picks them up on
rem its next pass; game ids are unique per run, so repeat sessions accumulate rather than collide.
rem
rem Not expected to finish. arena prints and logs the running score after every game, so read
rem wherever it got to -- 60 games is plus or minus 13, enough to tell a real edge from a coin
rem flip. Beating L11 needs more than 50 percent PLUS the band, so at 60 games that means 63.
set "GAMES=60"
set /p GAMES="Games per depth, Enter for 60: "
echo.
echo Safe to run with the trainer going: fixed depth, so sharing cores changes how long this
echo takes but not which moves either side picks, and neither side is on a clock.
echo Each depth logs separately to nn\arena-logs\ and appends training rows to nn\data\.
echo.
for %%D in (3 2 1) do (
  echo.
  echo === best.json at depth %%D vs L11, %GAMES% games ===
  node nn\arena.js --a nn:0:%CD%\nn\models\best.json --b L11 --depth %%D --games %GAMES% --saveData %CD%\nn\data\vs-l11.jsonl
)
pause
goto menu
:policyloop
rem Runs until you close the window. Safe to stop any time: pushed games are shared and the
rem champion policy on disk survives for the next run. Time budget per cycle, in hours.
set "PLHOURS="
set /p PLHOURS=Hours per cycle [1]: 
if "%PLHOURS%"=="" set PLHOURS=1
node nn\policyloop.js --budgetHours %PLHOURS%
pause
goto menu

:policyclaim
if not exist "nn\models\policy-champ.json" (
  echo nn\models\policy-champ.json not found -- run option 15 first, or wait for a cycle to finish.
  pause
  goto menu
)
if not exist "nn\models\best.json" (
  echo nn\models\best.json not found.
  pause
  goto menu
)
rem The loop's own shape fight runs champ-vs-mutant on 6 games, nowhere near enough to move the
rem shape reliably -- but the same 6 games is ALSO champ-vs-nopolicy, its control group, the one
rem that answers "does the policy help at all". Observed live: 9 cycles in, that control's POOLED
rem total sat at 51%% +/- 9 on 114 games -- indistinguishable from the policy doing nothing -- and
rem resolving a real 55%% edge at 6 games/cycle would take roughly 250 more cycles. This is the
rem same comparison run properly: same net, same clock, only the policy differs, at a sample size
rem that can actually tell 50 from 55.
set "GAMES=300"
set /p GAMES="Games to play, Enter for 300: "
echo.
echo This is a TIMED test, so unlike options 11 and 12 it is NOT indifferent to a busy machine:
echo both sides get the same 2000ms, but a contended box means fewer nodes inside it, and the
echo policy's whole payoff is depth-per-second. The A/B stays internally fair -- both sides are
echo starved equally -- but the number describes the policy at whatever node count this machine
echo had spare. Run option 8 first if the trainer is going, same as for option 6.
echo Writes nothing to the pool, best.json, or the champion policy; progress lands in nn\arena-logs\.
echo.
echo === policy-champ vs no policy, same net (best.json), 2000ms/move, %GAMES% games ===
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --policyA %CD%\nn\models\policy-champ.json --b nn:0:%CD%\nn\models\best.json --timeMs 2000 --games %GAMES% --saveData %CD%\nn\data\policy-claim-%COMPUTERNAME%.jsonl
pause
goto menu

:l12check
if not exist "nn\models\best.json" (
  echo nn\models\best.json not found.
  pause
  goto menu
)
rem Push whatever's sitting local-only BEFORE running anything new, so results from earlier
rem sessions (option 11, 16, any manual arena.js run) actually reach the remote instead of only
rem ever existing as a pasted log.
call :pushlocal
rem Then run the one cell that's still actually in question. D1 is resolved -- best.json has lost
rem every D1 slice run this week (37.5% pooled, clearly on the losing side). D3 costs roughly 20x
rem a depth-1 game (~316s/game measured earlier), so a decisive sample there eats the better part
rem of a day solo. D2 costs roughly 5.6x and is the one that's looked promising on every slice run
rem so far (68.8% on 16 games) -- cheap enough to actually push past the noise floor. This is the
rem "one clean run, one depth, real n" test, not a repeat of what option 11 already answered.
rem Run this on both machines -- 80 here + 80 there clears the ~150-game mark where the confidence
rem interval finally narrows below what a single ladder rung is worth.
set "GAMES=80"
set /p GAMES="Games at depth 2 vs L11, Enter for 80 (roughly 90 min - 2 hrs): "
echo.
echo Safe to run with the trainer going: fixed depth, no clock, same reasoning as option 11.
echo Results land in nn\arena-logs\ and nn\data\vs-l11-d2-%COMPUTERNAME%.jsonl -- both get pushed
echo below the instant this finishes, so closing the window right after is fine.
echo.
echo === best.json depth 2 vs L11, %GAMES% games ===
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --b L11 --depth 2 --games %GAMES% --saveData %CD%\nn\data\vs-l11-d2-%COMPUTERNAME%.jsonl
call :pushlocal
pause
goto menu

:ranks
rem A pure REFIT of the stored results (nn\elo-results.json): fits every game ever recorded and
rem prints the table -- Elo, ladder rank, 90 percent CI, games per brain. Plays NOTHING and writes
rem nothing back, so it is safe to run while the trainer or RANK.bat is mid-run; it simply shows
rem whatever the pool knows as of this second. The same numbers live machine-readably in
rem nn\elo-summary.json if a script wants them instead of eyes.
if exist "nn\elo-results.json" (
  node nn\elorank.js --refit
) else if exist "nn\elo-summary.json" (
  rem The raw per-pair store never gets pushed to git -- only the summary does, riding along
  rem on every status push -- so a machine that has pulled but never run elorank locally, a
  rem worker, or this store having gone missing some other way, still has the published
  rem snapshot to fall back to.
  echo No local elo-results.json -- showing the last published snapshot instead.
  node nn\showranks.js
) else (
  echo No rating pool yet -- run RANK.bat, or let the trainer's pool cycle fire, or pull to
  echo get whatever the trainer has already published.
)
pause
goto menu

:widthab
if not exist "nn\models\policy.json" (
  echo nn\models\policy.json not found -- run option 2 first.
  pause
  goto menu
)
if not exist "nn\models\best.json" (
  echo nn\models\best.json not found.
  pause
  goto menu
)
rem Same value net at the same depth on BOTH sides. The only difference is what the policy buys:
rem A gives 6 candidates a real opponent search instead of 4 and pays for it with the arm-ordering
rem cutoff, B searches the default 4 with no policy at all. Roughly compute-neutral -- the cutoff
rem saves about 15 percent and the extra width costs about 9.
rem This is the version of the policy question that can actually be WON. Hard pruning could only
rem tie or lose at equal depth by construction, and at equal think time it went 9-10, which is
rem structural: a fractional saving never buys a whole extra ply, since plies cost 4-6x each.
rem Width is the one thing a fractional saving converts into directly.
rem 24 games cannot answer this -- the effect is small, so the band has to be small too. 400 games
rem is plus or minus 7. Same as option 11: read the running score wherever it gets to.
set "GAMES=400"
set /p GAMES="Games to play, Enter for 400: "
echo.
echo Safe to run with the trainer going, same reason as option 11 -- fixed depth, no clock.
echo.
echo === keep 6 + policy ordering/cutoff vs plain keep 4, same net, depth 2, %GAMES% games ===
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --b nn:0:%CD%\nn\models\best.json --depth 2 --games %GAMES% --keepA 6 --abA --policyA %CD%\nn\models\policy.json --keepB 4
pause
goto menu

:datacheck
if not exist "nn\datacheck.js" (
  echo nn\datacheck.js not found -- pull first - option 1.
  pause
  goto menu
)
rem Reports per-file row counts and any rows that appear twice across files. A duplicated corpus
rem is trained on twice, which silently double-weights those games -- suspect this whenever the
rem row count jumps far more than the games count did.
echo === what train.js is actually reading ===
node nn\datacheck.js
pause
goto menu

:pull
call :dogit
pause
goto menu

:build96
call :dogit
echo.
echo === minting policy targets ===
node nn\policy-targets.js
echo.
echo === training policy net, hidden 96,64 ===
node nn\train-policy.js --epochs 20 --out nn\models\policy.json
pause
goto menu

:buildpointy
call :dogit
echo.
echo === minting policy targets ===
node nn\policy-targets.js
echo.
echo === training policy net, hidden 80,44,32,18 ===
node nn\train-policy.js --epochs 20 --hidden 80,44,32,18 --out nn\models\policy-pointy.json
pause
goto menu

:targets
node nn\policy-targets.js
pause
goto menu

:arenadepth
if not exist "nn\models\policy.json" (
  echo nn\models\policy.json not found -- run option 2 first.
  pause
  goto menu
)
if not exist "nn\models\best.json" (
  echo nn\models\best.json not found.
  pause
  goto menu
)
echo === policy-pruned D3 vs plain D3, same net, 24 games ===
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --b nn:0:%CD%\nn\models\best.json --depth 3 --games 24 --policyA %CD%\nn\models\policy.json --quiesceA --quiesceB
pause
goto menu

:arenatimed
if not exist "nn\models\policy.json" (
  echo nn\models\policy.json not found -- run option 2 first.
  pause
  goto menu
)
if not exist "nn\models\best.json" (
  echo nn\models\best.json not found.
  pause
  goto menu
)
echo === policy-pruned vs plain, 2000ms per move each, same net, 24 games ===
rem --saveData: these are real games at a serious think-time, so they are worth keeping
rem rather than reduced to a score and thrown away -- same reasoning run.js's ladder sweep
rem uses for its own arena games. COMPUTERNAME keeps two machines from colliding on the name.
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --b nn:0:%CD%\nn\models\best.json --games 24 --timeMs 2000 --policyA %CD%\nn\models\policy.json --saveData %CD%\nn\data\policy-arena-%COMPUTERNAME%.jsonl
pause
goto menu

:policyduel
if not exist "nn\models\policy.json" (
  echo nn\models\policy.json not found -- run option 2 first.
  pause
  goto menu
)
if not exist "nn\models\policy-pointy.json" (
  echo nn\models\policy-pointy.json not found -- run option 3 first.
  pause
  goto menu
)
if not exist "nn\models\best.json" (
  echo nn\models\best.json not found.
  pause
  goto menu
)
rem Fairer than policy-vs-plain: same value net, same depth, same budget on BOTH sides, so the
rem only variable is which policy is choosing. This one can genuinely be won or lost either way,
rem unlike the plain-search sanity checks which can only tie or lose by construction.
rem
rem --abA --abB is the point of the rerun. The policies used to be spent on hard PRUNING, where
rem what matters is top-3 containment -- is the right arm anywhere in the kept set. They are now
rem spent on ORDERING plus a cutoff, where what matters is top-1 -- is the right arm ranked FIRST,
rem so the refutation lands before the remaining arm sweeps are paid for. A net can win one and
rem lose the other: pointy has more layers to sharpen a ranking with, flat has more width to keep
rem candidates in a set. Drop both flags to measure the old pruning framing instead.
rem
rem The previous attempt reached 5-2 at game 8 and never finished. 7 decided games is plus or
rem minus 38 points -- a range from 33 to 100 -- so it was never a result. Hence the raised
rem default: read the running score wherever it gets to.
set "GAMES=200"
set /p GAMES="Games to play, Enter for 200: "
echo.
echo Progress is written to nn\arena-logs\ after every game, so closing this window, killing the
echo run, or hitting a key at the pause prompt cannot lose the score.
echo.
echo === pointy 80,44,32,18 vs flat 96,64 policy, ordering+cutoff, same net, depth 3, %GAMES% games ===
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --b nn:0:%CD%\nn\models\best.json --depth 3 --games %GAMES% --policyA %CD%\nn\models\policy-pointy.json --policyB %CD%\nn\models\policy.json --abA --abB --quiesceA --quiesceB
pause
goto menu
:park
if not exist "nn\parktest.js" (
  echo nn\parktest.js not found -- pull first - option 1.
  pause
  goto menu
)
echo === L11 park=8 vs park=0, 150 games, 4 workers ===
node nn\parktest.js --level 11 --parkA 8 --parkB 0 --games 150 --workers 4
pause
goto menu

:headroom
if not exist "nn\models\best.json" (
  echo nn\models\best.json not found.
  pause
  goto menu
)
echo === 1 game, 1000ms/move -- if this crawls, your cores are already busy ===
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --b nn:0:%CD%\nn\models\best.json --games 1 --timeMs 1000
pause
goto menu

:dogit
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
exit /b 0

:pushlocal
rem Everything under nn\arena-logs\, nn\archtest-result.txt, and nn\data\vs-l11*.jsonl /
rem policy-claim-*.jsonl is real result data that arena.js and laddertest.js write, but none of
rem it is on any owning script's auto-push path the way best.json or elo-summary.json are -- it
rem sits gitignored (data/, arena-logs/, archtest-result.txt are all in .gitignore) until someone
rem force-adds it. Without this, a whole test run only ever exists as whatever got pasted into
rem chat, which is exactly the file-access gap this option exists to close.
call :dogit
if exist "nn\arena-logs" "%GIT%" add -f nn\arena-logs >nul 2>nul
if exist "nn\archtest-result.txt" "%GIT%" add -f nn\archtest-result.txt >nul 2>nul
for %%F in (nn\data\vs-l11*.jsonl) do "%GIT%" add -f "%%F" >nul 2>nul
for %%F in (nn\data\policy-claim-*.jsonl) do "%GIT%" add -f "%%F" >nul 2>nul
"%GIT%" diff --cached --quiet
if errorlevel 1 (
  echo === pushing local-only results ^(arena-logs, archtest-result.txt, vs-l11/policy-claim data^) ===
  "%GIT%" commit -m "sync local test results from %COMPUTERNAME%" >nul
  "%GIT%" push
) else (
  echo (nothing local-only to push right now)
)
exit /b 0
