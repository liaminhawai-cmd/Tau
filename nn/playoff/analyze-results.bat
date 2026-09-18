@echo off
cd /d %~dp0
set MOVERS=L11,L8,best@D1,best@D2
node playoff-analyze.js out > results.txt
type results.txt
echo.
echo Full table also saved to results.txt in this folder.
pause
