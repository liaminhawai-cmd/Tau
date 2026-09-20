'use strict';
// Restore sources with fetch-sources.py first. No engine or checker patches.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const FW=require('./repo/nn/forced-win.js'),CL=require('./repo/nn/contact-law.js');
const seed=[-27.3934,-36.4088,1.2052,-11.7593,-23.2838,2.9442];
const game=FW.load(FW.piecesOf(seed),0);
CL.eng.pinFoot(0);
for(let k=0;k<8;k++)CL.eng.applySwing(Math.PI/180);
const after=game.pieces.flatMap(p=>[p.x,p.y,p.rot]);
const reference=[-24.31126879077936,-37.34799285619334,1.3448263401595464,-11.7593,-23.2838,2.9442];
const delta=Math.max(...after.map((x,i)=>Math.abs(x-reference[i])));
// Use the full-precision saved reference for the historical numbers, and record
// the independent current-engine replay. Roundoff from repeated rotations varies.
const outputs=[];
for(const [label,pose,rot] of [['seed-degrees',seed,.002],['post-reply-degrees',reference,.002],['post-reply-radians',reference,.002*180/Math.PI]]) {
 for(const arm of [0,2]) {
  const args=[path.join(__dirname,'repo/nn/throw-cert.js'),'1',String(arm),'-1','1','.0002','.0002',String(rot)];
  if(label==='post-reply-degrees')args.push('--engine','--validate','200');
  const run=cp.spawnSync(process.execPath,args,{env:{...process.env,POSE:pose.join(',')},encoding:'utf8',timeout:120000});
  const out={label,pose,arm,rotationHalfWidthDegrees:rot,exitCode:run.status,stdout:run.stdout,stderr:run.stderr,error:run.error?.message};
  outputs.push(out);console.log(label,'arm',arm,'exit',run.status,'\n'+run.stdout+run.stderr);
 }
}
fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify({seed,reply:{side:0,pivot:0,direction:1,degrees:8,schedule:'Eight one-degree applySwing calls'},currentEnginePostReply:after,referencePostReply:reference,maxCoordinateDifference:delta,scope:'Unmodified checker outputs and finite random diagnostics; not endorsed proof certificates.',outputs},null,2)+'\n');
