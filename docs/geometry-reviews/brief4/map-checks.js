'use strict';
const fs=require('fs'),path=require('path');const {TC,CL,pieces,loadChecker,makeBox}=require('./probe.js');const {contactMap}=require('./contact-map.js');
const tr=TC.sweep(pieces,1,0,-1,138),out={jacobian:[],variants:[]},DEG=Math.PI/180,SQI=Math.sqrt(CL.I);
for(const k of [74,79,80,84]) {
 const row=tr[k-1],q=tr[k-2].pose,box={x:[q.x,q.x],y:[q.y,q.y],rot:[q.rot,q.rot]},old=TC.parkJacobian(row.att,q,[0,0],4,box);
 const exact=contactMap(row.att,q,{kind:'victim-vertex',a:1,vk:4}),h=1e-5,fd=[[],[],[]];
 for(let j=0;j<3;j++){
   const key=['x','y','rot'][j],v=h/(j===2?SQI:1),qm={...q,[key]:q[key]-v},qp={...q,[key]:q[key]+v};
   const m=contactMap(row.att,qm,{kind:'victim-vertex',a:1,vk:4}),p=contactMap(row.att,qp,{kind:'victim-vertex',a:1,vk:4});
   for(let i=0;i<3;i++)fd[i][j]=(p.phi[i]-m.phi[i])/(2*h);
 }
 const err=Math.max(...fd.flatMap((r,i)=>r.map((x,j)=>Math.abs(x-exact.J[i][j]))));
 out.jacobian.push({k,oldSeg:old.seg,oldB:old.Bc,exactB:exact.B,maxBError:Math.max(...old.Bc.flatMap((r,i)=>r.map((x,j)=>Math.abs(x-exact.B[i][j])))),fullMap:exact,finiteDifferenceError:err});
}
const segFix=s=>s.replace('segClosest3(A[a], A[a + 1], p, p)','segClosest3(p, p, A[a], A[a + 1])');
const frameFix=s=>s.replace('return add(add(acc, mul(lam, da[i])), scale(mul(lam, [-Bm3[i], -Bm3[i]]), LamC));',
 'return add(add(add(acc, mul(lam, da[i])), scale(mul(lam, [-Bm3[i], -Bm3[i]]), LamC)),scale(lam,a_c[i]-m3[i]));')
 .replace('const wv = da.map((d, r) => sub(mul(Lam, d), [vC[r], vC[r]]));',
 'const wv = da.map((d, r) => add(sub(mul(Lam, d), [vC[r], vC[r]]),scale(sub(Lam,[LamC,LamC]),a_c[r]-m3[r])));');
for(const [name,patch] of [['chord selection only',segFix],['chord and frame identity',s=>frameFix(segFix(s))]])for(const h of [.0002,.001]) {
 let r;try{r=loadChecker(patch).certify(pieces,1,0,-1,makeBox(h,h*10*DEG),1);}catch(e){r={certified:false,why:e.message};}
 out.variants.push({name,h,certified:r.certified,k:r.k,minR:r.minR,why:r.why});
}
out.staticBoxExits=[];
for(const h of [.1,.125]) {
 const t=tr.find(t=>Math.abs(t.pose.x-pieces[0].x)>h||Math.abs(t.pose.y-pieces[0].y)>h||Math.abs(t.pose.rot-pieces[0].rot)>.01);
 out.staticBoxExits.push({h,theta:.01,k:t.k,deg:t.k/3,delta:{x:t.pose.x-pieces[0].x,y:t.pose.y-pieces[0].y,rot:t.pose.rot-pieces[0].rot},radius:t.maxFootR});
}
out.beforeThrowDelta={x:tr[82].pose.x-pieces[0].x,y:tr[82].pose.y-pieces[0].y,rot:tr[82].pose.rot-pieces[0].rot};
fs.writeFileSync(path.join(__dirname,'map-checks.json'),JSON.stringify(out,null,2));
console.log(JSON.stringify({jacobian:out.jacobian.map(r=>({k:r.k,oldSeg:r.oldSeg,oldB00:r.oldB[0][0],trueB00:r.exactB[0][0],maxBError:r.maxBError,fullMapFiniteDiffError:r.finiteDifferenceError})),variants:out.variants,staticBoxExits:out.staticBoxExits,beforeThrowDelta:out.beforeThrowDelta},null,2));
if(out.jacobian.some(x=>x.finiteDifferenceError>1e-7))process.exitCode=1;
