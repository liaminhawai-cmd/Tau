'use strict';
// Instrumentation only. Every run is compared bit-for-bit with an unmodified engine.
const fs=require('fs'),path=require('path'),Module=require('module'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../../..'),DEG=Math.PI/180;
const POSE=[-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442];
const pins={'index.html':'3cee71df1f26afd79cbbc83a5c208780e29e170cd7111fabaafb4ab75bc479c4','nn/engine.js':'106b90e0a6981c817c2789f88b175a546f9a7fc229af20f50218495533af443e'};
for(const [f,h] of Object.entries(pins))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex')!==h)throw Error('source mismatch '+f);
const hooks=[
 ['let everContacted = false, deepest = Infinity;','if(G.proofTrace) G.proofTrace.push({kind:"step",att:{x:active.x,y:active.y,rot:active.rot},before:{x:opp.x,y:opp.y,rot:opp.rot},net:G.netRad});\n    let everContacted = false, deepest = Infinity;'],
 ['any = true; noteContact(c.dist, c.pa.h);','if(G.proofTrace) G.proofTrace.push({kind:"leg",iter,i,j,dist:c.dist,pa:c.pa,pb:c.pb,before:{x:opp.x,y:opp.y,rot:opp.rot}});\n            any = true; noteContact(c.dist, c.pa.h);'],
 ['any=true; noteContact(c.dist, H);','if(G.proofTrace)G.proofTrace.push({kind:"attacker-hub",iter,j}); any=true; noteContact(c.dist, H);'],
 ['any=true; noteContact(c.dist, c.pt.h);','if(G.proofTrace)G.proofTrace.push({kind:"defender-hub",iter,i}); any=true; noteContact(c.dist, c.pt.h);'],
 ['any=true; noteContact(d, H);','if(G.proofTrace)G.proofTrace.push({kind:"hub-hub",iter}); any=true; noteContact(d, H);']
];
function engine(instrument){
 const file=path.join(ROOT,'nn/engine.js');let src=fs.readFileSync(file,'utf8');
 // Disable disk cache for both engines; all substitutions stay in memory.
 src=src.replace("const ENGINE_CACHE_PATH = path.join(__dirname, '.engine-cache.json');","const ENGINE_CACHE_PATH = '/dev/null';");
 if(instrument){let html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  for(const [a,b] of hooks){if(html.split(a).length!==2)throw Error('hook not unique');html=html.replace(a,b)}
  src=src.replace("const html = fs.readFileSync(HTML_PATH, 'utf8');",'const html = '+JSON.stringify(html)+';');
 }
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(src,file);return m.exports.createEngine();
}
function run(eng,target,trace){
 eng.newGame();let g=eng.getG();g.pieces.forEach((p,i)=>Object.assign(p,{x:POSE[3*i],y:POSE[3*i+1],rot:POSE[3*i+2]}));g.active=0;eng.pinFoot(1);
 for(let n=0;!g.atLimit&&Math.abs(g.netRad)<target*DEG-1e-13;n++){
  if(n>1000)throw Error('defender guard');eng.applySwing(-Math.min(.25*DEG,target*DEG-Math.abs(g.netRad)));
 }
 const reached=Math.abs(g.netRad)/DEG,initial=eng.takeSnap(),defenderReason=g.limitReason;
 // Same fresh-reply contract as the existing probe. Do not carry sweep state.
 eng.newGame();g=eng.getG();g.pieces.forEach((p,i)=>Object.assign(p,initial[i]));g.active=1;eng.pinFoot(0);
 if(trace)g.proofTrace=[];
 let calls=0;
 while(!g.atLimit&&Math.abs(g.netRad)<170*DEG){if(++calls>1000)throw Error('reply guard');eng.applySwing(-3*DEG)}
 return {target,reached,defenderReason,initial,final:eng.takeSnap(),replyDeg:Math.abs(g.netRad)/DEG,reason:g.limitReason,calls,margin:eng.outermostRadU(g.pieces[0])-(eng.CFG.edgeU+eng.CFG.edgeEps),trace:g.proofTrace};
}
const traced=engine(true),plain=engine(false),rows=[];
let commonPathHash=null;
for(let target=2;target<=18;target+=.25){
 const a=run(traced,target,true),b=run(plain,target,false);
 const {trace,...rest}=a;if(JSON.stringify(rest)!==JSON.stringify(b))throw Error('instrumentation changed physics');
 let step=0;const pairs={},types={},activeSteps=new Set();let first=null,minDist=Infinity,minHF=Infinity,maxSep=0;
 for(const r of trace){if(r.kind==='step'){step++;continue}activeSteps.add(step);if(first===null)first=step;types[r.kind]=(types[r.kind]||0)+1;
  if(r.kind==='leg'){const key=r.i+','+r.j;pairs[key]=(pairs[key]||0)+1;minDist=Math.min(minDist,r.dist);const hf=Math.hypot(r.pb.x-r.pa.x,r.pb.y-r.pa.y)/r.dist;minHF=Math.min(minHF,hf);maxSep=Math.max(maxSep,(2.88-r.dist)/Math.max(hf,.35))}
 }
 const attackerPathSha256=crypto.createHash('sha256').update(JSON.stringify(trace.filter(r=>r.kind==='step').map(r=>r.att))).digest('hex');
 if(commonPathHash===null)commonPathHash=attackerPathSha256;
 if(commonPathHash!==attackerPathSha256)throw Error('attacker paths differ');
 rows.push({...rest,substeps:step,firstContactStep:first,contactSteps:activeSteps.size,pairs,types,minDist,minHF,maxSep,attackerPathSha256});
 if(target===2)fs.writeFileSync(path.join(__dirname,'arm1-reference-trace.json'),JSON.stringify({scope:'Diagnostic floating trace only',sourceHashes:pins,...a},null,2)+'\n');
 if(target===8)fs.writeFileSync(path.join(__dirname,'arm1-eight-trace.json'),JSON.stringify({scope:'Diagnostic floating trace only',sourceHashes:pins,...a},null,2)+'\n');
}
const result={scope:'Diagnostic only; quarter-degree defender calls plus residual, foot 1 negative; fresh attacker foot 0 negative, three-degree calls to limit; no ko history.',sourceHashes:pins,node:process.version,instrumentedEqualsPlain:true,commonAttackerPathSha256:commonPathHash,rows};
fs.writeFileSync(path.join(__dirname,'arm1-trace-summary.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
