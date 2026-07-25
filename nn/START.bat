@echo off
rem Tau NN training — double-click to start. Leave the black window open; close it to stop.
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer - please call Liam.
  echo.
  pause
  exit /b 1
)
git pull >nul 2>nul
echo Training started. Leave this window open. Close it any time to stop - progress is saved.
node run.js
pause
