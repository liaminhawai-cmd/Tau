'use strict';
const FW=require('./forced-win.js'),TC=require('./throw-cert.js'),CL=require('./contact-law.js');
const K=CL.REPLICA,DEG=Math.PI/180;
const H=CL.eng.CFG.hubHeight,RHO=CL.eng.CFG.legRadius,NSEG=CL.eng.CFG.legSegs,R=CL.R,HUBR=RHO*1.9;
function emptyPatch(r,a,b,w){return{replyArm:r,replyInterval:[a,b],witness:{pv:w[0],dir:w[1],stopRule:'limit'},eventSignature:null,enclosure:{metric:'L1-foot',radius:0,remainder:0},throwMargin:0,proof:{status:'refused',method:'interval-tube',noEventCrossing:false}};}
function trigRange(A,B,C,lo,hi){const v=[A+B*Math.cos(lo)+C*Math.sin(lo),A+B*Math.cos(hi)+C*Math.sin(hi)];const t=Math.atan2(C,B),t2=t+Math.PI,w=2*Math.PI;for(let k=Math.ceil((lo-t)/w);t+k*w<=hi;k++)v.push(A+B*Math.cos(t+k*w)+C*Math.sin(t+k*w));for(let k=Math.ceil((lo-t2)/w);t2+k*w<=hi;k++)v.push(A+B*Math.cos(t2+k*w)+C*Math.sin(t2+k*w));return[Math.min(...v),Math.max(...v)];}
function exactRigidReplyBox(base,pf,rd,a,b){const dx=base.x-pf.x,dy=base.y-pf.y,lo=Math.min(rd*a,rd*b),hi=Math.max(rd*a,rd*b);const x=trigRange(pf.x,dx,-dy,lo,hi),y=trigRange(pf.y,dy,dx,lo,hi),r0=base.rot+lo,r1=base.rot+hi;return{x,y,rot:[Math.min(r0,r1),Math.max(r0,r1)]};}
function rotAbout(base,foot,s,d){const c=Math.cos(d*s),sn=Math.sin(d*s);return{x:foot.x+(base.x-foot.x)*c-(base.y-foot.y)*sn,y:foot.y+(base.x-foot.x)*sn+(base.y-foot.y)*c,rot:base.rot+d*s};}
function arcPts(p,leg){const a=p.rot+leg*2*Math.PI/3,ca=Math.cos(a),sa=Math.sin(a);const pts=[];for(let k=0;k<=NSEG;k++){const ph=(k/NSEG)*Math.PI/2,s=R*Math.sin(ph);pts.push({x:p.x+ca*s,y:p.y+sa*s,h:H*Math.cos(ph)});}return pts;}
// Point-to-segment distance at the centre sweep angle, with angular-width soundness margin
function segCenterDist(q,cx,cy,r0,th0,r1,th1,h0,h1,thc,margin){
  const c0=Math.cos(th0+thc),s0=Math.sin(th0+thc),c1=Math.cos(th1+thc),s1=Math.sin(th1+thc);
  const a={x:cx+r0*c0,y:cy+r0*s0,h:h0},b={x:cx+r1*c1,y:cy+r1*s1,h:h1};
  const u={x:b.x-a.x,y:b.y-a.y,h:b.h-a.h},uL2=u.x*u.x+u.y*u.y+u.h*u.h;
  if(uL2<1e-18)return Math.max(0,Math.hypot(q.x-a.x,q.y-a.y,q.h-a.h)-margin);
  const w={x:q.x-a.x,y:q.y-a.y,h:q.h-a.h},t=Math.max(0,Math.min(1,(w.x*u.x+w.y*u.y+w.h*u.h)/uL2));
  const foot={x:a.x+t*u.x,y:a.y+t*u.y,h:a.h+t*u.h};
  return Math.max(0,Math.hypot(q.x-foot.x,q.y-foot.y,q.h-foot.h)-margin);
}
function certifiedClearance(base,foot,rd,a,b,rpv,oppPts,oppHubs){
  const thc=(a+b)/2*rd,hi=(Math.abs(a-b))*rd/2; // centre angle, half-width
  const margin=Math.hypot(R,0.5*R)*Math.abs(Math.sin(hi))*1.1; // angular soundness margin
  const arc=arcPts(base,rpv);
  const cfg=[];for(let i=0;i<=NSEG;i++){const p=arc[i];const rx=p.x-foot.x,ry=p.y-foot.y;cfg.push({r:Math.hypot(rx,ry),h:p.h,th0:Math.atan2(ry,rx)});}
  const cx=foot.x,cy=foot.y;let best=1e9;
  for(const q of oppPts)for(let i=0;i<NSEG;i++){const d=segCenterDist(q,cx,cy,cfg[i].r,cfg[i].th0,cfg[i+1].r,cfg[i+1].th0,cfg[i].h,cfg[i+1].h,thc,margin);if(d<best)best=d;}
  for(const hq of oppHubs)for(let i=0;i<NSEG;i++){const d=Math.max(0,segCenterDist(hq,cx,cy,cfg[i].r,cfg[i].th0,cfg[i+1].r,cfg[i+1].th0,cfg[i].h,cfg[i+1].h,thc,margin)-HUBR);if(d<best)best=d;}
  return best;
}
function replyTube(pieces,m,rpv,rd,a,b){
  const fam=FW.replyFamily(pieces,m,rpv,rd,K);if(!fam||!fam.out||!fam.out.record||fam.out.record.length<2)return null;
  if(a<0||b>fam.lim)return null;
  const opp=pieces[1-m];
  const allStatic=fam.out.record.every(q=>Math.abs(q.x-opp.x)<1e-12&&Math.abs(q.y-opp.y)<1e-12&&Math.abs(q.rot-opp.rot)<1e-12);
  if(!allStatic)return null;
  const base=pieces[m],foot=CL.feetOf(base)[rpv];
  const oppPts=[];for(let l=0;l<3;l++)for(const p of arcPts(opp,l))oppPts.push({x:p.x,y:p.y,h:p.h});
  const oppHubs=[];for(let l=0;l<3;l++){const f=CL.feetOf(opp)[l];oppHubs.push({x:f.x,y:f.y,h:0});}
  const clear=certifiedClearance(base,foot,rd,a,b,rpv,oppPts,oppHubs);
  if(clear<=CL.MIND)return null;
  const box=exactRigidReplyBox(base,foot,rd,a,b);
  const cx=(box.x[0]+box.x[1])/2,cy=(box.y[0]+box.y[1])/2,cr=(box.rot[0]+box.rot[1])/2;
  return{centre:{x:cx,y:cy,rot:cr,alpha:(a+b)/2},hx:(box.x[1]-box.x[0])/2,hy:(box.y[1]-box.y[0])/2,hr:(box.rot[1]-box.rot[0])/2,exactReplyBox:box,validated:true,method:'exact+seg clearance',clearance:clear};
}
function certifyPatch(pieces,m,rpv,rd,a,b,wpv,wd,opts){
  const tube=replyTube(pieces,m,rpv,rd,a,b);if(!tube)return{certified:false,why:'no tube'};
  const att=1-m,pcs=pieces.map(p=>({x:p.x,y:p.y,rot:p.rot}));
  return TC.certify(pcs,att,wpv,wd,tube.exactReplyBox,1,{...opts,log:(opts&&opts.log)||(()=>{})});
}
function validatePatch(pieces,m,rpv,rd,a,b,wpv,wd,N,log){log=log||console.log;let ok=0,bad=[];
  for(let i=0;i<N;i++){const s=a+(b-a)*Math.random(),fam=FW.replyFamily(pieces,m,rpv,rd,K);if(!fam){bad.push({stop:s,why:'no family'});continue;}
    const rec=fam.out.record.find(r=>r.alpha>=s-1e-6)||fam.out.record[fam.out.record.length-1];
    const foot=CL.feetOf(pieces[m])[rpv],mPos=rotAbout(pieces[m],foot,rec.alpha,rd);const aPos={x:rec.x,y:rec.y,rot:rec.rot};
    const pcs=m===0?[mPos,aPos]:[aPos,mPos];const box={x:[mPos.x-0.002,mPos.x+0.002],y:[mPos.y-0.002,mPos.y+0.002],rot:[mPos.rot-0.002*DEG,mPos.rot+0.002*DEG]};
    const r=TC.certify(pcs,1-m,wpv,wd,box,1,{log:()=>{}});if(r.certified)ok++;else bad.push({stop:s,why:r.why});}
  log(bad.length===0?'# ok '+ok+'/'+N:'# FAIL '+ok+'/'+N);bad.slice(0,5).forEach(v=>log('#   stop '+v.stop.toFixed(4)+': '+v.why));return bad.length;}
const row={p:[12.2195,37.7663,11.0497,2.8121,28.9609,-13.703],mover:0},rpv=2,rd=1;let wpv=0,wd=-1;
const args=process.argv.slice(2),vi=args.indexOf('--validate'),N=vi>=0?+(args[vi+1]||100):0;
if(args.includes('--target2')){row.p=[1.7957,-26.9125,0.469,-8.4345,-41.2701,1.9721];row.mover=1;wpv=0;wd=1;}
const lim=FW.replyFamily(FW.piecesOf(row.p),row.mover,rpv,rd,K).lim,a=0.99*lim,b=lim;
const pieces=FW.piecesOf(row.p),tube=replyTube(pieces,row.mover,rpv,rd,a,b);
if(!tube){console.log('NO TUBE');process.exit(1);}
const res=certifyPatch(pieces,row.mover,rpv,rd,a,b,wpv,wd);
const rec=emptyPatch([rpv,rd],a,b,[wpv,wd]);rec.enclosure.radius=Math.hypot(tube.hx,tube.hy);
rec.throwMargin=res.minR||0;rec.proof.status=res.certified?'validated':'refused';rec.proof.noEventCrossing=!res.why||!res.why.includes('event');rec.proof.method=tube.method;
console.log(JSON.stringify(rec,null,2));console.log('# certify:',res.certified?'ok k='+res.k+' minR='+(res.minR||0).toFixed(3):'REFUSED: '+(res.why||'?'));console.log('# clearance:',tube.clearance.toFixed(3),'MIND:',CL.MIND);
if(N>0){console.log('# --validate '+N);const v=validatePatch(pieces,row.mover,rpv,rd,a,b,wpv,wd,N);process.exit(v?1:0);}
process.exit(res.certified?0:1);