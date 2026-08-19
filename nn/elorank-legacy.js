'use strict';
// One official league. Every participant -- fixed ladder brain or learned model face -- is a normal
// temp-0 player under the same adaptive scheduler and Bradley-Terry Elo fit. One selected pairing
// always means TWO physical games with colours reversed; the pair becomes ONE rating result:
// 2-0 = win, 1-1 = draw, 0-2 = loss. Old Elo is only a one-match prior, never old evidence.
const fs=require('fs');
const path=require('path');
const os=require('os');
const {execFile}=require('child_process');
const ratingState=require('./rating-state.js');
const dir=__dirname,modelsDir=path.join(dir,'models');
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;};
const PHYSICAL_GAMES_PER_MATCH=2;
const workers=Math.max(1,+arg('workers',Math.max(1,Math.min(os.cpus().length-1,14))));
const budgetHours=Math.max(0,+arg('budgetHours',0));
const targetGames=Math.max(2,+arg('targetGames',8)); // physical games, always even in practice
const openingPlies=Math.max(0,+arg('openingPlies',4));
const bootstrapN=Math.max(40,+arg('bootstrap',100));
const outPath=arg('out',path.join(dir,'elo-results.json'));
const summaryPath=arg('summary',path.join(dir,'elo-summary.json'));
const saveData=arg('saveData',null);
const refit=process.argv.includes('--refit'),dryrun=process.argv.includes('--dryrun');
const {atomicWrite}=require('./atomic-write.js');
const atomic=(p,s)=>atomicWrite(p,s);
const read=(p,d)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(_){return d;}};
ratingState.ensure(dir);
// Legacy self-play/benchmark writers may still append this during a rolling upgrade. It is never
// official Elo evidence under v4, so discard it rather than let a dead side-channel accumulate.
try{fs.unlinkSync(path.join(dir,'elo-inbox.jsonl'));}catch(_){}

function productionLevels(){try{return require('./engine.js').createEngine().AI_LADDER.map((x,i)=>x&&!x.experimental?i+1:null).filter(Boolean);}catch(_){return Array.from({length:11},(_,i)=>i+1);}}
function parseFace(id){const m=String(id).match(/^(.*?)(\+P)?@D([1-4])$/);return m?{name:m[1],policy:!!m[2],depth:+m[3]}:null;}
function modelKind(file){const j=read(file,{});return j.policyEntrant===true?'policy':j.dual===true?'dual':'value';}
function facePlayer(id){const f=parseFace(id);if(!f)return null;const model=path.join(modelsDir,f.name+'.json');if(!fs.existsSync(model))return null;const j=read(model,{}),kind=modelKind(model),p={id,kind:'nn',model,depth:f.depth,label:`${f.name}${f.policy?'+P':''} D${f.depth}`};if(kind==='policy'){if(f.depth<2)return null;const value=path.resolve(path.dirname(model),j.valueFile||''),policy=path.resolve(path.dirname(model),j.policyFile||'');if(!fs.existsSync(value)||!fs.existsSync(policy))return null;return{...p,brain:'policy',spec:`nn:0:${value}`,policyPath:policy,ab:true};}if(kind==='dual')return{...p,brain:'dual',spec:`dual:0:${model}`,dualPolicy:f.policy,ab:f.policy};if(f.policy)return null;return{...p,brain:'nn',spec:`nn:0:${model}`};}
function fallbackFaces(){const depths=String(arg('depths','1,2')).split(',').map(Number).filter(d=>d>=1&&d<=4),models=String(arg('models','')).split(',').map(s=>s.trim()).filter(Boolean),out=[];for(const m0 of models){const model=path.isAbsolute(m0)?m0:path.resolve(m0),name=path.basename(model,'.json'),kind=modelKind(model);for(const d of depths){if(kind==='policy'&&d<2)continue;out.push(`${name}@D${d}`);if(kind==='dual')out.push(`${name}+P@D${d}`);}}return out;}
const faceIds=String(arg('faces',arg('allowPlayers',''))).split(',').map(s=>s.trim()).filter(Boolean),levels=String(arg('levels','')).split(',').map(Number).filter(Number.isFinite);
const players=(levels.length?levels:productionLevels()).map(level=>({id:`L${level}`,kind:'ladder',level,spec:`L${level}`,label:`L${level}`}));for(const id of(faceIds.length?faceIds:fallbackFaces())){const p=facePlayer(id);if(p)players.push(p);}const uniq=[],seen=new Set();for(const p of players)if(!seen.has(p.id)){seen.add(p.id);uniq.push(p);}players.length=0;players.push(...uniq);

const store=read(outPath,{ratingSemanticsVersion:ratingState.VERSION,semantics:ratingState.SEMANTICS,seedWeightMatches:1,seedElo:{},results:{},recent:[]});store.ratingSemanticsVersion=ratingState.VERSION;store.semantics=ratingState.SEMANTICS;store.seedWeightMatches=Math.max(.01,+store.seedWeightMatches||1);store.seedElo||={};store.results||={};store.recent||=[];
const saveStore=()=>atomic(outPath,JSON.stringify(store,null,1)),canonical=(a,b)=>a<b?`${a}|${b}`:`${b}|${a}`;
function matchN(r){return(+r.w||0)+(+r.l||0)+(+r.d||0);}
function physicalN(r){return Number.isFinite(+r.physical)?+r.physical:PHYSICAL_GAMES_PER_MATCH*matchN(r);}
function totals(){const g={},pair={};for(const[k,r]of Object.entries(store.results)){const z=k.indexOf('|');if(z<1)continue;const a=k.slice(0,z),b=k.slice(z+1),n=physicalN(r);g[a]=(g[a]||0)+n;g[b]=(g[b]||0)+n;pair[canonical(a,b)]=(pair[canonical(a,b)]||0)+n;}return{g,pair};}
function edges(ids,results){const ix=Object.fromEntries(ids.map((x,i)=>[x,i])),wins=Array(ids.length).fill(0),es=[];for(const[k,r]of Object.entries(results)){const z=k.indexOf('|');if(z<1)continue;const a=k.slice(0,z),b=k.slice(z+1);if(!(a in ix)||!(b in ix)||a===b)continue;const w=+r.w||0,l=+r.l||0,d=+r.d||0,n=w+l+d;if(!n)continue;const i=ix[a],j=ix[b];wins[i]+=w+d/2;wins[j]+=l+d/2;es.push([i,j,n]);}return{wins,es};}
function fitBT(ids,results){
  if(!ids.length)return{};const{wins,es}=edges(ids,results),W=store.seedWeightMatches;let cur=ids.map(id=>Math.pow(10,(Number.isFinite(+store.seedElo[id])?+store.seedElo[id]:0)/400));
  const priorWins=ids.map(id=>{const p0=Math.pow(10,(Number.isFinite(+store.seedElo[id])?+store.seedElo[id]:0)/400);return W*p0/(p0+1);});
  for(let it=0;it<300;it++){const den=cur.map(v=>W/(v+1));for(const[i,j,n]of es){const q=n/Math.max(1e-12,cur[i]+cur[j]);den[i]+=q;den[j]+=q;}const next=cur.map((_,i)=>(wins[i]+priorWins[i])/Math.max(1e-12,den[i]));let delta=0;for(let i=0;i<next.length;i++)delta=Math.max(delta,Math.abs(next[i]-cur[i]));cur=next;if(delta<1e-8)break;}
  return Object.fromEntries(ids.map((id,i)=>[id,400*Math.log10(Math.max(cur[i],1e-12))]));
}
function bootstrap(ids,B){
  const samples=Object.fromEntries(ids.map(id=>[id,[]])),entries=Object.entries(store.results);
  // Jeffreys-smoothed resampling: one observed match must still produce a BROAD interval instead of
  // a fake zero-width CI. That is what lets the optimistic upper bound protect newcomers from cull.
  for(let b=0;b<B;b++){const rr={};for(const[k,r]of entries){const n=Math.round(matchN(r));if(!n)continue;const den=n+1.5,pw=((+r.w||0)+.5)/den,pl=((+r.l||0)+.5)/den;let w=0,l=0,d=0;for(let q=0;q<n;q++){const u=Math.random();if(u<pw)w++;else if(u<pw+pl)l++;else d++;}rr[k]={w,l,d};}const e=fitBT(ids,rr);for(const id of ids)if(Number.isFinite(e[id]))samples[id].push(e[id]);}
  const out={};for(const id of ids){const a=samples[id].sort((x,y)=>x-y);out[id]=a.length>=10?{lo:a[Math.floor(.05*a.length)],hi:a[Math.min(a.length-1,Math.floor(.95*a.length))]}:{lo:null,hi:null};}return out;
}
// Depth is only the PRIOR for compute cost. The real rent is measured: an EWMA of ms per
// physical game, learned from the matches this scheduler itself launches and persisted in the
// store. A policy face that prunes well runs far cheaper than its depth suggests and now pays
// correspondingly less everywhere cost matters (pair selection here, cull pressure in
// evolution-roster.js) -- which is exactly the reward "same-depth" play denied it. Each match's
// wall time is split between the two sides in proportion to their current cost estimates, so
// attribution self-corrects as estimates improve.
function priorCost(p){if(p.kind==='nn')return Math.pow(3,Math.max(0,p.depth-1));return p.level<=5?1:p.level<=7?3:p.level<=9?9:27;}
function costMs(p){const m=store.cost&&+store.cost[p.id];if(Number.isFinite(m)&&m>0)return m;const u=Number.isFinite(+store.costUnitMs)&&+store.costUnitMs>0?+store.costUnitMs:1500;return priorCost(p)*u;}
function noteCost(a,b,elapsedMs){
  const per=Math.max(1,elapsedMs)/PHYSICAL_GAMES_PER_MATCH;store.cost||={};
  const ca=costMs(a),cb=costMs(b),shareA=ca/Math.max(1e-9,ca+cb);
  for(const [p,ms] of [[a,per*shareA],[b,per*(1-shareA)]]){const old=+store.cost[p.id];store.cost[p.id]=+(Number.isFinite(old)&&old>0?0.7*old+0.3*ms:ms).toFixed(1);}
  const unit=per/Math.max(1,priorCost(a)+priorCost(b));const oldU=+store.costUnitMs;
  store.costUnitMs=+(Number.isFinite(oldU)&&oldU>0?0.9*oldU+0.1*unit:unit).toFixed(1);
}
// CI half-widths from the PREVIOUS pass's summary: one window stale, but far better than the
// games-count proxy while a window is running. Faces missing from it fall back to a
// games-based estimate with the same shape as the ladder-need curve.
const prevCI=(()=>{const out={};try{for(const [id,r] of Object.entries(read(summaryPath,{}).players||{}))if(Number.isFinite(+r.eloLo)&&Number.isFinite(+r.eloHi))out[id]=(+r.eloHi-+r.eloLo)/2;}catch(_){}return out;})();
// The pair equation from the scheduler lab: closeness x sqrt of both standings (strength) x
// evidence need (uncertainty + freshness) x pair novelty, over the sqrt of measured compute.
// Strong players and uncertain players both score high; a well-measured mid-field face has
// neither going for it and fades to its floors -- no seat lists, no thresholds, just pressure.
function fieldRange(elo){let lo=Infinity,hi=-Infinity;for(const p of players){const e=elo[p.id];if(Number.isFinite(e)){if(e<lo)lo=e;if(e>hi)hi=e;}}return hi>lo?{lo,hi}:{lo:0,hi:1};}
function standing(p,elo,fr){const e=Number.isFinite(elo[p.id])?elo[p.id]:(fr.lo+fr.hi)/2;return .15+.85*Math.max(0,Math.min(1,(e-fr.lo)/Math.max(1e-9,fr.hi-fr.lo)));}
function uncertainty(p,g){const matches=(g[p.id]||0)/PHYSICAL_GAMES_PER_MATCH;if(!matches)return 1;const hw=prevCI[p.id];const u=Number.isFinite(hw)?hw/100:12/(12+matches);return Math.max(.05,Math.min(1,u));}
function freshness(p,g){return 1/(Math.log2((g[p.id]||0)+2));}
function pairScore(a,b,elo,g,pair,fr){
  const ea=Number.isFinite(elo[a.id])?elo[a.id]:0,eb=Number.isFinite(elo[b.id])?elo[b.id]:0,p=1/(1+Math.pow(10,(eb-ea)/400)),close=4*p*(1-p);
  const need=.55*((uncertainty(a,g)+uncertainty(b,g))/2)+.45*Math.max(freshness(a,g),freshness(b,g));
  const novelty=1/Math.log2((pair[canonical(a.id,b.id)]||0)+2);
  return(.20+close)*Math.sqrt(standing(a,elo,fr)*standing(b,elo,fr))*(.30+.70*need)*(.35+.65*novelty)/Math.sqrt(costMs(a)+costMs(b));
}
// Selection is a WEIGHTED DRAW over pair scores, not an argmax. Sampling keeps the environment
// probabilistic (every legal pairing has some chance, in proportion to its usefulness) and it
// stops all the worker lanes from converging on the identical best pair. Players already in a
// live match are excluded outright, which is what spreads first coverage across many zero-game
// faces instead of twelve lanes bursting one face at a time.
function pickPair(elo,busy){
  const{g,pair}=totals(),free=players.filter(p=>!busy.has(p.id)),fr=fieldRange(elo);
  const unknown=free.filter(p=>(g[p.id]||0)===0);
  if(unknown.length){
    const u=unknown.slice().sort((a,b)=>costMs(a)-costMs(b)||a.id.localeCompare(b.id,undefined,{numeric:true}))[0];
    const known=free.filter(p=>p.id!==u.id&&(g[p.id]||0)>0),pool=known.length?known:free.filter(p=>p.id!==u.id);
    const scored=pool.map(o=>[pairScore(u,o,elo,g,pair,fr),o]).filter(x=>x[0]>0);
    const o=weightedDraw(scored);if(o)return[u,o];
  }
  const scored=[];
  for(let i=0;i<free.length;i++)for(let j=i+1;j<free.length;j++){
    const s=pairScore(free[i],free[j],elo,g,pair,fr);if(s>0)scored.push([s,[free[i],free[j]]]);
  }
  return weightedDraw(scored);
}
function weightedDraw(scored){if(!scored.length)return null;let total=0;for(const [s] of scored)total+=s;let r=Math.random()*total;for(const [s,v] of scored){r-=s;if(r<=0)return v;}return scored.at(-1)[1];}
function arenaArgs(a,b){const args=[path.join(dir,'arena.js'),'--a',a.spec,'--b',b.spec,'--games',String(PHYSICAL_GAMES_PER_MATCH),'--openingPlies',String(openingPlies),'--idA',a.id,'--idB',b.id];if(a.kind==='nn')args.push('--depthA',String(a.depth));if(b.kind==='nn')args.push('--depthB',String(b.depth));if(a.dualPolicy)args.push('--dualPolicyA');if(b.dualPolicy)args.push('--dualPolicyB');if(a.policyPath)args.push('--policyA',a.policyPath);if(b.policyPath)args.push('--policyB',b.policyPath);if(a.ab)args.push('--abA');if(b.ab)args.push('--abB');if(saveData)args.push('--saveData',saveData);return args;}
function play(a,b){const t0=Date.now();return new Promise(resolve=>execFile(process.execPath,arenaArgs(a,b),{encoding:'utf8',maxBuffer:1<<24},(err,stdout,stderr)=>{if(stdout)process.stdout.write(stdout);if(stderr)process.stderr.write(stderr);const m=[...String(stdout||'').matchAll(/:\s*(\d+)-(\d+)(?:-(\d+))?\s+\(/g)];if(err||!m.length){console.error(`[rating] no result: ${a.id} vs ${b.id}`);return resolve();}const q=m.at(-1),aw=+q[1],bw=+q[2],draws=+(q[3]||0);const rec=aw>bw?{w:1,l:0,d:0}:bw>aw?{w:0,l:1,d:0}:{w:0,l:0,d:1};const key=`${a.id}|${b.id}`,old=store.results[key]||{w:0,l:0,d:0,physical:0};store.results[key]={w:(+old.w||0)+rec.w,l:(+old.l||0)+rec.l,d:(+old.d||0)+rec.d,physical:(+old.physical||0)+PHYSICAL_GAMES_PER_MATCH};store.recent.push({at:new Date().toISOString(),a:a.id,b:b.id,...rec,physical:2,raw:`${aw}-${bw}${draws?'-'+draws:''}`});store.recent=store.recent.slice(-24);noteCost(a,b,Date.now()-t0);saveStore();resolve();}));}
function writeSummary(){const ids=players.map(p=>p.id),elo=fitBT(ids,store.results),ci=bootstrap(ids,bootstrapN),{g}=totals(),out={updated:new Date().toISOString(),ratingSemanticsVersion:ratingState.VERSION,semantics:ratingState.SEMANTICS,seedWeightMatches:store.seedWeightMatches,compatStrengthUnit:'elo/100 (legacy consumers only; not a ladder rank)',players:{}};for(const p of players){const games=Math.round(g[p.id]||0),e=elo[p.id],c=games>=2?ci[p.id]:{lo:null,hi:null},lo=Number.isFinite(c&&c.lo)?c.lo:null,hi=Number.isFinite(c&&c.hi)?c.hi:null;out.players[p.id]={kind:p.kind,elo:Number.isFinite(e)?+e.toFixed(1):null,eloLo:lo==null?null:+lo.toFixed(1),eloHi:hi==null?null:+hi.toFixed(1),games,...(p.kind==='ladder'?{level:p.level}:{model:p.model,depth:p.depth,brain:p.brain||'nn',dualPolicy:!!p.dualPolicy,rank:Number.isFinite(e)?+(e/100).toFixed(3):null,rankLo:lo==null?null:+(lo/100).toFixed(3),rankHi:hi==null?null:+(hi/100).toFixed(3),rankLoEdge:null,rankHiEdge:null,extrapRank:null,extrapRankLo:null,extrapRankHi:null})};}atomic(summaryPath,JSON.stringify(out,null,1));const rows=players.map(p=>({p,elo:elo[p.id],games:Math.round(g[p.id]||0),ci:ci[p.id]})).sort((a,b)=>(b.elo||0)-(a.elo||0));console.log(`\n=== unified Elo (${Object.values(store.results).reduce((s,r)=>s+matchN(r),0)} colour-balanced matches / ${Object.values(store.results).reduce((s,r)=>s+physicalN(r),0)} physical games) ===`);console.log('  Elo       90% CI       games  brain');for(const r of rows){const c=r.games>=2&&r.ci&&Number.isFinite(r.ci.lo)?`${Math.round(r.ci.lo)}..${Math.round(r.ci.hi)}`:'—';console.log(`${String(Math.round(r.elo||0)).padStart(5)}  ${c.padStart(13)}  ${String(r.games).padStart(5)}  ${r.p.label}${r.p.kind==='ladder'?'  [immortal]':''}`);}}
async function main(){console.log(`[rating] ${players.length} players; one scheduler; temp 0; every pairing = two games, colours reversed; pairs drawn by score, rent by measured compute`);if(refit){writeSummary();return;}if(dryrun)return;const start=Date.now(),busy=new Set();let stop=false;const timedOut=()=>budgetHours>0&&(Date.now()-start)/3600000>=budgetHours;const lane=async()=>{while(!stop&&!timedOut()){const{g}=totals();if(!budgetHours&&players.length&&players.every(p=>(g[p.id]||0)>=targetGames)){stop=true;break;}const elo=fitBT(players.map(p=>p.id),store.results),pair=pickPair(elo,busy);if(!pair)break;const[a,b]=pair;busy.add(a.id);busy.add(b.id);try{await play(a,b);}finally{busy.delete(a.id);busy.delete(b.id);}}};await Promise.all(Array.from({length:workers},lane));writeSummary();}
main().catch(e=>{console.error('[rating] unified league failed:',e.stack||e.message);process.exitCode=1;});
