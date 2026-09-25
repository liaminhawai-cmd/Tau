const test = require('node:test');
const assert = require('node:assert/strict');
const {game} = require('./game-harness.cjs');

test('cycling an unpinned foot redraws the flat board and retains a shared controller cue', async t => {
  const g = await game(); t.after(g.close);
  const pad = {index:0, connected:true, mapping:'standard', axes:[0,0,0,0],
    buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  g.w.navigator.getGamepads = () => [pad];
  g.read('tauDesktop.startMatch(true)'); g.$('desktopPickSkip').click(); g.tick();
  g.read('hoverDisc=new THREE.Mesh(new THREE.RingGeometry(3.3,4.5,32),new THREE.MeshBasicMaterial());');
  const strokes = [];
  const ctx = g.$('canvas').getContext('2d');
  let arc = null;
  ctx.arc = (...args) => { arc = args; };
  ctx.stroke = () => { if (ctx.strokeStyle === '#ffe9ad') strokes.push(arc); };
  const press = i => { pad.buttons[i].pressed=true; g.tick(); pad.buttons[i].pressed=false; g.tick(); };
  for (const selected of [1, 2, 0]) {
    press(15);
    assert.equal(g.w.tauDesktop.focusedFoot, selected);
    assert.equal(g.read('G.pinned'), null, 'preview does not pin the foot');
    const target = g.read(`(()=>{const f=G.pieces[G.active].feet()[${selected}];return bx2px(f.x,f.y);})()`);
    assert.ok(strokes.length, 'cycling immediately redraws the selection');
    assert.deepEqual(strokes.at(-1).slice(0,2), [target.x, target.y]);
    g.read('updateFootCue3D()');
    assert.equal(g.read('hoverDisc.visible'),true);
    const foot=g.read(`G.pieces[G.active].feet()[${selected}]`);
    assert.equal(g.read('hoverDisc.position.x'),foot.x);
    assert.equal(g.read('hoverDisc.position.z'),foot.y);
  }
  const before = g.read('JSON.stringify(takeSnap())');
  g.$('canvas').dispatchEvent(new g.w.MouseEvent('pointermove',{bubbles:true})); g.tick();
  assert.equal(g.w.tauDesktop.focusedFoot, -1, 'moving the mouse gives back selection ownership');
  press(15); assert.equal(g.w.tauDesktop.focusedFoot,1,'controller reclaims it');
  g.w.navigator.getGamepads=()=>[];g.tick();
  assert.equal(g.w.tauDesktop.focusedFoot,-1,'disconnect clears the cue');
  g.read('v3HoverIdx=-1;updateFootCue3D()');
  assert.equal(g.read('hoverDisc.visible'),false,'3D cue clears as well');
  assert.equal(g.read('JSON.stringify(takeSnap())'),before,'cues have no gameplay effect');
  assert.deepEqual(g.errors, []);
});

test('clay geometry keeps its deformations across look changes and resets for a new match', async t => {
  const g=await game();t.after(g.close);
  g.read('tauDesktop.startMatch(true)');g.$('desktopPickSkip').click();g.tick();
  g.read(`renderer={capabilities:{getMaxAnisotropy:()=>8},setPixelRatio(){},getPixelRatio:()=>1,setSize(){},shadowMap:{}};
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera();
    controls={mouseButtons:{},target:new THREE.Vector3()};
    boardTop=new THREE.Mesh(new THREE.CircleGeometry(CFG.edgeU),new THREE.MeshStandardMaterial());
    boardTop.rotation.x=-Math.PI/2;
    boardRim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU,CFG.edgeU,4),new THREE.MeshStandardMaterial());
    tripods=[buildTripod(0x6b9eff),buildTripod(0xff6b6b)];
    tauDesktop.board='sumo';tauDesktop.tick(0.04);`);
  const before=g.read('JSON.stringify(takeSnap())');
  g.read('for(let i=0;i<20;i++){tripods[0].position.x+=0.35;tauDesktop.tick(0.04);}');
  const heights=()=>g.read('Array.from(boardTop.geometry.attributes.position.array).filter((_,i)=>i%3===2)');
  assert.ok(heights().some(v=>v<0), 'feet carve the actual mesh');
  assert.ok(heights().some(v=>v>0), 'the same mesh has raised clay');
  g.read('for(let i=0;i<30;i++)tauDesktop.tick(0.04)');
  const settled=heights();
  g.read('for(let i=0;i<100;i++)tauDesktop.tick(0.04)');
  assert.deepEqual(heights(),settled,'time does not fade marks');
  g.read("tauDesktop.board='walnut'");
  assert.equal(g.read('boardTop.geometry.type'),'CircleGeometry');
  assert.equal(g.read('boardTop.material.vertexColors'),false);
  g.read("tauDesktop.board='sumo'");
  assert.deepEqual(heights(),settled,'returning to Sumo keeps this bout\'s clay');
  assert.equal(g.read('JSON.stringify(takeSnap())'),before,'simulation never changes the rules state');
  g.read('tauDesktop.onMatchStart();tauDesktop.tick(0.04)');
  assert.ok(heights().every(v=>v===0),'a new match starts swept');
  assert.deepEqual(g.errors,[]);
});
