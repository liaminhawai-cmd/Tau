'use strict';
const path=require('path');
const {spawn}=require('child_process');
const evo=require('./evolution-roster.js');
const ladderSampling=require('./ladder-sampling.js');
const {loadSeedPoses}=require('./selfplay-legacy.js');
const dir=__dirname;
module.exports={loadSeedPoses};
function getArg(a,n,d=null){const i=a.indexOf('--'+n);return i>=0?a[i+1]:d;}
function setArg(a,n,v){const k='--'+n,i=a.indexOf(k);if(i>=0)a.splice(i,2,k,String(v));else a.push(k,String(v));}
function delArg(a,n){const k='--'+n;for(let i=a.indexOf(k);i>=0;i=a.indexOf(k)){a.splice(i,Math.min(2,a.length-i));}}
function run(args){return new Promise((ok,bad)=>{const ch=spawn(process.execPath,[path.join(dir,'selfplay-legacy.js'),...args],{stdio:'inherit'});['SIGINT','SIGTERM'].forEach(s=>process.once(s,()=>{try{ch.kill(s);}catch(_){}}));ch.on('error',bad);ch.on('exit',c=>c===0?ok():bad(new Error('legacy selfplay exited '+c)));});}
async function main(){
  const original=process.argv.slice(2), hadEloInbox=getArg(original,'eloInbox',null)!==null;
  // Self-play uses exploration temperature for TRAINING diversity. That is a different brain from
  // the temp-0 face the official ladder claims to rate, so none of these games may enter Elo.
  // Official rating evidence and first coverage now come only from temp-0 arena/calibration games.
  if(hadEloInbox){delArg(original,'eloInbox');console.log('[rating] self-play Elo feed disabled: noisy training games are training-only; official Elo is temp-0 arena play');}
  const games=Math.max(1,+getArg(original,'games',100));
  evo.sync(dir); evo.ingestSummary(dir,path.join(dir,'elo-summary.json'));
  const slice=evo.selfplaySlice(dir), profile=evo.selfplayProfile(slice,{dir});
  // The model draw keeps evolution-roster's existing strength+need equation. Ladder rungs are a
  // separate permanent reference class used to keep the training distribution from becoming wholly
  // self-referential. Their training share is independent of official Elo evidence now.
  const ladder=ladderSampling.trainerProfile(dir,profile.weights,{top:3});
  const d3Pool=evo.d3Slice(dir), d3Games=d3Pool.length?Math.floor(games*evo.D3_SHARE):0, baseGames=Math.max(0,games-d3Games);
  const st=evo.status(dir);
  console.log(`[evolution] self-play roster ${st.models} nets + ${st.ladders} ladder; rotating ${slice.length}; `+
              `D3 earned ${d3Pool.length} (rankLo above population median${Number.isFinite(st.median)?' '+st.median.toFixed(2):''})`);
  console.log(`[evolution] fixed-rung training reference: top ${[...new Set(ladder.levels)].map(x=>'L'+x).join(', ')}; `+
              `seat share ${(100*ladder.seatShare).toFixed(1)}%; game mix ${ladder.mixString}`);
  if(profile.coverage.length)console.log(`[rating] ${profile.coverage.length} Elo-zero face(s) left to the official temp-0 arena scheduler; self-play will not fake coverage`);

  const baseArgs=()=>{
    const a=original.slice();
    if(slice.length){setArg(a,'model',slice[0]);setArg(a,'modelPool',slice.slice(1).join(','));}
    setArg(a,'levels',ladder.levels.join(',')); setArg(a,'deep',ladder.levels.join(','));
    // Deliberately overrides run.js's old fixed 60/30/10 split. The wrapper derives the ladder
    // share from live evidence; these games train the network but do not alter official Elo.
    setArg(a,'mix',ladder.mixString);
    setArg(a,'modelPoolWeights',JSON.stringify(profile.weights)); setArg(a,'modelVarietyFrac','1');
    setArg(a,'coverageQueue','[]');
    return a;
  };

  // Rating-specific first coverage used to run here. That made sense only while self-play results
  // were allowed into Elo. With clean semantics, forcing a D1/D2 face here would spend training
  // compute without reducing its official zero, so all base games stay ordinary training games and
  // elorank-legacy owns first coverage at temperature 0.
  if(baseGames>0){
    const a=baseArgs(); setArg(a,'games',baseGames); setArg(a,'nnDepthMix','1:1,2:0.278');
    await run(a);
  }

  if(d3Games>0){
    const d3=original.slice(), p=evo.selfplayProfile(d3Pool,{dir}), dl=ladderSampling.trainerProfile(dir,p.weights,{top:3});
    delArg(d3,'eloInbox');
    setArg(d3,'games',d3Games); setArg(d3,'model',d3Pool[0]); setArg(d3,'modelPool',d3Pool.slice(1).join(','));
    setArg(d3,'levels',dl.levels.join(',')); setArg(d3,'deep',dl.levels.join(',')); setArg(d3,'mix',dl.mixString);
    setArg(d3,'nnDepthMix','3:1'); setArg(d3,'modelPoolWeights',JSON.stringify(p.weights));
    setArg(d3,'coverageQueue','[]'); setArg(d3,'modelVarietyFrac','1');
    console.log(`[evolution] earned-D3 training phase ${d3Games}/${games} games across ${d3Pool.length} nets; `+
                `fixed-rung seat share ${(100*dl.seatShare).toFixed(1)}%`);
    await run(d3);
  }
}
if(require.main===module) main().catch(e=>{console.error('[evolution] selfplay wrapper failed:',e.message);process.exitCode=1;});
