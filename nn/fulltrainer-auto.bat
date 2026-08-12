@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

rem Non-interactive equivalent of menu option 20, used only after option 43 finishes its wild mint.
rem Normal option 20 remains untouched and keeps its prompts. Here the established defaults are
rem intentional so a many-hour mint cannot finish at 3am and sit waiting for somebody to press Enter.
set "DUALFLAG="
where python >nul 2>nul
if errorlevel 1 set "DUALFLAG=--noDual"
if not defined DUALFLAG (
  python -c "import torch" >nul 2>nul
  if errorlevel 1 set "DUALFLAG=--noDual"
)

echo.
echo Full Tau trainer starting automatically after wild mint.
echo Dual epoch rotation: 20,40,60 when Python+PyTorch are available; otherwise ordinary CPU value training only.
echo Close the window any time; completed work is checkpointed.
echo.
if defined DUALFLAG (
  node nn\run.js --gamesPerBatch 1000 --randomStartFrac 0.15 --scratchHidden 96,64,48 %DUALFLAG%
) else (
  node nn\run.js --gamesPerBatch 1000 --randomStartFrac 0.15 --scratchHidden 96,64,48 --dualEpochs 20,40,60 --dualStartNow
)
exit /b %errorlevel%
