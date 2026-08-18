'use strict';
const path=require('path');
const {spawn}=require('child_process');
const evo=require('./evolution-roster.js');
const medals=require('./publish-medals.js');
const ratingState=require('./rating-state.js');
const dir=__dirname;
const get=(a,n,d=null)=>{const i=a.indexOf('--'+n);return i>=0?a[i+1]:d;};
const has=(a,n)=>a.includes('--'+n);
function run(file,args){return new Promise((ok,bad)=>{const ch=spawn(process.execPath,[path.join(dir,file),...args],{stdio:'inherit'});ch.on('error',bad);ch.on('exit',c=>c===0?ok():bad(new Error(`${file} exited ${c}`)));});}
function forward(src,dst,name){const v=get(src,name,null);if(v!=null)dst.push('--'+name,String(v));}

(async()=>{
  const original=process.argv.slice(2),summary=get(original,'summary',path.join(dir,'elo-summary.json'));
  ratingState.ensure(dir);
  evo.sync(dir);evo.ingestSummary(dir,summary);

  if(has(original,'cullOnly')){
    const before=evo.status(dir),c=evo.cull(dir),after=evo.status(dir);
    if(c.culled.length||c.admitted.length)console.log(`[evolution] checkpoint: ${c.culled.length} culled, ${c.admitted.length} frontier face(s) admitted; bank ${after.gamesSinceCull.toFixed(0)}`);
    else console.log(`[evolution] no rating checkpoint due; bank ${before.gamesSinceCull.toFixed(0)}`);
    try{medals.main();}catch(e){console.error('[medals] refresh failed:',e.message);}return;
  }

  // One field, one scheduler. Depth only changes the cost and the brain itself; it no longer creates
  // a separate rating phase. Ladders enter the exact same player list and get no pairing quota.
  const faces=evo.activeFaceIds(dir,[1,2,3,4]),levels=evo.activeLadderLevels(dir);
  const a=['--faces',faces.join(','),'--levels',levels.join(','),'--summary',summary,
    '--out',get(original,'out',path.join(dir,'elo-results.json')),
    '--games',get(original,'ratingGames','2')];
  for(const n of ['budgetHours','workers','saveData','bootstrap','targetGames','openingPlies'])forward(original,a,n);
  if(has(original,'refit'))a.push('--refit');if(has(original,'dryrun'))a.push('--dryrun');
  console.log(`[rating] unified field: ${faces.length} live model faces + ${levels.length} immortal ladder brains`);
  await run('elorank-legacy.js',a);
  evo.ingestSummary(dir,summary);

  const c=evo.cull(dir);
  if(c.culled.length||c.admitted.length)console.log(`[evolution] checkpoint: ${c.culled.length} culled, ${c.admitted.length} frontier face(s) admitted`);
  try{medals.main();}catch(e){console.error('[medals] refresh failed:',e.message);}
})().catch(e=>{console.error('[evolution] unified Elo wrapper failed:',e.stack||e.message);process.exitCode=1;});
