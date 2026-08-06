@echo off
setlocal enabledelayedexpansion
rem One-stop menu so nothing needs pasting into PowerShell/cmd again -- pick a number, hit Enter.
rem Lives in nn\, so the repo root is one level up.
rem
rem THE SINGLE ENTRY POINT. Used to be split across this file plus START.bat's own separate
rem 3-item menu, plus START-laptop.bat/START-policyloop.bat/START-policyfight.bat as one-file-per-
rem loop launchers, each repeating its own node-check/git-pull boilerplate -- five files with
rem overlapping menus and no single place a new option belonged. Options 20-23 below are exactly
rem those four launchers' logic, folded in here; START.bat and friends are now three-line wrappers
rem that just call this file with a number pre-filled, so double-click shortcuts still work
rem unchanged, but there is exactly one copy of every loop's actual logic.
rem
rem Optional first argument pre-fills "Pick a number" for a zero-navigation double-click launch
rem (e.g. `menu.bat 21` starts retromine immediately) -- consumed once, so if a loop ever exits
rem and falls back to this menu, it prompts normally from then on rather than re-launching itself.
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer - grab it from nodejs.org, or call Liam.
  echo.
  pause
  exit /b 1
)

:menu
cls
echo ================================================
echo   Tau NN toolkit
echo ================================================
echo   Arena results are also written to nn\arena-logs\ as they go, so a closed
echo   window or a killed run never loses them.
echo.
echo   LOOPS -- run until the window is closed, unless noted otherwise
echo  20. FULL TRAINER: self-play + retrain + round robin + ladder sweep, forever
echo  21. RETROMINE: ratchet-only data generation, multicore
echo  22. SELF-PLAY FACTORY: plain game generation for a spare machine (never trains/rates)
echo  23. POLICY FIGHT: train a policy net on existing data, fight it at equal think-time
echo      (bounded, a couple hours -- not the loop; see 15 for the evolving version)
echo  24. VALUE TRAINER, single pass: one train.js run on whatever data exists now, then stops
echo      (minutes, not the loop -- for catching up a value net without competing hard for cores
echo      with something else already running, e.g. the policy loop on this same machine)
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
echo  18. DIGEST: crunch every local-only file into one summary and push it
echo      -- elo-results.json's raw pairs, training-data composition, a fresh arena-log mine.
echo      Read-only: plays nothing, trains nothing. Safe to run any time.
echo.
echo  19. PROMOTE mutant: make policy-mutant.json the new policy-champ.json (backs up the old one)
echo      -- run this right after a manual policy-mutant vs policy-champ arena test you liked.
echo      The loop overwrites policy-mutant.json every cycle, so an untested win won't survive long.
echo.
echo   DIAGNOSTICS ^& MAINTENANCE
echo  25. RANK, playing games: update the rating pool for real (13 only refits what exists)
echo  26. ARCHTEST: architecture sweep vs best.json
echo  27. FULLTEST: full shape sweep + ladder test (long)
echo  28. GIT CHECK: can this machine actually pull and push?
echo  29. DASHBOARD: open dashboard.html
echo  30. MIGRATE + MEASURE: feature migration check, then the probe suite
echo.
echo  14. Exit
echo ================================================
rem NOT a chained "if A if B (...) else (...)" -- that construct's else binds to the INNER if, so
rem when %~1 is empty (a plain double-click, no argument -- how this actually gets launched most of
rem the time) the whole thing does nothing at all: choice never gets set, set /p never prompts, and
rem execution falls straight to the bottom `goto menu`, redrawing the same screen forever with no
rem way to type anything. Confirmed live. Uses plain goto below, not nested if/else -- no subtlety to get wrong.
if defined MENU_ARG_USED goto askchoice
if "%~1"=="" goto askchoice
set "choice=%~1"
set "MENU_ARG_USED=1"
echo Pick a number: %choice%  ^(from command line^)
goto gotchoice
:askchoice
set /p choice="Pick a number: "
:gotchoice

if "%choice%"=="20" goto fulltrainer
if "%choice%"=="21" goto retromine
if "%choice%"=="22" goto selfplayfactory
if "%choice%"=="23" goto policyfight
if "%choice%"=="24" goto valuetrain
if "%choice%"=="25" goto rankplay
if "%choice%"=="26" goto archtest
if "%choice%"=="27" goto fulltest
if "%choice%"=="28" goto gitcheck
if "%choice%"=="29" goto dashboard
if "%choice%"=="30" goto migratemeasure
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
if "%choice%"=="18" goto digest
if "%choice%"=="19" goto promotemutant
if "%choice%"=="14" goto :eof
goto menu

:fulltrainer
rem Was START.bat option 1. Games per self-play BATCH -- a bigger batch pays the straggler tail
rem less often. SHAPE is the architecture for the from-scratch challenger; blank it to follow
rem best.json instead. RANDSTART is the fraction of self-play games started from a fully random
rem legal pose.
call :dogit
set GAMES=1000
set SHAPE=96,64,48
set SHAPEFLAG=
if not "%SHAPE%"=="" set SHAPEFLAG=--scratchHidden %SHAPE%
set RANDSTART=0.15
echo.
echo Full Tau NN training started.
echo Leave this window open. Close it any time to stop - progress is saved.
echo.
node nn\run.js --gamesPerBatch %GAMES% --randomStartFrac %RANDSTART% %SHAPEFLAG%
pause
goto menu

:retromine
rem Was START.bat option 2. CPU-bound: use all logical cores except one, capped at 14 lanes so
rem Windows and disk I/O still have breathing room. One seed per lane is intentional -- a complete
rem ratchet walk is more valuable than many truncated seeds; each lane starts another seed the
rem moment it finishes one.
call :dogit
set /a RETROWORKERS=%NUMBER_OF_PROCESSORS%-1
if %RETROWORKERS% LSS 1 set RETROWORKERS=1
if %RETROWORKERS% GTR 14 set RETROWORKERS=14
set RETROSEEDS=1
set RETROREPLAYS=400
echo.
echo Retromine ratchet-only loop started with %RETROWORKERS% workers.
echo Every completed probe game is appended immediately.
echo Close this window or press Ctrl-C to stop.
echo.
node nn\retroloop.js --workers %RETROWORKERS% --seedsPerJob %RETROSEEDS% --maxReplaysPerSeed %RETROREPLAYS%
pause
goto menu

:selfplayfactory
rem Was START-laptop.bat. This machine only GENERATES games: it never trains, never rates, never
rem promotes. worker.js auto-detects cores, names its data files after the machine's own hostname,
rem and pushes finished games to git after every chunk, so several machines can run this at once
rem without stepping on each other or on the desktop's trainer.
call :dogit
set GAMES=200
echo.
echo Game factory starting: this window pulls, plays, pushes, forever.
echo Close it any time - finished games are already saved, pushed ones are already shared.
echo.
node nn\worker.js --games %GAMES%
pause
goto menu

:policyfight
rem Was START-policyfight.bat. Trains a policy head on whatever self-play data already exists,
rem then fights it against the plain net at equal think-time (the fair test -- same depth can only
rem tie or lose it). Bounded, then reports a plain verdict. Safe alongside any of the loops above:
rem never touches git, and the candidate it trains is invisible to self-play and the pool until a
rem person promotes it on purpose. Not the same as option 15 -- this trains ONE candidate and stops
rem inside a time box; option 15 evolves the shape forever.
call :dogit
set "PFHOURS="
set /p PFHOURS="Hours budget, Enter for 2: "
if "%PFHOURS%"=="" set PFHOURS=2
node nn\policyfight.js --budgetHours %PFHOURS%
pause
goto menu

:valuetrain
rem One train.js pass on whatever's in nn\data right now, then stops -- not a loop, and not the
rem same thing as option 20 (which ALSO runs self-play + round robin + ladder sweep forever on top
rem of training, and competes much harder for cores). Exists for catching a value net up on a
rem backlog of accumulated data without displacing something else already running on this machine.
rem Saves to nn\models\value.json, NOT best.json -- this has no promotion gate of its own (option
rem 20's loop does), so a person compares it before deciding whether it's worth promoting by hand.
call :dogit
echo.
echo === training the value net on nn\data\*.jsonl (defaults: 8 epochs, family+game+draw weighting) ===
echo.
node nn\train.js
echo.
echo === saved to nn\models\value.json -- compare it (e.g. option 11's STRENGTH check against a
echo copy of best.json) before promoting it over best.json by hand ===
pause
goto menu

:rankplay
rem Was RANK.bat. Unlike option 13 (which only REFITS the ratings already on record), this plays
rem fresh games to actually move the pool. --spread picks how far apart the paired brains are.
call :dogit
set "GAMES=" & set "BUDGET="
set /p GAMES="Games per pair, Enter for 2: "
if "%GAMES%"=="" set GAMES=2
set /p BUDGET="Target hours, Enter for 2 (0 = no limit): "
if "%BUDGET%"=="" set BUDGET=2
node nn\elorank.js --games %GAMES% --spread 6 --budgetHours %BUDGET% --depths 1,2,3 --saveData nn\data\elo.jsonl
pause
goto menu

:archtest
rem Was ARCHTEST.bat. Trains nothing new (--skipTrain); fights the stored shapes against best.json.
call :dogit
set "DEPTH=" & set "GAMES="
set /p DEPTH="Depth, Enter for 1: "
if "%DEPTH%"=="" set DEPTH=1
set /p GAMES="Games, Enter for 40: "
if "%GAMES%"=="" set GAMES=40
node nn\archtest.js --hidden 96,96 --hidden 96,96,96 --hidden 64,64,64,64 --hidden 48,48,48,48,48 --epochs 30 --seed 1 --games %GAMES% --depth %DEPTH% --vs nn\models\best.json --skipTrain
pause
goto menu

:fulltest
rem Was FULLTEST.bat. The long one: trains every shape from scratch at 120 epochs, fights them at
rem D1 and D2, then runs a ladder sweep. Hours, not minutes.
call :dogit
set SHAPES=--hidden 96,96 --hidden 96,64,48 --hidden 82,64,48,32 --hidden 64,64,64,64
echo.
echo === shape sweep, depth 1, 40 games (trains each shape -- this is the long part) ===
node nn\archtest.js %SHAPES% --epochs 120 --seed 1 --games 40 --depth 1 --vs nn\models\best.json
echo.
echo === same shapes, depth 2, 30 games (reuses what was just trained) ===
node nn\archtest.js %SHAPES% --epochs 120 --seed 1 --games 30 --depth 2 --vs nn\models\best.json --skipTrain
echo.
echo === ladder sweep: L9/L10/L11 at depths 1,2,3 ===
node nn\laddertest.js --levels 9,10,11 --depths 1,2,3 --games 6
pause
goto menu

:gitcheck
rem Was GITTEST.bat. Writes a scratch file, commits, pushes, so a new machine can prove it really
rem has write access before a long run discovers otherwise.
call :dogit
node -e "require('fs').writeFileSync('nn/gittest.json', JSON.stringify({ test: 'test1234', machine: require('os').hostname(), at: new Date().toISOString() }, null, 1))"
if defined GIT (
  "%GIT%" add -f nn\gittest.json
  "%GIT%" commit -m "git check from %COMPUTERNAME%"
  "%GIT%" push
  echo.
  echo If the push above succeeded, this machine can share its work.
) else (
  echo git not found -- this machine cannot push.
)
pause
goto menu

:dashboard
start "" "%~dp0dashboard.html"
goto menu

:migratemeasure
rem Was GO.bat steps 1-2. The migration check is a no-op once already migrated (seconds), so it is
rem safe to run any time; the probe suite appends to nn\probe-results.txt, which the trainer's own
rem scroll cannot bury. GO.bat's step 3 was just the full trainer -- that is option 20 now.
call :dogit
echo.
echo === migration check (first time ~10 min, otherwise seconds) ===
node nn\migrate88.js
if errorlevel 1 (
  echo.
  echo   Migration failed - nothing else was run. Old data and models are safe in
  echo   nn\data\backup-pre82 and nn\models\archive-pre82.
  echo.
  pause
  goto menu
)
echo. >> nn\probe-results.txt
echo ============================================================ >> nn\probe-results.txt
node -e "console.log('menu.bat option 30: ' + new Date().toISOString())" >> nn\probe-results.txt
echo.
echo   [a] which inputs does the net lean on?
echo --- feature importance ------------------------------------------ >> nn\probe-results.txt
node nn\feature-importance.js nn\models\best.json >> nn\probe-results.txt 2>&1
echo   [b] how often does the top move hang a throw? (~5 min)
echo --- throw probe ------------------------------------------------- >> nn\probe-results.txt
node nn\throwprobe.js --model nn\models\best.json --games 20 --depth 1 --opponent self >> nn\probe-results.txt 2>&1
echo   [c] quiescence head-to-head, 40 games (~15 min)
echo --- quiescence A/B: depth 1.5 vs depth 1 ------------------------ >> nn\probe-results.txt
node nn\arena.js --a nn:0:nn\models\best.json --b nn:0:nn\models\best.json --depthA 1 --quiesceA --depthB 1 --games 40 >> nn\probe-results.txt 2>&1
echo.
echo === done -- results in nn\probe-results.txt ===
pause
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

:promotemutant
if not exist "nn\models\policy-mutant.json" (
  echo nn\models\policy-mutant.json not found -- nothing to promote. Run option 15 first, or
  echo point --policyA/--policyB at it directly in a manual arena.js test.
  pause
  goto menu
)
rem Local files only -- policy models are never pushed to git (policyloop.js's own rule: "those
rem stay local candidates until a person promotes one", which is exactly this step). Reversible:
rem the outgoing policy-champ.json is backed up to policy-champ-backup-<timestamp>.json first, so
rem promoting on a whim costs nothing to undo -- just copy the backup back over policy-champ.json.
node nn\promote-mutant.js
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

:digest
rem The whole point: elo-results.json (the RAW per-pair W/L/D store underneath every fitted Elo),
rem the training corpus's actual mover composition, and a fresh mine of arena-logs/ never reach a
rem pushed branch -- .gitignore covers data/ and arena-logs/, and elo-results.json is written but
rem never force-added by anything. So the numbers that answer "why can't it beat L11" have been
rem living on this machine only, reachable via screenshots and hand-zipped folders.
rem This crunches all of it into nn\claude-digest.md and pushes that one file.
echo === crunching local-only data into nn\claude-digest.md ===
node nn\digest.js
if errorlevel 1 (
  echo digest failed -- nothing pushed.
  pause
  goto menu
)
echo.
call :dogit
if exist "nn\claude-digest.md" "%GIT%" add -f nn\claude-digest.md >nul 2>nul
"%GIT%" diff --cached --quiet
if errorlevel 1 (
  echo === pushing the digest ===
  "%GIT%" commit -m "nn: local digest from %COMPUTERNAME%" >nul
  "%GIT%" push
) else (
  echo (digest unchanged since last push)
)
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
