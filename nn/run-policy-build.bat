@echo off
rem Superseded. This built nn\models\policy.json, a filename nothing in the current pipeline reads
rem anymore -- policyloop.js and menu.bat both use policy-champ.json / policy-mutant.json instead,
rem and mining has since gained source weighting (see policy-targets.js's header). Use menu.bat
rem options 2-4 instead (build/mint), or option 15 for the full evolving loop.
cd /d "%~dp0"
call menu.bat
