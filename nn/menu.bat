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
echo   9. Policy HEAD-TO-HEAD: pointy vs flat  (same net, same depth -- needs 2 and 3 done)
echo.
echo  10. Exit
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
if "%choice%"=="10" goto :eof
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
rem Fairer than policy-vs-plain: same value net, same depth, same top-3-arms budget on BOTH
rem sides -- the only variable is which policy is choosing, so this one can genuinely be won
rem or lost either way, not just tie-or-lose like the plain-search sanity checks.
echo === pointy (80,44,32,18) vs flat (96,64) policy, same net, depth 3, 24 games ===
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --b nn:0:%CD%\nn\models\best.json --depth 3 --games 24 --policyA %CD%\nn\models\policy-pointy.json --policyB %CD%\nn\models\policy.json --quiesceA --quiesceB
pause
goto menu

:park
if not exist "nn\parktest.js" (
  echo nn\parktest.js not found -- pull first (option 1).
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
