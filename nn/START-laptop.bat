@echo off
rem The self-play game factory now lives in menu.bat as option 22 -- this just launches straight
rem into it, so double-click shortcuts pointing at START-laptop.bat keep working unchanged.
cd /d "%~dp0"
call menu.bat 22
