@echo off
setlocal
cd /d "%~dp0.."
echo.
echo   Parole a retired face back into the league.
echo   An elastic cull is permanent -- this is the only way back in.
echo.
echo   Type part of the name, e.g.  pair4   or   behemoth
echo.
set /p PAT=Face or model name:
if "%PAT%"=="" goto done
echo.
node nn\parole.js --like %PAT% --dry
echo.
set /p GO=Free these for real? (y/N):
if /i not "%GO%"=="y" goto done
echo.
node nn\parole.js --like %PAT%
:done
echo.
pause
