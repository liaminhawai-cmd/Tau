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
// Read from every summary this clone can see -- this machine's, plus the pre-naming shared file so
// a semantics bump still seeds from ratings measured before summaries were named. Write to only
// THIS machine's: blanking the shared tracked file would put a diff on it again, which is the whole
// conflict machine-id.js's summaryFile exists to remove.
const summariesWrite=dir=>[require('./machine-id.js').summaryFile(dir),path.join(dir,'.evolution-d3-summary.json'),path.join(dir,'.evolution-d4-summary.json')];
const summariesRead=dir=>[...new Set([...summariesWrite(dir),path.join(dir,'elo-summary.json')])];
const {atomicWrite}=require('./atomic-write.js');
const atomic=(p,s)=>atomicWrite(p,s,{mkdir:true});
const read=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(_){return d;}};
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');

function current(dir){const r=read(resultsPath(dir),{});return +r.ratingSemanticsVersion||0;}
function copy(src,dst){if(!fs.existsSync(src))return false;fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);return true;}
function modelExists(dir,id){const m=String(id).match(/^(.*?)(?:\+P)?@D[1-9]$/);return !!(m&&fs.existsSync(path.join(dir,'models',m[1]+'.json')));}

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
function summarySeeds(dir){const out={};for(const f of summariesRead(dir)){const s=read(f,{players:{}});for(const [id,r] of Object.entries(s.players||{}))if(Number.isFinite(+r.elo))out[id]=+r.elo;}return out;}
function archivedSeed(dir){
  const base=path.join(dir,'elo-archive');let dirs=[];try{dirs=fs.readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort().reverse();}catch(_){}
  for(const d of dirs){const r=read(path.join(base,d,'elo-results.json'),null);if(!r)continue;if(r.seedElo&&Object.keys(r.seedElo).length)return r.seedElo;const fit=fitOld(r.results);if(Object.keys(fit).length)return fit;}return{};
}
function seedFromCurrent(dir,old){const direct=old&&old.seedElo&&Object.keys(old.seedElo).length?old.seedElo:fitOld(old&&old.results);const fallback=Object.keys(direct||{}).length?direct:archivedSeed(dir);return{...summarySeeds(dir),...fallback};}

function resetRoster(dir,now){
  const p=rosterPath(dir),s=read(p,null);if(!s)return 0;let reopened=0;
  for(const key of ['D1','D2','D3','D4','D5','D6']){const pool=s.facePools&&s.facePools[key];if(!pool)continue;const active=new Set(pool.active||[]),retired=pool.retired||{};for(const [id,meta] of Object.entries(retired))if(meta&&meta.reason==='elastic cull'&&modelExists(dir,id)){active.add(id);delete retired[id];reopened++;}pool.active=[...active];pool.retired=retired;pool.trial=null;pool.waiting=[];pool.deferred={};}
  s.latest={};s.ladderGames={};s.ladderRatings={};s.evidenceSeen={};s.gamesSinceCull=0;s.ratingSemanticsVersion=VERSION;s.lastEvent={at:now,result:'rating-semantics-reset',reopenedFaces:reopened};atomic(p,JSON.stringify(s,null,1));return reopened;
}

function ensure(dir,{force=false}={}){
  if(!force&&current(dir)===VERSION)return{reset:false,version:VERSION};
  const old=read(resultsPath(dir),{}),seedElo=seedFromCurrent(dir,old),now=new Date().toISOString(),archive=path.join(dir,'elo-archive',stamp());
  for(const p of [resultsPath(dir),path.join(dir,'elo-inbox.jsonl'),...summariesRead(dir),rosterPath(dir)])copy(p,path.join(archive,path.basename(p)));
  atomic(path.join(archive,'RESET-METADATA.json'),JSON.stringify({archivedAt:now,reason:'rating semantics changed',newSemantics:SEMANTICS,seedPlayers:Object.keys(seedElo).length},null,2));
  const reopened=resetRoster(dir,now);
  atomic(resultsPath(dir),JSON.stringify({ratingSemanticsVersion:VERSION,semantics:SEMANTICS,createdAt:now,seedWeightMatches:1,seedElo,results:{},recent:[]},null,1));
  try{fs.unlinkSync(path.join(dir,'elo-inbox.jsonl'));}catch(_){}
  const blank=JSON.stringify({updated:now,ratingSemanticsVersion:VERSION,semantics:SEMANTICS,players:{}},null,1);for(const p of summariesWrite(dir))atomic(p,blank);
  console.log(`[rating] clean Elo v${VERSION}: ${SEMANTICS}`);
  console.log(`[rating] ${Object.keys(seedElo).length} old point ratings kept as one-match priors; official game counts reset to zero`);
  console.log(`[rating] old state archived to ${archive}; ${reopened} elastic-culled face(s) reopened for fair remeasurement`);
  return{reset:true,version:VERSION,archive,reopened,seedPlayers:Object.keys(seedElo).length};
}
// Search epoch 2: every depth-3+ nn search now scores a move at the end of its principal line
// (nnai.js), where epoch 1 scored it two plies ahead at every depth. D1 and D2 faces play exactly
// as before; every D3+ face is a different player under the same name. So, once, the evidence on
// D3+ faces is dropped -- their results, their one-match priors and the roster's readings of them
// -- and they are re-measured from scratch as they stand. Everything else is untouched, and the
// old files are archived first. Retired D3+ faces stay retired (the frontier re-promotes models
// that earn it); seated ones keep their seats.
const SEARCH_EPOCH=2;
const deepFaceId=id=>/@D([3-9])$/.test(String(id));
function ensureSearchEpoch(dir){
  const r=read(resultsPath(dir),null);if(!r||(+r.searchEpoch||1)>=SEARCH_EPOCH)return{purged:false};
  const now=new Date().toISOString(),archive=path.join(dir,'elo-archive',stamp()+'-search-epoch-'+SEARCH_EPOCH);
  for(const p of [resultsPath(dir),...summariesRead(dir),rosterPath(dir)])copy(p,path.join(archive,path.basename(p)));
  let results=0,seeds=0;
  for(const k of Object.keys(r.results||{})){const z=k.indexOf('|');if(z<1)continue;if(deepFaceId(k.slice(0,z))||deepFaceId(k.slice(z+1))){delete r.results[k];results++;}}
  for(const id of Object.keys(r.seedElo||{}))if(deepFaceId(id)){delete r.seedElo[id];seeds++;}
  r.recent=(r.recent||[]).filter(x=>!deepFaceId(x&&x.a)&&!deepFaceId(x&&x.b));
  r.searchEpoch=SEARCH_EPOCH;atomic(resultsPath(dir),JSON.stringify(r,null,1));
  let readings=0;const ro=read(rosterPath(dir),null);
  if(ro){for(const rec of Object.values(ro.latest||{})){for(const k of Object.keys(rec.faces||{}))if(/^D([3-9])/.test(k)){delete rec.faces[k];readings++;}
      for(const t of ['depthGames','depthElo'])for(const k of Object.keys(rec[t]||{}))if(+k>=3)delete rec[t][k];}
    ro.lastEvent={at:now,result:'search-epoch-'+SEARCH_EPOCH,droppedReadings:readings};atomic(rosterPath(dir),JSON.stringify(ro,null,1));}
  for(const p of summariesWrite(dir)){const sm=read(p,null);if(!sm||!sm.players)continue;for(const id of Object.keys(sm.players))if(deepFaceId(id))delete sm.players[id];atomic(p,JSON.stringify(sm,null,1));}
  atomic(path.join(archive,'RESET-METADATA.json'),JSON.stringify({archivedAt:now,reason:'search epoch '+SEARCH_EPOCH+': depth-3+ searches score at the end of the line',droppedResults:results,droppedSeeds:seeds,droppedReadings:readings},null,2));
  console.log(`[rating] search epoch ${SEARCH_EPOCH}: D3+ faces now score moves at the end of the line; dropped ${results} result(s), ${seeds} prior(s) and ${readings} roster reading(s) on D3+ faces so they re-measure from scratch (old files in ${archive})`);
  return{purged:true,results,seeds,readings,archive};
}
module.exports={VERSION,SEMANTICS,SEARCH_EPOCH,ensure,ensureSearchEpoch,current};
if(require.main===module)ensure(__dirname,{force:process.argv.includes('--force')});
