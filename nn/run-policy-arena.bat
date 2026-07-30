@echo off
rem Same-net A/B: policy-pruned depth-3 search vs plain depth-3 search, both with quiesce.
rem This is the one that actually answers "did the policy head help" -- run run-policy-build.bat
rem first (it needs nn\models\policy.json to exist). Long-running: expect this to take a while.
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

echo === policy-pruned D3 vs plain D3, same net, 24 games ===
node nn\arena.js --a nn:0:%CD%\nn\models\best.json --b nn:0:%CD%\nn\models\best.json --depth 3 --games 24 --policyA %CD%\nn\models\policy.json --quiesceA --quiesceB

echo.
echo === done ===
pause
