const F=require('../forced-win.js');
const C=require('../contact-law.js');
const R=C.R, DEG=Math.PI/180, H=1.0, N=21, EDGE=C.EDGE;
const poses={ndpxhts24:{v:0,p:[-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442]},'6dgqa1fd8':{v:1,p:[2.6627,33.2224,2.2687,4.2061,47.1181,4.4905]},l5807vazg:{v:1,p:[37.6039,-3.2612,1.8896,50.4287,10.5092,-.859]},'0r8c3cohc':{v:1,p:[.8192,-30.3367,-3.2227,19.4916,-35.329,4.106]}};
const arms=[];for(let p=0;p<3;p++)for(const d of [1,-1])arms.push({p,d});
const ek=e=>`f${e.foot}:c${e.circle}/${(e.D??e.A*180/Math.PI).toFixed(2)}(${e.sign>0?'+':'-'})`;
const idx=(i,j,k)=>(i*N+j)*N+k, tot=N*N*N;
for(const id of process.argv.slice(2)){const {v,p:seed}=poses[id];
 const lim=arms.map(()=>[]),sig=arms.map(()=>[]);let off=0,illegal=arms.map(()=>0);
 for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let k=0;k<N;k++){
  const ps=F.piecesOf(seed);ps[v].x+=-H+2*H*i/(N-1);ps[v].y+=-H+2*H*j/(N-1);ps[v].rot+=(-H+2*H*k/(N-1))/R;
  const u=idx(i,j,k);if(C.feetOf(ps[v]).some(f=>Math.hypot(f.x,f.y)>EDGE)){off++;for(let a=0;a<6;a++){lim[a][u]=NaN;sig[a][u]='OFF';}continue;}
  for(let a=0;a<6;a++){const L=F.limitAt(ps,v,arms[a].p,arms[a].d);lim[a][u]=L.lim;sig[a][u]=L.sig+'|'+(L.events||[]).map(ek).join(',');if(L.lim<2*DEG-1e-9)illegal[a]++;}}
 console.log(`\n== ${id}: +-1u box, ${N}^3 poses; ${(100*off/tot).toFixed(1)}% have a victim foot off the board at the start`);
 for(let a=0;a<6;a++){const m={};for(const s of sig[a])if(s!=='OFF')m[s]=(m[s]||0)+1;const ent=Object.entries(m).sort((x,y)=>y[1]-x[1]);
  let maxSame=0,maxDiff=0,nDiff=0;const nb=(x,y)=>{if(sig[a][x]==='OFF'||sig[a][y]==='OFF')return;const d=Math.abs(lim[a][x]-lim[a][y])/DEG;if(sig[a][x]===sig[a][y])maxSame=Math.max(maxSame,d);else{nDiff++;maxDiff=Math.max(maxDiff,d);}};
  for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let k=0;k<N;k++){if(i+1<N)nb(idx(i,j,k),idx(i+1,j,k));if(j+1<N)nb(idx(i,j,k),idx(i,j+1,k));if(k+1<N)nb(idx(i,j,k),idx(i,j,k+1));}
  console.log(`arm (${arms[a].p},${arms[a].d>0?'+':'-'}): illegal(<2deg) ${(100*illegal[a]/tot).toFixed(1)}%; ${ent.length} sigs: `+ent.slice(0,5).map(([s,c])=>`${(100*c/tot).toFixed(1)}% ${s}`).join(' | ')+`\n      limit jump between neighbours: same sig ${maxSame.toFixed(2)} deg, across wall ${maxDiff.toFixed(2)} deg (${nDiff} pairs)`);}
}
