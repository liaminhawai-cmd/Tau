'use strict';
const fs=require('fs');
const path=require('path');

const VERSION=2;
const SEMANTICS='temp0-standard-opening-arena-only';
const MIN_ANCHOR_GAMES=24;
const TOP_ANCHORS=[9,10,11];

const resultsPath=dir=>path.join(dir,'elo-results.json');
const inboxPath=dir=>path.join(dir,'elo-inbox.jsonl');
const rosterPath=dir=>path.join(dir,'models','.evolution-roster.json');
const summaryPaths=dir=>[
  path.join(dir,'elo-summary.json'),
  path.join(dir,'.evolution-d3-summary.json'),
  path.join(dir,'.evolution-d4-summary.json'),
];
const atomicWrite=(p,data)=>{const t=`${p}.tmp-${process.pid}-${Date.now()}`;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(t,data);fs.renameSync(t,p);};
const readJson=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(_){return d;}};
const safeStamp=()=>new Date().toISOString().replace(/[:.]/g,'-');

function resultVersion(dir){const r=readJson(resultsPath(dir),{});return +r.ratingSemanticsVersion||0;}
function copyIfExists(src,dst){if(!fs.existsSync(src))return false;fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);return true;}
function faceModelExists(dir,id){const m=String(id).match(/^(.*?)(?:\+P)?@D[1-4]$/);return !!(m&&fs.existsSync(path.join(dir,'models',m[1]+'.json')));}

function archive(dir){
  const root=path.join(dir,'elo-archive',safeStamp());
  const files=[resultsPath(dir),inboxPath(dir),...summaryPaths(dir),rosterPath(dir)];
  let n=0;
  for(const src of files)if(copyIfExists(src,path.join(root,path.basename(src))))n++;
  const meta={archivedAt:new Date().toISOString(),reason:'rating semantics reset',oldSemantics:'mixed legacy arena plus temperature-0.08 NN self-play evidence',newSemantics:SEMANTICS,files:n};
  atomicWrite(path.join(root,'RESET-METADATA.json'),JSON.stringify(meta,null,2));
  return root;
}

function resetRoster(dir,now){
  const p=rosterPath(dir),s=readJson(p,null);if(!s)return{reopened:0};
  let reopened=0;
  if(s.facePools&&typeof s.facePools==='object')for(const key of ['D1','D2','D3','D4']){
    const pool=s.facePools[key];if(!pool)continue;
    const active=new Set(pool.active||[]),retired=pool.retired&&typeof pool.retired==='object'?pool.retired:{};
    for(const [id,meta] of Object.entries(retired)){
      if(meta&&meta.reason==='elastic cull'&&faceModelExists(dir,id)){
        active.add(id);delete retired[id];reopened++;
      }
    }
    pool.active=[...active];pool.retired=retired;pool.trial=null;pool.waiting=[];pool.deferred={};
  }
  s.latest={};s.ladderGames={};s.ladderRatings={};s.evidenceSeen={};s.gamesSinceCull=0;
  s.ratingSemanticsVersion=VERSION;
  s.ratingCalibration={version:VERSION,semantics:SEMANTICS,resetAt:now,reopenedFaces:reopened};
  s.lastEvent={at:now,result:'rating-calibration-reset-v2',reopenedFaces:reopened};
  atomicWrite(p,JSON.stringify(s,null,1));
  return{reopened};
}

function ensure(dir,{force=false}={}){
  if(!force&&resultVersion(dir)===VERSION)return{reset:false,version:VERSION};
  const now=new Date().toISOString(),archiveDir=archive(dir);
  const rr=resetRoster(dir,now);
  atomicWrite(resultsPath(dir),JSON.stringify({ratingSemanticsVersion:VERSION,semantics:SEMANTICS,createdAt:now,results:{}},null,1));
  try{fs.unlinkSync(inboxPath(dir));}catch(_){}
  for(const p of summaryPaths(dir))atomicWrite(p,JSON.stringify({updated:now,ratingSemanticsVersion:VERSION,semantics:SEMANTICS,players:{}},null,1));
  console.log(`[rating] CLEAN ELO RESET v${VERSION}: archived old rating state to ${archiveDir}`);
  console.log(`[rating] official Elo is now ${SEMANTICS}; reopened ${rr.reopened} elastic-culled face(s) for fair remeasurement`);
  return{reset:true,version:VERSION,archiveDir,reopened:rr.reopened};
}

function gamesByPlayer(results){
  const g={};
  for(const [k,r] of Object.entries(results||{})){
    const z=k.indexOf('|');if(z<1)continue;const a=k.slice(0,z),b=k.slice(z+1),n=(+r.w||0)+(+r.l||0)+(+r.d||0);
    g[a]=(g[a]||0)+n;g[b]=(g[b]||0)+n;
  }
  return g;
}
function status(dir){
  const store=readJson(resultsPath(dir),{}),summary=readJson(path.join(dir,'elo-summary.json'),{players:{}}),games=gamesByPlayer(store.results||{});
  const anchors=TOP_ANCHORS.map(level=>{
    const p=(summary.players||{})[`L${level}`]||{};
    return{level,games:Math.round(games[`L${level}`]||0),elo:Number.isFinite(+p.elo)?+p.elo:null};
  });
  const enough=anchors.every(a=>a.games>=MIN_ANCHOR_GAMES&&Number.isFinite(a.elo));
  const ordered=enough&&anchors.every((a,i)=>i===0||a.elo>anchors[i-1].elo);
  return{version:+store.ratingSemanticsVersion||0,semantics:store.semantics||null,anchors,enough,ordered,ready:(+store.ratingSemanticsVersion||0)===VERSION&&enough&&ordered};
}
function describe(st){
  const a=st.anchors.map(x=>`L${x.level} ${x.games}g${Number.isFinite(x.elo)?`/${Math.round(x.elo)}E`:''}`).join(', ');
  return `${a}; ${st.ordered?'ordered':'not yet ordered'}`;
}

module.exports={VERSION,SEMANTICS,MIN_ANCHOR_GAMES,TOP_ANCHORS,ensure,status,describe};
if(require.main===module){
  const force=process.argv.includes('--force');
  const r=ensure(__dirname,{force});
  const s=status(__dirname);
  console.log(`[rating] ${r.reset?'reset complete':'already on clean semantics'}; ${describe(s)}`);
}
