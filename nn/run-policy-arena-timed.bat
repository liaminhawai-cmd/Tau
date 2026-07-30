@echo off
rem The FAIR test for the policy head. run-policy-arena.bat compares pruned vs plain search at the
rem SAME depth -- pruning can only tie or lose there, never win, since it sees a subset of what full
rem search sees. Its entire payoff is that each depth costs less, which only shows up as "how much
rem further did it get in the same clock time" -- so this compares both sides on an equal think-time
rem budget (iterative deepening) instead of an equal depth. Run run-policy-build.bat first.
cd /d "%~dp0.."

if not exist "nn\models\policy.json" (
  echo nn\models\policy.json not found -- run run-policy-build.bat first.
  pause
  exit /b 1
)
if not exist "nn\models\best.json" (
  echo nn\models\best.json not found.
  pause
  exit /b 1
)

echo === policy-pruned vs plain, 2000ms per move each, same net, 24 games ===
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --b nn:0:%CD%\nn\models\best.json --games 24 --timeMs 2000 --policyA %CD%\nn\models\policy.json

echo.
echo === done ===
pause
