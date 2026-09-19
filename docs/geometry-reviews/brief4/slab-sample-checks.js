'use strict';
// Finite grids diagnose the interval implementation; they do not prove bounds.
const fs=require('fs'),path=require('path');
const {TC,CL,pieces}=require('./probe.js'),{geometry}=require('./geometry.js');
const references=JSON.parse(fs.readFileSync(path.join(__dirname,'reference-poses.json'))).arm0;
const out=[];
for(const k of [20,50,74,80,84]) {
  const bound=JSON.parse(fs.readFileSync(path.join(__dirname,`slab-bounds-step${k}.json`)));
  const q=references[k-1].pre,pivot=CL.feetOf(pieces[1])[0];
  const vals={g:[],horizontalAdvancePerRadian:[],closingPerRadian:[]};
  let count=0,violations=0;
  for(let ti=0;ti<3;ti++)for(let ix=0;ix<7;ix++)for(let iy=0;iy<7;iy++)for(let ir=0;ir<7;ir++) {
    const alpha=(k-1+ti/2)*Math.PI/540;
    const rot=pieces[1].rot-alpha;
    const att={x:pivot.x-CL.R*Math.cos(rot),y:pivot.y-CL.R*Math.sin(rot),rot};
    const p={x:q.x+(ix-3)*.125/3,y:q.y+(iy-3)*.125/3,rot:q.rot+(ir-3)*.01/3};
    const g=geometry(att,p),pa=g.best.pa;
    const advance=(pa.y-pivot.y)*g.nh[0]-(pa.x-pivot.x)*g.nh[1];
    const v={g:g.g,horizontalAdvancePerRadian:advance,closingPerRadian:g.hf*advance};
    for(const key of Object.keys(v)) {
      vals[key].push(v[key]);
      if(v[key]<bound[key][0]-1e-9||v[key]>bound[key][1]+1e-9)violations++;
    }
    if(Math.abs(g.rn)>bound.rnMax+1e-9)violations++;
    count++;
  }
  out.push({k,count,violations,...Object.fromEntries(Object.entries(vals).map(([key,v])=>[key,[Math.min(...v),Math.max(...v)]]))});
}
fs.writeFileSync(path.join(__dirname,'slab-sample-checks.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out,null,2));
if(out.some(x=>x.violations))process.exitCode=1;
