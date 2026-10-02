@echo off
setlocal
cd /d "%~dp0.."
echo.
echo First run: pull this update and restart the trainer once for bypass support.
echo Deep best experiment: plain, residual, thick bridges, wispy bridges.
echo About 4M weights each: 400 wide, plain 26 layers, residual variants 22.
echo One fixed copy of best.json; stable corpus files; one GPU job at a time.
echo Plain learns to imitate best first. Residual variants preserve best at birth.
echo Each job trains through RAM-sized shards, keeps its best score, and verifies its export.
echo Finished models enter the normal league. No automatic promotion or exemption.
echo Safe to run alongside the trainer, but both jobs will run slower.
echo Logs: nn\grow-cache\deep-suite-*\
echo Options: --styles residual,wispy --rounds 3 --shardMB 512 --batch 512
python nn\deep-suite.py %*
set "deep_exit=%errorlevel%"
if not "%deep_exit%"=="0" echo Experiment stopped with error %deep_exit%. Read the log above.
pause
exit /b %deep_exit%
