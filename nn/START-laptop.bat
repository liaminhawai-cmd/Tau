@echo off
rem Tau game factory -- double-click on ANY spare machine to feed the main trainer.
rem This machine only GENERATES games: it never trains, never rates, never promotes. Auto-detects
rem cores, names its data files after the machine's own hostname, and pushes finished games to git
rem after every chunk, so several machines can run this at once without stepping on each other or
rem on the desktop's trainer. Setup on a new machine: install Node.js + git, clone the repo (the
rem machine's GitHub account needs write access), double-click this. That's the whole list.
rem
rem The old ladder-only version of this file is superseded: worker.js keeps its one hard-won
rem lesson (selfplay's internal fork() silently wrote 0 bytes on one laptop, so every lane here is
rem its own top-level node process) and adds pulls, pushes, the trainer's published opponent pool,
rem and mover-id stamping via the newest checkpoint.
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
rem Games per chunk (one commit+push per chunk). Override: START-laptop.bat 500
set GAMES=%1
if "%GAMES%"=="" set GAMES=200
echo Game factory starting: this window pulls, plays, pushes, forever.
echo Close it any time - finished games are already saved, pushed ones are already shared.
node worker.js --games %GAMES%
pause
