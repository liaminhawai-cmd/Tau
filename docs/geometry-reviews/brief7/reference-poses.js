'use strict';
// Regenerate nominal data only; these are not reachable-set certificates.
const fs=require('fs'),path=require('path');
const {TC,pieces}=require('./probe.js'),{geometry}=require('./geometry.js');
const out={};
for(const [pv,K] of [[0,138],[2,331]]) {
  const tr=TC.sweep(pieces,1,pv,-1,K);
  out['arm'+pv]=tr.map((row,i)=>{
    const pre=i ? tr[i-1].pose : pieces[0];
    const result={...row,pre};
    if(pv===0) {
      const {a,b,s,t}=geometry(row.att,pre).best;
      result.closest={a,b,s,t};
    }
    return result;
  });
}
fs.writeFileSync(path.join(__dirname,'reference-poses.json'),JSON.stringify(out,null,2)+'\n');
console.log('Wrote 138 foot-0 and 331 foot-2 nominal substeps.');
