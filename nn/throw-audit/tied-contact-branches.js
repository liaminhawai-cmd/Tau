// Does MY analyse() keep both tied branches at Astra's counterexample, or prune one away?
'use strict';
const TC = require('../throw-cert.js');
const CL = require('../contact-law.js');
const DEG = Math.PI/180;
const att = { x: -12.831776146126225, y: -26.997105145410310, rot: 2.7766483918085445 };
const vic = { x: -23.828114646314690, y: -38.136424156513700, rot: 1.3281868071241907 };
for (const [hx, hr] of [[1e-7, 1e-7], [1e-5, 1e-5*DEG], [1e-3, 1e-3*DEG], [0.005, 0.02*DEG], [0.02, 0.1*DEG]]) {
  const box = { x: [vic.x-hx, vic.x+hx], y: [vic.y-hx, vic.y+hx], rot: [vic.rot-hr, vic.rot+hr] };
  const an = TC.analyse(box, att, null);
  if (an.refuse) { console.log(`box +-${hx}u: REFUSED -- ${an.refuse}`); continue; }
  if (an.free) { console.log(`box +-${hx}u: free`); continue; }
  const keys = an.segPairs.map(s => (s.vertex ? `V:${s.a},${s.b}` : `${s.a},${s.b}`));
  console.log(`box +-${hx}u  pad ${an.pad.toFixed(5)}  pair (${an.pair})  entries [${keys.join(' ')}]  cone ${(( an.psiN[1]-an.psiN[0])/DEG).toFixed(3)}deg  hf [${an.hf.map(v=>v.toFixed(3))}]  rn [${an.rn.map(v=>v.toFixed(2))}]`);
  const has34 = an.segPairs.some(s => s.a===3 && s.b===4 && !s.vertex), has24 = an.segPairs.some(s => s.a===2 && s.b===4 && !s.vertex);
  console.log(`         both tied branches kept? A3/V4 ${has34 ? 'yes' : 'NO'}   A2/V4 ${has24 ? 'yes' : 'NO'}`);
}
