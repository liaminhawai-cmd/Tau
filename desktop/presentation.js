/* Tau's desktop presentation. Rules, move commitment, opponents, replays and online play
   belong to index.html. This layer only supplies the room, controls and desktop chrome. */
(() => {
  'use strict';
  if (!window.TAU_DESKTOP) return;
  const root = document.documentElement;
  const $ = id => document.getElementById(id);
  const SETTINGS_KEY = 'tauDesktopSettingsV1';
  // Board finishes. Each one drives ALL THREE surfaces from a single entry: `skin` is the flat
  // board's palette (the shape index.html's activeSkin() expects), `wood` re-tints the 3D surface,
  // markings, rim and backdrop, and `piece` is the tripod material. One choice, one look — the two
  // views and the pieces can never drift apart.
  //
  // The list is deliberately the WHOLE catalogue, not a desktop-only sub-set: the four original web
  // board skins, the four wood finishes, and the six looks that used to be locked inside the
  // separate showcase page. The showcase's own scene (bloom, custom shaders, its colosseum stands)
  // stays over there; what comes across is each look's colourway and piece character, driven through
  // the one material path every board already uses — so they are playable, not just watchable.
  //
  // wood.grain scales the procedural timber grain: 1 is real wood, low values give the smooth
  // stone/paper/membrane surfaces their own character instead of printing oak on them.
  const BOARD_FINISHES = [
    // ---- the wood finishes ----
    { id:'walnut', name:'Walnut', detail:'wood',
      skin:{ shadeByZoneValue:false, flat:'#65432b', lines:'#ead5a4', rim:'#574b32', bg:'#101410', pb:'#639eb8', pr:'#dc8864' },
      wood:{ base:[105,72,46], line:'#e1ca91', rim:'#57472e', trim:'#aa8751', bg:'#101410', grain:1, dots:['#82b4bd','#df9b78'] },
      piece:{ blue:'#427d91', red:'#b46744', metalness:.72, roughness:.3, clearcoat:.25, clearcoatRoughness:.35, envMapIntensity:.85 } },
    { id:'ebony', name:'Ebony', detail:'wood',
      skin:{ shadeByZoneValue:false, flat:'#2b2724', lines:'#c8bda6', rim:'#241f1c', bg:'#0b0d0e', pb:'#6fa8c4', pr:'#e08a63' },
      wood:{ base:[58,52,48], line:'#cdc0a6', rim:'#2b2622', trim:'#8d8878', bg:'#0b0d0e', grain:.85, dots:['#8fbecb','#e2a184'] },
      piece:{ blue:'#4f93aa', red:'#c4744c', metalness:.78, roughness:.26, clearcoat:.3, clearcoatRoughness:.3, envMapIntensity:.9 } },
    { id:'maple', name:'Maple', detail:'wood',
      skin:{ shadeByZoneValue:false, flat:'#c8a877', lines:'#5b4526', rim:'#9b7f52', bg:'#171512', pb:'#2f6f8c', pr:'#b1502c' },
      wood:{ base:[201,171,122], line:'#6b5024', rim:'#9d8153', trim:'#d8bd8a', bg:'#171512', grain:1, dots:['#2f6f8c','#b1502c'] },
      piece:{ blue:'#2f6f8c', red:'#b1502c', metalness:.6, roughness:.34, clearcoat:.3, clearcoatRoughness:.3, envMapIntensity:.7 } },
    // ---- the four original board skins from the browser build ----
    { id:'dark', name:'Dark',
      skin:{ shadeByZoneValue:false, flat:'#171c22', lines:'#5d6b7a', rim:'#2c3138', bg:'#0c0e11', pb:'#6b9eff', pr:'#ff6b6b' },
      wood:{ base:[30,36,43], line:'#6d7c8c', rim:'#2c3138', trim:'#495563', bg:'#0c0e11', grain:.3, dots:['#6b9eff','#ff6b6b'] },
      piece:{ blue:'#6b9eff', red:'#ff6b6b', metalness:.45, roughness:.38, clearcoat:.35, clearcoatRoughness:.3, envMapIntensity:.7 } },
    { id:'slate', name:'Slate',
      skin:{ shadeByZoneValue:true, v4:'#5a636c', v3:'#4b535b', v2:'#3c434a', v1:'#2f353b',
             flat:'#454d55', lines:'#12161a', rim:'#8f979e', bg:'#0c0e11', pb:'#5487c4', pr:'#d05a48' },
      wood:{ base:[69,77,85], line:'#12161a', rim:'#8f979e', trim:'#6d777f', bg:'#0c0e11', grain:.35, dots:['#5487c4','#d05a48'] },
      piece:{ blue:'#5487c4', red:'#d05a48', metalness:.5, roughness:.36, clearcoat:.3, clearcoatRoughness:.32, envMapIntensity:.65 } },
    { id:'dojo', name:'Dojo',
      skin:{ shadeByZoneValue:true, v4:'#e9d9b3', v3:'#ddc99b', v2:'#cbb47e', v1:'#b89a62',
             flat:'#d9c9a3', lines:'#3a2f22', rim:'#3c434a', bg:'#0c0e11', pb:'#243f78', pr:'#cf3b26' },
      wood:{ base:[217,201,163], line:'#3a2f22', rim:'#3c434a', trim:'#b89a62', bg:'#0c0e11', grain:.5, dots:['#243f78','#cf3b26'] },
      piece:{ blue:'#243f78', red:'#cf3b26', metalness:.15, roughness:.5, clearcoat:.4, clearcoatRoughness:.3, envMapIntensity:.4 } },
    { id:'yellow', name:'Yellow',
      skin:{ shadeByZoneValue:false, flat:'#efe4a6', lines:'#26251f', rim:'#3c434a', bg:'#0c0e11', pb:'#6b9eff', pr:'#ff6b6b' },
      wood:{ base:[239,228,166], line:'#26251f', rim:'#3c434a', trim:'#c9bf85', bg:'#0c0e11', grain:.2, dots:['#6b9eff','#ff6b6b'] },
      piece:{ blue:'#6b9eff', red:'#ff6b6b', metalness:.2, roughness:.45, clearcoat:.45, clearcoatRoughness:.25, envMapIntensity:.45 } },
    // ---- the six showcase looks, brought into the game ----
    // ---- the showcase looks, with their own bakes, materials and shaders (desktop/boards.js) ----
    // `skin` is still the flat board's palette; everything in 3D comes from the shared THEMES entry
    // of the same id -- the procedural bake, the per-part piece materials (legs and hub can differ),
    // and for Alien the membrane shader. `detail` picks the per-pixel surface pass: wood grain,
    // marble veining, or the alien membrane; those keep resolving however far a 4K display leans in.
    { id:'noir', name:'Noir', showcase:'noir',
      skin:{ shadeByZoneValue:false, flat:'#23262c', lines:'#d6b567', rim:'#17191d', bg:'#0a0c10', pb:'#7aa4ee', pr:'#ee7a6f' } },
    { id:'math', name:'Math', showcase:'math',
      skin:{ shadeByZoneValue:false, flat:'#111826', lines:'#dcecff', rim:'#14171d', bg:'#0d1017', pb:'#2f6fd8', pr:'#d8442f' } },
    { id:'sumo', name:'Sumo', showcase:'sumo',
      skin:{ shadeByZoneValue:false, flat:'#6e4a2c', lines:'#c89a54', rim:'#46351f', bg:'#17120d', pb:'#31488f', pr:'#b03220' } },
    { id:'cosy', name:'Cosy', showcase:'cosy', detail:'wood',
      skin:{ shadeByZoneValue:false, flat:'#4a3220', lines:'#e8c778', rim:'#2e1f12', bg:'#1a120c', pb:'#3a4a66', pr:'#5e2a22' } },
    { id:'alien', name:'Alien', showcase:'alien', detail:'alien',
      skin:{ shadeByZoneValue:false, flat:'#171226', lines:'#8dffe8', rim:'#110d1a', bg:'#04060b', pb:'#3f7ec8', pr:'#b04057' } },
    { id:'colossus', name:'Colossus', showcase:'colossus',
      skin:{ shadeByZoneValue:false, flat:'#b49b6d', lines:'#4a4038', rim:'#7e6f54', bg:'#b9a888', pb:'#6c7787', pr:'#8a7060' } },
    { id:'marble', name:'Marble', showcase:'marble', detail:'marble',
      skin:{ shadeByZoneValue:false, flat:'#e9e6df', lines:'#17171c', rim:'#1a1a1f', bg:'#0d0e12', pb:'#3b74e8', pr:'#e8483b' } },
  ];
  // Right stick turns the piece at a speed set by how far it is pushed; the triggers do the same
  // from RT/LT with the analog pull as the speed. Both keep the D-pad on the foot and the left
  // stick on the camera.
  const PAD_SCHEMES = ['triggers','stick'];
  const settings = { level:4, colour:0, quality:'balanced', board:'walnut', padScheme:'triggers',
    invertCamY:false,
    reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches, haptics:true };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (Number.isInteger(saved.level) && saved.level >= 1 && saved.level <= LADDER_N) settings.level = saved.level;
    if (saved.colour === 0 || saved.colour === 1) settings.colour = saved.colour;
    if (['balanced','high'].includes(saved.quality)) settings.quality = saved.quality;
    if (BOARD_FINISHES.some(b => b.id === saved.board)) settings.board = saved.board;
    if (PAD_SCHEMES.includes(saved.padScheme)) settings.padScheme = saved.padScheme;
    for (const k of ['reducedMotion','haptics','invertCamY']) if (typeof saved[k] === 'boolean') settings[k] = saved[k];
  } catch (_) {}
  const finish = () => BOARD_FINISHES.find(b => b.id === settings.board) || BOARD_FINISHES[0];
  // Relative luminance of a #rrggbb, against the same 0.5 threshold index.html's boardIsPale uses.
  const isPale = hex => { const n = parseInt(hex.slice(1), 16);
    return (0.2126*((n>>16)&255) + 0.7152*((n>>8)&255) + 0.0722*(n&255)) / 255 > 0.5; };
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
    root.classList.toggle('desktop-reduced-motion', settings.reducedMotion);
  }

  let paused = false, pauseAt = 0, ownMatch = false, previousFocus = null;
  let currentPad = null, padButtons = [], padAxisLatch = false, padFocus = 0;
  let chosenFoot = 0, heldLeft = false, heldRight = false, lastActive = -1;
  let textures = null, texturesFor = null, artInstalled = false, lastRumble = -Infinity;
  // The shared board art (desktop/boards.js), made on first use so the menu opens without baking.
  let SHOW = null, showMaps = null, showMapsFor = null, detail = null, detailMode = 0;
  const showcase = () => {
    if (!SHOW && typeof makeShowcaseBoards === 'function') SHOW = makeShowcaseBoards(THREE, CFG, { size: window.TAU_TEST_BAKE_SIZE });
    return SHOW;
  };
  let lastCrossings = 0;
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
    <div class="desktop-input-hint" id="desktopInputHint">Drag a foot to swing<br>Right-drag the 3D view to look around<br>Scroll over the flat board to resize it</div>`;
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
      { label:'Controls', onClick:openControls },
      { label:'Settings', onClick:openSettings },
      { label:'How to play', onClick:() => $('howToPlayBtn').click() },
      { label:'Leave match', onClick:confirmLeave },
    ], false, {dismiss:true});
  }
  // One place that answers "what do the buttons do". Built from the live settings rather than
  // written out twice, so switching controller scheme changes what this says — a reference sheet
  // that can disagree with the actual bindings is worse than none.
  function controlsRows() {
    const swing = settings.padScheme === 'triggers'
      ? ['LT / RT', 'Swing — pull harder to turn faster']
      : ['Right stick ← →', 'Swing — push further to turn faster'];
    return [
      ['h', 'Controller'],
      ['D-pad ← →', 'Choose which foot to pin'],
      ['A', 'Pin that foot · end your turn'],
      swing,
      ['B', 'Cancel the swing'],
      ['LB / RB', 'Shrink · grow the flat board'],
      ['Left stick', 'Move the camera'],
      ['Y', 'These controls'],
      ['Start', 'Match menu'],
      ['h', 'Mouse'],
      ['Click a foot', 'Pin it'],
      ['Drag another', 'Swing around the pinned foot'],
      ['Right-drag', 'Look around the 3D view'],
      ['Scroll the flat board', 'Resize it'],
      ['Drag the rim knob', 'Resize it precisely'],
      ['h', 'Keyboard'],
      ['1 – 3', 'Pin a foot · re-pick'],
      ['← →', 'Swing'],
      ['Enter', 'End your turn'],
      ['Backspace', 'Cancel the swing'],
      ['[ ]', 'Shrink · grow the flat board'],
      ['Esc', 'Match menu'],
      ['F1', 'These controls'],
      ['F11 · F2', 'Fullscreen · showcase boards'],
    ];
  }
  function openControls() {
    const html = controlsRows().map(([k, v]) => k === 'h'
      ? `<h3 class="desktop-controls-head">${v}</h3>`
      : `<div class="desktop-controls-row"><kbd>${k}</kbd><span>${v}</span></div>`).join('');
    // isHtml (4th) must be true: showModal writes a plain-text body with textContent, which would
    // print this markup as literal angle brackets rather than rendering it.
    showModal('Controls', `<div class="desktop-controls">${html}</div>`, [
      { label:'Done', onClick:() => focusBoard() },
    ], true, {dismiss:true});
  }
  // Grow or shrink the flat board. The corner layout is the only one with a board to resize, so
  // outside it this is a no-op rather than quietly moving a split nothing is showing.
  function resizeBoard(delta) {
    if (!cornerLayoutActive()) return;
    markSplitUsed();
    setViewSplit(Math.max(0, Math.min(1, viewSplit + delta)), true);
    saveViewSplit();
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
      <label class="desktop-setting">Controller<select id="desktopPadScheme"><option value="triggers">Triggers · pull to swing</option><option value="stick">Right stick · push to swing</option></select></label>
      <label class="desktop-setting">Invert camera Y<input id="desktopInvertY" type="checkbox" ${settings.invertCamY?'checked':''}></label>
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
    $('desktopInvertY').onchange = e => { settings.invertCamY=e.target.checked; saveSettings(); };
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
    // How much of the timber figure to print. A slate slab, a sheet of drafting paper and a living
    // membrane are not wood: at low strength the directional grain and pores fade out and only the
    // fine speckle survives, which is what those surfaces actually have.
    const grainAmt = wood.grain==null ? 1 : wood.grain;
    const S=1536, cv=document.createElement('canvas'); cv.width=cv.height=S;
    const c=cv.getContext('2d'), pixels=c.createImageData(S,S), d=pixels.data;
    for(let y=0;y<S;y++) for(let x=0;x<S;x++) {
      const grain=x+18*Math.sin(y*.004)+7*Math.sin(y*.012+x*.003);
      const fine=Math.sin(grain*.26+Math.sin(y*.013)*1.7);
      const broad=Math.sin(grain*.019+Math.sin(y*.0018)*2.5);
      const pore=Math.pow(Math.max(0,fine),14);
      let hash=Math.imul(x+17,374761393)^Math.imul(y+41,668265263); hash=(hash^(hash>>>13))>>>0;
      const noise=(hash%255)/255-.5;
      const value=(broad*9+fine*2.6-pore*6)*grainAmt+noise*3;
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
    const dots=wood.dots||['#82b4bd','#df9b78'];
    CFG.startDots.forEach((p,i)=>{ c.beginPath(); c.arc(O+p[0]*sc,O+p[1]*sc,CFG.padRadius*sc,0,Math.PI*2); c.fillStyle=i<3?dots[0]:dots[1]; c.fill(); });
    const map=new THREE.CanvasTexture(cv); map.colorSpace=THREE.SRGBColorSpace;
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
  // The tripod material for the chosen board. Every finish sets the ordinary standard-material
  // terms; the exotic ones (noir's glass, alien's thin film, colossus' flat-shaded stone) add
  // theirs on top. Terms a finish does not ask for are reset to their neutral value rather than
  // left behind, or switching away from glass would leave the next board's pieces see-through.
  // The game's piece is one fused mesh (legs and hub bead polygonised together) plus three pins,
  // sharing one material. The showcase looks want two: Noir's glass bead over glass legs, Marble's
  // coloured ball over legs that are all but invisible. So a sphere is laid over the apex to carry
  // the hub's material, while the body keeps the legs'. It is hidden again for the single-material
  // looks, and the body's original material is restored -- not re-tinted -- so no glass, thin film
  // or emissive term from a showcase look survives into the next board.
  function ensureHub(piece, scale) {
    let hub = piece.userData.hub;
    if (!hub) {
      const body = piece.children[0];
      if (!body.geometry.boundingBox) body.geometry.computeBoundingBox();
      hub = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), body.material);
      hub.position.y = body.geometry.boundingBox.max.y - CFG.legRadius*1.05;   // the bead's centre
      hub.castShadow = true; hub.receiveShadow = true;
      piece.add(hub); piece.userData.hub = hub;
    }
    hub.scale.setScalar(CFG.legRadius * scale);
    return hub;
  }
  function applyShowcasePieces(T) {
    for (const pair of [tripods, htpTripods]) pair.forEach((piece, i) => {
      const body = piece.children[0], side = i===0 ? 'blue' : 'red';
      if (!piece.userData.origMat) piece.userData.origMat = body.material;
      (piece.userData.showMats || []).forEach(m => m.dispose());
      const mats = T.pieces(side);
      const hub = ensureHub(piece, T.hubBall || 1.9);
      body.material = mats.leg; hub.material = mats.hub; hub.visible = true;
      piece.children.forEach(c => { if (c !== body && c !== hub) c.material = mats.foot || mats.leg; });
      piece.userData.showMats = [...new Set([mats.leg, mats.hub, mats.foot].filter(Boolean))];
      piece.userData.mat = mats.leg;
    });
  }
  function restorePieces() {
    for (const pair of [tripods, htpTripods]) pair.forEach(piece => {
      const body = piece.children[0];
      if (piece.userData.origMat) { body.material = piece.userData.origMat; piece.userData.mat = piece.userData.origMat; }
      if (piece.userData.hub) piece.userData.hub.visible = false;
      piece.children.forEach(c => { if (c !== body && c !== piece.userData.hub && typeof tripodPinMat !== 'undefined' && tripodPinMat) c.material = tripodPinMat; });
      (piece.userData.showMats || []).forEach(m => m.dispose()); piece.userData.showMats = null;
    });
  }
  function applyPieceMaterials(fin) {
    restorePieces();
    const p=fin.piece;
    for(const pair of [tripods,htpTripods]) pair.forEach((piece,i)=>{
      const mat=piece.userData.mat, side=i===0?'blue':'red';
      mat.color.set(i===0?p.blue:p.red);
      mat.metalness=p.metalness; mat.roughness=p.roughness;
      mat.clearcoat=p.clearcoat; mat.clearcoatRoughness=p.clearcoatRoughness;
      mat.envMapIntensity=p.envMapIntensity;
      mat.flatShading=!!p.flatShading;
      // Glass and thin film live on MeshPhysicalMaterial only. Where the build fell back to a plain
      // standard material (no WebGL2 premium path, and the how-to-play set), those boards still get
      // their colourway and simply render as solid pieces rather than throwing.
      if('transmission' in mat){
        mat.transmission=p.transmission||0;
        mat.ior=p.ior||1.5;
        mat.thickness=p.thickness||0;
        mat.transparent=!!p.transmission;
        // attenuationColor is absent on a material that has never carried transmission, so it is
        // created rather than assumed — .set() on undefined is what a missing guard costs here.
        if(p.attenuation){
          const col=new THREE.Color(p.attenuation[side]);
          if(mat.attenuationColor) mat.attenuationColor.copy(col); else mat.attenuationColor=col;
          mat.attenuationDistance=p.attenuationDistance||Infinity;
        }
      }
      mat.iridescence=p.iridescence||0;
      mat.iridescenceIOR=p.iridescenceIOR||1.3;
      if(p.iridescenceThickness) mat.iridescenceThicknessRange=p.iridescenceThickness[side];
      mat.emissive.set(p.emissive?(i===0?p.blue:p.red):'#000000');
      mat.emissiveIntensity=p.emissive?(p.emissiveIntensity||.2):0;
      mat.needsUpdate=true;
    });
  }
  function applyMaterials() {
    if(!renderer || !boardTop) return;
    const fin=finish();
    const bm = boardTop.material;
    const SH = fin.showcase ? showcase() : null;
    const T = SH && SH.THEMES[fin.showcase];
    // The per-pixel surface pass lives on the board material once, whichever look is showing; its
    // mode uniform selects grain / marble / membrane / nothing per frame (see pollInput).
    if (SH && !detail) detail = SH.installDetailShader(bm);
    if (T) {
      // A showcase look: its own bake, three or four maps, as the showcase page applies them. Baked
      // once per look and disposed on the way out -- each is a full-size canvas set.
      if (showMapsFor !== fin.id) {
        if (showMaps) for (const k in showMaps) showMaps[k] && showMaps[k].dispose();
        const maps = T.paint();
        showMaps = { map: SH.tex(maps.albedo), roughnessMap: SH.texL(maps.rough), bumpMap: SH.texL(maps.bump),
                     emissiveMap: maps.emissive ? SH.tex(maps.emissive) : null };
        showMapsFor = fin.id;
      }
      if (bm.map && bm.map !== showMaps.map && (!textures || bm.map !== textures.map)) bm.map.dispose();
      bm.map = showMaps.map; bm.roughnessMap = showMaps.roughnessMap; bm.bumpMap = showMaps.bumpMap;
      bm.emissiveMap = showMaps.emissiveMap;
      if (showMaps.emissiveMap) { bm.emissive.set(0xffffff); bm.emissiveIntensity = (T.emissiveIntensity || 1) * (T.gameEmissive || 1); }
      else { bm.emissive.set(0x000000); bm.emissiveIntensity = 1; }
      bm.roughness = 1; bm.metalness = 0.03; bm.bumpScale = T.bumpScale; bm.envMapIntensity = T.boardEnv; bm.needsUpdate = true;
      boardRim.material.color.set(T.band.color); boardRim.material.metalness = T.band.metal; boardRim.material.roughness = T.band.rough;
      applyShowcasePieces(T);
    } else {
      // Rebuild the surface only when the chosen finish actually changed — the texture is a 1536²
      // procedural bake, far too expensive to redo on every theme refresh.
      if(!textures || texturesFor!==fin.id){
        const old=textures;
        textures=woodMaps(fin.wood); texturesFor=fin.id;
        if(old){ old.map.dispose(); old.bump.dispose(); }
      }
      if(bm.map && bm.map!==textures.map && (!showMaps || bm.map!==showMaps.map)) bm.map.dispose();
      bm.map=textures.map; bm.bumpMap=textures.bump; bm.roughnessMap=null; bm.emissiveMap=null;
      bm.emissive.set(0x000000); bm.emissiveIntensity=1;
      bm.bumpScale=.12; bm.roughness=.47; bm.metalness=.03; bm.envMapIntensity=1; bm.needsUpdate=true;
      boardRim.material.color.set(fin.wood.rim);
      boardRim.material.metalness=.68; boardRim.material.roughness=.34;
      applyPieceMaterials(fin);
    }
    detailMode = fin.detail==='wood' ? 1 : fin.detail==='marble' ? 2 : fin.detail==='alien' ? 3 : 0;
    const bg = T ? '#' + new THREE.Color(T.bg).getHexString() : fin.wood.bg;
    const trim = T ? T.slabColor : fin.wood.trim;
    if(!artInstalled){
      // This trim sits below the playing surface: it is never a new boundary or a support.
      boardTrim=new THREE.Mesh(new THREE.CylinderGeometry(CFG.edgeU*1.027,CFG.edgeU*1.032,.5,128),
        new THREE.MeshStandardMaterial({metalness:.85,roughness:.32}));
      boardTrim.position.y=-3.8; boardTrim.castShadow=true; scene.add(boardTrim);
      controls.mouseButtons.LEFT=null; controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;
      camera.fov=38; camera.clearViewOffset(); camera.updateProjectionMatrix();
      artInstalled=true;
    }
    if(boardTrim) boardTrim.material.color.set(trim);
    scene.background=new THREE.Color(bg);
    root.style.setProperty('--desk-bg', bg);
    // Colossus plays in daylight: its backdrop is pale sand, and the HUD's light-on-dark text
    // disappeared into it. The flat board already flips its highlight cues by the surface's real
    // luminance (boardIsPale in index.html) rather than by which board it is; the chrome floating
    // over the 3D view now answers the same question about the ROOM behind it.
    root.classList.toggle('desktop-pale-room', isPale(bg));
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
  // The pose the camera is easing toward. Split out of updateCamera so the corner layout can ask
  // for it directly: the overlap solve there projects the dish through THIS pose, not the live
  // camera, because the live one is mid-ease for a few hundred ms after every tile change and a
  // solve that read it re-triggered itself (measured: the view flip-flopping between stepping up
  // and stepping right as the board grew). In the corner layout the pose is a function of the
  // WINDOW alone -- never the tile -- so the only thing a narrower tile does is crop. That is what
  // makes the solve exact: for a vertical-fov camera the dish's pixel size depends on tile height
  // and distance only, and neither now depends on what the solve decides.
  // In the corner layout the camera stands back far enough for the dish to fit the tile it has --
  // a narrow column beside a big flat board, or a short band above it -- rather than being drawn
  // at the size the whole window would call for and spilling off the column's edges. The fit is
  // a plain function of the tile's size, no measuring, no easing: that is what lets the layout
  // solve ask "what would the dish look like in THIS candidate tile" for every candidate without
  // ever reading the live camera, so the two never chase each other.
  function cornerDistance(w3, h3) {
    const tanHalf = Math.tan(camera.fov * Math.PI / 360);
    // For a vertical-fov camera the dish's projected half-width is edgeU*h3/(2*d*tanHalf); ask for
    // it to sit within 92% of the tile's width, and its height within 80% of the tile's height.
    const fitWide = CFG.edgeU * h3 / (0.92 * w3 * tanHalf);
    const fitTall = CFG.edgeU / (DISH_ASPECT * 0.80 * tanHalf);
    return Math.max(205, fitWide, fitTall);   // 205: the established look on an open window
  }
  function desiredPose(falling, outPos, outTarget, w3, h3) {
    const menu=!inMatch();
    const corner = typeof cornerLayoutActive === 'function' && cornerLayoutActive();
    let distance, tx=0,ty=4,tz=0;
    if (corner) {
      // The tile the layout chose (index.html's resize sets cornerView3d), or an explicit candidate.
      const cv = (typeof cornerView3d !== 'undefined' && cornerView3d) || null;
      distance = cornerDistance(w3 || (cv && cv.w3) || innerWidth, h3 || (cv && cv.h3) || innerHeight);
    } else {
      const ratio = Math.max(.5, camera.aspect);
      distance = Math.max(menu?222:205, 148/ratio);
    }
    const yaw=menu && !settings.reducedMotion ? .18+Math.sin(performance.now()*.000055)*.045 : 0;
    if(falling && !settings.reducedMotion && G.winner!=null){
      const p=tripods[fall.idx].position;
      tx=Math.max(-24,Math.min(24,p.x*.25)); tz=Math.max(-24,Math.min(24,p.z*.25)); distance+=18;
    }
    outTarget.set(tx,ty,tz);
    outPos.set(tx+Math.sin(yaw)*distance*.72,ty+distance*.69,tz+Math.cos(yaw)*distance*.72);
  }
  function updateCamera(dt, falling=false) {
    if(!renderer || htp3DActive) return false;
    camera.clearViewOffset();
    if(camDragging) return true;
    if(inMatch() && camManualSet && !falling) return true;
    desiredPose(falling, cameraGoal, targetGoal);
    // In the corner layout the pose tracks the tile, and the tile moves under the player's drag:
    // ease briskly there so the dish is not still zooming into place a second after they let go.
    // The menu and the ordinary match keep the slower, calmer settle.
    const corner = typeof cornerLayoutActive === 'function' && cornerLayoutActive();
    const blend=settings.reducedMotion?1:1-Math.exp(-dt*(corner?6.5:3.2));
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
    restoreSnap(); G.pinned=null; G.pivot=null; G.handle=null; G.ptrAngle=null; lastCrossings=0;
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
    // A stick is a LOOK control, not a grab: pushing right turns the view right, so the board
    // swings left across the screen, and pushing down tips the view down onto the board. (A mouse
    // drag is the opposite gesture — there you have hold of the board itself and it follows the
    // cursor — which is why the two read differently and both feel right.) Y is the axis people
    // disagree about, so it has a switch; X does not, because "push right, look right" is settled.
    camSpherical.theta += lx*1.7*dt;
    const pitch = settings.invertCamY ? -ly : ly;
    camSpherical.phi = Math.max(.2, Math.min(Math.PI/2-.05, camSpherical.phi - pitch*1.2*dt));
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
  // Push the right stick left or right and the piece turns that way, faster the further it goes.
  // This replaced a dial that mapped the stick's BEARING onto the piece one-to-one: turning your
  // thumb in a circle to wind the piece round was accurate on paper and genuinely awkward in the
  // hand, and it is the one thing playtesting rejected outright. Speed on an axis is the same
  // control the triggers give, so the two schemes now differ only in which fingers hold it.
  function pollInput(dt) {
    if (detail && detail.uniforms) {
      const u = detail.uniforms, now = performance.now()/1000;
      u.uDetail.value = detailMode === 3 ? 0 : detailMode;   // the membrane is its own pass below
      u.uDetailTime.value = now;
      u.uAlien.value = detailMode === 3 ? 1 : 0; u.uAlienTime.value = now;
    }
    const pads=navigator.getGamepads?.() || [];
    currentPad=Array.from(pads).find(p=>p?.connected && p.mapping==='standard') || null;
    if(lastActive!==G.active){lastActive=G.active;chosenFoot=0;heldLeft=heldRight=false;lastCrossings=0;}
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
        if(pressed(3))openControls();
        // The bumpers resize the flat board. They sit under the fingers already holding the
        // triggers that swing, and they were the one obvious pair still doing nothing in a match.
        // Held down they repeat, so you can sweep the size rather than clicking twenty times.
        if(down(4))resizeBoard(-1.6*dt);
        if(down(5))resizeBoard(+1.6*dt);
        if(settings.padScheme==='triggers'){
          // Analog triggers: right clockwise, left anticlockwise, and how far you pull IS the speed.
          // Triggers rest at a true zero (no stick drift), so the dead zone can be tiny and a feather
          // press still gives a slow, controllable creep.
          swing(triggerAxis(),dt,.02);
        } else {
          swing(currentPad.axes[2]||0, dt);                                // right stick left/right turns
        }
        orbitCamera(currentPad.axes[0]||0, currentPad.axes[1]||0, dt);     // left stick moves the camera, always
        // A short pulse each time a foot actually crosses a printed line: the rule that decides the
        // turn, felt rather than read off the crossings counter.
        if(typeof G.crossings==='number'){
          if(G.crossings>lastCrossings) rumble(.34);
          lastCrossings=G.crossings;
        }
        if(canPlay())v3HoverIdx=G.pinned===null?chosenFoot:G.pinned;
      }
      padButtons=currentPad.buttons.map(b=>b.pressed);
      $('desktopInputHint').innerHTML = '<kbd>D-pad ← →</kbd> choose foot · <kbd>A</kbd> pin / end<br>'
        + (settings.padScheme==='triggers'
            ? '<kbd>LT / RT</kbd> swing — press harder to go faster'
            : '<kbd>Right stick ← →</kbd> swing')
        + ' · <kbd>Left stick</kbd> camera<br>Scroll over the flat board to resize it';
    } else { padButtons=[]; padAxisLatch=false; }
    if(heldLeft||heldRight)swing((heldRight?1:0)-(heldLeft?1:0),dt);
  }
  document.addEventListener('keydown',e=>{
    if($('htpFull'))return;
    // F1 is the one key people already try when they want to know what the buttons do, so it works
    // from anywhere -- in a match, in the menus, and on top of another dialog.
    if(e.key==='F1'){e.preventDefault();e.stopImmediatePropagation();openControls();return;}
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
    if(e.key==='['){e.preventDefault();resizeBoard(-0.06);}
    if(e.key===']'){e.preventDefault();resizeBoard(+0.06);}
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
    get invertCamY(){return settings.invertCamY;},
    set invertCamY(v){ settings.invertCamY=!!v; saveSettings(); },
    get board(){return settings.board;},
    set board(v){ if(BOARD_FINISHES.some(b=>b.id===v)){ settings.board=v; saveSettings(); applyMaterials(); applyTheme(); render(); } },
    get boards(){return BOARD_FINISHES.map(b=>({id:b.id,name:b.name}));},
    debugDetailMode(){ return detailMode; },
    resize:layout, updateCamera, tick:pollInput, applyMaterials, showResult,
    // The corner layout's camera goal for the current window (see desiredPose).
    cornerCameraPose(w3, h3){ if(!renderer||!camera) return null;
      const pos=new THREE.Vector3(), tgt=new THREE.Vector3(); desiredPose(false,pos,tgt,w3,h3); return {position:pos,target:tgt}; },
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
