/* Tau's desktop presentation. Rules, move commitment, opponents, replays and online play
   belong to index.html. This layer only supplies the room, controls and desktop chrome. */
(() => {
  'use strict';
  if (!window.TAU_DESKTOP) return;
  const root = document.documentElement;
  const $ = id => document.getElementById(id);
  const SETTINGS_KEY = 'tauDesktopSettingsV1';
  // Board finishes. Each one drives BOTH views from a single entry: `skin` is the flat board's
  // palette (the shape index.html's activeSkin() expects) and `wood` re-tints the 3D surface,
  // markings and rim. One choice, both boards — they can never drift apart.
  const BOARD_FINISHES = [
    { id:'walnut', name:'Walnut',
      skin:{ shadeByZoneValue:false, flat:'#65432b', lines:'#ead5a4', rim:'#574b32', bg:'#101410', pb:'#639eb8', pr:'#dc8864' },
      wood:{ base:[105,72,46], line:'#e1ca91', rim:'#57472e', trim:'#aa8751', bg:'#101410' } },
    { id:'ebony', name:'Ebony',
      skin:{ shadeByZoneValue:false, flat:'#2b2724', lines:'#c8bda6', rim:'#241f1c', bg:'#0b0d0e', pb:'#6fa8c4', pr:'#e08a63' },
      wood:{ base:[58,52,48], line:'#cdc0a6', rim:'#2b2622', trim:'#8d8878', bg:'#0b0d0e' } },
    { id:'maple', name:'Maple',
      skin:{ shadeByZoneValue:false, flat:'#c8a877', lines:'#5b4526', rim:'#9b7f52', bg:'#171512', pb:'#2f6f8c', pr:'#b1502c' },
      wood:{ base:[201,171,122], line:'#6b5024', rim:'#9d8153', trim:'#d8bd8a', bg:'#171512' } },
    { id:'slate', name:'Slate',
      skin:{ shadeByZoneValue:false, flat:'#3d454d', lines:'#d7e0e8', rim:'#2c333a', bg:'#0e1114', pb:'#7cb6d8', pr:'#e3906a' },
      wood:{ base:[72,82,92], line:'#dde5ec', rim:'#2f363d', trim:'#8fa1b0', bg:'#0e1114' } },
  ];
  const PAD_SCHEMES = ['sticks','triggers'];
  const settings = { level:4, colour:0, quality:'balanced', board:'walnut', padScheme:'sticks',
    reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches, haptics:true };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (Number.isInteger(saved.level) && saved.level >= 1 && saved.level <= LADDER_N) settings.level = saved.level;
    if (saved.colour === 0 || saved.colour === 1) settings.colour = saved.colour;
    if (['balanced','high'].includes(saved.quality)) settings.quality = saved.quality;
    if (BOARD_FINISHES.some(b => b.id === saved.board)) settings.board = saved.board;
    if (PAD_SCHEMES.includes(saved.padScheme)) settings.padScheme = saved.padScheme;
    for (const k of ['reducedMotion','haptics']) if (typeof saved[k] === 'boolean') settings[k] = saved[k];
  } catch (_) {}
  const finish = () => BOARD_FINISHES.find(b => b.id === settings.board) || BOARD_FINISHES[0];
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
    root.classList.toggle('desktop-reduced-motion', settings.reducedMotion);
  }

  let paused = false, pauseAt = 0, ownMatch = false, previousFocus = null;
  let currentPad = null, padButtons = [], padAxisLatch = false, padFocus = 0;
  let chosenFoot = 0, heldLeft = false, heldRight = false, lastActive = -1;
  let textures = null, texturesFor = null, artInstalled = false, lastRumble = -Infinity;
  let lastCrossings = 0, stickAngle = null;
  const cameraGoal = new THREE.Vector3(), targetGoal = new THREE.Vector3();
  const camOffset = new THREE.Vector3(), camSpherical = new THREE.Spherical();
  const boardElement = () => renderer ? $('view3d') : canvas;
  const focusBoard = () => boardElement().focus({preventScroll:true});

  const home = document.createElement('section');
  home.className = 'desktop-home';
  home.setAttribute('aria-label','Main menu');
  home.innerHTML = `<img class="desktop-logo" src="tau-logo.png" alt="Tau" width="220" height="62">
    <h2>A delicate<br>balance.</h2>
    <p class="desktop-intro">Pin a foot. Swing the other two.<br>Push your opponent off the board.</p>
    <button class="desktop-primary" id="desktopPlay">Play</button>
    <div class="desktop-choices">
      <label>Opponent<select id="desktopLevel" aria-label="Opponent level"></select></label>
      <label>You play<select id="desktopColour" aria-label="Your colour"><option value="0">Blue · first</option><option value="1">Red · second</option></select></label>
    </div>
    <nav class="desktop-links" aria-label="Other ways to play">
      <button id="desktopLocal">Two players · same screen</button>
      <button id="desktopOnline">Play online</button>
      <button id="desktopLearn">Learn to play</button>
      <button id="desktopLevels">Ranked &amp; levels</button>
      <button id="desktopShowcase">Showcase boards</button>
    </nav>
    <div class="desktop-home-bottom"><button id="desktopSettings">Settings</button><button id="desktopWatch">Replays</button><button id="desktopLab">Lab</button><button id="desktopQuit" hidden>Quit</button></div>`;
  $('menu').appendChild(home);
  const materialLabel = document.createElement('div');
  materialLabel.className = 'desktop-material'; materialLabel.textContent = 'Walnut · metal · brass';
  $('menu').appendChild(materialLabel);
  if (!renderer) {
    root.classList.add('desktop-overhead');
    materialLabel.textContent = 'Overhead mode · 3D unavailable';
  }
  const toolbar = document.createElement('div');
  toolbar.className = 'desktop-toolbar';
  toolbar.innerHTML = `<button class="desktop-brand" id="desktopHome" aria-label="Open pause menu">TAU</button>
    <button class="desktop-menu" id="desktopPause">Menu <kbd>Esc</kbd></button>
    <div class="desktop-input-hint" id="desktopInputHint">Drag a foot to swing<br>Right-drag the 3D view to look around</div>`;
  document.body.appendChild(toolbar);
  for (let n=1;n<=LADDER_N;n++) {
    const opt = document.createElement('option'); opt.value = String(n); opt.textContent = 'Level ' + n;
    $('desktopLevel').appendChild(opt);
  }
  $('desktopLevel').value = String(settings.level); $('desktopColour').value = String(settings.colour);
  $('desktopLevel').addEventListener('change', e => { settings.level = Number(e.target.value); saveSettings(); });
  $('desktopColour').addEventListener('change', e => { settings.colour = Number(e.target.value); saveSettings(); });

  function startMatch(local = false) {
    if (local) startGame(false);
    else startLadderLevel(settings.level - 1, settings.colour);
    ownMatch = true;
    // A same-screen board game has no network opponent waiting on a deadline.
    if (local) onlineTurnDeadline = null;
    focusBoard();
  }
  $('desktopPlay').onclick = () => startMatch();
  $('desktopLocal').onclick = () => startMatch(true);
  $('desktopOnline').onclick = () => $('modeOnline').click();
  $('desktopLearn').onclick = () => $('howToPlayBtn').click();
  $('desktopLevels').onclick = () => $('modeAI').click();
  $('desktopWatch').onclick = () => $('watchBtn').click();
  // The six art-directed premium boards (noir/math/sumo/cosy/alien/colossus) — the attract-mode
  // page the wrapper also reaches with F2; its "full game →" link returns here.
  $('desktopShowcase').onclick = () => { location.href = 'steam.html?steam=1'; };
  // The analysis lab: brains on the bench, custom openings, position tools (the #lab dev route,
  // which has no other way in from a packaged desktop build with no URL bar).
  $('desktopLab').onclick = () => { if (typeof labOpenDrop === 'function') labOpenDrop(); };
  $('desktopSettings').onclick = openSettings;
  $('desktopPause').onclick = openPause;
  $('desktopHome').onclick = openPause;
  if (window.tauSteam?.quit) {
    $('desktopQuit').hidden = false; $('desktopQuit').onclick = () => window.tauSteam.quit();
  }

  function inMatch() { return $('game').style.display === 'flex'; }
  function dialogOpen() { return $('modalBackdrop').style.display === 'flex'; }
  function focusable(container) {
    return [...container.querySelectorAll('button,input,select,[tabindex="0"]')]
      .filter(el => !el.disabled && !el.hidden && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }
  function setPaused(next) {
    next = !!next && !onlineMatch;
    if (paused === next) return;
    paused = next;
    heldLeft = heldRight = false;
    if (paused) {
      pauseAt = performance.now();
      if (masterGain && audioCtx) masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, .06);
    } else {
      if (onlineTurnDeadline != null) onlineTurnDeadline += performance.now() - pauseAt;
      if (replayActive) replayLastT = performance.now();
      if (masterGain && audioCtx) masterGain.gain.setTargetAtTime(soundOn ? effectiveMaster() : 0, audioCtx.currentTime, .08);
      if (inMatch() && vsAI && G && !G.over && G.active === aiIdx && !aiAnim && !replayActive) {
        clearTimeout(aiTimer); aiTimer = setTimeout(startAiTurn, 180);
      }
    }
  }
  function openPause() {
    if (!inMatch()) return;
    if (G.over && !replayActive) { renderGameOverSheet(); return; }
    const body = onlineMatch ? 'Your online match continues while this menu is open.' : '';
    showModal(onlineMatch ? 'Match menu' : 'Paused', body, [
      { label:'Continue', onClick:() => focusBoard() },
      { label:'Settings', onClick:openSettings },
      { label:'How to play', onClick:() => $('howToPlayBtn').click() },
      { label:'Leave match', onClick:confirmLeave },
    ], false, {dismiss:true});
  }
  function confirmLeave() {
    showModal('Leave this match?', 'The current game will end.', [
      {label:'Keep playing',onClick:() => focusBoard()},
      {label:'Leave match',onClick:backToMenu},
    ], false, {dismiss:true});
  }
  function openSettings() {
    const fullscreen = window.tauSteam?.setFullscreen;
    showModal('Settings', `<label class="desktop-setting desktop-volume">Sound <output id="desktopVolumeValue">${userVol}%</output><input id="desktopVolume" aria-label="Sound volume" type="range" min="0" max="200" step="5" value="${userVol}"></label>
      <label class="desktop-setting">Mute<input id="desktopMute" type="checkbox" ${soundOn?'':'checked'}></label>
      <label class="desktop-setting">Board<select id="desktopBoard">${BOARD_FINISHES.map(b=>`<option value="${b.id}">${b.name}</option>`).join('')}</select></label>
      <label class="desktop-setting">Graphics<select id="desktopQuality"><option value="balanced">Balanced</option><option value="high">High</option></select></label>
      <label class="desktop-setting">Controller<select id="desktopPadScheme"><option value="sticks">Sticks · turn the right stick</option><option value="triggers">Triggers · pull to swing</option></select></label>
      <label class="desktop-setting">Reduce camera motion<input id="desktopMotion" type="checkbox" ${settings.reducedMotion?'checked':''}></label>
      <label class="desktop-setting">Controller vibration<input id="desktopHaptics" type="checkbox" ${settings.haptics?'checked':''}></label>
      ${fullscreen ? '<label class="desktop-setting">Fullscreen<input id="desktopFullscreen" type="checkbox"></label>' : ''}
      <p class="desktop-result-detail">Keyboard: 1–3 choose a foot; ← → swing; Enter ends your turn.<br>Controller: the D-pad always chooses the foot; A pins or ends the turn; B cancels. <b>Sticks</b> — push the right stick out to any direction, then turn it: the piece follows the stick degree for degree, and the left stick moves the camera. <b>Triggers</b> — RT turns clockwise, LT anticlockwise, and the harder you pull the faster it turns.${window.tauSteam ? ' F2 flips between the game and the showcase boards.' : ''}</p>`,
      [{label:'Done',onClick:() => { if(inMatch()) focusBoard(); }}], true, {dismiss:true});
    $('desktopQuality').value = settings.quality;
    $('desktopBoard').value = settings.board;
    $('desktopPadScheme').value = settings.padScheme;
    $('desktopBoard').onchange = e => {
      settings.board=e.target.value; saveSettings();
      applyMaterials();   // rebakes the 3D surface for the new finish
      applyTheme();       // repaints the flat board from the same entry's palette
      render();
    };
    $('desktopPadScheme').onchange = e => { settings.padScheme=e.target.value; saveSettings(); };
    $('desktopVolume').oninput = e => {
      setUserVol(Number(e.target.value)); $('desktopVolumeValue').textContent = userVol+'%'; $('desktopMute').checked = !soundOn;
      if(paused && masterGain && audioCtx) masterGain.gain.setTargetAtTime(0,audioCtx.currentTime,.03);
    };
    $('desktopMute').onchange = e => { setSoundOn(!e.target.checked); if(paused && masterGain && audioCtx) masterGain.gain.setTargetAtTime(0,audioCtx.currentTime,.03); };
    $('desktopQuality').onchange = e => { settings.quality=e.target.value; saveSettings(); configureQuality(); resize(); };
    $('desktopMotion').onchange = e => { settings.reducedMotion=e.target.checked; saveSettings(); };
    $('desktopHaptics').onchange = e => { settings.haptics=e.target.checked; saveSettings(); };
    if (fullscreen) {
      window.tauSteam.isFullscreen().then(value => { if($('desktopFullscreen')) $('desktopFullscreen').checked=value; }).catch(() => {});
      $('desktopFullscreen').onchange = e => window.tauSteam.setFullscreen(e.target.checked);
    }
  }
  function showResult({ title, bodyHtml }) {
    if (!ownMatch || onlineMatch || labActive || rankedMode) return false;
    const local = !vsAI, level = ladderLevel, colour = humanIdx;
    const rematch = () => {
      if (local) startGame(false); else startLadderLevel(level, colour);
      ownMatch = true; onlineTurnDeadline = null; focusBoard();
    };
    const buttons = [{label:'Rematch',onClick:rematch}];
    if (!local && G.winner===humanIdx && level+1<LADDER_N)
      buttons.push({label:'Next level',onClick:() => { settings.level=level+2; saveSettings(); $('desktopLevel').value=String(settings.level); startMatch(); }});
    if(replayFrames.length>15) buttons.push({label:'Watch replay',onClick:startReplay});
    buttons.push({label:'Main menu',onClick:backToMenu});
    const detail = local ? 'Two players · same screen' : `Level ${level+1} · You played ${colour===0?'Blue':'Red'}`;
    showModal(title, `<span class="desktop-result-mark" aria-hidden="true"></span><p class="desktop-result-detail">${detail}</p>${bodyHtml||''}`, buttons, true, {dismiss:false});
    $('modalBox').dataset.desktopResult='true';
    return true;
  }

  // A fixed seed makes the material stable across starts. Noise is visual only and never
  // consumes the random stream used by the opponents. The printed geometry comes from CFG.
  function woodMaps(wood) {
    const [br,bg,bb]=wood.base;
    const S=1536, cv=document.createElement('canvas'); cv.width=cv.height=S;
    const c=cv.getContext('2d'), pixels=c.createImageData(S,S), d=pixels.data;
    for(let y=0;y<S;y++) for(let x=0;x<S;x++) {
      const grain=x+18*Math.sin(y*.004)+7*Math.sin(y*.012+x*.003);
      const fine=Math.sin(grain*.26+Math.sin(y*.013)*1.7);
      const broad=Math.sin(grain*.019+Math.sin(y*.0018)*2.5);
      const pore=Math.pow(Math.max(0,fine),14);
      let hash=Math.imul(x+17,374761393)^Math.imul(y+41,668265263); hash=(hash^(hash>>>13))>>>0;
      const noise=(hash%255)/255-.5;
      const value=broad*9+fine*2.6-pore*6+noise*3;
      const i=(y*S+x)*4;
      d[i]=br+value; d[i+1]=bg+value*.78; d[i+2]=bb+value*.52; d[i+3]=255;
    }
    c.putImageData(pixels,0,0);
    const bumpCv=document.createElement('canvas'); bumpCv.width=bumpCv.height=768;
    bumpCv.getContext('2d').drawImage(cv,0,0,768,768);
    const sc=S/(CFG.edgeU*2), O=S/2;
    c.lineWidth=CFG.edgeU*CFG.lineWidthFrac*sc; c.strokeStyle=wood.line;
    for(const r of CFG.rings){ c.beginPath(); c.arc(O,O,r*sc,0,Math.PI*2); c.stroke(); }
    for(const a of CFG.sideArcs){ c.beginPath(); c.arc(O+a.cx*sc,O+a.cy*sc,a.r*sc,a.a0*Math.PI/180,a.a1*Math.PI/180); c.stroke(); }
    CFG.startDots.forEach((p,i)=>{ c.beginPath(); c.arc(O+p[0]*sc,O+p[1]*sc,CFG.padRadius*sc,0,Math.PI*2); c.fillStyle=i<3?'#82b4bd':'#df9b78'; c.fill(); });
    const map=new THREE.CanvasTexture(cv); map.encoding=THREE.sRGBEncoding;
    map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    const bump=new THREE.CanvasTexture(bumpCv); bump.anisotropy=map.anisotropy;
    return {map,bump};
  }
  function configureQuality() {
    if(!renderer) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio||1, settings.quality==='high'?2:1.5));
    renderer.toneMappingExposure=1.03;
    renderer.shadowMap.enabled=true;
    scene.traverse(o=>{ if(!o.isLight || !o.castShadow) return;
      const size=settings.quality==='high'?2048:1024;
      if(o.shadow.mapSize.x!==size){ o.shadow.mapSize.set(size,size); if(o.shadow.map){o.shadow.map.dispose();o.shadow.map=null;} }
      o.shadow.normalBias=.16; o.shadow.bias=-.0002;
    });
    renderer.shadowMap.needsUpdate=true;
  }
  let boardTrim = null;
  function applyMaterials() {
    if(!renderer || !boardTop) return;
    const fin=finish();
    // Rebuild the surface only when the chosen finish actually changed — the texture is a 1536²
    // procedural bake, far too expensive to redo on every theme refresh.
    if(!textures || texturesFor!==fin.id){
      const old=textures;
      textures=woodMaps(fin.wood); texturesFor=fin.id;
      if(old){ old.map.dispose(); old.bump.dispose(); }
    }
    if(boardTop.material.map && boardTop.material.map!==textures.map) boardTop.material.map.dispose();
    boardTop.material.map=textures.map; boardTop.material.bumpMap=textures.bump;
    boardTop.material.bumpScale=.12; boardTop.material.roughness=.47; boardTop.material.metalness=.03; boardTop.material.needsUpdate=true;
    boardRim.material.color.set(fin.wood.rim).convertSRGBToLinear();
    boardRim.material.metalness=.68; boardRim.material.roughness=.34;
    for(const pair of [tripods,htpTripods]) pair.forEach((piece,i)=>{
      const mat=piece.userData.mat;
      mat.color.set(i===0?'#427d91':'#b46744').convertSRGBToLinear();
      mat.metalness=.72; mat.roughness=.3; mat.clearcoat=.25; mat.clearcoatRoughness=.35;
      mat.envMapIntensity=.85; mat.needsUpdate=true;
    });
    if(!artInstalled){
      // This trim sits below the playing surface: it is never a new boundary or a support.
      boardTrim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU*1.027,CFG.edgeU*1.032,.5,128),
        new THREE.MeshStandardMaterial({metalness:.85,roughness:.32}));
      boardTrim.position.y=-3.8; boardTrim.castShadow=true; scene.add(boardTrim);
      controls.mouseButtons.LEFT=null; controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;
      camera.fov=38; camera.clearViewOffset(); camera.updateProjectionMatrix();
      artInstalled=true;
    }
    if(boardTrim) boardTrim.material.color.set(fin.wood.trim).convertSRGBToLinear();
    scene.background=new THREE.Color(fin.wood.bg);
    root.style.setProperty('--desk-bg', fin.wood.bg);
    configureQuality();
  }
  // This is the MENU's own ambient layout only. A real match is never sized here: it returns
  // false, and the game's own resize() (the same split-view math and #splitHandle the web build
  // uses) lays out #canvas and #view3d side by side. Desktop never gets a cut-down board layout —
  // same full flat-board-plus-3D view as web, just with the walnut chrome floated over it.
  function layout() {
    if(htp3DActive || $('htpFull')) return false;
    if(!renderer) {   // no WebGL: overhead-only, in the menu or a match
      const size=Math.max(160,Math.floor(Math.min(innerHeight-160,innerWidth-60)));
      canvas.style.width=canvas.style.height=size+'px';
      if(!inMatch()){
        const demoSize=Math.max(180,Math.floor(Math.min(innerHeight*.73,innerWidth*.57)));
        $('demoCanvas').style.width=$('demoCanvas').style.height=demoSize+'px';
      }
      render(); return true;
    }
    if(inMatch()) return false;   // hand off to the real 2D/3D split
    const cv=$('view3d');
    const w=Math.max(1,Math.round(innerWidth>600?innerWidth*.76:innerWidth));
    const h=Math.max(1,Math.round(innerWidth<=600?innerHeight*.53:innerHeight));
    cv.style.width=w+'px'; cv.style.height=h+'px'; cv.style.display='block';
    const dpr=renderer.getPixelRatio();
    if(cv.width!==Math.floor(w*dpr)||cv.height!==Math.floor(h*dpr)) renderer.setSize(w,h,false);
    camera.aspect=w/h; camera.updateProjectionMatrix();
    render();
    return true;
  }
  function updateCamera(dt, falling=false) {
    if(!renderer || htp3DActive) return false;
    camera.clearViewOffset();
    if(camDragging) return true;
    if(inMatch() && camManualSet && !falling) return true;
    const menu=!inMatch(), ratio=Math.max(.5,camera.aspect);
    let distance=Math.max(menu?222:205,148/ratio), tx=0,ty=4,tz=0;
    const yaw=menu && !settings.reducedMotion ? .18+Math.sin(performance.now()*.000055)*.045 : 0;
    if(falling && !settings.reducedMotion && G.winner!=null){
      const p=tripods[fall.idx].position;
      tx=Math.max(-24,Math.min(24,p.x*.25)); tz=Math.max(-24,Math.min(24,p.z*.25)); distance+=18;
    }
    targetGoal.set(tx,ty,tz);
    cameraGoal.set(tx+Math.sin(yaw)*distance*.72,ty+distance*.69,tz+Math.cos(yaw)*distance*.72);
    const blend=settings.reducedMotion?1:1-Math.exp(-dt*3.2);
    camera.position.lerp(cameraGoal,blend); controls.target.lerp(targetGoal,blend);
    return true;
  }

  function rumble(strength=.2) {
    if(!settings.haptics || !currentPad?.vibrationActuator) return;
    if(performance.now()-lastRumble<120) return;
    lastRumble=performance.now();
    try { const p=currentPad.vibrationActuator.playEffect('dual-rumble',{duration:65,weakMagnitude:strength,strongMagnitude:strength*.35}); p?.catch(()=>{}); } catch(_) {}
  }
  function canPlay() { return inMatch() && !dialogOpen() && !$('htpFull') && !paused && !G.over && !replayActive && !inputBlocked() && !aiAnim; }
  function chooseFoot(i) {
    if(!canPlay()) return;
    if(G.pinned!==null && Math.abs(G.netRad)>1e-6) return;
    chosenFoot=(i+3)%3; v3HoverIdx=chosenFoot;
    if(G.pinned!==null) { G.handle=null; G.ptrAngle=null; pinFoot(chosenFoot); render(); }
  }
  function pinOrCommit() {
    if(!canPlay()) return;
    if(G.pinned===null){ pinFoot(chosenFoot); playSelectClick(); rumble(); if(onlineMatch){pendingKeyframes=[];lastKeyframeT=0;} render(); }
    else if(G.handle!==null){ onUp(); rumble(.12); }
  }
  function cancelSwing() {
    if(!canPlay() || G.pinned===null) return;
    restoreSnap(); G.pinned=null; G.pivot=null; G.handle=null; G.ptrAngle=null; lastCrossings=0; stickAngle=null;
    if(onlineMatch){pendingKeyframes=[];lastKeyframeT=0;}
    render();
  }
  // Analog trigger pull, 0..1 each, as one signed axis: + is clockwise (RT), - anticlockwise (LT).
  // buttons[].value is the analog reading on a standard pad; a digital-only pad has no value, so
  // fall back to pressed = fully pulled rather than reading a trigger as permanently released.
  function triggerPull(i) {
    const b=currentPad?.buttons[i]; if(!b) return 0;
    const v=typeof b.value==='number' ? b.value : (b.pressed?1:0);
    return v>.04 ? (v-.04)/.96 : 0;
  }
  function triggerAxis() { return triggerPull(7)-triggerPull(6); }
  // Left stick orbits the camera around whatever the controls are already looking at. Setting
  // camManualSet stops updateCamera's auto-frame from hauling the view back the next frame — the
  // same latch a mouse drag sets, so a pad and a mouse hand off to each other cleanly.
  function orbitCamera(lx,ly,dt) {
    if(!renderer || !canPlay() || (Math.abs(lx)<.18 && Math.abs(ly)<.18)) return;
    camOffset.copy(camera.position).sub(controls.target);
    camSpherical.setFromVector3(camOffset);
    camSpherical.theta -= lx*1.7*dt;
    camSpherical.phi = Math.max(.2, Math.min(Math.PI/2-.05, camSpherical.phi + ly*1.2*dt));
    camOffset.setFromSpherical(camSpherical);
    camera.position.copy(controls.target).add(camOffset);
    camera.lookAt(controls.target);
    camManualSet=true;
  }
  // Both input styles need the same preamble: the first movement of a turn adopts a foot as the
  // handle and takes its current bearing as the starting angle.
  function beginSwing() {
    if(G.handle!==null) return true;
    G.handle=(G.pinned+1)%3;
    const f=G.pieces[G.active].feet()[G.handle];
    G.ptrAngle=Math.atan2(f.y-G.pivot.y,f.x-G.pivot.x); playMoveBass();
    return true;
  }
  function swing(axis,dt,dead=.16) {
    if(!canPlay() || G.pinned===null || Math.abs(axis)<dead) return;
    beginSwing();
    boardMove(G.ptrAngle+axis*.72*dt);
    if(G.atLimit) rumble(.08);
  }
  // Direct angular steering: the stick's own bearing drives the piece one-to-one, so turning the
  // stick 30° clockwise turns the piece 30° clockwise. The stick is a dial you rotate, not a
  // direction you hold — which is why this tracks the CHANGE in its angle rather than its position.
  // Below the deflection floor the angle is meaningless (a centred stick has no bearing), so the
  // reference is dropped; re-gripping then starts a fresh delta instead of teleporting the piece by
  // however far the stick was rotated while it sat in the middle.
  function stickRotate(rx,ry) {
    const mag=Math.hypot(rx,ry);
    if(!canPlay() || G.pinned===null || mag<.45){ stickAngle=null; return; }
    const angle=Math.atan2(ry,rx);
    if(stickAngle===null){ stickAngle=angle; return; }
    let delta=angle-stickAngle;
    while(delta>Math.PI) delta-=2*Math.PI;      // shortest way round, so crossing the ±180° seam
    while(delta<-Math.PI) delta+=2*Math.PI;     // never reads as a full turn the other way
    stickAngle=angle;
    if(!delta) return;
    beginSwing();
    boardMove(G.ptrAngle+delta);
    if(G.atLimit) rumble(.08);
  }
  function pollInput(dt) {
    const pads=navigator.getGamepads?.() || [];
    currentPad=Array.from(pads).find(p=>p?.connected && p.mapping==='standard') || null;
    if(lastActive!==G.active){lastActive=G.active;chosenFoot=0;heldLeft=heldRight=false;lastCrossings=0;stickAngle=null;}
    if(currentPad){
      const down=i=>!!currentPad.buttons[i]?.pressed, pressed=i=>down(i)&&!padButtons[i];
      const context=$('htpFull') || (dialogOpen()?$('modalBox'):(!inMatch()?home:null));
      if(context){
        const els=focusable(context), axis=currentPad.axes[1]||0;
        const move=(pressed(13)?1:pressed(12)?-1:(!padAxisLatch&&Math.abs(axis)>.6?Math.sign(axis):0));
        if(move && els.length){const current=els.indexOf(document.activeElement);padFocus=(Math.max(0,current)+move+els.length)%els.length;els[padFocus].focus();}
        padAxisLatch=Math.abs(axis)>.4;
        const el=document.activeElement;
        if(el?.tagName==='SELECT' && (pressed(14)||pressed(15))){el.selectedIndex=Math.max(0,Math.min(el.options.length-1,el.selectedIndex+(pressed(15)?1:-1)));el.dispatchEvent(new Event('change',{bubbles:true}));}
        if(el?.type==='range' && (pressed(14)||pressed(15))){el.value=String(Math.max(Number(el.min),Math.min(Number(el.max),Number(el.value)+(pressed(15)?1:-1)*Number(el.step||1))));el.dispatchEvent(new Event('input',{bubbles:true}));}
        if(pressed(0)){const target=els.includes(el)?el:els[0];if(target?.tagName!=='SELECT')target?.click();}
        if(pressed(1)&&dialogOpen()&&modalDismiss)modalDismiss();
        if(pressed(1)&&$('htpFull'))$('htpClose')?.click();
      } else if(inMatch()) {
        if(pressed(9))openPause();
        // The D-pad picks the foot in EVERY scheme — one thing that never moves, so the sticks and
        // triggers are free to mean different things per scheme without the choice of foot moving too.
        if(pressed(14))chooseFoot(chosenFoot-1);
        if(pressed(15))chooseFoot(chosenFoot+1);
        if(pressed(0))pinOrCommit();
        if(pressed(1))cancelSwing();
        if(settings.padScheme==='triggers'){
          // Analog triggers: right clockwise, left anticlockwise, and how far you pull IS the speed.
          // Triggers rest at a true zero (no stick drift), so the dead zone can be tiny and a feather
          // press still gives a slow, controllable creep.
          swing(triggerAxis(),dt,.02);
        } else {
          stickRotate(currentPad.axes[2]||0, currentPad.axes[3]||0);       // right stick IS the dial
          orbitCamera(currentPad.axes[0]||0, currentPad.axes[1]||0, dt);   // left stick moves the camera
        }
        // A short pulse each time a foot actually crosses a printed line: the rule that decides the
        // turn, felt rather than read off the crossings counter.
        if(typeof G.crossings==='number'){
          if(G.crossings>lastCrossings) rumble(.34);
          lastCrossings=G.crossings;
        }
        if(canPlay())v3HoverIdx=G.pinned===null?chosenFoot:G.pinned;
      }
      padButtons=currentPad.buttons.map(b=>b.pressed);
      $('desktopInputHint').innerHTML = settings.padScheme==='triggers'
        ? '<kbd>D-pad ← →</kbd> choose foot · <kbd>A</kbd> pin / end<br><kbd>LT / RT</kbd> swing — press harder to go faster'
        : '<kbd>D-pad ← →</kbd> choose foot · <kbd>A</kbd> pin / end<br>Turn the <kbd>right stick</kbd> like a dial · <kbd>Left stick</kbd> camera';
    } else { padButtons=[]; padAxisLatch=false; }
    if(heldLeft||heldRight)swing((heldRight?1:0)-(heldLeft?1:0),dt);
  }
  document.addEventListener('keydown',e=>{
    if($('htpFull'))return;
    if(e.key==='Escape'){
      if(dialogOpen()){if(modalDismiss){e.preventDefault();e.stopImmediatePropagation();modalDismiss();}return;}
      if(inMatch()){e.preventDefault();e.stopImmediatePropagation();openPause();}return;
    }
    if(e.key==='Tab'&&dialogOpen()){
      const els=focusable($('modalBox')); if(!els.length)return;
      const i=els.indexOf(document.activeElement);
      if((e.shiftKey&&i<=0)||(!e.shiftKey&&(i===els.length-1||i<0))){e.preventDefault();els[e.shiftKey?els.length-1:0].focus();}return;
    }
    if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)||!canPlay())return;
    if(/^[123]$/.test(e.key)){e.preventDefault();chooseFoot(Number(e.key)-1);if(G.pinned===null)pinOrCommit();}
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
      e.preventDefault(); heldLeft=e.key==='ArrowLeft'; heldRight=e.key==='ArrowRight';
      // A quick tap is a useful precision step; holding continues smoothly on animation frames.
      if(!e.repeat)swing(heldRight?1:-1,.08);
    }
    if(e.key==='Enter'&&!e.repeat){e.preventDefault();pinOrCommit();}
    if(e.key==='Backspace'){e.preventDefault();cancelSwing();}
  },true);
  addEventListener('keyup',e=>{if(e.key==='ArrowLeft')heldLeft=false;if(e.key==='ArrowRight')heldRight=false;});
  addEventListener('blur',()=>{heldLeft=heldRight=false;if(inMatch()&&!G.over&&!dialogOpen()&&!onlineMatch&&!$('htpFull'))openPause();});
  $('view3d').tabIndex=0;
  $('view3d').setAttribute('aria-label','Game board. Click a foot to pin it, then drag another foot to swing. Keyboard: 1 to 3 pin, arrow keys swing, Enter ends the turn.');
  canvas.tabIndex=0;
  canvas.setAttribute('aria-label','Overhead game board. Keyboard: 1 to 3 pin, arrow keys swing, Enter ends the turn.');
  $('modalBox').setAttribute('role','dialog');
  $('modalBox').setAttribute('aria-modal','true');
  $('modalBox').setAttribute('aria-labelledby','modalTitle');

  window.tauDesktop={
    get paused(){return paused;},
    get skin(){return finish().skin;},
    get padScheme(){return settings.padScheme;},
    set padScheme(v){ if(PAD_SCHEMES.includes(v)){ settings.padScheme=v; saveSettings(); } },
    get board(){return settings.board;},
    set board(v){ if(BOARD_FINISHES.some(b=>b.id===v)){ settings.board=v; saveSettings(); applyMaterials(); applyTheme(); render(); } },
    get boards(){return BOARD_FINISHES.map(b=>({id:b.id,name:b.name}));},
    resize:layout, updateCamera, tick:pollInput, applyMaterials, showResult,
    untimedLocal:()=>ownMatch&&!vsAI&&!onlineMatch,
    // The corner layout keys off flags (#game's display, body.ingame) that the start sequence sets
    // across several steps, so the first resize can still be reading the menu's world. Settle it on
    // the next frame, once every flag for this match is actually in place.
    onMatchStart(){ ownMatch=false; paused=false; heldLeft=heldRight=false; lastActive=-1; lastCrossings=0;
      focusBoard(); resize(); requestAnimationFrame(()=>resize()); },
    onMenu(){ ownMatch=false; paused=false; heldLeft=heldRight=false; camManualSet=false; resize(); $('desktopPlay').focus({preventScroll:true}); },
    onModalShown(){
      delete $('modalBox').dataset.desktopResult;
      previousFocus=document.activeElement;
      if(inMatch()&&(!G.over||replayActive))setPaused(true);
      requestAnimationFrame(()=>{if(dialogOpen())(focusable($('modalBtns'))[0]||focusable($('modalBox'))[0])?.focus();});
    },
    onModalHidden(){setPaused(false);if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});previousFocus=null;},
  };
  saveSettings(); applyTheme(); resize();
  if(!inMatch())$('desktopPlay').focus({preventScroll:true});
})();
