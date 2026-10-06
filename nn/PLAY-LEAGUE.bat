@echo off
setlocal
cd /d "%~dp0.."

echo.
echo Play in the league: you against any face, rated like one of them.
echo   A browser tab opens on this machine with a League panel in the corner.
echo   Next game plays the face nearest your rating; pick any face from the list instead
echo   if you want. Your opponent plays exactly as it does in the league, and your game
echo   jumps the queue: this window runs at above-normal priority.
echo   Take back as often as you like. Games with take-backs are rated separately
echo   (as you+undo), and every line you finish is saved as training data.
echo   Your games go into nn\human-results.jsonl and nn\data\human-*.jsonl; the league
echo   folds them into the ratings at its next pass. Safe to run alongside the trainer.
echo.
echo   Options:  --name liam   --port 8770
echo   Leave this window open while you play; close it when you are done.
echo.
node nn\human-league.js %*
pause
