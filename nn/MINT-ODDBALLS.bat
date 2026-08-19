@echo off
setlocal
cd /d "%~dp0.."
title Tau: mint oddball entrants

echo ================================================
echo   Mint the oddball entrants
echo ================================================
echo.
echo   Trains four one-off bets and drops them in nn\models, where the open
echo   league admits them automatically -- no restart needed:
echo.
echo     pancake-1024    one huge hidden layer  (width, no hierarchy)
echo     tower-8x24      eight narrow layers    (hierarchy, no width)
echo     ab-flat-96x96   identical twins, one trained on the flat corpus
echo     ab-elo-96x96    and one on the Elo-weighted corpus -- the league
echo                     itself then A/Bs the new data weighting
echo.
echo   Safe to run while the trainer is going; it just shares the GPU, so
echo   both will be slower for a few minutes.
echo.
pause
node nn\mint-oddballs.js %*
echo.
pause
