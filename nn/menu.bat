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
echo  11. STRENGTH: best vs L11 at depth 3  -- the open question, leave it running
echo  12. WIDTH A/B: keep 6 + policy cutoff vs plain keep 4  -- leave it running
echo.
echo  13. Exit
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
if "%choice%"=="13" goto :eof
goto menu

:vsl11
if not exist "nn\models\best.json" (
  echo nn\models\best.json not found.
  pause
  goto menu
)
rem The headline strength question, and the only one still open. Measured over randomized
rem openings at temperature 0: D1 vs L11 went 3-9 and D2 vs L11 went 1-7, so at those depths the
rem net is beaten and not narrowly. D3 went 4-2 -- but that is 6 games, a 2-sigma band of plus or
rem minus 41 points, i.e. consistent with anything from a quarter to every game. Only a real
rem sample settles it.
rem Worth rerunning after every promotion: those numbers describe the net the iteration-60 round
rem robin then replaced, so they are about a champion that no longer exists.
rem Not expected to finish, and it does not need to -- D3 costs several times D2 per move, and
rem arena prints the running score after every single game. Read wherever it got to. 60 games is
rem already plus or minus 13, enough to separate 67 from a coin flip.
set "GAMES=200"
set /p GAMES="Games to play, Enter for 200: "
echo.
echo Safe to run with the trainer going: fixed depth, so sharing cores changes how long this
echo takes but not which moves either side picks, and neither side is on a clock.
echo.
echo === best.json at depth 3 vs L11, %GAMES% games ===
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --b L11 --depth 3 --games %GAMES%
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
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --b nn:0:%CD%\nn\models\best.json --games 24 --timeMs 2000 --policyA %CD%\nn\models\policy.json
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
