@echo off
setlocal
cd /d "%~dp0.."

echo ================================================
echo   Tau value-net four-combo shootout
echo ================================================
echo.
echo This preserves any current option-24/value.json and option-39/torch-PC.json
echo it can identify by shape, trains only missing variants, then plays:
echo.
echo   Torch shape A  vs  JS shape A
echo   Torch shape A  vs  JS shape B
echo   Torch shape B  vs  JS shape A
echo   Torch shape B  vs  JS shape B
echo.
echo Nothing is promoted and these arena games are not fed back into training.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found.
  pause
  exit /b 1
)

set "SHAPEA=96,96"
set "SHAPEB=208"
set "GAMES=30"
set "DEPTH=2"
set /p SHAPEA="Shape A, Enter for 96,96: "
if "%SHAPEA%"=="" set "SHAPEA=96,96"
set /p SHAPEB="Shape B, Enter for 208: "
if "%SHAPEB%"=="" set "SHAPEB=208"
set /p GAMES="Games per matchup, Enter for 30: "
if "%GAMES%"=="" set "GAMES=30"
set /p DEPTH="Depth, Enter for 2: "
if "%DEPTH%"=="" set "DEPTH=2"

echo.
echo Missing models may need to be trained first. That can take a while.
choice /M "Continue"
if errorlevel 2 exit /b 0

echo.
node nn\value-shootout.js --shapeA "%SHAPEA%" --shapeB "%SHAPEB%" --games %GAMES% --depth %DEPTH%

echo.
pause
