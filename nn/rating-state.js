'use strict';
const fs=require('fs');
const path=require('path');

// v4 changes only rating semantics: old Elo becomes ONE weak virtual-match prior, while every
// official evidence count returns to zero. The first clean colour-balanced matches can therefore
// move a bad old estimate immediately without paying to rediscover the whole ordering from scratch.
const VERSION=4;
const SEMANTICS='unified-temp0-two-colour-match-league';
const resultsPath=dir=>path.join(dir,'elo-results.json');
const rosterPath=dir=>path.join(dir,'models','.evolution-roster.json');
const summaries=dir=>[path.join(dir,'elo-summary.json'),path.join(dir,'.evolution-d3-summary.json'),path.join(dir,'.evolution-d4-summary.json')];
const atomic=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});const t=`${p}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,s);fs.renameSync(t,p);};
const read=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(_){return d;}};
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');

function current(dir){const r=read(resultsPath(dir),{});return +r.ratingSemanticsVersion||0;}
function copy(src,dst){if(!fs.existsSync(src))return false;fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);return true;}
function modelExists(dir,id){const m=String(id).match(/^(.*?)(?:\+P)?@D[1-4]$/);return !!(m&&fs.existsSync(path.join(dir,'models',m[1]+'.json')));}

// Recreate the CURRENT point Elo of any old result graph. This is not retained as evidence: it is
// only where the clean graph starts. One virtual match per player in elorank-legacy makes this prior
// intentionally weak, so two or four clean physical games can move a fishy rating hard.
function fitOld(results){
  const ids=new Set(),pairs=[];
  for(const [k,r] of Object.entries(results||{})){const z=k.indexOf('|');if(z<1)continue;const a=k.slice(0,z),b=k.slice(z+1),n=(+r.w||0)+(+r.l||0)+(+r.d||0);if(!a||!b||a===b||!n)continue;ids.add(a);ids.add(b);pairs.push([a,b,+r.w||0,+r.l||0,+r.d||0,n]);}
  const list=[...ids];if(!list.length)return{};const ix=Object.fromEntries(list.map((id,i)=>[id,i])),wins=Array(list.length).fill(0),edges=[];
  for(const [a,b,w,l,d,n] of pairs){const i=ix[a],j=ix[b];wins[i]+=w+d/2;wins[j]+=l+d/2;edges.push([i,j,n]);}
  let p=Array(list.length).fill(1);for(let it=0;it<300;it++){const den=p.map(v=>1/(v+1));for(const [i,j,n] of edges){const q=n/Math.max(1e-12,p[i]+p[j]);den[i]+=q;den[j]+=q;}const next=p.map((_,i)=>(wins[i]+.5)/Math.max(1e-12,den[i])),geo=Math.exp(next.reduce((s,v)=>s+Math.log(Math.max(v,1e-12)),0)/next.length);let d=0;for(let i=0;i<next.length;i++){next[i]/=geo;d=Math.max(d,Math.abs(next[i]-p[i]));}p=next;if(d<1e-8)break;}
  return Object.fromEntries(list.map((id,i)=>[id,+((400*Math.log10(Math.max(p[i],1e-12))).toFixed(3))]));
}
function summarySeeds(dir){const out={};for(const f of summaries(dir)){const s=read(f,{players:{}});for(const [id,r] of Object.entries(s.players||{}))if(Number.isFinite(+r.elo))out[id]=+r.elo;}return out;}
function archivedSeed(dir){
  const base=path.join(dir,'elo-archive');let dirs=[];try{dirs=fs.readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort().reverse();}catch(_){}
  for(const d of dirs){const r=read(path.join(base,d,'elo-results.json'),null);if(!r)continue;if(r.seedElo&&Object.keys(r.seedElo).length)return r.seedElo;const fit=fitOld(r.results);if(Object.keys(fit).length)return fit;}return{};
}
function seedFromCurrent(dir,old){const direct=old&&old.seedElo&&Object.keys(old.seedElo).length?old.seedElo:fitOld(old&&old.results);const fallback=Object.keys(direct||{}).length?direct:archivedSeed(dir);return{...summarySeeds(dir),...fallback};}

function resetRoster(dir,now){
  const p=rosterPath(dir),s=read(p,null);if(!s)return 0;let reopened=0;
  for(const key of ['D1','D2','D3','D4']){const pool=s.facePools&&s.facePools[key];if(!pool)continue;const active=new Set(pool.active||[]),retired=pool.retired||{};for(const [id,meta] of Object.entries(retired))if(meta&&meta.reason==='elastic cull'&&modelExists(dir,id)){active.add(id);delete retired[id];reopened++;}pool.active=[...active];pool.retired=retired;pool.trial=null;pool.waiting=[];pool.deferred={};}
  s.latest={};s.ladderGames={};s.ladderRatings={};s.evidenceSeen={};s.gamesSinceCull=0;s.ratingSemanticsVersion=VERSION;s.lastEvent={at:now,result:'rating-semantics-reset',reopenedFaces:reopened};atomic(p,JSON.stringify(s,null,1));return reopened;
}

function ensure(dir,{force=false}={}){
  if(!force&&current(dir)===VERSION)return{reset:false,version:VERSION};
  const old=read(resultsPath(dir),{}),seedElo=seedFromCurrent(dir,old),now=new Date().toISOString(),archive=path.join(dir,'elo-archive',stamp());
  for(const p of [resultsPath(dir),path.join(dir,'elo-inbox.jsonl'),...summaries(dir),rosterPath(dir)])copy(p,path.join(archive,path.basename(p)));
  atomic(path.join(archive,'RESET-METADATA.json'),JSON.stringify({archivedAt:now,reason:'rating semantics changed',newSemantics:SEMANTICS,seedPlayers:Object.keys(seedElo).length},null,2));
  const reopened=resetRoster(dir,now);
  atomic(resultsPath(dir),JSON.stringify({ratingSemanticsVersion:VERSION,semantics:SEMANTICS,createdAt:now,seedWeightMatches:1,seedElo,results:{},recent:[]},null,1));
  try{fs.unlinkSync(path.join(dir,'elo-inbox.jsonl'));}catch(_){}
  const blank=JSON.stringify({updated:now,ratingSemanticsVersion:VERSION,semantics:SEMANTICS,players:{}},null,1);for(const p of summaries(dir))atomic(p,blank);
  console.log(`[rating] clean Elo v${VERSION}: ${SEMANTICS}`);
  console.log(`[rating] ${Object.keys(seedElo).length} old point ratings kept as one-match priors; official game counts reset to zero`);
  console.log(`[rating] old state archived to ${archive}; ${reopened} elastic-culled face(s) reopened for fair remeasurement`);
  return{reset:true,version:VERSION,archive,reopened,seedPlayers:Object.keys(seedElo).length};
}
module.exports={VERSION,SEMANTICS,ensure,current};
if(require.main===module)ensure(__dirname,{force:process.argv.includes('--force')});
