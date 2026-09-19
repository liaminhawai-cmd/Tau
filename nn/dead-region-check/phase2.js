const F=require('../forced-win.js'), C=require('../contact-law.js');
const R=C.R, DEG=Math.PI/180, SUB=DEG/3;
const seed6=[2.6627,33.2224,2.2687,4.2061,47.1181,4.4905];
const rows=[[3.621167321272143,47.101382410223884,4.459446497865713],
            [3.584301808338408,47.110878950025620,4.461094864381486],
            [3.536570349498783,47.123078361319970,4.463228044578368]];
const ek=e=>`f${e.foot}:c${e.circle}/${(e.D??e.A*180/Math.PI).toFixed(2)}(${e.sign>0?'+':'-'})`;
console.log('bins are 1/3 deg; listing each pose\'s events below 100 deg with their bin index');
for(const [x,y,rot] of rows){
  const ps=F.piecesOf(seed6); ps[1]={x,y,rot};
  const feet=C.feetOf(ps[1]), ev=F.limitEvents(feet,0,1).filter(e=>e.s<100*DEG);
  const a=F.limitAt(ps,1,0,1);
  console.log(`\n limit ${(a.lim/DEG).toFixed(4)} [${a.sig}]`);
  const bins={};for(const e of ev){const k=Math.floor(e.s/SUB)+1;(bins[k]=bins[k]||[]).push(e);}
  for(const e of ev)console.log(`   ${(e.s/DEG).toFixed(4)} deg bin ${Math.floor(e.s/SUB)+1}  ${ek(e)}`);
  const shared=Object.entries(bins).filter(([k,v])=>v.length>1);
  console.log('   events sharing a bin:', shared.length? shared.map(([k,v])=>`bin ${k}: ${v.map(ek).join(' + ')}`).join(' | ') : 'none');
  // closest pair of consecutive events
  let mn=Infinity,at=null;for(let i=1;i<ev.length;i++){const d=ev[i].s-ev[i-1].s;if(d<mn){mn=d;at=[ev[i-1],ev[i]];}}
  console.log(`   closest consecutive pair: ${(mn/DEG).toFixed(5)} deg apart (${ek(at[0])} , ${ek(at[1])}) -- bin width ${(SUB/DEG).toFixed(4)} deg`);
}
