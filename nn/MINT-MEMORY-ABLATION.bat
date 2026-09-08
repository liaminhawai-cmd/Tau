@echo off
setlocal
cd /d "%~dp0.."
title Tau: memory ablation

echo ================================================
echo   Take the production memory recipe apart
echo ================================================
echo.
echo   best.json and half the live pool are the SAME recipe: a 10x400 trunk
echo   with k=40 memory packets and a residual scale of 0.2. It beats a plain
echo   net. Nobody knows which half of it is responsible.
echo.
echo   HOW WIDE SHOULD THE PACKET BE?
echo     mem-k004  mem-k016  mem-k040  mem-k120
echo     You have two memory models today and they differ in the packet width
echo     AND in the message type, so neither one tells you anything about the
echo     width alone. These four change nothing but the width, so they give a
echo     curve instead of two dots that cannot be joined.
echo.
echo   IS IT THE PACKETS AT ALL?
echo     mem-k040-noresid
echo     Every memory net so far bundles packets with a residual trunk. This
echo     one keeps the packets and drops the trunk. If it holds up, the
echo     packets were doing the work. If it collapses, they never were.
echo.
echo   mem-k040 is the production recipe, so it is the control for both.
echo   Five long runs. Needs CUDA -- it refuses to fall back to the CPU
echo   trainer rather than quietly minting a plain net under these names.
echo.
echo   Safe to run while the trainer is going; it just shares the GPU.
echo   The league admits each one as it finishes -- no restart needed.
echo.
pause
node nn\mint-oddballs.js --only memory %*
echo.
pause
