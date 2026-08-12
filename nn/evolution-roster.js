'use strict';
const fs = require('fs');
const path = require('path');

const TARGET_MODELS = 50;
const CULL_EVERY_GAMES = 100;
const BULK_CULL_FRAC = 0.10;
const STEADY_CUTOFF_Q = 0.25;
const SELFPLAY_SLICE = 50;
const RATING_SLICE = 50;
const D3_SLICE = 8;
const D4_SLICE = 3;
const ELO_TEMP = 400;
const PROTECTED_LADDER_COUNT = 6;
const D3_SHARE = 0.04;
const ALIASES = new Set(['best.json','value.json','scratch.json','wide.json','ultra.json','deep.json','l15_value.json']);

const statePath = dir => path.join(dir, 'models', '.evolution-roster.json');
const d3SummaryPath = dir => path.join(dir, '.evolution-d3-summary.json');
const d4SummaryPath = dir => path.join(dir, '.evolution-d4-summary.json');
const mean = xs => { const a = xs.filter(Number.isFinite); return a.length ? a.reduce((s,x)=>s+x,0)/a.length : null; };
const q = (xs, p) => {
  const a = xs.filter(Number.isFinite).sort((x,y)=>x-y);
  if (!a.length) return null;
  const x = (a.length - 1)*p, lo = Math.floor(x), hi = Math.ceil(x);
  return lo === hi ? a[lo] : a[lo] + (a[hi]-a[lo])*(x-lo);
};
const atomicWrite = (p, data) => {
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data); fs.renameSync(tmp, p);
};

function loadState(dir) {
  let s = null;
  try { s = JSON.parse(fs.readFileSync(statePath(dir), 'utf8')); } catch (_) {}
  if (!s || s.version !== 1) s = { version:1, active:{}, retired:{}, latest:{}, ladderActive:null,
    ladderGames:{}, ladderRatings:{}, evidenceSeen:{}, gamesSinceCull:0, cursor:0, birthSerial:1, lastEvent:null,
    d4Retired:{} };
  s.active ||= {}; s.retired ||= {}; s.latest ||= {}; s.ladderGames ||= {}; s.ladderRatings ||= {}; s.evidenceSeen ||= {};
  s.d4Retired ||= {};
  s.gamesSinceCull = +s.gamesSinceCull || 0; s.cursor = +s.cursor || 0; s.birthSerial = +s.birthSerial || 1;
  return s;
}
function saveState(dir, s) { atomicWrite(statePath(dir), JSON.stringify(s, null, 1)); }

function modelMeta(p) {
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (j && j.dual === true) return { usable:true, dual:true, shape:Array.isArray(j.sizes)?j.sizes.slice(1,-1).join(','):null };
    if (j && Array.isArray(j.sizes) && j.sizes.length >= 3 && +j.sizes[j.sizes.length-1] === 1)
      return { usable:true, dual:false, shape:j.sizes.slice(1,-1).join(',') };
  } catch (_) {}
  return { usable:false, dual:false, shape:null };
}
function stableModelEntries(dir) {
  const md = path.join(dir, 'models');
  let files = [];
  try { files = fs.readdirSync(md); } catch (_) { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json') || ALIASES.has(f) || /^pool-slot-\d+\.json$/.test(f) ||
        /^best\.pre-pool-/.test(f) || /^dual-startup-probe-/.test(f) || /\.partial\.json$/.test(f)) continue;
    const p = path.join(md, f), m = modelMeta(p);
    if (!m.usable) continue;
    out.push({ name:path.basename(f,'.json'), file:f, path:p, dual:m.dual, shape:m.shape });
  }
  return out;
}
function sync(dir, ladderN=11) {
  const s = loadState(dir);
  const entries = stableModelEntries(dir);
  for (const e of entries) if (!s.retired[e.name]) s.active[e.name] = { file:e.file, dual:e.dual, shape:e.shape };
  for (const name of Object.keys(s.active)) {
    const p = path.join(dir,'models',s.active[name].file || `${name}.json`);
    if (!fs.existsSync(p)) delete s.active[name];
  }
  if (!Array.isArray(s.ladderActive)) s.ladderActive = Array.from({length:ladderN},(_,i)=>i+1);
  s.ladderActive = [...new Set(s.ladderActive.filter(x=>x>=1&&x<=ladderN))].sort((a,b)=>a-b);
  saveState(dir,s);
  return s;
}

function readSummary(file) { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch (_) { return {players:{}}; } }
function ingestSummary(dir, summaryFile) {
  const s = sync(dir);
  const sum = readSummary(summaryFile);
  const groups = {}, ladder = {};
  for (const [id,r] of Object.entries(sum.players || {})) {
    if (r.kind === 'ladder') {
      ladder[r.level] = { games:+r.games || 0, elo:Number.isFinite(+r.elo) ? +r.elo : null };
      continue;
    }
    if (r.kind !== 'nn' || !r.model) continue;
    const name = path.basename(r.model,'.json');
    (groups[name] ||= []).push({...r,id});
  }
  let evidenceDelta = 0;
  for (const [name, rows] of Object.entries(groups)) {
    const base = rows.filter(r => r.depth === 1 || r.depth === 2);
    const use = base.length ? base : rows;
    const ranks = use.filter(r=>Number.isFinite(r.rank));
    const rec = s.latest[name] || {};
    const depthGames = {...(rec.depthGames||{})};
    for (const d of [1,2,3,4]) depthGames[d] = Math.max(depthGames[d]||0,
      rows.filter(r=>r.depth===d).reduce((a,r)=>a+(+r.games||0),0));
    const depthElo = {...(rec.depthElo||{})};
    for (const d of [1,2,3,4]) {
      const vals=rows.filter(r=>r.depth===d&&Number.isFinite(+r.elo)).map(r=>+r.elo);
      if(vals.length) depthElo[d]=mean(vals);
    }
    const games = use.reduce((a,r)=>a+(+r.games||0),0);
    s.latest[name] = {
      elo: mean(use.map(r=>r.elo)), rank: mean(ranks.map(r=>r.rank)),
      rankLo: mean(ranks.map(r=>r.rankLo)), rankHi: mean(ranks.map(r=>r.rankHi)),
      games: Math.max(rec.games||0, games), depthGames, depthElo,
      updated: sum.updated || new Date().toISOString()
    };
    const prev = +s.evidenceSeen[name] || 0;
    if (games > prev) evidenceDelta += games - prev;
    s.evidenceSeen[name] = Math.max(prev, games);
  }
  for (const [lvl, lr] of Object.entries(ladder)) {
    const g = +lr.games || 0;
    const prev = +s.ladderGames[lvl] || 0;
    if (g > prev) evidenceDelta += g - prev;
    s.ladderGames[lvl] = Math.max(prev,g);
    const old = s.ladderRatings[lvl] || {};
    s.ladderRatings[lvl] = {
      elo: Number.isFinite(lr.elo) ? lr.elo : (Number.isFinite(old.elo) ? old.elo : null),
      games: Math.max(+old.games || 0, g),
      updated: sum.updated || new Date().toISOString()
    };
  }
  s.gamesSinceCull += evidenceDelta/2;
  saveState(dir,s);
  return s;
}

function activeNames(s) { return Object.keys(s.active); }
function ratingPriority(s, name) {
  const r=s.latest[name]||{}, d=r.depthGames||{};
  const missing=(d[1]>0?0:2)+(d[2]>0?0:1);
  return missing*1e9 + (Number.isFinite(r.rankHi)&&Number.isFinite(r.rankLo)?(r.rankHi-r.rankLo)*1e6:5e8) - (r.games||0);
}
function chooseSlice(dir, maxN, advance=false) {
  const s=sync(dir), names=activeNames(s);
  names.sort((a,b)=>ratingPriority(s,b)-ratingPriority(s,a) || a.localeCompare(b,undefined,{numeric:true}));
  if (!names.length) return [];
  const n=Math.min(maxN,names.length), start=s.cursor % names.length;
  const head=names.slice(0, Math.min(n, Math.ceil(n*0.8)));
  const headSet=new Set(head), tail=names.filter(x=>!headSet.has(x));
  const fill=[];
  for(let i=0;i<tail.length&&head.length+fill.length<n;i++) fill.push(tail[(start+i)%tail.length]);
  if (advance) { s.cursor=(start+Math.max(1,fill.length))%names.length; saveState(dir,s); }
  return [...head,...fill].slice(0,n).map(name=>path.join(dir,'models',s.active[name].file));
}
function selfplaySlice(dir) { return chooseSlice(dir,SELFPLAY_SLICE,true); }
function ratingSlice(dir) { return chooseSlice(dir,RATING_SLICE,false); }

function rosterMedian(s) { return q(activeNames(s).map(n=>s.latest[n]&&s.latest[n].rank),0.5); }
function earnedD3(s,name) {
  const r=s.latest[name]; if(!r) return false;
  const med=rosterMedian(s), d=r.depthGames||{};
  return Number.isFinite(med)&&Number.isFinite(r.rankLo)&&d[1]>0&&d[2]>0&&r.rankLo>med;
}
function d3Slice(dir) {
  const s=sync(dir), med=rosterMedian(s);
  if(!Number.isFinite(med)) return [];
  return activeNames(s).filter(n=>earnedD3(s,n))
    .sort((a,b)=>((s.latest[b].rankLo||-Infinity)-(s.latest[a].rankLo||-Infinity)) ||
                  ((s.latest[a].depthGames?.[3]||0)-(s.latest[b].depthGames?.[3]||0)))
    .slice(0,D3_SLICE).map(n=>path.join(dir,'models',s.active[n].file));
}
function d4Slice(dir) {
  const s=sync(dir);
  return activeNames(s).filter(n=>earnedD3(s,n) && (s.latest[n]?.depthGames?.[3]||0)>0 && !s.d4Retired[n])
    .sort((a,b)=>(s.latest[b].rankLo||-Infinity)-(s.latest[a].rankLo||-Infinity))
    .slice(0,D4_SLICE).map(n=>path.join(dir,'models',s.active[n].file));
}
function retireBadD4(dir) {
  const s=sync(dir), retired=[];
  for(const name of activeNames(s)) {
    const r=s.latest[name]||{}, dg=r.depthGames||{}, de=r.depthElo||{};
    if((dg[4]||0)<2 || !Number.isFinite(de[3]) || !Number.isFinite(de[4])) continue;
    if(de[4] < de[3]) {
      s.d4Retired[name]={at:new Date().toISOString(),d3Elo:de[3],d4Elo:de[4],d4Games:dg[4]};
      retired.push(name);
    }
  }
  if(retired.length) saveState(dir,s);
  return retired;
}
function activeLadderLevels(dir, ladderN=11) { return sync(dir,ladderN).ladderActive.slice(); }
function filterFocus(dir, paths) {
  const s=sync(dir), active=new Set(activeNames(s));
  return paths.filter(p=>active.has(path.basename(p,'.json')));
}

function selfplayProfile(paths, {dir}) {
  const s=sync(dir);
  const entries=paths.map(p=>({path:p,name:path.basename(p,'.json'),meta:modelMeta(p)}));
  const elos=entries.map(e=>s.latest[e.name]?.elo).filter(Number.isFinite);
  const maxE=elos.length?Math.max(...elos):0;
  const rawR={}; let sumR=0;
  for(const e of entries){ const elo=s.latest[e.name]?.elo; const rr=Number.isFinite(elo)?Math.exp((elo-maxE)/ELO_TEMP):1; rawR[e.name]=rr; sumR+=rr; }
  const totalGames=Math.max(1,entries.reduce((a,e)=>a+(s.latest[e.name]?.games||0),0));
  const weights={}, coverage=[], depthCaps={};
  for(const e of entries){
    const r=Math.max(1e-9,rawR[e.name]/Math.max(sumR,1e-9));
    const g=(s.latest[e.name]?.games||0)/totalGames;
    weights[e.name]=+(r*r/(g+0.01)+Math.sqrt(r)).toFixed(6);
    const rec=s.latest[e.name]||{}, dg=rec.depthGames||{};
    const d3=earnedD3(s,e.name); depthCaps[e.name]=d3?3:2;
    if(e.meta.dual){
      for(const depth of [1,2]) if((dg[depth]||0)<=0){ coverage.push({name:e.name,face:'bare',depth}); coverage.push({name:e.name,face:'policy',depth}); }
      if(d3 && (dg[3]||0)<=0){ coverage.push({name:e.name,face:'bare',depth:3}); coverage.push({name:e.name,face:'policy',depth:3}); }
    } else {
      for(const depth of [1,2]) if((dg[depth]||0)<=0) coverage.push({name:e.name,face:'bare',depth});
      if(d3 && (dg[3]||0)<=0) coverage.push({name:e.name,face:'bare',depth:3});
    }
  }
  return {weights,coverage,depthCaps};
}

function removeFromLegacyRegistries(dir,file) {
  const specs=[['.dual-pop.json', j=>{ if(Array.isArray(j.active)) j.active=j.active.filter(x=>x&&x.file!==file); if(j.pending&&j.pending.victim===file) j.pending=null; return j; }],['.mutant-pop.json', j=>{ if(Array.isArray(j.active)) j.active=j.active.filter(x=>x&&x.file!==file); return j; }]];
  for(const [name,edit] of specs){ const p=path.join(dir,'models',name); try{ const j=edit(JSON.parse(fs.readFileSync(p,'utf8'))); atomicWrite(p,JSON.stringify(j,null,1)); }catch(_){} }
}
function protectedLadderLevels(s) {
  const active = s.ladderActive.slice();
  const need = Math.min(PROTECTED_LADDER_COUNT, active.length);
  const rated = active.map(level => ({ level, elo:s.ladderRatings[level]?.elo })).filter(x => Number.isFinite(x.elo)).sort((a,b) => b.elo - a.elo);
  if (rated.length < need) return new Set(active);
  return new Set(rated.slice(0, need).map(x => x.level));
}
function cull(dir) {
  const s=sync(dir);
  if(s.gamesSinceCull < CULL_EVERY_GAMES) return {culled:[],birth:null,state:s};
  s.gamesSinceCull = Math.max(0, s.gamesSinceCull - CULL_EVERY_GAMES);
  const names=activeNames(s), modelCount=names.length;
  const protectedLadders=protectedLadderLevels(s);
  const cullableLadders=s.ladderActive.filter(l=>!protectedLadders.has(l) && (s.ladderGames[l]||0)>=4);
  const measured=names.map(name=>({type:'model',name,...(s.latest[name]||{})})).filter(x=>Number.isFinite(x.rank)&&Number.isFinite(x.rankHi)&&x.games>=4);
  const ladderEntries=cullableLadders.map(level=>({type:'ladder',name:`L${level}`,level,rank:level,rankHi:level,games:s.ladderGames[level]||0}));
  const culled=[];
  if(modelCount>TARGET_MODELS){
    const eligible=[...measured,...ladderEntries].sort((a,b)=>a.rankHi-b.rankHi || a.rank-b.rank);
    let want=Math.max(1,Math.ceil(eligible.length*BULK_CULL_FRAC));
    let modelRoom=Math.max(0,modelCount-TARGET_MODELS);
    for(const x of eligible){ if(culled.length>=want) break; if(x.type==='model' && modelRoom<=0) continue; culled.push(x); if(x.type==='model') modelRoom--; }
  } else {
    const strengths=[...measured.map(x=>x.rank),...s.ladderActive.map(Number)];
    const cut=q(strengths,STEADY_CUTOFF_Q);
    if(Number.isFinite(cut)){
      const eligible=[...measured.filter(x=>x.rankHi<cut),...ladderEntries.filter(x=>x.level<cut)].sort((a,b)=>a.rankHi-b.rankHi);
      if(eligible.length) culled.push(eligible[0]);
    }
  }
  let birth=null;
  for(const x of culled){
    if(x.type==='ladder') s.ladderActive=s.ladderActive.filter(l=>l!==x.level);
    else { const old=s.active[x.name]||{}; s.retired[x.name]={...old,retiredAt:new Date().toISOString(),rank:x.rank,rankHi:x.rankHi}; delete s.active[x.name]; delete s.d4Retired[x.name]; if(old.file) removeFromLegacyRegistries(dir,old.file); }
  }
  if(modelCount<=TARGET_MODELS){
    const deadModel=culled.find(x=>x.type==='model');
    if(deadModel){
      const parents=activeNames(s).map(name=>({name,info:s.active[name],r:s.latest[name]})).filter(x=>x.info&&!x.info.dual&&x.r&&Number.isFinite(x.r.rankLo)&&x.info.shape).sort((a,b)=>b.r.rankLo-a.r.rankLo);
      if(parents.length){ const parent=parents[0], serial=String(s.birthSerial++).padStart(4,'0'); const kinds=['scratch','mutant','extra']; const kind=kinds[(s.birthSerial-2)%kinds.length]; birth={kind,serial,parent:parent.name,parentFile:parent.info.file,parentPath:path.join(dir,'models',parent.info.file),shape:parent.info.shape,outPath:path.join(dir,'models',`evo-${serial}-${kind}.json`)}; }
    }
  }
  s.lastEvent={at:new Date().toISOString(),culled:culled.map(x=>x.name),birth};
  saveState(dir,s);
  return {culled,birth,state:s};
}
function noteBirth(dir,birth){ if(!birth||!birth.outPath||!fs.existsSync(birth.outPath)) return; const s=sync(dir), name=path.basename(birth.outPath,'.json'), meta=modelMeta(birth.outPath); if(meta.usable&&!s.retired[name]) s.active[name]={file:path.basename(birth.outPath),dual:meta.dual,shape:meta.shape}; saveState(dir,s); }
function status(dir){ const s=sync(dir); return {models:activeNames(s).length,ladders:s.ladderActive.length,gamesSinceCull:s.gamesSinceCull,median:rosterMedian(s)}; }
module.exports={D3_SHARE,sync,ingestSummary,selfplaySlice,ratingSlice,selfplayProfile,activeLadderLevels,filterFocus,d3Slice,d4Slice,retireBadD4,d3SummaryPath,d4SummaryPath,cull,noteBirth,status};
