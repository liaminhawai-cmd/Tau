// How often would a same-foot / two-line bin-collision guard fire, and how wide is such a pair's
// separation over the box? (different-foot collisions are safe: either event stops the arm)
const F=require('../forced-win.js'), C=require('../contact-law.js');
const R=C.R, DEG=Math.PI/180, SUB=DEG/3, EDGE=C.EDGE;
const pts={ndpxhts24:{v:0,p:[-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442]},'6dgqa1fd8':{v:1,p:[2.6627,33.2224,2.2687,4.2061,47.1181,4.4905]},l5807vazg:{v:1,p:[37.6039,-3.2612,1.8896,50.4287,10.5092,-.859]},'0r8c3cohc':{v:1,p:[.8192,-30.3367,-3.2227,19.4916,-35.329,4.106]}};
for(const H of [1.0,0.5,0.25]){
 console.log(`\n#### box +-${H}u`);
 for(const [id,{v,p}] of Object.entries(pts)){
  const out=[];
  for(const [pv,dir] of F.ARMS){
   let fire=0,n=0,minSep=Infinity,worstPair=null,sepRange={};
   for(let i=0;i<5;i++)for(let j=0;j<5;j++)for(let k=0;k<41;k++){
    const ps=F.piecesOf(p);ps[v].x+=-H+2*H*i/4;ps[v].y+=-H+2*H*j/4;ps[v].rot+=(-H+2*H*k/40)/R;
    if(C.feetOf(ps[v]).some(f=>Math.hypot(f.x,f.y)>EDGE))continue;
    n++;const L=F.limitAt(ps,v,pv,dir);const ev=F.limitEvents(C.feetOf(ps[v]),pv,dir).filter(e=>e.s<=L.lim+SUB+1e-12);
    let hit=false;
    for(let a=0;a<ev.length;a++)for(let b=a+1;b<ev.length;b++){
     if(ev[a].foot!==ev[b].foot||ev[a].circle===ev[b].circle)continue;
     const d=Math.abs(ev[a].s-ev[b].s); if(d>2*SUB)continue;
     hit=true;const key=`f${ev[a].foot}:c${ev[a].circle}/${ev[a].D}|c${ev[b].circle}/${ev[b].D}`;
     (sepRange[key]=sepRange[key]||{lo:Infinity,hi:-Infinity}); sepRange[key].lo=Math.min(sepRange[key].lo,d); sepRange[key].hi=Math.max(sepRange[key].hi,d);
     if(d<minSep){minSep=d;worstPair=key;}
    }
    if(hit)fire++;
   }
   if(fire)out.push(`  arm (${pv},${dir>0?'+':'-'}): guard fires on ${(100*fire/n).toFixed(1)}% of poses; closest same-foot two-line pair ${(minSep/DEG).toFixed(4)} deg (${worstPair}); ranges ${Object.entries(sepRange).map(([k,r])=>`${(r.lo/DEG).toFixed(3)}-${(r.hi/DEG).toFixed(3)}`).join(', ')}`);
  }
  console.log(` ${id}: ${out.length?'\n'+out.join('\n'):'no arm fires the guard'}`);
 }
}
