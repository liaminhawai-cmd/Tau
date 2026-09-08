const test = require('node:test');
const assert = require('node:assert/strict');
const {game} = require('./game-harness.cjs');

test('offline launch, keyboard move, pause and settings use the real game', async t=>{
  const g=await game();t.after(g.close);
  assert.ok(g.w.tauDesktop,'desktop script initialized');
  assert.deepEqual(g.errors,[]);
  assert.ok(g.w.document.documentElement.classList.contains('desktop-overhead'));
  g.$('desktopLocal').click();g.tick();
  assert.equal(g.read('G.active'),0);
  assert.equal(g.read('turnClockMode()'),false);
  g.key('1');g.key('2');
  assert.equal(g.read('G.pinned'),1,'can repick before swinging');
  g.key('ArrowRight');g.key('ArrowRight','keyup');
  assert.ok(g.read('Math.abs(G.netRad)')>Math.PI/90,'a tap exceeds the minimum legal move');
  const before=g.read('JSON.stringify(takeSnap())');
  g.key('Escape');g.tick();
  assert.equal(g.$('modalTitle').textContent,'Paused');
  assert.equal(g.w.tauDesktop.paused,true);
  g.tick(3200);
  assert.equal(g.read('JSON.stringify(takeSnap())'),before,'pause freezes the match');
  assert.equal(g.read('G.active'),0);
  g.key('Escape');g.tick();
  assert.equal(g.w.tauDesktop.paused,false);
  g.key('Enter');g.tick();
  assert.equal(g.read('G.active'),1,'Enter commits through the production turn handler');
  g.$('desktopPause').click();g.tick();
  [...g.$('modalBtns').children].find(b=>b.textContent==='Settings').click();g.tick();
  assert.equal(g.w.tauDesktop.paused,true);
  assert.equal(g.$('modalBox').getAttribute('role'),'dialog');
  g.$('desktopMotion').checked=true;g.$('desktopMotion').dispatchEvent(new g.w.Event('change'));
  assert.equal(JSON.parse(g.w.localStorage.getItem('tauDesktopSettingsV1')).reducedMotion,true);
  g.$('modalBtns').firstElementChild.click();g.tick();
  assert.equal(g.w.tauDesktop.paused,false);
  assert.deepEqual(g.errors,[]);
});

test('AI waits while paused and resumes after Continue',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLevel').value='1';g.$('desktopLevel').dispatchEvent(new g.w.Event('change'));
  g.$('desktopColour').value='1';g.$('desktopColour').dispatchEvent(new g.w.Event('change'));
  g.$('desktopPlay').click();
  g.$('desktopPause').click();g.tick();
  const before=g.read('JSON.stringify(takeSnap())');
  g.tick(1500);
  assert.equal(g.read('JSON.stringify(takeSnap())'),before);
  assert.equal(g.read('aiAnim'),null);
  g.$('modalBtns').firstElementChild.click();g.tick(2200);
  assert.notEqual(g.read('JSON.stringify(takeSnap())'),before);
  assert.deepEqual(g.errors,[]);
});

test('result offers same-mode rematch and returns to the desktop menu',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLocal').click();g.tick();
  // End-state fixture: result bookkeeping and rematch are the production handlers.
  g.read('G.over=true; G.winner=0; renderGameOverSheet()');g.tick();
  assert.equal(g.$('modalBtns').firstElementChild.textContent,'Rematch');
  g.$('modalBtns').firstElementChild.click();g.tick();
  assert.equal(g.read('G.over'),false);assert.equal(g.read('vsAI'),false);
  assert.equal(g.read('G.active'),0);assert.equal(g.read('turnClockMode()'),false);
  g.read('G.over=true; G.winner=1; renderGameOverSheet()');g.tick();
  [...g.$('modalBtns').children].find(b=>b.textContent==='Main menu').click();g.tick();
  assert.equal(g.$('menu').style.display,'flex');
  assert.equal(g.w.document.activeElement,g.$('desktopPlay'));
  assert.deepEqual(g.errors,[]);
});

test('the home menu reaches the showcase and the analysis lab',async t=>{
  const g=await game();t.after(g.close);
  // Showcase boards: navigates to the attract-mode page, keeping the wrapper flag.
  assert.equal(g.$('desktopShowcase').textContent,'Showcase boards');
  // The Lab button opens the #lab overlay in place — no URL bar needed in a packaged build.
  g.$('desktopLab').click();g.tick();
  assert.ok(g.$('labOverlay').classList.contains('open'),'lab overlay opened');
  assert.deepEqual(g.errors,[]);
});

test('a real match hands board sizing to the web split view, not a cut-down desktop layout',async t=>{
  const g=await game();t.after(g.close);
  // The old "Overhead view" corner-minimap toggle is gone -- the flat board is no longer hidden
  // behind a mode switch, it's just always there beside the 3D view (see native/README.md).
  assert.equal(g.$('desktopMap'),null,'the old overhead-toggle button is removed');
  assert.equal(Object.prototype.hasOwnProperty.call(
    JSON.parse(g.w.localStorage.getItem('tauDesktopSettingsV1')||'{}'), 'map'), false);
  g.$('desktopLocal').click();g.tick();
  // Simulate WebGL being available (this harness has no real GPU) and confirm window.tauDesktop's
  // resize hook backs OFF while a match is on screen, instead of doing its own board sizing --
  // that hand-off is what lets index.html's own resize()/#splitHandle math run, the same one the
  // browser build uses. Regression guard for the bug this fixed: the desktop CSS gap for #views
  // must never diverge from the split math's own gap budget (see presentation.css), or the two
  // boards silently wrap onto separate rows instead of sitting side by side.
  g.read("renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}}");
  assert.equal(g.read('tauDesktop.resize()'), false,
    'a real match must not be laid out by the desktop-only path');
  assert.deepEqual(g.errors,[]);
});

test('ordinary web entry keeps its original presentation',async t=>{
  const g=await game('');t.after(g.close);
  assert.equal(g.w.TAU_DESKTOP,false);
  assert.equal(g.w.tauDesktop,undefined);
  assert.equal(g.$('desktopPlay'),null);
  assert.deepEqual(g.errors,[]);
});

test('standard controller pins, swings, commits, cancels and opens the menu',async t=>{
  const g=await game();t.after(g.close);
  const pad={connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false})),
    vibrationActuator:{playEffect:()=>Promise.resolve()}};
  g.w.navigator.getGamepads=()=>[pad];
  const press=i=>{pad.buttons[i].pressed=true;g.tick();pad.buttons[i].pressed=false;g.tick();};
  g.$('desktopLocal').click();g.tick();
  // Left stick selects foot: rotate it to select foot 1 (lx=-1, ly=0 maps to foot 1)
  pad.axes[0]=-1;pad.axes[1]=0;g.tick(300);pad.axes[0]=0;
  press(0);assert.equal(g.read('G.pinned'),1);
  // Right stick swings: move it right to start swing and end turn
  pad.axes[2]=1;g.tick(300);pad.axes[2]=0;press(0);
  assert.equal(g.read('G.active'),1);
  const before=g.read('JSON.stringify(takeSnap())');
  // Select a foot and swing again
  press(0);pad.axes[2]=1;g.tick(300);pad.axes[2]=0;press(1);
  assert.equal(g.read('JSON.stringify(takeSnap())'),before);
  assert.equal(g.read('G.pinned'),null);
  press(9);assert.equal(g.w.tauDesktop.paused,true);
  press(0);assert.equal(g.w.tauDesktop.paused,false);
  assert.deepEqual(g.errors,[]);
});

test('online match menu leaves the server turn clock running',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLocal').click();g.tick();
  g.read('onlineMatch={}; onlineTurnDeadline=performance.now()+30000');
  const deadline=g.read('onlineTurnDeadline');
  g.$('desktopPause').click();g.tick(1600);
  assert.equal(g.w.tauDesktop.paused,false);
  assert.equal(g.$('modalTitle').textContent,'Match menu');
  assert.equal(g.read('onlineTurnDeadline'),deadline);
  g.read('onlineMatch=null');
  assert.deepEqual(g.errors,[]);
});

test('desktop materials use the production meshes and survive theme refresh',async t=>{
  const g=await game();t.after(g.close);
  // Real Three.js geometry/materials; only the GPU device is stubbed.
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    tauDesktop.applyMaterials();`);
  assert.equal(g.read('boardTop.material.map.image.width'),1536);
  assert.equal(g.read('tripods[0].userData.mat.metalness'),.72);
  assert.equal(g.read('camera.fov'),38);
  const mapId=g.read('boardTop.material.map.uuid');
  const count=g.read('scene.children.length');
  g.read('applyTheme()');
  assert.equal(g.read('boardTop.material.map.uuid'),mapId);
  assert.equal(g.read('scene.children.length'),count);
  assert.deepEqual(g.errors,[]);
});

test('a legal ring-out reaches the result and rematch through keyboard controls',async t=>{
  const g=await game();t.after(g.close);
  const endgame=require('./fixtures/ringout.json');
  g.$('desktopLocal').click();g.tick();
  g.read(`G.pieces.forEach((p,i)=>Object.assign(p,${JSON.stringify(endgame.pose)}[i]));
    G.active=${endgame.active};G.koHist=${JSON.stringify(endgame.koHist)};G.plies=${endgame.plies};render();`);
  g.key(String(endgame.plan.pivotIdx+1));
  const arrow=endgame.plan.dir>0?'ArrowRight':'ArrowLeft';
  for(let n=0;n<Math.ceil(endgame.plan.targetRad/(.72*.08));n++){
    g.key(arrow);g.key(arrow,'keyup');
  }
  g.key('Enter');g.tick(3600);
  assert.equal(g.read('G.over'),true);
  assert.equal(g.read('G.winner'),endgame.winner);
  assert.equal(g.$('modalBackdrop').style.display,'flex');
  assert.equal(g.$('modalBtns').firstElementChild.textContent,'Rematch');
  g.$('modalBtns').firstElementChild.click();g.tick();
  assert.equal(g.read('G.over'),false);
  assert.deepEqual(g.errors,[]);
});
