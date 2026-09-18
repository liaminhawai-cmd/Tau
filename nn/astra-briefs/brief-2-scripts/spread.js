const F=require('../forced-win.js');const C=require('../contact-law.js');const R=C.R,DEG=Math.PI/180,{REPLICA,feetOf}=C;
const blue0={x:-24.31126879077936,y:-37.34799285619334,rot:1.3448263401595464}, red0={x:-11.7593,y:-23.2838,rot:2.9442};
for(const [hx,hy,hr] of [[0.1,0.1,0.5],[0.01,0.01,0.05]]){
 const recs=[];let thrown=0;
 for(let t=0;t<40;t++){const q={x:blue0.x-hx+2*hx*Math.random(),y:blue0.y-hy+2*hy*Math.random(),rot:blue0.rot+(-hr+2*hr*Math.random())*DEG};
  if(C.minGapOf(red0,q)<C.MIND){t--;continue;}
  const o=C.swing([q,red0],1,0,-1,46*DEG,{...REPLICA,record:true});if(o.off)thrown++;recs.push([q,...o.record.map(r=>({x:r.x,y:r.y,rot:r.rot}))]);}
 console.log(`box +-${hx}u, +-${hr} deg: ${thrown}/40 thrown`);
 for(const k of [0,5,10,15,20,25,30,40,50,60,70]){const ps=recs.map(r=>r[k]).filter(Boolean);if(ps.length<40)continue;const sp=f=>{const v=ps.map(f);return Math.max(...v)-Math.min(...v);};
  console.log(`  substep ${k} (${(k*0.4).toFixed(1)} deg): spread x ${sp(p=>p.x).toFixed(3)}u y ${sp(p=>p.y).toFixed(3)}u rot ${(sp(p=>p.rot)/DEG).toFixed(2)} deg; foot1 radius spread ${sp(p=>{const f=feetOf(p)[1];return Math.hypot(f.x,f.y);}).toFixed(3)}u`);}
}
