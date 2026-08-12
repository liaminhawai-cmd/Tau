@echo off
rem Single entry point: option 43 now lives in the full toolkit menu with every existing option.
call "%~dp0menu-legacy.bat" %*
exit /b %errorlevel%
