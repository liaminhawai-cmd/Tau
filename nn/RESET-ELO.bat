@echo off
setlocal
cd /d "%~dp0.."

echo ==============================================
echo   Tau: reset official Elo league
echo ==============================================
echo Keeps every model and all training data.
echo Archives the old rating state, reopens faces that
 echo were culled under old semantics, and starts one
 echo clean temp-0 league.
echo.
node nn\rating-state.js --force
if errorlevel 1 (
  echo.
  echo Elo reset failed.
  pause
  exit /b 1
)
echo.
echo Done. Restart option 20 or 43.
pause
