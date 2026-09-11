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
  press(9);assert.equal(g.w.tauDesktop.paused,true);
  press(0);assert.equal(g.w.tauDesktop.paused,false);
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
  assert.ok(hub.material.transmission > 0.5 && bodyMat().transmission > hub.material.transmission, 'both are glass, legs clearer than the ball');
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
