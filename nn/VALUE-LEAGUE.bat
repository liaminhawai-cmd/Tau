@echo off
setlocal
cd /d "%~dp0.."

echo ================================================
echo   Tau adaptive value league
echo ================================================
echo.
echo 4 frozen value nets x depths 1,2,3 = 12 rated NN players
echo plus L7-L11 as about 10%% of games.
echo.
echo Matchmaking follows the live Elo table, cross-depth games are allowed,
echo completed games are added to training data, and standings/90%% CI are
echo checkpointed continuously. Close or Ctrl-C whenever you want; rerun to resume.
echo.
choice /M "Start/resume league"
if errorlevel 2 exit /b 0

echo.
node nn\value-league.js

echo.
pause