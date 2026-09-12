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
  g.read('tauDesktop.startMatch(true)');g.tick();
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

test('a touch tap on the Menu button opens the match menu and leaves it open',async t=>{
  // The button opens on pointerdown; a touch tap then delivers its click to whatever is under
  // the lift point, which by then is the modal backdrop. That click must not count as tap-outside.
  const g=await game();t.after(g.close);
  g.$('desktopPlay').click();g.tick();
  const ev=(el,type,init)=>el.dispatchEvent(new g.w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,...init}));
  ev(g.$('desktopPause'),'pointerdown');
  assert.equal(g.$('modalTitle').textContent,'Match menu','opens on the press');
  ev(g.$('modalBackdrop'),'click');   // the same tap's click, landing on the backdrop -- no press started there
  assert.equal(g.$('modalBackdrop').style.display,'flex','the opening tap does not also dismiss it');
  // A genuine tap outside (press AND release on the backdrop) still closes it.
  ev(g.$('modalBackdrop'),'pointerdown'); ev(g.$('modalBackdrop'),'click');
  assert.equal(g.$('modalBackdrop').style.display,'none','tap outside still dismisses');
  assert.deepEqual(g.errors,[]);
});

test('the opponent keeps playing under the match menu, and the board stays visible',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLevel').value='1';g.$('desktopLevel').dispatchEvent(new g.w.Event('change'));
  g.$('desktopColour').value='1';g.$('desktopColour').dispatchEvent(new g.w.Event('change'));
  g.$('desktopPlay').click();
  g.$('desktopPause').click();g.tick();
  assert.equal(g.$('modalTitle').textContent,'Match menu');
  assert.equal(g.$('modalBody').textContent,'','no subtitle under the match menu');
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
  g.read('tauDesktop.startMatch(true)');g.tick();
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

test('the home menu reaches the analysis lab, and no longer offers the standalone showcase',async t=>{
  const g=await game();t.after(g.close);
  // Every board is selectable and unlockable directly in a real match now, so the separate
  // attract-mode showcase page is gone from the menu.
  assert.equal(g.$('desktopShowcase'),null);
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
  g.read('tauDesktop.startMatch(true)');g.tick();
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
  g.read('tauDesktop.startMatch(true)');g.tick();
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio:()=>{},getPixelRatio:()=>1,
    setSize(){},shadowMap:{}};
    camera=new THREE.PerspectiveCamera(38,1.6,1,2000); camera.position.set(0,145,148); camera.lookAt(0,4,0);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0)};`);
  const px = s => Number(String(s).replace('px','')) || 0;
  // The 3D CANVAS always spans the window now (the scene continues under the flat board); the tile
  // the dish is framed in -- what "steps aside" -- is cornerView3d, applied as a camera view offset.
  const at = v => { g.read(`setViewSplit(${v},true); resize();`);
    return { flat: px(g.read('canvas.style.width')),
             v3:   g.read('cornerView3d.w3'),
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
  g.read('tauDesktop.startMatch(true)');g.tick();
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
  g.read('tauDesktop.startMatch(true)');g.tick();
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
  g.read('tauDesktop.startMatch(true)');g.tick();
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
  g.read('tauDesktop.startMatch(true)');g.tick();
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio:()=>{},getPixelRatio:()=>1,
    setSize(){},shadowMap:{}};
    camera=new THREE.PerspectiveCamera(38,1.6,1,2000); camera.position.set(0,145,148); camera.lookAt(0,4,0);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0)};`);
  const px = s => Number(String(s).replace('px','')) || 0;
  const at = v => { g.read(`setViewSplit(${v},true); resize();`);
    return { flat: px(g.read('canvas.style.width')),
             left: g.read('cornerView3d.left') }; };   // the framed tile; the canvas itself spans the window
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
  g.read('tauDesktop.startMatch(true)');g.tick();
  // The harness fixes a landscape window; turn it portrait before laying out.
  g.w.innerWidth=900; g.w.innerHeight=1200;
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio:()=>{},getPixelRatio:()=>1,
    setSize(){},shadowMap:{}};
    camera=new THREE.PerspectiveCamera(38,0.75,1,2000); camera.position.set(0,145,148); camera.lookAt(0,4,0);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0)};`);
  const px = s => Number(String(s).replace('px','')) || 0;
  const at = v => { g.read(`setViewSplit(${v},true); resize();`);
    const tile = g.read('JSON.stringify({left:cornerView3d.left,w3:cornerView3d.w3,h3:cornerView3d.h3})'), vw = g.$('views').classList;
    const { left, w3, h3 } = JSON.parse(tile);   // the framed tile; the canvas itself spans the window
    return { left, h3, w3, above: vw.contains('view3dAbove'), side: vw.contains('view3dInset') }; };
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
  g.read('tauDesktop.startMatch(true)');g.tick();
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
  g.read('tauDesktop.startMatch(true)');g.tick();
  // F1 from anywhere. Rendered as real markup, not printed as literal tags: showModal writes a
  // plain-text body with textContent unless told otherwise, so this is the guard for that argument.
  g.key('F1');g.tick();
  assert.equal(g.$('modalTitle').textContent,'Controls');
  assert.equal(g.$('modalBody').querySelectorAll('svg.desktop-diagram').length,2,'the sheet draws a keyboard and a pad');
  assert.equal(g.$('modalBody').textContent.includes('<svg'),false,'rendered, not printed as markup');
  const padText=()=>g.$('desktopPadDiagram').textContent;
  // It reads the live scheme rather than a second hard-coded copy, so it cannot contradict the pad.
  assert.ok(/RT · swing/.test(padText()),'the trigger scheme is drawn by default');
  g.$('modalBtns').firstElementChild.click();g.tick();
  g.w.tauDesktop.padScheme='stick';
  g.key('F1');g.tick();
  assert.ok(/right stick ← → · swing/.test(padText()),'switching scheme changes what the pad picture says');
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
  g.read('tauDesktop.startMatch(true)');g.tick();
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
  g.read('tauDesktop.startMatch(true)');g.tick();
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
  g.read('tauDesktop.startMatch(true)');g.tick();
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
    // The chrome centres on the FRAMED tile (cornerView3d), which the full-window canvas shows
    // through a view offset -- not on the canvas box, which is now always the whole window.
    assert.equal(px(g.w.document.documentElement.style.getPropertyValue('--desktop-view-center')),g.read('cornerView3d.left+cornerView3d.w3/2'));
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
  g.read('tauDesktop.startMatch(true)');g.tick();
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
  g.read('tauDesktop.startMatch(true)');g.tick();
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

test('on a phone the home panel stays anchored under the board, not lifted into it',async t=>{
  // The narrow stylesheet anchors the panel to the bottom (top:auto; bottom:60px; transform:none)
  // with the room darkened behind it. fitHome's inline transform used to override that and lift the
  // menu half its own height up into the board, leaving the bottom of the screen empty -- which is
  // what the Android app showed the moment it started running the desktop presentation.
  const g=await game('',{},{capacitor:true});t.after(g.close);
  const home=g.w.document.querySelector('.desktop-home');
  Object.defineProperty(home,'offsetHeight',{get:()=>400});
  g.w.innerWidth=412; g.w.innerHeight=915; g.read('tauDesktop.resize()');
  assert.doesNotMatch(home.style.transform,/translateY/,'no centring translate on the bottom-anchored layout');
  assert.equal(home.style.transform,'scale(1.0000)','it fits under the board at natural size');
  assert.equal(home.style.transformOrigin,'0 100%','and scales from its anchored bottom edge');
  // A phone too short for the panel still shrinks it rather than running it up over the board.
  g.w.innerHeight=500; g.read('tauDesktop.resize()');
  assert.equal(home.style.transform,'scale(0.5375)');
  // A desktop-width window keeps the centred behaviour untouched.
  g.w.innerWidth=1280; g.w.innerHeight=1000; g.read('tauDesktop.resize()');
  assert.equal(home.style.transform,'translateY(-50%) scale(1.0000)');
  assert.equal(home.style.transformOrigin,'0 50%');
  assert.deepEqual(g.errors,[]);
});

test('two glass pieces are drawn in two passes: the near one over a picture of the far one',async t=>{
  const g=await game();t.after(g.close);
  g.read(`window.__calls=[];
    renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{},getDrawingBufferSize(v){v.set(640,480);return v;},
      setRenderTarget(t){window.__calls.push(['target',t?'offscreen':'screen']);},
      render(sc,cam){window.__calls.push(['render',sc===scene?'world':'overlay', sc.children.filter(o=>o.userData&&o.userData.mat).length]);}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(); camera.position.set(0,120,150);
    scene.add(new THREE.DirectionalLight(0xffffff,1)); scene.add(new THREE.HemisphereLight(0xffffff,0x222222,1));
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)]; tripods.forEach(t=>scene.add(t));
    tripods[0].position.set(0,0,40); tripods[1].position.set(0,0,-40);
    localStorage.setItem('tauDesktopTestBoards','1');`);
  g.read("tauDesktop.board='walnut'");
  assert.equal(g.read('tauDesktop.renderFrame()'),false,'solid pieces: the plain render');
  g.read("tauDesktop.board='marble'; window.__calls=[]");
  assert.equal(g.read('tauDesktop.renderFrame()'),true,'glass pieces: the desktop draws the frame');
  const calls=g.read('JSON.stringify(window.__calls)');
  assert.equal(calls,JSON.stringify([['target','offscreen'],['render','world',2],['target','screen'],['render','overlay',1]]),
    'the world (both pieces, the near one writing no colour) into the picture first, then the picture and the near piece alone to the screen');
  assert.equal(g.read('tripods.every(t=>t.parent===scene)'),true,'both pieces are back in the scene');
  assert.equal(g.read('tripods.every(t=>{let ok=true; t.traverse(o=>{ if(o.material && (!o.material.colorWrite || !o.material.depthWrite)) ok=false; }); return ok;})'),true,'and write colour again');
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
  assert.ok(crowd() && crowd().count>=2000,'a crowd of little tripods packs the tiers');
  assert.equal(g.read('!!scene.fog'),true,'haze grades with distance');
  assert.equal(g.read('camera.fov'),46,'a lower, wider lens takes in the stands');
  assert.equal(g.read('tauDesktop.fallTimeScale()'),0.5,'giants go over slowly');
  assert.equal(g.read('tauDesktop.fallFloorY()'),-20,'a fallen titan lands on the arena sand below the plinth');
  const puffs=()=>g.read("scene.children.filter(o=>o.isPoints && o.userData.dust).length");
  g.read("fall={active:true,phase:'slide',idx:1,vx:50,vz:0,px:0,pz:0}; tripods[1].position.set(55,0,0);");
  g.read('tauDesktop.tick(0.2); tauDesktop.tick(0.2)');
  assert.ok(puffs()>=1,'feet dragging through the sand throw up dust');
  g.read("fall.phase='pivot'; fall.px=66.7; fall.pz=0; tauDesktop.tick(0.05); tauDesktop.tick(0.05)");
  assert.ok(puffs()>=2,'the rim gets a burst');
  assert.ok(crowd().y>0,'and the crowd erupts');
  g.read("fall={active:false}; tauDesktop.board='walnut'");
  assert.equal(crowd(),null,'another board clears the arena');
  assert.equal(g.read('tauDesktop.fallFloorY()'),null,'and lands pieces on the game\'s own floor again');
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

test('web/PWA render quality: an auto tier, capped shadow size and DPR, desktop untouched',async t=>{
  const g=await game('');t.after(g.close);   // plain web entry, no ?steam
  // Default harness stub (2 cores): stays on the pre-existing 'basic' behaviour untouched.
  assert.equal(g.read('TAU_QUALITY_TIER'),'basic');
  assert.equal(g.read('TAU_PREMIUM'),false);
  assert.equal(g.read('TAU_SHADOW_SIZE'),1024);
  assert.equal(g.read('TAU_DPR_UNCAPPED'),false);
  // The heuristic itself, exercised directly with the DOM's own (configurable) navigator props --
  // detectQualityTier() is pure and side-effect-free on its inputs beyond localStorage/its own cache.
  const at=(cores,mem)=>g.read(`(()=>{
    Object.defineProperty(navigator,'hardwareConcurrency',{value:${cores},configurable:true});
    Object.defineProperty(navigator,'deviceMemory',{value:${mem===undefined?'undefined':mem},configurable:true});
    localStorage.removeItem('tauQualityTier');
    return detectQualityTier();
  })()`);
  assert.equal(at(8,8),'high','plenty of cores and memory -> high');
  assert.equal(at(4,undefined),'balanced','4 cores, no memory signal (Safari/Firefox) -> balanced, not penalised');
  assert.equal(at(4,2),'basic','4 cores but a low memory signal -> basic');
  assert.equal(at(2,8),'basic','too few cores, however much memory -> basic');
  assert.equal(at(0,undefined),'basic','no signal at all (e.g. an odd browser) -> basic, never guessed upward');
  assert.deepEqual(g.errors,[]);
});

test('web/PWA quality: a URL override wins over the heuristic and persists',async t=>{
  const g=await game('?quality=high');t.after(g.close);   // the 2-core stub would otherwise say 'basic'
  assert.equal(g.read('TAU_QUALITY_TIER'),'high');
  assert.equal(g.read('TAU_PREMIUM'),true);
  assert.equal(g.read('TAU_SHADOW_SIZE'),2048);
  assert.equal(g.read('TAU_DPR_UNCAPPED'),true);
  assert.equal(g.w.localStorage.getItem('tauQualityTier'),'high','persisted, so it survives a plain reload too');
  assert.deepEqual(g.errors,[]);
});

test('web/PWA quality: an invalid override is ignored, a saved one is honoured next load',async t=>{
  const g=await game('?quality=ultra');t.after(g.close);   // not a real tier
  assert.equal(g.read('TAU_QUALITY_TIER'),'basic','nonsense query value falls through to the heuristic');
  assert.equal(g.w.localStorage.getItem('tauQualityTier'),'basic','the heuristic\'s real result is cached -- not the invalid value itself');
  const g2=await game('', {tauQualityTier:'balanced'});t.after(g2.close);
  assert.equal(g2.read('TAU_QUALITY_TIER'),'balanced','a previously-saved tier is honoured without re-guessing');
  assert.equal(g2.read('TAU_PREMIUM'),true);
  assert.deepEqual(g2.errors,[]);
});

test('web/PWA quality: the desktop build always gets the top tier regardless of hardware',async t=>{
  const g=await game('?steam=1&premium=1');t.after(g.close);   // the 2-core stub would say 'basic' on the web path
  assert.equal(g.read('TAU_QUALITY_TIER'),'high');
  assert.equal(g.read('TAU_SHADOW_SIZE'),2048);
  assert.equal(g.read('TAU_DPR_UNCAPPED'),true);
  assert.deepEqual(g.errors,[]);
});

test('legs meeting legs get a short contact tick, once per squeeze not once per substep',async t=>{
  const g=await game();t.after(g.close);
  g.read('tauDesktop.startMatch(true)');g.tick();
  // The click is played by the per-frame audio driver, never from inside applySwing itself: stand-in
  // nodes let updateAudioMovement run, and a "frame" is one call to it with the piece having moved.
  g.read(`window.__pushes=0; playPushContact=()=>window.__pushes++;
    const node=()=>({gain:{setTargetAtTime(){}},frequency:{setTargetAtTime(){}}});
    voiceGain=node(); scrapeGain=node(); bandpass=node(); rubGain=node(); rubBP=node();
    audioReady=true; soundOn=true; audioCtx={currentTime:0};
    window.__frame=()=>{ audioPrevFeet=G.pieces[G.active].feet().map(f=>({x:f.x-40,y:f.y})); updateAudioMovement(0.016); };
    // Face the pieces at each other close enough that swinging one shoves the other on contact.
    G.pieces[0].x=-30; G.pieces[0].y=0; G.pieces[0].rot=0;
    G.pieces[1].x=-6; G.pieces[1].y=0; G.pieces[1].rot=Math.PI;
    G.active=0; pinFoot(0);`);
  g.read(`applySwing(50*Math.PI/180)`);   // one continuous swing, many substeps -- should shove and stay pressed in
  assert.equal(g.read('window.__pushes'),0,'nothing plays from inside the swing itself');
  g.read('window.__frame()');
  assert.equal(g.read('window.__pushes'),1,'the frame that shows the contact plays it once');
  g.read(`applySwing(1*Math.PI/180); window.__frame(); window.__frame();`);   // still pressed in, same turn
  assert.equal(g.read('window.__pushes'),1,'and not again while the same squeeze just continues');
  // A fresh turn's own genuine contact. The frame between ending one turn and starting the next
  // is what real play always has (the hand-off, the opponent's think); it is where contact drops.
  g.read(`clearTurn(); window.__frame(); pinFoot(0); applySwing(50*Math.PI/180); window.__frame();`);
  assert.equal(g.read('window.__pushes'),2,'but a new turn making contact again plays its own click');
  // The AI's planner: applySwing swept in a loop over the live state and restored, with no frame
  // rendered in between -- exactly what a "think" does. It must make no sound at all: this was the
  // crackle of knocks through every AI turn on Colossus.
  g.read(`const snap=takeSnap();
    for (let i=0;i<40;i++){ clearTurn(); pinFoot(i%3); applySwing((i%2?1:-1)*50*Math.PI/180); }
    ladderRestore(snap);`);
  assert.equal(g.read('window.__pushes'),2,'a silent search sweep plays nothing');
  assert.deepEqual(g.errors,[]);
});

test('a stuck walkthrough slide can be reset without losing earned progress',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLearn').click();g.tick();
  g.read(`for (const k of Object.keys(HTP_TRY)) { const st=htpState(k); st.done=true; st.touched=true; } htpShowStep(1)`);   // 'pivot' slide, already earned
  g.read(`const st=htpState('pivot'); st.pinned=0; st.p.rot=1.4;`);   // messed-up live pose
  assert.equal(g.read("document.getElementById('htpReset').style.display"),'','Reset shows on a try-it slide');
  g.$('htpReset').click();g.tick();
  const st=JSON.parse(g.read(`JSON.stringify({pinned:htpState('pivot').pinned, rot:+htpState('pivot').p.rot.toFixed(3), done:htpState('pivot').done})`));
  assert.equal(st.pinned,null,'the live pose is back to the start');
  assert.equal(st.done,true,'but the earned goal is not lost');
  // the goal slide (no tryKey) never shows Reset
  g.read('htpShowStep(0)');
  assert.equal(g.read("document.getElementById('htpReset').style.display"),'none');
  assert.deepEqual(g.errors,[]);
});

test('the losing piece lands on the floor below the board with a thump, then is tucked away',async t=>{
  const g=await game();t.after(g.close);
  g.read('tauDesktop.startMatch(true)');g.tick();
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    window.__thumps=0; playLandingSound=()=>window.__thumps++;
    // Already off the rim and well into the ballistic phase -- falling straight toward the floor.
    fall=Object.assign(mkFallState(G.pieces[1]), {idx:1, phase:'free', vy:-40, vx:5, vz:0});
    tripods[1].position.set(80,-85,0);`);
  g.read(`for(let i=0;i<50;i++) stepFall(0.05);`);   // 2.5s of real time: plenty to land and settle
  assert.equal(g.read('tripods[1].position.y'),-100,'clamps at the floor 20cm (100u) below the board, not falling forever');
  assert.equal(g.read('window.__thumps'),1,'one landing thump on touchdown, not one per frame of resting on the floor');
  assert.equal(g.read('fall.active'),false,'after a beat resting on the floor it is tucked away, same as the old cutoff');
  assert.equal(g.read('fallenIdx'),1);
  assert.equal(g.read('tripods[1].visible'),false);
  assert.deepEqual(g.errors,[]);
});

test('the native Android/iOS app gets the premium desktop presentation with no ?steam URL param',async t=>{
  // Capacitor never puts ?steam=1 on the page's URL the way the Electron wrapper does -- the native
  // app instead has to be recognised by window.Capacitor, which Capacitor injects into every native
  // WebView before any page script runs.
  const g=await game('',{},{capacitor:true});t.after(g.close);
  assert.equal(g.read('window.TAU_DESKTOP'),true,'a Capacitor native shell counts as desktop-grade too');
  assert.equal(g.read("document.documentElement.classList.contains('tau-desktop')"),true);
  g.read("localStorage.setItem('tauDesktopTestBoards','1')");
  assert.equal(g.read("typeof tauDesktop"),'object','desktop/presentation.js actually loaded, not just the flag');
  g.read("tauDesktop.board='marble'");
  assert.equal(g.read('currentAcoustics().piece'),'glass','the showcase catalogue (marble etc.) is reachable');
  assert.deepEqual(g.errors,[]);
});

test('the app signs in with Google natively once a client ID is configured',async t=>{
  // Google's servers refuse OAuth from an app WebView, so the app asks Android's Credential Manager
  // through the Capacitor plugin and hands Supabase the ID token that comes back.
  const g=await game('',{},{capacitor:true});t.after(g.close);
  g.read(`TAU_GOOGLE_NATIVE_CLIENT_ID='123-abc.apps.googleusercontent.com';
    window.__init=[]; window.__logins=[];
    Capacitor.Plugins={SocialLogin:{
      initialize:o=>{window.__init.push(o);return Promise.resolve();},
      login:o=>{window.__logins.push(o);return Promise.resolve({provider:'google',result:{idToken:'ID_TOKEN_FROM_GOOGLE'}});},
    }};
    sb={auth:{signInWithIdToken:o=>{window.__tokens=(window.__tokens||[]);window.__tokens.push(o);return Promise.resolve({error:null});}}};`);
  assert.equal(g.read('nativeGoogleAvailable()'),true,'the button is live once the plugin and an ID are both there');
  g.read('openAcctPanel()');
  assert.notEqual(g.read("document.getElementById('acctGoogle').style.display"),'none','so it is shown, not hidden');
  await g.read("nativeGoogleSignIn()");
  assert.equal(g.read("JSON.stringify(window.__init[0].google.webClientId)"),'"123-abc.apps.googleusercontent.com"',
    'Android is initialised with the WEB client ID -- the audience its ID token carries');
  // The plugin's Android side rejects with "You CANNOT use scopes without modifying the main
  // activity" the instant a request-level `scopes` array is present at all -- even naming just its
  // own defaults (email/profile) trips it, since only scopes BEYOND the defaults need that native
  // change. Those defaults already cover a sign-in, so the fix is asking for no scopes.
  assert.equal(g.read("'scopes' in (window.__logins[0].options||{})"),false,
    'no scopes requested -- would reject on real Android with "You CANNOT use scopes..."');
  assert.equal(g.read("JSON.stringify(window.__tokens[0])"),
    JSON.stringify({provider:'google',token:'ID_TOKEN_FROM_GOOGLE'}),'and Supabase takes that token directly');
  assert.equal(g.read(`localStorage.getItem(AUTH_PERSIST_FLAG)`),'1','a real account, so the session persists');
  assert.deepEqual(g.errors,[]);
});

test('with no client ID configured the app keeps exactly its username & password panel',async t=>{
  const g=await game('',{},{capacitor:true});t.after(g.close);
  g.read(`Capacitor.Plugins={SocialLogin:{initialize:()=>Promise.resolve(),login:()=>Promise.resolve({})}};
    TAU_GOOGLE_NATIVE_CLIENT_ID='';`);   // a build with the ID cleared, e.g. a fork without its own Google client
  assert.equal(g.read('nativeGoogleAvailable()'),false,'so nothing offers a Google button that cannot work');
  g.read('openAcctPanel()');
  assert.equal(g.read("document.getElementById('acctGoogle').style.display"),'none');
  assert.match(g.read("document.getElementById('acctMsg').textContent"),/username & password/);
  assert.deepEqual(g.errors,[]);
});

test('the sign-in panel is a centred sheet on the premium presentation, and a click outside still closes it',async t=>{
  const g=await game();t.after(g.close);
  g.read('openAcctPanel()');
  assert.equal(g.read("document.getElementById('acctPanel').style.display"),'flex');
  // Clicking the room behind the sheet closes it, as it always has. The dimmer is a pseudo-element
  // on the panel itself, so it must not take pointer events -- otherwise every click outside would
  // land on the panel and nothing would ever close.
  g.read(`(()=>{const e=new MouseEvent('click',{bubbles:true});
    Object.defineProperty(e,'target',{value:document.body}); acctPanelOpenedAt=0;
    document.body.dispatchEvent(e);})()`);
  assert.equal(g.read("document.getElementById('acctPanel').style.display"),'none','a click outside closes it');
  const css=fs.readFileSync(path.join(root,'desktop/presentation.css'),'utf8');
  const rule=css.slice(css.indexOf('.tau-desktop #acctPanel {'),css.indexOf('.tau-desktop #htpFull'));
  assert.match(rule,/position:fixed; inset:0; margin:auto/,'centred by auto margins');
  // NOT by a transform: a transformed element becomes the containing block for its own
  // fixed-position descendants, which shrank the dimmer to the size of the sheet it sits behind.
  assert.equal(/#acctPanel \{[^}]*transform:/.test(rule),false,'and never by a transform');
  assert.match(rule,/#acctPanel::before \{[^}]*pointer-events:none/,'the dimmer passes clicks through');
  assert.match(rule,/box-sizing:border-box/,'its padding counts inside the width, so a phone fits it');
  assert.deepEqual(g.errors,[]);
});

test('the leaderboard players\' latest games are a Watch section, not just a small link in a row',async t=>{
  const g=await game();t.after(g.close);
  // A backend with three rated players and two finished public games between them.
  g.read(`(()=>{
    const profiles=[{id:'p1',username:'Ada',elo:1420,wins:12,losses:3},
                    {id:'p2',username:'Bo',elo:1310,wins:9,losses:5},
                    {id:'p3',username:'Cleo',elo:1220,wins:4,losses:6}];
    const matches=[{id:'m1',blue_id:'p1',red_id:'p2',blue_elo:1420,red_elo:1310,winner_color:'blue',finished_at:'2026-09-12T10:00:00Z'},
                   {id:'m2',blue_id:'p3',red_id:'p1',blue_elo:1220,red_elo:1420,winner_color:'red',finished_at:'2026-09-12T09:00:00Z'}];
    const q=data=>{const o={data,error:null};
      const self={select:()=>self,or:()=>self,eq:()=>self,is:()=>self,not:()=>self,in:()=>self,
        order:()=>self,limit:()=>self,single:()=>Promise.resolve(o),
        then:(f,r)=>Promise.resolve(o).then(f,r),catch:f=>Promise.resolve(o).catch(f)};
      return self;};
    sb={from:t=>q(t==='profiles'?profiles:matches),rpc:()=>Promise.resolve({data:null}),
        auth:{getSession:()=>Promise.resolve({data:{session:null}})},removeChannel(){},
        channel(){return{on(){return this;},subscribe(){return this;}};}};
    window.__watched=null; watchFinishedGame=(row,names)=>{window.__watched=[row.id,names.join(' vs ')];};
  })()`);
  g.read('openWatchScreen()');
  await new Promise(r=>setTimeout(r,150));
  const sec=g.$('wsTopPlayers');
  assert.ok(sec,'the Watch screen has a section for it');
  assert.equal(sec.querySelector('h3').textContent,'Top players\u2019 latest games');
  const rows=[...sec.querySelectorAll('.wsRow')];
  assert.equal(rows.length,3,'one row per rated player with a replayable last game');
  assert.match(rows[0].textContent,/Ada vs Bo/,'the matchup is the label');
  assert.match(rows[0].textContent,/^1/,'ranked by their leaderboard position, not by row order');
  rows[0].querySelector('.wsPlay').dispatchEvent(new g.w.MouseEvent('click',{bubbles:true}));
  assert.equal(g.read("(window.__watched||[]).join(' / ')"),'m1 / Ada vs Bo','and playing one replays that game');
  assert.deepEqual(g.errors,[]);
});

test('the leaderboard\'s watch link is styled by the presentation, not hard-coded in the row',async t=>{
  const g=await game();t.after(g.close);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  // It used to carry its web blue and 12px inline, which beats any stylesheet -- so on the premium
  // presentation it was a small blue link lost among gold standings.
  const btns=html.match(/<button class="lbWatch"[^>]*>/g)||[];
  assert.equal(btns.length,2,'the inline row link and the stacked one below it');
  for (const b of btns) assert.equal(/style=/.test(b),false,'no inline styling to fight');
  const css=fs.readFileSync(path.join(root,'desktop/presentation.css'),'utf8');
  assert.match(css,/\.tau-desktop \.lbWatch \{[^}]*var\(--gold\)/,'the premium sheet draws it in gold');
  assert.match(css,/\.tau-desktop #modalBox\.wide \{[^}]*width:min\(720px/,'and gives the table room for the column');
  assert.deepEqual(g.errors,[]);
});

test('a plain web/PWA load (no ?steam, no Capacitor) stays off the desktop presentation',async t=>{
  const g=await game('');t.after(g.close);
  assert.equal(g.read('window.TAU_DESKTOP'),false);
  assert.equal(g.read("document.documentElement.classList.contains('tau-desktop')"),false);
  assert.equal(g.read('typeof window.tauDesktop'),'undefined');
  assert.deepEqual(g.errors,[]);
});

test('legs rubbing along legs: one click on contact, then a drag pitched by where they touch',async t=>{
  const g=await game();t.after(g.close);
  g.read('tauDesktop.startMatch(true)');g.tick();
  g.read(`window.__pushes=0; playPushContact=()=>window.__pushes++;
    G.pieces[0].x=-30; G.pieces[0].y=0; G.pieces[0].rot=0;
    G.pieces[1].x=-6; G.pieces[1].y=0; G.pieces[1].rot=Math.PI;
    G.active=0; pinFoot(0); applySwing(50*Math.PI/180);`);
  assert.equal(g.read('window.__pushes'),0,'the click waits for a frame -- nothing plays from inside the swing');
  assert.equal(g.read('G.pushContact'),true,'the legs are pressed together');
  const foot=g.read('pushContactFoot');
  assert.ok(foot>0&&foot<=1,`the contact sits somewhere along the leg, 0 hub .. 1 foot (${foot})`);
  // Drive the per-frame audio with stand-in nodes: pressed together AND moving opens the rub at a
  // pitch set by the contact point; the same feet next frame (at rest) closes it.
  g.read(`window.__rub=[]; window.__hz=[];
    const node=()=>({gain:{setTargetAtTime(){}},frequency:{setTargetAtTime(){}}});
    voiceGain=node(); scrapeGain=node(); bandpass=node();
    rubGain={gain:{setTargetAtTime:v=>window.__rub.push(v)}}; rubBP={frequency:{setTargetAtTime:v=>window.__hz.push(v)}};
    audioReady=true; soundOn=true; audioCtx={currentTime:0};
    audioPrevFeet=G.pieces[0].feet().map(f=>({x:f.x-40,y:f.y}));
    updateAudioMovement(0.016);`);
  assert.equal(g.read('window.__pushes'),1,'the click plays once, on the frame that shows the contact');
  assert.ok(g.read('window.__rub.at(-1)')>0,'moving while pressed together: the rub sounds');
  const hz=g.read('window.__hz.at(-1)');
  assert.ok(hz>320&&hz<=2220,`pitched between the hub (low) and the foot (high): ${hz} Hz`);
  assert.ok(Math.abs(hz-(320+1900*foot))<1e-6,'and it is the contact point that sets it');
  g.read('updateAudioMovement(0.016)');
  assert.equal(g.read('window.__rub.at(-1)'),0,'at rest the rub closes');
  assert.deepEqual(g.errors,[]);
});

test('Controls is its own section: a drawn keyboard and pad, the scheme switch, and rebindable keys',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopControls').click();g.tick();
  assert.equal(g.$('modalTitle').textContent,'Controls');
  assert.equal(g.$('modalBox').querySelectorAll('svg.desktop-diagram').length,2,'a keyboard picture and a controller picture');
  assert.match(g.$('desktopKeyboardDiagram').textContent,/foot 1[\s\S]*end turn/,'each key wears what it does');
  assert.match(g.$('desktopPadDiagram').textContent,/RT · swing/,'the triggers scheme is drawn by default');
  g.$('desktopPadScheme').value='stick';g.$('desktopPadScheme').dispatchEvent(new g.w.Event('change'));
  assert.match(g.$('desktopPadDiagram').textContent,/right stick ← → · swing/,'switching the scheme redraws the pad');
  assert.equal(g.read('tauDesktop.padScheme'),'stick');
  // The pad is drawn for the make that is plugged in: an Xbox pad with nothing connected, the
  // maker's own button names once a pad reports its id, and a plain numbered pad for the rest.
  assert.match(g.$('desktopPadDiagram').textContent,/A · pin · end turn/,'Xbox names by default');
  assert.equal(g.$('desktopPadBrand').options[0].textContent,'Auto · Xbox');
  assert.equal(g.read("tauDesktop.padBrandOf('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')"),'playstation');
  assert.equal(g.read("tauDesktop.padBrandOf('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')"),'nintendo');
  assert.equal(g.read("tauDesktop.padBrandOf('Xbox 360 Controller (XInput STANDARD GAMEPAD)')"),'xbox');
  assert.equal(g.read("tauDesktop.padBrandOf('Generic USB Joystick (Vendor: 0079 Product: 0006)')"),'generic');
  const pad={id:'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  g.w.navigator.getGamepads=()=>[pad];g.tick();
  assert.match(g.$('desktopPadDiagram').textContent,/✕ · pin · end turn/,'plugging in a PlayStation pad redraws the open sheet with its glyphs');
  assert.equal(g.$('desktopPadBrand').options[0].textContent,'Auto · PlayStation');
  g.$('desktopPadBrand').value='nintendo';g.$('desktopPadBrand').dispatchEvent(new g.w.Event('change'));
  assert.match(g.$('desktopPadDiagram').textContent,/B · pin · end turn[\s\S]*\+ · match menu/,'a chosen layout overrides the detected one');
  assert.equal(JSON.parse(g.w.localStorage.getItem('tauDesktopSettingsV1')).padBrand,'nintendo');
  g.$('desktopPadBrand').value='generic';g.$('desktopPadBrand').dispatchEvent(new g.w.Event('change'));
  assert.match(g.$('desktopPadDiagram').textContent,/1 · pin · end turn/,'the generic pad numbers its buttons');
  g.$('desktopPadBrand').value='auto';g.$('desktopPadBrand').dispatchEvent(new g.w.Event('change'));
  g.w.navigator.getGamepads=()=>[];
  // Rebind "end turn" from Enter to Space: click the key on the picture, press the new one.
  const keyOf=a=>g.$('modalBox').querySelector(`[data-rebind="${a}"] .key`);
  assert.equal(keyOf('commit').textContent,'Enter');
  g.$('modalBox').querySelector('[data-rebind="commit"]').dispatchEvent(new g.w.MouseEvent('click',{bubbles:true}));
  assert.equal(keyOf('commit').textContent,'…','the cap listens');
  g.w.dispatchEvent(new g.w.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
  assert.equal(g.read('tauDesktop.keys.commit'),' ');
  assert.equal(keyOf('commit').textContent,'Space');
  assert.match(g.$('desktopKeyboardDiagram').textContent,/Space/,'the picture follows the binding');
  assert.equal(JSON.parse(g.w.localStorage.getItem('tauDesktopSettingsV1')).keys.commit,' ','and it is saved');
  g.$('modalBtns').firstElementChild.click();g.tick();
  // The new key drives the game and the old one no longer does.
  g.read('tauDesktop.startMatch(true)');g.tick();
  g.read('G.active=0; clearTurn(); if(document.activeElement&&document.activeElement.blur) document.activeElement.blur();');
  g.key('1');g.tick();
  assert.notEqual(g.read('G.pinned'),null,'1 still pins a foot');
  g.key('ArrowRight');g.key('ArrowRight','keyup');   // a legal move, so ending the turn is possible at all
  g.key('Enter');g.tick();
  assert.equal(g.read('G.active'),0,'Enter no longer ends the turn');
  g.key(' ');g.tick();
  assert.equal(g.read('G.active'),1,'Space does');
  assert.deepEqual(g.errors,[]);
});

test('the premium home menu uses the web app\'s words and shape, with no subtitles anywhere',async t=>{
  const g=await game();t.after(g.close);
  const labels=[...g.w.document.querySelectorAll('.desktop-links button')].map(b=>b.textContent);
  assert.deepEqual(labels,['1v1','Watch','How to play','Leaderboard'],'the web\'s vs AI is the gold Play here; no shop link inside a paid build');
  const bottom=[...g.w.document.querySelectorAll('.desktop-home-bottom button')].filter(b=>!b.hidden).map(b=>b.textContent);
  assert.deepEqual(bottom,['Settings','Controls','Lab']);
  assert.equal(g.$('desktopPlay').textContent,'Play','the gold Play stays');
  for (const sel of ['.desktop-home h2','.desktop-intro','.desktop-material','#desktopInputHint','#desktopLocal'])
    assert.equal(g.w.document.querySelector(sel),null,sel+' is gone');
  // The entries are the web's own buttons behind the premium chrome: 1v1 is the web's hub.
  g.$('desktopOnline').click();g.tick();
  assert.equal(g.$('modalTitle').textContent,'1v1');
  assert.ok([...g.$('modalBtns').children].some(b=>b.textContent==='Local 1v1'),'same-screen play lives inside 1v1, as on the web');
  g.$('modalBtns').lastElementChild.click();g.tick();
  // In a match the line under the board carries state, never the step-by-step coaching.
  g.read('tauDesktop.startMatch(true)');g.tick();
  assert.equal(g.$('help').textContent,'','no "Step 1" subtitle under the board on the premium presentation');
  g.$('desktopPause').click();g.tick();
  assert.equal(g.$('modalBody').textContent,'');
  [...g.$('modalBtns').children].find(b=>b.textContent==='Leave match').click();g.tick();
  assert.equal(g.$('modalBody').textContent,'','no subtitle under the leave confirm either');
  assert.deepEqual(g.errors,[]);
  // The app (no keyboard) gets the same Controls section, minus rebinding.
  const app=await game('',{},{capacitor:true});t.after(app.close);
  app.$('desktopControls').click();app.tick();
  assert.equal(app.$('modalBox').querySelectorAll('svg.desktop-diagram').length,2);
  assert.equal(app.$('modalBox').querySelector('[data-rebind]'),null,'no keyboard rebinding in the app');
  assert.match(app.$('modalBody').textContent,/Tap a foot to pin it/,'and the touch controls up top');
  assert.deepEqual(app.errors,[]);
  // A narrow window gets the compact sheet: a key list instead of the keyboard picture, the pad
  // drawn bare with its legend underneath, and the keys still rebindable from the list.
  const nw=await game(undefined,{},{width:420});t.after(nw.close);
  nw.$('desktopControls').click();nw.tick();
  assert.equal(nw.$('modalBox').querySelectorAll('svg.desktop-diagram').length,1,'only the pad is a picture');
  assert.ok(nw.$('modalBox').querySelector('svg.desktop-diagram.compact'),'drawn bare');
  assert.match(nw.$('modalBox').querySelector('.desktop-pad-legend').textContent,/RT · swing ↻/,'with its legend below');
  assert.equal(nw.$('modalBox').querySelector('kbd[data-rebind="commit"]').textContent,'Enter');
  nw.$('modalBox').querySelector('kbd[data-rebind="commit"]').dispatchEvent(new nw.w.MouseEvent('click',{bubbles:true}));
  nw.w.dispatchEvent(new nw.w.KeyboardEvent('keydown',{key:'x',bubbles:true,cancelable:true}));
  assert.equal(nw.read('tauDesktop.keys.commit'),'x');
  assert.equal(nw.$('modalBox').querySelector('kbd[data-rebind="commit"]').textContent,'X','shown as the cap prints it');
  assert.deepEqual(nw.errors,[]);
});
