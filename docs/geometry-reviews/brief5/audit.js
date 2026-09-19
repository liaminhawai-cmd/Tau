'use strict';
// Dataset accounting, table inventory, and explicit counterexamples to two
// geometric inferences. Ordinary floating point; no new deadness certificate.
const fs=require('fs'),path=require('path'),vm=require('vm');
const {FW,CL}=require('./load.js');
const here=__dirname,root=path.join(here,'repo/docs/dead-regions');
const read=n=>fs.readFileSync(path.join(root,n),'utf8').split('\n').filter(s=>s.startsWith('{')).map(JSON.parse);
const points=read('dead-points-mined.jsonl'),balls=read('dead-balls.jsonl'),controls=read('screened-not-dead.jsonl');
const count=(xs,key)=>xs.reduce((a,x)=>{const k=String(key(x));a[k]=(a[k]||0)+1;return a;},{});
const median=xs=>{const s=xs.slice().sort((a,b)=>a-b),n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const src=fs.readFileSync(path.join(here,'current-index.html'),'utf8');
const start=src.indexOf('const DEAD_CERT_EPS ='),end=src.indexOf('// The metric nn/forced-win.js certifies',start);
if(start<0||end<0)throw Error('Expected table boundaries absent');
const table=vm.runInNewContext(src.slice(start,end)+'\n({DEAD_CERT_EPS,DEAD_BALL_EPS,DEAD_CERTS,DEAD_FAMILIES})');
const twoPi=2*Math.PI,norm=a=>((a+Math.PI)%twoPi+twoPi)%twoPi-Math.PI;
const wrappedDist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])+CL.R*Math.abs(norm(a[2]-b[2]))+Math.hypot(a[3]-b[3],a[4]-b[4])+CL.R*Math.abs(norm(a[5]-b[5]));
const inventory={entries:table.DEAD_CERTS.length,kinds:count(table.DEAD_CERTS,x=>x.kind),families:table.DEAD_FAMILIES.length,
  eps:table.DEAD_CERTS.map(c=>c.eps),exactNewBallCentreMatches:balls.filter(b=>table.DEAD_CERTS.some(c=>c.mover===b.mover&&wrappedDist(c.p,b.p)<1e-8)).length,
  newBallCentresInsideAnyOldDeadEntry:balls.filter(b=>table.DEAD_CERTS.some(c=>c.kind==='dead'&&c.mover===b.mover&&wrappedDist(c.p,b.p)<=c.eps)).length,
  sourceReferencesNewDatasetNames:/dead-balls\.jsonl|dead-points-mined\.jsonl/.test(src)};
const geometry=rows=>rows.map(r=>{const p=FW.piecesOf(r.p),v=p[r.mover],a=p[1-r.mover],clear=CL.minGapOf(p[0],p[1])-CL.MIND;
  const vf=CL.feetOf(v).map(f=>Math.hypot(f.x,f.y)).sort((x,y)=>x-y);
  return{game:r.g,pose:r.p,mover:r.mover,clearance:clear,victimHub:Math.hypot(v.x,v.y),attackerHub:Math.hypot(a.x,a.y),victimMaxFoot:vf[2],hubSeparation:Math.hypot(v.x-a.x,v.y-a.y)};});
const dp=geometry(points),nc=dp.filter(x=>x.clearance>.05);
const clearanceCounts=Object.fromEntries([0,.0001,.001,.01,.05,.1,1].map(t=>[String(t),dp.filter(x=>x.clearance>t).length]));
const b=balls[0],q=b.p.slice();q[3*(1-b.mover)]+=b.eps/4;q[3*b.mover+1]+=b.eps/4;
const e=.1,metricWitnessA=[0,0,0,0,0,0],metricWitnessB=[e/Math.sqrt(2),e/Math.sqrt(2),0,0,0,0];
const out={sourceSnapshot:'c1ac39e771f8115797a4b8672587860fb676ad1b',frozenRuleIndex:'729a394959968e5fbdb5af10d3067005712b890f',
 counts:{points:points.length,balls:balls.length,controls:controls.length,controlStatus:count(controls,x=>x.status),screenOnly:controls.filter(x=>x.screenOnly).length,
 pointEngineTrials:points.reduce((s,x)=>s+x.engine.n,0),pointEngineAgreement:points.reduce((s,x)=>s+x.engine.agree,0),ballEngineTrials:balls.reduce((s,x)=>s+x.engine.n,0),
 pointsWithSlivers:points.filter(x=>x.slivers>0).length,pointsWithProbedSlivers:points.filter(x=>x.probedSlivers>0).length,
 pointsWithEitherSliverKind:points.filter(x=>x.slivers>0||x.probedSlivers>0).length,pointsWithNeitherSliverKind:points.filter(x=>!x.slivers&&!x.probedSlivers).length},
 radii:{min:Math.min(...balls.map(x=>x.eps)),median:median(balls.map(x=>x.eps)),max:Math.max(...balls.map(x=>x.eps)),hCounts:count(balls,x=>x.h)},
 volumes:{coordinateSystem:'(bx,by,R*btheta,rx,ry,R*rtheta)',singleBallCoefficient:Math.PI**2/45,sumIndividualBallVolumes:Math.PI**2/45*balls.reduce((s,b)=>s+b.eps**6,0),
  rawAngleCoordinateSum:Math.PI**2/(45*CL.R**2)*balls.reduce((s,b)=>s+b.eps**6,0),samplerSupportFraction:4/Math.PI**2,scope:'Unclipped ambient volumes; sum is a union upper bound, not an on-board or non-overlap volume.'},
 inventory,
 bothPiecesVary:{eps:b.eps,initial:b.p,perturbed:q,distance:FW.dist6(b.p,q),inside:FW.dist6(b.p,q)<b.eps},
 geometry:{clearanceDefinition:'CL.minGapOf minus CL.MIND: includes the hub-clearance adjustment as well as leg distances.',
  countsAboveTolerance:clearanceCounts,maxSurfaceClearance:Math.max(...dp.map(x=>x.clearance)),clearlySeparatedAtToleranceU:.05,noncontact:nc},
 unresolved:{count:controls.filter(x=>x.status==='unresolved').length,sameGenericFailureText:controls.filter(x=>x.status==='unresolved'&&x.why.includes('no single arc certifies the gap')).length,
  victimArm:count(controls.filter(x=>x.status==='unresolved'),x=>x.why.match(/reply \(([^)]+)\)/)?.[1])},
 metricDualWitness:{coordinateDerivativeMaximum:1,metricDistance:FW.dist6(metricWitnessA,metricWitnessB),linearFunctionGain:metricWitnessB[0]+metricWitnessB[1],ratio:Math.sqrt(2)},
 coverageCounterexample:{interval:[0,1],leftResponse:'0.6-t',rightResponse:'t-0.4',eachWorstMargin:-.4,upperEnvelopeWorstMargin:.1,
  interpretation:'Two response regions overlap and cover the interval although neither one response works across it. No event-phase change is involved.'}};
fs.writeFileSync(path.join(here,'audit.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({...out,geometry:{...out.geometry,noncontact:undefined}},null,2));
if(points.length!==261||balls.length!==63||controls.length!==1045||!out.bothPiecesVary.inside)process.exitCode=1;
