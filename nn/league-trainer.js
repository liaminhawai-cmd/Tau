'use strict';
// One trainer, three deliberately unequal streams:
//   1) official league: every core but three (one spare for the OS). Its rated games are ALSO the main training corpus,
//      every pairing is a face the model has never met (the scheduler refuses re-matches), and
//      culling plus fresh mints keep the field turning over, so it never runs out of new games;
//   2) exploration self-play: ONE lane, small batches, the strongest measured nets and the top
//      ladder rungs only, every game started from a position the data has never seen
//      (novel-start.js) -- a side project on the scale of retromine, not a second factory;
//   3) retromine: one worker hunting adversarial/ratchet positions for training only.
// run.js still owns mutation, GPU training, promotion and compute-aware culling. This file changes
// where game-generation compute goes, not the evolutionary rules.
const {spawn}=require('child_process');
const os=require('os');
const path=require('path');
const proc=require('./proc-tree.js');
const dir=__dirname;
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;};
const cores=Math.max(2,os.cpus().length);
// cores-3: one lane each for exploration and retromine, and ONE CORE LEFT FREE for the OS, the
// GPU trainer's data loading and the rating pass's bootstrap, so the desktop stays usable.
// --noSelfplay / --retroWorkers 0 hand their core back to the league: with both side streams off
// the league takes every core but one (LEAGUE-ONLY.bat). run.js still runs -- it owns mutation,
// GPU training, the gate, culling and medals -- it just starts no self-play batches.
const noSelfplay=process.argv.includes('--noSelfplay');
const retroWorkers=Math.max(0,+arg('retroWorkers',1));
const exploreWorkers=noSelfplay?0:Math.max(1,+arg('exploreWorkers',1));
const sideLanes=(retroWorkers?1:0)+(exploreWorkers?1:0);
const leagueWorkers=Math.max(1,+arg('leagueWorkers',Math.max(4,cores-1-sideLanes)));
// Exploration batch size and start policy. 60 games on one lane is a trickle next to the league,
// which is the point; novelStartFrac 1 means every one of them opens where the data is thinnest.
const exploreGames=Math.max(1,+arg('exploreGames',60));
const novelStartFrac=arg('novelStartFrac','1');
const children=[];
let stopping=false;
function start(label,script,args){
  console.log(`\n=== ${label} ===`);
  const ch=spawn(process.execPath,[path.join(dir,script),...args],{stdio:'inherit'});
  children.push(ch);
  ch.on('error',e=>console.error(`[trainer] ${label} failed to launch:`,e.message));
  return ch;
}
// Whole trees, not just the three direct children: ch.kill() reached league-loop but never its
// elorank pass or that pass's arena workers, which is how every restart left a ghost league behind.
// SIGHUP is what a closed console window sends on Windows.
function stopAll(){if(stopping)return;stopping=true;for(const ch of children)proc.killTree(ch.pid);}
for(const sig of ['SIGINT','SIGTERM','SIGHUP','SIGBREAK'])try{process.on(sig,()=>{stopAll();process.exit(0);});}catch(_){}
process.on('exit',stopAll);

// Leftovers from an earlier trainer (its loops, its rating pass, its retromine lanes) hold the Elo
// writer lock and half the cores; the new trainer would spend hours standing down behind them.
const ORPHAN_SCRIPTS=['league-trainer.js','league-loop.js','run.js','retroloop.js','policyloop.js','elorank.js','elorank-legacy.js'];
const reaped=proc.reapOrphans(ORPHAN_SCRIPTS);
if(reaped==null)console.log('[trainer] could not list processes; if an older trainer is still running, close it by hand');
else if(reaped.length)console.log(`[trainer] closed ${reaped.length} leftover process tree(s) from an earlier trainer: ${reaped.map(r=>`${r.script} (pid ${r.pid})`).join(', ')}`);

console.log(`[trainer] league-first allocation: ${leagueWorkers} league`+
            (exploreWorkers?` + ${exploreWorkers} exploration`:'')+
            (retroWorkers?` + ${retroWorkers} retromine`:'')+` worker(s), 1 core left for the OS`);
console.log('[trainer] official league games are both Elo evidence and training data; exploration never contaminates Elo');
if(noSelfplay)console.log('[trainer] LEAGUE ONLY: no self-play, no retromine unless asked; evolution (mints, GPU training, gate, cull, medals) runs as normal');
else console.log(`[trainer] exploration: ${exploreGames}-game batches, top-rated nets only, ${Math.round(100*+novelStartFrac)}% of games from positions the data has never seen`);

start('PRIMARY OFFICIAL LEAGUE','league-loop.js',['--workers',String(leagueWorkers),'--budgetHours','.25']);
if(retroWorkers) start('SMALL RETROMINE STREAM','retroloop.js',
  ['--workers',String(retroWorkers),'--seedsPerJob','1','--maxReplaysPerSeed','80']);

// Keep run.js's mature mutation/training machinery, but make its ordinary self-play a minority
// exploration stream. Its own scheduled placement call gets only a token budget; normally it sees
// the Elo writer lock and exits immediately because league-loop is already the sole rating writer.
// Bench sweeps are effectively disabled here: fixed ladder brains already live in the universal
// league, so a separate expensive sweep is diagnostic duplication rather than useful game supply.
const OWN_ARGS=['--leagueWorkers','--exploreWorkers','--retroWorkers','--exploreGames','--novelStartFrac'];
const forwarded=process.argv.slice(2).filter((x,i,a)=>{
  if(OWN_ARGS.includes(x))return false;
  if(i>0&&OWN_ARGS.includes(a[i-1]))return false;
  return true;
});
const lanes=String(Math.max(1,exploreWorkers));
const runArgs=['--workers',lanes,'--poolWorkers',lanes,
  '--poolBudgetHours','0.01','--benchEveryMin','100000','--randomStartFrac','0',
  '--gamesPerBatch',String(exploreGames),'--novelStartFrac',String(novelStartFrac),...forwarded];
const core=start('EVOLUTION + EXPLORATION','run.js',runArgs);
core.on('exit',code=>{console.log(`[trainer] evolution process exited ${code}; stopping companion streams`);stopAll();process.exitCode=code||0;});
