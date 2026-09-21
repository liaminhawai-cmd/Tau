'use strict';
// Run: node reproduce.js /path/to/Tau (checkout ce0e61d1e7482e3d1252aadadf97bd4269f71e29).
// Adds observation exports; does not change the game/search functions.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('assert');
const ep=path.resolve(process.argv[2]||process.cwd(),'nn/engine.js');
const m=new Module(ep,module);m.filename=ep;m.paths=Module._nodeModulePaths(path.dirname(ep));
let source=fs.readFileSync(ep,'utf8');
source=source.replace('const SEEDS = [', "const SEEDS = ['ladderScore3',")
 .replace('if (cached.key === cacheKey','if (false && cached.key === cacheKey')
 .replace('fs.writeFileSync(ENGINE_CACHE_PATH,','false && fs.writeFileSync(ENGINE_CACHE_PATH,')
 .replace('__exports = {','__exports = { ladderScore3, ladderRestore, HARD_WIN_BONUS, HARD_MIN_MOVE_RAD,');
m._compile(source,ep);
const E=m.exports.createEngine(),w=E.AI_LADDER[10].w;
const p=[-40.2848,3.7263,1.8209,-30.2905,12.3529,1.5755],victim=0;
function load(){E.newGame();const g=E.getG();g.pieces.forEach((q,i)=>{q.x=p[3*i];q.y=p[3*i+1];q.rot=p[3*i+2];});g.active=victim;return g;}
load();const score=E.ladderScore3(1-victim,w,E.takeSnap());
assert(Number.isFinite(score)&&score>E.HARD_WIN_BONUS/2);
const g=load(),stop=2*Math.PI/180;E.pinFoot(0);let n=0;
while(!g.atLimit&&Math.abs(g.netRad)<stop-1e-10&&n++<1000)E.applySwing(Math.min(Math.PI/180,stop-Math.abs(g.netRad)));
const actualStopDeg=Math.abs(g.netRad)*180/Math.PI;
assert(Math.abs(actualStopDeg-2)<1e-8&&Math.abs(g.netRad)>=E.HARD_MIN_MOVE_RAD);
assert(g.pieces.every(q=>!q.anyFootOff()));
const afterPose=g.pieces.map(q=>({x:q.x,y:q.y,rot:q.rot})),after=E.takeSnap(),responses=[];
for(let pv=0;pv<3;pv++)for(const dir of [1,-1]){
 E.ladderRestore(after);E.setActive(1-victim);const net=E.simMoveToLimit(pv,dir),q=E.getG();
 responses.push({pv,dir,legal:Math.abs(net)>=E.HARD_MIN_MOVE_RAD&&!q.pieces[1-victim].anyFootOff(),victimOff:q.pieces[victim].anyFootOff()});
}
assert(responses.every(t=>t.legal&&!t.victimOff));
console.log(JSON.stringify({source:'ce0e61d1e7482e3d1252aadadf97bd4269f71e29',pose:p,victim,score,actualStopDeg,afterPose,responses},null,2));
