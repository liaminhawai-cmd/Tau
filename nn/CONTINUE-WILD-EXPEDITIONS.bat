@echo off
setlocal
cd /d "%~dp0.."

echo ================================================
echo   Tau - continue wild expeditions deliberately
echo ================================================
echo This is NOT the normal option-43 restart path.
echo It resumes checkpointed architecture/policy searches on purpose.
echo Close the window any time; completed chunks remain checkpointed.
echo.

node nn\wild-mint.js --continue-expedition
if errorlevel 1 goto failed

echo.
echo === refreshing policy targets for unfinished dual/policy searches ===
node nn\policy-targets.js
if errorlevel 1 goto failed

echo.
node nn\wild-dual-mint.js --continue-expedition
if errorlevel 1 echo Dual expedition stopped early; continuing with the remaining expeditions.

echo.
node nn\behemoth-mint.js --continue-expedition
if errorlevel 1 echo Behemoth expedition stopped early; continuing with the remaining expeditions.

echo.
node nn\joint-policy-mint.js --continue-expedition
if errorlevel 1 echo Joint-policy expedition stopped early.

echo.
echo Wild expedition continuation pass complete.
pause
exit /b 0

:failed
echo.
echo Expedition continuation stopped on a fatal prerequisite/error.
echo Existing checkpoints are safe.
pause
exit /b 1
