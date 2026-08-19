@echo off
setlocal
cd /d "%~dp0.."
title Tau: feature-ceiling probe

echo ================================================
echo   Feature-ceiling probe  (are the 94 features the wall?)
echo ================================================
echo.
echo   Trains the SAME net twice on the SAME data and seed -- once on the
echo   94 features alone, once with the raw piece pose appended -- and
echo   compares validation curves.
echo.
echo   Every shape from 96x64 to the 2M-weight behemoth lands at ~83.5%%
echo   sign-accuracy, which looks like an input-representation ceiling
echo   rather than a capacity one. This is the cheap test of that.
echo.
echo   Reading it:  if +pose clearly wins, feature work is worth real
echo   investment.  If they tie, the ceiling is label noise/data instead.
echo.
echo   Needs python + torch. Outputs land in nn\experiments\ and NEVER in
echo   nn\models -- a pose-input net cannot be played by the live engine.
echo   Best run while the trainer is stopped, or expect a slow GPU.
echo.
pause
node nn\experiment-pose.js %*
echo.
pause
