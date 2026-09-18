const test = require('node:test');
const assert = require('node:assert/strict');
const {game, root} = require('./game-harness.cjs');
const fs = require('node:fs');
const path = require('node:path');

// A local 1v1 now opens the "choose your controls" screen first (its own tests are further down);
// every test that just wants a two-human board takes that screen's pass-and-play shortcut.
const localMatch = g => { g.read('tauDesktop.startMatch(true)'); g.$('desktopPickSkip').click(); g.tick(); };

test('offline launch, keyboard move, pause and settings use the real game', async t=>{
  const g=await game();t.after(g.close);
  assert.ok(g.w.tauDesktop,'desktop script initialized');
  assert.deepEqual(g.errors,[]);
  assert.ok(g.w.document.documentElement.classList.contains('desktop-overhead'));
  localMatch(g);
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
  localMatch(g);
  // End-state fixture: result bookkeeping and rematch are the production handlers. The way back is
  // matched loosely because the desktop sheet no longer names its own buttons -- it shows the ones
  // the game computed, so this reads "Menu" now where it used to read the desktop's "Main menu".
  g.read('G.over=true; G.winner=0; renderGameOverSheet()');g.tick();
  assert.equal(g.$('modalBtns').firstElementChild.textContent,'Rematch');
  g.$('modalBtns').firstElementChild.click();g.tick();
  assert.equal(g.read('G.over'),false);assert.equal(g.read('vsAI'),false);
  assert.equal(g.read('G.active'),0);assert.equal(g.read('turnClockMode()'),false);
  g.read('G.over=true; G.winner=1; renderGameOverSheet()');g.tick();
  [...g.$('modalBtns').children].find(b=>/^(Menu|Main menu)$/.test(b.textContent)).click();g.tick();
  assert.equal(g.$('menu').style.display,'flex');
  assert.equal(g.w.document.activeElement,g.$('desktopPlay'));
  assert.deepEqual(g.errors,[]);
});

test('the home menu reaches the analysis lab, and no longer offers the standalone showcase',async t=>{
  const g=await game();t.after(g.close);
  // Every board is selectable and unlockable directly in a real match now, so the separate
  // attract-mode showcase page is gone from the menu.
  assert.equal(g.$('desktopShowcase'),null);
  // The Lab button opens the #lab overlay in place — in a BROWSER. It is a developer drop-target
  // for neural-net models and is removed from the packaged Steam and app builds entirely.
  g.$('desktopLab').click();g.tick();
  assert.ok(g.$('labOverlay').classList.contains('open'),'lab overlay opened');
  assert.deepEqual(g.errors,[]);
});

test('the Lab is a developer tool and never ships in a packaged build',async t=>{
  const steam=await game();t.after(steam.close);
  steam.read("window.tauSteam={quit(){}};");
  steam.read('tauDesktop.relabel && tauDesktop.relabel()');
  const packaged=await game('?steam=1&premium=1',{},{capacitor:true});t.after(packaged.close);
  assert.equal(packaged.$('desktopLab'),null,'no Lab in the app build');
  const labels=[...packaged.$('desktopHome').querySelectorAll('.desktop-home-bottom button')]
    .filter(b=>!b.hidden).map(b=>b.textContent);
  assert.ok(!labels.includes('Lab'),`bottom row is ${labels.join(', ')}`);
  assert.deepEqual(packaged.errors,[]);
});

test('a real match hands board sizing to the shared layout, not a cut-down desktop one',async t=>{
  const g=await game();t.after(g.close);
  // The old "Overhead view" corner-minimap toggle is gone -- the flat board is no longer hidden
  // behind a mode switch, it's just always there beside the 3D view (see native/README.md).
  assert.equal(g.$('desktopMap'),null,'the old overhead-toggle button is removed');
  assert.equal(Object.prototype.hasOwnProperty.call(
    JSON.parse(g.w.localStorage.getItem('tauDesktopSettingsV1')||'{}'), 'map'), false);
  localMatch(g);
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
  localMatch(g);
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
  localMatch(g);
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
  localMatch(g);
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
  localMatch(g);
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
  localMatch(g);
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
  localMatch(g);
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
  localMatch(g);
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
  localMatch(g);
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
  localMatch(g);
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
  localMatch(g);
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
  localMatch(g);
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
  localMatch(g);
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

test('a board is an opponent: the next one opens when this one is beaten as Blue and as Red',async t=>{
  const g=await game();t.after(g.close);
  const D=g.w.tauDesktop;
  const by=id=>D.boards.find(b=>b.id===id);
  assert.equal(D.board,'walnut','you start on Walnut, which is rung 1');
  assert.ok(by('walnut').unlocked && !by('dojo').unlocked && !by('marble').unlocked && !by('alien').unlocked,'the rest waits');
  assert.match(by('dojo').unlock,/beat Hazel as Blue and as Red/);
  // Half the job is not the job: beating Walnut as Blue names the half that is left.
  g.read('markLadderCleared(1,0)');
  assert.ok(!by('dojo').unlocked,'one colour is not enough');
  assert.match(by('dojo').unlock,/beat Hazel as Red/,'and it says which half is missing');
  g.read('markLadderCleared(1,1)');
  assert.ok(by('dojo').unlocked,'both colours opens the next board');
  assert.ok(!by('slate').unlocked,'and only the next one');
  assert.match(by('slate').unlock,/beat Sifu as Blue and as Red/,'which names ITS opponent, not a game count');
  // The three boards still waiting for a rung of their own keep the old counters.
  assert.match(by('yellow').unlock,/20 games/);
  // Nobody loses a board they already had: the old counters are still a way in.
  D.recordResult({humanWon:true,vsAI:true,online:false,lab:false,level:8});
  assert.ok(by('noir').unlocked,'a player who got here the old way keeps Noir');
  assert.equal(g.read("JSON.parse(localStorage.getItem('tauDesktopProgress')).topLevel"),9,'progress persists');
  // The lab is never a game.
  D.recordResult({humanWon:true,vsAI:true,online:false,lab:true,level:10});
  assert.equal(D.progress.played,1,'the lab is not a game');
  // Settings lists a locked board disabled, with what opens it, and refuses to select it.
  D.openSettings ? D.openSettings() : g.w.document.getElementById('desktopSettings').click();
  const sel=g.w.document.getElementById('desktopBoard');
  const opt=id=>[...sel.options].find(o=>o.value===id);
  assert.ok(opt('walnut') && !opt('walnut').disabled,'Walnut is selectable');
  assert.ok(opt('marble').disabled && /Marble · Alabaster · beat Chorus as Blue and as Red/.test(opt('marble').textContent),
    'Marble is listed with who lives there and what opens it');
  sel.value='marble'; sel.onchange({target:sel});
  assert.equal(D.board,'walnut','a locked pick is refused');
  assert.deepEqual(g.errors,[]);
});

test('choosing the opponent chooses the board, and choosing the board chooses the opponent',async t=>{
  const g=await game();t.after(g.close);
  const D=g.w.tauDesktop;
  const lv=g.$('desktopLevel');
  // Every rung wears its board's name, and the ones you have not reached are greyed rather than
  // hidden: you can see who is waiting two boards up, you just cannot skip to them.
  assert.match([...lv.options][0].textContent,/Level 1 · Hazel/);
  assert.match([...lv.options][4].textContent,/Level 5 · Vesper/);
  assert.ok([...lv.options][1].disabled,'a rung whose board is locked cannot be picked');
  assert.equal(lv.value,'1','and a fresh player is on rung 1, whatever the saved level said');
  // Open two rungs, then pick the second: the board comes with it.
  g.read('markLadderCleared(1,0);markLadderCleared(1,1);markLadderCleared(2,0);markLadderCleared(2,1);');
  D.recordResult({humanWon:false,vsAI:true,online:false,lab:false,level:0});   // repaints the picker
  assert.ok(!lv.options[2].disabled,'Slate is reachable now');
  lv.value='3'; lv.dispatchEvent(new g.w.Event('change'));
  assert.equal(D.board,'slate','picking the opponent put us on their board');
  // ...and the other way round, from Settings.
  D.openSettings ? D.openSettings() : g.w.document.getElementById('desktopSettings').click();
  const sel=g.w.document.getElementById('desktopBoard');
  sel.value='dojo'; sel.onchange({target:sel});
  assert.equal(D.board,'dojo');
  assert.equal(lv.value,'2','and the opponent followed the board');
  assert.deepEqual(g.errors,[]);
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
  localMatch(g);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio:()=>{},getPixelRatio:()=>1,setSize(){},shadowMap:{}};
    camera=new THREE.PerspectiveCamera(38,1.6,1,2000); camera.position.set(0,145,148); camera.lookAt(0,4,0);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0)};
    setViewSplit(1,true); resize();`);
  assert.notEqual(g.read("document.getElementById('view3d').style.left"),'','dragged out, the corner layout positions the 3D tile inline');
  g.read('G.over=true; G.winner=1; renderGameOverSheet()');
  // The stub renderer has no scene to draw, so frames run without it and it is back for the
  // menu's own layout pass, which is what clears the offsets.
  g.read('window.__stub=renderer; renderer=null');g.tick();g.read('renderer=window.__stub');
  [...g.$('modalBtns').children].find(b=>/^(Menu|Main menu)$/.test(b.textContent)).click();
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
      render(sc,cam){const gl=sc.children.filter(o=>o.userData&&o.userData.mat);
        if(sc!==scene){const q=sc.children.find(o=>o.isMesh&&o.renderOrder===-1);
          window.__quad=q&&{test:q.material.depthTest,write:q.material.depthWrite,func:q.material.depthFunc};}
        window.__calls.push(['render',sc===scene?'world':'overlay', gl.length, gl.filter(o=>o.userData.mat.colorWrite!==false).length]);}};
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
  // Both passes hold both pieces -- what changes is which of them writes colour. Pass one paints
  // the world with the near piece silent; pass two paints that picture and draws the near piece
  // over it, the far one silent but still there, so it keeps casting its shadow on the near one.
  assert.equal(calls,JSON.stringify([['target','offscreen'],['render','world',2,1],['target','screen'],['render','overlay',2,1]]),
    'each pass has both pieces in it and exactly one of them drawing');
  // The whole point of the second pass is that the near piece is DEPTH-TESTED against the picture,
  // so the two sets of legs weave through each other. The quad restores that depth per pixel -- and
  // GL throws depth writes away whenever the depth test is disabled, whatever depthMask says, so
  // the test has to be ON and always-passing. With it off the near piece drew over the far one at
  // every crossing and the lot flipped together when the near/far choice handed over.
  assert.deepEqual(JSON.parse(g.read('JSON.stringify(window.__quad)')),
    {test:true, write:true, func:g.read('THREE.AlwaysDepth')},
    'the picture is blitted with an always-passing depth test, not a disabled one');
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
  // The body says what it is touching: 'board' while any of it is still on the board, then 'air'.
  g.read(`fall={active:true, phase:'board', idx:1, V:new THREE.Vector3(50,0,0), bounces:0, resting:false};
    tripods[1].position.set(55,0,0);`);
  g.read('tauDesktop.tick(0.2); tauDesktop.tick(0.2)');
  assert.ok(puffs()>=1,'feet dragging through the sand throw up dust');
  g.read("fall.phase='air'; tauDesktop.tick(0.05); tauDesktop.tick(0.05)");
  assert.ok(puffs()>=2,'leaving the rim gets a burst');
  assert.ok(crowd().y>0,'and the crowd erupts');
  g.read("fall={active:false}; tauDesktop.board='walnut'");
  assert.equal(crowd(),null,'another board clears the arena');
  assert.equal(g.read('tauDesktop.fallFloorY()'),-34,'and lands pieces on the walnut table\'s own floor again');
  assert.equal(g.read('scene.fog'),null);
  assert.equal(g.read('camera.fov'),38);
  assert.equal(g.read('tauDesktop.fallTimeScale()'),1);
  assert.deepEqual(g.errors,[]);
});

test('a fallen titan throws up dust where it actually lands on the sand, not on the board above',async t=>{
  const g=await game();t.after(g.close);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    localStorage.setItem('tauDesktopTestBoards','1');`);
  g.read("tauDesktop.board='colossus'");
  // Drop the real fall physics straight into the free-tumble branch (skip slide/pivot, which are
  // covered by the test above) so the only dust in play is the landing itself, and pin the wobble
  // so the drop is not a coin flip about how many bounces it takes to settle.
  g.read(`playLandingSound=()=>{};
    let seed=11; Math.random=()=>((seed=(seed*16807)%2147483647)/2147483647);
    fall=Object.assign(mkFallState(G.pieces[1]), {idx:1, vy:0, vx:18, vz:6});
    tripods[1].position.set(90,0,0);`);
  // Run the real physics and the desktop's per-frame tick side by side, exactly as a match does,
  // logging a sample of the newest floor-height dust cloud each time a bounce lands.
  g.read(`window.__log=[];
    // Every dust cloud thrown up below the board -- the sand, and the plinth's flank on the way
    // down to it. (Clouds raised ON the board sit at its own height and are not these.)
    const floorPuffs=()=>scene.children.filter(o=>o.isPoints && o.userData.dust && o.userData.dust.floorY < -1);
    let prevBounces=0;
    for(let i=0;i<400;i++){
      if(fall.active) stepFall(1/60);
      tauDesktop.tick(1/60);
      if(fall.bounces!==prevBounces){
        prevBounces=fall.bounces;
        // Only landings on the GROUND: a titan on its way over clips the board it is leaving, and
        // that contact belongs to the board, not to the sand this test is about.
        if(!fall.lastImpact || fall.lastImpact.y > -1) continue;
        const pts=floorPuffs(), newest=pts[pts.length-1];
        if(!newest) continue;
        const pos=newest.geometry.attributes.position.array;
        let minY=Infinity,maxY=-Infinity; for(let j=1;j<pos.length;j+=3){ if(pos[j]<minY)minY=pos[j]; if(pos[j]>maxY)maxY=pos[j]; }
        window.__log.push({bounces:fall.bounces, n:pos.length/3, minY, maxY,
                           hitY:fall.lastImpact.y, floorCount:pts.length});
      }
    }`);
  const floor=g.read('fallFloorY()');
  assert.equal(floor,-20,'colossus lands its loser on the arena sand');
  assert.ok(g.read('fall.bounces')>=2,'a titan dropped from the board bounces more than once before it settles');
  assert.ok(g.read('fall.lastImpact.y')<-1,'the last recorded contact is below the board, on the ground');
  const log=JSON.parse(g.read('JSON.stringify(window.__log)'));
  assert.ok(log.length>=2,`at least two landings logged (got ${log.length})`);
  assert.ok(log[0].minY>log[0].hitY-0.01 && log[0].minY<log[0].hitY+3,
    'the landing spawns right at the ground it hit, not at the board surface above');
  assert.ok(log[0].hitY<-1,'and that ground is below the board');
  // How much is thrown up follows how hard it hit: the arrival is the fastest contact, so it is
  // the biggest cloud, and the taps it settles with are smaller.
  assert.ok(log[0].n>log[log.length-1].n,`the hardest landing is the big puff (${log[0].n} vs ${log[log.length-1].n})`);
  assert.ok(log[log.length-1].floorCount>log[0].floorCount,'later landings add their own puffs rather than replacing the first');
  // Let the airborne dust keep integrating after the piece itself has settled, then check none of
  // it ever sank through the sand it was thrown up from.
  g.read(`for(let i=0;i<90;i++) tauDesktop.tick(1/30);`);
  const minYAfter=g.read(`Math.min(...scene.children.filter(o=>o.isPoints && o.userData.dust && o.userData.dust.floorY < -1)
    .flatMap(o=>{ const a=o.geometry.attributes.position.array, ys=[]; for(let j=1;j<a.length;j+=3) ys.push(a[j]); return ys; }))`);
  assert.ok(!isFinite(minYAfter) || minYAfter>=floor+0.3-0.01,'no dust particle falls through the ground it landed on');
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
  localMatch(g);
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

test('the loser goes over the rim, lands on the floor below and comes to rest lying there',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    window.__thumps=[]; playLandingSound=(s)=>window.__thumps.push(s===undefined?1:s);
    // A real loss: the piece stands near the rim and gets the push the game gives it. Nothing here
    // says "now tip" or "now fall" -- it is standing on a board that runs out.
    // Pinned randomness, since the seeded jitter differs run to run and this is about the motion.
    let seed=7; Math.random=()=>((seed=(seed*16807)%2147483647)/2147483647);
    G.pieces[1].x = CFG.edgeU - 10; G.pieces[1].y = 0;
    tripods[1].position.set(G.pieces[1].x, 0, 0);
    fall=Object.assign(mkFallState(G.pieces[1]), {idx:1});`);
  // Ten seconds at 60fps: over the edge, down, along the floor, and the beat before it is tucked
  // away. Tilt is how far off upright the piece is; clearance, how far its lowest point is above
  // the floor.
  g.read(`window.__tilt=[]; window.__clear=[]; window.__radius=[]; window.__up=new THREE.Vector3(0,1,0);
    for(let i=0;i<600 && fall.active;i++){ stepFall(1/60);
      window.__radius.push(Math.hypot(tripods[1].position.x, tripods[1].position.z));
      window.__tilt.push(Math.acos(Math.max(-1,Math.min(1,
        window.__up.clone().applyQuaternion(tripods[1].quaternion).y)))*180/Math.PI);
      window.__clear.push(tripods[1].position.y + fallLowestBelowOrigin(tripods[1]) - fallFloorY()); }`);
  const tilt=JSON.parse(g.read('JSON.stringify(window.__tilt)'));
  const clear=JSON.parse(g.read('JSON.stringify(window.__clear)'));
  // It starts upright and standing ON the board, and goes over because the board runs out under it.
  assert.ok(tilt[0]<6,'it starts upright, standing');
  const firstHit=clear.findIndex(c=>c<=0.05);
  assert.ok(firstHit>10,'it takes a moment to reach the floor: it tips, then falls');
  g.read(`window.__hitR = window.__radius[${firstHit}]`);
  assert.ok(tilt[firstHit]>45,`it is already going over by the time it lands (tilt ${tilt[firstHit]|0} deg)`);
  assert.ok(Math.max(...tilt)>90,'and it goes past on its side rather than landing on its feet');
  // It rests ON the floor -- its lowest surface point, not its origin, which is rotated away.
  const floor=g.read('fallFloorY()'), lowest=g.read('tripods[1].position.y + fallLowestBelowOrigin(tripods[1])');
  assert.ok(Math.abs(lowest-floor)<0.1,`its lowest point rests on the floor (${lowest.toFixed(2)} vs ${floor})`);
  // Standing on its pins the origin sits exactly ON the floor (the pin tips are its y=0), so this
  // is "not sunk into it", not "strictly above it".
  assert.ok(g.read('tripods[1].position.y')>=floor-0.05,'the piece sits on that floor rather than half through it');
  assert.ok(floor>-60,'the drop is short enough that the loss camera stays in close');
  // It carries on after it lands rather than stopping dead where it first touched. It does not
  // necessarily HOP: a tripod comes down on a leg, off its centre, so most of the blow goes into
  // turning it rather than bouncing it -- it cartwheels along the ground, which is the thing a
  // scripted "bounce then slide" never did.
  assert.ok(g.read('fall.bounces')>=3,'a tumbling piece strikes the ground more than once');
  const afterHit=tilt.slice(firstHit);
  assert.ok(Math.max(...afterHit)-Math.min(...afterHit)>25,'and it keeps turning over after it lands');
  const travel=g.read(`Math.hypot(tripods[1].position.x, tripods[1].position.z)`) - g.read('window.__hitR');
  assert.ok(travel>8,`it travels on across the floor after landing (${travel.toFixed(1)} units)`);
  // The ear gets the strikes, but not one per contact: a clatter is not a rattle.
  const thumps=JSON.parse(g.read('JSON.stringify(window.__thumps)'));
  assert.ok(thumps.length>=2,'the landing is heard');
  assert.ok(thumps.length<=g.read('fall.bounces'),'but never more often than it actually hits');
  assert.ok(Math.max(...thumps)>0.5,'the hardest strike is a real thump, not a tap');
  assert.equal(g.read('fall.active'),false,'the animation stops once it has stopped moving');
  assert.equal(g.read('fallenIdx'),1,'and the render loop leaves it where it fell');
  assert.equal(g.read('tripods[1].visible'),true,'the fallen piece stays on the ground to see');
  const rest=JSON.parse(g.read('JSON.stringify([tripods[1].position.x,tripods[1].position.z])'));
  assert.ok(Math.hypot(rest[0],rest[1])>g.read('CFG.edgeU'),'it comes to rest off the board, past the rim it went over');
  // And nothing of it is inside anything else. The body is a chain of spheres down the centreline
  // of each leg; sampled coarsely, legs slipped through the board between samples.
  const inBoard=g.read(`(() => {
    const t=tripods[1], R=CFG.edgeU; let worst=0;
    const origin=new THREE.Vector3().copy(fall.X)
      .sub(new THREE.Vector3().copy(FALL_BODY.com).applyQuaternion(t.quaternion));
    for (const hh of FALL_HULL_LOCAL) {
      const p=new THREE.Vector3().copy(hh.p).applyQuaternion(t.quaternion).add(origin);
      const rho=Math.hypot(p.x,p.z);
      // how far this sphere is inside the board's solid: the top face over the disc, the rim
      // circle outside it. Positive means the leg is in the wood.
      const d = rho<=R ? (hh.r - p.y) : (hh.r - Math.hypot(p.x-p.x*R/rho, p.y, p.z-p.z*R/rho));
      if (p.y > -8 && d > worst) worst = d;
    }
    return worst;
  })()`);
  assert.ok(inBoard<0.35,`no leg is left inside the board (deepest ${inBoard.toFixed(2)})`);
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

// ---- The Steam desktop build's Google sign-in ---------------------------------------------
// Electron has no https origin for Google to return to, so the wrapper opens the system browser
// and catches the return trip on a loopback server (native/steam/loopback-auth.js). These stub
// that bridge, plus the two Supabase clients the flow uses, and check the renderer half.
const flush = async (n=30) => { for (let i=0;i<n;i++) await new Promise(r=>setImmediate(r)); };
// A Steam build with the loopback bridge, a throwaway PKCE client and a stub of the real client.
const steamAuth = (g, opts={}) => g.read(`
  window.__bridge={begins:0,handed:[],reply:${JSON.stringify(opts.reply||{code:'CODE_FROM_GOOGLE'})}};
  window.tauSteam={status:()=>Promise.resolve({available:false}),
    googleAuthBegin:()=>{window.__bridge.begins++;
      return Promise.resolve({port:8765,redirectUri:'http://127.0.0.1:8765/',state:'STATE-abc'});},
    googleSignIn:(url,state)=>{window.__bridge.handed.push([url,state]);
      return Promise.resolve(window.__bridge.reply);}};
  window.__tmp={options:null,oauth:[],link:[],adopted:[],exchanged:[]};
  window.supabase={createClient:(url,key,options)=>{window.__tmp.options=options;return {auth:{
    signInWithOAuth:o=>{window.__tmp.oauth.push(o);
      return Promise.resolve({data:{url:'https://tau.supabase.co/auth/v1/authorize?provider=google'},error:null});},
    linkIdentity:o=>{window.__tmp.link.push(o);
      return Promise.resolve({data:{url:'https://tau.supabase.co/auth/v1/authorize?link=1'},error:null});},
    setSession:s=>{window.__tmp.adopted.push(s);return Promise.resolve({error:null});},
    exchangeCodeForSession:c=>{window.__tmp.exchanged.push(c);
      return Promise.resolve({data:{session:{access_token:'REAL_AT',refresh_token:'REAL_RT'}},error:null});},
  }};}};
  window.__real={sessions:[]};
  sb={auth:{
    getSession:()=>Promise.resolve({data:{session:{access_token:'GUEST_AT',refresh_token:'GUEST_RT'}}}),
    setSession:s=>{window.__real.sessions.push(s);return Promise.resolve({error:null});}}};
  sbUser=${opts.guest ? "{id:'guest',is_anonymous:true}" : 'null'};
  localStorage.removeItem(AUTH_PERSIST_FLAG);`);

test('the Steam desktop build leads with Continue with Google, like the web', async t=>{
  const g=await game();t.after(g.close);
  steamAuth(g);
  assert.equal(g.read('isSteamApp()'),true);
  g.read('openAcctPanel()');
  assert.notEqual(g.read("document.getElementById('acctGoogle').style.display"),'none',
    'the loopback flow works here, so the button is shown, not hidden');
  assert.equal(g.read("document.getElementById('acctMagic').style.display"),'none',
    'a magic link would open in the system browser and sign THAT in, so it stays hidden');
  assert.notEqual(g.read("document.getElementById('acctMoreOptions').style.display"),'none',
    'username & password is still there for anyone who wants it');
  assert.equal(g.read("document.getElementById('acctMsg').textContent"),'',
    'and nothing apologises for a missing Google button any more');
  assert.deepEqual(g.errors,[]);
});

test('clicking Continue with Google on Steam goes out through the loopback bridge', async t=>{
  const g=await game();t.after(g.close);
  steamAuth(g);
  const where=g.read('location.href');
  g.read('openAcctPanel()');
  g.$('acctGoogle').click();
  await flush();
  assert.equal(g.read('location.href'),where,'the game window itself never navigates to Google');
  assert.equal(g.read('window.__bridge.begins'),1,'the wrapper reserves the loopback port first');
  assert.equal(g.read('window.__tmp.options.auth.flowType'),'pkce',
    'the code is only redeemable on a PKCE client, so the exchange gets its own');
  assert.equal(g.read('window.__tmp.options.auth.persistSession'),false,
    'and that throwaway client never touches the stored session');
  assert.equal(g.read('window.__tmp.options.auth.detectSessionInUrl'),false);
  assert.equal(g.read("JSON.stringify(window.__tmp.oauth[0].options)"),
    JSON.stringify({redirectTo:'http://127.0.0.1:8765/',skipBrowserRedirect:true}),
    'Supabase builds the URL for the loopback address but must NOT navigate to it itself');
  assert.equal(g.read('JSON.stringify(window.__bridge.handed[0])'),
    JSON.stringify(['https://tau.supabase.co/auth/v1/authorize?provider=google','STATE-abc']),
    'the URL Supabase returned is what the browser is sent to, with the state the wrapper minted');
  assert.equal(g.read('window.__tmp.exchanged[0]'),'CODE_FROM_GOOGLE','the returned code is exchanged');
  assert.equal(g.read('JSON.stringify(window.__real.sessions)'),
    JSON.stringify([{access_token:'REAL_AT',refresh_token:'REAL_RT'}]),
    'and the finished session is handed to the client the rest of the game reads');
  assert.equal(g.read(`localStorage.getItem(AUTH_PERSIST_FLAG)`),'1','a real account, so it persists');
  assert.equal(g.read("document.getElementById('acctMsg').textContent"),'','nothing left over on success');
  assert.deepEqual(g.errors,[]);
});

test('a guest signing in on Steam is LINKED, so the rating comes with them', async t=>{
  const g=await game();t.after(g.close);
  steamAuth(g,{guest:true});
  g.read('openAcctPanel()');
  g.$('acctGoogle').click();
  await flush();
  assert.equal(g.read('window.__tmp.oauth.length'),0,'never a fresh, unrelated account');
  assert.equal(g.read("JSON.stringify(window.__tmp.link[0])"),
    JSON.stringify({provider:'google',options:{redirectTo:'http://127.0.0.1:8765/',skipBrowserRedirect:true}}));
  assert.equal(g.read("JSON.stringify(window.__tmp.adopted[0])"),
    JSON.stringify({access_token:'GUEST_AT',refresh_token:'GUEST_RT'}),
    'linkIdentity signs with the guest JWT, so the throwaway client has to be holding it');
  assert.equal(g.read('JSON.stringify(window.__real.sessions)'),
    JSON.stringify([{access_token:'REAL_AT',refresh_token:'REAL_RT'}]));
  assert.deepEqual(g.errors,[]);
});

test('walking away from the Google tab leaves the Steam panel exactly as it was', async t=>{
  const g=await game();t.after(g.close);
  steamAuth(g,{reply:{cancelled:true}});
  g.read('openAcctPanel()');
  g.$('acctGoogle').click();
  await flush();
  assert.equal(g.read("document.getElementById('acctMsg').textContent"),'',
    'a cancel or a timeout is not an error worth shouting about');
  assert.equal(g.read(`localStorage.getItem(AUTH_PERSIST_FLAG)`),null,
    'and nothing was signed in, so the persist flag goes back');
  assert.equal(g.read('JSON.stringify(window.__real.sessions)'),'[]');
  assert.equal(g.read("document.getElementById('acctGoogle').disabled"),false,'the button still works');
  assert.equal(g.read("document.getElementById('acctPanel').style.display"),'flex');
  g.$('acctGoogle').click();
  await flush();
  assert.equal(g.read('window.__bridge.begins'),2,'a second try starts a second flow');
  assert.deepEqual(g.errors,[]);
});

test('a real failure says what went wrong and keeps username & password reachable', async t=>{
  const g=await game();t.after(g.close);
  steamAuth(g,{reply:{error:'Provider is down'}});
  g.read('openAcctPanel()');
  g.$('acctGoogle').click();
  await flush();
  assert.equal(g.read("document.getElementById('acctMsg').textContent"),'Provider is down');
  assert.equal(g.read(`localStorage.getItem(AUTH_PERSIST_FLAG)`),null);
  assert.equal(g.read("document.getElementById('acctEmailOptions').style.display"),'block',
    'the working path is opened up rather than left hidden behind a disclosure');
  assert.deepEqual(g.errors,[]);
});

test('the Capacitor app ignores the desktop loopback path entirely', async t=>{
  const g=await game('',{},{capacitor:true});t.after(g.close);
  // No window.tauSteam in the phone app: the button stays hidden and the click falls through to
  // the app's own message, never to the wrapper's bridge.
  g.read(`TAU_GOOGLE_NATIVE_CLIENT_ID=''; sb={auth:{}};`);
  assert.equal(g.read('isSteamApp()'),false);
  g.read('openAcctPanel()');
  assert.equal(g.read("document.getElementById('acctGoogle').style.display"),'none');
  g.$('acctGoogle').click();
  await flush();
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

// ---- "Choose your controls": the screen a local 1v1 opens with ----
const pad = (id,index)=>({id,index,connected:true,mapping:'standard',axes:[0,0,0,0],
  buttons:Array.from({length:17},()=>({pressed:false,value:0}))});
// A press and its release, both seen by the poll: the pick screen and the match both work off
// per-pad button EDGES, so a button that never comes up again fires once and no more.
const press=(g,p,i)=>{p.buttons[i].pressed=true;g.tick();p.buttons[i].pressed=false;g.tick();};
const seat=(g,i)=>g.w.document.querySelector(`.desktop-pick-seat[data-seat="${i}"]`);
const seatDevice=(g,i)=>seat(g,i).querySelector('.desktop-pick-device-name').textContent;
const seatPrompt=(g,i)=>seat(g,i).querySelector('.desktop-pick-prompt').textContent;

test('a local 1v1 asks who is on what before it starts',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopOnline').click();g.tick();   // the menu's 1v1 hub, the web app's own
  [...g.$('modalBtns').children].find(b=>b.textContent==='Local 1v1').click();g.tick();
  assert.notEqual(g.read("document.getElementById('game').style.display"),'flex','no board until they have chosen');
  const screen=g.w.document.querySelector('.desktop-pick');
  assert.ok(screen,'the pick screen is up instead');
  assert.deepEqual([...screen.querySelectorAll('.desktop-pick-colour')].map(e=>e.textContent),['Blue','Red'],
    'Blue on the left, Red on the right');
  assert.equal(screen.querySelectorAll('.desktop-pick-tripod').length,2,'each side shows its piece');
  assert.equal(screen.querySelectorAll('.desktop-pick-blank').length,2,'with both device slots still empty');
  assert.match(seatPrompt(g,0),/^Blue: press any button on your controller, or a key \/ click$/);
  assert.equal(seatPrompt(g,1),'','Red is asked after Blue, not at the same time');
  g.$('desktopPickSkip').click();g.tick();
  assert.equal(g.read("document.getElementById('game').style.display"),'flex','skipping is pass and play');
  assert.equal(g.w.document.querySelector('.desktop-pick'),null);
  assert.equal(g.read("tauDesktop.seatBlocks('kbm')"),false,'one device between them gates nothing');
  assert.deepEqual(g.errors,[]);
});

test('a pad each: the screen names both makes, and then only the seated pad may move',async t=>{
  const g=await game();t.after(g.close);
  const blue=pad('Xbox 360 Controller',0), red=pad('Sony DualSense Wireless Controller',1);
  g.w.navigator.getGamepads=()=>[blue,red];
  g.read('tauDesktop.startMatch(true)');g.tick();
  press(g,blue,3);
  assert.equal(seatDevice(g,0),'Xbox','any button offers that pad, drawn as its own make');
  assert.equal(seatPrompt(g,0),'Press A to confirm','named the way that make prints it');
  press(g,blue,0);
  assert.equal(seatDevice(g,0),'Xbox','Blue keeps the pad it confirmed');
  assert.match(seatPrompt(g,1),/^Red: press any button/,'and it is Red\'s turn to choose');
  press(g,red,12);
  assert.equal(seatDevice(g,1),'PlayStation');
  assert.equal(seatPrompt(g,1),'Press ✕ to confirm');
  assert.equal(g.w.document.querySelector('.desktop-pick-same').hidden,true,'two different pads is not pass and play');
  press(g,red,0);
  assert.equal(g.w.document.querySelector('.desktop-pick'),null,'confirming Red starts the match');
  assert.equal(g.read("document.getElementById('game').style.display"),'flex');
  // Blue to move: only the pad seated to Blue moves the piece, and the keyboard is nobody's here.
  const foot=()=>g.read('v3HoverIdx');
  assert.equal(g.read('G.active'),0);
  press(g,red,15); assert.equal(foot(),0,"the pad seated to Red is ignored on Blue's turn");
  press(g,blue,15); assert.equal(foot(),1,'the pad seated to Blue picks the foot');
  assert.equal(g.read("tauDesktop.seatBlocks('kbm')"),true,'the keyboard is not Blue either');
  assert.equal(g.read("tauDesktop.inputDevice='kbm', inputBlocked()"),true,"index.html's one gate turns it away");
  assert.ok(!g.read("tauDesktop.inputDevice='pad', inputBlocked()"),'the acting pad goes through it');
  g.read("tauDesktop.inputDevice='kbm'");
  // The match menu still answers to EVERY pad: neither player has to be handed the other's.
  press(g,red,9);
  assert.equal(g.$('modalTitle').textContent,'Match menu');
  g.$('modalBtns').firstElementChild.click();g.tick();
  // A pad that unplugs mid-match must not strand its player: the gate comes off entirely.
  g.w.navigator.getGamepads=()=>[red];g.tick();
  assert.equal(g.read("tauDesktop.seatBlocks('kbm')"),false,'with a seated pad gone, nothing is gated');
  press(g,red,15); assert.equal(foot(),2,'and the pad still plugged in plays both colours');
  assert.deepEqual(g.errors,[]);
});

test('the keyboard and mouse is a device too, and the same one twice is pass and play',async t=>{
  const g=await game();t.after(g.close);
  g.w.navigator.getGamepads=()=>[pad('Xbox 360 Controller',0)];   // plugged in, and still not chosen
  g.read('tauDesktop.startMatch(true)');g.tick();
  g.key('k');
  assert.equal(seatDevice(g,0),'Keyboard & mouse','a key offers the keyboard and mouse');
  assert.equal(seatPrompt(g,0),'Click or press Enter to confirm');
  g.key('Enter');
  assert.equal(seatDevice(g,0),'Keyboard & mouse','Blue is on the keyboard');
  assert.match(seatPrompt(g,1),/^Red: press any button/);
  const click=()=>{g.w.document.querySelector('.desktop-pick')
    .dispatchEvent(new g.w.MouseEvent('click',{bubbles:true}));g.tick();};
  click();
  assert.equal(seatDevice(g,1),'Keyboard & mouse','a click offers it as well');
  assert.equal(g.w.document.querySelector('.desktop-pick-same').hidden,false,'and the screen says what that means');
  click();
  assert.equal(g.read("document.getElementById('game').style.display"),'flex','the match starts');
  assert.equal(g.read("tauDesktop.seatBlocks('kbm')"),false,'one device between them gates nothing');
  assert.equal(g.read("tauDesktop.seatBlocks('pad')"),false);
  assert.ok(!g.read('inputBlocked()'),'so the keyboard plays both colours, turn about');
  g.key('1');g.key('ArrowRight');g.key('ArrowRight','keyup');g.key('Enter');g.tick();
  assert.equal(g.read('G.active'),1,'pass and play: the same keyboard takes the next turn');
  assert.ok(!g.read('inputBlocked()'));
  assert.deepEqual(g.errors,[]);
});

test('the pick screen steps back one stage at a time, then cancels to the menu',async t=>{
  const g=await game();t.after(g.close);
  const p=pad('Xbox 360 Controller',0);
  g.w.navigator.getGamepads=()=>[p];
  g.read('tauDesktop.startMatch(true)');g.tick();
  press(g,p,2);press(g,p,0);
  assert.match(seatPrompt(g,1),/^Red: press any button/,'Blue is settled, Red is choosing');
  press(g,p,1);   // B on a pad is the way back everywhere else, and here too
  assert.equal(seatPrompt(g,0),'Press A to confirm','Blue is choosing again, still holding its pad');
  assert.equal(seatPrompt(g,1),'','and Red is waiting again');
  g.key('Escape');g.tick();
  assert.equal(g.w.document.querySelector('.desktop-pick'),null,'a step back from Blue leaves the screen');
  assert.notEqual(g.read("document.getElementById('game').style.display"),'flex','with nothing started');
  assert.deepEqual(g.errors,[]);
});

test('only a local 1v1 asks: the AI and the online entries never see the pick screen',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopPlay').click();g.tick();
  assert.equal(g.w.document.querySelector('.desktop-pick'),null,'a match against the AI has one human');
  assert.equal(g.read("document.getElementById('game').style.display"),'flex');
  assert.equal(g.read("tauDesktop.seatBlocks('kbm')"),false,'and no seats to gate');
  g.read('backToMenu()');g.tick();
  g.$('desktopOnline').click();g.tick();
  [...g.$('modalBtns').children].find(b=>b.textContent==='Online Ranked').click();g.tick();
  assert.equal(g.w.document.querySelector('.desktop-pick'),null,'an online opponent is not in the room');
  assert.deepEqual(g.errors,[]);
});

test('a brand-new player lands on the menu and is offered the rules when they first press play',async t=>{
  // A fresh profile -- what an incognito window gives you. Nothing should open by itself: the
  // how-to used to auto-open at load and read as a flash of rules that closed again.
  const g=await game('?steam=1&premium=1',{},{freshPlayer:true});t.after(g.close);
  assert.equal(g.read("!!document.getElementById('htpFull')"),false,'the rules do not open themselves');
  assert.equal(g.read("document.getElementById('modalBackdrop').style.display"),'','and nothing else is in the way');
  assert.equal(g.read("localStorage.getItem('tauOnboard')"),null,'still marked as new');
  g.$('desktopPlay').click();g.tick();
  assert.equal(g.$('modalTitle').textContent,'New to Tau?','pressing play asks first');
  const labels=[...g.$('modalBtns').children].map(b=>b.textContent);
  assert.deepEqual(labels,['Show me how','Just play']);
  // Skipping starts the game, and the question never comes back.
  labels.indexOf('Just play');
  [...g.$('modalBtns').children].find(b=>b.textContent==='Just play').click();g.tick();
  assert.equal(g.read("document.getElementById('game').style.display"),'flex','it plays the game you asked for');
  assert.ok(g.read("localStorage.getItem('tauOnboard')"),'and remembers it asked');
  g.read('backToMenu()');g.tick();
  g.$('desktopPlay').click();g.tick();
  // The title element keeps whatever it last showed, so ask whether a dialog is actually up.
  assert.equal(g.read("document.getElementById('modalBackdrop').style.display"),'none','it never asks twice');
  assert.equal(g.read("document.getElementById('game').style.display"),'flex','play just starts');
  assert.deepEqual(g.errors,[]);
});

test('a returning player is never offered the rules again',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopPlay').click();g.tick();
  assert.equal(g.read("document.getElementById('game').style.display"),'flex','play starts straight away');
  assert.deepEqual(g.errors,[]);
});

test('a controller the browser has no mapping table for is still a controller',async t=>{
  const g=await game();t.after(g.close);
  // Chromium only reports mapping 'standard' for pads it recognises; a DirectInput pad, an adapter
  // or anything unusual reports ''. Filtering those out made such a pad invisible to everything.
  const odd={id:'4 axis 16 button joystick',index:0,connected:true,mapping:'',
    axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  g.w.navigator.getGamepads=()=>[odd];
  g.$('desktopControls').click();g.tick();
  const seen=()=>g.$('desktopPadSeen').textContent;
  assert.match(seen(),/^Connected:/,'the sheet reports it rather than claiming nothing is plugged in');
  assert.match(seen(),/non-standard mapping/,'and says its buttons may not line up');
  g.$('modalBtns').firstElementChild.click();g.tick();
  // It can drive the game too: start a match and move the chosen foot with the D-pad.
  localMatch(g);
  const press=i=>{odd.buttons[i].pressed=true;g.tick();odd.buttons[i].pressed=false;g.tick();};
  press(15);
  assert.equal(g.read('v3HoverIdx'),1,'a non-standard pad still plays');
  assert.deepEqual(g.errors,[]);
});

test('the loss camera follows the piece down instead of framing the board it left',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(38,1.6,1,4000);
    controls={mouseButtons:{},target:new THREE.Vector3(),update(){}};
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    G.over=true; G.winner=0;
    fall=Object.assign(mkFallState(G.pieces[1]),{idx:1});
    tripods[1].position.set(62,-30,44);
    for(let i=0;i<120;i++) tauDesktop.updateCamera(1/60,true);`);
  const tgt=JSON.parse(g.read('JSON.stringify([controls.target.x,controls.target.y,controls.target.z])'));
  // It used to sit near the board centre at board height while the loser was thirty units below it.
  assert.ok(Math.hypot(tgt[0]-62,tgt[2]-44)<12,'the camera looks where the piece actually is');
  assert.ok(tgt[1]<0,'and follows it below the board');
  assert.deepEqual(g.errors,[]);
});

test('a pad that sends directions on a hat or a stick still drives the menus and picks a foot',async t=>{
  const g=await game();t.after(g.close);
  // A DirectInput pad: empty mapping, no D-pad buttons at all, hat on axis 9, stick on 0/1.
  const pad={id:'Generic USB Joystick',index:0,connected:true,mapping:'',
    axes:[0,0,0,0,0,0,0,0,0,3.28],buttons:Array.from({length:12},()=>({pressed:false,value:0}))};
  g.w.navigator.getGamepads=()=>[pad];
  const hat=(v)=>{pad.axes[9]=v;g.tick();pad.axes[9]=3.28;g.tick();};   // 3.28 is the centre value
  const focus=()=>g.w.document.activeElement && g.w.document.activeElement.id;
  g.tick();
  const first=focus();
  hat(0.142);                                    // down
  assert.notEqual(focus(),first,'a hat step moves the menu focus');
  // And it has to LOOK moved: :focus-visible alone does not fire for a programmatic focus().
  assert.ok(g.w.document.documentElement.classList.contains('desktop-pad-nav'),
    'the menu shows a focus ring while a controller is driving');
  g.w.dispatchEvent(new g.w.Event('pointermove'));
  assert.equal(g.w.document.documentElement.classList.contains('desktop-pad-nav'),false,
    'and the mouse takes it away again');
  const second=focus();
  pad.axes[1]=1;g.tick();pad.axes[1]=0;g.tick();  // left stick down
  assert.notEqual(focus(),second,'and so does the left stick');
  localMatch(g);
  assert.equal(g.read('v3HoverIdx'),0);
  hat(-0.428);                                   // right
  assert.equal(g.read('v3HoverIdx'),1,'the hat changes which foot is chosen, visibly, with no button press');
  pad.axes[0]=-1;g.tick();pad.axes[0]=0;g.tick(); // stick left
  assert.equal(g.read('v3HoverIdx'),0,'and so does the stick');
  assert.deepEqual(g.errors,[]);
});

test('the camera can be moved while the opponent is on the clock',async t=>{
  const g=await game();t.after(g.close);
  g.read('tauDesktop.startMatch()');g.tick();   // vs the AI
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(38,1.6,1,4000);
    camera.position.set(0,150,200);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0),update(){}};
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    vsAI=true; G.active=aiIdx;`);   // their turn: no piece may be touched
  assert.equal(g.read('tauDesktop.canPlayNow()'),false,'no move is allowed');
  const before=g.read('camera.position.x');
  const pad={id:'Xbox',index:0,connected:true,mapping:'standard',axes:[1,0,0,0],
    buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  g.w.navigator.getGamepads=()=>[pad];
  // Drive the input poll straight: the full render loop wants a whole scene, and the camera gate is
  // what this test is about.
  g.read('for(let i=0;i<20;i++) tauDesktop.tick(1/60)');
  assert.notEqual(g.read('camera.position.x'),before,'but the view still answers the stick');
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
  localMatch(g);
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
  localMatch(g);
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
  assert.deepEqual(bottom,['Settings','Controls','Lab']);   // a browser build keeps the developer Lab
  assert.equal(g.$('desktopPlay').textContent,'Play','the gold Play stays');
  for (const sel of ['.desktop-home h2','.desktop-intro','.desktop-material','#desktopInputHint','#desktopLocal'])
    assert.equal(g.w.document.querySelector(sel),null,sel+' is gone');
  // The entries are the web's own buttons behind the premium chrome: 1v1 is the web's hub.
  g.$('desktopOnline').click();g.tick();
  assert.equal(g.$('modalTitle').textContent,'1v1');
  assert.ok([...g.$('modalBtns').children].some(b=>b.textContent==='Local 1v1'),'same-screen play lives inside 1v1, as on the web');
  g.$('modalBtns').lastElementChild.click();g.tick();
  // In a match the line under the board carries state, never the step-by-step coaching.
  localMatch(g);
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

// ---- Ray tracing (Ultra) ----
// JSDOM has no WebGL, so these check the wiring around the tracer, never a traced pixel: that the
// setting persists, that the bundle is fetched once and only on request, that the rest detector
// tells a held frame from a moving one, and that a tracer which cannot start hands the frame back.
const ptStage = `renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{},
    domElement:{width:640,height:480}, coordinateSystem:THREE.WebGLCoordinateSystem, xr:{enabled:false},
    getRenderTarget:()=>null, getActiveCubeFace:()=>0, getActiveMipmapLevel:()=>0, setRenderTarget(){},
    getDrawingBufferSize(v){v.set(640,480);return v;},
    render(){window.__rasterised=(window.__rasterised||0)+1;}};
  scene=new THREE.Scene(); scene.background=new THREE.Color(0x0c0e11);
  camera=new THREE.PerspectiveCamera(); camera.position.set(0,120,150); camera.updateMatrixWorld();
  scene.add(new THREE.DirectionalLight(0xffffff,1)); scene.add(new THREE.HemisphereLight(0xffffff,0x222222,1));
  controls={mouseButtons:{},target:new THREE.Vector3()};
  boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial()); scene.add(boardTop);
  boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial()); scene.add(boardRim);
  tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)]; tripods.forEach(t=>scene.add(t));
  scene.add(new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial()));
  crossFlashes.length=0;
  hoverDisc=new THREE.Mesh(new THREE.CircleGeometry(3.2),new THREE.MeshBasicMaterial());
  pivotGlowMesh=new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.MeshBasicMaterial());
  hoverDisc.visible=pivotGlowMesh.visible=false; scene.add(hoverDisc,pivotGlowMesh);
  scene.updateMatrixWorld(true);`;

test('ray tracing is off by default, persists when turned on, and fetches its bundle once',async t=>{
  const g=await game();t.after(g.close);
  const tags=()=>g.w.document.querySelectorAll('script[src="vendor/pathtracer/pathtracer.global.js"]').length;
  g.$('desktopSettings').click();g.tick();
  // It lives in the Graphics picker, where someone looking for a graphics setting will find it --
  // a checkbox further down the sheet went unnoticed.
  const sel=g.$('desktopQuality');
  assert.ok([...sel.options].some(o=>o.value==='ultra'),'Graphics offers Ultra');
  assert.notEqual(sel.value,'ultra','not the default');
  assert.equal(tags(),0,'and nothing is downloaded for a player who never asks');
  assert.equal(JSON.parse(g.w.localStorage.getItem('tauDesktopSettingsV1')).rayTrace,false);
  const pick=v=>{sel.value=v;sel.dispatchEvent(new g.w.Event('change'));};
  pick('ultra');
  assert.equal(JSON.parse(g.w.localStorage.getItem('tauDesktopSettingsV1')).rayTrace,true,'the choice is saved');
  assert.equal(tags(),1,'asking for it injects the bundle');
  assert.equal(g.read('tauDesktop.rayTraceStatus()'),'loading');
  assert.match(g.$('desktopQualityNote').textContent,/Ray tracing/,'and it says what it is doing');
  pick('high');
  assert.equal(g.$('desktopQualityNote').textContent,'','which it stops saying when it is off');
  pick('ultra');
  assert.equal(tags(),1,'and turning it off and on again does not fetch it a second time');
  assert.deepEqual(g.errors,[]);
});

test('the rest detector tells a held frame from a moving one',async t=>{
  const g=await game();t.after(g.close);
  const held={camera:[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,120,150,1], proj:[1,0,0,0], size:'640x480',
    pieces:[[1,0,0,0],[0,1,0,0]], board:'walnut', rev:0, fall:false, ai:false, replay:false,
    pinned:null, netRad:0, lift:0, modal:false, hidden:false};
  const motion=patch=>g.read(`tauDesktop.rayTraceMotion(${JSON.stringify(held)},${JSON.stringify({...held,...patch})})`);
  assert.equal(motion({}),'still','the same frame twice is at rest');
  assert.equal(motion({camera:[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,120,151,1]}),'moving','the camera moved');
  assert.equal(motion({pieces:[[1,0,0,0],[0,1,0,1]]}),'moving','a piece moved');
  assert.equal(motion({fall:true}),'moving','a piece is going over');
  assert.equal(motion({board:'noir'}),'moving','a different board');
  assert.equal(motion({size:'800x600'}),'moving','the window was resized');
  assert.equal(motion({lift:2.1}),'moving','the stands are jumping');
  // Sub-quantum camera drift is what OrbitControls' damping leaves behind for whole seconds after
  // a drag; it has to read as at rest or the tracer would never once get to start.
  assert.equal(motion({camera:[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,120,150.00002,1]}),'still');
  assert.deepEqual(g.errors,[]);
});

test('a path tracer that cannot start on this GPU hands the frame back to the rasteriser',async t=>{
  const g=await game();t.after(g.close);
  g.read(ptStage);
  g.read(`window.TAU_PT={WebGLPathTracer:function(){throw new Error('no float blending');}};
    tauDesktop.rayTrace=true;`);
  assert.equal(g.read('tauDesktop.rayTraceStatus()'),'ready','the bundle was already there, so no fetch');
  assert.equal(g.read('tauDesktop.renderFrame()'),false,'the first frame is always rasterised');
  assert.equal(g.read('tauDesktop.renderFrame()'),false);
  assert.equal(g.read('tauDesktop.renderFrame()'),false,'the frame the tracer would have taken');
  assert.equal(g.read('tauDesktop.rayTraceStatus()'),'failed');
  assert.equal(g.read('tauDesktop.rayTrace'),false,'and the setting is unchecked for the session');
  assert.equal(JSON.parse(g.w.localStorage.getItem('tauDesktopSettingsV1')).rayTrace,true,
    'but kept on disk: another machine may run it');
  assert.match(g.$('desktopUnlockToast').textContent,/could not start on this GPU/);
  assert.equal(g.read('tauDesktop.renderFrame()'),false,'every later frame is the ordinary render');
  // Asked for again in the same session it says so again rather than going quiet.
  g.$('desktopUnlockToast').textContent='';
  g.read('tauDesktop.rayTrace=true');
  assert.equal(g.read('tauDesktop.rayTrace'),false);
  assert.match(g.$('desktopUnlockToast').textContent,/could not start on this GPU/);
  assert.deepEqual(g.errors,[]);
});

test('at rest the traced scene is built from the board and the pieces, and motion drops it',async t=>{
  const g=await game();t.after(g.close);
  g.read(ptStage);
  g.read(`window.__pt=null;
    window.TAU_PT={WebGLPathTracer:class{
      constructor(){ this.samples=0; this.tiles={set(){}}; this.calls=[]; window.__pt=this; }
      setScene(s,c){ this.calls.push('setScene'); this.scene=s; this.camera=c; }
      updateCamera(){ this.calls.push('updateCamera'); }
      renderSample(){ this.calls.push('renderSample'); this.samples++; }
    }};
    tauDesktop.rayTrace=true;`);
  assert.equal(g.read('tauDesktop.renderFrame()'),false);
  assert.equal(g.read('tauDesktop.renderFrame()'),false);
  assert.equal(g.read('tauDesktop.renderFrame()'),true,'held still, the tracer takes the frame');
  assert.equal(g.read('JSON.stringify(window.__pt.calls)'),JSON.stringify(['setScene','renderSample']));
  assert.equal(g.read('window.__pt.scene.children.includes(boardTop) && window.__pt.scene.children.includes(boardRim)'),true);
  assert.equal(g.read('tripods.every(t=>window.__pt.scene.children.includes(t))'),true,'both pieces are in it');
  assert.equal(g.read('window.__pt.scene.children.some(o=>o.isPoints)'),false,'dust and motes are not');
  assert.equal(g.read('window.__pt.scene.children.includes(hoverDisc) || window.__pt.scene.children.includes(pivotGlowMesh)'),
    false,'nor the glow and hover planes');
  assert.equal(g.read('window.__pt.scene.children.filter(o=>o.isLight).length'),1,'the directional key only');
  assert.equal(g.read('tripods.every(t=>t.parent===scene)'),true,'and the pieces still belong to the live scene');
  assert.equal(g.read('!!(window.__pt.scene.environment && window.__pt.scene.environment.isCubeTexture)'),true,
    'lit by the room, rendered into a cube map the tracer can read');
  // The same world from a new viewpoint costs no BVH work.
  g.read('camera.position.set(0,130,150); camera.updateMatrixWorld();');
  assert.equal(g.read('tauDesktop.renderFrame()'),false,'the camera moved: back to the rasteriser');
  g.read('tauDesktop.renderFrame(); tauDesktop.renderFrame();');
  assert.equal(g.read('JSON.stringify(window.__pt.calls.slice(2))'),JSON.stringify(['updateCamera','renderSample']));
  // A piece moving is a new world.
  g.read('tripods[0].position.set(10,0,0); scene.updateMatrixWorld(true);');
  g.read('tauDesktop.renderFrame(); tauDesktop.renderFrame(); tauDesktop.renderFrame();');
  assert.equal(g.read('window.__pt.calls.filter(c=>c==="setScene").length'),2,'the traced scene is rebuilt');
  // The board's live cues are not in the traced scene, so while one is up the rasteriser keeps it.
  g.read('pivotGlowMesh.visible=true;');
  assert.equal(g.read('tauDesktop.renderFrame()'),false,'a glowing pinned foot is a board in play');
  g.read('pivotGlowMesh.visible=false; tauDesktop.renderFrame(); tauDesktop.renderFrame();');
  assert.equal(g.read('tauDesktop.renderFrame()'),true,'and the trace comes back when it goes');
  // The hover highlight is the exception: the mouse sits over the board all game, so dropping the
  // trace for it flipped the picture between two looks every time the cursor crossed the rim. The
  // trace is kept and the disc is painted over it.
  g.read('window.__rasterised=0; hoverDisc.visible=true;');
  assert.equal(g.read('tauDesktop.renderFrame()'),true,'the cursor resting on the board keeps the traced frame');
  assert.equal(g.read('window.__rasterised'),1,'and the hover disc is drawn over it');
  assert.equal(g.read('tauDesktop.rayTraceOverlay().children.length===1 && tauDesktop.rayTraceOverlay().children[0]===hoverDisc'),true,
    'that overlay is the hover disc alone, not the whole board again');
  assert.equal(g.read('hoverDisc.parent===scene'),true,'which still belongs to the live scene');
  g.read('hoverDisc.visible=false;');
  // The cap: once the image is finished nothing is drawn at all.
  g.read('window.__pt.samples=1e4; window.__pt.calls=[];');
  assert.equal(g.read('tauDesktop.renderFrame()'),true);
  assert.equal(g.read('JSON.stringify(window.__pt.calls)'),'[]','no more GPU work on a finished frame');
  assert.deepEqual(g.errors,[]);
});

test('with ray tracing off the desktop draws its frames exactly as before',async t=>{
  const g=await game();t.after(g.close);
  g.read(ptStage);
  g.read('window.TAU_PT={WebGLPathTracer:function(){throw new Error("must never be constructed");}};');
  for (let i=0;i<5;i++) assert.equal(g.read('tauDesktop.renderFrame()'),false,'the plain render, every frame');
  assert.equal(g.read('tauDesktop.rayTraceStatus()'),'off','the tracer is never even reached');
  assert.equal(g.w.document.querySelectorAll('script[src="vendor/pathtracer/pathtracer.global.js"]').length,0);
  assert.deepEqual(g.errors,[]);
});

// ---- Language: the premium layer speaks whatever the web app speaks ----

test('Settings offers the languages in their own names and applies one straight away',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopSettings').click();g.tick();
  const sel=g.$('desktopLanguage');
  assert.ok(sel,'the Settings sheet has a Language row');
  assert.equal(sel.value,'en','English by default, the same as the web app');
  assert.deepEqual([...sel.options].map(o=>o.value),['en','ja','zh','zht','ko','de','fr','es','pt','ru','vi'],
    'the same list the web #langMenu offers');
  assert.deepEqual([...sel.options].map(o=>o.textContent).slice(0,3),['English','日本語','简体中文'],'each in its own name');
  sel.value='de';sel.dispatchEvent(new g.w.Event('change'));g.tick();
  assert.equal(g.$('modalTitle').textContent,'Einstellungen','the open sheet is rebuilt in the new language');
  assert.equal(g.$('desktopLanguage').value,'de','with the choice still showing');
  assert.equal(g.$('desktopPlay').textContent,'Spielen','and the menu behind it is re-labelled');
  assert.equal(g.$('desktopSettings').textContent,'Einstellungen');
  assert.equal(g.$('desktopLevel').options[3].textContent,'Stufe 4 · Birdseye',
    'including the opponent list, built once at load -- the rung is translated, the name is a name');
  assert.equal(g.w.localStorage.getItem('tauLang'),'de','stored under the web app\'s own key');
  assert.deepEqual(g.errors,[]);
});

test('the chosen language reaches the screens built as they open',async t=>{
  const g=await game('?steam=1&premium=1',{tauLang:'ja'});t.after(g.close);
  assert.equal(g.$('desktopPlay').textContent,'プレイ','a stored language is there from the first paint');
  assert.deepEqual([...g.w.document.querySelectorAll('.desktop-links button')].map(b=>b.textContent),
    ['1v1','観戦','遊び方','ランキング']);
  g.$('desktopControls').click();g.tick();
  assert.equal(g.$('modalTitle').textContent,'操作方法','the Controls sheet');
  assert.deepEqual([...g.w.document.querySelectorAll('.desktop-controls-head')].map(h=>h.textContent),
    ['キーボードとマウス','コントローラー']);
  assert.match(g.$('modalBody').innerHTML,/ターン終了/,'the key caps wear translated actions');
  assert.match(g.$('desktopPadSeen').textContent,/^コントローラーが検出されていません/,'and the live pad readout');
  g.$('modalBtns').firstElementChild.click();g.tick();
  g.read('tauDesktop.startMatch(true)');g.tick();
  const pick=g.w.document.querySelector('.desktop-pick');
  assert.equal(pick.querySelector('h2').textContent,'操作デバイスを選ぶ','the device-pick screen');
  assert.equal(pick.querySelector('.desktop-pick-colour').textContent,'青');
  assert.match(pick.querySelector('.desktop-pick-prompt').textContent,/^青: /,'its prompt names the colour in the same language');
  assert.equal(g.$('desktopPickSkip').textContent,'スキップ — 交代でプレイ');
  g.$('desktopPickSkip').click();g.tick();
  g.$('desktopPause').click();g.tick();
  assert.equal(g.$('modalTitle').textContent,'対局メニュー','and the pause menu');
  assert.deepEqual(g.errors,[]);
});

test('the language outlives the app, through the key the web app already uses',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopSettings').click();g.tick();
  const sel=g.$('desktopLanguage');sel.value='ja';sel.dispatchEvent(new g.w.Event('change'));g.tick();
  const restarted=await game('?steam=1&premium=1',{tauLang:g.w.localStorage.getItem('tauLang')});
  t.after(restarted.close);
  assert.equal(restarted.read('LANG'),'ja');
  assert.equal(restarted.$('desktopPlay').textContent,'プレイ','a fresh launch comes up in the language that was chosen');
  assert.deepEqual(restarted.errors,[]);
});

test('every string the premium layer translates has a translation',async t=>{
  const src=fs.readFileSync(path.join(root,'desktop/presentation.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  // The tables, straight out of the page: { ja: {...}, zh: {...}, ... }, English being the sources.
  const from=html.indexOf('const I18N = {'), to=html.indexOf('\n};\n',from);
  const I18N=eval(html.slice(from,to+3)+'\nI18N');
  const known=new Set(Object.values(I18N).flatMap(table=>Object.keys(table)));
  // t('…') and tf('…', …) with a literal, plus the two tables of source strings the layer holds
  // and hands to t() by variable (the key bindings' action names, the seat colours).
  const used=new Set();
  for (const m of src.matchAll(/(?<![\w$.])tf?\(\s*'((?:[^'\\]|\\.)*)'/g)) used.add(m[1].replace(/\\(.)/g,'$1'));
  const grab=(block,each)=>{for (const m of src.match(block)[1].matchAll(each)) used.add(m[1]);};
  grab(/const KEY_ACTIONS = \[([\s\S]*?)\n {2}\];/,/\['\w+','([^']+)'\]/g);
  grab(/const SEAT_NAMES = \[([^\]]*)\]/,/'([^']+)'/g);
  const missing=[...used].filter(s=>!known.has(s));
  assert.deepEqual(missing,[],'these premium strings reach t() with no entry in any language table');
  assert.ok(used.size>80,'the premium layer routes its text through t()');
});

// The glass boards (Noir, Marble) break their loser rather than rolling it: one crack, a burst of
// shards that spray along the way it was going and skip on the same floor, then they clear away.
const glassFallSetup = (seed, speed) => `
  renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
  controls={mouseButtons:{},target:new THREE.Vector3()};
  tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
  tripods.forEach(t=>scene.add(t));
  window.__crack=[]; playShatterSound=s=>window.__crack.push(s);
  window.__thump=[]; playLandingSound=s=>window.__thump.push(s);
  let seed=${seed}; Math.random=()=>((seed=(seed*16807)%2147483647)/2147483647);
  fall=Object.assign(mkFallState(G.pieces[1]),
    {idx:1, vy:${speed}, vx:14, vz:3, shatterOk:true});
  tripods[1].position.set(80,26,0);`;

test('a glass piece dropped hard breaks instead of rolling, and the shards clear away',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`setAcoustics('glass','marble');` + glassFallSetup(11,-90));
  g.read('for(let i=0;i<60 && fall.active;i++) stepFall(1/60);');
  assert.equal(g.read("currentAcoustics().piece"),'glass','the marble look plays glass pieces');
  assert.equal(g.read('fall.shattered'),true,'the landing broke it');
  assert.equal(g.read('tripods[1].visible'),false,'the intact piece is gone');
  assert.ok(g.read('shards.length')>10,'and a burst of shards is in its place');
  // There is no body left to simulate, so the fall is over at the break: the shards finish under
  // their own steam and the result is not held back behind an invisible piece still tumbling.
  assert.equal(g.read('fall.active'),false,'the break ends the fall');
  assert.equal(g.read('fallenIdx'),1,'and the piece stays off the board');
  assert.equal(g.read('window.__crack.length'),1,'one crack, not one per frame');
  // A tumbling piece can brush the ground on the way over, so touches before the one that breaks
  // it are fair; what must not happen is the break itself also thumping.
  const thumps=JSON.parse(g.read('JSON.stringify(window.__thump)'));
  assert.ok(thumps.every(v=>v<1),'no landing was reported at full force alongside the break');
  assert.ok(g.read('shards.every(s=>s.m.parent===tripods[1].parent)'),'the shards are in the scene the piece fell in');
  assert.ok(g.read('shards.some(s=>s.vy>0)'),'some of it comes up off the floor');
  // The shards land ON the floor the piece was falling to, and end up spread around where it hit.
  g.read('for(let i=0;i<200;i++) stepShards(1/60);');
  const floor=g.read('fallFloorY()');
  assert.ok(g.read('shards.every(s=>s.m.position.y>=fallFloorY()-0.01)'),'no shard sinks through the floor');
  assert.ok(g.read('Math.max(...shards.map(s=>Math.hypot(s.m.position.x-80,s.m.position.z)))')>6,
    'they scatter rather than piling up on the spot');
  assert.ok(g.read('shards[0].mat.opacity')<0.9,'and they are fading out by then');
  // Given the rest of their life they disappear entirely, leaving nothing on the floor.
  g.read('for(let i=0;i<200;i++) stepShards(1/60);');
  assert.equal(g.read('shards.length'),0,'the glass is gone once it has faded');
  // Only the two tripod groups were ever added to this scene, so a stray mesh in it is a shard
  // that was dropped from the list but never taken out of the world.
  assert.equal(g.read('scene.children.filter(o=>o.isMesh).length'),0,'and nothing is left behind in the scene');
  assert.ok(floor<0,'all of which happened on the floor below the board');
  assert.deepEqual(g.errors,[]);
});

test('a metal piece takes the same landing and rolls, and a gentle glass landing survives',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`setAcoustics('metal','wood');` + glassFallSetup(11,-90));
  g.read('for(let i=0;i<60 && fall.active;i++) stepFall(1/60);');
  assert.equal(g.read('!!fall.shattered'),false,'metal does not break');
  assert.equal(g.read('tripods[1].visible'),true,'it is still there to see');
  assert.equal(g.read('shards.length'),0);
  assert.ok(g.read('window.__thump.length')>0,'it lands with a thump like any other material');
  // Same glass, set down gently: started just above the floor, barely moving and not turning, so
  // nothing it can do on the way down gets near the speed that breaks it. It rolls out instead.
  g.read(`setAcoustics('glass','marble'); clearShards();` + glassFallSetup(11,-2));
  g.read('tripods[1].position.set(80,fallFloorY()+1.2,0); fall.wx=fall.wy=fall.wz=0;');
  g.read('for(let i=0;i<90 && fall.active;i++) stepFall(1/60);');
  assert.equal(g.read('!!fall.shattered'),false,'a soft landing leaves the glass whole');
  assert.equal(g.read('window.__crack.length'),0);
  assert.equal(g.read('tripods[1].visible'),true);
  assert.deepEqual(g.errors,[]);
});

test('the how-to-play tumble never breaks, and a new game puts the broken piece back',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`setAcoustics('glass','marble');` + glassFallSetup(11,-90));
  // The tutorial loops its fall and rebuilds its pieces each pass, so its fall state is not marked
  // as breakable -- only the real match's loser is.
  g.read('fall.shatterOk=false;');
  g.read('for(let i=0;i<60 && fall.active;i++) stepFall(1/60);');
  assert.equal(g.read('!!fall.shattered'),false,'a fall that was not marked breakable stays whole');
  assert.equal(g.read('shards.length'),0);
  // And when the match's own loser does break, the next game brings the piece back rather than
  // starting with one side invisible.
  g.read(`clearShards();` + glassFallSetup(11,-90));
  g.read('for(let i=0;i<60 && fall.active;i++) stepFall(1/60);');
  assert.equal(g.read('tripods[1].visible'),false,'it broke');
  g.read('fallenIdx=-1; fall={active:false}; for(let i=0;i<2;i++){ if(i===fallenIdx) continue; tripods[i].visible=true; }');
  assert.equal(g.read('tripods[1].visible'),true,'a fresh board has both pieces again');
  assert.deepEqual(g.errors,[]);
});

// ---- The walkthrough: a wrong foot rewinds, the pane frames itself, the finale ends ----

test('a guided slide rewinds when you take the foot it did not point at',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLearn').click();g.tick();
  // The corner slide ('double'): guided, so it glows one foot and lays the dots out from it.
  const idx=g.read("HTP_STEPS.findIndex(s=>s.tryKey==='double')");
  g.read(`for (const k of Object.keys(HTP_TRY)) { const st=htpState(k); st.done=true; st.touched=true; }
    htpShowStep(${idx}); const st=htpState('double'); st.done=false;`);
  const pivot=g.read("htpState('double').guide.pivot");
  assert.equal(typeof pivot,'number','the slide points at a foot');
  g.read(`const st=htpState('double'); st.lastT=1; st.pinned=null;`);
  g.read(`htpState('double').p.rot=0.9;`);   // a pose the rewind must undo
  // Now pin the WRONG foot through the same path the pointer uses.
  const wrong=(pivot+1)%3;
  g.read(`(() => { const st=htpState('double'); st.pinned=null; st.pendingPin=${wrong}; st.dragging=false;
    document.getElementById('htpBigCanvas').dispatchEvent(new window.Event('pointerup',{bubbles:true})); })()`);
  const after=JSON.parse(g.read(`JSON.stringify({pinned:htpState('double').pinned,
    rot:+htpState('double').p.rot.toFixed(3), done:htpState('double').done})`));
  assert.equal(after.pinned,null,'the wrong foot is not taken');
  assert.equal(after.rot,+g.read("+HTP_TRY.double.make().p.rot.toFixed(3)"),'and the board is back at the start');
  assert.deepEqual(g.errors,[]);
});

test('the walkthrough pane frames itself instead of inheriting the match layout',async t=>{
  const g=await game('?steam=1&premium=1',{},{width:1280,height:800});t.after(g.close);
  localMatch(g);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{},
      setSize(){}, domElement:document.getElementById('view3d'), render(){}, setRenderTarget(){}};
    camera=new THREE.PerspectiveCamera(42,1.6,1,3000);
    cornerViewOffset={fw:862,fh:800,x:-418,y:0,w:1280,h:800};
    applyCornerViewOffset(camera);`);
  assert.ok(g.read('!!camera.view && camera.view.enabled'),'the match layout shears the frustum into its corner tile');
  // Opening the walkthrough hands the camera to a square pane: it must take its own projection.
  g.read(`const pane=document.createElement('div'); pane.id='htp3DPane'; document.body.appendChild(pane);
    htpEnsure3DInput = () => {};   // the pane's pointer wiring needs a real canvas; not what this checks
    controls = { enabled:true, target:new THREE.Vector3(), mouseButtons:{}, touches:{}, update(){} };
    htp3DEnter(300, 300);`);
  assert.equal(g.read('!!(camera.view && camera.view.enabled)'),false,
    'the pane drops the match offset rather than rendering a slice of the match frustum');
  assert.equal(g.read('+camera.aspect.toFixed(3)'),1,'and frames its own square');
  // And the offset is not handed to anything else that draws with this camera afterwards.
  g.read("document.getElementById('game').style.display='none'; applyCornerViewOffset(camera);");
  assert.equal(g.read('!!(camera.view && camera.view.enabled)'),false,
    'away from that layout the offset is cleared, not left set for the menu demo');
  assert.deepEqual(g.errors,[]);
});

test('the push-off finale ends the walkthrough instead of looping it',async t=>{
  const g=await game();t.after(g.close);
  g.$('desktopLearn').click();g.tick();
  const idx=g.read("HTP_STEPS.findIndex(s=>s.tryKey==='off')");
  g.read(`for (const k of Object.keys(HTP_TRY)) { const st=htpState(k); st.done=true; st.touched=true; }
    htpShowStep(${idx});`);
  // Goal earned, the piece has landed and the beat after it has passed.
  g.read(`htpState('off').done=true; htpPhase='done'; htpPhaseT=2;`);
  g.read('htp3DStep(0.016)');
  assert.equal(g.$('htpFull'),null,'the walkthrough closes when the last goal is met');
  assert.equal(g.w.localStorage.getItem('tauOnboard'),'howto','and the player counts as taught');
  assert.deepEqual(g.errors,[]);
});

test('closing the walkthrough opened from a match gives the board back to the match',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  const before=g.read('JSON.stringify(takeSnap())');
  g.read(`window.__demoStarted=0; const realDemoStart=demoStart; demoStart=()=>{window.__demoStarted++;};`);
  g.$('desktopLearn').click();g.tick();
  assert.ok(g.$('htpFull'),'the walkthrough is up over the live match');
  g.read('stopHowToPlayAnim()');
  assert.equal(g.read("document.getElementById('view3d').parentElement.id"),'views',
    'the 3D board goes back beside the match, not into the menu container');
  assert.equal(g.read('window.__demoStarted'),0,
    'and the ambient demo is NOT restarted on top of a live game (it overwrites the position)');
  assert.equal(g.read('JSON.stringify(takeSnap())'),before,'the match is exactly as it was left');
  assert.deepEqual(g.errors,[]);
});

test('a stone titan is pushed hard enough to actually leave the board',async t=>{
  const g=await game();t.after(g.close);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    localStorage.setItem('tauDesktopTestBoards','1');`);
  g.read("tauDesktop.board='colossus'");
  assert.equal(g.read("currentAcoustics().piece"),'stone','Colossus plays stone titans');
  // Stone grips nearly three times harder than metal. A fixed shove died on it: the titan slid a
  // little and stood there, which is not a loss. The push is sized from the board it has to cross
  // and the friction across it, so it always goes over -- spent, but over.
  const push=g.read(`(() => { G.pieces[1].x = CFG.edgeU - 14; G.pieces[1].y = 0;
    const st = mkFallState(G.pieces[1]); return Math.hypot(st.vx, st.vz); })()`);
  assert.ok(push>50,`a gripping board earns a harder shove (got ${push.toFixed(0)})`);
  g.read(`let seed=3; Math.random=()=>((seed=(seed*16807)%2147483647)/2147483647);
    G.pieces[1].x = CFG.edgeU - 14; G.pieces[1].y = 0;
    tripods[1].position.set(G.pieces[1].x, 0, 0);
    fall=Object.assign(mkFallState(G.pieces[1]),{idx:1});
    for(let i=0;i<900 && fall.active;i++) stepFall(1/60);`);
  const r=g.read('Math.hypot(tripods[1].position.x, tripods[1].position.z)');
  const y=g.read('tripods[1].position.y');
  assert.ok(r>g.read('CFG.edgeU'),`the titan ends up off the board, not standing on it (r ${r.toFixed(0)})`);
  assert.ok(y<-4,`and below it (y ${y.toFixed(1)})`);
  assert.deepEqual(g.errors,[]);
});

test('every board sits at its own height above its floor',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    fallFloor=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU*3),new THREE.MeshStandardMaterial());
    scene.add(fallFloor);
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    localStorage.setItem('tauDesktopTestBoards','1');`);
  const depth = id => { g.read(`tauDesktop.board='${id}'`); return g.read('tauDesktop.fallFloorY()'); };
  const maple = depth('maple'), walnut = depth('walnut'), dark = depth('dark');
  assert.ok(maple > walnut, `Maple is a low bench (${maple}) next to the walnut table (${walnut})`);
  assert.ok(dark < walnut*3, `Dark drops away into the room (${dark})`);
  // A board with no ground of its own keeps the game's black floor -- moved down to meet it, so the
  // piece is not landing on nothing.
  assert.equal(g.read('fallFloor.visible'),true,'the plain boards keep the game floor');
  assert.equal(g.read('fallFloor.position.y'),dark,'and it is moved to this board\'s depth');
  depth('colossus');
  assert.equal(g.read('fallFloor.visible'),false,'a look that brings its own ground hides it');
  assert.deepEqual(g.errors,[]);
});

test('the camera comes round to the piece going over, never watching from behind the board',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{},render(){},
      setRenderTarget(){},getRenderTarget(){return null;}};
    scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(38,1.6,1,2000);
    controls={mouseButtons:{},target:new THREE.Vector3(),update(){},addEventListener(){}};
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    G.winner=0; G.over=true; camManualSet=false;`);
  // Put the camera on one side and drop the loser over the OPPOSITE rim -- the case where the board
  // used to sit squarely between the two.
  const side=JSON.parse(g.read(`(()=>{
    camera.position.set(0,150,200); controls.target.set(0,4,0);
    fall={active:true, idx:1, phase:'air'};
    tripods[1].position.set(0,-30,-95);           // gone over the far rim
    for(let i=0;i<600;i++) tauDesktop.updateCamera(1/60,true);
    const p=tripods[1].position;
    return JSON.stringify({camX:camera.position.x,camZ:camera.position.z,px:p.x,pz:p.z,
      camY:camera.position.y}); })()`));
  // The camera should now stand BEYOND the piece, looking back past it at the board: same side of
  // the middle as the piece, and further out than it.
  assert.ok(side.camZ < 0, `it walked round to the piece's side (camera z ${side.camZ.toFixed(0)}, piece z ${side.pz})`);
  assert.ok(Math.abs(side.camZ) > Math.abs(side.pz),
    'and stands further out than the piece, so the board is behind it, not in front');
  // And it got down off the tabletop to do it.
  const high=JSON.parse(g.read(`(()=>{
    fall={active:true, idx:1, phase:'air'}; tripods[1].position.set(0,0,-95);
    camera.position.set(0,150,200); controls.target.set(0,4,0);
    for(let i=0;i<600;i++) tauDesktop.updateCamera(1/60,true);
    return JSON.stringify({y:camera.position.y}); })()`));
  assert.ok(side.camY < high.y,
    `a piece below the rim is watched from lower down (${side.camY.toFixed(0)} vs ${high.y.toFixed(0)})`);
  assert.deepEqual(g.errors,[]);
});

test('the stick keeps hold of the camera: a nudge is not undone by the lean',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{},render(){},
      setRenderTarget(){},getRenderTarget(){return null;}};
    scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(38,1.6,1,2000);
    camera.position.set(0,150,200);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0),update(){},addEventListener(){}};
    camManualSet=false; camManualPos.set(0,0,0); camManualTgt.set(0,0,0);`);
  // Push the stick for a second, letting the camera settle between nudges the way it does in play.
  const out=JSON.parse(g.read(`(()=>{
    const a0=Math.atan2(camera.position.x-controls.target.x, camera.position.z-controls.target.z);
    for(let i=0;i<60;i++){ tauDesktop.orbitCamera(1,0,1/60); tauDesktop.updateCamera(1/60); }
    const a1=Math.atan2(camera.position.x-controls.target.x, camera.position.z-controls.target.z);
    return JSON.stringify({turned:a1-a0, manual:camManualSet,
      posSet:camManualPos.length()>1, r:camera.position.distanceTo(controls.target)}); })()`));
  assert.ok(Math.abs(out.turned)>0.5,
    `a second of stick actually turns the view (${out.turned.toFixed(2)} rad)`);
  assert.equal(out.manual,true,'the stick claims the camera');
  assert.equal(out.posSet,true,'and records where it put it, which is what the lean eases from');
  assert.ok(out.r>50,'and the camera is not dragged into the middle of the board');
  assert.deepEqual(g.errors,[]);
});

test('a view the player placed leans a fifth of the way towards the game, and no further',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{},render(){},
      setRenderTarget(){},getRenderTarget(){return null;}};
    scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(38,1.6,1,2000);
    controls={mouseButtons:{},target:new THREE.Vector3(),update(){},addEventListener(){}};`);
  // Where the game would put the camera if nobody had touched it.
  const auto=JSON.parse(g.read(`(()=>{ camManualSet=false;
    for(let i=0;i<400;i++) tauDesktop.updateCamera(1/60);
    return JSON.stringify({x:camera.position.x,y:camera.position.y,z:camera.position.z}); })()`));
  // Now the player places it somewhere else entirely and lets it settle.
  const placed={x:auto.x+260,y:auto.y+120,z:auto.z-180};
  const rest=JSON.parse(g.read(`(()=>{
    camManualPos.set(${placed.x},${placed.y},${placed.z}); camManualTgt.set(0,4,0);
    camera.position.copy(camManualPos); controls.target.copy(camManualTgt);
    camManualSet=true; camDragging=false;
    for(let i=0;i<2000;i++) tauDesktop.updateCamera(1/60);
    return JSON.stringify({x:camera.position.x,y:camera.position.y,z:camera.position.z}); })()`));
  // It moved off where it was put -- it is not passive...
  const moved=Math.hypot(rest.x-placed.x,rest.y-placed.y,rest.z-placed.z);
  assert.ok(moved>1,`it leans towards the game (moved ${moved.toFixed(1)})`);
  // ...but it settles a fifth of the way, and stays there however long it runs. A pull that was
  // merely SLOW would have arrived by now: two thousand frames is over half a minute.
  const span=Math.hypot(placed.x-auto.x,placed.y-auto.y,placed.z-auto.z);
  assert.ok(Math.abs(moved/span-0.2)<0.03,
    `a fifth of the distance, not all of it (${(moved/span*100).toFixed(0)}% of ${span.toFixed(0)})`);
  assert.deepEqual(g.errors,[]);
});

test('a win or loss on Steam routes exactly where the web one does',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  // Finish a ladder game as a win, and read the sheet the desktop put up.
  g.read(`ladderLevel=2; humanIdx=0; vsAI=true; rankedMode=false; labActive=false;
    G.over=true; G.winner=0; replayFrames=new Array(40).fill(0);
    document.getElementById('game').style.display='flex';
    renderGameOverSheet();`);
  const labels=()=>JSON.parse(g.read(
    "JSON.stringify([...document.querySelectorAll('#modalBtns button')].map(b=>b.textContent.trim()))"));
  const onSteam=labels();
  assert.equal(g.read("document.getElementById('modalBox').dataset.desktopResult"),'true',
    'the desktop dresses the sheet');
  // The same game over with the desktop layer out of the way is what the web shows.
  g.read("window.__desk=window.tauDesktop; window.tauDesktop=null; renderGameOverSheet();");
  const onWeb=labels();
  g.read("window.tauDesktop=window.__desk;");
  assert.deepEqual(onSteam,onWeb,`Steam offers what the web offers (steam ${onSteam.join('/')} vs web ${onWeb.join('/')})`);
  // Which for a cleared level means the mode's real routing, not a hand-rolled short list.
  assert.ok(onSteam.some(l=>/Red/.test(l)),'including playing the level again as the other colour');
  assert.ok(onSteam.some(l=>/Level/i.test(l)),'and the levels screen');
  assert.ok(onSteam.some(l=>/Share/i.test(l)) && onSteam.some(l=>/Save/i.test(l)),
    'and sharing or saving the replay, which the desktop sheet used to drop');
  assert.deepEqual(g.errors,[]);
});

test('typing lab at the menu opens the brain bench, and nowhere else does',async t=>{
  const g=await game();t.after(g.close);
  const open=()=>g.read("document.getElementById('labOverlay').classList.contains('open')");
  assert.equal(open(),false,'it is not showing to begin with');
  // Three letters at the menu, and the picker is up.
  for (const k of ['l','a','b']) g.key(k);
  assert.equal(open(),true,'typing its name opens it');
  g.read("labCloseDrop()");
  // The letters have to be in order and together: a near miss does nothing.
  for (const k of ['l','b','a','l','x','b']) g.key(k);
  assert.equal(open(),false,'and nothing else does');
  // Not while the caret is in a field -- plenty of ordinary words have "lab" in them.
  g.read(`(()=>{ const i=document.createElement('input'); i.id='labTypeProbe';
    document.body.appendChild(i); i.focus(); })()`);
  for (const k of ['l','a','b']) g.key(k);
  assert.equal(open(),false,'typing into a box is just typing');
  g.read("document.getElementById('labTypeProbe').remove(); document.body.focus && document.body.focus();");
  // And never in the middle of a game.
  g.read("document.body.classList.add('ingame')");
  for (const k of ['l','a','b']) g.key(k);
  assert.equal(open(),false,'a game is not interrupted by it');
  g.read("document.body.classList.remove('ingame')");
  for (const k of ['l','a','b']) g.key(k);
  assert.equal(open(),true,'back at the menu it answers again');
  assert.deepEqual(g.errors,[]);
});

test('on the alien board gravity lets go: the piece falls, hangs, and floats away',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{},
      getRenderTarget(){return null;}, setRenderTarget(){}, render(){}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    tripods.forEach(t=>scene.add(t));
    localStorage.setItem('tauDesktopTestBoards','1');`);
  g.read("tauDesktop.board='alien'");
  // The pull eases off with time in the air: full at the start, gone, then a little past gone.
  const gAt=v=>g.read(`tauDesktop.fallGravity(${v})`);
  assert.equal(gAt(0),1,'it starts out falling like anything else');
  assert.ok(Math.abs(gAt(0.85))<0.02,`and by the time it has fallen its own height there is nothing (${gAt(0.85)})`);
  assert.ok(gAt(3)<0,`after which there is a little less than nothing (${gAt(3)})`);
  assert.equal(g.read('tauDesktop.fallGravity(3)'),g.read('tauDesktop.fallGravity(40)'),'which does not keep growing');
  const arc=JSON.parse(g.read(`(()=>{
    G.winner=0; G.over=true;
    fall=Object.assign(mkFallState(G.pieces[1]),{idx:1, vx:70, vz:0, vy:0});
    tripods[1].position.set(CFG.edgeU-3, 0, 0);
    let low=0, handoff=-1, rise=0;
    for (let i=0;i<2400;i++) {
      if (fall.active) stepFall(1/60); else stepFloatDrift(1/60);
      const y=tripods[1].position.y;
      low=Math.min(low,y);
      if (handoff<0 && !fall.active) handoff=i/60;
      if (handoff>=0) rise=Math.max(rise, y);
      if (!floatDrift && handoff>=0) break;
    }
    return JSON.stringify({low, handoff, rise, drift:!!floatDrift,
      vis:tripods[1].visible, floor:fallFloorY(), y:tripods[1].position.y});
  })()`));
  assert.ok(arc.low < -20, `it really falls first (down to ${arc.low.toFixed(0)})`);
  assert.ok(arc.low > arc.floor, `but never gets to the floor (${arc.low.toFixed(0)} vs ${arc.floor})`);
  assert.ok(arc.handoff > 0.4 && arc.handoff < 4,
    `the match moves on once it has turned round, not before (${arc.handoff.toFixed(2)}s)`);
  assert.ok(arc.rise > 200, `and it keeps going up afterwards (reached ${arc.rise.toFixed(0)})`);
  assert.equal(arc.vis,false,'until it is gone altogether');
  assert.equal(arc.drift,false,'and nothing is left drifting');
  // A new game takes it back.
  g.read('reset()');
  assert.equal(g.read('!!floatDrift'),false,'a new game clears any drift');
  assert.deepEqual(g.errors,[]);
});

test('the marble table stands in a room, so a piece pushed off it really falls',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    tripods.forEach(t=>scene.add(t));
    localStorage.setItem('tauDesktopTestBoards','1');`);
  g.read("tauDesktop.board='marble'");
  const floor=g.read('tauDesktop.fallFloorY()');
  assert.ok(floor<-60,`the floor is the room's, a table's height below the board (got ${floor})`);
  // and the look brings its own ground to land on, so the game's black plane steps aside
  // (the harness never builds that plane, so its absence is the same answer)
  assert.equal(g.read('!!(fallFloor && fallFloor.visible)'),false,"the look's own floor replaces the game's");
  assert.ok(g.read(`(()=>{let lo=0; scene.traverse(o=>{ if(o.isMesh && o.position.y<lo) lo=o.position.y; }); return lo;})()`)<=floor,
    'there is something down there to land on');
  // a piece dropped off the rim reaches it and stops there rather than falling through
  g.read(`setAcoustics('stone','marble');
    fall=Object.assign(mkFallState(G.pieces[1]),{idx:1, vy:0, vx:16, vz:0});
    tripods[1].position.set(CFG.edgeU+2, 4, 0);`);
  g.read('for(let i=0;i<1400 && fall.active;i++) stepFall(1/120);');
  const rest=g.read('tripods[1].position.y');
  assert.ok(rest<floor+40 && rest>floor,`it comes to rest on that floor (got ${rest}, floor ${floor})`);
  assert.ok(g.read('fall.bounces')>0,'having actually struck it');
  assert.deepEqual(g.errors,[]);
});

test('the glass second pass is only paid where the two pieces actually cross',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(38, 16/9, 1, 4000);
    camera.position.set(0,70,150); camera.lookAt(0,6,0);
    camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    tripods.forEach(t=>scene.add(t));`);
  // Side by side across the line of sight: neither has any of the other behind it, so the second
  // render would paint exactly the same picture the ordinary one does -- and cost a whole frame.
  g.read('tripods[0].position.set(-45,0,0); tripods[1].position.set(45,0,0);');
  assert.equal(g.read('tauDesktop.glassOverlap(tripods[0],tripods[1])'),false,
    'apart on screen, there is nothing to look through');
  // One behind the other down the line of sight: this is the crossing the pass exists for.
  g.read('tripods[0].position.set(0,0,-14); tripods[1].position.set(0,0,14);');
  assert.equal(g.read('tauDesktop.glassOverlap(tripods[0],tripods[1])'),true,
    'one behind the other, the pass has real work to do');
  assert.deepEqual(g.errors,[]);
});

test('a titan lands on the Colossus plinth and rolls off it, instead of sinking into the stone',async t=>{
  const g=await game();t.after(g.close);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    localStorage.setItem('tauDesktopTestBoards','1');`);
  g.read("tauDesktop.board='colossus'");
  // The pitch stands on a stone plinth a little WIDER than the board, so the ground is asked per
  // position: the plinth's face over the plinth, its sloped flank at the edge, the sand beyond.
  // Told the sand was the ground everywhere, a titan fell straight through the stone and rested
  // fifteen units inside it.
  const top=g.read('fallFloorY(0,0)'), rim=g.read('fallFloorY(CFG.edgeU, 0)');
  const sand=g.read('fallFloorY(CFG.edgeU*2, 0)'), look=g.read('tauDesktop.fallFloorY()');
  assert.ok(top>-10,`over the plinth the ground is the plinth's face, not the sand (got ${top})`);
  assert.equal(rim,top,'and it is still the face right out at the board rim');
  assert.equal(sand,-20,'well clear of the plinth it is the arena sand');
  assert.equal(look,-20,'asked with no position the look still names its ground level');
  const flank=g.read('fallFloorY(CFG.edgeU*1.12, 0)');
  assert.ok(flank<top && flank>sand,`the plinth's flank slopes between the two (got ${flank})`);
  // A piece dropped just past the rim, over the plinth, comes to rest ON the stone -- not fifteen
  // units down inside it, which is where it ended up when the sand was the ground everywhere.
  g.read(`let seed=5; Math.random=()=>((seed=(seed*16807)%2147483647)/2147483647);
    fall=Object.assign(mkFallState(G.pieces[1]),{idx:1, vy:-30, vx:4, vz:0});
    tripods[1].position.set(CFG.edgeU*1.03, 10, 0);
    for(let i=0;i<600 && fall.active;i++) stepFall(1/60);`);
  // Wherever it ends up -- the plinth's narrow lip, its flank, or the sand it rolls out onto -- no
  // part of it is inside the stone. That is the bug that was reported: told the sand was the ground
  // everywhere, a titan fell straight through the plinth and lay buried in it.
  const worst=g.read(`(() => {
    const t=tripods[1]; let worst=0;
    const origin=new THREE.Vector3().copy(fall.X)
      .sub(new THREE.Vector3().copy(FALL_BODY.com).applyQuaternion(t.quaternion));
    for (const h of FALL_HULL_LOCAL) {
      const p=new THREE.Vector3().copy(h.p).applyQuaternion(t.quaternion).add(origin);
      const d = fallFloorY(p.x, p.z) - (p.y - h.r);
      if (d > worst) worst = d;
    }
    return worst;
  })()`);
  assert.ok(worst<0.6,`no part of the titan is inside the stone (deepest ${worst.toFixed(2)} in)`);
  const lowest=g.read('tripods[1].position.y + fallLowestBelowOrigin(tripods[1])');
  assert.ok(lowest<1,'and it is below the board it fell from');
  assert.deepEqual(g.errors,[]);
});

// ---- Thinking without stopping the world, and a camera that shows it -------------------------

test('a deep ladder think is spread over frames instead of freezing one',async t=>{
  const g=await game();t.after(g.close);
  // L11 on the ladder: the rung whose search runs for the better part of a second.
  g.read('tauDesktop.startMatch()');g.tick();
  // ...and not the corner opening, whose first two moves are a stored line and return at once:
  // this test is about the rung's own deep search.
  g.read('ladderLevel=10; aiIdx=G.active; vsAI={mode:"ai",level:11}; G.cornerOpening=[false,false];');
  // The harness freezes performance.now between ticks; the driver reads it to size each slice, so
  // give it a clock that moves or it would swallow the whole search in one go.
  g.read('(()=>{ let t=0; performance.now=()=>(t+=1); })()');
  const first=g.read(`(()=>{ startAiTurn(); return JSON.stringify({pending:!!aiSearch, played:!!aiAnim}); })()`);
  const s=JSON.parse(first);
  assert.equal(s.pending,true,'startAiTurn leaves a search in progress rather than returning with the answer');
  // ...and the board a frame would draw is the REAL one, not the search's working position.
  const parked=JSON.parse(g.read(`JSON.stringify({pinned:G.pinned,active:G.active,
    x:G.pieces[0].x.toFixed(6),y:G.pieces[0].y.toFixed(6),rot:G.pieces[0].rot.toFixed(6)})`));
  assert.equal(parked.pinned,null,'no foot is pinned mid-think');
  assert.equal(parked.active,g.read('aiIdx'),'and it is still the thinker’s turn');
  // Each frame takes one slice; between slices the board never moves.
  const moved=g.read(`(()=>{ const x=G.pieces[0].x, r=G.pieces[0].rot; let slices=0, drift=0;
    while(aiSearch && slices<4000){ stepAiSearch(); slices++;
      drift=Math.max(drift, Math.abs(G.pieces[0].x-x)+Math.abs(G.pieces[0].rot-r)); }
    return JSON.stringify({slices, drift}); })()`);
  const m=JSON.parse(moved);
  assert.ok(m.slices>1,`the search really does take more than one slice (${m.slices})`);
  assert.ok(m.drift<1e-9,'and the board a frame would draw never moves while it thinks');
  assert.ok(g.read('!!aiAnim || G.pinned!==null || G.over'),'and the move it found is played when it finishes');
  assert.deepEqual(g.errors,[]);
});

test('a sliced search picks exactly the move the whole-breath one picks',async t=>{
  const g=await game();t.after(g.close);
  g.read('tauDesktop.startMatch()');g.tick();
  // Every rung, drained in one go versus driven a slice at a time from the same position.
  const same=g.read(`(()=>{
    const out=[];
    for (const lvl of [0,3,5,6,7,10,12,13]) {
      let seed=99+lvl; Math.random=()=>((seed=(seed*16807)%2147483647)/2147483647);
      G.cornerOpening=null; G.cornerDone=null; G.cornerBook=null;
      const whole=ladderPlanFor(lvl, 0);
      seed=99+lvl; G.cornerOpening=null; G.cornerDone=null; G.cornerBook=null;
      const gen=ladderPlanForGen(lvl, 0); const truth=aiSearchState();
      let r, mid=null;
      for(;;){ if(mid) aiSearchRestore(mid); r=gen.next();
               if(r.done) break; mid=aiSearchState(); aiSearchRestore(truth); }
      aiSearchRestore(truth);
      const key=p=>p?[p.pivotIdx,p.dir,p.targetRad.toFixed(12)].join(','):'null';
      out.push(lvl+':'+(key(whole)===key(r.value)?'same':key(whole)+' vs '+key(r.value)));
    }
    return out.join('|');
  })()`);
  for (const part of same.split('|'))
    assert.ok(part.endsWith(':same'), `sliced and whole agree (${part})`);
  assert.deepEqual(g.errors,[]);
});

test('the camera drifts while the opponent thinks and settles when the turn comes back',async t=>{
  const g=await game();t.after(g.close);
  g.read('tauDesktop.startMatch()');g.tick();
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{},render(){},
      setRenderTarget(){},getRenderTarget(){return null;}};
    scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(38,1.6,1,2000);
    camera.position.set(0,150,200);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0),update(){},addEventListener(){}};
    camManualSet=false; vsAI={mode:"ai",level:1}; aiIdx=G.active;`);
  const bearing=`Math.atan2(camera.position.x-controls.target.x, camera.position.z-controls.target.z)`;
  const out=JSON.parse(g.read(`(()=>{
    G.active=1-aiIdx;                                            // your turn: the still photograph
    for(let i=0;i<240;i++) tauDesktop.updateCamera(1/60);
    const a0=${bearing}, amt0=tauDesktop.debugDrift();
    G.active=aiIdx;                                              // ...and now they are thinking
    let spread=0;
    for(let i=0;i<900;i++){ tauDesktop.updateCamera(1/60); spread=Math.max(spread, Math.abs(${bearing}-a0)); }
    const amt1=tauDesktop.debugDrift();
    G.active=1-aiIdx;                                            // your turn again
    for(let i=0;i<300;i++) tauDesktop.updateCamera(1/60);
    return JSON.stringify({amt0, amt1, spread, back:Math.abs(${bearing}-a0), amt2:tauDesktop.debugDrift()});
  })()`));
  assert.ok(out.amt0<0.01,'while it is your move the camera holds the shot');
  assert.ok(out.amt1>0.8,`the drift is running while the opponent thinks (${out.amt1.toFixed(2)})`);
  assert.ok(out.spread>0.05,`and it actually moves the view (${out.spread.toFixed(3)} rad)`);
  assert.ok(out.spread<0.35,`...gently, not a pan (${out.spread.toFixed(3)} rad)`);
  assert.ok(out.amt2<0.01,'it is gone once the turn is yours');
  assert.ok(out.back<0.02,`and the view is back where it was (${out.back.toFixed(4)} rad)`);
  assert.deepEqual(g.errors,[]);
});

test('nobody drifts the camera in a local 1v1, or when the player asked for less motion',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},shadowMap:{},render(){},
      setRenderTarget(){},getRenderTarget(){return null;}};
    scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(38,1.6,1,2000);
    camera.position.set(0,150,200);
    controls={mouseButtons:{},target:new THREE.Vector3(0,4,0),update(){},addEventListener(){}};
    camManualSet=false;`);
  const local=g.read(`(()=>{ for(let i=0;i<300;i++) tauDesktop.updateCamera(1/60);
                             return tauDesktop.debugDrift(); })()`);
  assert.ok(local<0.01,'two people at one screen are both playing; the camera holds still');
  assert.deepEqual(g.errors,[]);
});

test('the jam buzzes once on arrival, not eight times a second for as long as you hold it',async t=>{
  const g=await game();t.after(g.close);
  localMatch(g);
  const buzzes=g.read(`(()=>{
    let n=0;
    // Count the effects a real pad would be sent: one actuator, no rate gate of its own.
    const pad={connected:true,mapping:'standard',index:0,
      buttons:Array.from({length:17},()=>({pressed:false,value:0})),axes:[0,0,0,0],
      vibrationActuator:{playEffect(){ n++; return Promise.resolve(); }}};
    navigator.getGamepads=()=>[pad];
    tauDesktop.tick(1/60);
    pinFoot(0);
    G.atLimit=true;                       // the piece is already jammed against the rule
    let t=0; const realNow=performance.now;
    for(let i=0;i<180;i++){ t+=20; performance.now=()=>t;   // three seconds of leaning on it
      pad.axes[2]=1; tauDesktop.tick(1/60); G.atLimit=true; }
    performance.now=realNow;
    return n;
  })()`);
  assert.ok(buzzes<=1,`holding a swing at the limit buzzes at most once (got ${buzzes})`);
  assert.deepEqual(g.errors,[]);
});
