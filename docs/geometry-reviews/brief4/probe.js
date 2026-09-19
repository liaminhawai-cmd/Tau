'use strict';
const fs=require('fs'),path=require('path'),Module=require('module');
const src=path.resolve(__dirname,'repo/nn/throw-cert.js');
function loadChecker(patch=s=>s) {
 const m=new Module(src);m.filename=src;m.paths=Module._nodeModulePaths(path.dirname(src));
 let s=fs.readFileSync(src,'utf8').replace('module.exports = { certify, analyse, sweep, pushSubstep, LIM_SUB };',
 'module.exports = { certify, analyse, sweep, pushSubstep, LIM_SUB, arcPts, segClosest3, pairDist, rotAbout, aabbOf, matVecIv, matInv, matVec, parkJacobian, vertexBoxOf };');
 s=s.replace('const preAll = analyse(bbAll, att, pair);','const preAll = analyse(bbAll, att, pair); if (opts.onPre) opts.onPre({k,bbAll,preAll,Us,qc,att});');
 s=s.replace('const JB = grp.vk !== null && grp.vk !== undefined && grp.vk >= 0 ? parkJacobian(att, qc, pair, grp.vk, aabbOf(qc, M, U)) : null;',
 'const JB = grp.vk !== null && grp.vk !== undefined && grp.vk >= 0 ? parkJacobian(att, qc, pair, grp.vk, aabbOf(qc, M, U)) : null; if(opts.onGroup) opts.onGroup({k,st,grp,JB,a_c,cc,M,Mi,m3,qc,att,LamC,Lam,dev:matVecIv(M,U)});');
 s=s.replace('post = analyse(aabbOf(qcNext, Mp, Un), att, pair);',
 'post = analyse(aabbOf(qcNext, Mp, Un), att, pair); if(opts.onRound) opts.onRound({k,round,grp,JB,M,Mp,Un,post,cone,Lam,qcNext});');
 m._compile(patch(s),src);return m.exports;
}
const TC=loadChecker(),CL=require('./repo/nn/contact-law.js'),FW=require('./repo/nn/forced-win.js');
const pieces=JSON.parse(fs.readFileSync(path.join(__dirname,'pieces.json'))),DEG=Math.PI/180;
const makeBox=(h,hr)=>({x:[pieces[0].x-h,pieces[0].x+h],y:[pieces[0].y-h,pieces[0].y+h],rot:[pieces[0].rot-hr,pieces[0].rot+hr]});
if(require.main===module) {
 const cases=[];
 for(const pv of [0,2])for(const [h,hr,label] of [[.0002,.002*DEG,'0.002 degrees'],[.0002,.002,'0.002 radians'],[.0003,.003*DEG,'0.003 degrees'],[.001,.01*DEG,'0.01 degrees'],[.1,.01,'0.01 radians']]){
   const pre=[],groups=[];
   let lastK=0,res;try {res=TC.certify(pieces,1,pv,-1,makeBox(h,hr),1,{onPre:o=>{lastK=o.k;if(o.k>65)pre.push({k:o.k,box:o.bbAll,pad:o.preAll.pad,psi:o.preAll.psiN?.map(x=>x/DEG),regimes:o.preAll.segPairs?.map(s=>({a:s.a,b:s.b,vertex:s.vertex,vk:s.vk,exact:s.exact,psi:s.psiN?.map(x=>x/DEG)}))});},onGroup:o=>{if(o.JB)groups.push({k:o.k,seg:o.JB.seg,vk:o.grp.vk,m3:o.m3,a_c:o.a_c,frameError:Math.hypot(o.m3[0]-o.a_c[0],o.m3[1]-o.a_c[1],CL.R*(o.m3[2]-o.a_c[2])),keep:o.st.keep});}});}catch(e){res={certified:false,k:lastK,why:e.stack,threw:true};}
   const summary={pv,h,hr,rotationLabel:label,certified:res.certified,k:res.k,K:res.K,minR:res.minR,why:res.why};cases.push({...summary,pre,groups,rows:res.rows,final:res.final});console.log(JSON.stringify(summary));
 }
 fs.writeFileSync(path.join(__dirname,'baseline.json'),JSON.stringify(cases,null,2));
 const tr=TC.sweep(pieces,1,0,-1,138),jac=[];
 for(const k of [74,79,80,84,85,95]){
   const row=tr[k-1],q=tr[k-2].pose,A=TC.arcPts(row.att,0),V=TC.arcPts(q,0),box={x:[q.x,q.x],y:[q.y,q.y],rot:[q.rot,q.rot]};
   const J=TC.parkJacobian(row.att,q,[0,0],4,box);
   let correct=null;
   for(let a=0;a<12;a++){const c=TC.segClosest3(V[4],V[4],A[a],A[a+1]);if(!correct||c.dist<correct.dist)correct={a,...c};}
   jac.push({k,selected:J.seg,correct:correct.a,B:J.Bc,q,att:row.att,correctProjection:correct});
 }
 fs.writeFileSync(path.join(__dirname,'jacobian-segments.json'),JSON.stringify(jac,null,2));
 console.log('Jacobian segments',jac.map(x=>({k:x.k,selected:x.selected,correct:x.correct})));
}
module.exports={loadChecker,TC,CL,FW,pieces,makeBox};
