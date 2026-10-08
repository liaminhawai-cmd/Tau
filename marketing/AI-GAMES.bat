@echo off
setlocal EnableExtensions
title Tau AI games for video
cd /d "%~dp0"
rem Plays AI-vs-AI games at low, mid and high strength and makes replay links for Director mode.
rem The brains come from the live website's code (the main branch), checked out into marketing\.main.
rem The current ladder rungs 11 to 14 are never used, so the challenge opponents stay out of videos.

where node >nul 2>nul || (echo Node.js isn't installed. Get the LTS version from https://nodejs.org & pause & exit /b 1)
where git >nul 2>nul || (echo Git isn't installed. & pause & exit /b 1)

set "WT=%~dp0.main"
echo Getting the latest website code...
git fetch -q origin main || (echo Couldn't reach GitHub. & pause & exit /b 1)
if exist "%WT%\index.html" (
  git -C "%WT%" checkout -q --detach --force origin/main || goto broken
) else (
  if exist "%WT%" rmdir /s /q "%WT%"
  git worktree prune
  git worktree add -q --detach "%WT%" origin/main || goto broken
)

echo.
set "GAMES=" & set "TIERS="
set /p "GAMES=Games per strength, up to 6 (Enter for 6): "
if not defined GAMES set "GAMES=6"
echo Strengths: low, mid, high. Type some separated by commas, or press Enter for all three.
set /p "TIERS=Strengths: "
if not defined TIERS set "TIERS=low,mid,high"
for /f %%T in ('powershell -nologo -noprofile -command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "STAMP=%%T"
set "OUT=%~dp0clips\ai-games-%STAMP%"
echo.
echo Playing. Low games take seconds, mid and high can take a minute or two each.
node "%~dp0ads\showcase.js" --root "%WT%" --games %GAMES% --tiers %TIERS% --out "%OUT%" || (pause & exit /b 1)
start "" "%OUT%\index.html"
pause
exit /b 0

:broken
echo Couldn't set up the website checkout. Delete the marketing\.main folder and run this again.
pause
exit /b 1
