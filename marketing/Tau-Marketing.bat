@echo off
setlocal EnableExtensions
title Tau Marketing
cd /d "%~dp0"
set "TOOLS=%~dp0rotoscope"
set "CLIPS=%~dp0clips"
set "VENV=%~dp0.venv"
set "PY=%VENV%\Scripts\python.exe"

rem Drag a file onto this .bat to skip the menu.
if not "%~1"=="" goto dropped

:menu
echo.
echo  ===== Tau Marketing =====
echo   1. Rotoscope a clip  (detect fighters, then open the editor)
echo   2. Open the editor
echo   3. Render a corrected clip to MP4
echo   4. Open the clips folder
echo   5. First-time setup / repair
echo   Q. Quit
echo.
echo  Tip: you can also drag a video or a .corrected.json onto this file.
echo.
set "CHOICE="
set /p "CHOICE=Choose: "
if /i "%CHOICE%"=="1" goto detect_ask
if /i "%CHOICE%"=="2" goto editor
if /i "%CHOICE%"=="3" goto render_ask
if /i "%CHOICE%"=="4" (start "" "%CLIPS%" & goto menu)
if /i "%CHOICE%"=="5" goto setup_force
if /i "%CHOICE%"=="q" exit /b 0
goto menu

:dropped
set "IN=%~1"
echo "%~nx1" | findstr /i /c:".corrected.json" >nul && goto render_file
echo "%~nx1" | findstr /i /c:".pose.json" >nul && goto editor
goto detect_file

:detect_ask
echo.
echo Drag the video into this window and press Enter.
set "IN="
set /p "IN=Video: "
if not defined IN goto menu
set "IN=%IN:"=%"
:detect_file
call :setup || goto fail
if not exist "%IN%" (echo Can't find "%IN%" & goto fail)
for %%F in ("%IN%") do (set "NAME=%%~nF" & set "EXT=%%~xF" & set "DIR=%%~dpF")
rem Keep a copy in clips\ so the video, its skeletons and renders stay together.
if /i not "%DIR%"=="%CLIPS%\" copy /y "%IN%" "%CLIPS%\%NAME%%EXT%" >nul
echo.
echo Only need part of the video? Give times like 1:23 (or press Enter for all of it).
set "T0=" & set "T1=" & set "RANGE="
set /p "T0=Start at: "
set /p "T1=End at:   "
if defined T0 set "RANGE=--start %T0%"
if defined T1 set "RANGE=%RANGE% --end %T1%"
echo.
echo Detecting fighters in %NAME%%EXT% ...
"%PY%" "%TOOLS%\detect.py" "%CLIPS%\%NAME%%EXT%" %RANGE% || goto fail
echo.
echo Done. In the editor, open:
echo   %CLIPS%\%NAME%%EXT%
echo   %CLIPS%\%NAME%.pose.json
echo (or drag both onto the editor window)
start "" "%CLIPS%"
goto editor

:editor
start "" "%TOOLS%\editor.html"
if not "%~1"=="" exit /b 0
goto menu

:render_ask
echo.
echo In the editor, click "Export corrected" and save the file into the clips folder.
echo Then drag that .corrected.json in here and press Enter.
set "IN="
set /p "IN=Corrected file: "
if not defined IN goto menu
set "IN=%IN:"=%"
:render_file
call :setup || goto fail
echo.
set "SHAPE="
set /p "SHAPE=Shape? [W]idescreen (default) or [P]hone 9:16: "
set "SIZE="
if /i "%SHAPE%"=="p" set "SIZE=--width 1080 --height 1920"
for %%F in ("%IN%") do set "NAME=%%~nF"
set "NAME=%NAME:.corrected=%"
"%PY%" "%TOOLS%\render.py" "%IN%" --out "%CLIPS%\%NAME%_tau.mp4" %SIZE% || goto fail
echo.
echo Saved %CLIPS%\%NAME%_tau.mp4
start "" "%CLIPS%"
if not "%~1"=="" (pause & exit /b 0)
goto menu

:setup_force
if exist "%VENV%" rmdir /s /q "%VENV%"
call :setup || goto fail
echo Setup complete.
goto menu

rem ---------- setup: private Python environment in marketing\.venv ----------
:setup
if exist "%PY%" exit /b 0
echo.
echo First-time setup (takes a few minutes, only happens once)...
set "BASEPY="
where py >nul 2>nul && set "BASEPY=py -3"
if not defined BASEPY where python >nul 2>nul && set "BASEPY=python"
if not defined BASEPY (
  echo.
  echo Python isn't installed. Get it from https://www.python.org/downloads/
  echo During install, tick "Add python.exe to PATH". Then run this again.
  start "" https://www.python.org/downloads/
  exit /b 1
)
%BASEPY% -m venv "%VENV%" || exit /b 1
"%PY%" -m pip install --upgrade pip >nul
"%PY%" -m pip install -r "%TOOLS%\requirements.txt" || exit /b 1
exit /b 0

:fail
echo.
echo Something went wrong (see above). If it's a setup problem, choose option 5.
pause
if not "%~1"=="" exit /b 1
goto menu
