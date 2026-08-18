'use strict';
// The main game factory. Official temp-0 colour-balanced league matches do double duty: every game
// updates Elo/CI AND every position is saved as training data. This loop owns most CPU and restarts
// immediately after each short rating window so new/uncertain faces are continually measured.
const {spawn}=require('child_process');
const os=require('os');
const path=require('path');
const fs=require('fs');
const dir=__dirname;
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;};
const workers=Math.max(1,+arg('workers',Math.max(1,os.cpus().length-4)));
const budgetHours=Math.max(.05,+arg('budgetHours',.25));
const pauseMs=Math.max(250,+arg('pauseMs',1500));
let stopped=false,child=null,serial=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function nextOut(){
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
  return path.join(dir,'data',`league-${stamp}-${String(serial++).padStart(3,'0')}.jsonl`);
}
function one(){return new Promise(resolve=>{
  const out=nextOut();
  const args=[path.join(dir,'elorank.js'),'--budgetHours',String(budgetHours),'--workers',String(workers),
    '--ratingGames','2','--saveData',out];
  console.log(`\n=== official league: ${workers} workers, ${budgetHours}h window; rating + training -> ${path.basename(out)} ===`);
  child=spawn(process.execPath,args,{stdio:'inherit'});
  child.on('error',e=>{console.error('[league] launch failed:',e.message);child=null;resolve();});
  child.on('exit',code=>{if(code)console.error(`[league] rating pass exited ${code}`);child=null;resolve();});
});}
async function main(){
  console.log(`[league] PRIMARY game stream: temp-0, two colours per match, ${workers} workers; all positions train the nets`);
  while(!stopped){await one();if(!stopped)await sleep(pauseMs);}
}
function stop(){stopped=true;if(child)try{child.kill();}catch(_){} }
process.on('SIGINT',()=>{stop();process.exit(0);});
process.on('SIGTERM',()=>{stop();process.exit(0);});
main().catch(e=>{console.error('[league] fatal:',e.stack||e.message);process.exitCode=1;});
