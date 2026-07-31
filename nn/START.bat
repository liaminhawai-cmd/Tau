@echo off
rem Tau NN training — double-click to start. Leave the black window open; close it to stop.
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer - please call Liam.
  echo.
  pause
  exit /b 1
)
git pull >nul 2>nul
rem Games per self-play BATCH. This used to gate a resume-train step that ran once per small batch
rem (hence a small number, 30), but that step is gone -- self-play now just runs continuously,
rem chaining itself into a fresh batch the moment one finishes, with retraining and the round
rem robin on their own independent clock (see run.js's header). A bigger batch means the
rem straggler tail (the one slow game that leaves every other core idle at the very end) gets
rem paid far less often relative to useful work done, so there is no reason to keep this small
rem anymore -- 1000 is the new default; raise it further if batches still finish quickly.
set GAMES=1000
rem Architecture for the from-scratch challenger that enters every round robin. 96,64,48 is the
rem bake-off winner: it swept all four of its pairings at search depth 2 (63%) and leads across
rem both depths combined (58% of 268 decided games), while the flat 96,96 this run has used all
rem along came LAST at both depths (38-39%).
rem
rem Pinning it here rather than adopting it by hand means the round robin keeps deciding: a fresh
rem 96,64,48 is entered every time, and if it genuinely outplays the incumbent lineage it gets
rem promoted on merit and the whole run switches shape by itself. Without the pin the challenger
rem just copies best.json's shape, so one round robin going the other way would permanently kill
rem the new shape off. Blank it (set SHAPE=) to go back to following best.json.
set SHAPE=96,64,48
set SHAPEFLAG=
if not "%SHAPE%"=="" set SHAPEFLAG=--scratchHidden %SHAPE%
echo Training started. Leave this window open. Close it any time to stop - progress is saved.
node run.js --gamesPerBatch %GAMES% %SHAPEFLAG%
pause
