'use strict';
const fs=require('fs');
const path=require('path');

// One open evolutionary population of search faces. Elo decides strength; search depth only changes
// compute cost / cull pressure. The fixed L-brains are not in these face pools, so they are immortal
// by construction and receive no other privilege.
const TARGET_FACES=50;
const TARGET_MODELS=TARGET_FACES;
// Admission ceiling. The cull can only retire a face it has MEASURED (FACE_MIN_GAMES below), so a
// population far past this point starves every face at once: games spread too thin for anything to
// become eligible, nothing eligible means nothing culled, and the field ratchets up forever. Four
// times target leaves plenty of room for an open league to breathe while keeping every face inside
// reach of a real interval.
const ADMIT_CEILING=TARGET_FACES*4;
const FACE_CAPS=Object.freeze({D1:50,D2:14,D3:4,D4:1}); // compatibility export only; never enforced
const FACE_MIN_GAMES=Object.freeze({D1:12,D2:8,D3:5,D4:2});
const DEPTH_CULL_WEIGHT=Object.freeze({D1:1,D2:3,D3:9,D4:27});
const CULL_EVERY_GAMES=100;
// An experiment arm -- a member of the mutant or dual population -- is admitted at D1 like any file
// and then, with the field over TARGET_FACES, was cull-eligible after cullMinGames (7 at D1 with 90
// faces) and culled on eloHi: a tiny from-scratch net loses its first handful of games, sorts to
// the bottom, and is gone before the population that spawned it has a rating to judge it by. The
// populations' own retirement needs 15 games (mutantRetireGames) and only sees LIVE faces, so a
// culled arm never retires either: its slot stays occupied by a ghost, "population full" forever,
// and no new mutant is bred. Members keep their seat until they have this many games; after that
// they are ordinary faces, and the population retires or the cull takes them on real evidence.
const PROTECT_GAMES=15;
const POPULATION_FILES=['.mutant-pop.json','.dual-pop.json'];
function protectedModels(dir){const out=new Set();for(const f of POPULATION_FILES){try{const p=JSON.parse(fs.readFileSync(path.join(dir,'models',f),'utf8'));for(const m of (p&&p.active)||[])if(m&&m.file)out.add(path.basename(String(m.file),'.json'));}catch(_){}}return out;}
const ELO_TEMP=400;
const D3_SHARE=.04;
const ALIASES=new Set(['best.json','value.json','scratch.json','wide.json','ultra.json','deep.json','l15_value.json','policy-joint-base.json']);
const statePath=dir=>path.join(dir,'models','.evolution-roster.json');
const d3SummaryPath=dir=>path.join(dir,'.evolution-d3-summary.json');
const d4SummaryPath=dir=>path.join(dir,'.evolution-d4-summary.json');
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;};
const {atomicWrite}=require('./atomic-write.js');
const atomic=(p,s)=>atomicWrite(p,s);
const depthKey=d=>`D${d}`;
const emptyPool=()=>({active:[],trial:null,waiting:[],retired:{},deferred:{}});

function loadState(dir){let s=null;try{s=JSON.parse(fs.readFileSync(statePath(dir),'utf8'));}catch(_){}if(!s||s.version!==1)s={version:1,active:{},retired:{},latest:{},ladderActive:null,ladderGames:{},ladderRatings:{},evidenceSeen:{},gamesSinceCull:0,birthSerial:1,lastEvent:null,facePools:null};s.active||={};s.retired||={};s.latest||={};s.ladderGames||={};s.ladderRatings||={};s.evidenceSeen||={};s.gamesSinceCull=+s.gamesSinceCull||0;return s;}
function saveState(dir,s){atomic(statePath(dir),JSON.stringify(s,null,1));}
function modelMeta(p){try{const j=JSON.parse(fs.readFileSync(p,'utf8'));if(j&&j.committee===true)return{usable:true,committee:true,dual:false,policy:false,shape:'committee'};if(j&&j.policyEntrant===true){const v=path.join(path.dirname(p),j.valueFile||''),q=path.join(path.dirname(p),j.policyFile||'');if(fs.existsSync(v)&&fs.existsSync(q))return{usable:true,dual:false,policy:true,shape:j.shape||null};}if(j&&j.dual===true)return{usable:true,dual:true,policy:false,shape:Array.isArray(j.sizes)?j.sizes.slice(1,-1).join(','):null};if(j&&Array.isArray(j.sizes)&&j.sizes.length>=3&&+j.sizes.at(-1)===1)return{usable:true,dual:false,policy:false,shape:j.sizes.slice(1,-1).join(',')};}catch(_){}return{usable:false,dual:false,policy:false,shape:null};}
function stableModelEntries(dir){const md=path.join(dir,'models');let files=[];try{files=fs.readdirSync(md);}catch(_){return[];}const out=[];for(const f of files){if(!f.endsWith('.json')||ALIASES.has(f)||/^pool-slot-\d+\.json$/.test(f)||/^best\.pre-pool-/.test(f)||/^dual-startup-probe-/.test(f)||/\.partial\.json$/.test(f))continue;const p=path.join(md,f),m=modelMeta(p);if(m.usable)out.push({name:path.basename(f,'.json'),file:f,path:p,dual:m.dual,policy:m.policy,committee:!!m.committee,shape:m.shape});}return out;}
// The league's immortal ladder set starts at L6: L1-L5 sit 1000-2000 Elo below every net, so
// their games are foregone conclusions that cost seats and anchor nothing (Liam, 2026-09-11).
// They stay in the game and in self-play's low rungs; they just are not rated players.
const LEAGUE_MIN_LEVEL=6;
// Only the TOP few rungs hold an immortal league seat. The ladder is the external yardstick that
// stops the nets from escalating a shared style, and for that job the rungs the field is actually
// near are the whole value: every net now beats L6-L8 comfortably, so those matches are foregone
// conclusions that cost a seat each and anchor nothing. The lower rungs stay in the GAME and in
// self-play's training mix -- they simply stop being rated players.
const LEAGUE_TOP_RUNGS=Math.max(1,+(process.env.TAU_LEAGUE_RUNGS||5));
function productionLadderLevels(ladderN=null){try{const d=require('./engine.js').createEngine().AI_LADDER,n=ladderN==null?d.length:Math.min(ladderN,d.length);return d.slice(0,n).map((x,i)=>x&&!x.experimental?i+1:null).filter(Boolean);}catch(_){const n=ladderN==null?11:ladderN;return Array.from({length:n},(_,i)=>i+1);}}
function faceId(name,depth,policy=false){return`${name}${policy?'+P':''}@D${depth}`;}
function splitFaceId(id){const m=String(id).match(/^(.*?)(\+P)?@D([1-4])$/);return m?{name:m[1],policy:!!m[2],depth:+m[3],key:`D${m[3]}${m[2]?'+P':''}`}:null;}
function candidateFaces(e,d){if(e.committee)return d===1?[faceId(e.name,1,false)]:[];/* a committee's members search at their own depth; D1 is its one roster seat */if(e.policy&&d===1)return[];const a=[faceId(e.name,d,false)];if(e.dual)a.push(faceId(e.name,d,true));return a;}
function ensurePools(s){s.facePools||={};for(let d=1;d<=4;d++)s.facePools[depthKey(d)]||=emptyPool();}
function poolIds(p){return[...(p.active||[]),...(p.trial?[p.trial]:[])];}
function activeFaceSet(s){const q=new Set();for(let d=1;d<=4;d++)for(const id of poolIds(s.facePools[depthKey(d)]))q.add(id);return q;}
function elasticRetired(p,id){return !!(p&&p.retired&&p.retired[id]&&p.retired[id].reason==='elastic cull');}
function faceReading(s,id){const x=splitFaceId(id);return x?s.latest[x.name]?.faces?.[x.key]||null:null;}
function faceEstablished(s,id,d){const r=faceReading(s,id);return !!(r&&(+r.games||0)>=FACE_MIN_GAMES[depthKey(d)]&&Number.isFinite(+r.eloHi));}
function modelScore(s,name){const r=s.latest[name]||{},v=[];if(Number.isFinite(+r.eloHi))v.push(+r.eloHi);for(const f of Object.values(r.faces||{}))if(Number.isFinite(+f.eloHi))v.push(+f.eloHi);if(v.length)return Math.max(...v);const q=[];if(Number.isFinite(+r.elo))q.push(+r.elo);for(const f of Object.values(r.faces||{}))if(Number.isFinite(+f.elo))q.push(+f.elo);return q.length?Math.max(...q):-Infinity;}
function modelSerial(name){const m=String(name).match(/(\d+)(?!.*\d)/);return m?+m[1]:-1;}

function reconcile(s,entries,protect=new Set()){ensurePools(s);const available={};for(let d=1;d<=4;d++)available[depthKey(d)]=new Set(entries.flatMap(e=>candidateFaces(e,d)));
  for(let d=1;d<=4;d++){const k=depthKey(d),p=s.facePools[k],avail=available[k];p.retired=p.retired||{};p.active=[...new Set((p.active||[]).filter(id=>avail.has(id)&&!elasticRetired(p,id)))];p.trial=null;p.waiting=[];p.deferred={};for(const id of Object.keys(p.retired))if(!avail.has(id))delete p.retired[id];}
  // The mint. Every usable model file no pool has seen becomes a D1 face here -- that is how a fresh
  // clone bootstraps a population, and it is also how the desktop field reached 1067 faces on 2170
  // games. A pool cycle writes roughly three new model files an hour; each was admitted on the very
  // next sync and each then owed FACE_MIN_GAMES before it could ever be cullable. Arena throughput
  // could not keep up, so no face became eligible, so the cull retired 0-3 where expectedCulls asked
  // for 128, so the population only climbed -- and with games spread over 1067 faces no medal, no
  // best.json promotion and no ladder rung could be measured either. Admission now stops dead at
  // ADMIT_CEILING and resumes a seat at a time as culls make room, so the league drains toward
  // TARGET_FACES by itself rather than starving every face at once. Held-back files are not lost:
  // they sit on disk and take the next free seat. Order is strongest first, then newest, so when a
  // seat opens the freshest checkpoint claims it instead of whichever name readdir reached first.
  const live=activeFaceSet(s),rank=n=>{const v=modelScore(s,n);return Number.isFinite(v)?v:-1e9;},pending=[];
  // Population members (the mutant and dual rosters run.js is waiting to rate) always hold a seat.
  // The cull now spares them until PROTECT_GAMES, but every member culled BEFORE that protection
  // landed stayed culled for good: an elastic-retired face counted as "known", so the model was
  // never pending again, and the population loop sat on "training none, a slot opens when a member
  // is retired as confidently weak" for weeks with not one member in the rated field. Reinstate
  // their retired faces and give each member its D1 seat, ceiling or not -- these six-and-six are
  // the whole point of the league, and the elastic cull drains the rest toward TARGET_FACES anyway.
  for(const e of entries){if(!protect.has(e.name))continue;let seated=false;for(let d=1;d<=4;d++){const p=s.facePools[depthKey(d)];for(const id of candidateFaces(e,d)){if(elasticRetired(p,id))delete p.retired[id];if((p.active||[]).includes(id))seated=true;}}
    if(!seated)for(let d=1;d<=4;d++){const ids=candidateFaces(e,d);if(!ids.length)continue;for(const id of ids){s.facePools[depthKey(d)].active.push(id);live.add(id);}break;}}
  for(const e of entries){let known=false;for(let d=1;d<=4&&!known;d++)for(const id of candidateFaces(e,d))if(live.has(id)||elasticRetired(s.facePools[depthKey(d)],id)){known=true;break;}if(!known)pending.push(e);}
  pending.sort((a,b)=>rank(b.name)-rank(a.name)||modelSerial(b.name)-modelSerial(a.name)||a.name.localeCompare(b.name));
  let admitted=0;for(const e of pending){if(live.size>=ADMIT_CEILING)break;for(let d=1;d<=4;d++){const ids=candidateFaces(e,d);if(!ids.length)continue;for(const id of ids){s.facePools[depthKey(d)].active.push(id);live.add(id);}admitted++;break;}}
  s.queueCompaction={version:4,updated:new Date().toISOString(),catalogueModels:entries.length,queueModels:entries.length,deferredFaces:0,heldModels:pending.length-admitted,admitCeiling:ADMIT_CEILING,population:live.size,mode:'open Elo league'};
}
// Promotion is won by strength PER UNIT COMPUTE, not by raw strength. Matchmaking and cull pressure
// have both priced measured rent since the compute-rent bundle, but the frontier queue never did --
// it sorted on eloHi alone, so a policy head that reached a rating by pruning hard ranked exactly
// level with one that got there by burning the full depth price. That is the one place where the
// saving should actually buy something, because the thing being handed out IS compute.
//
// The discount is dimensionless on purpose: a face's measured ms is divided by what its CURRENT
// depth implies it should cost, so this scores how well the brain prunes rather than how deep it
// already sits -- otherwise every shallow face would outrank every deep one and the frontier would
// never climb. Pruning carries to the next rung, so a brain running at half its depth's expected
// cost is the one that can actually afford the ply it is asking for.
//
// 50 Elo per doubling is the exchange rate: at ~3.6x per ply that prices a rung at about 90 Elo,
// roughly the spacing between adjacent ladder brains (L9 125, L10 72, L11 -21). So a face must be
// about one ladder rung stronger to justify paying a ply's worth of extra compute, and a face that
// prunes to half cost gets 50 Elo of priority for the saving.
const PROMOTE_RENT_ELO=50;
function pruneEfficiency(e,prev,mc){const ids=candidateFaces(e,prev),unit=(mc&&mc.unit)||1500,cost=(mc&&mc.cost)||{};const ms=ids.map(id=>+cost[id]).filter(x=>Number.isFinite(x)&&x>0);if(!ms.length)return 1;const implied=DEPTH_CULL_WEIGHT[depthKey(prev)]*unit;return Math.max(1e-6,(ms.reduce((a,x)=>a+x,0)/ms.length)/Math.max(1e-9,implied));}
function promoteScore(s,e,prev,mc){const v=modelScore(s,e.name);return Number.isFinite(v)?v-PROMOTE_RENT_ELO*Math.log2(pruneEfficiency(e,prev,mc)):v;}
function nextFrontier(s,entries,mc){const q=[];for(const e of entries){let highest=0;for(let d=1;d<=4;d++){const p=s.facePools[depthKey(d)],ids=candidateFaces(e,d);if(ids.some(id=>(p.active||[]).includes(id)||elasticRetired(p,id)||!!faceReading(s,id)))highest=d;}if(highest>=4)continue;const prev=Math.max(1,highest),prevIds=candidateFaces(e,prev);if(prevIds.length&&!prevIds.some(id=>faceEstablished(s,id,prev)))continue;for(let d=highest+1;d<=4;d++){const ids=candidateFaces(e,d);if(!ids.length)continue;const fresh=ids.filter(id=>!s.facePools[depthKey(d)].active.includes(id)&&!elasticRetired(s.facePools[depthKey(d)],id));if(fresh.length)q.push({e,depth:d,ids:fresh,score:promoteScore(s,e,prev,mc),serial:modelSerial(e.name)});break;}}
  return q;}
// Climbing a rung is a per-face ROLL, not a quota. The old frontier sorted every candidate and
// advanced exactly q[0] -- one face per checkpoint for the whole field, winner-takes-all. That is
// the only seat list left in the league, and it is what emptied D3/D4: holding the compute-
// proportional spread needs about 11 promotions a checkpoint (5.9 into D2, 3.7 into D3, 1.8 into
// D4) and the quota allowed one, shared across every rung and every model.
//
// So each established candidate now rolls independently, weighted against the best candidate in
// the field on the same softmax the self-play profile uses. Strength still decides -- a face 400
// Elo off the lead climbs at ~37% of the leader's rate, 800 off at ~14% -- but it decides as
// pressure rather than as a cutoff, so a good face no longer has to be THE best in the entire
// league on the exact checkpoint it happens to be eligible.
//
// Rung selectivity is deliberately NOT graded steeper for deeper rungs. That was the obvious way
// to read "only the top slice earns D3", but simulated it comes out backwards: the cull already
// thins the top (per-face hazard runs 3.7% at D1, 13.5% at D2, 48.7% at D3), so tightening
// promotion on top of that just starves rungs the cull is draining anyway -- graded temps measured
// 1.8 D3 seats against 2.3 for a flat one. The thinning is the cull's job; promotion only has to
// pick well.
//
// 0.15 is the rate the spread falls out of: measured 59 / 17 / 2.3 / 0.1 against the 50 / 14 / 4 / 1
// the never-enforced FACE_CAPS always described, at about 154 D1-games of rent per checkpoint --
// cheaper than the 214 the nominal spread would cost, because the cull prices the deep seats.
const PROMOTE_P=.15;
function admitFrontier(s,entries,mc){const q=nextFrontier(s,entries,mc);if(!q.length)return[];
  let best=-Infinity;for(const c of q)if(Number.isFinite(c.score)&&c.score>best)best=c.score;
  if(!Number.isFinite(best))return[];
  const out=[];
  for(const c of q){if(!Number.isFinite(c.score))continue;
    if(Math.random()>=PROMOTE_P*Math.exp((c.score-best)/ELO_TEMP))continue;
    for(const id of c.ids)s.facePools[depthKey(c.depth)].active.push(id);
    out.push(...c.ids);}
  return out;}
function sync(dir,ladderN=null){const s=loadState(dir),entries=stableModelEntries(dir),present=new Set(entries.map(e=>e.name));for(const e of entries){s.active[e.name]={file:e.file,dual:e.dual,policy:e.policy,...(e.committee?{committee:true}:{}),shape:e.shape};delete s.retired[e.name];}for(const n of Object.keys(s.active))if(!present.has(n))delete s.active[n];reconcile(s,entries,protectedModels(dir));const prod=productionLadderLevels(ladderN).filter(l=>l>=LEAGUE_MIN_LEVEL).slice(-LEAGUE_TOP_RUNGS),allowed=new Set(prod);if(!Array.isArray(s.ladderActive))s.ladderActive=prod;// Union, not just filter: a rung added to the game (Corner L12) has to enter an EXISTING state's league, or it is never rated -- the filter alone only ever let rungs leave.
s.ladderActive=[...new Set([...s.ladderActive.filter(x=>allowed.has(x)),...prod])].sort((a,b)=>a-b);saveState(dir,s);return s;}
function readSummary(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return{players:{}};}}
function ingestSummary(dir,file){const s=sync(dir),sum=readSummary(file),groups={},ladder={};for(const [id,r] of Object.entries(sum.players||{})){if(r.kind==='ladder'){if(r.corner)continue;/* the rung's own rating keys the ladder tables; its corner-opening face is rated separately and must not clobber it */ladder[r.level]={games:+r.games||0,elo:Number.isFinite(+r.elo)?+r.elo:null};continue;}if((r.kind!=='nn'&&r.kind!=='committee')||!r.model)continue;const name=path.basename(r.model,'.json');(groups[name]||=[]).push({...r,id});}
  let delta=0;for(const [name,rows] of Object.entries(groups)){const rec=s.latest[name]||{},faces={...(rec.faces||{})},depthGames={...(rec.depthGames||{})},depthElo={...(rec.depthElo||{})};for(const d of [1,2,3,4]){const at=rows.filter(r=>+r.depth===d);depthGames[d]=Math.max(depthGames[d]||0,at.reduce((a,r)=>a+(+r.games||0),0));const es=at.map(r=>+r.elo).filter(Number.isFinite);if(es.length)depthElo[d]=mean(es);}
    for(const r of rows){if(!Number.isFinite(+r.depth)||!Number.isFinite(+r.elo))continue;const k=`D${r.depth}${r.dualPolicy?'+P':''}`,old=faces[k]||{};faces[k]={elo:+r.elo,eloLo:Number.isFinite(+r.eloLo)?+r.eloLo:old.eloLo,eloHi:Number.isFinite(+r.eloHi)?+r.eloHi:old.eloHi,games:Math.max(+old.games||0,+r.games||0),updated:sum.updated||new Date().toISOString()};}
    const base=rows.filter(r=>r.depth===1||r.depth===2),use=base.length?base:rows,allGames=rows.reduce((a,r)=>a+(+r.games||0),0);const eloLo=mean(use.map(r=>+r.eloLo)),eloHi=mean(use.map(r=>+r.eloHi));s.latest[name]={elo:mean(use.map(r=>+r.elo)),eloLo,eloHi,games:Math.max(+rec.games||0,allGames),depthGames,depthElo,faces,updated:sum.updated||new Date().toISOString()};const prev=+s.evidenceSeen[name]||0;if(allGames>prev)delta+=allGames-prev;s.evidenceSeen[name]=Math.max(prev,allGames);}
  for(const [lvl,r] of Object.entries(ladder)){const g=+r.games||0,prev=+s.ladderGames[lvl]||0;if(g>prev)delta+=g-prev;s.ladderGames[lvl]=Math.max(prev,g);const old=s.ladderRatings[lvl]||{};s.ladderRatings[lvl]={elo:Number.isFinite(r.elo)?r.elo:old.elo,games:Math.max(+old.games||0,g),updated:sum.updated||new Date().toISOString()};}
  // Every physical official game increments two player game counts, so divide the total evidence
  // delta by two. This now includes D1-D4 equally; depth cost affects WHO gets culled, not whether
  // a completed rating game advances the 100-game population clock.
  s.gamesSinceCull+=delta/2;saveState(dir,s);return s;}
function activeFaceIds(dir,depths=[1,2,3,4]){const s=sync(dir);return depths.flatMap(d=>poolIds(s.facePools[depthKey(d)]));}
function modelPathsForFaces(dir,ids){const s=sync(dir),seen=new Set(),out=[];for(const id of ids){const x=splitFaceId(id),m=x&&s.active[x.name];if(m&&!seen.has(x.name)){seen.add(x.name);out.push(path.join(dir,'models',m.file));}}return out;}
function activeModelNames(dir){const s=sync(dir),set=new Set();for(let d=1;d<=4;d++)for(const id of poolIds(s.facePools[depthKey(d)])){const x=splitFaceId(id);if(x)set.add(x.name);}return[...set];}
function ratingSlice(dir){return modelPathsForFaces(dir,activeFaceIds(dir,[1,2]));}
function selfplaySlice(dir){return ratingSlice(dir).filter(p=>!modelMeta(p).committee);}
function d3Slice(dir){return modelPathsForFaces(dir,activeFaceIds(dir,[3]));}
function d4Slice(dir){return modelPathsForFaces(dir,activeFaceIds(dir,[4]));}
function activeLadderLevels(dir,ladderN=null){return sync(dir,ladderN).ladderActive.slice();}
function filterFocus(dir,paths){const live=new Set(activeModelNames(dir));return paths.filter(p=>live.has(path.basename(p,'.json')));}
function selfplayProfile(paths,{dir}){const s=sync(dir),entries=paths.map(p=>({path:p,name:path.basename(p,'.json'),meta:modelMeta(p)})),elos=entries.map(e=>s.latest[e.name]?.elo).filter(Number.isFinite),maxE=elos.length?Math.max(...elos):0,raw={},weights={},coverage=[],depthCaps={};let sum=0;for(const e of entries){const elo=s.latest[e.name]?.elo,w=Number.isFinite(elo)?Math.exp((elo-maxE)/ELO_TEMP):1;raw[e.name]=w;sum+=w;}const total=Math.max(1,entries.reduce((a,e)=>a+(s.latest[e.name]?.games||0),0));for(const e of entries){const r=Math.max(1e-9,raw[e.name]/Math.max(sum,1e-9)),g=(s.latest[e.name]?.games||0)/total;weights[e.name]=+(r*r/(g+.01)+Math.sqrt(r)).toFixed(6);let cap=1;for(let d=1;d<=4;d++)if(candidateFaces(e,d).some(id=>poolIds(s.facePools[depthKey(d)]).includes(id)))cap=d;depthCaps[e.name]=cap;for(let d=1;d<=cap;d++)for(const id of candidateFaces(e,d))if(poolIds(s.facePools[depthKey(d)]).includes(id)&&!faceReading(s,id))coverage.push({name:e.name,face:id.includes('+P@')?'policy':'bare',depth:d});}return{weights,coverage,depthCaps};}
// Steepened twice, and both times the shape was absolute where it should have been relative.
// Measured on a 406-face field: the 25 cap was fully saturated (the curve wanted ~31), so the
// drain had degenerated into a flat constant no matter how bloated the field got; and because a
// checkpoint only has to out-drain the ~8 faces per 100 matches that training spawns, the /12
// slope put the RESTING population near 140 rather than near the target. Fixed by making both
// terms scale with the field: a slope steep enough that the drain still beats the spawn rate
// close to target (resting population ~80 at the current spawn rate), and a ceiling proportional
// to the population it is draining instead of a magic number -- so ~38 above target -> ~10 culls,
// ~350 above -> ~49, and a huge field is digested in hours instead of days while a near-target
// field still tapers to the same ~1-per-checkpoint trickle. Eligibility is untouched: only
// confidently-measured faces are ever candidates, so a big wipe can only execute the
// well-measured weak, never the unknown.
// Steepened again (slope /4 -> /2, ceiling .12n -> .18n) now that the league actually produces
// games: the drain is paid for out of gamesSinceCull, and the committee sweep used to hold every
// lane, so a checkpoint came round every several hours and the field sat ~2x target forever. At the
// current rate a 97-face field asks for ~24 culls a checkpoint instead of ~13, which is what makes
// TARGET_FACES reachable rather than aspirational. The seen/2 cap in cull() still bounds it.
function expectedCulls(n){if(n>=TARGET_FACES)return Math.min(Math.max(25,n*.18),1+(n-TARGET_FACES)/2);return Math.max(0,(n-30)/20);}
function stochasticCount(x){const n=Math.floor(x);return n+(Math.random()<x-n?1:0);}
// How many games a face must have before the CULL may judge it -- deliberately NOT the same bar as
// faceEstablished, which still demands the full FACE_MIN_GAMES before a model may promote to a more
// expensive depth. The two questions differ: promotion spends compute on a claim, culling only
// declines to keep spending it.
//
// A fixed bar of 12 games deadlocks a large field. At 1067 faces the arena could not put 12 games on
// anything, so nothing was ever eligible, so nothing was culled, so the field never shrank -- and
// every one of those faces went on diluting every future game. The bar therefore scales with pool
// pressure: judge on 2 games when the field is 20x target, demand the full 12 as it approaches it.
// That is self-correcting, because each cull gives the survivors a larger share of the next games,
// which narrows their intervals, which makes the next (stricter) judgement better informed.
//
// The floor is 2 because writeSummary only computes a CI at games>=2 (elorank-legacy.js), and the
// bootstrap over two identical observations collapses to zero width -- so eloHi at 2 games is the
// point estimate with no margin. That is a usable sort key but a noisy one: roughly a quarter of
// genuinely average faces lose their first match and are retired for it. Accepted deliberately.
// A crowded field wastes far more measurement on dead weight than a noisy filter costs, the model
// FILE survives on disk either way, and survivors are re-measured properly as the field thins.
function cullMinGames(k,population){const full=FACE_MIN_GAMES[k];if(!(population>TARGET_FACES))return full;return Math.max(2,Math.min(full,Math.round(full*TARGET_FACES/population)));}
// The cull's sort key: the face's upper bound, with a small floor guarding the residual cases where
// the bootstrap still returns a degenerate interval.
//
// The real fix is in elorank-legacy.js's bootstrap(), which read its interval off the raw resample
// percentiles. That distribution is skewed and shifted, so the upper bound it produced was inverted:
// measured over the live store, unbeaten faces averaged 75 Elo of upper margin while faces with 10+
// matches and a LOSING record averaged 161. The cull retires the lowest upper bound, so it was
// sparing the proven losers and executing the faces that had never been beaten -- resume-115@D2 went
// 6-0-0 and was culled, and simulated over the live field every one of the 25 faces the old key
// would retire had exactly 2 games. "Lowest upper bound" is the right rule; the interval feeding it
// was lying. Fixed at source by widening each end to the wider of the percentile and basic bootstrap
// (see bootstrap() there): upper margin 380 for unbeaten faces against 167 for faces with 10+
// matches and a losing record, so the rule now retires the proven losers it was always meant to.
//
// The floor below is only a guard, not the mechanism. It is set to sit at or under the corrected
// interval everywhere (250 Elo at one match, 125 at four, 46 at thirty), so once a rating pass has
// written a corrected summary it almost never binds -- but it stops a face being retired on a
// zero-width interval, including during the window before the first corrected summary lands, when
// the stored numbers are still the old percentile ones.
const CI_FLOOR=250;
function cullKey(r){const matches=Math.max(1,(+r.games||0)/2),hi=+r.eloHi;
  return Math.max(Number.isFinite(hi)?hi:-Infinity,(+r.elo||0)+CI_FLOOR/Math.sqrt(matches));}
// `skip` holds the faces this pass has just put back. Without it the cull could retire a face in the
// same call that reinstated it -- and the one-shot marker meant it then never came back. A
// reinstated face gets a checkpoint to actually play before it is judged again.
function eligibleByDepth(s,population,protect=new Set(),skip=null){const pop=Number.isFinite(population)?population:activeFaceSet(s).size;const out={D1:[],D2:[],D3:[],D4:[]};for(let d=1;d<=4;d++){const k=depthKey(d),need=cullMinGames(k,pop);for(const id of s.facePools[k].active||[]){if(skip&&skip.has(id))continue;const r=faceReading(s,id);if(!r||(+r.games||0)<need||!Number.isFinite(+r.eloHi))continue;const x=splitFaceId(id);if(x&&protect.has(x.name))continue;/* population members leave through run.js's own retirement, never the elastic cull (a cull would be undone by the next sync anyway) */out[k].push({id,r,depth:d,key:k});}out[k].sort((a,b)=>cullKey(a.r)-cullKey(b.r)||+a.r.elo-+b.r.elo);}return out;}
// Cull pressure follows MEASURED compute, not assumed depth cost. The rating store keeps an
// EWMA of ms-per-game for every face it has actually run (elorank-legacy.js), so the old 1:3:9:27
// becomes an emergent default rather than a constant -- and a policy face that genuinely saves
// time drags its bucket's rent down instead of paying full depth price for savings it never got
// credit for.
//
// A bucket's weight is its TOTAL rent, not its mean. One pick retires one face, so a face's own
// odds of retirement are P(bucket) / (faces in that bucket); weighting by the mean cancels the
// population term and leaves per-face hazard proportional to cost/count, which only matches
// compute when every bucket is the same size. They never are. On the desktop field -- 300 D1
// against a single D2 -- the mean gave that lone D2 face 1080x the per-face hazard of a D1 face,
// D3 3900x and D4 14100x, where an extra ply only costs about 3.6x. Deep faces were being retired
// for being RARE rather than for being expensive, so each promotion was swept back out within a
// checkpoint or two of clearing its games bar and the pools collapsed to D1 alone. Summing over
// the bucket restores the intended shape: per-face hazard is exactly the cost ratio, and the
// spread settles near the old FACE_CAPS by itself instead of needing them enforced.
// Per-face W/L/D straight from the rating store. The roster's own stored reading carries games and
// an interval but not the record, and the record is what decides whether a face has ever actually
// been beaten -- which the cull needs and did not have.
function faceRecords(dir){
  const out={};
  try{
    const s=JSON.parse(fs.readFileSync(path.join(dir,'elo-results.json'),'utf8'));
    for(const [k,r] of Object.entries(s.results||{})){
      const z=k.indexOf('|');if(z<1)continue;
      const a=k.slice(0,z),b=k.slice(z+1);
      out[a]||={w:0,l:0,d:0};out[b]||={w:0,l:0,d:0};
      out[a].w+=+r.w||0;out[a].l+=+r.l||0;out[a].d+=+r.d||0;
      out[b].w+=+r.l||0;out[b].l+=+r.w||0;out[b].d+=+r.d||0;
    }
  }catch(_){}
  return out;
}
// Never beaten, never held: won every match it has played. A cull "only declines to keep spending
// compute, it never claims the face is bad" -- so retiring one of these is the one thing the rule
// cannot justify, and it happened: resume-115@D2 went 6-0-0 and was culled anyway. (How: the cull
// sorts on the stored eloHi, and at two physical games the bootstrap collapses to the point
// estimate with no margin, which a re-fit later moves. An unbeaten record cannot be argued with.)
const undefeated=r=>!!r&&r.l===0&&r.d===0&&r.w>0;

function measuredCosts(dir){try{const s=JSON.parse(fs.readFileSync(path.join(dir,'elo-results.json'),'utf8'));return{cost:s.cost||{},unit:+s.costUnitMs>0?+s.costUnitMs:1500};}catch(_){return{cost:{},unit:1500};}}
function chooseDepth(e,mc){const keys=Object.keys(DEPTH_CULL_WEIGHT).filter(k=>e[k]&&e[k].length);if(!keys.length)return null;
  const unit=(mc&&mc.unit)||1500,cost=(mc&&mc.cost)||{};
  const w={};for(const k of keys){let rent=0;for(const v of e[k]){const ms=+cost[v.id];rent+=Number.isFinite(ms)&&ms>0?ms:DEPTH_CULL_WEIGHT[k]*unit;}w[k]=rent;}
  const total=keys.reduce((s,k)=>s+w[k],0),x=Math.random()*total;let a=0;for(const k of keys){a+=w[k];if(x<a)return k;}return keys.at(-1);}
// The cull may take at most HALF of the faces it can currently see. The list it culls from is
// sorted by rating, but when fewer faces clear the bar than the population asks to lose, the sort
// stops mattering: every measured face goes, whatever its rating -- and since the pair equation
// feeds strong faces more games, "measured" skews strong. Capping at half keeps the retirement a
// choice between measured faces rather than a purge of them; the rest of the quota simply waits
// for the next checkpoint, when more faces have cleared the bar.
function cull(dir){const s=sync(dir),recs=faceRecords(dir);
  // Put back anything the elastic cull retired that has never been beaten and whose file is still
  // on disk. reconcile() drops an id from active while its retired entry stands, so the entry has to
  // go, not just the membership. Files that are gone are not here at all: reconcile already purges
  // their retired entries, so this can only reinstate a face the league can actually play.
  // Deliberately ABOVE the bank gate: putting back a face that was never beaten is a correction, not
  // a cull, and must not wait on the 100 games that pay for the next cull checkpoint. It did wait,
  // once -- the bank sat at 53 and the correction silently never ran.
  // ONE SHOT per face, tracked in state. Before the sort key was fixed this reinstate was the only
  // thing standing between an unbeaten face and a cull judging on an inverted interval, so it had to
  // be unconditional -- and that left 158 of 213 live faces (74% of the field) permanently
  // cull-immune against a target of 50, which is why the population sat at 4.2x target. Now the
  // corrected interval protects the under-measured on rank, so this only repairs faces that lost
  // their seat under the broken one. Reinstating the same face twice would let it ping-pong against
  // the cull for ever.
  //
  // TWO ways a face loses its seat, and only the first leaves a trace:
  //  (a) the elastic cull, which writes a retired entry;
  //  (b) falling out of the pools entirely, with no retired entry at all -- the live ladder calls
  //      these "historical". reconcile() drops a face from active AND deletes its retired entry the
  //      moment its model is missing from stableModelEntries, so a single unreadable or half-written
  //      model file (modelMeta swallows the error and reports it unusable) erases every seat that
  //      model held; the next sync re-mints it, but the mint only ever seats a model at ONE depth,
  //      so its D2/D3/D4 faces are gone with nothing recording that they ever existed. That is why
  //      unbeaten faces like dual-wild-01-256x128@D3 (399 Elo, 1-0-0) sat as "historical" while the
  //      reinstate, which only walked p.retired, reported nothing to put back.
  // Both are repaired here. A face is only a candidate if it has an actual rated record in the store
  // and that record has never been beaten, so this can never seat a face the league has not played.
  const reinstated=[],once=new Set(s.reinstatedOnce||[]);
  const avail={};{const entries=stableModelEntries(dir);for(let d=1;d<=4;d++)avail[depthKey(d)]=new Set(entries.flatMap(e=>candidateFaces(e,d)));}
  for(let d=1;d<=4;d++){const k=depthKey(d),p=s.facePools[k];p.retired||={};p.active||=[];
    const seat=id=>{if(!p.active.includes(id))p.active.push(id);once.add(id);reinstated.push(id);};
    for(const id of Object.keys(p.retired)){
      if(p.retired[id].reason!=='elastic cull'||!undefeated(recs[id])||once.has(id))continue;
      delete p.retired[id];seat(id);
    }
    for(const id of avail[k]||[]){
      if(once.has(id)||!undefeated(recs[id]))continue;
      if(p.active.includes(id)||p.trial===id||p.retired[id])continue;
      seat(id);
    }}
  // Prune ids whose model file is gone (reconcile drops them from every pool) so this list cannot
  // grow without bound across the life of a state file.
  if(reinstated.length){const known=new Set();for(let d=1;d<=4;d++){const q=s.facePools[depthKey(d)];for(const id of q.active||[])known.add(id);for(const id of Object.keys(q.retired||{}))known.add(id);}
    s.reinstatedOnce=[...once].filter(id=>known.has(id));saveState(dir,s);}
  if(s.gamesSinceCull<CULL_EVERY_GAMES)return{culled:[],birth:null,admitted:[],reinstated,state:s};
  const mc=measuredCosts(dir),protect=protectedModels(dir),justBack=new Set(reinstated);
  const checkpoints=Math.floor(s.gamesSinceCull/CULL_EVERY_GAMES),culled=[],admitted=[];for(let q=0;q<checkpoints;q++){const population=activeFaceSet(s).size,e0=eligibleByDepth(s,population,protect,justBack),seen=e0.D1.length+e0.D2.length+e0.D3.length+e0.D4.length,want=Math.min(stochasticCount(expectedCulls(population)),Math.floor(seen/2));for(let i=0;i<want;i++){const e=eligibleByDepth(s,population,protect,justBack),k=chooseDepth(e,mc);if(!k)break;const v=e[k][0],p=s.facePools[k],now=new Date().toISOString();p.active=p.active.filter(id=>id!==v.id);p.retired[v.id]={at:now,reason:'elastic cull',eloHi:v.r.eloHi,elo:v.r.elo,games:+v.r.games||0,population};culled.push({type:'face',name:v.id,face:v.id,depth:v.depth,replacedBy:null,result:'elastic-cull'});}admitted.push(...admitFrontier(s,stableModelEntries(dir),mc));s.gamesSinceCull=Math.max(0,s.gamesSinceCull-CULL_EVERY_GAMES);}if(culled.length||admitted.length||reinstated.length)s.lastEvent={at:new Date().toISOString(),culled:culled.map(x=>x.face),admitted,reinstated,result:'elastic-checkpoint'};saveState(dir,s);return{culled,birth:null,admitted,reinstated,state:s};}
function noteBirth(dir,birth){if(birth&&birth.outPath&&fs.existsSync(birth.outPath))sync(dir);}
function status(dir){const s=sync(dir),pop=activeFaceSet(s).size,faces={};for(let d=1;d<=4;d++){const k=depthKey(d),p=s.facePools[k];faces[k]={seats:(p.active||[]).length,trial:p.trial?1:0,waiting:(p.waiting||[]).length,deferred:0,retired:Object.keys(p.retired||{}).length,capacity:null};}return{models:activeModelNames(dir).length,ladders:s.ladderActive.length,gamesSinceCull:s.gamesSinceCull,faces,targetFaces:TARGET_FACES,population:pop,admitCeiling:ADMIT_CEILING,cullMinGames:Object.fromEntries([1,2,3,4].map(d=>[depthKey(d),cullMinGames(depthKey(d),pop)])),heldModels:+(s.queueCompaction&&s.queueCompaction.heldModels)||0};}
function restoreDepthSpecialists(){return[];}function retireBadD4(){return[];}
module.exports={protectedModels,PROTECT_GAMES,TARGET_MODELS,TARGET_FACES,ADMIT_CEILING,FACE_CAPS,FACE_MIN_GAMES,cullMinGames,DEPTH_CULL_WEIGHT,D3_SHARE,sync,ingestSummary,modelMeta,stableModelEntries,activeModelNames,activeFaceIds,restoreDepthSpecialists,selfplaySlice,ratingSlice,selfplayProfile,activeLadderLevels,filterFocus,d3Slice,d4Slice,retireBadD4,d3SummaryPath,d4SummaryPath,cull,noteBirth,status};
