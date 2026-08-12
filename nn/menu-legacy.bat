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
echo  20. FULL TRAINER: continuous self-play + evolving Elo pool + CPU value/GPU dual training
echo      -- no retromine; first-cover unplayed faces, then Elo/CI-weight the shared pool
echo      -- 4 standing dual nets enter bare and +policy; weak ones are replaced one at a time
echo  21. RETROMINE: ratchet-only data generation, multicore
echo  22. SELF-PLAY FACTORY: plain game generation for a spare machine (never trains/rates)
echo  23. POLICY FIGHT: train a policy net on existing data, fight it at equal think-time
echo      (bounded, a couple hours -- not the loop; see 15 for the evolving version)
echo  24. VALUE TRAINER, single pass: one train.js run on whatever data exists now, then stops
echo      (minutes, not the loop -- for catching up a value net without competing hard for cores
echo      with something else already running, e.g. the policy loop on this same machine)
echo  31. HYBRID: policy loop at normal priority + full trainer at BELOW-normal, one machine
echo      -- the trainer soaks up the ~20min every policy cycle spends single-threaded, and the
echo      tournament tail after fast matchups finish. Policy still wins any core it asks for.
echo.
echo  43. WILD MINT + FULL TRAINER
echo      -- 8 experimental value-net shapes, adaptive peak finding, resumable
echo      -- then starts the normal trainer automatically; no second restart or prompt
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
echo  32. CLOCK SWEEP: policy vs no policy across RANDOM think times (1-30s), both sides matched
echo      -- a fixed clock sits in one regime forever; this samples across ply boundaries, so
echo      "never helps" and "helps only where it banks a ply" stop looking the same
echo.
echo  33. CLOCK SWEEP RESULTS: bin option 32's games by think time (instant, plays nothing)
echo  38. L11 CLOCK MATCH: le:L11 given L11's OWN measured think time vs L11 native (unclocked,
echo      fixed depth) -- measures this machine's L11 first (median of N real moves), then hands
echo      leL11 that exact budget. Same eval, time-matched instead of width-matched: does L11's
echo      judgement do better with nnai's search machinery than its own, given what it normally
echo      spends anyway? Multi-core. Now also exempts PARK stops from nnai's plateau smoothing,
echo      without which leL11 could not play L11's park game at all (see nn/GLOSSARY.md).
echo  39. TORCH TRAIN: train a value net in PyTorch on the same nn\data\*.jsonl train.js uses --
echo      no export step, same game-level split + gameWeight/drawWeight, drops into arena.js/
echo      elorank.js unchanged. Uses CUDA when available. Needs Python + `pip install torch`.
echo      Verifies itself before
echo      claiming success -- a transposed weight matrix loads and plays fine with no error,
echo      just badly, so this always checks against reference outputs first.
echo  40. PYTHON vs JS VALUE: torch-%COMPUTERNAME%.json vs value.json, same engine + same depth
echo      -- run 39 and 24 first. Pure head-to-head: asks games/depth, promotes nothing, trains nothing.
echo  41. DUAL TRAIN: train ONE shared-trunk net with a value head AND a policy head jointly, in
echo      PyTorch (GPU if this machine has one, else CPU), from nn\policy-targets.jsonl -- which
echo      already carries a value target on every policy-target row, so no new data is mined.
echo      Verifies itself: same transposed-weight risk as 39, PLUS a second failure mode shape
echo      checks can't catch either -- the final layer's split activation (value tanh'd, policy
echo      logits left raw).
echo  42. DUAL vs SEPARATE: does one fused forward pass (dual's own policy head) beat a separate
echo      value net + policy net at equal search settings? Run 41 first (and 39/24 + a policy loop
echo      for the separate side). Pure head-to-head: promotes nothing, trains nothing.
echo  37. FULL LOOP: champ + mutant + scratch policy heads, on BOTH best.json and the L11-style
echo      evaluator, round-robin at random think times, forever. The one that tests everything
echo      at once -- 19 matchups a cycle. Preview it before committing hours: it dry-runs first.
echo.
echo  36. VARIANT LOOP: trains a policy, then round-robins policy USE configurations against each
echo      other, against no policy, and against L11 -- forever, recording every result.
echo      Default a3s2 (3 arms, every 2nd stop) vs a2s1 (2 arms, every stop).
echo.
echo  35. NARROW+DEEP: policy-narrowed search vs the current default, equal clock
echo      -- the policy's real lever. Pruning ARMS saturates (~2.9x, never a ply); cutting
echo      keepForDepth removes NODES and compounds (8x at keep 1). Measured: depth 4/keep 2/
echo      arms 2 runs in 1070ms where the depth 3/keep 4 default takes 1907ms -- a ply deeper
echo      in half the time. Only safe if the kept candidates are the right ones, which is what
echo      a policy is actually for. THIS is the configuration nothing has tested yet.
echo.
echo  34. CLOCK POLICY LOOP: the full policy loop, but every match on a RANDOM clock per game
echo      -- same evolve/tournament/adopt cycle as 15, sweeping the clock instead of pinning it,
echo      so the binned answer accumulates over cycles. Read it with 33 any time.
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
if "%choice%"=="31" goto hybrid
if "%choice%"=="32" goto clocksweep
if "%choice%"=="33" goto clocksweepresults
if "%choice%"=="34" goto clockloop
if "%choice%"=="35" goto narrowdeep
if "%choice%"=="36" goto variantloop
if "%choice%"=="37" goto fullloop
if "%choice%"=="38" goto l11clockmatch
if "%choice%"=="39" goto torchtrain
if "%choice%"=="40" goto torchvsjs
if "%choice%"=="41" goto dualtrain
if "%choice%"=="42" goto dualvsseparate
if "%choice%"=="43" goto wildmint
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

:wildmint
rem Long, resumable architecture expedition followed by the established option-20 trainer.
rem State is checkpointed after every 10-epoch chunk, so closing the window loses no completed chunk.
call :dogit
echo.
echo === refreshing gold / silver / bronze from the latest confident Elo table ===
node nn\publish-medals.js
echo.
echo === one-off wild architecture expedition ===
echo Eight deliberately different shapes train in chunks, keep their best validation checkpoint,
echo stop when the peak is clearly behind them, and can resume after an interrupted run.
echo.
node nn\wild-mint.js
if errorlevel 1 (
  echo.
  echo Wild mint hit a fatal error. The completed checkpoints/state are safe; normal trainer was NOT started.
  pause
  goto menu
)
echo.
echo === wild mint complete -- starting normal trainer automatically ===
echo.
call nn\fulltrainer-auto.bat
goto menu

:fulltrainer
rem The existing proven trainer, not a separate league loop: ordinary self-play stays continuous;
rem CPU value controls/mutants/lineages keep evolving; elorank places frozen checkpoints on one
rem persistent adaptive pool. Retromine has been removed from this loop. A small standing dual
rem population trains replacements on CUDA at the same time as the CPU branch. Every active file
rem enters twice per depth -- bare and +policy -- without ever replacing one-output best.json.
call :dogit
set "DUALFLAG="
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Python not found: the ordinary CPU value trainer will still run, but dual heads are off.
  echo   Install Python + `pip install torch` to enable the GPU branch.
  echo.
  set "DUALFLAG=--noDual"
)
if not defined DUALFLAG (
  python -c "import torch" >nul 2>nul
  if errorlevel 1 (
    echo.
    echo   PyTorch is not installed: the ordinary trainer will run without dual heads.
    echo   Run: pip install torch
    echo.
    set "DUALFLAG=--noDual"
  )
)
set "DUEPOCHS="
if not defined DUALFLAG set /p DUEPOCHS="Dual epoch budgets to rotate through, Enter for 20,40,60: "
if not defined DUALFLAG if "!DUEPOCHS!"=="" set DUEPOCHS=20,40,60
echo.
echo Full Tau trainer started. Self-play keeps making data while CPU value and GPU dual branches train.
echo Dual runs a verified GPU check immediately, then uses a 4-model Elo population with one replacement at a time.
echo Retromine is not part of this loop. Close the window any time; completed work is checkpointed.
echo.
if defined DUALFLAG (
  node nn\run.js --gamesPerBatch 1000 --randomStartFrac 0.15 --scratchHidden 96,64,48 %DUALFLAG%
) else (
  node nn\run.js --gamesPerBatch 1000 --randomStartFrac 0.15 --scratchHidden 96,64,48 --dualEpochs !DUEPOCHS! --dualStartNow
)
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

:hybrid
rem Both loops on one machine without them fighting, via PRIORITY rather than a fixed core split.
rem
rem Why not "give the policy loop N cores": its appetite is spiky, not steady. Per cycle it wants
rem 1 core for ~30s of minting, 1 core for ~20 MINUTES of single-threaded mutant training
rem (train-policy.js has no worker_threads), then up to 12 for the tournament. Pin it to 2 and the
rem tournament runs ~6x longer; give it 12 permanently and 15 threads idle through every training
rem phase. A static split is wrong in both directions.
rem
rem Priority tracks that shape by itself. The policy loop stays at NORMAL and wins any core it
rem asks for the moment it asks -- which matters because its matches are --timeMs (equal thinking
rem TIME), so starving it doesn't just slow it down, it changes what each side gets to search.
rem The trainer runs BELOWNORMAL and takes whatever is genuinely spare: the whole 20-minute
rem training window every cycle, plus the tournament tail once the fast matchups (L5 finishes in
rem ~2 min, L9 can take 20) have freed their lanes. Windows child processes inherit the parent's
rem priority class, so run.js's own self-play workers are all BELOWNORMAL too -- no per-child work.
rem
rem The trainer gets fewer workers than it would solo (its default is min(cores-1,14)): priority
rem settles who runs, but every extra process still costs RAM and scheduler churn, and this box has
rem 16GB shared with 12 policy lanes.
call :dogit
set "HYHOURS=" & set "HYWORKERS="
set /p HYHOURS="Policy hours per cycle, Enter for 2: "
if "%HYHOURS%"=="" set HYHOURS=2
set /p HYWORKERS="Background trainer workers, Enter for 6: "
if "%HYWORKERS%"=="" set HYWORKERS=6
echo.
echo Starting the background trainer at BELOW-normal priority in its own window...
start "Tau trainer (background priority)" /belownormal node nn\run.js --gamesPerBatch 1000 --randomStartFrac 0.15 --scratchHidden 96,64,48 --workers %HYWORKERS%
echo.
echo Trainer launched. Starting the policy loop at normal priority in THIS window.
echo Closing this window stops the policy loop only -- the trainer has its own window.
echo.
node nn\policyloop.js --budgetHours %HYHOURS%
pause
goto menu

:clocksweep
if not exist "nn\models\policy-champ.json" (
  echo nn\models\policy-champ.json not found -- run option 15 first, or wait for a cycle to finish.
  pause
  goto menu
)
rem Same net, same clock, only the policy differs -- but the clock is redrawn per game instead of
rem pinned. Whether a search saving becomes strength depends on where the budget lands relative to
rem the next ply boundary: pruning buys ~1.5x effective time, a ply costs 4-6x, so it can only ever
rem pay when the clock already sits just short of one. A single fixed clock is stuck in one regime
rem and reports the average of a structure it never shows; this samples across several boundaries.
rem PRUNE vs ABCUT picks how the policy is spent (see nnai.js's header -- prune deletes arms, abcut
rem orders them and cuts once refuted and is never blind).
call :dogit
set "CSGAMES=" & set "CSMODE="
set /p CSGAMES="Games, Enter for 120: "
if "%CSGAMES%"=="" set CSGAMES=120
set /p CSMODE="Mode: 1=prune (default), 2=abcut, Enter for 1: "
set "CSAB="
if "%CSMODE%"=="2" set "CSAB=--abA"
set "CSTAG=prune"
if "%CSMODE%"=="2" set "CSTAG=abcut"
echo.
echo === policy-champ (%CSTAG%) vs no policy, clock random 1000-30000ms per game, %CSGAMES% games ===
echo Per-game results -> nn\clocksweep\clocksweep-%CSTAG%-%COMPUTERNAME%.jsonl
echo.
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --policyA %CD%\nn\models\policy-champ.json %CSAB% --b nn:0:%CD%\nn\models\best.json --timeMsLo 1000 --timeMsHi 30000 --games %CSGAMES% --resultsJsonl %CD%\nn\clocksweep\clocksweep-%CSTAG%-%COMPUTERNAME%.jsonl --saveData %CD%\nn\data\clocksweep-%CSTAG%-%COMPUTERNAME%-rows.jsonl
echo.
echo === done. Bin the results by clock with option 33. ===
pause
goto menu

:fullloop
rem Everything on one clock. Per cycle: pull, mint, train a mutant AND a scratch head, then a round
rem robin of champ/mutant/scratch/nopolicy under EACH evaluator, the two controls against each other
rem across evaluators, and ladder anchors -- every game on its own log-uniform clock, both sides
rem matched.
rem
rem Why these axes and not others, all measured this session:
rem   - arms 2 not 3: 6->2 buys 1.95x where 6->3 buys 1.67x, and neither buys a ply (4-6x), so the
rem     arms are for SAFETY and ordering quality, not speed.
rem   - full stops, no stride: thinning stops saves ~11%% of a sweep because the physics stepping
rem     cannot be skipped -- reaching any stop means stepping through every stop before it.
rem   - sweepDeg 3 (the default) is already 3x finer than real L11's 9, and resolution is nearly
rem     free (8.5x the stops for 35%% more time), so fidelity is taken rather than bought.
rem   - scratch head: the champion is only retrained when its shape changes and keeps its seat on a
rem     tie, so a same-shape fresh-init net is the only thing that can show it is coasting.
rem   - le:L11 shares nnai's search exactly, so a cross-evaluator result isolates the EVAL rather
rem     than confounding it with the real L11 rung's different fixed-depth search.
rem   - the DUAL net (dualnet.js) rides along with its own champ/mutant lineage, entering twice per
rem     head: bare (value head only) and fused (+policy, one forward pass for both). The value
rem     league rates FROZEN dual nets; it structurally cannot retrain them, because a rated identity
rem     has to mean one fixed set of weights for its whole history. This is where the retraining and
rem     the shape climb happen. Needs Python + torch on this machine; if either is missing the dual
rem     entrants are skipped and the rest of the cycle runs unchanged.
call :dogit
set "FLHOURS=" & set "FLARMS=" & set "FLLEVELS=" & set "FLDUAL=" & set "FLDUALEP="
set /p FLHOURS="Hours per cycle, Enter for 3: "
if "%FLHOURS%"=="" set FLHOURS=3
set /p FLARMS="Arms to keep, Enter for 2: "
if "%FLARMS%"=="" set FLARMS=2
rem WHICH rungs, not how many -- this is a comma-separated list passed straight through to
rem --levels, so "11" means L11 alone and "5" would mean L5 alone, not "the top 5".
set /p FLLEVELS="Which ladder rungs to anchor against (comma-separated, e.g. 10,11), Enter for 11: "
if "%FLLEVELS%"=="" set FLLEVELS=11
choice /M "Include the dual value+policy net (needs Python + torch)"
if errorlevel 2 (
  set "FLDUAL="
) else (
  set /p FLDUALEP="  Dual training epochs, Enter for 40: "
  if "!FLDUALEP!"=="" set FLDUALEP=40
  set "FLDUAL=--dual 1 --dualHeads champ,mutant,scratch --dualEpochs !FLDUALEP!"
)
echo.
echo Preview of what each cycle will play:
node nn\policyloop.js --variants a%FLARMS%s1 --heads champ,mutant,scratch --evaluators nn,le:L11 --levels %FLLEVELS% --timeMsLo 1000 --timeMsHi 30000 %FLDUAL% --dryRun --cycles 1
echo.
echo Starting. Close this window any time. Read the clock breakdown with option 33.
echo.
node nn\policyloop.js --variants a%FLARMS%s1 --heads champ,mutant,scratch --evaluators nn,le:L11 --levels %FLLEVELS% --timeMsLo 1000 --timeMsHi 30000 %FLDUAL% --budgetHours %FLHOURS%
pause
goto menu

:variantloop
rem Same cycle as option 15 -- pull, mint, train, play, record, push, repeat -- but the tournament
rem compares USES of one policy head instead of two SHAPES. Shape is held fixed for the cycle and no
rem mutant is trained: shape and use are different questions, and moving both at once would leave
rem neither attributable.
rem
rem Measured before building this, so the defaults are not guesses:
rem   arms 3 -> 1.67x, arms 2 -> 1.95x, arms 1 -> 2.91x   (saturates -- never the 4-6x a ply costs)
rem   halving the stops within an arm -> ~11%% of a sweep  (the physics stepping cannot be skipped;
rem   reaching any stop means stepping through every stop before it)
rem So a3s2 is the "narrow arms AND thin the stops" arm of the test and a2s1 is "narrow the arms
rem harder, keep every stop". Throws are never thinned out at any stride.
call :dogit
set "VLHOURS=" & set "VLVARIANTS=" & set "VLLEVELS="
set /p VLHOURS="Hours per cycle, Enter for 2: "
if "%VLHOURS%"=="" set VLHOURS=2
set /p VLVARIANTS="Variants, Enter for a3s2,a2s1 (add ,ab to include ordering+cutoff): "
if "%VLVARIANTS%"=="" set VLVARIANTS=a3s2,a2s1
set /p VLLEVELS="Ladder rungs to anchor against, Enter for 11: "
if "%VLLEVELS%"=="" set VLLEVELS=11
echo.
echo Preview of what each cycle will play:
node nn\policyloop.js --variants %VLVARIANTS% --levels %VLLEVELS% --dryRun --cycles 1
echo.
echo Starting the variant loop. Close this window any time.
echo.
node nn\policyloop.js --variants %VLVARIANTS% --levels %VLLEVELS% --budgetHours %VLHOURS%
pause
goto menu

:narrowdeep
if not exist "nn\models\policy-champ.json" (
  echo nn\models\policy-champ.json not found -- run option 15 first, or wait for a cycle to finish.
  pause
  goto menu
)
rem Same net, same clock, both sides iterative-deepening -- only the SHAPE of the search differs.
rem A: policy-ordered, narrowed to 2 candidates and 2 arms, so each ply is cheap enough to reach
rem    one deeper inside the same budget.
rem B: the current default -- keepForDepth 4, all 6 arms, no policy.
rem If narrow+deep is worth anything, A wins here. If the width it gave up matters more than the
rem ply it bought, B wins -- and that is a real answer either way, unlike arm-pruning at fixed
rem width which measured 52%% over 108 games because it was never buying a ply at all.
call :dogit
set "NDGAMES=" & set "NDKEEP=" & set "NDARMS="
set /p NDGAMES="Games, Enter for 60: "
if "%NDGAMES%"=="" set NDGAMES=60
set /p NDKEEP="Candidates to keep (narrow side), Enter for 2: "
if "%NDKEEP%"=="" set NDKEEP=2
set /p NDARMS="Arms to keep (narrow side), Enter for 2: "
if "%NDARMS%"=="" set NDARMS=2
echo.
echo === narrow+deep (keep %NDKEEP%, arms %NDARMS%, policy) vs default (keep 4, no policy), 2000ms both, %NDGAMES% games ===
echo.
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --policyA %CD%\nn\models\policy-champ.json --keepA %NDKEEP% --policyArmsA %NDARMS% --b nn:0:%CD%\nn\models\best.json --keepB 4 --timeMs 2000 --games %NDGAMES% --saveData %CD%\nn\data\narrowdeep-%COMPUTERNAME%.jsonl
pause
goto menu

:l11clockmatch
rem le:L11 (L11's eval, nnai's search) vs the real L11 (its own fixed search), holding L11's own
rem THINK TIME constant instead of holding search WIDTH constant. Different question from 35's:
rem does L11's judgement do better with a real clock + iterative deepening than with its native
rem fixed-depth-3/maxCands-28 search, given the same time it already spends? A plain "L11" brain
rem spec ignores --timeMsB entirely (it always calls ladderPlanFor), so B is unaffected either way
rem -- only A's clock is being set here.
rem Both sides spend real per-move time (L11's own move cost is the whole point, and it is highly
rem variable -- one machine measured a 20s MEDIAN with a 2-38s range), so arena.js's normal
rem single-process/sequential-games behaviour makes a real sample size take many hours. This calls
rem l11-clock-match.js instead of arena.js directly: it measures L11's clock once, splits the game
rem count across cores-1 arena.js lanes running in parallel, and pools their results into one
rem verdict when every lane is done -- same idea as the full loop's 12 arena lanes, applied to one
rem matchup instead of many.
call :dogit
set "L11GAMES=" & set "L11MOVES="
set /p L11GAMES="Games, Enter for 60: "
if "%L11GAMES%"=="" set L11GAMES=60
set /p L11MOVES="Moves to measure L11's clock over, Enter for 30: "
if "%L11MOVES%"=="" set L11MOVES=30
echo.
node nn\l11-clock-match.js --games %L11GAMES% --moves %L11MOVES%
pause
goto menu

:torchtrain
rem Trains a value net in PyTorch on whatever's already in nn\data -- no export step, torch-train.py
rem reads the same *.jsonl rows train.js does and replicates its game-level split + gameWeight/
rem drawWeight so the comparison is fair. Needs Python + `pip install torch` on THIS machine; a
rem missing python is caught below rather than left as a cryptic node-ism. Saves to nn\models\, not
rem best.json -- like option 24, this has no promotion gate, a person compares it by hand.
rem ALWAYS verify before trusting the output: a transposed weight matrix loads fine, runs fine, and
rem just plays badly with no error anywhere -- that is what verify-torch-export.js's __probe check
rem exists to catch, and shape checks alone cannot (see nn\GLOSSARY.md).
call :dogit
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Python not found on this machine. Install it from python.org, then:
  echo     pip install torch
  echo.
  pause
  goto menu
)
set "TTHIDDEN=" & set "TTEPOCHS=" & set "TTOUT="
set /p TTHIDDEN="Hidden layers, Enter for 96,96: "
if "%TTHIDDEN%"=="" set TTHIDDEN=96,96
set /p TTEPOCHS="Epochs, Enter for 40: "
if "%TTEPOCHS%"=="" set TTEPOCHS=40
set TTOUT=nn\models\torch-%COMPUTERNAME%.json
echo.
echo === training %TTHIDDEN% for %TTEPOCHS% epochs on nn\data\*.jsonl ===
echo.
python nn\torch-train.py --hidden %TTHIDDEN% --epochs %TTEPOCHS% --out %TTOUT%
if errorlevel 1 (
  echo.
  echo Training failed -- see the error above. Nothing was saved.
  pause
  goto menu
)
echo.
echo === verifying the export (catches a silent weight-layout bug -- always run this) ===
echo.
node nn\verify-torch-export.js %TTOUT%
if errorlevel 1 (
  echo.
  echo DO NOT USE %TTOUT% -- it failed verification, see above.
  pause
  goto menu
)
echo.
echo Saved and verified: %TTOUT%
echo Compare it for real:
echo   node nn\arena.js --a nn:0:%CD%\%TTOUT% --b L11 --games 60 --depth 2
pause
goto menu

:torchvsjs
rem Clean trainer A/B. Both entrants use arena.js + nnai.js at the SAME fixed depth; the only
rem intended difference is the training implementation that produced the weights. Do not save
rem these games back into nn\data: this is an experiment, not a new source of training examples.
set "TVJTORCH=nn\models\torch-%COMPUTERNAME%.json"
set "TVJJS=nn\models\value.json"
if not exist "%TVJTORCH%" (
  echo.
  echo %TVJTORCH% not found -- run option 39 on this machine first.
  pause
  goto menu
)
if not exist "%TVJJS%" (
  echo.
  echo %TVJJS% not found -- run option 24 first.
  pause
  goto menu
)
set "TVJGAMES=" & set "TVJDEPTH="
set /p TVJGAMES="Games, Enter for 60: "
if "%TVJGAMES%"=="" set TVJGAMES=60
set /p TVJDEPTH="Depth, Enter for 2: "
if "%TVJDEPTH%"=="" set TVJDEPTH=2
echo.
echo === PYTHON/TORCH vs FRESH JS: same arena engine, depth %TVJDEPTH%, %TVJGAMES% games ===
echo A = %TVJTORCH%
echo B = %TVJJS%
echo Arena logs the running score after every game. This promotes nothing and trains nothing.
echo.
node nn\arena.js --a nn:0:%CD%\%TVJTORCH% --b nn:0:%CD%\%TVJJS% --games %TVJGAMES% --depth %TVJDEPTH%
pause
goto menu

:dualtrain
rem Trains the JOINT value+policy net (dualnet.js/torch-train-dual.py): one shared trunk, a value
rem head and a policy head off the same last hidden layer, so a search node that wants both pays
rem for one forward pass instead of two. Mints/refreshes policy-targets.jsonl first -- cheap even on
rem a big corpus, policy-targets.js caches per source file -- so this always trains on the latest
rem self-play data with no separate manual step. GPU-accelerated automatically if this machine has
rem one PyTorch can see (torch.cuda.is_available()); falls back to CPU otherwise, same as option 39.
rem Saves to nn\models\, not best.json -- no promotion gate, a person compares it by hand (option 42).
rem ALWAYS verify before trusting the output: same silent-transpose risk as option 39, PLUS a second
rem way to go wrong that shape checks cannot catch either -- the final layer's SPLIT activation
rem (value tanh'd, policy logits left raw). verify-dual-export.js's __probe check catches both.
call :dogit
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Python not found on this machine. Install it from python.org, then:
  echo     pip install torch
  echo.
  pause
  goto menu
)
echo.
echo === minting/refreshing policy-targets.jsonl from nn\data (cached per source file) ===
echo.
node nn\policy-targets.js
if errorlevel 1 (
  echo.
  echo Minting failed -- see the error above.
  pause
  goto menu
)
set "DTHIDDEN=" & set "DTEPOCHS=" & set "DTOUT="
set /p DTHIDDEN="Hidden layers, Enter for 96,96: "
if "%DTHIDDEN%"=="" set DTHIDDEN=96,96
set /p DTEPOCHS="Epochs, Enter for 40: "
if "%DTEPOCHS%"=="" set DTEPOCHS=40
set DTOUT=nn\models\dual-%COMPUTERNAME%.json
echo.
echo === training dual %DTHIDDEN% for %DTEPOCHS% epochs on nn\policy-targets.jsonl ===
echo.
python nn\torch-train-dual.py --hidden %DTHIDDEN% --epochs %DTEPOCHS% --out %DTOUT%
if errorlevel 1 (
  echo.
  echo Training failed -- see the error above. Nothing was saved.
  pause
  goto menu
)
echo.
echo === verifying the export (catches a silent weight-layout OR split-activation bug) ===
echo.
node nn\verify-dual-export.js %DTOUT%
if errorlevel 1 (
  echo.
  echo DO NOT USE %DTOUT% -- it failed verification, see above.
  pause
  goto menu
)
echo.
echo Saved and verified: %DTOUT%
echo Compare the value head ALONE first (fair vs a plain net -- no policy spent on either side):
echo   node nn\arena.js --a dual:0:%CD%\%DTOUT% --b nn:0:nn\models\value.json --games 60 --depth 2
echo Then the fusion question itself -- option 42, or by hand:
echo   node nn\arena.js --a dual:0:%CD%\%DTOUT% --dualPolicyA --b nn:0:nn\models\value.json --policyB nn\models\policy.json --games 60 --depth 2 --ab
pause
goto menu

:dualvsseparate
rem Fused (one dual net, its own policy head spent via --dualPolicyA) vs separate (an independently
rem trained value net + policy net, spent the identical way via --policyB) -- same search settings
rem on both sides, so the only intended difference is one forward pass per node vs two. --ab on both
rem (ordering + cutoff, never blind) rather than hard pruning, so a loss can only mean the fused net's
rem judgement was worse, not that it saw fewer arms.
set "DVSDUAL=nn\models\dual-%COMPUTERNAME%.json"
set "DVSVALUE=nn\models\value.json"
set "DVSPOLICY=nn\models\policy.json"
if not exist "%DVSDUAL%" (
  echo.
  echo %DVSDUAL% not found -- run option 41 on this machine first.
  pause
  goto menu
)
if not exist "%DVSVALUE%" (
  echo.
  echo %DVSVALUE% not found -- run option 24 first.
  pause
  goto menu
)
if not exist "%DVSPOLICY%" (
  echo.
  echo %DVSPOLICY% not found -- train one first (option 15's policy loop, or train-policy.js by hand).
  pause
  goto menu
)
set "DVSGAMES=" & set "DVSDEPTH="
set /p DVSGAMES="Games, Enter for 60: "
if "%DVSGAMES%"=="" set DVSGAMES=60
set /p DVSDEPTH="Depth, Enter for 2: "
if "%DVSDEPTH%"=="" set DVSDEPTH=2
echo.
echo === FUSED (dual, own policy) vs SEPARATE (value net + policy net): depth %DVSDEPTH%, %DVSGAMES% games ===
echo A = %DVSDUAL% (dualPolicy, ab-cut)
echo B = %DVSVALUE% + %DVSPOLICY% (ab-cut)
echo Arena logs the running score after every game. This promotes nothing and trains nothing.
echo.
node nn\arena.js --a dual:0:%CD%\%DVSDUAL% --dualPolicyA --b nn:0:%CD%\%DVSVALUE% --policyB %CD%\%DVSPOLICY% --games %DVSGAMES% --depth %DVSDEPTH% --ab
pause
goto menu

:clockloop
rem Option 15's loop with the clock swept instead of pinned. Everything else is identical --
rem mint, train a mutant, tournament, adopt or keep, push -- but each tournament game draws its own
rem think time and both sides get the same one, and every game is appended to
rem nn\clocksweep\clocksweep-loop-<machine>.jsonl so option 33 can bin the whole run.
rem
rem This pools SEPARATELY from option 15's fixed-clock history: a swept pool and a pinned pool are
rem different experiments, and averaging them would erase exactly the structure sweeping exists to
rem find. The banked fixed-clock games are untouched and still readable under their own key.
call :dogit
set "CLHOURS=" & set "CLMODE=" & set "CLARMS="
set /p CLHOURS="Hours per cycle, Enter for 2: "
if "%CLHOURS%"=="" set CLHOURS=2
set /p CLMODE="Mode: 1=prune, 2=abcut (recommended), Enter for 2: "
if "%CLMODE%"=="" set CLMODE=2
set "CLAB=--ab 1"
if "%CLMODE%"=="1" set "CLAB="
set "CLARMSFLAG="
if "%CLMODE%"=="1" (
  set /p CLARMS="Arms to keep when pruning, Enter for 3: "
  if not "!CLARMS!"=="" set "CLARMSFLAG=--policyArms !CLARMS!"
)
echo.
echo Starting the clock-swept policy loop. Close this window any time.
echo.
node nn\policyloop.js --budgetHours %CLHOURS% %CLAB% %CLARMSFLAG% --timeMsLo 1000 --timeMsHi 30000
pause
goto menu

:clocksweepresults
rem Read-only: bins whatever option 32 has produced so far. Safe to run mid-sweep -- arena.js
rem appends per game, so a partial run reads honestly rather than not at all.
setlocal enabledelayedexpansion
set "FOUND="
for %%F in (nn\clocksweep\clocksweep-*.jsonl) do (
  echo %%F | findstr /v "rows" >nul && (
    echo.
    echo === %%F ===
    node nn\clocksweep.js "%%F"
    set "FOUND=1"
  )
)
if not defined FOUND echo No clocksweep results yet -- run option 32 first.
endlocal
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
