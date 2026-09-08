@echo off
setlocal
cd /d "%~dp0.."
title Tau: mint oddball entrants

echo ================================================
echo   Mint the oddball entrants
echo ================================================
echo.
echo   Trains six one-off bets and drops them in nn\models, where the open
echo   league admits them automatically -- no restart needed:
echo.
echo     pancake-1024    one huge hidden layer  (width, no hierarchy)
echo     tower-8x24      eight narrow layers    (hierarchy, no width)
echo     ab-flat-96x96   identical twins, one trained on the flat corpus
echo     ab-elo-96x96    and one on the Elo-weighted corpus -- the league
echo                     itself then A/Bs the new data weighting
echo.
echo     bulge-plain-200x40    200-40-200-40-200, two hard pinches
echo     bulge-dense40-200x40  the SAME shape, but with memory packets that
echo                     route around the pinches. Every bottleneck we have
echo                     measured was a dead end as well as a pinch, so we
echo                     never learned which of the two actually hurt. These
echo                     twins differ in nothing else, so the gap between
echo                     them is the answer.
echo.
echo   Needs CUDA: the bulge pair refuses to fall back to the CPU trainer
echo   rather than quietly minting a plain net under the experiment's name.
echo.
echo   Safe to run while the trainer is going; it just shares the GPU, so
echo   both will be slower for a few minutes.
echo.
pause
node nn\mint-oddballs.js %*
echo.
pause
