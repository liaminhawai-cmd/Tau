/* Tau's desktop presentation. Rules, move commitment, opponents, replays and online play
   belong to index.html. This layer only supplies the room, controls and desktop chrome. */
(() => {
  'use strict';
  if (!window.TAU_DESKTOP) return;
  const root = document.documentElement;
  const $ = id => document.getElementById(id);
  const SETTINGS_KEY = 'tauDesktopSettingsV1';
  const settings = { level:4, colour:0, quality:'balanced', map:false,
    reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches, haptics:true };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (Number.isInteger(saved.level) && saved.level >= 1 && saved.level <= LADDER_N) settings.level = saved.level;
    if (saved.colour === 0 || saved.colour === 1) settings.colour = saved.colour;
    if (['balanced','high'].includes(saved.quality)) settings.quality = saved.quality;
    for (const k of ['map','reducedMotion','haptics']) if (typeof saved[k] === 'boolean') settings[k] = saved[k];
  } catch (_) {}
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
    root.classList.toggle('desktop-map', settings.map);
    root.classList.toggle('desktop-reduced-motion', settings.reducedMotion);
    $('desktopMap')?.setAttribute('aria-pressed', String(settings.map));
  }

  let paused = false, pauseAt = 0, ownMatch = false, previousFocus = null;
  let currentPad = null, padButtons = [], padAxisLatch = false, padFocus = 0;
  let chosenFoot = 0, heldLeft = false, heldRight = false, lastActive = -1;
  let textures = null, artInstalled = false, lastRumble = -Infinity;
  const cameraGoal = new THREE.Vector3(), targetGoal = new THREE.Vector3();
  const palette = { shadeByZoneValue:false, flat:'#65432b', lines:'#ead5a4',
    rim:'#574b32', bg:'#101410', pb:'#639eb8', pr:'#dc8864' };
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
    </nav>
    <div class="desktop-home-bottom"><button id="desktopSettings">Settings</button><button id="desktopWatch">Replays</button><button id="desktopQuit" hidden>Quit</button></div>`;
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
    <button class="desktop-map-button" id="desktopMap" aria-pressed="false">Overhead view</button>
    <div class="desktop-input-hint" id="desktopInputHint">Drag a foot to swing<br>Right-drag to look around</div>`;
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
  $('desktopSettings').onclick = openSettings;
  $('desktopPause').onclick = openPause;
  $('desktopHome').onclick = openPause;
  $('desktopMap').onclick = () => { settings.map = !settings.map; saveSettings(); layout(); };
  $('desktopMap').hidden = !renderer;
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
      <label class="desktop-setting">Graphics<select id="desktopQuality"><option value="balanced">Balanced</option><option value="high">High</option></select></label>
      <label class="desktop-setting">Reduce camera motion<input id="desktopMotion" type="checkbox" ${settings.reducedMotion?'checked':''}></label>
      <label class="desktop-setting">Controller vibration<input id="desktopHaptics" type="checkbox" ${settings.haptics?'checked':''}></label>
      ${fullscreen ? '<label class="desktop-setting">Fullscreen<input id="desktopFullscreen" type="checkbox"></label>' : ''}
      <p class="desktop-result-detail">Keyboard: 1–3 choose a foot; ← → swing; Enter ends your turn. Controller: shoulders choose a foot; A pins or ends the turn; left stick swings; B cancels.</p>`,
      [{label:'Done',onClick:() => { if(inMatch()) focusBoard(); }}], true, {dismiss:true});
    $('desktopQuality').value = settings.quality;
    $('desktopVolume').oninput = e => {
      setUserVol(Number(e.target.value)); $('desktopVolumeValue').textContent = userVol+'%'; $('desktopMute').checked = !soundOn;
      if(paused && masterGain && audioCtx) masterGain.gain.setTargetAtTime(0,audioCtx.currentTime,.03);
    };
    $('desktopMute').onchange = e => { setSoundOn(!e.target.checked); if(paused && masterGain && audioCtx) masterGain.gain.setTargetAtTime(0,audioCtx.currentTime,.03); };
    $('desktopQuality').onchange = e => { settings.quality=e.target.value; saveSettings(); configureQuality(); layout(); };
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
  function woodMaps() {
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
      d[i]=105+value; d[i+1]=72+value*.78; d[i+2]=46+value*.52; d[i+3]=255;
    }
    c.putImageData(pixels,0,0);
    const bumpCv=document.createElement('canvas'); bumpCv.width=bumpCv.height=768;
    bumpCv.getContext('2d').drawImage(cv,0,0,768,768);
    const sc=S/(CFG.edgeU*2), O=S/2;
    c.lineWidth=CFG.edgeU*CFG.lineWidthFrac*sc; c.strokeStyle='#e1ca91';
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
  function applyMaterials() {
    if(!renderer || !boardTop) return;
    if(!textures) textures=woodMaps();
    if(boardTop.material.map && boardTop.material.map!==textures.map) boardTop.material.map.dispose();
    boardTop.material.map=textures.map; boardTop.material.bumpMap=textures.bump;
    boardTop.material.bumpScale=.12; boardTop.material.roughness=.47; boardTop.material.metalness=.03; boardTop.material.needsUpdate=true;
    boardRim.material.color.set('#57472e').convertSRGBToLinear();
    boardRim.material.metalness=.68; boardRim.material.roughness=.34;
    for(const pair of [tripods,htpTripods]) pair.forEach((piece,i)=>{
      const mat=piece.userData.mat;
      mat.color.set(i===0?'#427d91':'#b46744').convertSRGBToLinear();
      mat.metalness=.72; mat.roughness=.3; mat.clearcoat=.25; mat.clearcoatRoughness=.35;
      mat.envMapIntensity=.85; mat.needsUpdate=true;
    });
    if(!artInstalled){
      // This trim sits below the playing surface: it is never a new boundary or a support.
      const trim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU*1.027,CFG.edgeU*1.032,.5,128),
        new THREE.MeshStandardMaterial({color:new THREE.Color('#aa8751').convertSRGBToLinear(),metalness:.85,roughness:.32}));
      trim.position.y=-3.8; trim.castShadow=true; scene.add(trim);
      controls.mouseButtons.LEFT=null; controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;
      camera.fov=38; camera.clearViewOffset(); camera.updateProjectionMatrix();
      artInstalled=true;
    }
    scene.background=new THREE.Color('#101410');
    configureQuality();
  }
  function layout() {
    if(htp3DActive || $('htpFull')) return false;
    if(!renderer) {
      const size=Math.max(160,Math.floor(Math.min(innerHeight-160,innerWidth-60)));
      canvas.style.width=canvas.style.height=size+'px';
      const demoSize=Math.max(180,Math.floor(Math.min(innerHeight*.73,innerWidth*.57)));
      $('demoCanvas').style.width=$('demoCanvas').style.height=demoSize+'px';
      render(); return true;
    }
    const cv=$('view3d'), menu=!inMatch();
    const w=Math.max(1,Math.round(menu && innerWidth>600?innerWidth*.76:innerWidth));
    const h=Math.max(1,Math.round(menu && innerWidth<=600?innerHeight*.53:innerHeight));
    cv.style.width=w+'px'; cv.style.height=h+'px'; cv.style.display='block';
    const dpr=renderer.getPixelRatio();
    if(cv.width!==Math.floor(w*dpr)||cv.height!==Math.floor(h*dpr)) renderer.setSize(w,h,false);
    camera.aspect=w/h; camera.updateProjectionMatrix();
    const size=Math.round(Math.min(224,innerWidth*.24,innerHeight*.3));
    canvas.style.width=size+'px'; canvas.style.height=size+'px';
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
    restoreSnap(); G.pinned=null; G.pivot=null; G.handle=null; G.ptrAngle=null;
    if(onlineMatch){pendingKeyframes=[];lastKeyframeT=0;}
    render();
  }
  function swing(axis,dt) {
    if(!canPlay() || G.pinned===null || Math.abs(axis)<.16) return;
    if(G.handle===null){
      G.handle=(G.pinned+1)%3;
      const f=G.pieces[G.active].feet()[G.handle];
      G.ptrAngle=Math.atan2(f.y-G.pivot.y,f.x-G.pivot.x); playMoveBass();
    }
    boardMove(G.ptrAngle+axis*.72*dt);
    if(G.atLimit) rumble(.08);
  }
  function pollInput(dt) {
    const pads=navigator.getGamepads?.() || [];
    currentPad=Array.from(pads).find(p=>p?.connected && p.mapping==='standard') || null;
    if(lastActive!==G.active){lastActive=G.active;chosenFoot=0;heldLeft=heldRight=false;}
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
        if(pressed(4))chooseFoot(chosenFoot-1);
        if(pressed(5))chooseFoot(chosenFoot+1);
        if(pressed(0))pinOrCommit();
        if(pressed(1))cancelSwing();
        swing(currentPad.axes[0]||0,dt);
        if(canPlay())v3HoverIdx=G.pinned===null?chosenFoot:G.pinned;
      }
      padButtons=currentPad.buttons.map(b=>b.pressed);
      $('desktopInputHint').innerHTML='<kbd>LB / RB</kbd> choose foot · <kbd>A</kbd> pin / end turn<br>Left stick swings · <kbd>B</kbd> cancels';
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
    get skin(){return palette;},
    resize:layout, updateCamera, tick:pollInput, applyMaterials, showResult,
    untimedLocal:()=>ownMatch&&!vsAI&&!onlineMatch,
    onMatchStart(){ ownMatch=false; paused=false; heldLeft=heldRight=false; lastActive=-1; focusBoard(); layout(); },
    onMenu(){ ownMatch=false; paused=false; heldLeft=heldRight=false; camManualSet=false; layout(); $('desktopPlay').focus({preventScroll:true}); },
    onModalShown(){
      delete $('modalBox').dataset.desktopResult;
      previousFocus=document.activeElement;
      if(inMatch()&&(!G.over||replayActive))setPaused(true);
      requestAnimationFrame(()=>{if(dialogOpen())(focusable($('modalBtns'))[0]||focusable($('modalBox'))[0])?.focus();});
    },
    onModalHidden(){setPaused(false);if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});previousFocus=null;},
  };
  saveSettings(); applyTheme(); layout();
  if(!inMatch())$('desktopPlay').focus({preventScroll:true});
})();
