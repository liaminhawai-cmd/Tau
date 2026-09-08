@echo off
setlocal
cd /d "%~dp0.."
title Tau: architecture expedition

echo ================================================
echo   Architecture expedition -- trained to peak
echo ================================================
echo.
echo   Unlike MINT-ODDBALLS, this does NOT stop at a fixed epoch count.
echo   Each shape trains in 10-epoch chunks, keeps the best validation
echo   checkpoint seen across ALL chunks, and stops only once the curve
echo   has flattened for 30 epochs. The peak file is what enters the pool.
echo.
echo   Safe to close and re-run: state is saved after every chunk, and a
echo   shape already marked done is skipped.
echo.
echo   The seven new entries are the two experiments:
echo.
echo     peak-bulge-plain-200x40     200-40-200-40-200, two hard pinches
echo     peak-bulge-dense40-200x40   the SAME shape with memory packets
echo                                 routing around the pinches
echo.
echo     peak-mem-k004 / k016 / k040 / k120
echo                                 the packet-width sweep on the
echo                                 production 10x400 trunk
echo     peak-mem-k040-noresid       packets kept, residual trunk removed
echo.
echo   The eight original wild shapes are already complete and are skipped.
echo.
echo   Needs CUDA. A memory topology cannot be trained on the CPU at all,
echo   so those shapes fail loudly rather than minting a plain net under
echo   an ablation's name.
echo.
echo   This is a LONG run -- up to 200 epochs per shape. Pass --maxEpochs 60
echo   to cap it, or --patienceEpochs 20 to stop sooner.
echo.
pause
node nn\wild-mint.js --continue-expedition %*
echo.
pause
