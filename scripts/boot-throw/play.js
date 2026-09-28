// Step 2: replay throws.json[PICK] in the real page (served at localhost:8765) with time frozen, stepping the
// game's own swing and fall code one frame at a time, and write JPEG frames to $OUT. Then encode, e.g.:
//   ffmpeg -framerate 30 -i rec/%04d.jpg -vf 'trim=end_frame=126,fade=in:0:8,fade=out:112:14,format=yuv420p' -c:v libx264 -crf 20 -movflags +faststart boot-throw.mp4
// The shipped clip: PICK=0 W=960 H=600 CAM='{"dist":275,"elev":0.36,"tx":26,"tz":-44,"side":1,"follow":0,"fov":36}'
// Replays one real, engine-found winning move in the page's own 3D scene, frame by frame, time frozen.
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const fs = require('fs');
const T = JSON.parse(fs.readFileSync('throws.json'))[+(process.env.PICK||0)];
const W=+(process.env.W||800), H=+(process.env.H||500), FR=30;
const OUT = process.env.OUT || 'rec';
const CAMOPT = JSON.parse(process.env.CAM||'{}');
(async()=>{
  const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  const ctx = await b.newContext({viewport:{width:1280,height:800}, serviceWorkers:'block'});
  const p = await ctx.newPage();
  await p.clock.install();
  await p.addInitScript(()=>{ let a=12345; window.__reseed=()=>{a=12345;}; Math.random=function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; });
  await p.goto('http://localhost:8765/index.html');
  await p.clock.runFor(4000);
  { const now = await p.evaluate(()=>Date.now()); await p.clock.pauseAt(now + 500); }
  const info = await p.evaluate(([T,W,H,CAMOPT])=>{
    demoStop(); if (typeof hideModal==='function') hideModal();
    const setup = () => {
      demoRestoreClone({ pieces: T.pre.pieces.map((q,i)=>({id:i,x:q.x,y:q.y,rot:q.rot})), active:T.pre.active, over:false, winner:null,
                         koHist:T.pre.koHist, plies:T.pre.plies, adjudicated:false });
      for (let i=0;i<2;i++){ tripods[i].visible=true; tripods[i].scale.set(1,1,1); }
    };
    // dry run: where does the loser leave the board?
    setup(); pinFoot(T.plan.pivotIdx);
    let g=0; while (!G.atLimit && Math.abs(G.netRad) < Math.abs(T.plan.targetRad) && g++<5000) applySwing(T.plan.dir*Math.min(AI_STEP_RAD, Math.abs(T.plan.targetRad)-Math.abs(G.netRad)));
    endTurn();
    const over=G.over, winner=G.winner, L=G.pieces[1-G.winner];
    for (let i=0;i<2;i++){ tripods[i].position.set(G.pieces[i].x,0,G.pieces[i].y); tripods[i].rotation.set(0,-G.pieces[i].rot,0); }
    const sx=L.x, sz=L.y;
    window.__reseed(); triggerFall(true);
    const path=[]; for (let i=0;i<80;i++){ if (fall.active) stepFall(1/30); const t=tripods[1-winner].position; path.push([t.x,t.y,t.z]); }
    const end=path[path.length-1];
    let fx=end[0]-sx, fz=end[2]-sz; if (CAMOPT.ang!=null){ fx=Math.cos(CAMOPT.ang); fz=Math.sin(CAMOPT.ang); }
    const Wn=G.pieces[G.winner];
    const start = { a:{x:T.pre.pieces[0].x,z:T.pre.pieces[0].y}, b:{x:T.pre.pieces[1].x,z:T.pre.pieces[1].y} };
    // camera: side-on to the throw, looking at the point between the action and the rim
    const d=Math.hypot(fx,fz)||1, ux=fx/d, uz=fz/d;
    const side = CAMOPT.side||1, px=-uz*side, pz=ux*side;
    // look between the board centre and where the loser leaves it
    const cx = CAMOPT.tx!=null ? CAMOPT.tx : (sx+end[0])/2*(CAMOPT.mix||0.5), cz = CAMOPT.tz!=null ? CAMOPT.tz : (sz+end[2])/2*(CAMOPT.mix||0.5);
    const dist=CAMOPT.dist||200, elev=CAMOPT.elev||0.55, back=CAMOPT.back||0;
    const cam=[cx + (px - ux*back)*dist*Math.cos(elev), dist*Math.sin(elev), cz + (pz - uz*back)*dist*Math.cos(elev), cx, -6, cz];
    window.__cam = cam; window.__look=[cx,-6,cz]; window.__follow=CAMOPT.follow==null?0.35:CAMOPT.follow; window.__fov=CAMOPT.fov||34;
    renderer.setPixelRatio(1); renderer.setSize(W,H,false); window.demoResize=()=>{};
    setup();
    return { over, winner, loser:1-winner, out:[ux,uz], cam, start:[sx,sz], end, path:path.filter((_,i)=>i%10==0).map(q=>q.map(v=>+v.toFixed(0))) };
  }, [T,W,H,CAMOPT]);
  console.log(JSON.stringify(info));
  const frame = async (fn) => {
    const url = await p.evaluate(([fnsrc,W,H])=>{
      (new Function(fnsrc))();
      for (let i=0;i<2;i++){ if (fall.active && i===fall.idx) continue; if (i===fallenIdx) continue;
        tripods[i].position.set(G.pieces[i].x,0,G.pieces[i].y); tripods[i].rotation.set(0,-G.pieces[i].rot,0); }
      const c=window.__cam, lk=window.__look;
      if (fall.active || fallenIdx>=0) { const t=tripods[fall.active?fall.idx:fallenIdx].position, f=window.__follow;
        lk[0]+= (c[3]*(1-f)+t.x*f - lk[0])*0.08; lk[1]+= (-6*(1-f)+t.y*f - lk[1])*0.08; lk[2]+= (c[5]*(1-f)+t.z*f - lk[2])*0.08; }
      camera.clearViewOffset && camera.clearViewOffset(); camera.fov=(window.__fov||34); camera.aspect=W/H;
      camera.position.set(c[0],c[1],c[2]); camera.lookAt(lk[0],lk[1],lk[2]); camera.updateProjectionMatrix();
      if (typeof pivotGlowMesh!=='undefined') pivotGlowMesh.visible=false;
      if (typeof hideCrossFlashes3D==='function') hideCrossFlashes3D();
      renderer.render(scene,camera);
      return renderer.domElement.toDataURL('image/jpeg',0.95);
    }, [fn,W,H]);
    return Buffer.from(url.split(',')[1],'base64');
  };
  let n=0; const save = buf => fs.writeFileSync(`${OUT}/${String(n++).padStart(4,'0')}.jpg`, buf);
  fs.mkdirSync(OUT,{recursive:true}); for (const f of fs.readdirSync(OUT)) fs.unlinkSync(`${OUT}/${f}`);
  // hold the start pose, then pin
  for (let i=0;i<14;i++) save(await frame(''));
  await p.evaluate(pv=>{ pinFoot(pv); }, T.plan.pivotIdx);
  for (let i=0;i<8;i++) save(await frame(''));
  const dur = Math.max(0.8, Math.abs(T.plan.targetRad)/1.9);
  const nf = Math.round(dur*FR);
  await p.evaluate(()=>{ window.__done=false; });
  for (let i=1;i<=nf;i++){
    const s=i/nf, e=s*s*(3-2*s);
    save(await frame(`if(!window.__done){ const want=${Math.abs(T.plan.targetRad)}*${e}; let g=0; while(!G.atLimit && Math.abs(G.netRad) < want-1e-9 && g++<5000) applySwing(${T.plan.dir}*Math.min(AI_STEP_RAD, want-Math.abs(G.netRad))); if (G.atLimit) window.__done=true; }`));
  }
  await p.evaluate(()=>{ endTurn(); for (let i=0;i<2;i++){ tripods[i].position.set(G.pieces[i].x,0,G.pieces[i].y); tripods[i].rotation.set(0,-G.pieces[i].rot,0); } window.__reseed(); triggerFall(true); });
  for (let i=0;i<FR*2.6;i++) save(await frame(`const dt=1/${FR}; if (fall.active) stepFall(dt); stepShards(dt); stepFloatDrift(dt); (window.__rp=window.__rp||[]).push([tripods[fall.idx].position.x|0,tripods[fall.idx].position.y|0,tripods[fall.idx].position.z|0]);`));
  console.log('frames', n, 'swing frames', nf); console.log('rp', JSON.stringify(await p.evaluate(()=>window.__rp.filter((_,i)=>i%10==0)))); console.log('real end', JSON.stringify(await p.evaluate(()=>{ const t=tripods[fall.idx].position; return [t.x,t.y,t.z, fall.active, fallenIdx, fall.idx]; })));
  await b.close();
})();
