'use strict';
// Research proof attempt: interval propagation of the one-parameter reply family through
// hubV-only engine substeps, proving leg-leg exclusion before each push. No sampling is used
// for acceptance. Accepted leaves cover closed reply-angle intervals.
const FW=require('../forced-win.js'),TC=require('../throw-cert.js'),CL=require('../contact-law.js');
const DEG=Math.PI/180,R=CL.R,D=CL.MIND,HUBD=CL.eng.CFG.legRadius*2.9;
const base=FW.piecesOf([12.2195,37.7663,11.0497,2.8121,28.9609,-13.703]),victim=0,attacker=1;
const replyPv=2,replyDir=1,throwPv=0,throwDir=-1,KSTOP=23;
const foot=CL.feetOf(base[victim])[replyPv], pivot=CL.feetOf(base[attacker])[throwPv];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]],mul=(a,b)=>{let p=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];return[Math.min(...p),Math.max(...p)]};
function cosI(lo,hi){let v=[Math.cos(lo),Math.cos(hi)];for(let k=Math.ceil(lo/Math.PI);k*Math.PI<=hi;k++)v.push(Math.cos(k*Math.PI));return[Math.min(...v),Math.max(...v)];}
const sinI=(lo,hi)=>cosI(lo-Math.PI/2,hi-Math.PI/2);
function initialBox(a,b){let dx=base[victim].x-foot.x,dy=base[victim].y-foot.y,lo=replyDir*a,hi=replyDir*b,c=cosI(lo,hi),s=sinI(lo,hi);return{x:add([foot.x,foot.x],add(mul([dx,dx],c),mul([-dy,-dy],s))),y:add([foot.y,foot.y],add(mul([dy,dy],c),mul([dx,dx],s))),rot:[base[victim].rot+lo,base[victim].rot+hi]};}
function attAt(k){let th=throwDir*k*TC.LIM_SUB,c=Math.cos(th),s=Math.sin(th),dx=base[attacker].x-pivot.x,dy=base[attacker].y-pivot.y;return{x:pivot.x+dx*c-dy*s,y:pivot.y+dx*s+dy*c,rot:base[attacker].rot+th};}
function propagateLeaf(a,b){let box=initialBox(a,b), minLeg=Infinity, regimes=[];
 for(let k=1;k<=KSTOP;k++){
  const att=attAt(k);
  // Gauss-Seidel iterations. analyse proves all leg pairs clear whenever free=true;
  // hubV may still be active and is then propagated by its owned interval law.
  for(let it=0;it<CL.REPLICA.iters;it++){
   const an=TC.analyse(box,att,null,true);
   if(an.refuse)return{ok:false,a,b,k,it,why:an.refuse};
   // analyse's minDist is leg distance minus pose pad, only valid when no leg pair is touchable.
   if(!an.free)return{ok:false,a,b,k,it,why:'leg pair touchable in interval hull'};
   if(Number.isFinite(an.minDist))minLeg=Math.min(minLeg,an.minDist-D);
   const hv=an.hubV&&an.hubV.regime;
   if(!hv)break;
   let lam=[Math.max(0,hv.lam[0]),Math.max(0,hv.lam[1])];
   if(lam[0]===0&&lam[1]===0)break;
   const dx=mul(lam,cosI(hv.psi[0],hv.psi[1])),dy=mul(lam,sinI(hv.psi[0],hv.psi[1]));
   box={x:add(box.x,dx),y:add(box.y,dy),rot:box.rot};
   regimes.push({k,it,leg:hv.i,vertex:hv.vertex,straddle:hv.straddle});
  }
 }
 return{ok:true,a,b,minLeg,box,regimes};
}
function cover(a,b,depth,maxDepth,out){let q=propagateLeaf(a,b);if(q.ok){out.push(q);return;}if(depth>=maxDepth){out.push(q);return;}let m=(a+b)/2;cover(a,m,depth+1,maxDepth,out);cover(m,b,depth+1,maxDepth,out);}
const leaves=[];cover(2.4*DEG,2.6*DEG,0,10,leaves);
const good=leaves.filter(x=>x.ok),bad=leaves.filter(x=>!x.ok),covered=bad.length===0;
console.log(JSON.stringify({covered,domainDeg:[2.4,2.6],kThrough:KSTOP,leaves:leaves.length,good:good.length,bad:bad.length,minCertifiedLegGap:good.length?Math.min(...good.map(x=>x.minLeg)):null,maxLeafWidthDeg:good.length?Math.max(...good.map(x=>(x.b-x.a)/DEG)):null,firstBad:bad[0]||null},null,2));
process.exit(covered?0:1);
