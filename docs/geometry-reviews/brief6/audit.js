'use strict';
// Repeat the Brief 4 diagnostic against Brief 6's current dependency stack.
const fs=require('fs'),path=require('path');
const {TC,CL,pieces,makeBox}=require('./probe.js');
const trace=TC.sweep(pieces,1,0,-1,138),chords=[],frames=[];
for(const k of [74,79,80,84,85,95]) {
 const row=trace[k-1],q=trace[k-2].pose,A=TC.arcPts(row.att,0),V=TC.arcPts(q,0);
 const J=TC.parkJacobian(row.att,q,[0,0],4,{x:[q.x,q.x],y:[q.y,q.y],rot:[q.rot,q.rot]});
 let actual;
 for(let a=0;a<12;a++){const c=TC.segClosest3(V[4],V[4],A[a],A[a+1]);if(!actual||c.dist<actual.dist)actual={a,...c};}
 chords.push({k,selected:J.seg,correct:actual.a});
}
const res=TC.certify(pieces,1,0,-1,makeBox(.0002,.002*Math.PI/180),1,{
 onGroup:o=>{if(o.JB)frames.push({k:o.k,keep:o.st.keep,frameError:Math.hypot(o.m3[0]-o.a_c[0],o.m3[1]-o.a_c[1],CL.R*(o.m3[2]-o.a_c[2]))});}
});
const out={scope:'Read-only instrumentation: exports and callbacks added in memory; no checker formula changed.',certifiedOutput:res.certified,minR:res.minR,chords,frames,maxFrameError:Math.max(...frames.map(x=>x.frameError))};
fs.writeFileSync(path.join(__dirname,'audit.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({certifiedOutput:out.certifiedOutput,minR:out.minR,chords,maxFrameError:out.maxFrameError},null,2));
