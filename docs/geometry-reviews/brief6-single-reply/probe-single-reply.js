'use strict';
// Diagnostic only: finite samples do not certify a continuous family.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
process.env.TAU_ROOT = process.env.TAU_ROOT || path.resolve(__dirname, '../../..');
const sourcePin = {
  rev: 'ce0e61d1e7482e3d1252aadadf97bd4269f71e29',
  indexHtmlSha256: '3cee71df1f26afd79cbbc83a5c208780e29e170cd7111fabaafb4ab75bc479c4',
  engineJsSha256: '106b90e0a6981c817c2789f88b175a546f9a7fc229af20f50218495533af443e'
};
for (const [file,key] of [['index.html','indexHtmlSha256'],['nn/engine.js','engineJsSha256']]) {
  const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(process.env.TAU_ROOT,file))).digest('hex');
  if(hash!==sourcePin[key])throw Error('Source hash mismatch: '+file);
}
const {eng} = require('../l13-l17-stop-audit/reply-band-maps/map-position');
const DEG = Math.PI/180;
const POSE = [-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442];
const arg = (s,d) => {const i=process.argv.indexOf(s);return i<0?d:process.argv[i+1];};
const step = Number(arg('--grid','0.125'));
const pattern = arg('--pattern','0.25').split(',').map(Number);
const replyCall = Number(arg('--reply-call','3'));
const label = arg('--label',pattern.join(','));
if (!(step>0) || !pattern.every(x=>x>0&&Number.isFinite(x)) || !(replyCall>0)) throw Error('bad step');
function load(snap,side) {
  eng.newGame(); const g=eng.getG();
  g.pieces.forEach((p,i)=>Object.assign(p,snap[i]));g.active=side;return g;
}
const initial = [0,1].map(i=>({x:POSE[i*3],y:POSE[i*3+1],rot:POSE[i*3+2]}));
function defender(pivot,dir,target) {
  const g=load(initial,0);eng.pinFoot(pivot);const commands=[];
  for(let k=0;k<4000&&!g.atLimit&&Math.abs(g.netRad)<target*DEG-1e-13;k++) {
    const d=Math.min(pattern[k%pattern.length]*DEG,target*DEG-Math.abs(g.netRad));
    eng.applySwing(dir*d);commands.push(d/DEG);
  }
  if(commands.length>=4000)throw Error('defender guard exhausted');
  return {snap:eng.takeSnap(),netDeg:Math.abs(g.netRad)/DEG,atLimit:g.atLimit,
    reason:g.limitReason,terminal:g.pieces[1].anyFootOff(),selfOff:g.pieces[0].anyFootOff(),commands};
}
function reply(snap) {
  const g=load(snap,1);eng.pinFoot(0);let calls=0;
  while(!g.atLimit&&Math.abs(g.netRad)<170*DEG&&calls++<1000)eng.applySwing(-replyCall*DEG);
  if(calls>=1000)throw Error('attacker guard exhausted');
  return {margin:eng.outermostRadU(g.pieces[0])-(eng.CFG.edgeU+eng.CFG.edgeEps),
    legal:Math.abs(g.netRad)>=eng.HARD_MIN_MOVE_RAD&&!g.pieces[1].anyFootOff(),
    netDeg:Math.abs(g.netRad)/DEG,atLimit:g.atLimit,reason:g.limitReason,snap:eng.takeSnap(),calls};
}
const result={scope:'sampled diagnostics only; defender patterns plus a final residual call; attacker (0,-) to its limit',
  sourcePin,label,node:process.version,pose:POSE,gridDeg:step,defenderPatternDeg:pattern,replyCallDeg:replyCall,arms:[]};
for(let pv=0;pv<3;pv++)for(const dir of [1,-1]){
  const limit=defender(pv,dir,170);
  const targets=[];for(let i=0;2+i*step<limit.netDeg;i++)targets.push(2+i*step);targets.push(limit.netDeg);
  const row={pivotIdx:pv,dir,limitDeg:limit.netDeg,tested:0,terminalEscapes:0,illegalDefender:0,failedReplies:[],worst:null};
  for(const target of targets){
    const d=defender(pv,dir,target);
    if(d.selfOff||d.netDeg*DEG<eng.HARD_MIN_MOVE_RAD){row.illegalDefender++;continue;}
    row.tested++;
    if(d.terminal){row.terminalEscapes++;row.failedReplies.push({target,defender:d,kind:'terminal-escape'});continue;}
    const r=reply(d.snap);
    const witness={targetDeg:target,defender:d,reply:r};
    if(!row.worst||r.margin<row.worst.reply.margin)row.worst=witness;
    if(!r.legal||r.margin<=0)row.failedReplies.push(witness);
  }
  result.arms.push(row);
  console.error(JSON.stringify({label,pv,dir,limit:row.limitDeg,tested:row.tested,worst:row.worst?.reply.margin,at:row.worst?.targetDeg,fail:row.failedReplies.length}));
}
fs.writeFileSync(arg('--out','single-reply-probe.json'),JSON.stringify(result,null,2)+'\n');
