@echo off
setlocal enabledelayedexpansion

rem Runs from wherever this file lives, so it works regardless of where the repo is checked out --
rem this file sits in nn\, so the repo root is one level up.
cd /d "%~dp0.."

rem git is often not on PATH on a fresh machine; fall back to GitHub Desktop's bundled copy,
rem same auto-detect run.js itself uses (newest app-* version first).
set "GIT=git"
where git >nul 2>nul
if errorlevel 1 (
  set "GIT="
  for /f "delims=" %%d in ('dir /b /ad /o-n "%LOCALAPPDATA%\GitHubDesktop\app-*" 2^>nul') do (
    if not defined GIT if exist "%LOCALAPPDATA%\GitHubDesktop\%%d\resources\app\git\cmd\git.exe" (
      set "GIT=%LOCALAPPDATA%\GitHubDesktop\%%d\resources\app\git\cmd\git.exe"
    )
  )
  if not defined GIT (
    echo Could not find git on PATH or under GitHub Desktop. Pull manually, then re-run this script.
    pause
    exit /b 1
  )
)

echo === pulling latest ===
"%GIT%" pull
if errorlevel 1 (
  echo git pull failed - stopping.
  pause
  exit /b 1
)

echo.
echo === minting policy targets from existing self-play data ===
node nn\policy-targets.js
if errorlevel 1 (
  echo policy-targets.js failed - stopping.
  pause
  exit /b 1
)

echo.
echo === training the policy net (20 epochs) ===
node nn\train-policy.js --epochs 20
if errorlevel 1 (
  echo train-policy.js failed - stopping.
  pause
  exit /b 1
)

echo.
echo === done -- policy net saved to nn\models\policy.json ===
echo Run run-policy-arena.bat next to A/B it against plain search (that one's long).
pause
