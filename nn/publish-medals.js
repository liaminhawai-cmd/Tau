'use strict';
// Gold/silver/bronze are simply the three strongest DISTINCT ordinary value models by pessimistic
// 90% Elo bound. Depth travels with the winning face. No ladder-rank conversion exists here.
const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const evo=require('./evolution-roster.js');
const dir=__dirname,root=path.join(dir,'..'),medalDir=path.join(dir,'medals'),summaryPath=path.join(dir,'elo-summary.json');
const names=['gold','silver','bronze'],log=s=>console.log(`[medals] ${s}`);
const read=(p,d)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(_){return d;}};
const atomic=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});const t=`${p}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,s);fs.renameSync(t,p);};
const copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});const t=`${b}.tmp-${process.pid}-${Date.now()}`;fs.copyFileSync(a,t);fs.renameSync(t,b);};
function findGit(){const q=['git'];try{const b=path.join(process.env.LOCALAPPDATA||'','GitHubDesktop');for(const a of fs.readdirSync(b).filter(x=>/^app-/.test(x)).sort().reverse())q.push(path.join(b,a,'resources','app','git','cmd','git.exe'));}catch(_){}q.push('C:\\Program Files\\Git\\cmd\\git.exe','C:\\Program Files (x86)\\Git\\cmd\\git.exe');for(const g of q)try{execFileSync(g,['--version'],{stdio:'ignore'});return g;}catch(_){}return null;}
function publish(paths){const g=findGit();if(!g){log('git not found; aliases refreshed locally only');return;}const run=a=>execFileSync(g,a,{cwd:root,stdio:'inherit'});try{for(const p of paths)run(['add','-f',p]);try{execFileSync(g,['diff','--cached','--quiet','--',...paths],{cwd:root});return;}catch(_){}run(['commit','-m','nn: refresh gold silver bronze','--',...paths]);try{run(['pull','--no-edit','--no-rebase']);}catch(_){}run(['push']);log('aliases pushed');}catch(e){log(`git publish deferred: ${e.message}`);}}
function ordinary(src){try{const j=read(src,{});return j&&j.dual!==true&&j.policyEntrant!==true&&Array.isArray(j.sizes)&&+j.sizes[j.sizes.length-1]===1;}catch(_){return false;}}
function main(){
  const sum=read(summaryPath,{players:{}}),active=new Set(evo.activeModelNames(dir)),best={};
  for(const [id,r] of Object.entries(sum.players||{})){
    if(r.kind!=='nn'||!r.model||!Number.isFinite(+r.depth)||!Number.isFinite(+r.eloLo))continue;
    const min=evo.FACE_MIN_GAMES[`D${r.depth}`]||2;if((+r.games||0)<min)continue;
    const model=path.basename(r.model,'.json');if(!active.has(model))continue;const src=path.join(dir,'models',model+'.json');if(!fs.existsSync(src)||!ordinary(src))continue;
    const old=best[model];if(!old||+r.eloLo>+old.eloLo||(+r.eloLo===+old.eloLo&&+r.elo>+old.elo))best[model]={id,...r,model,src};
  }
  const ranked=Object.values(best).sort((a,b)=>+b.eloLo-+a.eloLo||+b.elo-+a.elo);
  if(ranked.length<3){log(`only ${ranked.length} active ordinary model(s) have usable Elo intervals; leaving medals unchanged`);return;}
  fs.mkdirSync(medalDir,{recursive:true});const meta={updated:new Date().toISOString(),basis:'global 90% Elo lower bound across D1-D4',medals:{}},worker=JSON.parse(JSON.stringify(sum)),paths=[];
  for(let i=0;i<3;i++){const r=ranked[i],name=names[i],dst=path.join(medalDir,name+'.json');copy(r.src,dst);meta.medals[name]={source:r.model,sourceId:r.id,depth:r.depth,games:r.games,elo:r.elo,eloLo:r.eloLo,eloHi:r.eloHi};
    worker.players[`medal-${name}@D${r.depth}`]={...r,model:path.join('nn','medals',name+'.json'),medal:name,sourceId:r.id};delete worker.players[`medal-${name}@D${r.depth}`].src;paths.push(path.relative(root,dst).replace(/\\/g,'/'));}
  const mp=path.join(medalDir,'medals.json'),sp=path.join(medalDir,'elo-summary.json');atomic(mp,JSON.stringify(meta,null,2)+'\n');atomic(sp,JSON.stringify(worker,null,1)+'\n');paths.push(path.relative(root,mp).replace(/\\/g,'/'),path.relative(root,sp).replace(/\\/g,'/'));
  log(names.map(n=>`${n}=${meta.medals[n].source}@D${meta.medals[n].depth} EloLo${Math.round(meta.medals[n].eloLo)}`).join(' | '));publish(paths);
}
if(require.main===module)main();module.exports={main};
