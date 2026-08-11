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
  const d3Pool=evo.d3Slice(dir), d3Games=d3Pool.length?Math.floor(games*evo.D3_SHARE):0, baseGames=Math.max(1,games-d3Games);
  const st=evo.status(dir);
  console.log(`[evolution] self-play roster ${st.models} nets + ${st.ladders} ladder; rotating ${slice.length}; `+
              `D3 earned ${d3Pool.length} (rankLo above population median${Number.isFinite(st.median)?' '+st.median.toFixed(2):''})`);
  const base=original.slice();
  if(slice.length){setArg(base,'model',slice[0]);setArg(base,'modelPool',slice.slice(1).join(','));}
  setArg(base,'games',baseGames); setArg(base,'levels',levels.join(',')); setArg(base,'deep',levels.slice(-Math.min(5,levels.length)).join(','));
  setArg(base,'nnDepthMix','1:1,2:0.278'); setArg(base,'modelPoolWeights',JSON.stringify(profile.weights));
  setArg(base,'coverageQueue',JSON.stringify(profile.coverage.filter(x=>!x.depth||x.depth<=2))); setArg(base,'modelVarietyFrac','1');
  await run(base);
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
