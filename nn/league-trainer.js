'use strict';
// One trainer, three deliberately unequal streams:
//   1) official league: ~80% of CPU, and its rated games are ALSO the main training corpus;
//   2) exploratory self-play: a small stream for seeded/random starts and opponent diversity;
//   3) retromine: one worker hunting adversarial/ratchet positions for training only.
// run.js still owns mutation, GPU training, promotion and compute-aware culling. This file changes
// where game-generation compute goes, not the evolutionary rules.
const {spawn}=require('child_process');
const os=require('os');
const path=require('path');
const dir=__dirname;
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;};
const cores=Math.max(2,os.cpus().length);
const leagueWorkers=Math.max(1,+arg('leagueWorkers',Math.max(4,cores-4)));
const exploreWorkers=Math.max(1,+arg('exploreWorkers',2));
const retroWorkers=Math.max(0,+arg('retroWorkers',1));
const children=[];
let stopping=false;
function start(label,script,args){
  console.log(`\n=== ${label} ===`);
  const ch=spawn(process.execPath,[path.join(dir,script),...args],{stdio:'inherit'});
  children.push(ch);
  ch.on('error',e=>console.error(`[trainer] ${label} failed to launch:`,e.message));
  return ch;
}
function stopAll(){if(stopping)return;stopping=true;for(const ch of children)try{ch.kill();}catch(_){} }
process.on('SIGINT',()=>{stopAll();process.exit(0);});
process.on('SIGTERM',()=>{stopAll();process.exit(0);});

console.log(`[trainer] league-first allocation: ${leagueWorkers} league + ${exploreWorkers} exploration`+
            (retroWorkers?` + ${retroWorkers} retromine`:'')+` worker(s)`);
console.log('[trainer] official league games are both Elo evidence and training data; exploration never contaminates Elo');

start('PRIMARY OFFICIAL LEAGUE','league-loop.js',['--workers',String(leagueWorkers),'--budgetHours','.25']);
if(retroWorkers) start('SMALL RETROMINE STREAM','retroloop.js',
  ['--workers',String(retroWorkers),'--seedsPerJob','1','--maxReplaysPerSeed','80']);

// Keep run.js's mature mutation/training machinery, but make its ordinary self-play a minority
// exploration stream. Its own scheduled placement call gets only a token budget; normally it sees
// the Elo writer lock and exits immediately because league-loop is already the sole rating writer.
// Bench sweeps are effectively disabled here: fixed ladder brains already live in the universal
// league, so a separate expensive sweep is diagnostic duplication rather than useful game supply.
const forwarded=process.argv.slice(2).filter((x,i,a)=>{
  if(['--leagueWorkers','--exploreWorkers','--retroWorkers'].includes(x))return false;
  if(i>0&&['--leagueWorkers','--exploreWorkers','--retroWorkers'].includes(a[i-1]))return false;
  return true;
});
const runArgs=['--workers',String(exploreWorkers),'--poolWorkers',String(exploreWorkers),
  '--poolBudgetHours','0.01','--benchEveryMin','100000','--randomStartFrac','0.25',...forwarded];
const core=start('EVOLUTION + EXPLORATION','run.js',runArgs);
core.on('exit',code=>{console.log(`[trainer] evolution process exited ${code}; stopping companion streams`);stopAll();process.exitCode=code||0;});
