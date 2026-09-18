// what is different about the second and third crossings
const F=require('../forced-win.js');const C=require('../contact-law.js');const R=C.R,DEG=Math.PI/180,{REPLICA,feetOf}=C;
const blue0={x:-24.31126879077936,y:-37.34799285619334,rot:1.3448263401595464}, red0={x:-11.7593,y:-23.2838,rot:2.9442};
const o=C.swing([blue0,red0],1,0,-1,46*DEG,{...REPLICA,stepDeg:1/3,trace:true,record:true});
const rows=[];
for(const t of o.trace){rows.push({deg:t.alpha/DEG,phiA:t.phiA/DEG,phiB:t.phiB/DEG,rn:t.rn,hf:t.hf,psi:t.psi/DEG,n:Math.atan2(t.ny,t.nx)/DEG,pen:t.pen,i:t.i,j:t.j});}
console.log('contact substeps',rows.length,'from',rows[0].deg.toFixed(2),'to',rows[rows.length-1].deg.toFixed(2));
// lever arm zero crossing
for(let k=1;k<rows.length;k++){const a=rows[k-1],b=rows[k];
 if(a.rn*b.rn<0){const t=a.rn/(a.rn-b.rn);console.log(`lever arm rn crosses ZERO at sweep ${(a.deg+t*(b.deg-a.deg)).toFixed(2)} deg (${a.rn.toFixed(3)} -> ${b.rn.toFixed(3)})`);}}
// distance of the contact point from the nearest chord vertex on each leg, in u
const vdistA=p=>{const m=p.phiA/7.5;return Math.min(m-Math.floor(m),Math.ceil(m)-m)*7.5*DEG*R;};
const vdistB=p=>{const m=p.phiB/7.5;return Math.min(m-Math.floor(m),Math.ceil(m)-m)*7.5*DEG*R;};
console.log('\nsweep | phiA | phiB | u to nearest attacker vertex | u to nearest victim vertex | rn | hf | crossing angle of the chords');
const arcP=(p,i)=>{const a=p.rot+i*2*Math.PI/3,ca=Math.cos(a),sa=Math.sin(a),pts=[];for(let k=0;k<=12;k++){const ph=(k/12)*Math.PI/2,s=Math.sin(ph)*R;pts.push({x:p.x+ca*s,y:p.y+sa*s,h:Math.cos(ph)*R});}return pts;};
const P={x:-34.40582386831619,y:-18.75456367565295};
const rot=(p,dA)=>{const c=Math.cos(dA),s=Math.sin(dA),rx=p.x-P.x,ry=p.y-P.y;return {x:P.x+rx*c-ry*s,y:P.y+rx*s+ry*c,rot:p.rot+dA};};
for(const p of rows){ if(!(p.deg>8.5&&p.deg<12.5||p.deg>23&&p.deg<26.5))continue;
 const k=Math.round(p.deg*3), att=rot(red0,-k*(1/3)*DEG), rec=o.record[k-1];
 const A=arcP(att,0),V=arcP(rec,0);
 const ia=Math.min(11,Math.floor(p.phiA/7.5)),ib=Math.min(11,Math.floor(p.phiB/7.5));
 const ua=[A[ia+1].x-A[ia].x,A[ia+1].y-A[ia].y,A[ia+1].h-A[ia].h],ub=[V[ib+1].x-V[ib].x,V[ib+1].y-V[ib].y,V[ib+1].h-V[ib].h];
 const cr=[ua[1]*ub[2]-ua[2]*ub[1],ua[2]*ub[0]-ua[0]*ub[2],ua[0]*ub[1]-ua[1]*ub[0]];
 const chi=Math.asin(Math.min(1,Math.hypot(...cr)/(Math.hypot(...ua)*Math.hypot(...ub))))/DEG;
 console.log(`${p.deg.toFixed(2).padStart(6)} | ${p.phiA.toFixed(2)} | ${p.phiB.toFixed(2)} | ${vdistA(p).toFixed(3)} | ${vdistB(p).toFixed(3)} | ${p.rn.toFixed(3).padStart(7)} | ${p.hf.toFixed(3)} | ${chi.toFixed(1)}`);}
