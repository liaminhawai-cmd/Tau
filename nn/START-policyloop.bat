@echo off
rem The policy loop has always also been menu.bat option 15 -- this just launches straight into
rem it, so double-click shortcuts pointing at START-policyloop.bat keep working unchanged.
cd /d "%~dp0"
call menu.bat 15
