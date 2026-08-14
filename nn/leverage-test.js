'use strict';
// Balanced, multi-core L14 leverage experiment against L11.
// Every child plays an even number of games, so A/B each receive blue equally often.
// Arena logs every child as it goes; per-position rows are retained for later training.
const fs=require('fs');
const path=require('path');
const os=require('os');
const {spawn}=require('child_process');
const {eloFromScore,fmtElo}=require('./elo.js');
const {createEngine}=require('./engine.js');

function arg(name,dflt){const i=process.argv.indexOf('--'+name);return i>=0?process.argv[i+1]:dflt;}
let games=Math.max(4,+arg('games',60)||60);
if(games%2)games++;
const pairJobs=games/2;
const workers=Math.max(1,Math.min(pairJobs,+arg('workers',Math.max(1,Math.min(os.cpus().length-1,8)))||1));
const tag=new Date().toISOString().replace(/[:.]/g,'-');
const logDir=path.join(__dirname,'arena-logs');
const dataDir=path.join(__dirname,'data');
fs.mkdirSync(logDir,{recursive:true});
fs.mkdirSync(dataDir,{recursive:true});

const pairs=Array.from({length:workers},(_,i)=>Math.floor(pairJobs/workers)+(i<pairJobs%workers?1:0));
console.log(`L14 Leverage vs L11: ${games} balanced games, ${workers} workers`);
console.log('Same search/candidates. Only L14 adds centre-side hub attack minus counter-exposure.\n');

function runWorker(i,nPairs){
  return new Promise((resolve,reject)=>{
    const resultPath=path.join(logDir,`leverage-${tag}-w${i+1}.jsonl`);
    const dataPath=path.join(dataDir,`leverage-${tag}-w${i+1}.jsonl`);
    const args=[path.join(__dirname,'arena.js'),'--a','L14','--b','L11','--games',String(nPairs*2),
      '--openingPlies','4','--resultsJsonl',resultPath,'--saveData',dataPath];
    console.log(`[w${i+1}] starting ${nPairs*2} games`);
    const ch=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='';
    ch.stdout.on('data',d=>stdout+=d);
    ch.stderr.on('data',d=>stderr+=d);
    ch.on('error',reject);
    ch.on('exit',code=>{
      if(code!==0)return reject(new Error(`worker ${i+1} exited ${code}: ${stderr.slice(-600)}`));
      console.log(`[w${i+1}] finished`);
      resolve({resultPath,dataPath,stdout});
    });
  });
}

(async()=>{
  const runs=await Promise.all(pairs.map((n,i)=>runWorker(i,n)));
  const rows=[];
  for(const run of runs){
    const text=fs.readFileSync(run.resultPath,'utf8').trim();
    if(text)for(const line of text.split(/\r?\n/))rows.push(JSON.parse(line));
  }
  let a=0,b=0,d=0,ak=0,bk=0,plies=0;
  for(const r of rows){
    plies+=+r.plies||0;
    if(r.outcome==='A'){if(r.adjudicated)ak++;else a++;}
    else if(r.outcome==='B'){if(r.adjudicated)bk++;else b++;}
    else d++;
  }
  const komiLoss=createEngine().CFG.komiLoss;
  const kw=.5+komiLoss/2;
  const sa=a+kw*ak+(1-kw)*bk, sb=b+kw*bk+(1-kw)*ak;
  const e=eloFromScore(sa,sb);
  const verdict=fmtElo(e);
  const summary={
    finished:new Date().toISOString(),brainA:'L14 Leverage',brainB:'L11',games:rows.length,
    outright:{a,b,draws:d},komi:{a:ak,b:bk,weight:komiLoss},
    decidedScore:{a:+sa.toFixed(3),b:+sb.toFixed(3)},
    aPercent:+(100*sa/Math.max(1,sa+sb)).toFixed(1),elo:Math.round(e.elo),
    ci:[Math.round(e.lo),Math.round(e.hi)],verdict:e.verdict,
    avgPlies:+(plies/Math.max(1,rows.length)).toFixed(1),
    resultFiles:runs.map(r=>path.relative(__dirname,r.resultPath)),
    trainingFiles:runs.map(r=>path.relative(__dirname,r.dataPath))
  };
  const summaryPath=path.join(logDir,`leverage-${tag}-summary.json`);
  fs.writeFileSync(summaryPath,JSON.stringify(summary,null,2));
  console.log('\n=== L14 LEVERAGE vs L11 ===');
  console.log(`outright ${a}-${b}${d?`-${d} draws`:''}; komi ${ak}-${bk}`);
  console.log(`L14 score ${summary.aPercent}% of decided; ${verdict}`);
  console.log(`average ${summary.avgPlies} plies; summary -> ${summaryPath}`);
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
