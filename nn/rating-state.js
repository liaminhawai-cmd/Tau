'use strict';
const fs=require('fs');
const path=require('path');

// One rating semantics. Bump this only when the meaning of an official game changes.
const VERSION=3;
const SEMANTICS='unified-temp0-standard-opening-league';
const resultsPath=dir=>path.join(dir,'elo-results.json');
const rosterPath=dir=>path.join(dir,'models','.evolution-roster.json');
const summaries=dir=>[path.join(dir,'elo-summary.json'),path.join(dir,'.evolution-d3-summary.json'),path.join(dir,'.evolution-d4-summary.json')];
const atomic=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});const t=`${p}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,s);fs.renameSync(t,p);};
const read=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(_){return d;}};
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');

function current(dir){const r=read(resultsPath(dir),{});return +r.ratingSemanticsVersion||0;}
function copy(src,dst){if(!fs.existsSync(src))return false;fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);return true;}
function modelExists(dir,id){const m=String(id).match(/^(.*?)(?:\+P)?@D[1-4]$/);return !!(m&&fs.existsSync(path.join(dir,'models',m[1]+'.json')));}

function resetRoster(dir,now){
  const p=rosterPath(dir),s=read(p,null);if(!s)return 0;
  let reopened=0;
  for(const key of ['D1','D2','D3','D4']){
    const pool=s.facePools&&s.facePools[key];if(!pool)continue;
    const active=new Set(pool.active||[]),retired=pool.retired||{};
    for(const [id,meta] of Object.entries(retired))if(meta&&meta.reason==='elastic cull'&&modelExists(dir,id)){
      active.add(id);delete retired[id];reopened++;
    }
    pool.active=[...active];pool.retired=retired;pool.trial=null;pool.waiting=[];pool.deferred={};
  }
  // Every rating-derived cache is invalid after a semantics change. Models and training data are not.
  s.latest={};s.ladderGames={};s.ladderRatings={};s.evidenceSeen={};s.gamesSinceCull=0;
  s.ratingSemanticsVersion=VERSION;s.lastEvent={at:now,result:'rating-semantics-reset',reopenedFaces:reopened};
  atomic(p,JSON.stringify(s,null,1));return reopened;
}

function ensure(dir,{force=false}={}){
  if(!force&&current(dir)===VERSION)return{reset:false,version:VERSION};
  const now=new Date().toISOString(),archive=path.join(dir,'elo-archive',stamp());
  for(const p of [resultsPath(dir),path.join(dir,'elo-inbox.jsonl'),...summaries(dir),rosterPath(dir)])
    copy(p,path.join(archive,path.basename(p)));
  atomic(path.join(archive,'RESET-METADATA.json'),JSON.stringify({archivedAt:now,reason:'rating semantics changed',newSemantics:SEMANTICS},null,2));
  const reopened=resetRoster(dir,now);
  atomic(resultsPath(dir),JSON.stringify({ratingSemanticsVersion:VERSION,semantics:SEMANTICS,createdAt:now,results:{},recent:[]},null,1));
  try{fs.unlinkSync(path.join(dir,'elo-inbox.jsonl'));}catch(_){}
  const blank=JSON.stringify({updated:now,ratingSemanticsVersion:VERSION,semantics:SEMANTICS,players:{}},null,1);
  for(const p of summaries(dir))atomic(p,blank);
  console.log(`[rating] clean Elo v${VERSION}: ${SEMANTICS}`);
  console.log(`[rating] old rating state archived to ${archive}; ${reopened} elastic-culled face(s) reopened for fair remeasurement`);
  return{reset:true,version:VERSION,archive,reopened};
}

module.exports={VERSION,SEMANTICS,ensure,current};
if(require.main===module)ensure(__dirname,{force:process.argv.includes('--force')});
