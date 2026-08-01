@echo off
rem Minimal git round-trip probe. Writes one small file, commits it, pushes it -- nothing else.
rem Point of this: isolate whether git/GitHub itself works on THIS machine, separately from
rem whether worker.js or run.js work. If this bat fails, the problem is git/auth/sync (GitHub
rem Desktop reinstall, Google Drive interference, credentials), not the Tau code. If this bat
rem succeeds but worker.js still writes nothing, the problem is back in worker.js/selfplay.js.
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo.
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo   git is not on PATH on this computer.
  echo.
  pause
  exit /b 1
)

echo === git identity on this machine ===
git config user.name
git config user.email
echo.

echo === pulling first ===
git pull
echo.

echo === writing gittest.json ===
node -e "require('fs').writeFileSync('gittest.json', JSON.stringify({ test: 'test1234', machine: require('os').hostname(), at: new Date().toISOString() }, null, 1))"
type gittest.json
echo.

echo === staging, committing, pushing ===
git add -f gittest.json
git commit -m "gittest: round-trip probe from %COMPUTERNAME%"
git push

echo.
echo === done -- if you see "main -^> ..." or a branch update line above, the push worked. ===
echo === If git asked you to log in just now, that's the fix -- do it, then run this again. ===
pause
