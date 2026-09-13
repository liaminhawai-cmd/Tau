@echo off
setlocal enabledelayedexpansion
title Tau - collect policy files to upload

rem How many rows of policy-targets to take from the END of the file (newest games).
rem 200000 rows is roughly 150 MB raw / 25 MB zipped -- plenty, and the zip stays uploadable.
set "ROWS=200000"

echo.
echo  ================================================
echo    Tau: collecting policy files for upload
echo  ================================================
echo.

rem ---- find the repo, wherever this .bat was dropped ----
set "ROOT=%~dp0"
if exist "!ROOT!nn\policy-targets.js" goto found
set "ROOT=%~dp0..\"
if exist "!ROOT!nn\policy-targets.js" goto found
set "ROOT=C:\tau\Tau\"
if exist "!ROOT!nn\policy-targets.js" goto found
echo   Could not find the Tau repo.
echo   Put this file anywhere inside your Tau folder and run it again.
echo.
pause
exit /b 1
:found
echo   repo: !ROOT!
echo.

set "OUT=%USERPROFILE%\Desktop\tau-upload"
if exist "!OUT!" rmdir /s /q "!OUT!"
mkdir "!OUT!" 2>nul

rem ---- 1. policy nets (the important one) ----
echo   [1/4] policy nets...
set "NETS=0"
for %%F in ("!ROOT!nn\models\policy-joint*.json") do (
  copy /y "%%F" "!OUT!\" >nul && set /a NETS+=1
  echo         + %%~nxF  ^(%%~zF bytes^)
)
rem dual nets carry a policy head too -- good fallback, and small
for %%F in ("!ROOT!nn\models\dual-*.json") do (
  copy /y "%%F" "!OUT!\" >nul && set /a NETS+=1
  echo         + %%~nxF  ^(%%~zF bytes^)
)
if "!NETS!"=="0" echo         none found in nn\models\ -- that is OK, carry on
echo         !NETS! net file^(s^)
echo.

rem ---- 2. locate policy-targets.jsonl ----
echo   [2/4] finding policy-targets.jsonl...
set "SRC="
if exist "!ROOT!nn\data\policy-targets.jsonl" set "SRC=!ROOT!nn\data\policy-targets.jsonl"
if not defined SRC if exist "!ROOT!nn\policy-targets.jsonl" set "SRC=!ROOT!nn\policy-targets.jsonl"
if not defined SRC (
  echo         not found -- skipping the data slice
  goto zipstep
)
for %%A in ("!SRC!") do echo         found: %%~fA  ^(%%~zA bytes^)
echo.

rem ---- 3. take the newest ROWS lines ----
echo   [3/4] slicing the newest %ROWS% rows ^(this can take a minute^)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $l = Get-Content -LiteralPath '!SRC!' -Tail %ROWS%; $l = $l | Where-Object { $_.TrimEnd().EndsWith('}') }; [System.IO.File]::WriteAllLines('!OUT!\policy-slice.jsonl', $l); Write-Host ('        kept ' + $l.Count + ' complete rows')"
if errorlevel 1 echo         slice failed -- upload the nets only, that is the important half
echo.

:zipstep
rem ---- 4. zip it all ----
echo   [4/4] zipping...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Compress-Archive -Path '!OUT!\*' -DestinationPath '%USERPROFILE%\Desktop\tau-upload.zip' -Force; $z=Get-Item '%USERPROFILE%\Desktop\tau-upload.zip'; Write-Host ('        tau-upload.zip = ' + [math]::Round($z.Length/1MB,1) + ' MB')"
if errorlevel 1 (
  echo         zip failed -- just upload the loose files in the folder instead
) else (
  rmdir /s /q "!OUT!" 2>nul
)

echo.
echo  ================================================
echo    Done.  On your Desktop:  tau-upload.zip
echo    Drag that into the chat.
echo  ================================================
echo.
explorer /select,"%USERPROFILE%\Desktop\tau-upload.zip"
pause
