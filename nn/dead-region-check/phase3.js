// Over each seed's 1u box: how close do two REACHABLE events come, per arm? (bin width 1/3 deg)
const F=require('../forced-win.js'), C=require('../contact-law.js');
const R=C.R, DEG=Math.PI/180, SUB=DEG/3, EDGE=C.EDGE;
const pts={ndpxhts24:{v:0,p:[-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442]},'6dgqa1fd8':{v:1,p:[2.6627,33.2224,2.2687,4.2061,47.1181,4.4905]},l5807vazg:{v:1,p:[37.6039,-3.2612,1.8896,50.4287,10.5092,-.859]},'0r8c3cohc':{v:1,p:[.8192,-30.3367,-3.2227,19.4916,-35.329,4.106]}};
const N=+(process.argv[2]||9), H=1.0;
for(const [id,{v,p}] of Object.entries(pts)){
 const stat={};
 for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let k=0;k<N;k++){
  const ps=F.piecesOf(p);ps[v].x+=-H+2*H*i/(N-1);ps[v].y+=-H+2*H*j/(N-1);ps[v].rot+=(-H+2*H*k/(N-1))/R;
  if(C.feetOf(ps[v]).some(f=>Math.hypot(f.x,f.y)>EDGE))continue;
  for(const [pv,dir] of F.ARMS){const key=`${pv},${dir>0?'+':'-'}`;
   const L=F.limitAt(ps,v,pv,dir);const ev=F.limitEvents(C.feetOf(ps[v]),pv,dir).filter(e=>e.s<=L.lim+SUB+1e-12);
   let mn=Infinity,share=0;
   for(let a=1;a<ev.length;a++){const d=ev[a].s-ev[a-1].s;if(d<mn)mn=d;if(Math.floor(ev[a].s/SUB)===Math.floor(ev[a-1].s/SUB))share++;}
   const s=stat[key]=stat[key]||{min:Infinity,shareP:0,n:0,under:0};
   s.n++;s.min=Math.min(s.min,mn);if(share)s.shareP++;if(mn<SUB)s.under++;}
 }
 console.log(`\n== ${id} (+-1u, ${N}^3)`);
 for(const [k,s] of Object.entries(stat))console.log(`  arm ${k}: closest reachable event pair ${(s.min/DEG).toFixed(4)} deg; poses with a shared bin ${(100*s.shareP/s.n).toFixed(1)}%, with a pair under one bin ${(100*s.under/s.n).toFixed(1)}%`);
}
