// Step 1 of the loading-screen clip (boot-throw.*): play seeded AI games in the extracted engine and keep
// each winning final move, biggest swing first, in throws.json. Run from the repo root: node scripts/boot-throw/findthrow.js
const {createEngine}=require(process.cwd()+'/nn/engine.js');
const eng=createEngine();
let a=1; Math.random=function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
const res=[];
for (let seed=1; seed<=80; seed++){
  a=seed*7919; eng.newGame();
  for (let ply=0; ply<80; ply++){
    const G=eng.getG(); if (G.over) break;
    const lv = [2,3,4,5][seed%4];
    const pre = { pieces: G.pieces.map(p=>({x:p.x,y:p.y,rot:p.rot})), active:G.active, koHist:JSON.parse(JSON.stringify(G.koHist||[])), plies:G.plies };
    let plan = eng.ladderPlanFor(lv, G.active); if (plan && eng.koLegalizePlan) plan = eng.koLegalizePlan(plan);
    if (!plan) break;
    eng.applyPlan(plan);
    const G2=eng.getG();
    if (G2.over && G2.winner===pre.active) { res.push({seed, ply, lv, pre, plan:{pivotIdx:plan.pivotIdx,dir:plan.dir,targetRad:plan.targetRad}, winner:G2.winner}); require('fs').writeFileSync('throws-partial.json', JSON.stringify(res)); break; }
  }
}
res.sort((x,y)=>Math.abs(y.plan.targetRad)-Math.abs(x.plan.targetRad));
console.log(res.length); for (const r of res.slice(0,10)) console.log(r.seed, r.winner, (Math.abs(r.plan.targetRad)*180/Math.PI).toFixed(0)+'deg');
require('fs').writeFileSync('throws.json', JSON.stringify(res.slice(0,15)));
