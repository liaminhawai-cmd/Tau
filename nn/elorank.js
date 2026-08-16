'use strict';
const fs=require('fs');
const path=require('path');
const {spawn,execFile}=require('child_process');
const evo=require('./evolution-roster.js');
const medals=require('./publish-medals.js');
const dir=__dirname;
function getArg(a,n,d=null){const i=a.indexOf('--'+n);return i>=0?a[i+1]:d;}
function setArg(a,n,v){const k='--'+n,i=a.indexOf(k);if(i>=0)a.splice(i,2,k,String(v));else a.push(k,String(v));}
function has(a,n){return a.includes('--'+n);}
function run(file,args){return new Promise((ok,bad)=>{const ch=spawn(process.execPath,[path.join(dir,file),...args],{stdio:'inherit'});ch.on('error',bad);ch.on('exit',c=>c===0?ok():bad(new Error(file+' exited '+c)));});}
function mutateShape(spec){const a=String(spec||'').split(',').map(Number).filter(n=>n>0);if(!a.length)return spec;const snap=n=>Math.max(8,Math.round(n/4)*4),ops=['widen','narrow','add',...(a.length>2?['drop']:[])];for(let z=0;z<10;z++){const b=a.slice(),op=ops[Math.floor(Math.random()*ops.length)],i=Math.floor(Math.random()*b.length);if(op==='widen')b[i]=snap(b[i]*1.25);else if(op==='narrow')b[i]=snap(b[i]*.78);else if(op==='add'){const j=Math.floor(Math.random()*(b.length+1)),x=b[j-1]||b[0],y=b[j]||b[b.length-1];b.splice(j,0,snap(Math.sqrt(x*y)));}else b.splice(i,1);if(b.join(',')!==spec)return b.join(',');}return spec;}
// Ladder rungs are permanent identities, not privileged matchups. Their special rule lives in the
// roster -- they are never culled -- while the rating scheduler should spend the same games per
// selected pairing and should not force a net-vs-ladder quota. focusPairs=1 below also means a
// mature ladder does not keep playing ladder-vs-ladder just because the rungs exist; the legacy
// scheduler may bootstrap a genuinely thin rung, then ordinary information-seeking takes over.
function ordinaryLadderScheduling(a){
  const games=Math.max(1,+getArg(a,'games',4)||4);
  setArg(a,'ladderGames',games);
  setArg(a,'anchorShare','0');
}
async function birth(plan){if(!plan)return null;const args=plan.kind==='extra'?['--epochs','8','--resume',plan.parentPath,'--out',plan.outPath]:['--epochs','30','--hidden',plan.kind==='mutant'?mutateShape(plan.shape):plan.shape,'--out',plan.outPath];console.log(`[evolution] replacement ${plan.kind} from ${plan.parent} -> ${path.basename(plan.outPath)}`);await run('train-value.js',args);if(fs.existsSync(plan.outPath)){evo.noteBirth(dir,plan);return path.basename(plan.outPath,'.json');}return null;}

// --- targeted cull-bank probes -----------------------------------------------------------------
// Ordinary placement is deliberately strength-heavy. That is good for useful games, but it means a
// weak-looking face can keep a wide CI for a long time and therefore never become safe to retire.
// Cull probes are a separate tiny budget: trial-vs-cutoff for queue turnover, then weak population
// members vs the median neighbourhood for retirement evidence. Historical results remain untouched.
const rosterPath=path.join(dir,'models','.evolution-roster.json');
const CULL_DEBIT=100;
const PROBE_GAMES={1:8,2:8,3:4,4:2};
function readRoster(){try{return JSON.parse(fs.readFileSync(rosterPath,'utf8'));}catch(_){return null;}}
function splitFace(id){const m=String(id).match(/^(.*?)(\+P)?@D([1-4])$/);return m?{name:m[1],policy:!!m[2],depth:+m[3],key:`D${m[3]}${m[2]?'+P':''}`}:null;}
function faceReading(s,id){const x=splitFace(id);return x&&s.latest&&s.latest[x.name]&&s.latest[x.name].faces?s.latest[x.name].faces[x.key]||null:null;}
const pointRank=r=>r&&Number.isFinite(+r.rank)?+r.rank:r&&Number.isFinite(+r.rankLo)&&Number.isFinite(+r.rankHi)?(+r.rankLo+ +r.rankHi)/2:NaN;
const ciWidth=r=>r&&Number.isFinite(+r.rankLo)&&Number.isFinite(+r.rankHi)?+r.rankHi- +r.rankLo:99;
function pressureModelNames(){
  const out=new Set();
  try{const p=JSON.parse(fs.readFileSync(path.join(dir,'models','.mutant-pop.json'),'utf8'));for(const m of p.active||[])if(m&&m.file)out.add(path.basename(m.file,'.json'));}catch(_){}
  try{const r=JSON.parse(fs.readFileSync(path.join(dir,'models','.lineage-registry.json'),'utf8'));for(const [name,v] of Object.entries(r.lineages||{}))if(v&&v.status==='active'){
    try{const c=JSON.parse(fs.readFileSync(path.join(dir,'models',`.variant-champ-${name}.json`),'utf8'));if(c&&c.model)out.add(path.basename(c.model,'.json'));}catch(_){}
  }}catch(_){}
  return out;
}
function seatProbePlan(excluded){
  const s=readRoster();if(!s||!s.facePools)return null;
  const plans=[];
  for(let d=1;d<=4;d++){
    const p=s.facePools[`D${d}`];if(!p||!p.trial||excluded.has(p.trial))continue;
    const active=(p.active||[]).map(id=>({id,r:faceReading(s,id)})).filter(x=>x.r&&Number.isFinite(pointRank(x.r)));
    if(!active.length)continue;
    active.sort((a,b)=>(Number.isFinite(+a.r.rankLo)?+a.r.rankLo:pointRank(a.r))-(Number.isFinite(+b.r.rankLo)?+b.r.rankLo:pointRank(b.r)));
    const weakest=active[0],cr=faceReading(s,p.trial),g=cr?+cr.games||0:0;
    const urgency=(g===0?20:0)+Math.max(0,12-g)+(p.waiting||[]).length/10-(d-1)*2;
    plans.push({kind:'seat',candidate:p.trial,a:p.trial,b:weakest.id,depth:d,games:PROBE_GAMES[d],urgency,
      reason:`trial vs weakest D${d} seat`});
  }
  return plans.sort((a,b)=>b.urgency-a.urgency)[0]||null;
}
function retirementProbePlan(excluded){
  const s=readRoster();if(!s||!s.facePools)return null;
  const pressure=pressureModelNames();
  const rows=[];
  for(const d of [1,2,3]){
    const p=s.facePools[`D${d}`];if(!p)continue;
    for(const id of p.active||[]){const x=splitFace(id),r=faceReading(s,id);if(!x||!r||excluded.has(id)||!Number.isFinite(pointRank(r)))continue;
      if(pressure.size&&!pressure.has(x.name))continue;
      rows.push({id,name:x.name,depth:d,r,rank:pointRank(r),width:ciWidth(r)});
    }
  }
  if(rows.length<2)return null;
  const byModel=new Map();for(const q of rows){const old=byModel.get(q.name);if(!old||q.rank<old.rank||(q.rank===old.rank&&q.width>old.width))byModel.set(q.name,q);}
  const field=[...byModel.values()];if(field.length<2)return null;
  const ranks=field.map(x=>x.rank).sort((a,b)=>a-b),median=ranks[Math.floor(ranks.length/2)];
  const candidates=field.filter(x=>!Number.isFinite(+x.r.rankHi)||+x.r.rankHi>=median)
    .sort((a,b)=>a.rank-b.rank||b.width-a.width);
  const cand=candidates[0];if(!cand)return null;
  const sameDepth=field.filter(x=>x.id!==cand.id&&x.depth===cand.depth);
  const opponents=(sameDepth.length?sameDepth:field.filter(x=>x.id!==cand.id)).sort((a,b)=>Math.abs(a.rank-median)-Math.abs(b.rank-median));
  const opp=opponents[0];if(!opp)return null;
  return{kind:'retirement',candidate:cand.id,a:cand.id,b:opp.id,depth:cand.depth,games:PROBE_GAMES[cand.depth]||4,
    reason:`weak population face vs median neighbourhood (median L${median.toFixed(2)})`};
}
function chooseProbe(mode,excluded){return mode==='seat'?(seatProbePlan(excluded)||retirementProbePlan(excluded)):(retirementProbePlan(excluded)||seatProbePlan(excluded));}
function debitCullBank(n=CULL_DEBIT){
  const s=readRoster();if(!s)return;
  s.gamesSinceCull=Math.max(0,(+s.gamesSinceCull||0)-n);
  const tmp=`${rosterPath}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(tmp,JSON.stringify(s,null,1));fs.renameSync(tmp,rosterPath);
}
function brainForProbe(id,side){
  const f=splitFace(id);if(!f)throw new Error(`bad face id: ${id}`);
  const modelPath=path.join(dir,'models',f.name+'.json');
  if(!fs.existsSync(modelPath))throw new Error(`model file missing for ${id}`);
  const j=JSON.parse(fs.readFileSync(modelPath,'utf8')),args=[];let spec;
  if(j.policyEntrant===true){
    if(f.depth<2)throw new Error(`policy entrant has no D1 face: ${id}`);
    const valuePath=path.resolve(path.dirname(modelPath),j.valueFile||''),policyPath=path.resolve(path.dirname(modelPath),j.policyFile||'');
    if(!fs.existsSync(valuePath)||!fs.existsSync(policyPath))throw new Error(`policy entrant dependencies missing for ${id}`);
    spec=`nn:0:${valuePath}`;args.push(`--policy${side}`,policyPath,`--ab${side}`);
  }else if(j.dual===true){spec=`dual:0:${modelPath}`;if(f.policy)args.push(`--dualPolicy${side}`,`--ab${side}`);}
  else spec=`nn:0:${modelPath}`;
  return{...f,id,spec,args};
}
async function runCullProbe(plan){
  const A=brainForProbe(plan.a,'A'),B=brainForProbe(plan.b,'B'),inbox=path.join(dir,'elo-inbox.jsonl'),saveData=path.join(dir,'data','cull-probes.jsonl');
  const args=[path.join(dir,'arena.js'),'--a',A.spec,'--b',B.spec,'--games',String(plan.games),'--openingPlies','4',
    '--depthA',String(A.depth),'--depthB',String(B.depth),'--idA',A.id,'--idB',B.id,...A.args,...B.args,'--saveData',saveData];
  const out=await new Promise((ok,bad)=>execFile(process.execPath,args,{encoding:'utf8',maxBuffer:1<<24},(err,stdout,stderr)=>{
    if(stdout)process.stdout.write(stdout);if(stderr)process.stderr.write(stderr);if(err)return bad(err);ok(String(stdout||''));
  }));
  const m=[...out.matchAll(/:\s*(\d+)-(\d+)(?:-(\d+))?\s+\(/g)];if(!m.length)throw new Error(`arena produced no parseable result for ${plan.a} vs ${plan.b}`);
  const last=m[m.length-1],kk=[...out.matchAll(/\(komi (\d+)-(\d+)/g)],kA=kk.length?+kk[kk.length-1][1]:0,kB=kk.length?+kk[kk.length-1][2]:0;
  const w=+last[1]+0.3*kA,l=+last[2]+0.3*kB,d=+(last[3]||0)+0.7*(kA+kB);
  fs.appendFileSync(inbox,JSON.stringify({a:plan.a,b:plan.b,w,l,d,source:'cull-probe',at:new Date().toISOString()})+'\n');
  console.log(`[cull-probe] queued ${plan.a} vs ${plan.b}: ${w}-${l}${d?'-'+d:''} (${plan.games} games)`);
}
async function refitDepth(depth,original,baseSummary){
  let models,ids,sumPath,depthArg;
  if(depth<=2){models=evo.ratingSlice(dir);ids=evo.activeFaceIds(dir,[1,2]);sumPath=baseSummary;depthArg='1,2';}
  else if(depth===3){models=evo.d3Slice(dir);ids=evo.activeFaceIds(dir,[3]);sumPath=evo.d3SummaryPath(dir);depthArg='3';}
  else{models=evo.d4Slice(dir);ids=evo.activeFaceIds(dir,[4]);sumPath=evo.d4SummaryPath(dir);depthArg='4';}
  const a=['--refit'];
  setArg(a,'models',models.join(','));setArg(a,'levels',evo.activeLadderLevels(dir).join(','));setArg(a,'depths',depthArg);
  setArg(a,'allowPlayers',ids.join(','));setArg(a,'summary',sumPath);setArg(a,'out',getArg(original,'out',path.join(dir,'elo-results.json')));
  ordinaryLadderScheduling(a);await run('elorank-legacy.js',a);evo.ingestSummary(dir,sumPath);
}

(async()=>{
  const original=process.argv.slice(2), refit=has(original,'refit'), summary=getArg(original,'summary',path.join(dir,'elo-summary.json'));
  evo.sync(dir); evo.ingestSummary(dir,summary);
  if(has(original,'cullOnly')){
    const all=[],excluded=new Set();let probes=0;
    // First cash any decisions the existing evidence already supports. If that stalls while the
    // bank is still full, spend a small targeted chunk, refit, and ask again. Alternate queue-seat
    // pressure with population-retirement pressure so neither can monopolise maintenance.
    for(;;){
      let decided=false;
      while(evo.status(dir).gamesSinceCull>=CULL_DEBIT){
        const c=evo.cull(dir);if(!c.culled.length)break;
        decided=true;all.push(...c.culled);
        console.log(`[evolution] maintenance ${c.culled.map(x=>`${x.name} ${x.result}`).join(', ')}`);
      }
      const st=evo.status(dir);if(st.gamesSinceCull<CULL_DEBIT||probes>=4)break;
      const plan=chooseProbe(probes%2===0?'seat':'retirement',excluded);if(!plan)break;
      console.log(`[evolution] cull probe ${probes+1}/4: ${plan.a} vs ${plan.b}, ${plan.games} games — ${plan.reason}`);
      try{
        await runCullProbe(plan);
        await refitDepth(plan.depth,original,summary);
        debitCullBank(CULL_DEBIT);excluded.add(plan.candidate);probes++;
      }catch(e){console.error(`[evolution] cull probe stopped: ${e.message}`);break;}
      if(!decided)continue;
    }
    const end=evo.status(dir);
    console.log(`[evolution] cull-only complete: ${all.length} face decision(s), ${probes} targeted probe(s); `+
      `D1 ${end.faces.D1.seats}+${end.faces.D1.trial} trial, D2 ${end.faces.D2.seats}+${end.faces.D2.trial}, `+
      `D3 ${end.faces.D3.seats}+${end.faces.D3.trial}, D4 ${end.faces.D4.seats}+${end.faces.D4.trial}; `+
      `cull bank ${end.gamesSinceCull.toFixed(0)}`);
    try{medals.main();}catch(e){console.error('[medals] refresh failed:',e.message);}
    return;
  }
  const requested=String(getArg(original,'focus','')).split(',').filter(Boolean);
  const focus=evo.filterFocus(dir,requested), rotating=evo.ratingSlice(dir), seen=new Set(), slice=[];
  for(const p of [...focus,...rotating]){const k=path.resolve(p);if(!seen.has(k)){seen.add(k);slice.push(p);}}
  const levels=evo.activeLadderLevels(dir), st=evo.status(dir), baseFaces=evo.activeFaceIds(dir,[1,2]);
  console.log(`[evolution] rating ${baseFaces.length} live D1/D2 faces from ${slice.length} model files + ${st.ladders} ladder; cull bank ${st.gamesSinceCull.toFixed(0)} games`);
  const base=original.slice(); setArg(base,'models',slice.join(',')); setArg(base,'levels',levels.join(',')); setArg(base,'depths','1,2');
  setArg(base,'allowPlayers',baseFaces.join(',')); ordinaryLadderScheduling(base);
  if(!refit){setArg(base,'focus',slice.join(','));setArg(base,'focusPairs','1');}
  await run('elorank-legacy.js',base);
  evo.ingestSummary(dir,summary);

  if(!refit){
    for(let i=0;i<3;i++){
      const c=evo.cull(dir); if(!c.culled.length) break;
      console.log(`[evolution] face decision: ${c.culled.map(x=>`${x.name} ${x.result}`+
        (x.replacedBy?`; next ${x.replacedBy}`:'')).join(', ')}`);
      if(c.birth){const b=await birth(c.birth);if(b)console.log(`[evolution] replacement born ${b}`);}
    }
  }

  const d3=evo.d3Slice(dir);
  if(d3.length){
    const a=original.slice(), d3Summary=evo.d3SummaryPath(dir);
    setArg(a,'models',d3.join(',')); setArg(a,'levels',evo.activeLadderLevels(dir).join(','));
    setArg(a,'depths','3'); setArg(a,'summary',d3Summary);
    setArg(a,'allowPlayers',evo.activeFaceIds(dir,[3]).join(',')); ordinaryLadderScheduling(a);
    if(!refit){
      setArg(a,'focus',d3.join(',')); setArg(a,'focusPairs','1');
      const bh=+getArg(original,'budgetHours',0);if(bh>0)setArg(a,'budgetHours',Math.max(.03,bh*.25));
    }
    console.log(`[evolution] D3 face pool: ${evo.activeFaceIds(dir,[3]).length} incumbents/trial from ${d3.length} model files`);
    await run('elorank-legacy.js',a);
    evo.ingestSummary(dir,d3Summary);
  }

  const d4=evo.d4Slice(dir);
  if(d4.length){
    const a=original.slice(), d4Summary=evo.d4SummaryPath(dir);
    setArg(a,'models',d4.join(',')); setArg(a,'levels',evo.activeLadderLevels(dir).join(','));
    setArg(a,'depths','4'); setArg(a,'summary',d4Summary);
    setArg(a,'allowPlayers',evo.activeFaceIds(dir,[4]).join(','));
    setArg(a,'games','1'); setArg(a,'workers','1'); ordinaryLadderScheduling(a);
    if(!refit){
      setArg(a,'focus',d4.join(',')); setArg(a,'focusPairs','1');
      const bh=+getArg(original,'budgetHours',0);
      if(bh>0)setArg(a,'budgetHours',Math.max(.02,Math.min(.08,bh*.10)));
    }
    console.log(`[evolution] D4 face pool: ${evo.activeFaceIds(dir,[4]).length} incumbent/trial; 1 worker, 1 game per pairing, no D5`);
    await run('elorank-legacy.js',a);
    evo.ingestSummary(dir,d4Summary);
  }
  if(!refit){try{medals.main();}catch(e){console.error('[medals] refresh failed:',e.message);}}
  const end=evo.status(dir);console.log(`[evolution] faces now D1 ${end.faces.D1.seats}+${end.faces.D1.trial} trial, `+
    `D2 ${end.faces.D2.seats}+${end.faces.D2.trial}, D3 ${end.faces.D3.seats}+${end.faces.D3.trial}, `+
    `D4 ${end.faces.D4.seats}+${end.faces.D4.trial}; cull bank ${end.gamesSinceCull.toFixed(0)}`);
})().catch(e=>{console.error('[evolution] elorank wrapper failed:',e.message);process.exitCode=1;});
