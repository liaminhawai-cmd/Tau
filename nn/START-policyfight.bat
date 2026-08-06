@echo off
rem Policy fight now lives in menu.bat as option 23 -- this just launches straight into it, so
rem double-click shortcuts pointing at START-policyfight.bat keep working unchanged.
cd /d "%~dp0"
call menu.bat 23
