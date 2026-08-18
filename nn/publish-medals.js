'use strict';
// Publish three stable worker aliases: gold, silver, bronze -- the top 3 DISTINCT models on the
// whole live ladder, one overall ranking across every depth (D1-D4), not a separate top-3 per
// depth. A model's own rank comes from whichever of its rated faces has the best rankLo -- the
// depth that face was measured at travels with the medal, so a laptop worker plays gold at
// wherever gold actually earned its rank, silver at wherever silver did, and so on. Quality over
// uniform lane depth: the three medals need not share a depth at all.
//
// Real source models stay untouched; these are overwriteable aliases pulled by workers through
// git. Ordinary (non-dual, non-policy) value nets only -- a worker's championPool loader expects
// a standalone one-output value JSON, and dual/policy entries share the Elo graph but cannot be
// copied into that slot (arena.js/nnai.js load them through a different path entirely).
const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const evo=require('./evolution-roster.js');
const calibration=require('./rating-calibration.js');
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
function readSummary(f){try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){return{players:{}};}}
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
  const cal=calibration.status(dir);
  if(!cal.ready){log(`calibration hold: ${calibration.describe(cal)}; keeping existing medal files untouched until the fixed ladder is trustworthy`);return;}
  // Merge all four depths' summaries -- elorank.js's evolution wrapper rates D3 and D4 in SEPARATE
  // passes and writes them to their own files, never into elo-summary.json. Reading only the base
  // file (as this used to) makes any D3/D4-only face invisible here, exactly the gap that let
  // best.json miss behemoth-10x400-dense40@D3 despite it topping the whole ladder.
  const merged={
    ...readSummary(summaryPath).players,
    ...readSummary(evo.d3SummaryPath(dir)).players,
    ...readSummary(evo.d4SummaryPath(dir)).players,
  };
  if(!Object.keys(merged).length){log('no rated faces yet; nothing to publish');return;}
  const active=new Set(evo.activeModelNames(dir));
  // One entry per MODEL: its best-measured face across every depth, not per depth. "Top 3" means
  // three distinct models -- a model that happens to be strong at both D2 and D3 should not be
  // able to take two of the three medals from itself.
  const bestByModel={};
  for(const [id,r0] of Object.entries(merged)){
    const r={id,...r0};
    if(r.kind!=='nn'||(r.brain&&r.brain!=='nn')||!r.model||!Number.isFinite(+r.depth))continue;
    const key=`D${r.depth}`, minGames=evo.FACE_MIN_GAMES[key]||12;
    if((r.games||0)<minGames||!Number.isFinite(+r.rankLo))continue;
    const modelKey=path.basename(r.model,'.json');
    if(!active.has(modelKey))continue;
    const src=sourcePath(r);if(!src)continue;
    const prev=bestByModel[modelKey];
    if(!prev||(+r.rankLo>+prev.rankLo)||(+r.rankLo===+prev.rankLo&&+r.elo>+prev.elo))bestByModel[modelKey]={...r,src};
  }
  const ranked=Object.values(bestByModel).sort((a,b)=>(+b.rankLo)-(+a.rankLo)||(+b.elo)-(+a.elo));
  if(ranked.length<3){log(`only ${ranked.length} active model(s) have enough games at their own depth; leaving medals unpublished`);return;}

  fs.mkdirSync(medalDir,{recursive:true});
  const meta={updated:new Date().toISOString(),
    basis:'ONE overall rankLo ranking across every depth (D1-D4); each medal keeps its own measured depth',
    medals:{}};
  const workerSummary=JSON.parse(JSON.stringify({players:merged})); workerSummary.players||={};
  const paths=[];
  for(let i=0;i<3;i++){
    const r=ranked[i], name=names[i], dst=path.join(medalDir,`${name}.json`);
    atomicCopy(r.src,dst);
    meta.medals[name]={source:path.basename(r.model),sourceId:r.id,depth:r.depth,games:r.games||0,
      elo:+r.elo||0,rank:Number.isFinite(+r.rank)?+r.rank:null,rankLo:+r.rankLo,
      rankHi:Number.isFinite(+r.rankHi)?+r.rankHi:null};
    const sid=`medal-${name}@D${r.depth}`;
    workerSummary.players[sid]={...r,model:path.join('nn','medals',`${name}.json`),medal:name,sourceId:r.id};
    delete workerSummary.players[sid].src;delete workerSummary.players[sid].id;
    paths.push(path.relative(repoRoot,dst).replace(/\\/g,'/'));
  }
  const metaPath=path.join(medalDir,'medals.json'), workerSummaryPath=path.join(medalDir,'elo-summary.json');
  atomicWrite(metaPath,JSON.stringify(meta,null,2)+'\n');
  atomicWrite(workerSummaryPath,JSON.stringify(workerSummary,null,1)+'\n');
  paths.push(path.relative(repoRoot,metaPath).replace(/\\/g,'/'),path.relative(repoRoot,workerSummaryPath).replace(/\\/g,'/'));
  log(names.map(n=>`${n}=${meta.medals[n].source}@D${meta.medals[n].depth} Rlo${meta.medals[n].rankLo.toFixed(2)}`).join(' | '));
  publishGit(paths);
}
if(require.main===module)main();
module.exports={main};
