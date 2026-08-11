'use strict';
const path=require('path');
const {spawn}=require('child_process');
const evo=require('./evolution-roster.js');
const dir=__dirname;
function getArg(a,n,d=null){const i=a.indexOf('--'+n);return i>=0?a[i+1]:d;}
function setArg(a,n,v){const k='--'+n,i=a.indexOf(k);if(i>=0)a.splice(i,2,k,String(v));else a.push(k,String(v));}
function run(args){return new Promise((ok,bad)=>{const ch=spawn(process.execPath,[path.join(dir,'selfplay-legacy.js'),...args],{stdio:'inherit'});['SIGINT','SIGTERM'].forEach(s=>process.once(s,()=>{try{ch.kill(s);}catch(_){}}));ch.on('error',bad);ch.on('exit',c=>c===0?ok():bad(new Error('legacy selfplay exited '+c)));});}
(async()=>{
  const original=process.argv.slice(2), games=Math.max(1,+getArg(original,'games',100));
  evo.sync(dir); evo.ingestSummary(dir,path.join(dir,'elo-summary.json'));
  const slice=evo.selfplaySlice(dir), levels=evo.activeLadderLevels(dir), profile=evo.selfplayProfile(slice,{dir});
  const d3Pool=evo.d3Slice(dir), d3Games=d3Pool.length?Math.floor(games*evo.D3_SHARE):0, baseGames=Math.max(0,games-d3Games);
  const st=evo.status(dir);
  console.log(`[evolution] self-play roster ${st.models} nets + ${st.ladders} ladder; rotating ${slice.length}; `+
              `D3 earned ${d3Pool.length} (rankLo above population median${Number.isFinite(st.median)?' '+st.median.toFixed(2):''})`);

  const baseArgs=()=>{
    const a=original.slice();
    if(slice.length){setArg(a,'model',slice[0]);setArg(a,'modelPool',slice.slice(1).join(','));}
    setArg(a,'levels',levels.join(',')); setArg(a,'deep',levels.slice(-Math.min(5,levels.length)).join(','));
    setArg(a,'modelPoolWeights',JSON.stringify(profile.weights)); setArg(a,'modelVarietyFrac','1');
    return a;
  };

  // First coverage is depth-specific. The old worker knew which MODEL/FACE was forced but still
  // rolled D1/D2 randomly, so a queued "cover D2" game could come back as yet another D1 and leave
  // the zero untouched. Run the missing D1 and D2 seats in tiny forced-depth phases first; two
  // coverage entries share one game, exactly as the worker already reserves A/B entries.
  let remaining=baseGames;
  for(const depth of [1,2]){
    const queue=profile.coverage.filter(x=>x.depth===depth);
    if(!queue.length||remaining<=0) continue;
    const n=Math.min(remaining,Math.ceil(queue.length/2));
    const a=baseArgs(); setArg(a,'games',n); setArg(a,'nnDepthMix',`${depth}:1`);
    setArg(a,'coverageQueue',JSON.stringify(queue.slice(0,n*2)));
    console.log(`[evolution] first coverage D${depth}: ${Math.min(queue.length,n*2)} face(s) in ${n} forced-depth game(s)`);
    await run(a); remaining-=n;
  }
  if(remaining>0){
    const a=baseArgs(); setArg(a,'games',remaining); setArg(a,'nnDepthMix','1:1,2:0.278');
    setArg(a,'coverageQueue','[]'); await run(a);
  }

  if(d3Games>0){
    const d3=original.slice(), p=evo.selfplayProfile(d3Pool,{dir});
    setArg(d3,'games',d3Games); setArg(d3,'model',d3Pool[0]); setArg(d3,'modelPool',d3Pool.slice(1).join(','));
    setArg(d3,'levels',levels.join(',')); setArg(d3,'deep',levels.slice(-Math.min(5,levels.length)).join(','));
    setArg(d3,'nnDepthMix','3:1'); setArg(d3,'modelPoolWeights',JSON.stringify(p.weights));
    setArg(d3,'coverageQueue',JSON.stringify(p.coverage.filter(x=>x.depth===3))); setArg(d3,'modelVarietyFrac','1');
    console.log(`[evolution] earned-D3 phase ${d3Games}/${games} games across ${d3Pool.length} nets`);
    await run(d3);
  }
})().catch(e=>{console.error('[evolution] selfplay wrapper failed:',e.message);process.exitCode=1;});
