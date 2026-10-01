'use strict';
// Source instrumentation and finite engine checks, not a floating error proof.
const fs=require('fs'),path=require('path'),Module=require('module'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../../..'),DEG=Math.PI/180;
const POSE=[-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442];
const pins={'index.html':'3cee71df1f26afd79cbbc83a5c208780e29e170cd7111fabaafb4ab75bc479c4','nn/engine.js':'106b90e0a6981c817c2789f88b175a546f9a7fc229af20f50218495533af443e'};
for(const [f,h] of Object.entries(pins))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex')!==h)throw Error('source mismatch '+f);
function once(s,a,b){if(s.split(a).length!==2)throw Error('hook not unique: '+a);return s.replace(a,b)}
const stateFields=['pinned','crossings','contact','earned','startSide','entrySide','pendingMerge','turnStartContact','episodeCharged','justCrossed'];
function state(g){const out={};for(const k of stateFields)if(g[k]!==undefined)out[k]=g[k];return JSON.parse(JSON.stringify(out))}
function engine(instrument){
 const file=path.join(ROOT,'nn/engine.js');let src=fs.readFileSync(file,'utf8');
 src=once(src,"const ENGINE_CACHE_PATH = path.join(__dirname, '.engine-cache.json');","const ENGINE_CACHE_PATH = '/dev/null';");
 if(instrument){
  let html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  html=once(html,'function crossingSubstep(before, after, st) {','function proofOriginalCrossingSubstep(before, after, st) {');
  html+='\nfunction crossingSubstep(before, after, st) {\n'+
   ' const blocked=proofOriginalCrossingSubstep(before,after,st);\n'+
   ' if(st.crossingTrace){const state={}; for(const k of '+JSON.stringify(stateFields)+') if(st[k]!==undefined) state[k]=st[k];\n'+
   ' st.crossingTrace.push(JSON.parse(JSON.stringify({before,after,blocked,state,\n'+
   ' near:after.map(f=>nearLineIds(f,CFG.touchEps)),\n'+
   ' sides:after.map(f=>Object.fromEntries(["r0","r1","a0","a1"].map(id=>[id,lineSideOf(f,id)])))})));}\n'+
   ' return blocked;\n}\n';
  html=once(html,'if (active.anyFootOff()){\n            active.rotateAround','if (active.anyFootOff()){ if(G.crossingTrace) G.rejectedRimFeet=active.feet();\n            active.rotateAround');
  src=once(src,"const html = fs.readFileSync(HTML_PATH, 'utf8');",'const html = '+JSON.stringify(html)+';');
 }
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(src,file);return m.exports.createEngine();
}
function run(eng,instrument){
 eng.newGame();let g=eng.getG();g.pieces.forEach((p,i)=>Object.assign(p,{x:POSE[3*i],y:POSE[3*i+1],rot:POSE[3*i+2]}));g.active=0;eng.pinFoot(1);
 for(let i=0;i<32;i++)eng.applySwing(-.25*DEG);
 if(g.atLimit)throw Error('8 degree defender stop blocked');
 const initial=eng.takeSnap();
 if(JSON.stringify([initial[1].x,initial[1].y,initial[1].rot])!==JSON.stringify(POSE.slice(3)))throw Error('attacker not original');
 eng.newGame();g=eng.getG();g.pieces.forEach((p,i)=>Object.assign(p,initial[i]));g.active=1;eng.koReset();eng.pinFoot(0);
 const initialFeet=g.pieces[1].feet(),initialNear=initialFeet.map(f=>eng.nearLineIds(f,eng.CFG.touchEps));
 if(instrument)g.crossingTrace=[];
 let calls=0;while(!g.atLimit){if(++calls>100)throw Error('reply guard');eng.applySwing(-3*DEG)}
 const final=eng.takeSnap(),finalState=state(g);
 // Even an exact copy of this endpoint in history must not ban a pushing move.
 g.koHist.push(final.flatMap(p=>[p.x,p.y,p.rot]));
 const koWithEndpointInHistory=eng.koViolation();
 const result={initial,initialFeet,initialNear,final,finalFeet:g.pieces[1].feet(),finalState,calls,netRad:g.netRad,replyDeg:Math.abs(g.netRad)/DEG,
  limitReason:g.limitReason,minMoveMet:Math.abs(g.netRad)>=eng.CFG.minMoveDeg*DEG,
  koWithEndpointInHistory,attackerOff:g.pieces[1].anyFootOff(),defenderOff:g.pieces[0].anyFootOff()};
 const trace=g.crossingTrace,rejectedRimFeet=g.rejectedRimFeet;
 eng.commitTurn();result.committed={over:g.over,winner:g.winner};
 return {result,trace,rejectedRimFeet};
}
const a=run(engine(true),true),b=run(engine(false),false);
if(JSON.stringify(a.result)!==JSON.stringify(b.result))throw Error('instrumentation changed result');
if(a.result.limitReason!=='selfoff'||a.trace.length!==123||a.result.koWithEndpointInHistory||a.result.committed.winner!==1)throw Error('unexpected reply');
const transitions=[];let prev=JSON.stringify(a.result.initialNear);
for(let i=0;i<a.trace.length;i++){const r=a.trace[i],s=JSON.stringify(r.near);if(s!==prev){transitions.push({step:i+1,betaDeg:(i+1)*.375,near:r.near,crossings:r.state.crossings,episodeCharged:r.state.episodeCharged});prev=s}}
const result={scope:'Finite diagnostic at defender alpha=8 with quarter-degree calls; fresh attacker foot 0 negative, three-degree calls. No uniform floating error bound.',sourceHashes:pins,node:process.version,instrumentedEqualsPlain:true,...a,transitions};
fs.writeFileSync(path.join(__dirname,'arm1-crossing-engine.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({substeps:a.trace.length,initialNear:a.result.initialNear,transitions,result:a.result},null,2));
