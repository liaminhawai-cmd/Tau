'use strict';
const fs=require('fs');
const path=require('path');

// One open evolutionary population of search faces. Elo decides strength; search depth only changes
// compute cost / cull pressure. The fixed L-brains are not in these face pools, so they are immortal
// by construction and receive no other privilege.
const TARGET_FACES=50;
const TARGET_MODELS=TARGET_FACES;
const FACE_CAPS=Object.freeze({D1:50,D2:14,D3:4,D4:1}); // compatibility export only; never enforced
const FACE_MIN_GAMES=Object.freeze({D1:12,D2:8,D3:5,D4:2});
const DEPTH_CULL_WEIGHT=Object.freeze({D1:1,D2:3,D3:9,D4:27});
const CULL_EVERY_GAMES=100;
const ELO_TEMP=400;
const D3_SHARE=.04;
const ALIASES=new Set(['best.json','value.json','scratch.json','wide.json','ultra.json','deep.json','l15_value.json','policy-joint-base.json']);
const statePath=dir=>path.join(dir,'models','.evolution-roster.json');
const d3SummaryPath=dir=>path.join(dir,'.evolution-d3-summary.json');
const d4SummaryPath=dir=>path.join(dir,'.evolution-d4-summary.json');
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;};
const atomic=(p,s)=>{const t=`${p}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,s);fs.renameSync(t,p);};
const depthKey=d=>`D${d}`;
const emptyPool=()=>({active:[],trial:null,waiting:[],retired:{},deferred:{}});

function loadState(dir){let s=null;try{s=JSON.parse(fs.readFileSync(statePath(dir),'utf8'));}catch(_){}if(!s||s.version!==1)s={version:1,active:{},retired:{},latest:{},ladderActive:null,ladderGames:{},ladderRatings:{},evidenceSeen:{},gamesSinceCull:0,birthSerial:1,lastEvent:null,facePools:null};s.active||={};s.retired||={};s.latest||={};s.ladderGames||={};s.ladderRatings||={};s.evidenceSeen||={};s.gamesSinceCull=+s.gamesSinceCull||0;return s;}
function saveState(dir,s){atomic(statePath(dir),JSON.stringify(s,null,1));}
function modelMeta(p){try{const j=JSON.parse(fs.readFileSync(p,'utf8'));if(j&&j.policyEntrant===true){const v=path.join(path.dirname(p),j.valueFile||''),q=path.join(path.dirname(p),j.policyFile||'');if(fs.existsSync(v)&&fs.existsSync(q))return{usable:true,dual:false,policy:true,shape:j.shape||null};}if(j&&j.dual===true)return{usable:true,dual:true,policy:false,shape:Array.isArray(j.sizes)?j.sizes.slice(1,-1).join(','):null};if(j&&Array.isArray(j.sizes)&&j.sizes.length>=3&&+j.sizes.at(-1)===1)return{usable:true,dual:false,policy:false,shape:j.sizes.slice(1,-1).join(',')};}catch(_){}return{usable:false,dual:false,policy:false,shape:null};}
function stableModelEntries(dir){const md=path.join(dir,'models');let files=[];try{files=fs.readdirSync(md);}catch(_){return[];}const out=[];for(const f of files){if(!f.endsWith('.json')||ALIASES.has(f)||/^pool-slot-\d+\.json$/.test(f)||/^best\.pre-pool-/.test(f)||/^dual-startup-probe-/.test(f)||/\.partial\.json$/.test(f))continue;const p=path.join(md,f),m=modelMeta(p);if(m.usable)out.push({name:path.basename(f,'.json'),file:f,path:p,dual:m.dual,policy:m.policy,shape:m.shape});}return out;}
function productionLadderLevels(ladderN=null){try{const d=require('./engine.js').createEngine().AI_LADDER,n=ladderN==null?d.length:Math.min(ladderN,d.length);return d.slice(0,n).map((x,i)=>x&&!x.experimental?i+1:null).filter(Boolean);}catch(_){const n=ladderN==null?11:ladderN;return Array.from({length:n},(_,i)=>i+1);}}
function faceId(name,depth,policy=false){return`${name}${policy?'+P':''}@D${depth}`;}
function splitFaceId(id){const m=String(id).match(/^(.*?)(\+P)?@D([1-4])$/);return m?{name:m[1],policy:!!m[2],depth:+m[3],key:`D${m[3]}${m[2]?'+P':''}`}:null;}
function candidateFaces(e,d){if(e.policy&&d===1)return[];const a=[faceId(e.name,d,false)];if(e.dual)a.push(faceId(e.name,d,true));return a;}
function ensurePools(s){s.facePools||={};for(let d=1;d<=4;d++)s.facePools[depthKey(d)]||=emptyPool();}
function poolIds(p){return[...(p.active||[]),...(p.trial?[p.trial]:[])];}
function activeFaceSet(s){const q=new Set();for(let d=1;d<=4;d++)for(const id of poolIds(s.facePools[depthKey(d)]))q.add(id);return q;}
function elasticRetired(p,id){return !!(p&&p.retired&&p.retired[id]&&p.retired[id].reason==='elastic cull');}
function faceReading(s,id){const x=splitFaceId(id);return x?s.latest[x.name]?.faces?.[x.key]||null:null;}
function faceEstablished(s,id,d){const r=faceReading(s,id);return !!(r&&(+r.games||0)>=FACE_MIN_GAMES[depthKey(d)]&&Number.isFinite(+r.eloHi));}
function modelScore(s,name){const r=s.latest[name]||{},v=[];if(Number.isFinite(+r.eloHi))v.push(+r.eloHi);for(const f of Object.values(r.faces||{}))if(Number.isFinite(+f.eloHi))v.push(+f.eloHi);if(v.length)return Math.max(...v);const q=[];if(Number.isFinite(+r.elo))q.push(+r.elo);for(const f of Object.values(r.faces||{}))if(Number.isFinite(+f.elo))q.push(+f.elo);return q.length?Math.max(...q):-Infinity;}
function modelSerial(name){const m=String(name).match(/(\d+)(?!.*\d)/);return m?+m[1]:-1;}

function reconcile(s,entries){ensurePools(s);const available={};for(let d=1;d<=4;d++)available[depthKey(d)]=new Set(entries.flatMap(e=>candidateFaces(e,d)));
  for(let d=1;d<=4;d++){const k=depthKey(d),p=s.facePools[k],avail=available[k];p.retired=p.retired||{};p.active=[...new Set((p.active||[]).filter(id=>avail.has(id)&&!elasticRetired(p,id)))];p.trial=null;p.waiting=[];p.deferred={};for(const id of Object.keys(p.retired))if(!avail.has(id))delete p.retired[id];}
  const live=activeFaceSet(s);for(const e of entries){let known=false;for(let d=1;d<=4&&!known;d++)for(const id of candidateFaces(e,d))if(live.has(id)||elasticRetired(s.facePools[depthKey(d)],id)){known=true;break;}if(known)continue;for(let d=1;d<=4;d++){const ids=candidateFaces(e,d);if(!ids.length)continue;for(const id of ids){s.facePools[depthKey(d)].active.push(id);live.add(id);}break;}}
  s.queueCompaction={version:4,updated:new Date().toISOString(),catalogueModels:entries.length,queueModels:entries.length,deferredFaces:0,mode:'open Elo league'};
}
function nextFrontier(s,entries){const q=[];for(const e of entries){let highest=0;for(let d=1;d<=4;d++){const p=s.facePools[depthKey(d)],ids=candidateFaces(e,d);if(ids.some(id=>(p.active||[]).includes(id)||elasticRetired(p,id)||!!faceReading(s,id)))highest=d;}if(highest>=4)continue;const prev=Math.max(1,highest),prevIds=candidateFaces(e,prev);if(prevIds.length&&!prevIds.some(id=>faceEstablished(s,id,prev)))continue;for(let d=highest+1;d<=4;d++){const ids=candidateFaces(e,d);if(!ids.length)continue;const fresh=ids.filter(id=>!s.facePools[depthKey(d)].active.includes(id)&&!elasticRetired(s.facePools[depthKey(d)],id));if(fresh.length)q.push({e,depth:d,ids:fresh,score:modelScore(s,e.name),serial:modelSerial(e.name)});break;}}
  q.sort((a,b)=>b.score-a.score||b.serial-a.serial||a.e.name.localeCompare(b.e.name));return q[0]||null;}
function admitFrontier(s,entries){const q=nextFrontier(s,entries);if(!q)return[];for(const id of q.ids)s.facePools[depthKey(q.depth)].active.push(id);return q.ids;}
function sync(dir,ladderN=null){const s=loadState(dir),entries=stableModelEntries(dir),present=new Set(entries.map(e=>e.name));for(const e of entries){s.active[e.name]={file:e.file,dual:e.dual,policy:e.policy,shape:e.shape};delete s.retired[e.name];}for(const n of Object.keys(s.active))if(!present.has(n))delete s.active[n];reconcile(s,entries);const prod=productionLadderLevels(ladderN),allowed=new Set(prod);if(!Array.isArray(s.ladderActive))s.ladderActive=prod;s.ladderActive=[...new Set(s.ladderActive.filter(x=>allowed.has(x)))].sort((a,b)=>a-b);saveState(dir,s);return s;}
function readSummary(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return{players:{}};}}
function ingestSummary(dir,file){const s=sync(dir),sum=readSummary(file),groups={},ladder={};for(const [id,r] of Object.entries(sum.players||{})){if(r.kind==='ladder'){ladder[r.level]={games:+r.games||0,elo:Number.isFinite(+r.elo)?+r.elo:null};continue;}if(r.kind!=='nn'||!r.model)continue;const name=path.basename(r.model,'.json');(groups[name]||=[]).push({...r,id});}
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
function selfplaySlice(dir){return ratingSlice(dir);}
function d3Slice(dir){return modelPathsForFaces(dir,activeFaceIds(dir,[3]));}
function d4Slice(dir){return modelPathsForFaces(dir,activeFaceIds(dir,[4]));}
function activeLadderLevels(dir,ladderN=null){return sync(dir,ladderN).ladderActive.slice();}
function filterFocus(dir,paths){const live=new Set(activeModelNames(dir));return paths.filter(p=>live.has(path.basename(p,'.json')));}
function selfplayProfile(paths,{dir}){const s=sync(dir),entries=paths.map(p=>({path:p,name:path.basename(p,'.json'),meta:modelMeta(p)})),elos=entries.map(e=>s.latest[e.name]?.elo).filter(Number.isFinite),maxE=elos.length?Math.max(...elos):0,raw={},weights={},coverage=[],depthCaps={};let sum=0;for(const e of entries){const elo=s.latest[e.name]?.elo,w=Number.isFinite(elo)?Math.exp((elo-maxE)/ELO_TEMP):1;raw[e.name]=w;sum+=w;}const total=Math.max(1,entries.reduce((a,e)=>a+(s.latest[e.name]?.games||0),0));for(const e of entries){const r=Math.max(1e-9,raw[e.name]/Math.max(sum,1e-9)),g=(s.latest[e.name]?.games||0)/total;weights[e.name]=+(r*r/(g+.01)+Math.sqrt(r)).toFixed(6);let cap=1;for(let d=1;d<=4;d++)if(candidateFaces(e,d).some(id=>poolIds(s.facePools[depthKey(d)]).includes(id)))cap=d;depthCaps[e.name]=cap;for(let d=1;d<=cap;d++)for(const id of candidateFaces(e,d))if(poolIds(s.facePools[depthKey(d)]).includes(id)&&!faceReading(s,id))coverage.push({name:e.name,face:id.includes('+P@')?'policy':'bare',depth:d});}return{weights,coverage,depthCaps};}
function expectedCulls(n){if(n>=TARGET_FACES)return Math.min(10,1+9*Math.min(950,n-TARGET_FACES)/950);return Math.max(0,(n-30)/20);}
function stochasticCount(x){const n=Math.floor(x);return n+(Math.random()<x-n?1:0);}
function eligibleByDepth(s){const out={D1:[],D2:[],D3:[],D4:[]};for(let d=1;d<=4;d++){const k=depthKey(d),need=FACE_MIN_GAMES[k];for(const id of s.facePools[k].active||[]){const r=faceReading(s,id);if(!r||(+r.games||0)<need||!Number.isFinite(+r.eloHi))continue;out[k].push({id,r,depth:d,key:k});}out[k].sort((a,b)=>+a.r.eloHi-+b.r.eloHi||+a.r.elo-+b.r.elo);}return out;}
function chooseDepth(e){const keys=Object.keys(DEPTH_CULL_WEIGHT).filter(k=>e[k]&&e[k].length);if(!keys.length)return null;const total=keys.reduce((s,k)=>s+DEPTH_CULL_WEIGHT[k],0),x=Math.random()*total;let a=0;for(const k of keys){a+=DEPTH_CULL_WEIGHT[k];if(x<a)return k;}return keys.at(-1);}
function cull(dir){const s=sync(dir);if(s.gamesSinceCull<CULL_EVERY_GAMES)return{culled:[],birth:null,admitted:[],state:s};const checkpoints=Math.floor(s.gamesSinceCull/CULL_EVERY_GAMES),culled=[],admitted=[];for(let q=0;q<checkpoints;q++){const population=activeFaceSet(s).size,want=stochasticCount(expectedCulls(population));for(let i=0;i<want;i++){const e=eligibleByDepth(s),k=chooseDepth(e);if(!k)break;const v=e[k][0],p=s.facePools[k],now=new Date().toISOString();p.active=p.active.filter(id=>id!==v.id);p.retired[v.id]={at:now,reason:'elastic cull',eloHi:v.r.eloHi,elo:v.r.elo,games:+v.r.games||0,population};culled.push({type:'face',name:v.id,face:v.id,depth:v.depth,replacedBy:null,result:'elastic-cull'});}admitted.push(...admitFrontier(s,stableModelEntries(dir)));s.gamesSinceCull=Math.max(0,s.gamesSinceCull-CULL_EVERY_GAMES);}if(culled.length||admitted.length)s.lastEvent={at:new Date().toISOString(),culled:culled.map(x=>x.face),admitted,result:'elastic-checkpoint'};saveState(dir,s);return{culled,birth:null,admitted,state:s};}
function noteBirth(dir,birth){if(birth&&birth.outPath&&fs.existsSync(birth.outPath))sync(dir);}
function status(dir){const s=sync(dir),faces={};for(let d=1;d<=4;d++){const k=depthKey(d),p=s.facePools[k];faces[k]={seats:(p.active||[]).length,trial:p.trial?1:0,waiting:(p.waiting||[]).length,deferred:0,retired:Object.keys(p.retired||{}).length,capacity:null};}return{models:activeModelNames(dir).length,ladders:s.ladderActive.length,gamesSinceCull:s.gamesSinceCull,faces,targetFaces:TARGET_FACES};}
function restoreDepthSpecialists(){return[];}function retireBadD4(){return[];}
module.exports={TARGET_MODELS,TARGET_FACES,FACE_CAPS,FACE_MIN_GAMES,DEPTH_CULL_WEIGHT,D3_SHARE,sync,ingestSummary,activeModelNames,activeFaceIds,restoreDepthSpecialists,selfplaySlice,ratingSlice,selfplayProfile,activeLadderLevels,filterFocus,d3Slice,d4Slice,retireBadD4,d3SummaryPath,d4SummaryPath,cull,noteBirth,status};
