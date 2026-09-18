const F=require('../forced-win.js');const C=require('../contact-law.js');
const R=C.R, DEG=Math.PI/180, H=1.0, N=21, EDGE=C.EDGE;
const poses={'6dgqa1fd8':{v:1,p:[2.6627,33.2224,2.2687,4.2061,47.1181,4.4905]},l5807vazg:{v:1,p:[37.6039,-3.2612,1.8896,50.4287,10.5092,-.859]},'0r8c3cohc':{v:1,p:[.8192,-30.3367,-3.2227,19.4916,-35.329,4.106]}};
const arms=[];for(let p=0;p<3;p++)for(const d of [1,-1])arms.push({p,d});
const cname=['r0','r1','a0','a1','rim','K1','K2','K3','K4','K5','K6','K7','K8'];
const ek=e=>`f${e.foot}:${cname[e.circle]}${e.kind==='level'?'@'+e.D.toFixed(2):'ray'+(e.A*180/Math.PI).toFixed(2)}${e.sign>0?'+':'-'}`;
const idx=(i,j,k)=>(i*N+j)*N+k, tot=N*N*N, an=a=>`(${arms[a].p},${arms[a].d>0?'+':'-'})`;
function planeFit(pts){ // least squares plane through points: returns unit normal and centroid
 const n=pts.length,c=[0,0,0];for(const p of pts)for(let q=0;q<3;q++)c[q]+=p[q]/n;
 const M=[[0,0,0],[0,0,0],[0,0,0]];for(const p of pts){const d=[p[0]-c[0],p[1]-c[1],p[2]-c[2]];for(let a=0;a<3;a++)for(let b=0;b<3;b++)M[a][b]+=d[a]*d[b];}
 // smallest eigenvector by inverse power iteration-ish: try many directions (cheap, fine for 3D)
 let best=null;for(let t=0;t<4000;t++){const v=[Math.random()-.5,Math.random()-.5,Math.random()-.5];const l=Math.hypot(...v);const u=v.map(x=>x/l);let q=0;for(let a=0;a<3;a++)for(let b=0;b<3;b++)q+=u[a]*M[a][b]*u[b];if(!best||q<best.q)best={q,u};}
 // refine
 for(let it=0;it<2000;it++){const v=best.u.map(x=>x+(Math.random()-.5)*0.02);const l=Math.hypot(...v);const u=v.map(x=>x/l);let q=0;for(let a=0;a<3;a++)for(let b=0;b<3;b++)q+=u[a]*M[a][b]*u[b];if(q<best.q)best={q,u};}
 const rms=Math.sqrt(best.q/n);return {c,u:best.u,rms};}
for(const id of Object.keys(poses)){const {v,p:seed}=poses[id];
 const lim=arms.map(()=>[]),sig=arms.map(()=>[]);
 for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let k=0;k<N;k++){
  const ps=F.piecesOf(seed);ps[v].x+=-H+2*H*i/(N-1);ps[v].y+=-H+2*H*j/(N-1);ps[v].rot+=(-H+2*H*k/(N-1))/R;
  const u=idx(i,j,k);if(C.feetOf(ps[v]).some(f=>Math.hypot(f.x,f.y)>EDGE)){for(let a=0;a<6;a++){lim[a][u]=NaN;sig[a][u]='OFF';}continue;}
  for(let a=0;a<6;a++){const L=F.limitAt(ps,v,arms[a].p,arms[a].d);lim[a][u]=L.lim;sig[a][u]=L.reason+'|crossed '+(L.crossed.join(',')||'-')+'|stop '+(L.events||[]).map(ek).join(',');}}
 console.log(`\n==== ${id} (victim piece ${v}); seed pose ${JSON.stringify(seed)}`);
 const ps0=F.piecesOf(seed), feet=C.feetOf(ps0[v]);
 console.log('victim feet: '+feet.map((f,i)=>`f${i}=(${f.x.toFixed(2)},${f.y.toFixed(2)}) r=${Math.hypot(f.x,f.y).toFixed(2)}`).join('  '));
 for(let a=0;a<6;a++){
  const L=F.limitAt(ps0,v,arms[a].p,arms[a].d);
  const share={};for(const s of sig[a])if(s!=='OFF')share[s]=(share[s]||0)+1;
  console.log(`\narm ${an(a)}: seed limit ${(L.lim/DEG).toFixed(2)} deg, program: ${L.reason}|crossed ${L.crossed.join(',')||'-'}|stop ${(L.events||[]).map(ek).join(',')}`);
  console.log('  programs in the box: '+Object.entries(share).sort((x,y)=>y[1]-x[1]).map(([s,c])=>`${(100*c/tot).toFixed(1)}% [${s}]`).join('\n                       '));
  // walls: program pairs across grid neighbours
  const pairs=new Map();
  const nb=(x,y,i,j,k,di,dj,dk)=>{const s1=sig[a][x],s2=sig[a][y];if(s1==='OFF'||s2==='OFF'||s1===s2)return;const key=[s1,s2].sort().join(' <-> ');const d=Math.abs(lim[a][x]-lim[a][y])/DEG;
   const mid=[-H+2*H*(i+di/2)/(N-1),-H+2*H*(j+dj/2)/(N-1),-H+2*H*(k+dk/2)/(N-1)];
   if(!pairs.has(key))pairs.set(key,{n:0,max:0,pts:[]});const o=pairs.get(key);o.n++;o.max=Math.max(o.max,d);o.pts.push(mid);};
  for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let k=0;k<N;k++){if(i+1<N)nb(idx(i,j,k),idx(i+1,j,k),i,j,k,1,0,0);if(j+1<N)nb(idx(i,j,k),idx(i,j+1,k),i,j,k,0,1,0);if(k+1<N)nb(idx(i,j,k),idx(i,j,k+1),i,j,k,0,0,1);}
  for(const [key,o] of [...pairs].sort((x,y)=>y[1].n-x[1].n)){if(o.n<20)continue;const pf=planeFit(o.pts);
   const dist=pf.c[0]*pf.u[0]+pf.c[1]*pf.u[1]+pf.c[2]*pf.u[2];
   console.log(`  WALL (${o.n} neighbour pairs, limit jump up to ${o.max.toFixed(2)} deg): ${key}\n     plane fit in victim (dx,dy,t) u: centroid (${pf.c.map(x=>x.toFixed(2))}), normal (${pf.u.map(x=>x.toFixed(3))}), signed distance of the seed from the plane ${(-dist).toFixed(3)}u, rms residual ${pf.rms.toFixed(3)}u`);}
  // the event ladder at the seed pose for this arm, up to limit+50 deg
  if([...pairs.values()].some(o=>o.n>=20&&o.max>2)){const ev=F.limitEvents(feet,arms[a].p,arms[a].d).filter(e=>e.s<L.lim+50*DEG);
   console.log('  event ladder at the seed (angle deg: event): '+ev.map(e=>`${(e.s/DEG).toFixed(2)}: ${ek(e)}`).join(' | '));}
 }
}
