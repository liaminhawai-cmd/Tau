const F=require('../forced-win.js');
const C=require('../contact-law.js');
const R=C.R, DEG=Math.PI/180, H=+(process.argv[2]||1.0), N=+(process.argv[3]||21);
const seed=[-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442];
const arms=[];for(let p=0;p<3;p++)for(const d of [1,-1])arms.push({p,d});
const ek=e=>`f${e.foot}:c${e.circle}/${(e.D??e.A*180/Math.PI).toFixed(2)}(${e.sign>0?'+':'-'})`;
// grid over the victim box +-H on x,y and rot (t/R)
const lim=new Array(6).fill(0).map(()=>[]), sig=new Array(6).fill(0).map(()=>[]), tup=new Map();
const idx=(i,j,k)=>(i*N+j)*N+k;
for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let k=0;k<N;k++){
 const ps=F.piecesOf(seed);ps[0].x+=-H+2*H*i/(N-1);ps[0].y+=-H+2*H*j/(N-1);ps[0].rot+=(-H+2*H*k/(N-1))/R;
 const t=[];for(let a=0;a<6;a++){const L=F.limitAt(ps,0,arms[a].p,arms[a].d);const s=L.sig+'|'+(L.events||[]).map(ek).join(',');lim[a][idx(i,j,k)]=L.lim;sig[a][idx(i,j,k)]=s;t.push(s);}
 const key=t.join(' ; ');tup.set(key,(tup.get(key)||0)+1);
}
const tot=N*N*N;
console.log(`box +-${H}u, ${N}^3 poses. distinct 6-arm signature tuples: ${tup.size}`);
for(const [k,v] of [...tup].sort((a,b)=>b[1]-a[1]).slice(0,8))console.log(`  ${(100*v/tot).toFixed(1)}%  ${k}`);
// per arm: distinct signatures and their share
for(let a=0;a<6;a++){const m={};for(const s of sig[a])m[s]=(m[s]||0)+1;const ent=Object.entries(m).sort((x,y)=>y[1]-x[1]);console.log(`arm (${arms[a].p},${arms[a].d>0?'+':'-'}): ${ent.length} signatures: `+ent.map(([s,c])=>`${(100*c/tot).toFixed(1)}% ${s}`).join(' | '));}
// continuity: for neighbours with different signature on an arm, the limit jump
for(let a=0;a<6;a++){let maxJumpSame=0,maxJumpDiff=0,nDiff=0,jumps=[];
 const nb=(u,v)=>{const d=Math.abs(lim[a][u]-lim[a][v])/DEG;if(sig[a][u]===sig[a][v])maxJumpSame=Math.max(maxJumpSame,d);else{nDiff++;maxJumpDiff=Math.max(maxJumpDiff,d);jumps.push(d);}};
 for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let k=0;k<N;k++){if(i+1<N)nb(idx(i,j,k),idx(i+1,j,k));if(j+1<N)nb(idx(i,j,k),idx(i,j+1,k));if(k+1<N)nb(idx(i,j,k),idx(i,j,k+1));}
 jumps.sort((x,y)=>x-y);
 console.log(`arm (${arms[a].p},${arms[a].d>0?'+':'-'}): max limit jump between neighbours, same sig ${maxJumpSame.toFixed(2)} deg; across a wall ${maxJumpDiff.toFixed(2)} deg (n=${nDiff}, median ${nDiff?jumps[jumps.length>>1].toFixed(2):'-'})`);}
// fraction of the box within a slab of thickness 0.25u (per axis) of a signature change on any arm
let near=0;for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let k=0;k<N;k++){const u=idx(i,j,k);let hit=false;for(let a=0;a<6&&!hit;a++)for(const [di,dj,dk] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const ii=i+di,jj=j+dj,kk=k+dk;if(ii<0||jj<0||kk<0||ii>=N||jj>=N||kk>=N)continue;if(sig[a][idx(ii,jj,kk)]!==sig[a][u]){hit=true;break;}}if(hit)near++;}
console.log(`poses whose grid neighbour (step ${(2*H/(N-1)).toFixed(3)}u) has a different signature on some arm: ${(100*near/tot).toFixed(1)}%`);
