// Independent re-derivation of Astra's three algebra claims about throw-theorem.md
const R=23.095, I=0.7*R*R;
function upd(r,n,s){const rn=r[0]*n[1]-r[1]*n[0];const lam=s/(1+rn*rn/I);const e=lam*rn/I;
 const rr=[Math.cos(e)*r[0]-Math.sin(e)*r[1],Math.sin(e)*r[0]+Math.cos(e)*r[1]];
 const dp=[lam*n[0]+rr[0]-r[0],lam*n[1]+rr[1]-r[1]];return {rn,lam,e,eta:s-(dp[0]*n[0]+dp[1]*n[1])};}
// Claim A: Lemma 1's eta >= 0 is false
console.log('A: eta at Astra example', upd([-R/Math.SQRT2,R/Math.SQRT2],[1,0],0.8).eta);
// worst eta over random updates, both signs
let mn=1,mx=-1;for(let k=0;k<500000;k++){const a=Math.random()*2*Math.PI,rr=Math.random()*R,b=Math.random()*2*Math.PI,s=Math.random()*0.8;
 const {eta}=upd([rr*Math.cos(a),rr*Math.sin(a)],[Math.cos(b),Math.sin(b)],s);mn=Math.min(mn,eta);mx=Math.max(mx,eta);}
console.log('   eta range over 5e5 random updates', mn, mx);
// Claim B: Lemma 3 error can exceed 1e-4 at s=0.32
{const s=0.32,rn=Math.sqrt(I),lam=s/(1+rn*rn/I),e=lam*rn/I,r0=64;
 const exact=Math.hypot(r0+lam+R*(Math.cos(e)-1),R*Math.sin(e))-r0;console.log('B: linear',lam,'exact',exact,'err',exact-lam);}
// Claim C: per-substep attacker point displacement bound. Ours: 2R*delta=0.3225 (points within 2R of P). Astra: sqrt(3)R*2sin(0.2deg)=0.2793 (leg axis points within sqrt3 R of pivot horizontally)
console.log('C: ours 2R*0.4deg=',2*R*0.4*Math.PI/180,' Astra 2*sqrt3*R*sin(0.2deg)=',2*Math.sqrt(3)*R*Math.sin(0.2*Math.PI/180));
// Claim D: l5807vazg perturbations put foot 1 off board at the start
const p=[37.6039,-3.2612,1.8896,50.4287,10.5092,-.859];
function feet(x,y,rot){return [0,1,2].map(i=>[x+R*Math.cos(rot+i*2*Math.PI/3),y+R*Math.sin(rot+i*2*Math.PI/3)]);}
for(const [lab,dx,dt] of [['seed',0,0],['x+1.25',1.25,0],['rot-1.5u',0,-1.5/R]]){const f=feet(p[3]+dx,p[4],p[5]+dt);console.log('D:',lab,f.map(q=>Math.hypot(q[0],q[1]).toFixed(4)).join(' '));}
