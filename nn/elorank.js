'use strict';
const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');
const evo=require('./evolution-roster.js');
const medals=require('./publish-medals.js');
const ratingState=require('./rating-state.js');
const proc=require('./proc-tree.js');
const dir=__dirname;
const get=(a,n,d=null)=>{const i=a.indexOf('--'+n);return i>=0?a[i+1]:d;};
const has=(a,n)=>a.includes('--'+n);
let current=null;
function run(file,args){return new Promise((ok,bad)=>{const ch=current=spawn(process.execPath,[path.join(dir,file),...args],{stdio:'inherit'});ch.on('error',bad);ch.on('exit',c=>{current=null;c===0?ok():bad(new Error(`${file} exited ${c}`));});});}
// The rating pass and its arena workers must go down with this process, or a closed console leaves
// them running as the very orphans the lock check above exists to see through.
function dropChild(){if(current){const ch=current;current=null;proc.killTree(ch.pid);}}
// Exit status for a pass that stood down because another writer holds the lock: the league loop
// backs off on it instead of retrying every second.
const WRITER_BUSY=3;
function forward(src,dst,name){const v=get(src,name,null);if(v!=null)dst.push('--'+name,String(v));}
const lockPath=path.join(dir,'.elo-writer.lock');
// Is the process named in the lock file still running? Signal 0 delivers nothing -- it only asks
// the OS whether the pid exists (ESRCH = gone, EPERM = alive but owned by someone else). This is
// the question the lock actually needs to answer. The old code never asked it: killing a trainer
// left its child's lock behind, and the ONLY escape was an age check, so every league window for
// the next TWO HOURS printed "official Elo writer already active" and played zero games. Closing
// a console to restart is the normal way to restart, so the normal way to restart bricked the
// league. An unreadable or pid-less lock owns nothing and is reaped too.
function lockOwnerAlive(){
  let pid;
  try{pid=+JSON.parse(fs.readFileSync(lockPath,'utf8')).pid;}catch(_){return false;}
  if(!Number.isFinite(pid)||pid<=0||pid===process.pid)return false;
  try{process.kill(pid,0);}catch(e){return !!(e&&e.code==='EPERM');}
  // The pid exists -- but Windows hands a dead process's number to the next one within seconds, and
  // a restarting trainer spawns a dozen node processes at once. So "exists" alone can point at an
  // arena worker that inherited a dead writer's pid, and the lock then looks owned for the two-hour
  // age backstop. Only a process still running elorank owns this lock. An UNREADABLE command line
  // stays alive: one skipped pass costs less than two writers.
  const cmd=proc.commandLine(pid);
  return cmd==null||/elorank/i.test(cmd);
}
function takeLock(){
  for(let attempt=0;attempt<3;attempt++){
    try{const fd=fs.openSync(lockPath,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));return fd;}
    catch(e){
      if(!(e&&e.code==='EEXIST'))throw e;
      if(!lockOwnerAlive()){try{fs.unlinkSync(lockPath);}catch(_){}continue;}
      // Owner is alive: a real concurrent writer (a pool-cycle placement, say), so stand down.
      // The age check stays as a backstop for a pid that was recycled by an unrelated process.
      try{if(Date.now()-fs.statSync(lockPath).mtimeMs>2*3600000){fs.unlinkSync(lockPath);continue;}}catch(_){}
      return null;
    }
  }
  return null;
}
function releaseLock(fd){try{if(fd!=null)fs.closeSync(fd);}catch(_){}try{fs.unlinkSync(lockPath);}catch(_){} }
// Ctrl-C and a closed console window should hand the lock back rather than leave the next process
// to reap it. A hard kill still cannot run these -- which is exactly why lockOwnerAlive() exists.
let heldLock=null;
const dropHeldLock=()=>{if(heldLock!=null){const fd=heldLock;heldLock=null;releaseLock(fd);}};
process.on('exit',dropHeldLock);
for(const sig of ['SIGINT','SIGTERM','SIGHUP','SIGBREAK'])
  try{process.on(sig,()=>{dropChild();dropHeldLock();process.exit(130);});}catch(_){}

(async()=>{
  const original=process.argv.slice(2),summary=get(original,'summary',require('./machine-id.js').summaryFile(dir));
  ratingState.ensure(dir);

  if(has(original,'cullOnly')){
    evo.sync(dir);evo.ingestSummary(dir,summary);
    const before=evo.status(dir),c=evo.cull(dir),after=evo.status(dir);
    // Population line every checkpoint, not just on a cull: while the field is over the admission
    // ceiling it is the only number that says whether the league is draining or still stuck.
    const held=after.heldModels?`, ${after.heldModels} model(s) held out of the league`:'';
    if(c.culled.length||c.admitted.length)console.log(`[evolution] checkpoint: ${c.culled.length} culled, ${c.admitted.length} frontier face(s) admitted; bank ${after.gamesSinceCull.toFixed(0)}`);
    else console.log(`[evolution] no rating checkpoint due; bank ${before.gamesSinceCull.toFixed(0)}`);
    console.log(`[evolution] population ${after.population} face(s), ceiling ${after.admitCeiling}, target ${after.targetFaces}${held}`);
    try{medals.main();}catch(e){console.error('[medals] refresh failed:',e.message);}return;
  }

  // Lock FIRST, roster scan second. The scan re-reads and parses every model file in nn/models --
  // 300+ of them, some with millions of weights -- which took ~55s per call on the real machine.
  // Doing that before the lock meant each skipped window burned a minute discovering it had
  // nothing to do; now a stood-down pass costs milliseconds.
  const lock=takeLock();
  if(lock==null){console.log('[rating] official Elo writer already active; skipping this overlapping pass');process.exitCode=WRITER_BUSY;return;}
  heldLock=lock;
  try{
    evo.sync(dir);evo.ingestSummary(dir,summary);
    const faces=evo.activeFaceIds(dir,[1,2,3,4]),levels=evo.activeLadderLevels(dir);
    // The committee seat (committee.js): formed from the current field, immortal until it has met
    // every face once, then released. --noCommittee leaves the seat empty for this pass.
    const cms=has(original,'noCommittee')?[]:require('./committee.js').resolveLeagueCommittees(dir);
    const a=['--faces',faces.join(','),'--levels',levels.join(','),'--summary',summary,
      '--out',get(original,'out',path.join(dir,'elo-results.json')),
      '--games',get(original,'ratingGames','2')];
    for(const n of ['budgetHours','workers','saveData','bootstrap','targetGames','openingPlies'])forward(original,a,n);
    if(has(original,'refit'))a.push('--refit');if(has(original,'dryrun'))a.push('--dryrun');if(cms.length)a.push('--committee');
    const sd=get(original,'saveData',null);
    // L7 and up are rated twice (as themselves and opening with the corner cross, see elorank-legacy)
    const ladderFaces=levels.length+levels.filter(l=>l>=7).length;
    console.log(`[rating] unified field: ${faces.length} live model faces + ${ladderFaces} immortal ladder brains (${levels.length} rungs)${cms.length?` + ${cms.length} committee face(s)`:''}${sd?` -> ${path.basename(sd)}`:''}`);
    await run('elorank-legacy.js',a);
    evo.ingestSummary(dir,summary);

    const c=evo.cull(dir);
    if(c.culled.length||c.admitted.length)console.log(`[evolution] checkpoint: ${c.culled.length} culled, ${c.admitted.length} frontier face(s) admitted`);
    try{medals.main();}catch(e){console.error('[medals] refresh failed:',e.message);}
  } finally { dropHeldLock(); }
})().catch(e=>{console.error('[evolution] unified Elo wrapper failed:',e.stack||e.message);process.exitCode=1;});
