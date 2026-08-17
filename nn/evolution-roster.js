'use strict';
const fs = require('fs');
const path = require('path');

// One open evolutionary league across search faces. 50 is a soft equilibrium, not a hard cap:
// new models may enter at any time, historical measured faces are eligible again, and population
// pressure rises smoothly when the field balloons. Search depth affects the chance of facing a
// cull (rough compute ratio 1:3:9:27), never the strength number itself.
const TARGET_FACES = 50;
const TARGET_MODELS = TARGET_FACES; // compatibility for older callers/menu readouts
const FACE_CAPS = Object.freeze({ D1:50, D2:14, D3:4, D4:1 }); // legacy/export compatibility only; not enforced
const FACE_MIN_GAMES = Object.freeze({ D1:12, D2:8, D3:5, D4:2 });
const DEPTH_CULL_WEIGHT = Object.freeze({ D1:1, D2:3, D3:9, D4:27 });
const CULL_EVERY_GAMES = 100;
const ELO_TEMP = 400;
const D3_SHARE = 0.04; // compatibility with older callers
const ELASTIC_ROSTER_VERSION = 2;
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
function poolIds(p){return [...(p.active||[]),...(p.trial?[p.trial]:[])];}
function modelSerial(name){const m=String(name).match(/(\d+)(?!.*\d)/);return m?+m[1]:-1;}
function modelBestScore(s,name){
  const r=s.latest[name]||{},v=[];
  if(Number.isFinite(+r.rankHi))v.push(+r.rankHi);
  for(const f of Object.values(r.faces||{}))if(Number.isFinite(+f.rankHi))v.push(+f.rankHi);
  if(v.length)return Math.max(...v);
  const q=[];if(Number.isFinite(+r.rank))q.push(+r.rank);
  for(const f of Object.values(r.faces||{}))if(Number.isFinite(+f.rank))q.push(+f.rank);
  return q.length?Math.max(...q):-Infinity;
}
function faceEstablished(s,id,d){
  const r=faceReading(s,id),need=FACE_MIN_GAMES[depthKey(d)];
  return !!(r&&(+r.games||0)>=need&&Number.isFinite(+r.rankHi));
}
function emptyPool(){return{active:[],trial:null,waiting:[],retired:{},deferred:{}};}
function ensurePools(s){
  s.facePools||={};
  for(let d=1;d<=4;d++){const k=depthKey(d);s.facePools[k]||=emptyPool();}
}
function activeFaceSet(s){const out=new Set();for(let d=1;d<=4;d++)for(const id of poolIds(s.facePools[depthKey(d)]))out.add(id);return out;}
function elasticRetired(p,id){return !!(p.retired&&p.retired[id]&&p.retired[id].reason==='elastic cull');}

function reconcileOpenLeague(s,entries){
  ensurePools(s);
  const available={};
  for(let d=1;d<=4;d++)available[depthKey(d)]=new Set(entries.flatMap(e=>candidateFaces(e,d)));
  const migrating=s.elasticRosterVersion!==ELASTIC_ROSTER_VERSION;

  for(let d=1;d<=4;d++){
    const key=depthKey(d),p=s.facePools[key],avail=available[key];
    p.retired=p.retired&&typeof p.retired==='object'?p.retired:{};
    p.deferred=p.deferred&&typeof p.deferred==='object'?p.deferred:{};
    const oldKnown=new Set([...(p.active||[]),...(p.waiting||[]),...(p.trial?[p.trial]:[]),
      ...Object.keys(p.deferred),...Object.keys(p.retired)]);
    const keepRetired={};
    for(const [id,meta] of Object.entries(p.retired))if(avail.has(id)&&meta&&meta.reason==='elastic cull')keepRetired[id]=meta;

    const live=new Set((p.active||[]).filter(id=>avail.has(id)&&!keepRetired[id]));
    // One-time migration: old waiting/deferred/seat-retired faces were bookkeeping artefacts, not
    // competitive deaths. Bring them back so the new league can select from the whole measured past.
    if(migrating){
      const oldLiveish=new Set([...(p.active||[]),...(p.waiting||[]),...(p.trial?[p.trial]:[])]);
      for(const id of oldKnown)if(avail.has(id)&&!keepRetired[id]&&(oldLiveish.has(id)||!!faceReading(s,id)))live.add(id);
    }
    // Any face with durable rating evidence belongs in the all-time audition pool unless the new
    // elastic controller itself has already retired it.
    for(const id of avail)if(!keepRetired[id]&&faceReading(s,id))live.add(id);

    p.active=[...live];p.trial=null;p.waiting=[];p.deferred={};p.retired=keepRetired;
  }

  // Every model gets at least one cheap live audition immediately, including a model dropped into a
  // huge field. We do not manufacture all four depths at once; deeper auditions are introduced at
  // the steady checkpoint cadence below.
  const live=activeFaceSet(s);
  for(const e of entries){
    const all=[];for(let d=1;d<=4;d++)all.push(...candidateFaces(e,d));
    const known=all.some(id=>live.has(id)||elasticRetired(s.facePools[depthKey(splitFaceId(id).depth)],id));
    if(known)continue;
    for(let d=1;d<=4;d++){
      const ids=candidateFaces(e,d);if(!ids.length)continue;
      for(const id of ids){s.facePools[depthKey(d)].active.push(id);live.add(id);}break;
    }
  }
  s.elasticRosterVersion=ELASTIC_ROSTER_VERSION;
  s.queueCompaction={version:2,updated:new Date().toISOString(),catalogueModels:entries.length,
    queueModels:entries.length,deferredFaces:0,mode:'open elastic league'};
}

function nextFrontierAudition(s,entries){
  const candidates=[];
  for(const e of entries){
    let highest=0;
    for(let d=1;d<=4;d++){
      const p=s.facePools[depthKey(d)],ids=candidateFaces(e,d);
      if(ids.some(id=>(p.active||[]).includes(id)||elasticRetired(p,id)||!!faceReading(s,id)))highest=d;
    }
    if(highest>=4)continue;
    const prevDepth=Math.max(1,highest),prevIds=candidateFaces(e,prevDepth);
    if(prevIds.length&&!prevIds.some(id=>faceEstablished(s,id,prevDepth)))continue;
    for(let d=highest+1;d<=4;d++){
      const ids=candidateFaces(e,d);if(!ids.length)continue;
      const fresh=ids.filter(id=>!s.facePools[depthKey(d)].active.includes(id)&&!elasticRetired(s.facePools[depthKey(d)],id));
      if(fresh.length)candidates.push({e,depth:d,ids:fresh,score:modelBestScore(s,e.name),serial:modelSerial(e.name)});
      break;
    }
  }
  candidates.sort((a,b)=>b.score-a.score||b.serial-a.serial||a.e.name.localeCompare(b.e.name));
  return candidates[0]||null;
}
function admitFrontier(s,entries){
  const q=nextFrontierAudition(s,entries);if(!q)return[];
  const admitted=[];for(const id of q.ids){s.facePools[depthKey(q.depth)].active.push(id);admitted.push(id);}return admitted;
}

function sync(dir,ladderN=null){
  const s=loadState(dir),entries=stableModelEntries(dir),present=new Set(entries.map(e=>e.name));
  for(const e of entries){s.active[e.name]={file:e.file,dual:e.dual,policy:e.policy,shape:e.shape};delete s.retired[e.name];}
  for(const n of Object.keys(s.active))if(!present.has(n))delete s.active[n];
  reconcileOpenLeague(s,entries);
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
function activeModelNames(dir){const s=sync(dir),set=new Set();for(let d=1;d<=4;d++)for(const id of poolIds(s.facePools[depthKey(d)])){const x=splitFaceId(id);if(x)set.add(x.name);}return[...set];}
function ratingSlice(dir){return modelPathsForFaces(dir,activeFaceIds(dir,[1,2]));}
function selfplaySlice(dir){return ratingSlice(dir);}
function d3Slice(dir){return modelPathsForFaces(dir,activeFaceIds(dir,[3]));}
function d4Slice(dir){return modelPathsForFaces(dir,activeFaceIds(dir,[4]));}
function activeLadderLevels(dir,ladderN=null){return sync(dir,ladderN).ladderActive.slice();}
function filterFocus(dir,paths){const live=new Set(activeModelNames(dir));return paths.filter(p=>live.has(path.basename(p,'.json')));}
function restoreDepthSpecialists(){return[];}
function retireBadD4(){return[];}

function selfplayProfile(paths,{dir}){
  const s=sync(dir),entries=paths.map(p=>({path:p,name:path.basename(p,'.json'),meta:modelMeta(p)}));
  const elos=entries.map(e=>s.latest[e.name]?.elo).filter(Number.isFinite),maxE=elos.length?Math.max(...elos):0;
  const raw={},weights={},coverage=[],depthCaps={};let sum=0;
  for(const e of entries){const elo=s.latest[e.name]?.elo,rr=Number.isFinite(elo)?Math.exp((elo-maxE)/ELO_TEMP):1;raw[e.name]=rr;sum+=rr;}
  const total=Math.max(1,entries.reduce((a,e)=>a+(s.latest[e.name]?.games||0),0));
  for(const e of entries){const r=Math.max(1e-9,raw[e.name]/Math.max(sum,1e-9)),g=(s.latest[e.name]?.games||0)/total;
    weights[e.name]=+(r*r/(g+.01)+Math.sqrt(r)).toFixed(6);let cap=1;
    for(let d=1;d<=4;d++)if(candidateFaces(e,d).some(id=>poolIds(s.facePools[depthKey(d)]).includes(id)))cap=d;
    depthCaps[e.name]=cap;for(let d=1;d<=cap;d++)for(const id of candidateFaces(e,d))if(poolIds(s.facePools[depthKey(d)]).includes(id)&&!faceReading(s,id))
      coverage.push({name:e.name,face:id.includes('+P@')?'policy':'bare',depth:d});
  }
  return{weights,coverage,depthCaps};
}

function expectedCulls(n){
  if(n>=TARGET_FACES)return Math.min(10,1+9*Math.min(950,n-TARGET_FACES)/950);
  return Math.max(0,(n-30)/20);
}
function stochasticCount(x){const whole=Math.floor(x),frac=x-whole;return whole+(Math.random()<frac?1:0);}
function eligibleByDepth(s){
  const out={D1:[],D2:[],D3:[],D4:[]};
  for(let d=1;d<=4;d++){
    const key=depthKey(d),need=FACE_MIN_GAMES[key];
    for(const id of s.facePools[key].active||[]){
      const r=faceReading(s,id);if(!r||(+r.games||0)<need||!Number.isFinite(+r.rankHi))continue;
      out[key].push({id,r,depth:d,key});
    }
    out[key].sort((a,b)=>a.r.rankHi-b.r.rankHi||(+a.r.rank||0)-(+b.r.rank||0));
  }
  return out;
}
function chooseDepth(rows){
  const available=Object.keys(rows).filter(k=>rows[k].length);
  if(!available.length)return null;
  const total=available.reduce((a,k)=>a+DEPTH_CULL_WEIGHT[k],0);let x=Math.random()*total;
  for(const k of available){x-=DEPTH_CULL_WEIGHT[k];if(x<=0)return k;}return available[available.length-1];
}
function cull(dir){
  const s=sync(dir);if(s.gamesSinceCull<CULL_EVERY_GAMES)return{culled:[],birth:null,state:s};
  const entries=stableModelEntries(dir),population=activeFaceSet(s).size,expected=expectedCulls(population),want=stochasticCount(expected),culled=[];
  const now=new Date().toISOString();
  for(let i=0;i<want;i++){
    const rows=eligibleByDepth(s),key=chooseDepth(rows);if(!key)break;
    // Within the compute-selected depth, kill the face with the weakest optimistic reading. A wide
    // CI is protection: L3.3-L7.5 survives ahead of a tightly known L6.6-L6.7 because 7.5 > 6.7.
    const victim=rows[key][0];if(!victim)break;
    const p=s.facePools[key];p.active=p.active.filter(id=>id!==victim.id);
    p.retired[victim.id]={at:now,reason:'elastic cull',rank:+victim.r.rank||null,rankLo:+victim.r.rankLo||null,
      rankHi:+victim.r.rankHi,games:+victim.r.games||0,populationBefore:population,expectedCulls:expected};
    culled.push({type:'face',name:victim.id,face:victim.id,depth:victim.depth,result:'elastic-cull',rankHi:+victim.r.rankHi});
  }
  // One fresh depth audition per 100-game checkpoint keeps exploration alive even in a large field.
  // Brand-new model files do not wait for this: reconcileOpenLeague gives them their first face now.
  const admitted=admitFrontier(s,entries);
  s.gamesSinceCull=Math.max(0,s.gamesSinceCull-CULL_EVERY_GAMES);
  s.lastEvent={at:now,culled:culled.map(x=>x.face),admitted,populationBefore:population,
    populationAfter:activeFaceSet(s).size,expectedCulls:expected,targetFaces:TARGET_FACES};
  saveState(dir,s);return{culled,birth:null,state:s,admitted};
}
function noteBirth(dir,birth){if(!birth||!birth.outPath||!fs.existsSync(birth.outPath))return;sync(dir);}
function status(dir){
  const s=sync(dir),faces={};for(let d=1;d<=4;d++){const key=depthKey(d),p=s.facePools[key];faces[key]={seats:p.active.length,trial:0,
    waiting:0,deferred:0,retired:Object.keys(p.retired||{}).length,capacity:null};}
  const population=activeFaceSet(s).size;
  return{models:activeModelNames(dir).length,ladders:s.ladderActive.length,gamesSinceCull:s.gamesSinceCull,faces,
    population,targetFaces:TARGET_FACES,expectedCulls:expectedCulls(population)};
}

module.exports={TARGET_MODELS,TARGET_FACES,FACE_CAPS,FACE_MIN_GAMES,DEPTH_CULL_WEIGHT,D3_SHARE,sync,ingestSummary,
  activeModelNames,activeFaceIds,restoreDepthSpecialists,selfplaySlice,ratingSlice,selfplayProfile,activeLadderLevels,
  filterFocus,d3Slice,d4Slice,retireBadD4,d3SummaryPath,d4SummaryPath,cull,noteBirth,status,expectedCulls};
