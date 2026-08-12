@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

rem Thin front door around the proven toolkit menu. The full existing menu is preserved byte-for-byte
rem as nn\menu-legacy.bat; this wrapper only adds option 43 without rewriting the giant batch file.
rem START.bat / START-laptop.bat pass an option number, so all existing one-click launchers still
rem delegate straight through unchanged.
if not "%~1"=="" (
  if "%~1"=="43" goto wildmint
  call nn\menu-legacy.bat %*
  exit /b %errorlevel%
)

:front
cls
echo ================================================
echo   Tau NN toolkit
echo ================================================
echo   43. WILD MINT + FULL TRAINER
echo       -- 8 experimental value-net shapes, adaptive peak finding, resumable
echo       -- then starts the normal trainer automatically; no second restart or prompt
echo.
echo   Type any existing option number to launch it directly,
echo   or press Enter to open the full original toolkit menu.
echo ================================================
set "choice="
set /p choice="Pick a number: "
if "%choice%"=="43" goto wildmint
if "%choice%"=="" (
  call nn\menu-legacy.bat
  exit /b %errorlevel%
)
call nn\menu-legacy.bat %choice%
exit /b %errorlevel%

:wildmint
call :dogit
echo.
echo === refreshing gold / silver / bronze from the latest confident Elo table ===
node nn\publish-medals.js
echo.
echo === one-off wild architecture expedition ===
echo Eight deliberately different shapes train in chunks, keep their best validation checkpoint,
echo stop when the peak is clearly behind them, and can resume after an interrupted run.
echo.
node nn\wild-mint.js
if errorlevel 1 (
  echo.
  echo Wild mint hit a fatal error. The completed checkpoints/state are safe; normal trainer was NOT started.
  pause
  goto front
)
echo.
echo === wild mint complete -- starting normal trainer automatically ===
echo.
call nn\fulltrainer-auto.bat
exit /b %errorlevel%

:dogit
set "GIT=git"
where git >nul 2>nul
if errorlevel 1 (
  set "GIT="
  for /f "delims=" %%d in ('dir /b /ad /o-n "%LOCALAPPDATA%\GitHubDesktop\app-*" 2^>nul') do (
    if not defined GIT if exist "%LOCALAPPDATA%\GitHubDesktop\%%d\resources\app\git\cmd\git.exe" set "GIT=%LOCALAPPDATA%\GitHubDesktop\%%d\resources\app\git\cmd\git.exe"
  )
)
if defined GIT (
  echo === pulling latest ===
  "%GIT%" pull
) else (
  echo git not found on PATH or under GitHub Desktop -- skipping pull.
)
exit /b 0
