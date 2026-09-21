'use strict';
// Deterministic point checks against actual extracted engine, not a uniform floating-point proof.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('assert'),crypto=require('crypto');
const loader=require('../contact-map/source-loader.js'); // verifies all six source hashes
const ep=path.resolve(process.argv[2]||process.cwd(),'nn/engine.js');
let source=fs.readFileSync(ep,'utf8');
source='const auditRecords=[];\n'+source;
source=source.replace('const sandbox = { Math, console };','const sandbox = { Math, console, auditRecords };');
source=source.replace('vm.runInContext(buildEngineSource() +',"vm.runInContext(buildEngineSource().replace('resolvePush(active, opp);', 'resolvePush(active, opp); auditRecords.push({att:{x:active.x,y:active.y,rot:active.rot},victim:{x:opp.x,y:opp.y,rot:opp.rot}});') +");
source=source.replace('module.exports = { createEngine, buildEngineSource };','module.exports = { createEngine, buildEngineSource, auditRecords };');
const m=new Module(ep,module);m.filename=ep;m.paths=Module._nodeModulePaths(path.dirname(ep));m._compile(source,ep);
const E=m.exports.createEngine(),records=m.exports.auditRecords;
const result=JSON.parse(fs.readFileSync(path.join(__dirname,'propagation-1.0.json'))),trace=JSON.parse(fs.readFileSync(path.join(__dirname,'../contact-map/trace.json')));
const stepBoxes=new Map(result.log.filter(r=>r.iteration===9).map(r=>[r.k,r.outputBox]));
const cases=[[0,0,0]];for(const x of [-1,1])for(const y of [-1,1])for(const r of [-1,1])cases.push([x,y,r]);
let seed=19471;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let j=0;j<32;j++)cases.push([2*random()-1,2*random()-1,2*random()-1]);
let enginePath=null;
let checks=0,minFinalFoot=Infinity,maxAttPoseDifference=0;const failures=[];
for(let n=0;n<cases.length;n++){
 E.newGame();const g=E.getG();g.pieces.forEach((p,i)=>Object.assign(p,loader.pieces[i]));const v=g.pieces[0],d=cases[n];v.x+=d[0]*.0002;v.y+=d[1]*.0002;v.rot+=d[2]*.002*Math.PI/180;
 g.active=1;E.pinFoot(2);records.length=0;
 for(let j=0;j<37;j++)E.applySwing(-Math.PI/180);E.applySwing(-Math.PI/180/3);
 assert(records.length===112,'Engine did not legally reach substep 112');
 if(enginePath===null)enginePath=records.map((r,i)=>({k:i+1,att:r.att}));
 else records.forEach((r,i)=>['x','y','rot'].forEach(key=>assert.strictEqual(r.att[key],enginePath[i].att[key])));
 for(let k=1;k<=112;k++){
  const box=k<75?result.initialBox:stepBoxes.get(k),row=records[k-1];
  for(const [j,key]of ['x','y','rot'].entries())if(row.victim[key]<box[j][0]||row.victim[key]>box[j][1])failures.push({case:n,k,key,value:row.victim[key],bound:box[j]});
  const at=trace.steps[k-1].att;maxAttPoseDifference=Math.max(maxAttPoseDifference,Math.abs(at.x-row.att.x),Math.abs(at.y-row.att.y),Math.abs(at.rot-row.att.rot)*23.095);checks++;
 }
 minFinalFoot=Math.min(minFinalFoot,...[Math.max(...v.feet().map(f=>Math.hypot(f.x,f.y)))]);
 assert(v.anyFootOff());
}
assert(!failures.length,JSON.stringify(failures.slice(0,3)));
const summary={scope:'Deterministic point diagnostics only; not uniform floating-engine correspondence',propagationSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'propagation-1.0.json'))).digest('hex'),cases:cases.length,substepContainmentChecks:checks,failures,minFinalFootRadius:minFinalFoot,maxScaledAttackerPoseDifference:maxAttPoseDifference};
fs.writeFileSync(path.join(__dirname,'engine-attacker-path.json'),JSON.stringify({source:'18efad5398798b65b477f9af4be17947a358d3ce',runtime:process.version,commands:'37 calls of -pi/180, then one of -pi/180/3, with piece 1 pivot 2',steps:enginePath},null,2)+'\n');
fs.writeFileSync(path.join(__dirname,'engine-check.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
