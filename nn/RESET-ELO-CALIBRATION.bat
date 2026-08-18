@echo off
setlocal
cd /d "%~dp0.."

echo ==================================================
echo   Tau: clean Elo calibration reset
echo ==================================================
echo Archives the old rating state locally, resets Elo to
echo temp-0 standard-opening arena evidence only, reopens
echo elastic-culled faces whose model files still exist,
echo and clears the stale cull bank / summaries.
echo.
node nn\rating-calibration.js
if errorlevel 1 (
  echo.
  echo Rating reset failed.
  pause
  exit /b 1
)
echo.
echo Done. Restart option 20 or 43 to rebuild the clean ladder.
pause
