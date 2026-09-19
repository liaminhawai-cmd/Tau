// Is the envelope's hi an upper bound on the true limit everywhere in the box?
// Dense grid + random poses, compared against the envelope this code computes for the same box.
const F=require('../forced-win.js'), C=require('../contact-law.js');
const R=C.R, DEG=Math.PI/180, SUB=DEG/3, EDGE=C.EDGE;
const pts={ndpxhts24:{v:0,p:[-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442]},'6dgqa1fd8':{v:1,p:[2.6627,33.2224,2.2687,4.2061,47.1181,4.4905]}};
const N=+(process.argv[2]||25), RAND=+(process.argv[3]||20000), H=1.0;
for(const [id,{v,p}] of Object.entries(pts)){
 const ps0=F.piecesOf(p), q=ps0[v];
 const box={x:[q.x-H,q.x+H],y:[q.y-H,q.y+H],rot:[q.rot-H/R,q.rot+H/R]};
 const envs=F.ARMS.map(([pv,dir])=>({pv,dir,e:F.reachEnvelope(ps0,v,pv,dir,box,5,{exact:true})}));
 console.log(`\n== ${id}`);
 for(const {pv,dir,e} of envs)console.log(`  arm (${pv},${dir}) ${e.refused?('REFUSED: '+e.refused.slice(0,110)):('hi '+(e.hi/DEG).toFixed(3)+' deg'+(e.union&&e.union.length>1?' [union '+e.union.length+']':''))}`);
 const live=envs.filter(x=>!x.e.refused);
 if(!live.length){console.log('  (no envelope to test)');continue;}
 const worst={}, poseAt=(dx,dy,dt)=>{const ps=F.piecesOf(p);ps[v].x+=dx;ps[v].y+=dy;ps[v].rot+=dt/R;return ps;};
 const test=ps=>{ if(C.feetOf(ps[v]).some(f=>Math.hypot(f.x,f.y)>EDGE))return;
   for(const {pv,dir,e} of live){const L=F.limitAt(ps,v,pv,dir);const over=L.lim-e.hi;const k=`${pv},${dir}`;
     if(!worst[k]||over>worst[k].over)worst[k]={over,lim:L.lim,sig:L.sig,pose:[ps[v].x,ps[v].y,ps[v].rot]};}};
 for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let k=0;k<N;k++)test(poseAt(-H+2*H*i/(N-1),-H+2*H*j/(N-1),-H+2*H*k/(N-1)));
 for(let t=0;t<RAND;t++)test(poseAt((2*Math.random()-1)*H,(2*Math.random()-1)*H,(2*Math.random()-1)*H));
 console.log(`  ${N}^3 grid + ${RAND} random poses:`);
 for(const [k,w] of Object.entries(worst))console.log(`    arm (${k}): worst (limit - hi) = ${(w.over/DEG).toFixed(4)} deg${w.over>1e-12?`  AT [${w.pose.map(x=>+x.toFixed(5))}] limit ${(w.lim/DEG).toFixed(3)} [${w.sig}]`:'  (hi holds)'}`);
}
