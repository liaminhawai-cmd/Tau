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

test('a real match hands board sizing to the shared layout, not a cut-down desktop one',async t=>{
  const g=await game();t.after(g.close);
  // The old "Overhead view" corner-minimap toggle is gone -- the flat board is no longer hidden
  // behind a mode switch, it's just always there beside the 3D view (see native/README.md).
  assert.equal(g.$('desktopMap'),null,'the old overhead-toggle button is removed');
  assert.equal(Object.prototype.hasOwnProperty.call(
    JSON.parse(g.w.localStorage.getItem('tauDesktopSettingsV1')||'{}'), 'map'), false);
  g.$('desktopLocal').click();g.tick();
  // Simulate WebGL being available (this harness has no real GPU) and confirm window.tauDesktop's
  // resize hook backs OFF while a match is on screen, instead of doing its own board sizing. That
  // hand-off is what puts BOTH builds through the one sizing function in index.html: the browser
  // gets the side-by-side split, the desktop gets the corner layout, and neither has a second,
  // quietly diverging copy of the maths. The flat board is never hidden behind a mode switch.
  g.read("renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}}");
  assert.equal(g.read('tauDesktop.resize()'), false,
    'a real match must not be laid out by the desktop-only path');
  assert.equal(g.read('cornerLayoutActive()'), true, 'the desktop match uses the corner layout');
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
  // The right stick is a dial: sweep it through an arc and the piece follows the same arc.
  const sweep=(fromDeg,toDeg)=>{
    const step=toDeg>fromDeg?4:-4;
    for(let a=fromDeg;step>0?a<=toDeg:a>=toDeg;a+=step){
      pad.axes[2]=Math.cos(a*Math.PI/180); pad.axes[3]=Math.sin(a*Math.PI/180); g.tick();
    }
    pad.axes[2]=pad.axes[3]=0; g.tick();
  };
  g.$('desktopLocal').click();g.tick();
  // The D-pad chooses the foot in every scheme; the right stick swings in the default one.
  press(15);press(0);assert.equal(g.read('G.pinned'),1);
  sweep(0,40);press(0);
  assert.equal(g.read('G.active'),1);
  const before=g.read('JSON.stringify(takeSnap())');
  press(0);sweep(0,40);press(1);
  assert.equal(g.read('JSON.stringify(takeSnap())'),before);
  assert.equal(g.read('G.pinned'),null);
  press(9);assert.equal(g.w.tauDesktop.paused,true);
  press(0);assert.equal(g.w.tauDesktop.paused,false);
  assert.deepEqual(g.errors,[]);
});

test('the right stick is a dial: the piece turns through the same angle the stick does',async t=>{
  const g=await game();t.after(g.close);
  const pad={connected:true,mapping:'standard',axes:[0,0,0,0],
    buttons:Array.from({length:17},()=>({pressed:false,value:0})),
    vibrationActuator:{playEffect:()=>Promise.resolve()}};
  g.w.navigator.getGamepads=()=>[pad];
  const press=i=>{pad.buttons[i].pressed=true;g.tick();pad.buttons[i].pressed=false;g.tick();};
  const point=deg=>{pad.axes[2]=Math.cos(deg*Math.PI/180);pad.axes[3]=Math.sin(deg*Math.PI/180);g.tick();};
  g.$('desktopLocal').click();g.tick();
  press(15);press(0);assert.equal(g.read('G.pinned'),1);
  // Pushing the stick OUT to a direction must not move the piece: you have to reach some direction
  // before you can rotate from it, and that reach is not itself a rotation. Without this the piece
  // would jump by the bearing of wherever you happened to shove the stick first.
  point(0); point(0); point(0);
  assert.equal(g.read('G.netRad'),0,'reaching a direction takes the grip, it does not turn the piece');
  // Now rotate the stick 10° clockwise from there: the piece turns 10°, degree for degree. Kept
  // inside the turn's crossing allowance on purpose — past that the RULES cap the arc, so a larger
  // sweep would be measuring the rulebook rather than the input mapping. atLimit is asserted so
  // this test fails loudly if it ever drifts into that region instead of quietly measuring a cap.
  for(let a=0;a<=10;a+=5) point(a);
  const turned=g.read('G.netRad')*180/Math.PI;
  assert.equal(g.read('G.atLimit'),false,'the sweep stays inside the legal arc');
  assert.ok(Math.abs(turned-10)<0.5, `expected 10 degrees of turn, got ${turned.toFixed(2)}`);
  // Holding the stick still adds nothing further — a dial that is not being turned is not an input.
  for(let i=0;i<12;i++) g.tick();
  assert.ok(Math.abs(g.read('G.netRad')*180/Math.PI-turned)<0.01,'a stationary stick does not keep turning it');
  // Turning the stick back does NOT unwind the swing, and that is the rulebook, not the input:
  // applySwing allows one direction per turn (index.html), so the reverse delta is delivered and
  // then declined. Asserted rather than assumed, so a future change to that rule is noticed here.
  for(let a=10;a>=0;a-=5) point(a);
  assert.ok(Math.abs(g.read('G.netRad')*180/Math.PI-turned)<0.01,
    'one direction per turn: reversing the dial does not unwind the swing');
  // Letting go and re-gripping elsewhere does not teleport it by the angle travelled while centred.
  pad.axes[2]=pad.axes[3]=0;g.tick();
  point(180);point(180);
  assert.ok(Math.abs(g.read('G.netRad')*180/Math.PI-turned)<0.01,'re-gripping starts a fresh delta');
  // A fresh turn is free to go the other way: the same dial, rotated anticlockwise, turns the piece
  // anticlockwise. This is what proves the sign mapping works in both directions.
  g.read('restoreSnap();G.pinned=null;G.pivot=null;G.handle=null;G.ptrAngle=null');
  pad.axes[2]=pad.axes[3]=0;g.tick();
  press(15);press(0);
  point(0);point(0);
  for(let a=0;a>=-10;a-=5) point(a);
  const anti=g.read('G.netRad')*180/Math.PI;
  assert.ok(Math.abs(anti+10)<0.5, `anticlockwise should turn it -10 degrees, got ${anti.toFixed(2)}`);
  assert.deepEqual(g.errors,[]);
});

test('the trigger scheme swings by how far the trigger is pulled, and the left stick never does',async t=>{
  const g=await game();t.after(g.close);
  // Analog triggers: buttons carry a 0..1 value, which IS the swing speed.
  const trig=(i,v)=>{pad.buttons[i].value=v;pad.buttons[i].pressed=v>.5;};
  const pad={connected:true,mapping:'standard',axes:[0,0,0,0],
    buttons:Array.from({length:17},()=>({pressed:false,value:0})),
    vibrationActuator:{playEffect:()=>Promise.resolve()}};
  g.w.navigator.getGamepads=()=>[pad];
  const press=i=>{pad.buttons[i].pressed=true;g.tick();pad.buttons[i].pressed=false;g.tick();};
  g.$('desktopLocal').click();g.tick();
  g.w.tauDesktop.padScheme='triggers';
  assert.equal(g.w.tauDesktop.padScheme,'triggers');
  press(15);press(0);assert.equal(g.read('G.pinned'),1,'D-pad still picks the foot here');
  // A feather pull moves the piece — the old .16 stick dead zone would have swallowed it entirely.
  trig(7,.10);g.tick(300);trig(7,0);
  const light=Math.abs(g.read('G.netRad'));
  assert.ok(light>0,'a light pull still turns the piece');
  g.read('restoreSnap();G.pinned=null;G.pivot=null;G.handle=null;G.ptrAngle=null');
  press(15);press(0);
  trig(7,1);g.tick(300);trig(7,0);
  assert.ok(Math.abs(g.read('G.netRad'))>light*2,'pulling harder turns it faster');
  // In this scheme the left stick is inert: it must not swing the piece.
  g.read('restoreSnap();G.pinned=null;G.pivot=null;G.handle=null;G.ptrAngle=null');
  press(15);press(0);
  pad.axes[0]=1;g.tick(300);pad.axes[0]=0;
  assert.equal(g.read('G.netRad'),0,'the left stick does not swing in the trigger scheme');
  assert.deepEqual(g.errors,[]);
});

test('choosing a board finish repaints the flat board and the 3D one from the same entry',async t=>{
  const g=await game();t.after(g.close);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    tauDesktop.applyMaterials();`);
  const ids=g.w.tauDesktop.boards.map(b=>b.id);
  assert.ok(ids.includes('walnut') && ids.length>1,'more than one finish is offered');
  const other=ids.find(id=>id!=='walnut');
  const before={ flat:g.read('activeSkin().flat'), bg:g.read("'#'+scene.background.getHexString()") };
  g.w.tauDesktop.board=other;
  // One choice drives BOTH views: the flat board's palette and the 3D scene move together, so the
  // two boards can never end up showing different materials for the same game.
  assert.notEqual(g.read('activeSkin().flat'),before.flat,'the flat board repainted');
  assert.notEqual(g.read("'#'+scene.background.getHexString()"),before.bg,'the 3D scene repainted');
  assert.equal(g.read('activeSkin().flat'),
    g.w.tauDesktop.boards.length && g.w.tauDesktop.skin.flat,'both read the same finish entry');
  assert.equal(JSON.parse(g.w.localStorage.getItem('tauDesktopSettingsV1')).board,other,'the choice persists');
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
