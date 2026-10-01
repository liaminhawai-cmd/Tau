'use strict';
// Execute the original crossingSubstep source on interval-certified answers.
// Geometry is checked by check_arm1_crossing.py; no rounded representative
// foot is substituted for an interval in this rule replay.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),assert=require('assert');
const ROOT=path.resolve(__dirname,'../../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(__dirname,name),'utf8'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const data=read('arm1-crossing.json'),observed=read('arm1-crossing-engine.json');
for(const [name,expected] of Object.entries(data.engineSourceHashes))assert.equal(hash(fs.readFileSync(path.join(ROOT,name))),expected);
for(const [name,expected] of Object.entries(data.sourceHashes))assert.equal(hash(fs.readFileSync(path.join(__dirname,name))),expected);
assert.equal(hash(fs.readFileSync(path.join(__dirname,'arm1-local-reply-cover.json'))),data.stopping.contactArtifactSha256);
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const cfgStart=html.indexOf('const CFG = {'),cfgEnd=html.indexOf('// The six start dots',cfgStart);
assert(cfgStart>=0&&cfgEnd>cfgStart);
const CFG=vm.runInNewContext(html.slice(cfgStart,cfgEnd)+'\nCFG;');
for(const [key,value] of Object.entries(data.parameters))assert.equal(JSON.stringify(CFG[key]),JSON.stringify(value),'parameter '+key);
assert.equal(Math.ceil(3/CFG.substepDeg),8);
const start=html.indexOf('function crossingSubstep(before, after, st) {');
const end=html.indexOf('// ---------- Contact geometry ----------',start);
assert(start>=0&&end>start);
const source=html.slice(start,end).trim();
const fields=['pinned','crossings','contact','earned','startSide','entrySide','pendingMerge','turnStartContact','episodeCharged','justCrossed'];
const snapshot=g=>Object.fromEntries(fields.filter(k=>g[k]!==undefined).map(k=>[k,g[k]]));
function replay(points){
 const counts={nearQueries:0,sideQueries:0,cornerQueries:0,pendingDistanceQueries:0};
 const sandbox={CFG,
  nearLineIds(f,eps){assert.equal(eps,CFG.touchEps);counts.nearQueries++;return f.near.slice()},
  lineSideOf(f,id){counts.sideQueries++;assert([-1,1].includes(f.sides[id]));return f.sides[id]},
  lineDistOf(){counts.pendingDistanceQueries++;throw Error('unexpected pending-merge branch')},
  LINE_INTERSECTIONS:{some(){counts.cornerQueries++;throw Error('unexpected corner branch')}},
 };
 const cross=vm.runInNewContext(source+'\ncrossingSubstep;',sandbox);
 const st={pinned:0,crossings:0,contact:null,justCrossed:[]},states=[];
 const feet=q=>q.near.map((near,i)=>({near,sides:q.sides[i]}));
 for(let k=1;k<points.length;k++){
  assert.equal(points[k].step,k);
  assert(!cross(feet(points[k-1]),feet(points[k]),st),'rule rejected substep '+k);
  states.push(JSON.parse(JSON.stringify(snapshot(st))));
 }
 return {states,counts};
}
const {states,counts}=replay(data.points);
assert.equal(data.points.length,124);
assert.equal(states.length,123);
assert.equal(states[122].crossings,1);
assert.equal(states[122].episodeCharged,false);
assert.equal(JSON.stringify(data.points[0].near),JSON.stringify(observed.result.initialNear));
let coordinateChecks=0,sideChecks=0;
function contain(feet,boxes){
 for(let i=0;i<3;i++)for(let j=0;j<2;j++){
  const value=feet[i][j===0?'x':'y'],[lo,hi]=boxes[i][j];
  assert(lo<=value&&value<=hi,'observed foot outside certified box');coordinateChecks++;
 }
}
contain(observed.result.initialFeet,data.points[0].feet);
assert.equal(observed.trace.length,states.length);
for(let i=0;i<states.length;i++){
 const actual=observed.trace[i],q=data.points[i+1];
 assert.equal(actual.blocked,false);
 assert.equal(JSON.stringify(states[i]),JSON.stringify(actual.state),'state differs at '+(i+1));
 assert.equal(JSON.stringify(q.near),JSON.stringify(actual.near),'near sets differ at '+(i+1));
 assert.equal(JSON.stringify(q.sides),JSON.stringify(actual.sides),'sides differ at '+(i+1));
 sideChecks+=12;
 contain(actual.after,q.feet);
}
contain(observed.rejectedRimFeet,data.stopping.rejectedStep.feet);
contain(observed.result.finalFeet,data.points[123].feet);
assert(observed.instrumentedEqualsPlain);
assert(observed.result.minMoveMet&&!observed.result.koWithEndpointInHistory);
assert(!observed.result.attackerOff&&observed.result.defenderOff);
assert.equal(observed.result.limitReason,'selfoff');
assert.deepStrictEqual(observed.result.committed,{over:true,winner:1});
let controls=0;
// A genuine second episode must be rejected by the unchanged rule source.
let bad=JSON.parse(JSON.stringify(data.points));bad[60].near[2]=['r0'];
assert.throws(()=>replay(bad),/rule rejected substep 60/);controls++;
// Never silently assume that an unexamined corner exception is legal.
bad=JSON.parse(JSON.stringify(data.points));bad[37].near[1]=['r1','r0'];
assert.throws(()=>replay(bad),/unexpected corner branch/);controls++;
const result={scope:'Pinned source crossing replay over certified real-geometry predicates, with finite floating-engine consistency checks.',
 node:process.version,engineNode:observed.node,sourcePin:data.enginePin,crossingFunctionSha256:hash(source),
 artifacts:Object.fromEntries(['arm1-crossing.json','arm1-crossing-engine.json','check_arm1_crossing.js','check_arm1_crossing.py'].map(name=>[name,hash(fs.readFileSync(path.join(__dirname,name)))])),
 acceptedSubsteps:states.length,finalCrossings:states[122].crossings,sourceQueryCounts:counts,
 engineStatesMatched:states.length,engineNearSetsMatched:data.points.length,engineSidePredicatesMatched:sideChecks,
 observedFootCoordinatesContained:coordinateChecks,sourceRejectionControlsPassed:controls,
 transitions:observed.transitions,minimumRadialGuardMargin:data.radialMarginLower,
 finalThrowMarginFromPoseBox:data.stopping.throwMarginLowerFromPoseBox,
 koHubDisplacementLower:data.stopping.defenderHubDisplacement[0]};
fs.writeFileSync(path.join(__dirname,'arm1-crossing-validation.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
