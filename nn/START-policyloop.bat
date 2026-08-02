@echo off
rem Tau policy factory -- the policy-head counterpart to START-laptop.bat's game factory.
rem This machine NEVER trains a value net and never writes the rating pool: it pulls whatever the
rem desktop has promoted, pairs it with competing policy heads, and hill-climbs the policy's shape.
rem Every tournament game is saved and pushed, so it keeps feeding the trainer while it works.
rem
rem Run this INSTEAD of START-laptop.bat (it uses the cores the same way), or alongside it with a
rem smaller --workers if you want both. Close the window any time: pushed games are shared and the
rem champion policy on disk survives for the next run.
rem
rem Override the per-cycle time budget in hours: START-policyloop.bat 2
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer - grab it from nodejs.org, or call Liam.
  echo.
  pause
  exit /b 1
)
git pull >nul 2>nul
set HOURS=%1
if "%HOURS%"=="" set HOURS=1
echo Policy factory starting: this window pulls, evolves the policy head, plays, pushes, forever.
echo Close it any time - finished games are already saved, pushed ones are already shared.
node policyloop.js --budgetHours %HOURS%
pause
