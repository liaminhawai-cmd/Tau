@echo off
setlocal
cd /d "%~dp0.."

echo.
echo Pull human wins over the nets (web, Steam, mobile) from Supabase into nn\data\web-*.jsonl.
echo   The trainer (run.js) already does this every hour; this is the same thing on demand.
echo   Needs the service-role key in nn\.supabase-service-key or SUPABASE_SERVICE_KEY.
echo.
node nn\pull-web-games.js %*
pause
