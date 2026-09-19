// The ndpxhts24 1u box minus the corner (victim y <= -0.75u AND rot <= -0.75u) where the union-envelope run
// left 11 arm-(2,-1) gaps unresolved: two cells, A = y in [-0.75, 1] x full rot, B = y in [-1, -0.75] x rot in [-0.75, 1].
const F=require('../forced-win.js'), C=require('../contact-law.js'); const R=C.R, fs=require('fs');
const seed=[-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442];
const cells=[{name:'A',dy:[-0.75,1],dt:[-1,1]},{name:'B',dy:[-1,-0.75],dt:[-0.75,1]}];
(async()=>{const out=[];
for(const c of cells){const centre=seed.slice();centre[1]+=(c.dy[0]+c.dy[1])/2;centre[2]+=(c.dt[0]+c.dt[1])/2/R;
 const half=[1,(c.dy[1]-c.dy[0])/2,(c.dt[1]-c.dt[0])/2,0,0,0];
 console.log(`cell ${c.name}: centre ${centre.map(x=>+x.toFixed(4))} half ${half.slice(0,3)}`);
 const v=await F.certifyDeadCells(F.piecesOf(centre),0,half,[3,3,3,1,1,1],C.REPLICA,{threads:4,minStep:0.05,minHalf:0.1,log:m=>{if(!/^\s+\d+\/\d+:/.test(m))console.log(m);}});
 console.log(`cell ${c.name}: ${v.certified}/${v.of} leaves, ${(100*v.fraction).toFixed(1)}% of the cell, ${(v.seconds/60).toFixed(1)} min`);
 for(const l of v.leaves){if(l.certified){l.engine=F.simCheckDeadBox(F.piecesOf(l.centre),0,l.half,40,8);console.log(`  engine: ${l.engine.agree}/${l.engine.n} poses lose all 8 moves${l.engine.fails.length?' CONTRADICTED '+JSON.stringify(l.engine.fails.slice(0,2)):''}`);}else console.log('  not certified: '+String(l.why).slice(0,300));}
 out.push({cell:c,centre,half,result:v});}
fs.writeFileSync('../astra/two-cells-ndpxhts24.json',JSON.stringify(out));console.log('DONE');})().catch(e=>{console.error('FAILED',e);process.exit(1);});
