'use strict';
// The main game factory. Official temp-0 colour-balanced league matches do double duty: every game
// updates Elo/CI AND every position is saved as training data. This loop owns most CPU and restarts
// immediately after each short rating window so new/uncertain faces are continually measured.
const {spawn}=require('child_process');
const os=require('os');
const path=require('path');
const proc=require('./proc-tree.js');
const dir=__dirname;
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;};
const workers=Math.max(1,+arg('workers',Math.max(1,os.cpus().length-4)));
const budgetHours=Math.max(.05,+arg('budgetHours',.25));
const pauseMs=Math.max(250,+arg('pauseMs',1500));
// When another rating pass holds the writer lock, elorank exits WRITER_BUSY within a second. Retrying
// every 1.5s then meant two thousand "skipping this overlapping pass" lines in an hour and a log no
// one could read past; a window lasts a quarter hour, so half a minute between retries loses nothing.
const busyPauseMs=Math.max(1000,+arg('busyPauseMs',30000));
const WRITER_BUSY=3;
let stopped=false,child=null,serial=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function nextOut(){
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
  return path.join(dir,'data',`league-${stamp}-${String(serial++).padStart(3,'0')}.jsonl`);
}
function one(quiet){return new Promise(resolve=>{
  const out=nextOut();
  const args=[path.join(dir,'elorank.js'),'--budgetHours',String(budgetHours),'--workers',String(workers),
    '--ratingGames','2','--saveData',out];
  if(!quiet)console.log(`\n=== official league: ${workers} workers, ${budgetHours}h window; rating + training -> ${path.basename(out)} ===`);
  child=spawn(process.execPath,args,{stdio:'inherit'});
  child.on('error',e=>{console.error('[league] launch failed:',e.message);child=null;resolve(null);});
  child.on('exit',code=>{if(code&&code!==WRITER_BUSY)console.error(`[league] rating pass exited ${code}`);child=null;resolve(code);});
});}
async function main(){
  console.log(`[league] PRIMARY game stream: temp-0, two colours per match, ${workers} workers; all positions train the nets`);
  let busy=0;
  while(!stopped){
    const code=await one(busy>0);
    if(stopped)break;
    if(code===WRITER_BUSY){
      if(++busy===1)console.log(`[league] Elo writer busy elsewhere; retrying every ${Math.round(busyPauseMs/1000)}s until it frees up`);
      await sleep(busyPauseMs);
    }else{
      if(busy)console.log(`[league] Elo writer free again after ${busy} stand-down(s)`);
      busy=0;await sleep(pauseMs);
    }
  }
}
// The pass AND its arena workers: killing only the direct child is how a closed window left a ghost
// league running. SIGHUP is what a closed console sends on Windows.
function stop(){stopped=true;if(child)proc.killTree(child.pid);}
for(const sig of ['SIGINT','SIGTERM','SIGHUP','SIGBREAK'])try{process.on(sig,()=>{stop();process.exit(0);});}catch(_){}
main().catch(e=>{console.error('[league] fatal:',e.stack||e.message);process.exitCode=1;});
