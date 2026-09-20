'use strict';
const fs=require('fs'),path=require('path');
const {loadChecker,pieces,makeBox}=require('./probe.js');
const TC=loadChecker(s=>s.replace('if (!linear) {','if (!linear) { if(opts.onFallback)opts.onFallback({k,round,keep:st.keep,m3,a_c,U,Lam,LamC});'));
const results=[];
for(const [h,deg] of [[.0002,.002],[.00005,.0005],[.00001,.0001],[.000001,.00001],[.0000001,.000001],[0,0]])for(const pv of [0,2]){
 const fallbacks=[],pre=[];
 const r=TC.certify(pieces,1,pv,-1,makeBox(h,deg*Math.PI/180),1,{
  onPre:o=>pre.push({k:o.k,pad:o.preAll.pad,states:o.Us.length}),
  onFallback:o=>{const error=Math.hypot(o.m3[0]-o.a_c[0],o.m3[1]-o.a_c[1],23.095*(o.m3[2]-o.a_c[2]));if(error>1e-10)fallbacks.push({k:o.k,round:o.round,keep:o.keep,error});}
 });
 results.push({h,deg,pv,certified:r.certified,k:r.k,minR:r.minR,why:r.why,firstPositivePad:pre.find(x=>x.pad>1e-8),lastPre:pre.at(-1),fallbacks});
}
fs.writeFileSync(path.join(__dirname,'diagnostic.json'),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results.map(x=>({...x,fallbacks:x.fallbacks.slice(0,2),fallbackCount:x.fallbacks.length})),null,2));
