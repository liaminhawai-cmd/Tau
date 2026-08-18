@echo off
setlocal
cd /d "%~dp0.."

echo ==============================================
echo   Tau: migrate official Elo league
echo ==============================================
echo Keeps every model and all training data.
echo Keeps current Elo as a weak starting prior, resets
 echo official game counts to zero, reopens faces culled
 echo under old rating semantics, then starts one clean
 echo two-colour temp-0 league.
echo.
node nn\rating-state.js
if errorlevel 1 (
  echo.
  echo Elo migration failed.
  pause
  exit /b 1
)
echo.
echo Done. Safe to run again: it will not reset a current league.
pause
