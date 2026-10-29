@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
title Tau rung hunt -- find the line where Red beats the top rung

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this machine ^(or not on PATH^).
  echo   Install the LTS from https://nodejs.org ^(defaults are fine^), then run this again.
  echo.
  pause
  exit /b 1
)

rem Every gauntleted net beats the top rung as Blue and loses to it as Red. The winning Red lines
rem exist (the user found one), the nets just never walk into them. This takes the net's own lost
rem Red game against the top rung apart from the end backward and lets other brains take over Red
rem at each ply until one of them wins. Winning games become training rows (nn\data\hunt-*.jsonl);
rem the lines themselves are logged, move by move, to nn\rung-hunt.jsonl. See nn\rung-hunt.js.

set "NET="
set /p NET="Red net, Enter for nn\models\best.json: "
if "!NET!"=="" set "NET=nn\models\best.json"
set "DEPTH="
set /p DEPTH="Its depth, Enter for 2: "
if "!DEPTH!"=="" set "DEPTH=2"
set "FACE="
set /p FACE="Rung to hunt, Enter for the top one: "
set "FACEARG="
if not "!FACE!"=="" set "FACEARG=--face !FACE!"

node nn\rung-hunt.js --net "!NET!" --depth !DEPTH! !FACEARG! --wins 4
echo.
pause
