const F=require('../forced-win.js');const C=require('../contact-law.js');
const R=C.R, DEG=Math.PI/180, {REPLICA,feetOf}=C;
const seed=[-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442];
const ps=F.piecesOf(seed);
// blue reply: arm (0,+) to 8 deg, with pushes on red
const rep=C.swing(ps,0,0,+1,8*DEG,{...REPLICA});
const P=feetOf(ps[0])[0];
const rot=(p,dA)=>{const c=Math.cos(dA),s=Math.sin(dA),rx=p.x-P.x,ry=p.y-P.y;return {x:P.x+rx*c-ry*s,y:P.y+rx*s+ry*c,rot:p.rot+dA};};
const blue=rot(ps[0],8*DEG), red={x:rep.opp.x,y:rep.opp.y,rot:rep.opp.rot};
console.log('after reply: blue',JSON.stringify(blue),'red',JSON.stringify(red),'red moved',Math.hypot(red.x-ps[1].x,red.y-ps[1].y).toFixed(3));
const ps2=[blue,red];
console.log('blue feet',feetOf(blue).map(f=>[f.x.toFixed(3),f.y.toFixed(3),Math.hypot(f.x,f.y).toFixed(3)]).join(' | '));
console.log('red feet',feetOf(red).map(f=>[f.x.toFixed(3),f.y.toFixed(3),Math.hypot(f.x,f.y).toFixed(3)]).join(' | '));
console.log('clearance', (C.minGapOf(blue,red)-C.MIND).toFixed(4));
const L=F.limitAt(ps2,1,0,-1);console.log('red arm (0,-) limit',(L.lim/DEG).toFixed(3),L.sig);
const o=C.swing(ps2,1,0,-1,L.lim,{...REPLICA,trace:true,record:true});
console.log('thrown',o.off,'offAt deg',o.offAt&&(o.offAt/DEG).toFixed(2),'maxFootR',o.maxFootR.toFixed(3),'margin',(o.maxFootR-C.EDGE).toFixed(3),'flags',JSON.stringify(o.flags));
console.log('red pivot P',JSON.stringify(o.pivot));
let prev=blue, k=0, sumGain=0;
const rows=[];
for(const rec of o.record){k++;const tr=o.trace.find(t=>Math.abs(t.alpha-rec.alpha)<1e-9);
 const F0=feetOf(prev)[1],F1=feetOf(rec)[1];const gain=Math.hypot(F1.x,F1.y)-Math.hypot(F0.x,F0.y);sumGain+=gain;
 rows.push({k,deg:+(rec.alpha/DEG).toFixed(1),contact:!!tr,i:tr&&tr.i,j:tr&&tr.j,phiA:tr&&+(tr.phiA/DEG).toFixed(1),phiB:tr&&+(tr.phiB/DEG).toFixed(1),psi:tr&&+(tr.psi/DEG).toFixed(1),hf:tr&&+tr.hf.toFixed(3),rn:tr&&+tr.rn.toFixed(2),n:tr&&+(Math.atan2(tr.ny,tr.nx)/DEG).toFixed(1),pen:tr&&+tr.pen.toFixed(4),gain:+gain.toFixed(4),footR:+Math.hypot(F1.x,F1.y).toFixed(3),pose:[+rec.x.toFixed(3),+rec.y.toFixed(3),+(rec.rot/DEG).toFixed(3)]});
 prev=rec; if(rec.maxFootR>C.EDGE)break;}
require('fs').writeFileSync('out/throw-rows.json',JSON.stringify(rows,null,0));
for(const r of rows) if(r.k%5===0||r.k<4||!rows[r.k-2]||rows[r.k-2].contact!==r.contact) console.log(JSON.stringify(r));
console.log('substeps',rows.length,'in contact',rows.filter(r=>r.contact).length,'sum gain',sumGain.toFixed(3));
// crossing angle in 3D between the contact chords at a few substeps, and the closest-point 3D geometry
const arcs=(p)=>[0,1,2].map(i=>{const a=p.rot+i*2*Math.PI/3,ca=Math.cos(a),sa=Math.sin(a),pts=[];for(let k=0;k<=12;k++){const ph=(k/12)*Math.PI/2,s=Math.sin(ph)*R;pts.push({x:p.x+ca*s,y:p.y+sa*s,h:Math.cos(ph)*R});}return pts;});
