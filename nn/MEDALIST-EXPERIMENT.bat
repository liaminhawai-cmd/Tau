@echo off
setlocal
cd /d "%~dp0.."

echo.
echo Medalist-data ablation
echo   Builds equal-size training corpora at medalist-game shares 1 / 0.5 / 0.25 / 0,
echo   trains one net per arm (same shape, epochs, seed), then runs every arm through
echo   the same fixed gauntlet vs best.json, L10 and L11. Nothing enters the live
echo   league; everything lands under nn\experiments\.
echo.
echo   Note: training and gauntlet games share this machine with anything already
echo   running. For a clean read, run it while the full trainer is stopped, or accept
echo   that wall-clock (not results) will stretch.
echo.
node nn\experiment-medalist.js %*
pause
