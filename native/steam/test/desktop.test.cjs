const test = require('node:test');
const assert = require('node:assert/strict');
const {game, root} = require('./game-harness.cjs');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.equal(g.$('modalTitle').textContent,'Match menu');
  assert.equal(g.w.tauDesktop.menuOpen,true);
  g.tick(3200);
  assert.equal(g.read('JSON.stringify(takeSnap())'),before,'your own turn waits for you under the menu');
  assert.equal(g.read('G.active'),0);
  g.key('Escape');g.tick();
  assert.equal(g.w.tauDesktop.menuOpen,false);
  g.key('Enter');g.tick();
  assert.equal(g.read('G.active'),1,'Enter commits through the production turn handler');
  g.$('desktopPause').click();g.tick();
  [...g.$('modalBtns').children].find(b=>b.textContent==='Settings').click();g.tick();
  assert.equal(g.w.tauDesktop.menuOpen,true);
  assert.equal(g.$('modalBox').getAttribute('role'),'dialog');
  g.$('desktopMotion').checked=true;g.$('desktopMotion').dispatchEvent(new g.w.Event('change'));
  assert.equal(JSON.parse(g.w.localStorage.getItem('tauDesktopSettingsV1')).reducedMotion,true);
  g.$('modalBtns').firstElementChild.click();g.tick();
  assert.equal(g.w.tauDesktop.menuOpen,false);
  assert.deepEqual(g.errors,[]);
});

test('the opponent keeps playing under the match menu, and the board stays visible',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLevel').value='1';g.$('desktopLevel').dispatchEvent(new g.w.Event('change'));
  g.$('desktopColour').value='1';g.$('desktopColour').dispatchEvent(new g.w.Event('change'));
  g.$('desktopPlay').click();
  g.$('desktopPause').click();g.tick();
  assert.equal(g.$('modalTitle').textContent,'Match menu');
  assert.match(g.$('modalBody').textContent,/continues while this menu is open/);
  // The menu does not stop the clock: the AI takes its turn while you are in Settings.
  const before=g.read('JSON.stringify(takeSnap())');
  g.tick(2600);
  assert.notEqual(g.read('JSON.stringify(takeSnap())'),before,'the AI moved while the menu was open');
  assert.equal(g.read('tauDesktop.paused'),false);
  // ...but the open dialog still blocks the board: keys and the pad reach the menu, not the pieces.
  assert.equal(g.read('inputBlocked()'),true);
  g.$('modalBtns').firstElementChild.click();g.tick();
  assert.equal(!!g.read('inputBlocked()'),g.read('vsAI && G.active===aiIdx'),'closing the menu hands the board back on your turn');
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

test('dragged out, the flat board takes over and the 3D view becomes the inset',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLocal').click();g.tick();
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio:()=>{},getPixelRatio:()=>1,
    setSize(){},shadowMap:{}};
    camera=new THREE.PerspectiveCamera(38,1.6,1,2000); camera.position.set(0,145,148); camera.lookAt(0,4,0);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0)};`);
  const px = s => Number(String(s).replace('px','')) || 0;
  const at = v => { g.read(`setViewSplit(${v},true); resize();`);
    return { flat: px(g.read('canvas.style.width')),
             v3:   px(g.read("document.getElementById('view3d').style.width")),
             inset: g.read("document.getElementById('views').classList.contains('view3dInset')") }; };
  const win = g.read('innerWidth');
  const small = at(0), big = at(1);
  // Dialled down, the flat board is a corner glance over a 3D view that still owns the window.
  assert.ok(small.flat < win*0.25, `dialled down the flat board is small, got ${small.flat}`);
  assert.equal(small.v3, win, 'and the 3D view still fills the window');
  assert.equal(small.inset, false, 'nothing is inset at that end');
  // Dragged out, the roles swap: the flat board is the board you play on and the 3D view retreats
  // to the opposite corner. Growing the flat board while the 3D view stayed full-window would just
  // bury the pieces underneath it — the whole point of "the 2D board can dominate" is that the
  // other view gets OUT OF THE WAY, so the 3D tile shrinking is the assertion that matters here.
  assert.ok(big.flat > small.flat*3, `dragged out the flat board dominates, got ${big.flat}`);
  assert.ok(big.v3 < win*0.5, `and the 3D view has pulled back to an inset, got ${big.v3}`);
  // (No assertion on the divider here: with the camera fitting the dish to its tile, the tile may
  // legitimately start inside the board's square BOX while clearing its round DISC, and the divider
  // is only drawn once the two share no column at all -- see resize().)
  // The handover is continuous: no step in either tile as the drag crosses the swap point.
  let prevFlat = 0, prevV3 = win + 1;
  for (let v=0; v<=1.0001; v+=0.05) {
    const s = at(Math.min(1,v));
    assert.ok(s.flat >= prevFlat, `flat board never shrinks as the drag grows it (at ${v.toFixed(2)})`);
    assert.ok(s.v3 <= prevV3, `3D view never grows back as the drag grows the board (at ${v.toFixed(2)})`);
    prevFlat = s.flat; prevV3 = s.v3;
  }
  assert.deepEqual(g.errors,[]);
});

test('the saved-games list draws its icons instead of printing their source',async t=>{
  const g=await game('');t.after(g.close);
  // A saved replay is just an entry in localStorage, so the list can be stood up without playing
  // a game out. The payload only has to be a string — nothing here decodes it.
  g.read(`storeSavedReplays([{t:'Local 1v1', d:Date.now(), p:'x'}]); openWatchScreen();`);
  const icons=[...g.w.document.querySelectorAll('#wsSaved .wsIcon')];
  assert.ok(icons.length>=3,`the row offers its actions, got ${icons.length}`);
  // The row's icons are a mix of plain glyphs and one inline SVG. Every one of them used to go in
  // through textContent, so the SVG was rendered as its own source code down the side of the row.
  for(const b of icons){
    assert.ok(!b.textContent.includes('<svg'),`an icon printed its markup: ${b.textContent.slice(0,40)}`);
    assert.ok(!b.textContent.includes('<path'),'an icon printed a path');
    assert.ok(b.querySelector('svg') || b.textContent.trim(),'every icon shows something');
  }
  assert.equal(icons.filter(b=>b.querySelector('svg')).length,1,'the drawn icon is a real SVG element');
  assert.deepEqual(g.errors,[]);
});

test('the saved-games list draws its icons instead of printing their source',async t=>{
  const g=await game('');t.after(g.close);
  // A saved replay is just an entry in localStorage, so the list can be stood up without playing
  // a game out. The payload only has to be a string — nothing here decodes it.
  g.read(`storeSavedReplays([{t:'Local 1v1', d:Date.now(), p:'x'}]); openWatchScreen();`);
  const icons=[...g.w.document.querySelectorAll('#wsSaved .wsIcon')];
  assert.ok(icons.length>=3,`the row offers its actions, got ${icons.length}`);
  // The row's icons are a mix of plain glyphs and one inline SVG. Every one of them used to go in
  // through textContent, so the SVG was rendered as its own source code down the side of the row.
  for(const b of icons){
    assert.ok(!b.textContent.includes('<svg'),`an icon printed its markup: ${b.textContent.slice(0,40)}`);
    assert.ok(!b.textContent.includes('<path'),'an icon printed a path');
    assert.ok(b.querySelector('svg') || b.textContent.trim(),'every icon shows something');
  }
  assert.equal(icons.filter(b=>b.querySelector('svg')).length,1,'the drawn icon is a real SVG element');
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
  const pad={connected:true,mapping:'standard',axes:[0,0,0,0],
    buttons:Array.from({length:17},()=>({pressed:false,value:0})),
    vibrationActuator:{playEffect:()=>Promise.resolve()}};
  g.w.navigator.getGamepads=()=>[pad];
  const press=i=>{pad.buttons[i].pressed=true;g.tick();pad.buttons[i].pressed=false;g.tick();};
  // Triggers are the default scheme: hold RT to swing, let go to stop.
  const pull=(i,v,ms)=>{pad.buttons[i].value=v;pad.buttons[i].pressed=v>.5;g.tick(ms);
    pad.buttons[i].value=0;pad.buttons[i].pressed=false;g.tick();};
  g.$('desktopLocal').click();g.tick();
  // The D-pad chooses the foot in every scheme.
  press(15);press(0);assert.equal(g.read('G.pinned'),1);
  pull(7,1,300);press(0);
  assert.equal(g.read('G.active'),1);
  const before=g.read('JSON.stringify(takeSnap())');
  press(0);pull(7,1,300);press(1);
  assert.equal(g.read('JSON.stringify(takeSnap())'),before);
  assert.equal(g.read('G.pinned'),null);
  press(9);assert.equal(g.w.tauDesktop.menuOpen,true);
  press(0);assert.equal(g.w.tauDesktop.menuOpen,false);
  assert.deepEqual(g.errors,[]);
});

test('the stick scheme turns at a speed set by how far the right stick is pushed',async t=>{
  const g=await game();t.after(g.close);
  const pad={connected:true,mapping:'standard',axes:[0,0,0,0],
    buttons:Array.from({length:17},()=>({pressed:false,value:0})),
    vibrationActuator:{playEffect:()=>Promise.resolve()}};
  g.w.navigator.getGamepads=()=>[pad];
  const press=i=>{pad.buttons[i].pressed=true;g.tick();pad.buttons[i].pressed=false;g.tick();};
  const hold=(x,ms)=>{pad.axes[2]=x;g.tick(ms);pad.axes[2]=0;g.tick();};
  g.w.tauDesktop.padScheme='stick';
  g.$('desktopLocal').click();g.tick();
  press(15);press(0);assert.equal(g.read('G.pinned'),1);
  // Half deflection for a fixed time, then the same time at full: further pushed turns further. The
  // window is kept short so the whole comparison stays inside the turn's crossing allowance —
  // past that the RULES cap the arc and we would be measuring the rulebook, not the input.
  hold(.5,200);
  const half=Math.abs(g.read('G.netRad'));
  assert.equal(g.read('G.atLimit'),false,'the sample stays inside the legal arc');
  assert.ok(half>0,'a pushed stick turns the piece');
  g.read('restoreSnap();G.pinned=null;G.pivot=null;G.handle=null;G.ptrAngle=null');
  g.tick();press(15);press(0);
  hold(1,200);
  const full=Math.abs(g.read('G.netRad'));
  assert.ok(full>half*1.6, `full deflection should turn much further than half (half ${half.toFixed(3)}, full ${full.toFixed(3)})`);
  // A centred stick is not an input: nothing keeps turning once it is let go.
  const settled=g.read('G.netRad');
  for(let i=0;i<12;i++) g.tick();
  assert.equal(g.read('G.netRad'),settled,'a centred stick does not keep turning it');
  // The other direction turns the other way — the sign mapping works both ways.
  g.read('restoreSnap();G.pinned=null;G.pivot=null;G.handle=null;G.ptrAngle=null');
  g.tick();press(15);press(0);
  hold(-1,200);
  assert.ok(g.read('G.netRad')<0,'pushing the stick the other way turns the piece the other way');
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

test('the 3D view steps aside by exactly what the flat board needs, and not before',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLocal').click();g.tick();
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio:()=>{},getPixelRatio:()=>1,
    setSize(){},shadowMap:{}};
    camera=new THREE.PerspectiveCamera(38,1.6,1,2000); camera.position.set(0,145,148); camera.lookAt(0,4,0);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0)};`);
  const px = s => Number(String(s).replace('px','')) || 0;
  const at = v => { g.read(`setViewSplit(${v},true); resize();`);
    return { flat: px(g.read('canvas.style.width')),
             left: px(g.read("document.getElementById('view3d').style.left")) }; };
  // A dial in the corner sits under the dish's empty lower-left corner. It must not push the 3D
  // view around: an offset here would be the old threshold logic moving things for no reason.
  const dial = at(0);
  assert.equal(dial.left, 0, `a corner dial leaves the 3D view alone, got left=${dial.left}`);
  // The offset is a continuous function of size -- it can only grow as the board does -- and by
  // the time the board is large it has gone positive. No step at any threshold.
  let prev = 0, moved = false;
  for (let v = 0; v <= 1.0001; v += 0.05) {
    const s = at(Math.min(1, v));
    assert.ok(s.left >= prev, `the 3D view never comes back toward the board as it grows (at ${v.toFixed(2)})`);
    if (s.left > 0) moved = true;
    prev = s.left;
  }
  assert.ok(moved, 'a big board does move the 3D view aside');
  // "Where possible": the tile never shrinks below the floor to satisfy clearance -- past that the
  // overlap is accepted rather than the dish becoming smaller than the board it is showing.
  const W = g.read('innerWidth');
  assert.ok(W - at(1).left >= Math.max(240, Math.round(W*0.30)) - 1, 'the 3D tile keeps its minimum width');
  assert.deepEqual(g.errors,[]);
});

test('on a window taller than it is wide, the 3D view steps up rather than sideways',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLocal').click();g.tick();
  // The harness fixes a landscape window; turn it portrait before laying out.
  g.w.innerWidth=900; g.w.innerHeight=1200;
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio:()=>{},getPixelRatio:()=>1,
    setSize(){},shadowMap:{}};
    camera=new THREE.PerspectiveCamera(38,0.75,1,2000); camera.position.set(0,145,148); camera.lookAt(0,4,0);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0)};`);
  const px = s => Number(String(s).replace('px','')) || 0;
  const at = v => { g.read(`setViewSplit(${v},true); resize();`);
    const el = g.$('view3d'), vw = g.$('views').classList;
    return { left: px(el.style.left), h3: px(el.style.height), w3: px(el.style.width),
             above: vw.contains('view3dAbove'), side: vw.contains('view3dInset') }; };
  // A dial still costs the view almost nothing. (Not "nothing": on a portrait window the dish is
  // large relative to the width and its lower-left can graze even a small board, so the honest
  // assertion is a bound, not zero.)
  const dial = at(0);
  assert.equal(dial.left, 0, 'a dial never pushes the view sideways');
  assert.ok(dial.h3 >= 1200*0.95, `a corner dial leaves the 3D view nearly full-size, got ${dial.h3}`);
  // Grown, the view gives up HEIGHT (it stands above the board), keeps the full width, and never
  // slides sideways -- on a portrait window a side-by-side split would starve the dish of width.
  const big = at(0.7);
  assert.equal(big.left, 0, 'no sideways offset on a portrait window');
  assert.equal(big.w3, 900, 'the 3D view keeps the full width');
  assert.ok(big.h3 < 1200, `and gives up height instead, got ${big.h3}`);
  // Only the edge that actually divides them is drawn.
  assert.equal(big.side, false, 'no left-hand divider when stacked');
  // The vertical offset is monotonic in board size, as the horizontal one is when side by side.
  let prevUp = 0;
  for (let v=0; v<=1.0001; v+=0.1) { const up = 1200 - at(Math.min(1,v)).h3;
    assert.ok(up >= prevUp, `the view never grows back down as the board grows (at ${v.toFixed(1)})`); prevUp = up; }
  assert.deepEqual(g.errors,[]);
});

test('the corner board is resizable by a knob on its rim and by scrolling over it',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLocal').click();g.tick();
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio:()=>{},getPixelRatio:()=>1,
    setSize(){},shadowMap:{}};
    camera=new THREE.PerspectiveCamera(); controls={mouseButtons:{},target:new THREE.Vector3()};
    setViewSplit(0.5,true); resize();`);
  // The grip has to LOOK like a control here. In the side-by-side split a hairline is enough
  // because the seam between two tiles is itself the affordance; a board floating on a backdrop
  // has no seam, and the 3px version of this was reported as simply not being there.
  assert.equal(g.$('splitHandle').classList.contains('corner'),true,'the corner knob is on');
  assert.ok(parseInt(g.$('splitHandle').style.width) >= 24,'and is a real target, not a hairline');
  const flat = () => Number(String(canvasWidth()).replace('px','')) || 0;
  const canvasWidth = () => g.read('canvas.style.width');
  const wheel = dy => { g.$('canvas').dispatchEvent(Object.assign(
    new g.w.Event('wheel',{bubbles:true,cancelable:true}), {deltaY:dy})); };
  const mid = flat();
  for(let i=0;i<4;i++) wheel(-120);
  const bigger = flat();
  assert.ok(bigger > mid, `scrolling up grows the board (${mid} -> ${bigger})`);
  for(let i=0;i<8;i++) wheel(120);
  assert.ok(flat() < bigger, `scrolling down shrinks it (${bigger} -> ${flat()})`);
  assert.deepEqual(g.errors,[]);
});

test('the controls sheet lists the live bindings and the pad can resize the board',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLocal').click();g.tick();
  // F1 from anywhere. Rendered as real markup, not printed as literal tags: showModal writes a
  // plain-text body with textContent unless told otherwise, so this is the guard for that argument.
  g.key('F1');g.tick();
  assert.equal(g.$('modalTitle').textContent,'Controls');
  const rows=[...g.$('modalBody').querySelectorAll('.desktop-controls-row')];
  assert.ok(rows.length>12, `the sheet lists the bindings, got ${rows.length} rows`);
  assert.equal(g.$('modalBody').textContent.includes('<kbd>'),false,'rendered, not printed as markup');
  const say=()=>rows.map(r=>r.textContent).join(' | ');
  // It reads the live scheme rather than a second hard-coded copy, so it cannot contradict the pad.
  assert.ok(/LT \/ RT/.test(say()),'the trigger scheme is described by default');
  g.$('modalBtns').firstElementChild.click();g.tick();
  g.w.tauDesktop.padScheme='stick';
  g.key('F1');g.tick();
  const after=[...g.$('modalBody').querySelectorAll('.desktop-controls-row')].map(r=>r.textContent).join(' | ');
  assert.ok(/Right stick/.test(after),'switching scheme changes what the sheet says');
  g.$('modalBtns').firstElementChild.click();g.tick();
  // The bumpers resize the flat board, held to repeat. The GPU device is stubbed only from here:
  // with a renderer present the harness's animation loop wants a whole scene, and this section
  // drives the input poll directly instead, which is the part under test.
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio:()=>{},getPixelRatio:()=>1,
    setSize(){},shadowMap:{}};
    camera=new THREE.PerspectiveCamera(); controls={mouseButtons:{},target:new THREE.Vector3()};
    setViewSplit(0.5,true); resize();`);
  const pad={connected:true,mapping:'standard',axes:[0,0,0,0],
    buttons:Array.from({length:17},()=>({pressed:false,value:0})),
    vibrationActuator:{playEffect:()=>Promise.resolve()}};
  g.w.navigator.getGamepads=()=>[pad];
  const width=()=>Number(String(g.read('canvas.style.width')).replace('px',''))||0;
  const start=width();
  pad.buttons[5].pressed=true; for(let i=0;i<10;i++) g.w.tauDesktop.tick(0.1); pad.buttons[5].pressed=false;
  const grown=width();
  assert.ok(grown>start, `RB grows the board (${start} -> ${grown})`);
  pad.buttons[4].pressed=true; for(let i=0;i<20;i++) g.w.tauDesktop.tick(0.1); pad.buttons[4].pressed=false;
  assert.ok(width()<grown, `LB shrinks it (${grown} -> ${width()})`);
  assert.deepEqual(g.errors,[]);
});

test('every board in the catalogue paints the flat board, the 3D board and the pieces',async t=>{
  const g=await game();t.after(g.close);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    tauDesktop.applyMaterials();`);
  const ids=g.w.tauDesktop.boards.map(b=>b.id);
  // The catalogue is the WHOLE set, not a desktop-only sub-set: the browser build's original skins
  // and the looks that used to be locked in the showcase are all here, selectable in a real match.
  for(const id of ['dark','slate','dojo','yellow','walnut','ebony','maple',
                   'noir','math','sumo','cosy','alien','colossus','marble'])
    assert.ok(ids.includes(id), `${id} is offered in-game`);
  const seen=new Set();
  for(const id of ids){
    g.w.tauDesktop.board=id;
    const look={
      flat:g.read('activeSkin().flat'),
      bg:g.read("'#'+scene.background.getHexString()"),
      piece:g.read("'#'+tripods[0].userData.mat.color.getHexString()"),
    };
    for(const [what,v] of Object.entries(look))
      assert.ok(/^#[0-9a-f]{6}$/.test(v), `${id} sets a real ${what} colour, got ${v}`);
    // Each entry is a distinct look, so a board cannot silently fall back to another's palette.
    const key=JSON.stringify(look);
    assert.ok(!seen.has(key), `${id} is a look of its own, not a duplicate`);
    seen.add(key);
  }
  // Exotic materials must not leak into the next board: glass and thin film are switched ON by the
  // finishes that ask for them and back OFF by the ones that do not, or leaving Noir would hand the
  // next set see-through legs.
  g.w.tauDesktop.board='noir';
  assert.ok(g.read('tripods[0].userData.mat.transmission')>0,'Noir pieces are glass');
  g.w.tauDesktop.board='alien';
  assert.equal(g.read('tripods[0].userData.mat.transmission'),0,'leaving Noir clears the glass');
  // (The showcase's thin-film iridescence needs a newer THREE than the game embeds -- r128 has no
  // such term -- so what Alien keeps here is its internal glow. The board's membrane is the shader.)
  assert.ok(g.read('tripods[0].userData.mat.emissiveIntensity')>0,'Alien pieces keep their glow');
  g.w.tauDesktop.board='walnut';
  assert.equal(g.read('tripods[0].userData.mat.emissiveIntensity'),0,'leaving Alien clears the glow');
  assert.deepEqual(g.errors,[]);
});

test('the showcase looks bring their own bakes and per-part piece materials into the game',async t=>{
  const g=await game();t.after(g.close);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    tauDesktop.applyMaterials();`);
  const bodyMat = () => g.read('tripods[0].children[0].material');
  const original = g.read('tripods[0].userData.mat');
  // Marble: a coloured glass ball on all-but-invisible refracting legs. That is two materials on
  // one piece, which the game's single fused mesh cannot express -- so a hub sphere is added over
  // the apex and carries the ball's material while the body carries the legs'.
  g.w.tauDesktop.board='marble';
  const hub = g.read('tripods[0].userData.hub');
  assert.ok(hub && hub.visible, 'a hub ball is present and shown');
  assert.notEqual(hub.material, bodyMat(), 'the ball and the legs are different materials');
  // Both are glass, and the legs are the clearer of the two -- on either THREE (the game's r128
  // has no refraction pass, so the shared module keeps a little body in its glass there).
  assert.equal(hub.material.transmission, 0, 'the ball is solid colour');
  assert.ok(bodyMat().transmission > 0.5, 'the legs are glass');
  assert.ok(Math.abs(hub.scale.x - g.read('CFG.legRadius')*2.0) < 1e-6, 'the ball is a small one, not a bauble');
  // The ball is the coloured one, the legs stay clear: measured as saturation of the base colour,
  // which is where the tint lives on the game's THREE (no volume attenuation in r128).
  const sat = c => { const m=Math.max(c.r,c.g,c.b), n=Math.min(c.r,c.g,c.b); return m ? (m-n)/m : 0; };
  assert.ok(sat(hub.material.color) > sat(bodyMat().color) + 0.3, 'the ball is the coloured one, the legs stay clear');
  assert.ok(g.read('boardTop.material.roughnessMap') && g.read('boardTop.material.map'), 'the board took the bake (albedo + roughness)');
  const srgb = g.read('THREE.SRGBColorSpace !== undefined ? boardTop.material.map.colorSpace === THREE.SRGBColorSpace : boardTop.material.map.encoding === THREE.sRGBEncoding');
  const dataLinear = g.read('THREE.SRGBColorSpace !== undefined ? boardTop.material.roughnessMap.colorSpace !== THREE.SRGBColorSpace : boardTop.material.roughnessMap.encoding !== THREE.sRGBEncoding');
  assert.ok(srgb && dataLinear, 'albedo is sRGB, data maps are not');
  // Noir's glass comes from the showcase's own materials now, not an approximation of them.
  g.w.tauDesktop.board='noir';
  assert.ok(bodyMat().transmission > 0.5, 'noir legs are the showcase glass');   // capped for body on r128
  assert.ok(g.read('tripods[0].userData.hub').visible, 'noir has a distinct hub bead too');
  // Alien keeps its membrane: the board material carries the detail shader with the alien mode on.
  g.w.tauDesktop.board='alien';
  assert.equal(g.read('tauDesktop.debugDetailMode()'), 3, 'alien selects the membrane shader mode');
  // Wood finishes get the per-pixel grain (mode 1); the web skins stay plain (0).
  g.w.tauDesktop.board='walnut';
  assert.equal(g.read('tauDesktop.debugDetailMode()'), 1, 'walnut gets the wood detail pass');
  assert.equal(bodyMat(), original, 'leaving a showcase look restores the original single material');
  assert.equal(g.read('tripods[0].userData.hub').visible, false, 'and hides the hub ball');
  assert.equal(bodyMat().transmission, 0, 'with no glass left behind');
  g.w.tauDesktop.board='dark';
  assert.equal(g.read('tauDesktop.debugDetailMode()'), 0, 'the plain web skin has no detail pass');
  assert.deepEqual(g.errors,[]);
});

test('the camera stick looks where it is pushed, and Y can be inverted',async t=>{
  const g=await game();t.after(g.close);
  const pad={connected:true,mapping:'standard',axes:[0,0,0,0],
    buttons:Array.from({length:17},()=>({pressed:false,value:0})),
    vibrationActuator:{playEffect:()=>Promise.resolve()}};
  g.w.navigator.getGamepads=()=>[pad];
  g.$('desktopLocal').click();g.tick();
  // Stand a camera up where a match holds it, with the GPU device stubbed (no GL here), then drive
  // the pad poll directly: this is about where the stick sends the camera, not about the draw call.
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0)};`);
  const start=()=>g.read('camera.position.set(0,145,148)');
  const poll=(axis,v)=>{pad.axes=[0,0,0,0];pad.axes[axis]=v;g.w.tauDesktop.tick(0.3);pad.axes=[0,0,0,0];};
  const camX=()=>g.read('camera.position.x'), camY=()=>g.read('camera.position.y');
  // A stick is a LOOK control: pushing right turns the view right, which carries the camera round
  // to its own right (+X here) and swings the board leftward across the screen. The mouse is the
  // opposite gesture — there you have hold of the board — so the two are not expected to agree.
  start(); const x0=camX();
  poll(0,1);
  assert.ok(camX()>x0,`push right should orbit the camera right (was ${x0.toFixed(1)}, now ${camX().toFixed(1)})`);
  // Pushing down tips the view down onto the board, so the camera climbs.
  start(); const y0=camY();
  poll(1,1);
  assert.ok(camY()>y0,`push down should raise the camera (was ${y0.toFixed(1)}, now ${camY().toFixed(1)})`);
  // Inverting Y flips only that axis — the setting exists because this is the one people disagree on.
  g.w.tauDesktop.invertCamY=true;
  start();
  poll(1,1);
  assert.ok(camY()<y0,'inverted, push down lowers the camera instead');
  assert.equal(JSON.parse(g.w.localStorage.getItem('tauDesktopSettingsV1')).invertCamY,true,'the choice persists');
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
  delete g.w.TAU_TEST_BAKE_SIZE;   // this test checks the production texture resolution
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

test('ALLBOARDS opens every finish, survives restart and restores earned locks without changing progress',async t=>{
  const earned=JSON.stringify({played:3,wins:1,topLevel:1});
  const g=await game(undefined,{tauDesktopProgress:earned});t.after(g.close);
  const type=word=>{for(const key of word)g.key(key);};
  const D=g.w.tauDesktop;
  assert.ok(D.boards.some(b=>!b.unlocked));
  // Typing in a menu field or with a shortcut modifier must never activate the cheat.
  g.$('desktopLevel').focus();type('ALLBOARDS');
  assert.ok(D.boards.some(b=>!b.unlocked));
  g.$('desktopPlay').focus();
  for(const key of 'ALLBOARDS')g.$('desktopPlay').dispatchEvent(new g.w.KeyboardEvent('keydown',{key,bubbles:true,ctrlKey:true}));
  assert.ok(D.boards.some(b=>!b.unlocked));
  type('ALL');g.tick(2100);type('BOARDS');
  assert.ok(D.boards.some(b=>!b.unlocked),'the code has a time limit between keys');
  type('allboards');
  assert.ok(D.boards.every(b=>b.unlocked));
  assert.match(g.$('desktopUnlockToast').textContent,/unlocked for testing/);
  g.$('desktopSettings').click();
  const sel=g.$('desktopBoard');
  assert.ok([...sel.options].every(o=>!o.disabled),'all finishes can actually be selected');
  sel.value='alien';sel.dispatchEvent(new g.w.Event('change'));
  assert.equal(D.board,'alien');
  assert.equal(g.w.localStorage.getItem('tauDesktopProgress'),earned);
  const storage=Object.fromEntries(Object.keys(g.w.localStorage).map(k=>[k,g.w.localStorage.getItem(k)]));
  const restored=await game(undefined,storage);t.after(restored.close);
  assert.equal(restored.w.tauDesktop.board,'alien','the testing choice survives a relaunch');
  assert.ok(restored.w.tauDesktop.boards.every(b=>b.unlocked));
  for(const key of 'ALLBOARDS')restored.key(key);
  const boards=restored.w.tauDesktop.boards;
  assert.ok(boards.find(b=>b.id==='dojo').unlocked && boards.find(b=>b.id==='slate').unlocked,'earned boards stay open');
  assert.ok(!boards.find(b=>b.id==='alien').unlocked);
  assert.equal(restored.w.tauDesktop.board,'walnut','a testing-only selection returns to an available board');
  assert.equal(restored.w.localStorage.getItem('tauDesktopProgress'),earned);
  assert.equal(restored.w.localStorage.getItem('tauDesktopTestBoards'),null);
  assert.deepEqual([...g.errors,...restored.errors],[]);
});

test('replay keeps both boards clear, aligns its chrome, and preserves live resizing',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLocal').click();g.tick();
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},getPixelRatio:()=>1,setSize(){},shadowMap:{}};
    camera=new THREE.PerspectiveCamera(38,1.6,1,2000);camera.position.set(0,145,148);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0)};
    setViewSplit(0.85,true);
    replayFrames=[takeSnap().flatMap(p=>[p.x,p.y,p.rot])];
    replayFrames.push(replayFrames[0].map((v,i)=>i===2?v+0.1:v));
    startReplay();`);
  const saved=g.w.localStorage.getItem('tauViewSplit');
  for(const [W,H] of [[2048,1094],[1280,800],[900,1200],[720,540]]){
    g.w.innerWidth=W;g.w.innerHeight=H;
    // DOM measurement models a wrapped replay toolbar in the narrow window.
    Object.defineProperty(g.$('replayBtns'),'offsetHeight',{configurable:true,value:W<800?88:44});
    g.read('resize();tauDesktop.updateCamera(10);camera.lookAt(controls.target);camera.updateMatrixWorld(true);');
    const px=v=>parseFloat(v)||0, flat=px(g.$('canvas').style.width), bottom=px(g.$('canvas').style.bottom);
    const cv=g.$('view3d'),left=px(cv.style.left),width=px(cv.style.width),height=px(cv.style.height);
    assert.ok(flat<=Math.min(W,H)*0.34,'replay keeps the overhead view small');
    assert.ok(bottom>=g.$('replayBtns').offsetHeight+50,'the overhead view clears the replay controls');
    assert.equal(left+width,W,'3D fills the available room to the right edge');
    assert.ok(g.$('splitHandle').classList.contains('auto'),'watching hides the resize grip');
    assert.ok(g.w.document.documentElement.classList.contains('desktop-watching'));
    assert.equal(px(g.w.document.documentElement.style.getPropertyValue('--desktop-view-center')),left+width/2);
    const points=g.read(`(()=>{const p=new THREE.Vector3(),out=[];
      for(let x=-CFG.edgeU;x<=CFG.edgeU;x+=4)for(let y=-CFG.edgeU;y<=CFG.edgeU;y+=4){
        if(x*x+y*y>CFG.edgeU*CFG.edgeU)continue;
        p.set(x,0,y).project(camera);out.push([p.x,p.y]);
      }return out;})()`);
    const cx=26+flat/2,cy=H-bottom-flat/2;
    for(const [x,y] of points){
      const sx=left+(x+1)*width/2,sy=(1-y)*height/2;
      assert.ok(sx>=0 && sx<=W && sy>=0 && sy<=H,`3D board stays in frame at ${W}×${H}`);
      assert.ok(Math.hypot(sx-cx,sy-cy)>flat/2,`the overhead board cannot cover the 3D surface at ${W}×${H}`);
    }
    g.$('canvas').dispatchEvent(new g.w.WheelEvent('wheel',{deltaY:-120,bubbles:true,cancelable:true}));
    assert.equal(g.w.localStorage.getItem('tauViewSplit'),saved,'watching does not overwrite the player’s size');
  }
  g.read('endReplay();');
  assert.ok(!g.w.document.documentElement.classList.contains('desktop-watching'));
  assert.equal(g.read('viewSplit'),0.85);
  assert.ok(!g.$('splitHandle').classList.contains('auto'),'the resize grip returns after replay');
  g.$('canvas').dispatchEvent(new g.w.WheelEvent('wheel',{deltaY:-120,bubbles:true,cancelable:true}));
  assert.ok(g.read('viewSplit')>0.85,'live wheel resizing still works');
  assert.deepEqual(g.errors,[]);
});

test('the wood texture has continuous grain across the former radial joins',async t=>{
  const g=await game();t.after(g.close);
  delete g.w.TAU_TEST_BAKE_SIZE;
  const getContext=g.w.HTMLCanvasElement.prototype.getContext;
  g.w.HTMLCanvasElement.prototype.getContext=function(type){
    const ctx=getContext.call(this,type);
    if(type==='2d')ctx.putImageData=data=>{this.bakedPixels=data.data;};
    return ctx;
  };
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];tauDesktop.applyMaterials();`);
  const cv=g.read('boardTop.material.map.image'),data=cv.bakedPixels,S=cv.width;
  const edge=g.read('CFG.edgeU'),r=g.read('(CFG.rings[0]+CFG.rings[1])/2'),sc=S/(2*edge);
  // Cross the old 12-stave cuts away from the actual circular rule boundaries and lens arcs.
  for(const ang of [Math.PI/6,Math.PI/2,5*Math.PI/6,7*Math.PI/6,3*Math.PI/2,11*Math.PI/6]){
    let previous;
    for(let offset=-5;offset<=5;offset++){
      const x=Math.round(S/2+Math.cos(ang)*r*sc-Math.sin(ang)*offset);
      const y=Math.round(S/2+Math.sin(ang)*r*sc+Math.cos(ang)*offset);
      const red=data[(y*S+x)*4];
      if(previous!==undefined)assert.ok(Math.abs(red-previous)<16,'no dark glue groove or abrupt timber change');
      previous=red;
    }
  }
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

test('boards unlock with play: a nice wood to start, the deluxe looks behind the ladder',async t=>{
  const g=await game();t.after(g.close);
  const D=g.w.tauDesktop;
  assert.equal(D.board,'walnut','you start on Walnut');
  const by=id=>D.boards.find(b=>b.id===id);
  assert.ok(by('walnut').unlocked && !by('dojo').unlocked && !by('marble').unlocked && !by('alien').unlocked,'the rest waits');
  assert.match(by('dojo').unlock,/win 1 game/); assert.match(by('marble').unlock,/100 games/); assert.match(by('alien').unlock,/top ladder/);
  // One win against the AI opens Dojo; the first result also counts as a game played.
  D.recordResult({humanWon:true,vsAI:true,online:false,lab:false,level:0});
  assert.ok(by('dojo').unlocked,'a win opens Dojo'); assert.equal(D.progress.played,1); assert.equal(D.progress.wins,1);
  // The lab never counts; pass-and-play counts as played but not won; a high rung opens its look.
  D.recordResult({humanWon:true,vsAI:true,online:false,lab:true,level:10});
  assert.equal(D.progress.played,1,'the lab is not a game');
  D.recordResult({humanWon:true,vsAI:false,online:false,lab:false,level:null});
  assert.equal(D.progress.wins,1,'same-screen play is nobody\'s win'); assert.equal(D.progress.played,2);
  D.recordResult({humanWon:true,vsAI:true,online:false,lab:false,level:8});
  assert.ok(by('noir').unlocked && !by('math').unlocked,'beating rung 9 opens Noir, not the rung-10 look');
  assert.equal(g.read("JSON.parse(localStorage.getItem('tauDesktopProgress')).topLevel"),9,'progress persists');
  // Settings lists a locked board disabled, with what opens it, and refuses to select it.
  D.openSettings ? D.openSettings() : g.w.document.getElementById('desktopSettings').click();
  const sel=g.w.document.getElementById('desktopBoard');
  const opt=id=>[...sel.options].find(o=>o.value===id);
  assert.ok(opt('walnut') && !opt('walnut').disabled,'Walnut is selectable');
  assert.ok(opt('marble').disabled && /100 games/.test(opt('marble').textContent),'Marble is listed but locked');
  sel.value='marble'; sel.onchange({target:sel});
  assert.equal(D.board,'walnut','a locked pick is refused'); assert.equal(sel.value,'walnut');
});

test('the flat board and the 3D bake shade the same zones of one timber',async t=>{
  const g=await game();t.after(g.close);
  const D=g.w.tauDesktop;
  // Every board but the three flat exceptions grades its four zone values on the flat board too,
  // so the 2D minimap and the 3D disc always agree about which band a foot is on.
  for(const id of ['walnut','ebony','maple','dark','slate','dojo','noir','sumo','cosy','colossus','marble']){
    D.board=id; const sk=g.read('activeSkin()');
    assert.ok(sk.shadeByZoneValue && sk.v1 && sk.v2 && sk.v3 && sk.v4, `${id} shades by zone on the flat board`);
    assert.notEqual(sk.v4, sk.v1, `${id}'s centre and outer lens differ`);
  }
  for(const id of ['yellow','math','alien']){ D.board=id; assert.ok(!g.read('activeSkin().shadeByZoneValue'), `${id} stays flat`); }
  // The woods name a shade per zone; the flat board uses those same colours.
  D.board='walnut';
  const sk=g.read('activeSkin()');
  // presentation.js keeps the catalogue private; read the colours back through the flat skin,
  // which is what both views draw from.
  assert.equal(sk.v4,'#704e32'); assert.equal(sk.v1,'#483020');
  // ...and they step in value only, centre lightest to outer lens darkest: the zones are the message.
  const lum=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)).reduce((a,b)=>a+b);
  assert.ok(lum(sk.v4)>lum(sk.v3) && lum(sk.v3)>lum(sk.v2) && lum(sk.v2)>lum(sk.v1), 'a monotone ramp of one timber');
  // The flat piece is drawn at the real tube's width, not a stick.
  const legW=g.read('Math.max(2, 2*CFG.legRadius*scale)'), stick=g.read('Math.max(2, CFG.padRadius*scale*1.35)');
  assert.ok(legW>stick*2.5, `flat legs are tube-width (${legW.toFixed(1)}px vs the old ${stick.toFixed(1)}px)`);
});

test('the board shader links: every uniform the detail, Math and leg passes read is declared',async t=>{
  // GLSL only compiles on a GPU, which these tests do not have. What broke once was simpler than
  // that: a pass read a uniform another edit had removed. So build the real fragment and vertex
  // sources the way three does (the physical shader with every #include resolved), run our
  // onBeforeCompile hooks over them, and check that each u-prefixed identifier the source uses is
  // declared as a uniform and has a value in the uniforms table.
  const g=await game();t.after(g.close);
  const report=JSON.parse(g.read(`(()=>{
    const SH=makeShowcaseBoards(THREE,CFG,{size:64});
    const resolve=src=>src.replace(/#include <([\\w_]+)>/g,(m,k)=>THREE.ShaderChunk[k]?resolve(THREE.ShaderChunk[k]):m);
    const check=(material)=>{
      const lib=THREE.ShaderLib.physical;
      const shader={uniforms:{},vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader};
      material.onBeforeCompile(shader);
      const out=[];
      for(const src of [shader.vertexShader,shader.fragmentShader]){
        const full=resolve(src);
        const declared=new Set([...full.matchAll(/uniform\\s+\\w+\\s+(\\w+)/g)].map(m=>m[1]));
        const used=new Set([...full.replace(/\\/\\/.*$/gm,'').matchAll(/\\b(u[A-Z]\\w*)\\b/g)].map(m=>m[1]));
        for(const u of used){ if(!declared.has(u)) out.push('undeclared '+u); else if(!(u in shader.uniforms)) out.push('no value for '+u); }
      }
      return out;
    };
    const board=new THREE.MeshStandardMaterial(); SH.installDetailShader(board);
    const leg=new THREE.MeshPhysicalMaterial({transmission:1}); SH.installLegGradient(leg,0x3b74e8);
    return JSON.stringify({board:check(board), leg:check(leg)});
  })()`));
  assert.deepEqual(report.board,[],'board surface shader');
  assert.deepEqual(report.leg,[],'glass leg shader');
});

test('the home menu never scrolls: the corner layout\'s offsets stay in the match',async t=>{
  const g=await game();t.after(g.close);
  // #menu is the game's own scroller on the web (overflow-y:auto under a 97vh cap); pinned to the
  // window as the desktop home it must clip instead, or a 3D view sized to the window overflows
  // its 97% and draws scrollbars.
  const css=fs.readFileSync(path.join(root,'desktop/presentation.css'),'utf8');
  const menuRule=css.match(/\.tau-desktop #menu \{[^}]*\}/)[0];
  assert.match(menuRule,/overflow:hidden/); assert.match(menuRule,/max-height:none/);
  g.$('desktopLocal').click();g.tick();
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio:()=>{},getPixelRatio:()=>1,setSize(){},shadowMap:{}};
    camera=new THREE.PerspectiveCamera(38,1.6,1,2000); camera.position.set(0,145,148); camera.lookAt(0,4,0);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0)};
    setViewSplit(1,true); resize();`);
  assert.notEqual(g.read("document.getElementById('view3d').style.left"),'','dragged out, the corner layout positions the 3D tile inline');
  g.read('G.over=true; G.winner=1; renderGameOverSheet()');
  // The stub renderer has no scene to draw, so frames run without it and it is back for the
  // menu's own layout pass, which is what clears the offsets.
  g.read('window.__stub=renderer; renderer=null');g.tick();g.read('renderer=window.__stub');
  [...g.$('modalBtns').children].find(b=>b.textContent==='Main menu').click();
  assert.equal(g.$('menu').style.display,'flex');
  for (const side of ['left','top','right','bottom'])
    assert.equal(g.read(`document.getElementById('view3d').style.${side}`),'',`back on the home screen the 3D view carries no ${side} offset`);
  assert.deepEqual(g.errors,[]);
});

test('the ambient demo simulates its next endgame behind a flag the render loop honours',async t=>{
  const g=await game();t.after(g.close);
  // The silent simulation drives G through a whole game between yields; the meshes must not
  // follow it (that was the "sped-up game" on arrival), so animate() checks the flag before the sync.
  assert.match(g.read('animate.toString()'),/if \(demoSimulating > 0\)/);
  // The menu demo started on load and is mid-simulation; stopping it lets that run wind down.
  g.read('demoStop()');
  for(let i=0;i<500 && g.read('demoSimulating')>0;i++){ g.tick(); await new Promise(r=>setImmediate(r)); }
  assert.equal(g.read('demoSimulating'),0,'a stopped demo\'s simulation lets go of the gate');
  assert.equal(g.read('window.__sim=demoSimulateEndgame(demoGen); demoSimulating'),1,'up the moment a simulation starts');
  g.read('window.__sim.then(r=>{window.__simResult=r;})');
  for(let i=0;i<2000 && g.read('window.__simResult')===undefined;i++){ g.tick(); await new Promise(r=>setImmediate(r)); }
  assert.ok(g.read('window.__simResult && window.__simResult.queue.length>0'),'the simulation reached a recorded finish');
  assert.equal(g.read('demoSimulating'),0,'and the gate is open again before the tail is restored');
  assert.deepEqual(g.errors,[]);
});

test('the walkthrough draws the match\'s own tripod: tube-width legs in the skin\'s colours',async t=>{
  const g=await game();t.after(g.close);
  assert.ok(g.read('TUTOR_SPEED')<=0.3,'the whole-game preview plays at a pace that can be followed');
  // Record what the walkthrough's flat board asks its context to draw.
  g.read(`(()=>{ const orig=HTMLCanvasElement.prototype.getContext; const rec=window.__rec={widths:new Set(),strokes:new Set()};
    HTMLCanvasElement.prototype.getContext=function(type){ const c=orig.call(this,type); if(!c||this.id!=='htpBigCanvas')return c;
      return this.__rec||(this.__rec=new Proxy(c,{set(o,k,v){ if(k==='lineWidth')rec.widths.add(v); if(k==='strokeStyle')rec.strokes.add(v); o[k]=v; return true; }, get:(o,k)=>o[k]})); }; })()`);
  g.$('desktopLearn').click();g.tick();
  assert.ok(g.$('htpFull'),'the walkthrough is open');
  g.$('htpNext').click();g.tick(80);   // the first rule slide: a live piece on the flat board
  const cv="document.getElementById('htpBigCanvas')";
  const legW=g.read(`Math.max(2, 2*CFG.legRadius*htpMap(${cv}.width, ${cv}.height).sc)`);
  assert.ok(g.read(`[...window.__rec.widths].some(w=>Math.abs(w-${legW})<1e-9)`),'legs are the tube\'s diameter through the slide\'s own scale, as Piece.prototype.draw draws them');
  assert.ok(g.read('window.__rec.strokes.has(pieceHex(0))'),'in the board skin\'s blue, not a stock colour');
  assert.deepEqual(g.errors,[]);
});

test('the corner and two-feet slides show a guide, and following it meets the goal',async t=>{
  const g=await game();t.after(g.close);
  for (const key of ['double','twofeet']) {
    const guide=g.read(`htpState('${key}').guide`);
    assert.ok(guide && guide.pivot>=0 && Math.abs(guide.dir)===1 && guide.angle>0, `${key}: a foot to hold and a way to swing`);
    // Do exactly what the guide shows: hold that foot, swing that way, that far.
    const done=g.read(`(()=>{ const st=htpState('${key}'); st.pinned=${guide.pivot}; st.dragging=true;
      const step=1.5*Math.PI/180; for (let a=0; a<${guide.angle}+1e-9; a+=step) htpTrySwing(st,'${key}',${guide.dir}*step);
      return st.done; })()`);
    assert.equal(done,true,`${key}: the guide leads to the goal`);
    // and the rails are drawn from the held foot, one per free foot
    const rails=g.read(`(()=>{ const st=htpState('${key}'); return htpGuideRails(st, st.guide); })()`);
    assert.equal(rails.rails.length,2);
  }
  assert.deepEqual(g.errors,[]);
});

test('after the walkthrough the 3D view is laid out for the desktop home again',async t=>{
  const g=await game();t.after(g.close);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},getPixelRatio:()=>1,setSize(){},shadowMap:{},
      domElement:document.getElementById('view3d')};
    scene=new THREE.Scene(); camera=new THREE.PerspectiveCamera(38,1.6,1,2000);
    controls={mouseButtons:{},touches:{},target:new THREE.Vector3(),addEventListener(){},enabled:true};
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)]; htpTripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];`);
  g.$('desktopLearn').click();
  assert.ok(g.$('htpFull'),'the walkthrough is open');
  assert.equal(g.read("document.getElementById('view3d').parentElement.id"),'htp3DPane','and owns the 3D view');
  g.$('htpDoneBtn').style.display=''; g.$('htpDoneBtn').disabled=false; g.$('htpDoneBtn').click();
  assert.equal(g.$('htpFull'),null,'Done closes it');
  assert.equal(g.read("document.getElementById('view3d').parentElement.id"),'demoViews','the 3D view is back behind the menu');
  const want=Math.round(g.read('innerWidth')*.76)+'px';
  assert.equal(g.read("document.getElementById('view3d').style.width"),want,'sized by the desktop home layout, not the phone menu tile');
  assert.deepEqual(g.errors,[]);
});

test('the home panel scales to a short window instead of scrolling',async t=>{
  const g=await game();t.after(g.close);
  const home=g.w.document.querySelector('.desktop-home');
  Object.defineProperty(home,'offsetHeight',{get:()=>780});   // JSDOM does no layout: a plausible natural height
  const css=fs.readFileSync(path.join(root,'desktop/presentation.css'),'utf8');
  assert.doesNotMatch(css.match(/\.desktop-home \{[^}]*\}/g).join(' '),/overflow-y:auto|max-height/,'the panel has no scroll box');
  g.w.innerHeight=500; g.read('tauDesktop.resize()');
  assert.equal(home.style.transform,'translateY(-50%) scale(0.5000)','short window: scaled to fit above the account line');
  g.w.innerHeight=1000; g.read('tauDesktop.resize()');
  assert.equal(home.style.transform,'translateY(-50%) scale(1.0000)','tall window: natural size');
  assert.deepEqual(g.errors,[]);
});

test('glass pieces carry a proxy that draws only in the transmission pass',async t=>{
  const g=await game();t.after(g.close);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    localStorage.setItem('tauDesktopTestBoards','1');`);
  g.read("tauDesktop.board='marble'");
  const p="tripods[0].userData.glassProxy";
  assert.equal(g.read(`${p} && ${p}.visible`),true,'marble legs are glass: a proxy rides along');
  assert.equal(g.read(`${p}.material.colorWrite`),false,'on screen it writes nothing');
  assert.equal(g.read(`${p}.castShadow`),false);
  g.read(`${p}.onBeforeRender({getRenderTarget:()=>({})})`);
  assert.equal(g.read(`${p}.material.colorWrite && ${p}.material.depthWrite`),true,'into the transmission buffer it writes');
  g.read(`${p}.onBeforeRender({getRenderTarget:()=>null})`);
  assert.equal(g.read(`${p}.material.colorWrite`),false,'and stops again for the screen');
  assert.equal(g.read(`${p}.material.userData.legTint`),g.read('tripods[0].userData.mat.userData.legTint'),'wearing the leg\'s own colour ramp');
  g.read("tauDesktop.board='walnut'");
  assert.equal(g.read(`${p}.visible`),false,'a solid piece hides it');
  assert.deepEqual(g.errors,[]);
});

test('Colossus brings its stands, crowd and haze into the match, and a fall raises dust',async t=>{
  const g=await game();t.after(g.close);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    localStorage.setItem('tauDesktopTestBoards','1');`);
  g.read("tauDesktop.board='colossus'");
  const crowd=()=>g.read("(()=>{let c=null; scene.traverse(o=>{ if(o.isInstancedMesh) c=o; }); return c && {count:c.count, y:c.position.y};})()");
  assert.ok(crowd() && crowd().count>=2000,'a crowd of little tripods fills the tiers');
  assert.equal(g.read('!!scene.fog'),true,'haze grades with distance');
  assert.equal(g.read('camera.fov'),46,'a lower, wider lens takes in the stands');
  assert.equal(g.read('tauDesktop.fallTimeScale()'),0.5,'giants go over slowly');
  const puffs=()=>g.read("scene.children.filter(o=>o.isPoints && o.userData.dust).length");
  g.read("fall={active:true,phase:'slide',idx:1,vx:50,vz:0,px:0,pz:0}; tripods[1].position.set(55,0,0);");
  g.read('tauDesktop.tick(0.2); tauDesktop.tick(0.2)');
  assert.ok(puffs()>=1,'feet dragging through the sand throw up dust');
  g.read("fall.phase='pivot'; fall.px=66.7; fall.pz=0; tauDesktop.tick(0.05); tauDesktop.tick(0.05)");
  assert.ok(puffs()>=2,'the rim gets a burst');
  assert.ok(crowd().y>0,'and the stands erupt');
  g.read("fall={active:false}; tauDesktop.board='walnut'");
  assert.equal(crowd(),null,'another board clears the arena');
  assert.equal(g.read('scene.fog'),null);
  assert.equal(g.read('camera.fov'),38);
  assert.equal(g.read('tauDesktop.fallTimeScale()'),1);
  assert.deepEqual(g.errors,[]);
});

test('each board names its materials for the ear, and every surface bakes its own noise',async t=>{
  const g=await game();t.after(g.close);
  g.read("localStorage.setItem('tauDesktopTestBoards','1')");
  const at=id=>{ g.read(`tauDesktop.board='${id}'`); return g.read('JSON.stringify(currentAcoustics())'); };
  const is=(p,su)=>JSON.stringify({piece:p,surface:su});
  assert.equal(at('walnut'),is('metal','wood'));
  assert.equal(at('marble'),is('glass','marble'));
  assert.equal(at('colossus'),is('stone','sand'));
  assert.equal(at('alien'),is('chitin','membrane'));
  assert.equal(at('math'),is('graphite','paper'));
  // The noise under the same pitch sweep is the surface's own: sand is darker than wood, wood
  // darker than marble (a fake context bakes the buffers; the ratio of sample-to-sample change to
  // level is a plain measure of brightness).
  const bright=g.read(`(()=>{ const ctx={sampleRate:22050, createBuffer:(c,n)=>{const d=new Float32Array(n); return {getChannelData:()=>d};}};
    const sharp=k=>{ const d=makeMaterialNoise(ctx, SURFACE_ACOUSTICS[k], 0.5).getChannelData(0); let hf=0, all=0;
      for(let i=1;i<d.length;i++){ hf+=Math.abs(d[i]-d[i-1]); all+=Math.abs(d[i]); } return hf/all; };
    return {sand:sharp('sand'), clay:sharp('clay'), wood:sharp('wood'), slate:sharp('slate'), marble:sharp('marble')}; })()`);
  assert.ok(bright.sand<bright.clay && bright.clay<bright.wood && bright.wood<bright.slate && bright.slate<bright.marble,
    `darker to brighter: ${JSON.stringify(bright)}`);
  // level-matched: a bake sits at the white noise's RMS the mix was tuned on
  const rms=g.read(`(()=>{ const ctx={sampleRate:22050, createBuffer:(c,n)=>{const d=new Float32Array(n); return {getChannelData:()=>d};}};
    const d=makeMaterialNoise(ctx, SURFACE_ACOUSTICS.sand, 0.5).getChannelData(0); let s=0; for (const v of d) s+=v*v; return Math.sqrt(s/d.length); })()`);
  assert.ok(Math.abs(rms-0.577)<0.06, `sand bake RMS ${rms}`);
  assert.deepEqual(g.errors,[]);
});

test('the web build\'s skins name their materials too',async t=>{
  const g=await game('');t.after(g.close);
  const at=id=>{ g.read(`skinIdx=BOARD_SKINS.findIndex(s=>s.id==='${id}'); applyTheme()`); return g.read('JSON.stringify(currentAcoustics())'); };
  const is=(p,su)=>JSON.stringify({piece:p,surface:su});
  assert.equal(at('dojo'),is('metal','wood'));
  assert.equal(at('yellow'),is('metal','paper'));
  assert.equal(at('slate'),is('metal','slate'));
  assert.deepEqual(g.errors,[]);
});
