'use strict';
const fs=require('fs');
const path=require('path');
const {execFile}=require('child_process');
const calibration=require('./rating-calibration.js');
const dir=__dirname;
const inbox=path.join(dir,'elo-inbox.jsonl');
const resultsPath=path.join(dir,'elo-results.json');
const summaryPath=path.join(dir,'elo-summary.json');
const saveData=path.join(dir,'data','calibration-probes.jsonl');
const readJson=(p,d)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(_){return d;}};

function directGames(results,a,b){
  const one=results[`${a}|${b}`]||{},two=results[`${b}|${a}`]||{};
  return(+one.w||0)+(+one.l||0)+(+one.d||0)+(+two.w||0)+(+two.l||0)+(+two.d||0);
}
function playerGames(results,id){
  let n=0;for(const [k,r] of Object.entries(results||{})){const z=k.indexOf('|');if(z<1)continue;if(k.slice(0,z)!==id&&k.slice(z+1)!==id)continue;n+=(+r.w||0)+(+r.l||0)+(+r.d||0);}return n;
}
function topupGames(need){return Math.max(2,Math.min(6,Math.ceil(Math.max(0,need))));}
function splitFace(id){const m=String(id).match(/^(.*?)(\+P)?@D([12])$/);return m?{name:m[1],policy:!!m[2],depth:+m[3]}:null;}
function ordinaryFace(id,row){
  const f=splitFace(id);if(!f||f.policy||!row||row.kind!=='nn'||(row.brain&&row.brain!=='nn'))return null;
  const model=path.join(dir,'models',f.name+'.json');if(!fs.existsSync(model))return null;
  try{const j=JSON.parse(fs.readFileSync(model,'utf8'));if(j.dual===true||j.policyEntrant===true)return null;}catch(_){return null;}
  return{id,...f,elo:Number.isFinite(+row.elo)?+row.elo:-Infinity,model};
}
function parseArena(out){
  const m=[...String(out||'').matchAll(/:\s*(\d+)-(\d+)(?:-(\d+))?\s+\(/g)];if(!m.length)return null;
  const last=m[m.length-1],kk=[...String(out||'').matchAll(/\(komi (\d+)-(\d+)/g)],kA=kk.length?+kk[kk.length-1][1]:0,kB=kk.length?+kk[kk.length-1][2]:0;
  return{w:+last[1]+0.3*kA,l:+last[2]+0.3*kB,d:+(last[3]||0)+0.7*(kA+kB)};
}
function runArena(a,b,games,depthA=null){
  const args=[path.join(dir,'arena.js'),'--a',a.spec,'--b',b.spec,'--games',String(games),'--openingPlies','4','--idA',a.id,'--idB',b.id,'--saveData',saveData];
  if(depthA)args.push('--depthA',String(depthA));
  return new Promise((ok,bad)=>execFile(process.execPath,args,{encoding:'utf8',maxBuffer:1<<24},(err,stdout,stderr)=>{
    if(stdout)process.stdout.write(stdout);if(stderr)process.stderr.write(stderr);if(err)return bad(err);
    const rec=parseArena(stdout);if(!rec)return bad(new Error(`no parseable arena result for ${a.id} vs ${b.id}`));
    fs.appendFileSync(inbox,JSON.stringify({a:a.id,b:b.id,...rec,source:'calibration-anchor-v2',at:new Date().toISOString()})+'\n');
    console.log(`[rating] anchor ${a.id} vs ${b.id}: ${rec.w}-${rec.l}${rec.d?'-'+rec.d:''}`);ok();
  }));
}

async function main(){
  const st=calibration.status(dir);if(st.version!==calibration.VERSION){console.log('[rating] calibration probe skipped: clean rating reset has not happened yet');return;}
  const store=readJson(resultsPath,{results:{}}),results=store.results||{},summary=readJson(summaryPath,{players:{}});
  const L=n=>({id:`L${n}`,spec:`L${n}`});
  // Repair the fixed yardstick aggressively while it is thin. Six games is still tiny beside a
  // placement pass, but gets L9/L10/L11 to the 24-game trust floor in a few cycles rather than
  // waiting half a day while the much larger NN graph floats around them.
  const g9=playerGames(results,'L9'),g10=playerGames(results,'L10'),g11=playerGames(results,'L11');
  const n910=topupGames(Math.max(calibration.MIN_ANCHOR_GAMES-g9,calibration.MIN_ANCHOR_GAMES-g10));
  const n1011=topupGames(Math.max(calibration.MIN_ANCHOR_GAMES-g10,calibration.MIN_ANCHOR_GAMES-g11));
  await runArena(L(9),L(10),n910);
  await runArena(L(10),L(11),n1011);

  const faces=[];
  for(const [id,row] of Object.entries(summary.players||{})){const f=ordinaryFace(id,row);if(f&&Number.isFinite(f.elo))faces.push(f);}
  faces.sort((a,b)=>b.elo-a.elo);
  const pool=faces.slice(0,12).map(f=>{
    const g10=directGames(results,f.id,'L10'),g11=directGames(results,f.id,'L11');
    return{...f,g10,g11,need:Math.min(g10,g11)};
  }).sort((a,b)=>a.need-b.need||b.elo-a.elo).slice(0,3);
  for(const f of pool){
    const rung=f.g10<=f.g11?10:11;
    await runArena({id:f.id,spec:`nn:0:${f.model}`},L(rung),2,f.depth);
  }
  if(!pool.length)console.log('[rating] no rated ordinary top face yet; repaired L9/L10/L11 only this pass');
}
main().catch(e=>{console.error('[rating] calibration probe failed:',e.message);process.exitCode=1;});
