'use strict';
// Publish three stable worker aliases from the latest ordinary D1/D2 Elo summary.
// Gold/silver/bronze are ordered by rankLo (the pessimistic 90% rank bound), then Elo.
// The real source models stay untouched; workers pull these overwriteable aliases through git.
const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const evo=require('./evolution-roster.js');
const dir=__dirname, repoRoot=path.join(dir,'..'), medalDir=path.join(dir,'medals');
const summaryPath=path.join(dir,'elo-summary.json');
const names=['gold','silver','bronze'];
const log=s=>console.log(`[medals] ${s}`);

function atomicWrite(p,data){fs.mkdirSync(path.dirname(p),{recursive:true});const t=`${p}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,data);fs.renameSync(t,p);}
function atomicCopy(src,dst){fs.mkdirSync(path.dirname(dst),{recursive:true});const t=`${dst}.tmp-${process.pid}-${Date.now()}`;fs.copyFileSync(src,t);fs.renameSync(t,dst);}
function sourcePath(r){
  if(r&&r.model&&fs.existsSync(r.model))return r.model;
  const b=path.basename((r&&r.model)||'');
  if(b){const p=path.join(dir,'models',b);if(fs.existsSync(p))return p;}
  return null;
}
function findGit(){
  const candidates=['git'];
  try{
    const base=path.join(process.env.LOCALAPPDATA||'','GitHubDesktop');
    const apps=fs.readdirSync(base).filter(f=>/^app-/.test(f)).sort().reverse();
    for(const a of apps)candidates.push(path.join(base,a,'resources','app','git','cmd','git.exe'));
  }catch(_){}
  candidates.push('C:\\Program Files\\Git\\cmd\\git.exe','C:\\Program Files (x86)\\Git\\cmd\\git.exe');
  for(const g of candidates)try{execFileSync(g,['--version'],{stdio:'ignore'});return g;}catch(_){}
  return null;
}
function git(g,args,stdio='pipe'){return execFileSync(g,args,{cwd:repoRoot,encoding:'utf8',stdio:stdio==='pipe'?['ignore','pipe','pipe']:stdio});}
function publishGit(paths){
  const g=findGit(); if(!g){log('git not found; aliases refreshed locally only');return;}
  for(const p of paths)try{git(g,['add','-f',p]);}catch(e){log(`could not stage ${p}: ${String(e.stderr||e.message).trim()}`);}
  let changed=true; try{git(g,['diff','--cached','--quiet','--',...paths]);changed=false;}catch(_){}
  if(!changed){log('aliases unchanged');return;}
  try{git(g,['commit','-m','nn: refresh gold silver bronze','--',...paths],'inherit');}
  catch(e){log(`commit failed: ${String(e.stderr||e.message).trim()}`);return;}
  try{git(g,['pull','--no-edit','--no-rebase'],'inherit');}catch(e){log(`pre-push pull failed: ${String(e.stderr||e.message).trim()}`);}
  try{git(g,['push'],'inherit');log('aliases pushed');}catch(e){log(`push failed; next trainer pass will retry: ${String(e.stderr||e.message).trim()}`);}
}

function main(){
  let summary; try{summary=JSON.parse(fs.readFileSync(summaryPath,'utf8'));}
  catch(e){log('no elo-summary.json yet; nothing to publish');return;}
  const active=new Set(evo.activeModelNames(dir));
  const rankedAtDepth=depth=>{
    const bestByModel={};
    for(const [id,r0] of Object.entries(summary.players||{})){
      const r={id,...r0};
      if(r.kind!=='nn'||r.brain==='dual'||!r.model||+r.depth!==depth||
         (r.games||0)<12||!Number.isFinite(+r.rankLo))continue;
      const key=path.basename(r.model,'.json');
      if(!active.has(key))continue;
      const src=sourcePath(r);if(!src)continue;
      const prev=bestByModel[key];
      if(!prev||(+r.rankLo>+prev.rankLo)||(+r.rankLo===+prev.rankLo&&+r.elo>+prev.elo))bestByModel[key]={...r,src};
    }
    return Object.values(bestByModel).sort((a,b)=>(+b.rankLo)-(+a.rankLo)||(+b.elo)-(+a.elo));
  };
  fs.mkdirSync(medalDir,{recursive:true});
  const meta={updated:new Date().toISOString(),basis:'per-depth rankLo; active source; >=12 games',depths:{},medals:{}};
  const workerSummary=JSON.parse(JSON.stringify(summary)); workerSummary.players||={};
  const paths=[];
  let legacy=null;
  for(const depth of [1,2]){
    const ranked=rankedAtDepth(depth), key=`D${depth}`;meta.depths[key]={};
    if(ranked.length<3){log(`${key}: only ${ranked.length} active ordinary models have 12+ games; leaving that depth unpublished`);continue;}
    for(let i=0;i<3;i++){
      const r=ranked[i], name=names[i], file=`${name}-d${depth}.json`, dst=path.join(medalDir,file);
      atomicCopy(r.src,dst);
      const rec={source:path.basename(r.model),sourceId:r.id,depth,games:r.games||0,elo:+r.elo||0,
        rank:Number.isFinite(+r.rank)?+r.rank:null,rankLo:+r.rankLo,rankHi:Number.isFinite(+r.rankHi)?+r.rankHi:null};
      meta.depths[key][name]=rec;
      const sid=`medal-${name}-d${depth}@D${depth}`;
      workerSummary.players[sid]={...r,model:path.join('nn','medals',file),medal:name,medalDepth:depth,sourceId:r.id};
      delete workerSummary.players[sid].src;delete workerSummary.players[sid].id;
      paths.push(path.relative(repoRoot,dst).replace(/\\/g,'/'));
    }
    if(depth===2)legacy=ranked.slice(0,3);
  }
  if(!legacy&&meta.depths.D1&&Object.keys(meta.depths.D1).length===3)legacy=rankedAtDepth(1).slice(0,3);
  if(!legacy){log('no complete depth medal set available; nothing to publish');return;}
  // Backward-compatible aliases stay D2-first for older laptop workers. New workers use the six
  // explicit depth files and never mix a D1 specialist into a D2 lane.
  for(let i=0;i<3;i++){
    const r=legacy[i],name=names[i],dst=path.join(medalDir,`${name}.json`);atomicCopy(r.src,dst);
    meta.medals[name]={source:path.basename(r.model),sourceId:r.id,depth:r.depth||2,games:r.games||0,
      elo:+r.elo||0,rank:Number.isFinite(+r.rank)?+r.rank:null,rankLo:+r.rankLo,
      rankHi:Number.isFinite(+r.rankHi)?+r.rankHi:null};
    paths.push(path.relative(repoRoot,dst).replace(/\\/g,'/'));
  }
  const metaPath=path.join(medalDir,'medals.json'), workerSummaryPath=path.join(medalDir,'elo-summary.json');
  atomicWrite(metaPath,JSON.stringify(meta,null,2)+'\n');
  atomicWrite(workerSummaryPath,JSON.stringify(workerSummary,null,1)+'\n');
  paths.push(path.relative(repoRoot,metaPath).replace(/\\/g,'/'),path.relative(repoRoot,workerSummaryPath).replace(/\\/g,'/'));
  for(const depth of [1,2])if(Object.keys(meta.depths[`D${depth}`]||{}).length)
    log(`D${depth} `+names.map(n=>`${n}=${meta.depths[`D${depth}`][n].source} Rlo${meta.depths[`D${depth}`][n].rankLo.toFixed(2)}`).join(' | '));
  publishGit(paths);
}
if(require.main===module)main();
module.exports={main};
