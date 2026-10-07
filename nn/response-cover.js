'use strict';
const FW=require('./forced-win.js'),TC=require('./throw-cert.js'),CL=require('./contact-law.js');
const K=CL.REPLICA,DEG=Math.PI/180;
const H=CL.eng.CFG.hubHeight,RHO=CL.eng.CFG.legRadius,NSEG=CL.eng.CFG.legSegs,R=CL.R,HUBR=RHO*1.9;
const EDGE=CL.EDGE,MIN_MOVE=FW.MIN_MOVE,ARMS=FW.ARMS;
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
  const thc=(a+b)/2*rd,hi=Math.abs(a-b)/2; // centre sweep angle, half-width (|rd|=1)
  // SOUNDNESS FIX (2026-10-06): rotating the leg across sweep [a,b] moves each of its points by at
  // most 2*|p-foot|*sin(hi/2); the farthest leg point from the pivot foot is the hub end of the arc
  // (ph=0) at |p-foot| = hypot(R,H), which is R*sqrt(2) in this game because hubHeight = footR
  // (engine CFG), NOT R/2. The previous margin hypot(R,0.5R)*|sin(hi)|*1.1 was ~15% below the
  // true bound for every hi (it assumed H=R/2 and used sin(hi) where 2*sin(hi/2) is required).
  // Both previously validated patches still clear MIND with the corrected margin.
  const margin=2*Math.hypot(R,H)*Math.sin(Math.min(hi,Math.PI)/2)*1.02+1e-9; // angular soundness margin
  const arc=arcPts(base,rpv);
  const cfg=[];for(let i=0;i<=NSEG;i++){const p=arc[i];const rx=p.x-foot.x,ry=p.y-foot.y;cfg.push({r:Math.hypot(rx,ry),h:p.h,th0:Math.atan2(ry,rx)});}
  const cx=foot.x,cy=foot.y;let best=1e9;
  for(const q of oppPts)for(let i=0;i<NSEG;i++){const d=segCenterDist(q,cx,cy,cfg[i].r,cfg[i].th0,cfg[i+1].r,cfg[i+1].th0,cfg[i].h,cfg[i+1].h,thc,margin);if(d<best)best=d;}
  for(const hq of oppHubs)for(let i=0;i<NSEG;i++){const d=Math.max(0,segCenterDist(hq,cx,cy,cfg[i].r,cfg[i].th0,cfg[i+1].r,cfg[i+1].th0,cfg[i].h,cfg[i+1].h,thc,margin)-HUBR);if(d<best)best=d;}
  return best;
}
// The opponent is static over [a,b] iff no push occurred at any sweep angle in [a,b]. The family
// record notes the pushed piece's pose after EVERY step (steps at most REPLICA.stepDeg apart, the
// last exactly at lim), so a push anywhere in (alpha_k, alpha_{k+1}] is visible in entry k+1, and a
// pushed piece never comes back. Checking every record entry from the first at/after a through the
// first AFTER b therefore proves static on [a,b]; entries strictly before a are irrelevant (their
// pushes finished before a). Sub-interval soundness: a contact elsewhere in the family no longer
// refuses a contact-free patch, which the old whole-record test did.
function staticOn(fam,opp,a,b){
  const rec=fam.out.record;
  let i0=rec.findIndex(r=>r.alpha>=a-1e-12);if(i0<0)i0=rec.length-1;
  let i1=rec.findIndex(r=>r.alpha>b+1e-12);if(i1<0)i1=rec.length-1;
  for(let i=i0;i<=i1;i++){const q=rec[i];
    if(Math.abs(q.x-opp.x)>1e-12||Math.abs(q.y-opp.y)>1e-12||Math.abs(q.rot-opp.rot)>1e-12)return false;}
  return true;
}
function replyTube(pieces,m,rpv,rd,a,b){
  const fam=FW.replyFamily(pieces,m,rpv,rd,K);if(!fam||!fam.out||!fam.out.record||fam.out.record.length<2)return null;
  if(a<-1e-12||b>fam.lim)return null;
  const opp=pieces[1-m];
  if(!staticOn(fam,opp,a,b))return null;   // contact-free regime on THIS interval only
  const base=pieces[m],foot=CL.feetOf(base)[rpv];
  const oppPts=[];for(let l=0;l<3;l++)for(const p of arcPts(opp,l))oppPts.push({x:p.x,y:p.y,h:p.h});
  const oppHubs=[];for(let l=0;l<3;l++){const f=CL.feetOf(opp)[l];oppHubs.push({x:f.x,y:f.y,h:0});}
  const clear=certifiedClearance(base,foot,rd,a,b,rpv,oppPts,oppHubs);
  if(clear<=CL.MIND)return null;
  const box=exactRigidReplyBox(base,foot,rd,a,b);
  const cx=(box.x[0]+box.x[1])/2,cy=(box.y[0]+box.y[1])/2,cr=(box.rot[0]+box.rot[1])/2;
  return{centre:{x:cx,y:cy,rot:cr,alpha:(a+b)/2},hx:(box.x[1]-box.x[0])/2,hy:(box.y[1]-box.y[0])/2,hr:(box.rot[1]-box.rot[0])/2,exactReplyBox:box,validated:true,method:'exact+seg clearance',clearance:clear};
}
// The tangent-frame seed (the patch-widening keystone). The reply over [a,b] is an exact rigid
// rotation of the hub about the pinned foot, q(s)=rotAbout(base,foot,s,rd). In the physical metric
// (x,y,R*rot) its tangent at the centre angle c is T=(rd*-(qy-fy),rd*(qx-fx),R*rd), |T|=R*sqrt(2)
// per radian (the hub rides a circle of radius R about the foot while rot advances at 1 rad/rad),
// and the position part's second derivative is bounded by |base-foot|=R (the rot part is exactly
// linear), so
//     q(s) = q(c) + T*(s-c) + r(s),   |r| <= R*(s-c)^2/2  (physical norm, no rot component).
// Seeding certify with the orthonormal frame carrying T in the first column leaves only that
// quadratic remainder as box width in the other two directions; the axis-aligned hull of the same
// interval charges the full linear term per axis independently. Real-arithmetic exact -- see
// docs/geometry-reviews/response-cover-proof-status.md for the floating-point caveat.
function tangentSeed(base,foot,rd,a,b){
  const c=(a+b)/2,tau=Math.abs(b-a)/2,qc=rotAbout(base,foot,c,rd);
  const T=[rd*-(qc.y-foot.y),rd*(qc.x-foot.x),R*rd];   // physical-metric tangent, per radian
  const n1=Math.hypot(T[0],T[1],T[2]);
  const m1=[T[0]/n1,T[1]/n1,T[2]/n1];
  // orthonormal completion in the physical metric: Gram-Schmidt against the least-aligned axis
  const e=Math.abs(m1[0])<=Math.abs(m1[1])&&Math.abs(m1[0])<=Math.abs(m1[2])?[1,0,0]:(Math.abs(m1[1])<=Math.abs(m1[2])?[0,1,0]:[0,0,1]);
  const d=e[0]*m1[0]+e[1]*m1[1]+e[2]*m1[2];
  let m2=[e[0]-d*m1[0],e[1]-d*m1[1],e[2]-d*m1[2]];
  const n2=Math.hypot(m2[0],m2[1],m2[2]);if(n2<1e-9)return null;
  m2=[m2[0]/n2,m2[1]/n2,m2[2]/n2];
  const m3=[m1[1]*m2[2]-m1[2]*m2[1],m1[2]*m2[0]-m1[0]*m2[2],m1[0]*m2[1]-m1[1]*m2[0]];
  const w=R*tau*tau/2+1e-9;              // the quadratic remainder, as a physical ball
  const U=[[-(n1*tau+w),n1*tau+w],[-w,w],[-w,w]];
  // back to pose coordinates: a physical vector (a,b,g) is the pose vector (a,b,g/R)
  const M=[[m1[0],m2[0],m3[0]],[m1[1],m2[1],m3[1]],[m1[2]/R,m2[2]/R,m3[2]/R]];
  return {centre:qc,M,U,tau,w,tangentLen:n1};
}
function certifyPatch(pieces,m,rpv,rd,a,b,wpv,wd,opts){
  opts=opts||{};
  const tube=replyTube(pieces,m,rpv,rd,a,b);if(!tube)return{certified:false,why:'no tube: interval beyond family, contact on the patch, or clearance <= MIND'};
  const att=1-m,pcs=pieces.map(p=>({x:p.x,y:p.y,rot:p.rot}));
  const seed=opts.noSeed?null:tangentSeed(pieces[m],CL.feetOf(pieces[m])[rpv],rd,a,b);
  const jF=opts.jF==null?1:opts.jF;
  return TC.certify(pcs,att,wpv,wd,tube.exactReplyBox,jF,{...opts,seed,log:opts.log||(()=>{})});
}
function validatePatch(pieces,m,rpv,rd,a,b,wpv,wd,N,log){log=log||console.log;let ok=0,bad=[];
  for(let i=0;i<N;i++){const s=a+(b-a)*Math.random(),fam=FW.replyFamily(pieces,m,rpv,rd,K);if(!fam){bad.push({stop:s,why:'no family'});continue;}
    const rec=fam.out.record.find(r=>r.alpha>=s-1e-6)||fam.out.record[fam.out.record.length-1];
    const foot=CL.feetOf(pieces[m])[rpv],mPos=rotAbout(pieces[m],foot,rec.alpha,rd);const aPos={x:rec.x,y:rec.y,rot:rec.rot};
    const pcs=m===0?[mPos,aPos]:[aPos,mPos];const box={x:[mPos.x-0.002,mPos.x+0.002],y:[mPos.y-0.002,mPos.y+0.002],rot:[mPos.rot-0.002*DEG,mPos.rot+0.002*DEG]};
    const r=TC.certify(pcs,1-m,wpv,wd,box,1,{log:()=>{}});if(r.certified)ok++;else bad.push({stop:s,why:r.why});}
  log(bad.length===0?'# ok '+ok+'/'+N:'# FAIL '+ok+'/'+N);bad.slice(0,5).forEach(v=>log('#   stop '+v.stop.toFixed(4)+': '+v.why));return bad.length;}
// Rank the six witness arms for [a,b] by the REPLICA's own throw margin at a few stops of the
// reply, and pick the exposed foot (jF) from the best replay's end pose. The ranker is a HEURISTIC
// only: the accepted witness is whatever certifyPatch then proves over the whole interval.
function witnessPrescreen(pieces,m,rpv,rd,a,b,fam,opts){
  opts=opts||{};const ns=opts.samples||5,att=1-m,rec=fam.out.record;
  const stops=[];for(let i=0;i<ns;i++)stops.push(ns===1?(a+b)/2:a+(b-a)*i/(ns-1));
  const afters=[];
  for(const s of stops){
    const r=rec.find(q=>q.alpha>=s-1e-9)||rec[rec.length-1];
    const p=pieces.map(q=>({x:q.x,y:q.y,rot:q.rot}));
    p[m]=rotAbout(pieces[m],CL.feetOf(pieces[m])[rpv],r.alpha,rd);
    p[att]={x:r.x,y:r.y,rot:r.rot};
    afters.push({s:r.alpha,pose:p});
  }
  const cands=[];
  for(const [wpv,wd] of ARMS){
    let worst=Infinity,end=null;
    for(const {pose} of afters){
      const f2=FW.replyFamily(pose,att,wpv,wd,K);
      if(!f2){worst=-Infinity;end=null;break;}   // arm illegal from a post-reply pose: no witness
      const margin=f2.out.maxFootR-EDGE;
      if(margin<worst)worst=margin;
      if(!end||margin>end.margin)end={margin,pose:f2.out.opp};
    }
    let jF=0,best=-Infinity;
    if(end){const fs=CL.feetOf(end.pose);for(let j=0;j<3;j++){const rr=Math.hypot(fs[j].x,fs[j].y);if(rr>best){best=rr;jF=j;}}}
    cands.push({wpv,wd,margin:worst,jF});
  }
  cands.sort((x,y)=>y.margin-x.margin);
  return {cands,afters};
}
// Try the ranked witnesses (the previous patch's witness first -- witness continuity) until one
// certifies the whole interval. Returns {ok:true,...} or {ok:false,why}. Witness diversity: if
// every one of the first opts.tries refused, keep going through ALL remaining witnesses with a
// positive prescreen margin -- a refused witness is not evidence about the rest, and the census
// showed different arms certify different sub-intervals ((1,1) certified 2x wider than (0,-1)
// at the limit end). Negative-margin arms are correctly skipped: they do not throw at all.
function certifyBest(pieces,m,rpv,rd,a,b,fam,opts){
  opts=opts||{};const log=opts.log||(()=>{});
  const {cands}=witnessPrescreen(pieces,m,rpv,rd,a,b,fam,opts);
  const nFirst=Math.max(1,opts.tries||2);
  const order=cands.slice(0,nFirst);
  for(const c of cands.slice(nFirst)) if(c.margin>0) order.push(c);
  if(opts.hint){const i=order.findIndex(c=>c.wpv===opts.hint.pv&&c.wd===opts.hint.dir);
    if(i>0)order.unshift(order.splice(i,1)[0]);}
  let why='no witnesses';
  for(const c of order){
    if(!(c.margin>-Infinity)){why='every witness arm illegal on the patch';continue;}
    const res=certifyPatch(pieces,m,rpv,rd,a,b,c.wpv,c.wd,{...opts,jF:c.jF});
    log(`    witness (${c.wpv},${c.wd}) jF ${c.jF} prescreen ${c.margin.toFixed(2)}u -> ${res.certified?'CERTIFIED k='+res.k+' minR='+res.minR.toFixed(3):'refused: '+(res.why||'?')}`);
    if(res.certified)return {ok:true,a,b,witness:{pv:c.wpv,dir:c.wd,stopRule:'limit',jF:c.jF},prescreenMargin:c.margin,res,why:null};
    why=res.why||'refused';
  }
  return {ok:false,why};
}
// The validated patch record, in the JSON shape of rigorous-response-patch-cover.md.
function patchRecord(pieces,m,rpv,rd,p){
  const tube=replyTube(pieces,m,rpv,rd,p.a,p.b);
  const ts=tangentSeed(pieces[m],CL.feetOf(pieces[m])[rpv],rd,p.a,p.b);
  return {
    replyArm:[rpv,rd],replyInterval:[p.a,p.b],witness:p.witness,
    eventSignature:'opponent-static+contact-free',
    enclosure:{metric:'L1-foot',radius:tube?Math.hypot(tube.hx,tube.hy):null,halfWidthDeg:(p.b-p.a)/2/DEG,
      tangentSeed:ts?{tau:ts.tau,quadraticRemainder:ts.w,tangentLen:ts.tangentLen}:null},
    throwMargin:p.res&&p.res.minR!=null?p.res.minR-EDGE:null,
    proof:{status:'validated',method:'interval-parallelotope+tangent-seed',noEventCrossing:true,
      clearance:tube?tube.clearance:null,k:p.res?p.res.k:null,minR:p.res?p.res.minR:null,prescreenMargin:p.prescreenMargin}
  };
}
// Cover one complete reply family [MIN_MOVE, lim] with validated patches (milestone 2). Greedy
// right-to-left with a halving gallop; adjacent patches SHARE their endpoint, so every boundary
// point is certified on both neighbours -- the boundary protocol of
// rigorous-response-patch-cover.md: closed intervals, no sliver exception, a gap is a gap.
function coverFamily(pieces,m,rpv,rd,opts){
  opts=opts||{};const log=opts.log||(()=>{});
  const fam=FW.replyFamily(pieces,m,rpv,rd,K);
  if(!fam)return {arm:[rpv,rd],legal:false,covered:true,patches:[],lim:0,domain:null,note:'lim < MIN_MOVE: no legal replies on this arm'};
  const lim=fam.lim,lo=MIN_MOVE,minW=(opts.minWidthDeg||0.05)*DEG,maxPatches=opts.maxPatches||64;
  // a real escape, engine-exact: a stop at/after MIN_MOVE whose reply pushes the opponent off
  for(const r of fam.out.record){if(r.alpha<lo-1e-12)continue;
    const fs=CL.feetOf({x:r.x,y:r.y,rot:r.rot});
    if(fs.some(q=>Math.hypot(q.x,q.y)>EDGE))return {arm:[rpv,rd],legal:true,covered:false,escape:true,escapeAt:r.alpha,patches:[],lim,domain:[lo,lim],note:'the reply pushes the opponent off at '+(r.alpha/DEG).toFixed(2)+' deg'};}
  const patches=[];let hi=lim,why=null,hint=null,lastW=hi-lo;
  while(hi>lo+1e-12){
    if(patches.length>=maxPatches){why='stopped at '+patches.length+' patches';break;}
    // width locality: start from twice the last successful width (the first patch gallops down
    // from the whole span), halve on refusal, and give each accepted patch ONE doubling attempt --
    // the locally certifiable width often grows along the family (away from the parked end).
    let w=Math.min(hi-lo,lastW*2),acc=null;
    for(;;){
      const r=certifyBest(pieces,m,rpv,rd,hi-w,hi,fam,{...opts,hint});
      if(r.ok){acc=r;break;}
      why=r.why;
      if(w<=minW*1.000001)break;
      w=Math.max(minW,w/2);
    }
    if(!acc)break;
    if(w*2<hi-lo-1e-9){
      const r2=certifyBest(pieces,m,rpv,rd,hi-Math.min(w*2,hi-lo),hi,fam,{...opts,hint});
      if(r2.ok)acc=r2;
    }
    patches.push(acc);hint={pv:acc.witness.pv,dir:acc.witness.dir};
    lastW=acc.b-acc.a;hi=acc.a;                 // shared endpoint with the next patch
  }
  const covered=hi<=lo+1e-12;
  const out={arm:[rpv,rd],legal:true,lim,domain:[lo,lim],covered,patches:[],uncovered:covered?null:[lo,hi],why:covered?null:why};
  for(const p of patches)out.patches.push(patchRecord(pieces,m,rpv,rd,p));
  return out;
}
// All six reply families of one dead point (milestone 3): the first fully rigorous dead-position
// certificate. An arm with no legal replies is covered trivially.
function coverDeadPoint(pieces,m,opts){
  opts=opts||{};const log=opts.log||(()=>{});
  const families=[];
  for(const [rpv,rd] of ARMS){
    const t0=Date.now(),cov=coverFamily(pieces,m,rpv,rd,opts);
    log(`  family (${rpv},${rd}): lim ${(cov.lim/DEG).toFixed(2)} deg, ${cov.covered?'COVERED by '+cov.patches.length+' patches':'NOT covered'+(cov.uncovered?' ['+cov.uncovered.map(v=>(v/DEG).toFixed(2)).join(',')+']':' (illegal arm)')} -- ${cov.why||cov.note||''} (${((Date.now()-t0)/1000).toFixed(1)}s)`);
    families.push(cov);
  }
  const covered=families.every(f=>f.covered);
  const margins=families.flatMap(f=>f.patches.map(p=>p.throwMargin==null?Infinity:p.throwMargin));
  return {pose:FW.pose6(pieces),mover:m,plies:2,kind:'point',eps:0,covered,families,worstThrowMargin:margins.length?Math.min(...margins):null};
}
// The rigorous leaf in cellSample's shape (forced-win.js:1611): a verdict whose reply families are
// covered by validated patches rather than sampled margins. cellSample can delegate here per
// point; the sampled Lipschitz gap rule then only has to carry the POSE axis, because the STOP
// axis is proven inside every patch. The graph consumes this as a point node once certifyStar
// grows a ball (eps>0) around it, so the WIN/LOST recursion inherits the proven leaf.
function rigorousCellSample(pieces,victim,opts){
  const cov=coverDeadPoint(pieces,victim,opts);
  const esc=cov.families.some(f=>f.escape);
  const status=cov.covered?'dead':esc?'escape':'unresolved';
  return {status,worstMargin:Number.isFinite(cov.worstThrowMargin)?cov.worstThrowMargin:null,acceptMargin:null,
    why:cov.covered?'all six reply families covered by validated patches':
      (esc?'a legal reply pushes the opponent off (engine-exact escape)':'family covers incomplete: ')+
      cov.families.filter(f=>!f.covered).map(f=>`(${f.arm[0]},${f.arm[1]})`).join(' '),
    slivers:0,probedSlivers:0,samples:[],cover:cov};
}
// The graph-compatible point-node record for a covered dead point: kind/plies/side/pose/eps in
// lookup's shape (forced-win.js:1497), with the proof payload being the per-family patch cover
// itself. eps stays 0 until certifyStar grows a ball around the point with this leaf swapped in.
function p2LeafRecord(cov){
  return {kind:'point',plies:2,side:cov.mover,pose:cov.pose,eps:0,
    proof:{method:'response-patch-cover',families:cov.families.map(f=>({arm:f.arm,covered:f.covered,
      patches:f.patches.map(q=>({interval:q.replyInterval,witness:q.witness,throwMargin:q.throwMargin,clearance:q.proof.clearance}))}))}};
}
module.exports={replyTube,certifyPatch,validatePatch,certifiedClearance,staticOn,tangentSeed,witnessPrescreen,certifyBest,patchRecord,coverFamily,coverDeadPoint,rigorousCellSample,p2LeafRecord,fpReport};
// The --fp report: the leaf's analytic enclosures re-derived with outward-rounded interval
// arithmetic (nn/rigorous-fp.js). The replica sweep stays falsification-tested; what this bounds
// is the enclosure math itself: the exact reply box and the exact-circle clearance.
function fpReport(pieces,m,rpv,rd,a,b,fastClear,log){
  const FP=require('./rigorous-fp.js');
  const base=pieces[m],legA=2*Math.PI/3*rpv;
  const thL=FP.addI(FP.exact(base.rot),FP.pt(legA)),cL=FP.cosI(thL),sL=FP.sinI(thL);
  const foot={x:FP.addI(FP.exact(base.x),FP.mulI(FP.exact(R),cL)),y:FP.addI(FP.exact(base.y),FP.mulI(FP.exact(R),sL))};
  const dx=FP.subI(FP.exact(base.x),foot.x),dy=FP.subI(FP.exact(base.y),foot.y);
  const lo=Math.min(rd*a,rd*b),hi=Math.max(rd*a,rd*b);
  // The range of A + B*cos(th) + C*sin(th) over [lo,hi], rigorously: widened endpoint values plus
  // the exact interior extremum A +- hypot(B,C) whenever atan2's double estimate puts it inside
  // (with a 1e-9 rad slack, far above atan2's ~1e-15 error, so interior extrema are never missed;
  // including an exterior one only widens -- sound either way). Mirrors trigRange exactly, so the
  // only difference between this box and the fast one is floating point.
  const trigR=(A,B,C)=>{
    const f=th=>FP.addI(FP.addI(A,FP.mulI(B,FP.pt(Math.cos(th)))),FP.mulI(C,FP.pt(Math.sin(th))));
    let iv=FP.hull(f(lo),f(hi));
    const H=FP.sqrtI(FP.addI(FP.sqI(B),FP.sqI(C)));
    const t=Math.atan2(C[0],B[0]);
    for(let k=Math.ceil((lo-t)/(2*Math.PI));t+2*Math.PI*k<=hi+1e-9;k++)
      if(t+2*Math.PI*k>=lo-1e-9)iv=FP.hull(iv,FP.addI(A,H));
    const t2=t+Math.PI;
    for(let k=Math.ceil((lo-t2)/(2*Math.PI));t2+2*Math.PI*k<=hi+1e-9;k++)
      if(t2+2*Math.PI*k>=lo-1e-9)iv=FP.hull(iv,FP.subI(A,H));
    return iv;
  };
  const xB=trigR(foot.x,dx,FP.negI(dy));
  const yB=trigR(foot.y,dy,dx);
  const fast=exactRigidReplyBox(base,CL.feetOf(base)[rpv],rd,a,b);
  log('# --fp exact reply box (rigorous vs fast, same endpoint+extremum method):');
  log('#   x ['+xB[0].toExponential(4)+','+xB[1].toExponential(4)+'] vs ['+fast.x[0].toExponential(4)+','+fast.x[1].toExponential(4)+']  FP widening +'+(FP.wid(xB)-(fast.x[1]-fast.x[0])).toExponential(2)+'u');
  log('#   y ['+yB[0].toExponential(4)+','+yB[1].toExponential(4)+'] vs ['+fast.y[0].toExponential(4)+','+fast.y[1].toExponential(4)+']  FP widening +'+(FP.wid(yB)-(fast.y[1]-fast.y[0])).toExponential(2)+'u');
  const hi2=Math.abs(a-b)/2;
  const rad=FP.sqrtI(FP.addI(FP.sqI(FP.exact(R)),FP.sqI(FP.exact(H))));
  const marginI=FP.addI(FP.scaleI(FP.mulI(FP.mulI(FP.exact(2),rad),FP.pt(Math.sin(Math.min(hi2,Math.PI)/2))),1.02),FP.exact(1e-9));
  const thc=rd*(a+b)/2,ct=FP.pt(Math.cos(thc)),st=FP.pt(Math.sin(thc));
  const opp=pieces[1-m],arc=arcPts(base,rpv);
  const oppPts=[];for(let l=0;l<3;l++)for(const p of arcPts(opp,l))oppPts.push({x:FP.exact(p.x),y:FP.exact(p.y),h:FP.exact(p.h)});
  const oppHubs=[];for(let l=0;l<3;l++){const f=CL.feetOf(opp)[l];oppHubs.push({x:FP.exact(f.x),y:FP.exact(f.y),h:FP.exact(0)});}
  const d3=(p,q)=>FP.sqrtI(FP.addI(FP.addI(FP.sqI(FP.subI(p.x,q.x)),FP.sqI(FP.subI(p.y,q.y))),FP.sqI(FP.subI(p.h,q.h))));
  const segD=(q,A0,A1)=>{
    const ux=FP.subI(A1.x,A0.x),uy=FP.subI(A1.y,A0.y),uh=FP.subI(A1.h,A0.h);
    const L2=FP.addI(FP.addI(FP.sqI(ux),FP.sqI(uy)),FP.sqI(uh));
    if(L2[0]<1e-18)return FP.max0(FP.subI(d3(q,A0),marginI));
    const num=FP.addI(FP.addI(FP.mulI(FP.subI(q.x,A0.x),ux),FP.mulI(FP.subI(q.y,A0.y),uy)),FP.mulI(FP.subI(q.h,A0.h),uh));
    let t=FP.divPosI(num,L2);
    if(t[1]<0)t=[0,0];else if(t[0]>1)t=[1,1];else t=[Math.max(0,t[0]),Math.min(1,t[1])];
    const fx=FP.addI(A0.x,FP.mulI(t,ux)),fy=FP.addI(A0.y,FP.mulI(t,uy)),fh=FP.addI(A0.h,FP.mulI(t,uh));
    return FP.max0(FP.subI(FP.sqrtI(FP.addI(FP.addI(FP.sqI(FP.subI(q.x,fx)),FP.sqI(FP.subI(q.y,fy))),FP.sqI(FP.subI(q.h,fh)))),marginI));
  };
  let best=FP.exact(1e9);
  for(let i=0;i<NSEG;i++){
    const r0={x:FP.subI(FP.exact(arc[i].x),foot.x),y:FP.subI(FP.exact(arc[i].y),foot.y),h:FP.exact(arc[i].h)};
    const r1={x:FP.subI(FP.exact(arc[i+1].x),foot.x),y:FP.subI(FP.exact(arc[i+1].y),foot.y),h:FP.exact(arc[i+1].h)};
    const A0={x:FP.addI(foot.x,FP.subI(FP.mulI(r0.x,ct),FP.mulI(r0.y,st))),y:FP.addI(foot.y,FP.addI(FP.mulI(r0.x,st),FP.mulI(r0.y,ct))),h:r0.h};
    const A1={x:FP.addI(foot.x,FP.subI(FP.mulI(r1.x,ct),FP.mulI(r1.y,st))),y:FP.addI(foot.y,FP.addI(FP.mulI(r1.x,st),FP.mulI(r1.y,ct))),h:r1.h};
    for(const q of oppPts){const d=segD(q,A0,A1);if(d[0]<best[0])best=d;}
    for(const hq of oppHubs){const d=FP.max0(FP.subI(segD(hq,A0,A1),FP.exact(HUBR)));if(d[0]<best[0])best=d;}
  }
  log('# --fp exact-circle clearance: rigorous lower bound '+best[0].toFixed(4)+'u (fast '+fastClear.toFixed(4)+'u, gap '+(fastClear-best[0]).toExponential(2)+'u) vs MIND '+CL.MIND+' -> '+(best[0]>CL.MIND?'PASSES under outward rounding':'FAILS under outward rounding'));
}
if(require.main===module){
  const args=process.argv.slice(2),log=console.log;
  const vi=args.indexOf('--validate'),N=vi>=0?+(args[vi+1]||100):0;
  const target2=args.includes('--target2');
  const row=target2?{p:[1.7957,-26.9125,0.469,-8.4345,-41.2701,1.9721],mover:1}:{p:[12.2195,37.7663,11.0497,2.8121,28.9609,-13.703],mover:0};
  const pieces=FW.piecesOf(row.p),m=row.mover;
  const fami=args.indexOf('--family');
  if(fami>=0||args.includes('--dead')||args.includes('--retro')){
    const opts={log,tries:3,samples:5,minWidthDeg:0.05,maxPatches:256};
    if(fami>=0){
      const rpv=+(args[fami+1]!=null?args[fami+1]:2),rd=+(args[fami+2]!=null?args[fami+2]:1);
      log('# family cover ('+rpv+','+rd+'), mover '+m+', pose '+JSON.stringify(row.p));
      const cov=coverFamily(pieces,m,rpv,rd,opts);
      log(JSON.stringify(cov,null,2));process.exit(cov.covered?0:1);
    }
    log('# dead-point rigorous cover, mover '+m+', pose '+JSON.stringify(row.p));
    const cov=coverDeadPoint(pieces,m,opts);
    log(JSON.stringify(cov,null,2));
    if(args.includes('--retro')){
      const leaf=p2LeafRecord(cov);
      log('# P2 leaf record (graph-node shape; append once certifyStar grows eps>0 around it):');
      log(JSON.stringify(leaf));
      if(args.includes('--write')){require('fs').appendFileSync(__dirname+'/data/rigorous-dead-points.jsonl',JSON.stringify(leaf)+'\n');log('# appended to nn/data/rigorous-dead-points.jsonl');}
    }
    process.exit(cov.covered?0:1);
  }
  const ti=args.indexOf('--try');
  if(ti>=0){
    const rpv=2,rd=1,fam=FW.replyFamily(pieces,m,rpv,rd,K);
    const aa=+(args[ti+1]!=null?args[ti+1]:0),bb=+(args[ti+2]!=null?args[ti+2]:(fam.lim/DEG));
    const a=aa*DEG,b=Math.min(bb,fam.lim/DEG)*DEG;
    log('# try ['+aa.toFixed(3)+','+(b/DEG).toFixed(3)+'] deg on family ('+rpv+','+rd+') of target '+(target2?'2':'1')+(args.includes('--noseed')?' [no seed]':' [tangent seed]'));
    const pr=witnessPrescreen(pieces,m,rpv,rd,a,b,fam,{samples:7});
    for(const c of pr.cands)log('#   prescreen ('+c.wpv+','+c.wd+') jF '+c.jF+' worst-margin '+c.margin.toFixed(2)+'u');
    for(const c of pr.cands){
      const res=certifyPatch(pieces,m,rpv,rd,a,b,c.wpv,c.wd,{jF:c.jF,noSeed:args.includes('--noseed'),log:()=>{}});
      log('#   certify ('+c.wpv+','+c.wd+'): '+(res.certified?'CERTIFIED k='+res.k+' minR='+res.minR.toFixed(4)+'u (margin '+(res.minR-EDGE).toFixed(4)+'u)':'refused: '+(res.why||'?')));
      if(res.certified&&!args.includes('--all'))break;
    }
    process.exit(0);
  }
  if(args.includes('--width')){
    const rpv=2,rd=1,fam=FW.replyFamily(pieces,m,rpv,rd,K),lim=fam.lim;
    for(const mode of [{name:'axis-box',noSeed:true},{name:'tangent-seed',noSeed:false}]){
      let w=lim,found=null;
      for(;;){const r=certifyBest(pieces,m,rpv,rd,lim-w,lim,fam,{log:()=>{},tries:2,samples:5,noSeed:mode.noSeed});
        if(r.ok){found={w,res:r.res,witness:r.witness};break;}
        if(w<=0.05*DEG)break;w=Math.max(0.05*DEG,w/2);}
      if(found){let wHi=Math.min(found.w*2,lim);   // three bisections to tighten the report
        for(let it=0;it<3;it++){const wM=(found.w+wHi)/2;
          const r=certifyBest(pieces,m,rpv,rd,lim-wM,lim,fam,{log:()=>{},tries:2,samples:5,noSeed:mode.noSeed});
          if(r.ok){found={w:wM,res:r.res,witness:r.witness};}else wHi=wM;}}
      log('# '+mode.name+': widest patch at lim = '+(found?'>='+(found.w/DEG).toFixed(3)+' deg (k='+found.res.k+', minR='+found.res.minR.toFixed(3)+', witness ('+found.witness.pv+','+found.witness.dir+') jF '+found.witness.jF+')':'none down to 0.05 deg'));
    }
    process.exit(0);
  }
  const rpv=2,rd=1,wpv=0,wd=target2?1:-1;
  const lim=FW.replyFamily(pieces,m,rpv,rd,K).lim,a=0.99*lim,b=lim;
  const tube=replyTube(pieces,m,rpv,rd,a,b);
  if(!tube){log('NO TUBE');process.exit(1);}
  const res=certifyPatch(pieces,m,rpv,rd,a,b,wpv,wd);
  const ts=tangentSeed(pieces[m],CL.feetOf(pieces[m])[rpv],rd,a,b);
  const rec=emptyPatch([rpv,rd],a,b,[wpv,wd]);
  rec.witness.jF=1;
  rec.enclosure.radius=Math.hypot(tube.hx,tube.hy);rec.enclosure.remainder=ts?ts.w:null;rec.enclosure.halfWidthDeg=(b-a)/2/DEG;
  rec.throwMargin=res.minR!=null?res.minR-EDGE:0;
  rec.proof.status=res.certified?'validated':'refused';rec.proof.noEventCrossing=!!res.certified;
  rec.proof.method=tube.method+(ts?'+tangent-seed':'');rec.proof.clearance=tube.clearance;
  rec.proof.k=res.k||null;rec.proof.minR=res.minR!=null?res.minR:null;
  log(JSON.stringify(rec,null,2));
  log('# certify:',res.certified?'ok k='+res.k+' minR='+(res.minR||0).toFixed(3):'REFUSED: '+(res.why||'?'));
  log('# clearance:',tube.clearance.toFixed(3),'MIND:',CL.MIND,'| seed: tau',(ts?ts.tau/DEG:0).toFixed(4)+'deg, remainder',(ts?ts.w:0).toExponential(2)+'u');
  if(args.includes('--fp'))fpReport(pieces,m,rpv,rd,a,b,tube.clearance,log);
  if(N>0){log('# --validate '+N);const v=validatePatch(pieces,m,rpv,rd,a,b,wpv,wd,N);process.exit(v?1:0);}
  process.exit(res.certified?0:1);
}