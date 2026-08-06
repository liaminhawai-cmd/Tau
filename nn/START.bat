@echo off
rem Everything used to live here as its own separate 3-item menu. It's all folded into menu.bat
rem now (options 20-23 are exactly this file's old two loops, plus the two that used to be their
rem own separate START-*.bat files) -- this just launches the real menu so double-click shortcuts
rem pointing at START.bat keep working unchanged.
cd /d "%~dp0"
call menu.bat
