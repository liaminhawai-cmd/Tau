'use strict';
const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');
const evo=require('./evolution-roster.js');
const ladderSampling=require('./ladder-sampling.js');
const {loadSeedPoses}=require('./selfplay-legacy.js');
const dir=__dirname;
module.exports={loadSeedPoses};
function getArg(a,n,d=null){const i=a.indexOf('--'+n);return i>=0?a[i+1]:d;}
function setArg(a,n,v){const k='--'+n,i=a.indexOf(k);if(i>=0)a.splice(i,2,k,String(v));else a.push(k,String(v));}
function dropArg(a,n){const i=a.indexOf('--'+n);if(i>=0)a.splice(i,2);}
// Hand the pool over as a FILE once it is big enough to threaten the command line. Windows caps a
// whole command line at 32,767 characters and the pool is one comma-joined argument, so a few
// hundred model paths reach it: measured on the real machine, 522 models died with `spawn
// ENAMETOOLONG` and took the whole self-play batch with them, while 496 squeaked through -- this
// had been running just under the edge, on a population that only grows. selfplay-legacy re-spawns
// its workers with the same list, so the limit was being paid twice over. 8000 characters is a
// deliberately early switch: well clear of the ceiling, and small enough that the common case (a
// handful of paths) still reads as a plain argument in the logs.
const POOL_ARG_MAX = 8000;
function setPool(a, paths){
  const joined = paths.join(',');
  if (joined.length <= POOL_ARG_MAX) { dropArg(a,'modelPoolFile'); setArg(a,'modelPool',joined); return; }
  // Named for the process, not the batch: it must outlive this call (the workers read it) but never
  // outlive the run, and two trainers on one clone must not share one.
  const f = path.join(dir, `.selfplay-pool-${process.pid}.txt`);
  fs.writeFileSync(f, paths.join('\n') + '\n');
  dropArg(a,'modelPool'); setArg(a,'modelPoolFile',f);
  poolFiles.add(f);
  console.log(`[evolution] model pool passed as a file (${paths.length} paths, ${joined.length} chars ` +
              `would exceed the ${POOL_ARG_MAX}-char argv budget) -> ${path.basename(f)}`);
}
// The pool file is scratch, not state: it exists only so the workers can read what argv could not
// carry. Removed on the way out, including on Ctrl-C, so nn/ does not silently collect one per run.
const poolFiles = new Set();
function dropPoolFiles(){ for (const f of poolFiles) { try { fs.unlinkSync(f); } catch (_) {} } poolFiles.clear(); }
process.on('exit', dropPoolFiles);
// Cleanup only -- deliberately no process.exit here. run() registers its own SIGINT/SIGTERM
// handlers to kill the worker, and since this one is registered at module load it fires FIRST;
// exiting from it would pre-empt that kill and orphan the child.
for (const sig of ['SIGINT','SIGTERM']) process.once(sig, dropPoolFiles);
function delArg(a,n){const k='--'+n;for(let i=a.indexOf(k);i>=0;i=a.indexOf(k)){a.splice(i,Math.min(2,a.length-i));}}
function run(args){return new Promise((ok,bad)=>{const ch=spawn(process.execPath,[path.join(dir,'selfplay-legacy.js'),...args],{stdio:'inherit'});['SIGINT','SIGTERM'].forEach(s=>process.once(s,()=>{try{ch.kill(s);}catch(_){}}));ch.on('error',bad);ch.on('exit',c=>c===0?ok():bad(new Error('legacy selfplay exited '+c)));});}
async function main(){
  const original=process.argv.slice(2), hadEloInbox=getArg(original,'eloInbox',null)!==null;
  // Self-play runs at temperature 0 (selfplay-legacy's default; nothing here overrides it), but its
  // games still mix rotating pools, depths and openings, so none of them may enter Elo.
  // Official rating evidence and first coverage now come only from temp-0 arena/calibration games.
  if(hadEloInbox){delArg(original,'eloInbox');console.log('[rating] self-play Elo feed disabled: noisy training games are training-only; official Elo is temp-0 arena play');}
  const games=Math.max(1,+getArg(original,'games',100));
  evo.sync(dir); evo.ingestSummary(dir,require('./machine-id.js').summaryPath(dir));
  // --topN: exploration is a small side stream now, so its seats go to the strongest MEASURED nets
  // rather than the whole roster -- the league is where everyone else gets their games. Unrated
  // faces (no games yet) cannot be "top" and are left to the league to place.
  const topN=Math.max(0,+getArg(original,'topN',10));
  const roster=evo.selfplaySlice(dir), st0=evo.sync(dir);
  const eloOf=p=>{const r=st0.latest[path.basename(p,'.json')];return r&&(+r.games||0)>0&&Number.isFinite(+r.elo)?+r.elo:null;};
  const measured=roster.filter(p=>eloOf(p)!==null).sort((a,b)=>eloOf(b)-eloOf(a));
  const slice=topN&&measured.length>=2?measured.slice(0,topN):roster;
  const profile=evo.selfplayProfile(slice,{dir});
  if(slice!==roster)console.log(`[evolution] self-play seats: top ${slice.length} of ${measured.length} measured nets by Elo `+
    `(${slice.map(p=>path.basename(p,'.json')+'@'+Math.round(eloOf(p))).join(', ')})`);
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

  // The shipped ladder's net rungs (R11-R13) are the opponents every candidate loses to as Red, yet
  // they are not roster faces, so a net met them only in its two gauntlet games. Pin them into the
  // model pool at a guaranteed per-seat share (PINNED_RUNG_SHARE, default 10%) and fixed depth, so
  // training games are played against exactly the opponents the gauntlet asks for.
  const pinnedShare=Math.max(0,Math.min(.4,+(process.env.PINNED_RUNG_SHARE||.1)));
  const pinnedNames=(process.env.PINNED_RUNG_NETS||'resume-691,resume-686,resume-698').split(',').map(s=>s.trim()).filter(Boolean);
  const addPinnedRungs=a=>{
    if(!pinnedShare||!slice.length)return;
    const have=new Set([slice[0],...slice.slice(1)].map(p=>path.basename(p,'.json')));
    const pins=pinnedNames.map(n=>path.join(dir,'models',n+'.json')).filter(f=>fs.existsSync(f)&&!have.has(path.basename(f,'.json')));
    if(!pins.length)return;
    const mass=Object.values(profile.weights||{}).map(Number).filter(x=>Number.isFinite(x)&&x>0).reduce((x,y)=>x+y,0)||1;
    const each=mass*pinnedShare/(1-pinnedShare)/pins.length, w={...profile.weights}, dp={};
    for(const f of pins){const n=path.basename(f,'.json');w[n]=each;dp[n]=2;}
    setPool(a,[...slice.slice(1),...pins]);
    setArg(a,'modelPoolWeights',JSON.stringify(w)); setArg(a,'modelPoolDepths',JSON.stringify(dp));
    console.log(`[evolution] pinned rung nets in training pool: ${pins.map(f=>path.basename(f,'.json')+'@D2').join(', ')} (~${(100*pinnedShare).toFixed(0)}% of seats)`);
  };
  const baseArgs=()=>{
    const a=original.slice();
    if(slice.length){setArg(a,'model',slice[0]);setPool(a,slice.slice(1));}
    setArg(a,'levels',ladder.levels.join(',')); setArg(a,'deep',ladder.levels.join(','));
    // Deliberately overrides run.js's old fixed 60/30/10 split. The wrapper derives the ladder
    // share from live evidence; these games train the network but do not alter official Elo.
    setArg(a,'mix',ladder.mixString);
    setArg(a,'modelPoolWeights',JSON.stringify(profile.weights)); setArg(a,'modelVarietyFrac','1');
    setArg(a,'coverageQueue','[]');
    addPinnedRungs(a);
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
