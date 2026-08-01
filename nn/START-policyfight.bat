@echo off
rem Trains a policy head on whatever self-play data already exists, then fights it against the
rem plain net at equal think-time (the fair test -- same depth can only tie or lose it). Bounded
rem to run for a couple of hours at most, then reports a plain verdict.
rem
rem Safe to run at the same time as START-laptop.bat in another window: it never touches git, and
rem the candidate it trains is invisible to self-play and the pool until a person promotes it on
rem purpose (see policyfight.js's own header). Close this window any time -- the trained candidate
rem is already saved after the training step, and the running score is saved to
rem nn\data\.policy-fight-status.json after every batch.
rem
rem Override the time budget: START-policyfight.bat 3   (hours)
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
if "%HOURS%"=="" set HOURS=2
node policyfight.js --budgetHours %HOURS%
pause
