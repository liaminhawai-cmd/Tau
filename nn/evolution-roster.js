'use strict';
const fs = require('fs');
const path = require('path');

// A seat belongs to a search FACE, not to a checkpoint file. One checkpoint may therefore keep
// (say) its excellent D3 face after its weak D1 face has left the field. Capacities follow the
// measured ~3.6x cost of each extra ply: 50, 50/3.6, 50/3.6^2, 50/3.6^3.
const FACE_CAPS = Object.freeze({ D1:50, D2:14, D3:4, D4:1 });
const FACE_MIN_GAMES = Object.freeze({ D1:12, D2:8, D3:5, D4:2 });
const TARGET_MODELS = FACE_CAPS.D1; // compatibility for older callers/menu readouts
const CULL_EVERY_GAMES = 100;
const ELO_TEMP = 400;
const D3_SHARE = 0.04;
const ALIASES = new Set(['best.json','value.json','scratch.json','wide.json','ultra.json','deep.json','l15_value.json',
  'policy-joint-base.json']);

const statePath = dir => path.join(dir, 'models', '.evolution-roster.json');
const d3SummaryPath = dir => path.join(dir, '.evolution-d3-summary.json');
const d4SummaryPath = dir => path.join(dir, '.evolution-d4-summary.json');
const mean = xs => { const a=xs.filter(Number.isFinite); return a.length?a.reduce((s,x)=>s+x,0)/a.length:null; };
const atomicWrite = (p,data) => { const t=`${p}.tmp-${process.pid}-${Date.now()}`; fs.writeFileSync(t,data); fs.renameSync(t,p); };

function loadState(dir) {
  let s=null; try{s=JSON.parse(fs.readFileSync(statePath(dir),'utf8'));}catch(_){}
  if(!s||s.version!==1)s={version:1,active:{},retired:{},latest:{},ladderActive:null,ladderGames:{},
    ladderRatings:{},evidenceSeen:{},gamesSinceCull:0,birthSerial:1,lastEvent:null,facePools:null};
  s.active||={}; s.retired||={}; s.latest||={}; s.ladderGames||={}; s.ladderRatings||={};
  s.evidenceSeen||={}; s.gamesSinceCull=+s.gamesSinceCull||0; s.birthSerial=+s.birthSerial||1;
  return s;
}
function saveState(dir,s){atomicWrite(statePath(dir),JSON.stringify(s,null,1));}

function modelMeta(p){
  try{
    const j=JSON.parse(fs.readFileSync(p,'utf8'));
    if(j&&j.policyEntrant===true){const b=path.join(path.dirname(p),j.valueFile||''),q=path.join(path.dirname(p),j.policyFile||'');
      if(fs.existsSync(b)&&fs.existsSync(q))return{usable:true,dual:false,policy:true,shape:j.shape||null};}
    if(j&&j.dual===true)return{usable:true,dual:true,policy:false,shape:Array.isArray(j.sizes)?j.sizes.slice(1,-1).join(','):null};
    if(j&&Array.isArray(j.sizes)&&j.sizes.length>=3&&+j.sizes[j.sizes.length-1]===1)
      return{usable:true,dual:false,policy:false,shape:j.sizes.slice(1,-1).join(',')};
  }catch(_){}
  return{usable:false,dual:false,policy:false,shape:null};
}
function stableModelEntries(dir){
  const md=path.join(dir,'models'); let files=[]; try{files=fs.readdirSync(md);}catch(_){return[];}
  const out=[];
  for(const f of files){
    if(!f.endsWith('.json')||ALIASES.has(f)||/^pool-slot-\d+\.json$/.test(f)||/^best\.pre-pool-/.test(f)||
       /^dual-startup-probe-/.test(f)||/\.partial\.json$/.test(f))continue;
    const p=path.join(md,f),m=modelMeta(p); if(!m.usable)continue;
    out.push({name:path.basename(f,'.json'),file:f,path:p,dual:m.dual,policy:m.policy,shape:m.shape});
  }
  return out;
}
function productionLadderLevels(ladderN=null){
  try{const d=require('./engine.js').createEngine().AI_LADDER,n=ladderN==null?d.length:Math.min(ladderN,d.length);
    return d.slice(0,n).map((x,i)=>x&&!x.experimental?i+1:null).filter(Boolean);}
  catch(_){const n=ladderN==null?11:ladderN;return Array.from({length:n},(_,i)=>i+1);}
}

const depthKey=d=>`D${d}`;
function faceId(name,depth,policy=false){return `${name}${policy?'+P':''}@D${depth}`;}
function splitFaceId(id){
  const m=String(id).match(/^(.*?)(\+P)?@D([1-4])$/); if(!m)return null;
  return{name:m[1],policy:!!m[2],depth:+m[3],key:`D${m[3]}${m[2]?'+P':''}`};
}
function candidateFaces(entry,depth){
  if(entry.policy&&depth===1)return[];
  const a=[faceId(entry.name,depth,false)]; if(entry.dual)a.push(faceId(entry.name,depth,true)); return a;
}
function faceReading(s,id){const x=splitFaceId(id);return x?s.latest[x.name]?.faces?.[x.key]||null:null;}
function faceScore(s,id){const r=faceReading(s,id);return r&&Number.isFinite(+r.rankLo)?+r.rankLo:
  r&&Number.isFinite(+r.rank)?+r.rank:-Infinity;}
function sortFaces(s,ids){return ids.slice().sort((a,b)=>faceScore(s,b)-faceScore(s,a)||a.localeCompare(b,undefined,{numeric:true}));}
function poolIds(p){return [...p.active,...(p.trial?[p.trial]:[])];}
function advanceTrial(s,key){const p=s.facePools[key];if(!p.trial&&p.waiting.length)p.trial=p.waiting.shift();}

function initialiseFacePools(s,entries){
  s.facePools={};
  for(let d=1;d<=4;d++){
    const key=depthKey(d),all=entries.flatMap(e=>candidateFaces(e,d)),ranked=sortFaces(s,all),cap=FACE_CAPS[key];
    s.facePools[key]={active:ranked.slice(0,cap),trial:ranked[cap]||null,waiting:ranked.slice(cap+1),retired:{}};
  }
  s.faceRosterMigratedAt=new Date().toISOString();
}
function reconcileFacePools(s,entries){
  const availableByDepth={};
  for(let d=1;d<=4;d++)availableByDepth[depthKey(d)]=new Set(entries.flatMap(e=>candidateFaces(e,d)));
  for(let d=1;d<=4;d++){
    const key=depthKey(d),avail=availableByDepth[key],p=s.facePools[key]||{active:[],trial:null,waiting:[],retired:{}};
    p.active=[...new Set(p.active||[])].filter(x=>avail.has(x));
    p.trial=avail.has(p.trial)&&!p.active.includes(p.trial)?p.trial:null;
    p.waiting=[...new Set(p.waiting||[])].filter(x=>avail.has(x)&&!p.active.includes(x)&&x!==p.trial);
    p.retired=p.retired&&typeof p.retired==='object'?p.retired:{};
    for(const id of Object.keys(p.retired))if(!avail.has(id))delete p.retired[id];
    const known=new Set([...p.active,...p.waiting,...(p.trial?[p.trial]:[]),...Object.keys(p.retired)]);
    for(const id of avail)if(!known.has(id))p.waiting.push(id);
    while(p.active.length<FACE_CAPS[key]&&p.waiting.length)p.active.push(p.waiting.shift());
    s.facePools[key]=p;advanceTrial(s,key);
  }
}
function sync(dir,ladderN=null){
  const s=loadState(dir),entries=stableModelEntries(dir),present=new Set(entries.map(e=>e.name));
  // Model files are now a durable catalogue. Face pools decide which identities consume games;
  // old whole-model retirement is deliberately undone so a surviving depth can re-enter.
  for(const e of entries){s.active[e.name]={file:e.file,dual:e.dual,policy:e.policy,shape:e.shape};delete s.retired[e.name];}
  for(const n of Object.keys(s.active))if(!present.has(n))delete s.active[n];
  if(!s.facePools)initialiseFacePools(s,entries);else reconcileFacePools(s,entries);
  const production=productionLadderLevels(ladderN),allowed=new Set(production);
  if(!Array.isArray(s.ladderActive))s.ladderActive=production;
  s.ladderActive=[...new Set(s.ladderActive.filter(x=>allowed.has(x)))].sort((a,b)=>a-b);
  saveState(dir,s);return s;
}

function readSummary(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return{players:{}};}}
function ingestSummary(dir,summaryFile){
  const s=sync(dir),sum=readSummary(summaryFile),groups={},ladder={};
  for(const [id,r] of Object.entries(sum.players||{})){
    if(r.kind==='ladder'){ladder[r.level]={games:+r.games||0,elo:Number.isFinite(+r.elo)?+r.elo:null};continue;}
    if(r.kind!=='nn'||!r.model)continue; const name=path.basename(r.model,'.json');(groups[name]||=[]).push({...r,id});
  }
  let evidenceDelta=0;
  for(const [name,rows] of Object.entries(groups)){
    const base=rows.filter(r=>r.depth===1||r.depth===2),use=base.length?base:rows,ranks=use.filter(r=>Number.isFinite(r.rank));
    const rec=s.latest[name]||{},depthGames={...(rec.depthGames||{})},depthElo={...(rec.depthElo||{})},faces={...(rec.faces||{})};
    for(const d of [1,2,3,4]){
      depthGames[d]=Math.max(depthGames[d]||0,rows.filter(r=>r.depth===d).reduce((a,r)=>a+(+r.games||0),0));
      const vals=rows.filter(r=>r.depth===d&&Number.isFinite(+r.elo)).map(r=>+r.elo);if(vals.length)depthElo[d]=mean(vals);
    }
    for(const r of rows){
      if(!Number.isFinite(r.depth)||!Number.isFinite(r.rank)||!Number.isFinite(r.rankLo)||!Number.isFinite(r.rankHi))continue;
      const key=`D${r.depth}${r.dualPolicy?'+P':''}`,old=faces[key]||{};
      faces[key]={rank:+r.rank,rankLo:+r.rankLo,rankHi:+r.rankHi,rankLoEdge:r.rankLoEdge||null,
        rankHiEdge:r.rankHiEdge||null,elo:Number.isFinite(+r.elo)?+r.elo:old.elo,
        games:Math.max(+old.games||0,+r.games||0),updated:sum.updated||new Date().toISOString()};
    }
    const games=use.reduce((a,r)=>a+(+r.games||0),0);
    s.latest[name]={elo:mean(use.map(r=>r.elo)),rank:mean(ranks.map(r=>r.rank)),rankLo:mean(ranks.map(r=>r.rankLo)),
      rankHi:mean(ranks.map(r=>r.rankHi)),games:Math.max(rec.games||0,games),depthGames,depthElo,faces,
      updated:sum.updated||new Date().toISOString()};
    const prev=+s.evidenceSeen[name]||0;if(games>prev)evidenceDelta+=games-prev;s.evidenceSeen[name]=Math.max(prev,games);
  }
  for(const [lvl,lr] of Object.entries(ladder)){
    const g=+lr.games||0,prev=+s.ladderGames[lvl]||0;if(g>prev)evidenceDelta+=g-prev;
    s.ladderGames[lvl]=Math.max(prev,g);const old=s.ladderRatings[lvl]||{};
    s.ladderRatings[lvl]={elo:Number.isFinite(lr.elo)?lr.elo:old.elo,games:Math.max(+old.games||0,g),updated:sum.updated||new Date().toISOString()};
  }
  s.gamesSinceCull+=evidenceDelta/2;saveState(dir,s);return s;
}

function activeFaceIds(dir,depths=[1,2,3,4]){const s=sync(dir);return depths.flatMap(d=>poolIds(s.facePools[depthKey(d)]));}
function modelPathsForFaces(dir,ids){const s=sync(dir),seen=new Set(),out=[];for(const id of ids){const x=splitFaceId(id),m=x&&s.active[x.name];
  if(m&&!seen.has(x.name)){seen.add(x.name);out.push(path.join(dir,'models',m.file));}}return out;}
function activeModelNames(dir){const s=sync(dir),set=new Set();for(const key of Object.keys(FACE_CAPS))for(const id of poolIds(s.facePools[key])){const x=splitFaceId(id);if(x)set.add(x.name);}return[...set];}
function ratingSlice(dir){return modelPathsForFaces(dir,activeFaceIds(dir,[1,2]));}
function selfplaySlice(dir){return ratingSlice(dir);}
function d3Slice(dir){return modelPathsForFaces(dir,activeFaceIds(dir,[3]));}
function d4Slice(dir){return modelPathsForFaces(dir,activeFaceIds(dir,[4]));}
function activeLadderLevels(dir,ladderN=null){return sync(dir,ladderN).ladderActive.slice();}
function filterFocus(dir,paths){const s=sync(dir);return paths.filter(p=>!!s.active[path.basename(p,'.json')]);}
function restoreDepthSpecialists(){return[];} // face pools make whole-model restoration obsolete
function retireBadD4(){return[];}             // D4 uses the same CI swap rule as every other depth

function selfplayProfile(paths,{dir}){
  const s=sync(dir),entries=paths.map(p=>({path:p,name:path.basename(p,'.json'),meta:modelMeta(p)}));
  const elos=entries.map(e=>s.latest[e.name]?.elo).filter(Number.isFinite),maxE=elos.length?Math.max(...elos):0;
  const raw={},weights={},coverage=[],depthCaps={};let sum=0;
  for(const e of entries){const elo=s.latest[e.name]?.elo,rr=Number.isFinite(elo)?Math.exp((elo-maxE)/ELO_TEMP):1;raw[e.name]=rr;sum+=rr;}
  const total=Math.max(1,entries.reduce((a,e)=>a+(s.latest[e.name]?.games||0),0));
  for(const e of entries){const r=Math.max(1e-9,raw[e.name]/Math.max(sum,1e-9)),g=(s.latest[e.name]?.games||0)/total;
    weights[e.name]=+(r*r/(g+.01)+Math.sqrt(r)).toFixed(6);let cap=1;
    for(let d=1;d<=4;d++)if(candidateFaces(e,d).some(id=>poolIds(s.facePools[depthKey(d)]).includes(id)))cap=d;
    depthCaps[e.name]=cap;for(let d=1;d<=cap;d++)for(const id of candidateFaces(e,d))if(!faceReading(s,id))coverage.push({name:e.name,face:id.includes('+P@')?'policy':'bare',depth:d});
  }
  return{weights,coverage,depthCaps};
}

function cull(dir){
  const s=sync(dir);if(s.gamesSinceCull<CULL_EVERY_GAMES)return{culled:[],birth:null,state:s};
  // Resolve at most one head-to-head seat decision per bank debit. There is always at most one
  // extra trial face at a depth, so a decision is literally one face out and the next face in.
  const options=[];
  for(let d=1;d<=4;d++){
    const key=depthKey(d),p=s.facePools[key],challenger=p.trial,cr=challenger&&faceReading(s,challenger);
    if(!challenger||!cr||(+cr.games||0)<FACE_MIN_GAMES[key]||!Number.isFinite(cr.rankLo)||!Number.isFinite(cr.rankHi))continue;
    const measured=p.active.map(id=>({id,r:faceReading(s,id)})).filter(x=>x.r&&(+x.r.games||0)>=FACE_MIN_GAMES[key]&&Number.isFinite(x.r.rankLo)&&Number.isFinite(x.r.rankHi));
    if(!measured.length)continue;
    // The incumbent with the lowest pessimistic estimate is the seat the challenger must beat.
    const weakest=measured.sort((a,b)=>a.r.rankLo-b.r.rankLo||a.r.rankHi-b.r.rankHi)[0];
    if(cr.rankLo>weakest.r.rankHi)options.push({depth:d,key,p,challenger,cr,weakest,out:weakest.id,in:challenger,result:'promoted',margin:cr.rankLo-weakest.r.rankHi});
    else if(cr.rankHi<weakest.r.rankLo)options.push({depth:d,key,p,challenger,cr,weakest,out:challenger,in:null,result:'rejected',margin:weakest.r.rankLo-cr.rankHi});
  }
  if(!options.length)return{culled:[],birth:null,state:s};
  options.sort((a,b)=>b.margin-a.margin||b.depth-a.depth);const x=options[0],now=new Date().toISOString();
  s.gamesSinceCull=Math.max(0,s.gamesSinceCull-CULL_EVERY_GAMES);
  if(x.result==='promoted'){
    x.p.active=x.p.active.filter(id=>id!==x.out);x.p.active.push(x.challenger);
    x.p.retired[x.out]={at:now,reason:'lost seat',to:x.challenger,rankHi:x.weakest.r.rankHi,challengerRankLo:x.cr.rankLo};
  }else x.p.retired[x.out]={at:now,reason:'failed trial',against:x.weakest.id,rankHi:x.cr.rankHi,incumbentRankLo:x.weakest.r.rankLo};
  x.p.trial=null;advanceTrial(s,x.key);
  const culled=[{type:'face',name:x.out,face:x.out,depth:x.depth,replacedBy:x.result==='promoted'?x.in:x.p.trial,result:x.result}];
  s.lastEvent={at:now,culled:[x.out],admitted:x.result==='promoted'?x.in:x.p.trial,depth:x.depth,result:x.result};
  saveState(dir,s);return{culled,birth:null,state:s};
}
function noteBirth(dir,birth){if(!birth||!birth.outPath||!fs.existsSync(birth.outPath))return;sync(dir);}
function status(dir){const s=sync(dir),faces={};for(const key of Object.keys(FACE_CAPS)){const p=s.facePools[key];faces[key]={seats:p.active.length,trial:p.trial?1:0,waiting:p.waiting.length,retired:Object.keys(p.retired).length,capacity:FACE_CAPS[key]};}
  return{models:activeModelNames(dir).length,ladders:s.ladderActive.length,gamesSinceCull:s.gamesSinceCull,faces};}

module.exports={TARGET_MODELS,FACE_CAPS,FACE_MIN_GAMES,D3_SHARE,sync,ingestSummary,activeModelNames,activeFaceIds,
  restoreDepthSpecialists,selfplaySlice,ratingSlice,selfplayProfile,activeLadderLevels,filterFocus,d3Slice,d4Slice,
  retireBadD4,d3SummaryPath,d4SummaryPath,cull,noteBirth,status};
