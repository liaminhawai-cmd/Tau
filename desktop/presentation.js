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
    // One continuous piece of figured timber, shaded by zone value (v1 outer lens .. v4 centre).
    // The grain flows across the curved inlays without straight stave joins or sector boundaries.
    // Both views read their zone colours from this table; woodFrame is mirrored in boards.js.
    { id:'walnut', name:'Walnut', detail:'wood',
      skin:{ shadeByZoneValue:true, flat:'#60422a', lines:'#ead5a4', rim:'#574b32', bg:'#101410', pb:'#639eb8', pr:'#dc8864' },
      wood:{ base:[96,66,42], zones:[[72,48,32],[86,58,38],[98,68,44],[112,78,50]],
             line:'#e1ca91', rim:'#57472e', trim:'#aa8751', bg:'#101410', grain:1, dots:['#82b4bd','#df9b78'] },
      piece:{ blue:'#427d91', red:'#b46744', metalness:.72, roughness:.3, clearcoat:.25, clearcoatRoughness:.35, envMapIntensity:.85 } },
    { id:'ebony', name:'Ebony', detail:'wood',
      skin:{ shadeByZoneValue:true, flat:'#322c28', lines:'#c8bda6', rim:'#241f1c', bg:'#0b0d0e', pb:'#6fa8c4', pr:'#e08a63' },
      wood:{ base:[50,44,40], zones:[[36,32,30],[44,39,36],[52,46,42],[60,53,48]],
             line:'#cdc0a6', rim:'#2b2622', trim:'#8d8878', bg:'#0b0d0e', grain:.85, dots:['#8fbecb','#e2a184'] },
      piece:{ blue:'#4f93aa', red:'#c4744c', metalness:.78, roughness:.26, clearcoat:.3, clearcoatRoughness:.3, envMapIntensity:.9 } },
    { id:'maple', name:'Maple', detail:'wood',
      skin:{ shadeByZoneValue:true, flat:'#d4b684', lines:'#5b4526', rim:'#9b7f52', bg:'#171512', pb:'#2f6f8c', pr:'#b1502c' },
      wood:{ base:[212,182,132], zones:[[168,136,94],[190,158,112],[208,178,130],[222,194,146]],
             line:'#6b5024', rim:'#9d8153', trim:'#d8bd8a', bg:'#171512', grain:1, dots:['#2f6f8c','#b1502c'] },
      piece:{ blue:'#2f6f8c', red:'#b1502c', metalness:.6, roughness:.34, clearcoat:.3, clearcoatRoughness:.3, envMapIntensity:.7 } },
    // ---- the four original board skins from the browser build ----
    { id:'dark', name:'Dark', grade:true,
      skin:{ shadeByZoneValue:false, flat:'#171c22', lines:'#5d6b7a', rim:'#2c3138', bg:'#0c0e11', pb:'#6b9eff', pr:'#ff6b6b' },
      wood:{ base:[30,36,43], line:'#6d7c8c', rim:'#2c3138', trim:'#495563', bg:'#0c0e11', grain:.3, dots:['#6b9eff','#ff6b6b'] },
      piece:{ blue:'#6b9eff', red:'#ff6b6b', metalness:.45, roughness:.38, clearcoat:.35, clearcoatRoughness:.3, envMapIntensity:.7 } },
    { id:'slate', name:'Slate',
      skin:{ shadeByZoneValue:true, v4:'#5a636c', v3:'#4b535b', v2:'#3c434a', v1:'#2f353b',
             flat:'#454d55', lines:'#12161a', rim:'#8f979e', bg:'#0c0e11', pb:'#5487c4', pr:'#d05a48' },
      wood:{ base:[69,77,85], line:'#12161a', rim:'#8f979e', trim:'#6d777f', bg:'#0c0e11', grain:.55, assembled:true, dots:['#5487c4','#d05a48'] },
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
    { id:'noir', grade:true, name:'Noir', showcase:'noir',
      skin:{ shadeByZoneValue:false, flat:'#23262c', lines:'#d6b567', rim:'#17191d', bg:'#0a0c10', pb:'#7aa4ee', pr:'#ee7a6f' } },
    { id:'math', name:'Math', showcase:'math',
      skin:{ shadeByZoneValue:false, flat:'#111826', lines:'#dcecff', rim:'#14171d', bg:'#0d1017', pb:'#2f6fd8', pr:'#d8442f' } },
    { id:'sumo', grade:true, name:'Sumo', showcase:'sumo',
      skin:{ shadeByZoneValue:false, flat:'#6e4a2c', lines:'#c89a54', rim:'#46351f', bg:'#17120d', pb:'#31488f', pr:'#b03220' } },
    { id:'cosy', grade:true, name:'Cosy', showcase:'cosy', detail:'wood',
      skin:{ shadeByZoneValue:false, flat:'#4a3220', lines:'#e8c778', rim:'#2e1f12', bg:'#1a120c', pb:'#3a4a66', pr:'#5e2a22' } },
    { id:'alien', name:'Alien', showcase:'alien', detail:'alien',
      skin:{ shadeByZoneValue:false, flat:'#171226', lines:'#8dffe8', rim:'#110d1a', bg:'#04060b', pb:'#3f7ec8', pr:'#b04057' } },
    { id:'colossus', grade:true, name:'Colossus', showcase:'colossus',
      skin:{ shadeByZoneValue:false, flat:'#b49b6d', lines:'#4a4038', rim:'#7e6f54', bg:'#b9a888', pb:'#6c7787', pr:'#8a7060' } },
    { id:'marble', grade:true, name:'Marble', showcase:'marble', detail:'marble',
      skin:{ shadeByZoneValue:false, flat:'#e9e6df', lines:'#17171c', rim:'#1a1a1f', bg:'#0d0e12', pb:'#3b74e8', pr:'#e8483b' } },
  ];
  // Most boards grade their zones -- the centre a touch lighter, each band out a touch darker, the
  // lens segments darker again -- so the flat board reads at a glance and the 3D disc matches it.
  // The woods and the graded skins name their own zone colours; the rest derive them from
  // their flat colour with the same lift and drops boards.js's shadeZones paints into the bake.
  // Exceptions stay flat on purpose: Yellow (the plain classic), Math (a drafting sheet whose live
  // construction is its reading aid) and Alien (its membrane already blotches).
  const hexOf = rgb => '#' + rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2,'0')).join('');
  function gradeSkin(flat) {   // the same lift and drops boards.js's shadeZones paints
    const c = [1,3,5].map(i => parseInt(flat.slice(i,i+2),16));
    return { v4: hexOf(c.map(v => v + (255-v)*0.07)), v3: flat, v2: hexOf(c.map(v => v*0.90)), v1: hexOf(c.map(v => v*0.80)) };
  }
  for (const b of BOARD_FINISHES) {
    if (b.grade) Object.assign(b.skin, gradeSkin(b.skin.flat), { shadeByZoneValue:true });
    if (b.wood && b.wood.zones) Object.assign(b.skin, { v1:hexOf(b.wood.zones[0]), v2:hexOf(b.wood.zones[1]), v3:hexOf(b.wood.zones[2]), v4:hexOf(b.wood.zones[3]), shadeByZoneValue:true });
  }
  // ---- unlocks (the desktop build's progression) ----
  // You start on Walnut. The rest of the catalogue opens with play: wins and games played for the
  // everyday boards, high ladder rungs for the deluxe looks, a hundred games for the marble table.
  // Progress counts finished matches against the AI or online (never the lab), persisted locally.
  const UNLOCKS = {
    walnut:  null,
    dojo:    { wins: 1 },   slate: { played: 3 },  maple: { wins: 3 },   dark: { played: 10 },
    ebony:   { wins: 5 },   yellow: { played: 20 },
    cosy:    { level: 5 },  sumo:  { level: 7 },   colossus: { played: 50 },
    noir:    { level: 9 },  math:  { level: 10 },  marble: { played: 100 }, alien: { level: LADDER_N },
  };
  const PROGRESS_KEY = 'tauDesktopProgress';
  const TEST_BOARDS_KEY = 'tauDesktopTestBoards';
  let testBoards = false;
  try { testBoards = localStorage.getItem(TEST_BOARDS_KEY) === '1'; } catch (_) {}
  const progress = { played: 0, wins: 0, topLevel: 0 };   // topLevel: highest ladder rung beaten (1-based)
  try { const p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
        for (const k in progress) if (Number.isInteger(p[k]) && p[k] >= 0) progress[k] = p[k]; } catch (_) {}
  function unlockNeed(id) { return UNLOCKS[id] === undefined ? null : UNLOCKS[id]; }
  function isEarned(id) {
    const n = unlockNeed(id); if (!n) return true;
    return (n.wins ? progress.wins >= n.wins : true) && (n.played ? progress.played >= n.played : true)
        && (n.level ? progress.topLevel >= n.level : true);
  }
  function isUnlocked(id) { return testBoards || isEarned(id); }
  function unlockText(id) {
    const n = unlockNeed(id); if (!n) return '';
    if (n.wins) return `win ${n.wins} game${n.wins>1?'s':''}`;
    if (n.played) return `play ${n.played} games`;
    return n.level >= LADDER_N ? `beat the top ladder level` : `beat ladder level ${n.level}`;
  }
  let pendingUnlocks = [];
  // Called by the game when a match ends (showGameOverModal). Counts it, and remembers what it
  // opened so the result sheet can say so.
  function recordResult({ humanWon, vsAI, online, lab, level }) {
    if (lab) return;
    const before = BOARD_FINISHES.filter(b => isEarned(b.id)).map(b => b.id);
    progress.played += 1;
    if (humanWon && (vsAI || online)) progress.wins += 1;
    if (humanWon && vsAI && Number.isInteger(level)) progress.topLevel = Math.max(progress.topLevel, level + 1);
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (_) {}
    pendingUnlocks = BOARD_FINISHES.filter(b => isEarned(b.id) && !before.includes(b.id));
    if (pendingUnlocks.length && !showResultSoon()) toastUnlocks();
  }
  // showResult (the desktop's own sheet) runs for offline matches; online and ranked results use the
  // game's sheet, so the unlock goes on a toast there instead.
  function showResultSoon() { return ownMatch && !onlineMatch && !labActive && !rankedMode; }
  function takeUnlockHtml() {
    if (!pendingUnlocks.length) return '';
    const html = `<p class="desktop-unlock">New board${pendingUnlocks.length>1?'s':''} unlocked: <b>${pendingUnlocks.map(b=>b.name).join(', ')}</b></p>`;
    pendingUnlocks = []; return html;
  }
  function toastUnlocks() {
    showUnlockToast(takeUnlockHtml());
  }
  function showUnlockToast(html) {
    let el = $('desktopUnlockToast');
    if (!el) { el = document.createElement('div'); el.id = 'desktopUnlockToast'; el.className = 'desktop-unlock-toast'; document.body.appendChild(el); }
    el.innerHTML = html; el.setAttribute('role','status'); el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 5200);
  }
  // A reversible testing override, separate from earned progress and native achievements.
  // Enter ALLBOARDS on the main menu; repeat it to restore the normal unlock requirements.
  let cheatBuffer = '', cheatAt = 0;
  function boardCheat(e) {
    if (inMatch() || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey || e.isComposing
        || e.target.closest?.('input,select,textarea,[contenteditable]:not([contenteditable="false"])')) {
      cheatBuffer = ''; return;
    }
    if (e.repeat) return;
    if (!/^[a-z]$/i.test(e.key)) { cheatBuffer = ''; return; }
    const now = performance.now();
    if (now - cheatAt > 2000) cheatBuffer = '';
    cheatAt = now; cheatBuffer = (cheatBuffer + e.key.toUpperCase()).slice(-9);
    if (cheatBuffer !== 'ALLBOARDS') return;
    cheatBuffer = ''; testBoards = !testBoards;
    try { if (testBoards) localStorage.setItem(TEST_BOARDS_KEY,'1'); else localStorage.removeItem(TEST_BOARDS_KEY); } catch (_) {}
    if (!isUnlocked(settings.board)) {
      settings.board = 'walnut'; saveSettings(); applyMaterials(); applyTheme(); render();
    }
    showUnlockToast(`<p class="desktop-unlock">${testBoards
      ? 'All boards unlocked for testing. Type ALLBOARDS again to restore locks.'
      : 'Normal board locks restored. Your earned boards are still available.'}</p>`);
    e.preventDefault();
  }
  // Right stick turns the piece at a speed set by how far it is pushed; the triggers do the same
  // from RT/LT with the analog pull as the speed. Both keep the D-pad on the foot and the left
  // stick on the camera.
  const PAD_SCHEMES = ['triggers','stick'];
  // The keyboard's bindings, by action. Rebindable from the Controls section (desktop only: the
  // app has no keyboard, and a controller is remapped by Steam Input rather than here). Esc and F1
  // are fixed: the way out of a menu and the way to this sheet should never be something a player
  // can bind away from themselves.
  const KEY_ACTIONS = [
    ['pin1','Pin foot 1'], ['pin2','Pin foot 2'], ['pin3','Pin foot 3'],
    ['swingLeft','Swing anticlockwise'], ['swingRight','Swing clockwise'],
    ['commit','Pin · end your turn'], ['cancel','Cancel the swing'],
    ['shrink','Shrink the flat board'], ['grow','Grow the flat board'],
  ];
  const DEFAULT_KEYS = { pin1:'1', pin2:'2', pin3:'3', swingLeft:'ArrowLeft', swingRight:'ArrowRight',
    commit:'Enter', cancel:'Backspace', shrink:'[', grow:']' };
  const settings = { level:4, colour:0, quality:'balanced', board:'walnut', padScheme:'triggers',
    invertCamY:false, keys:{...DEFAULT_KEYS},
    reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches, haptics:true };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (saved.keys && typeof saved.keys === 'object')
      for (const [action] of KEY_ACTIONS) if (typeof saved.keys[action] === 'string' && saved.keys[action]) settings.keys[action] = saved.keys[action];
    if (Number.isInteger(saved.level) && saved.level >= 1 && saved.level <= LADDER_N) settings.level = saved.level;
    if (saved.colour === 0 || saved.colour === 1) settings.colour = saved.colour;
    if (['balanced','high'].includes(saved.quality)) settings.quality = saved.quality;
    if (BOARD_FINISHES.some(b => b.id === saved.board) && isUnlocked(saved.board)) settings.board = saved.board;
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
  let mathLive = false; const footTmp = new THREE.Vector3();
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
  // The web app's menu, in the same words and the same order, on the premium presentation: the
  // gold Play (with its opponent and colour) up top, then the web's own entries. "Local 1v1" lives
  // inside 1v1 exactly as it does there, and Watch IS the replays screen, so neither gets a second
  // door here. No tagline or caption under the logo: the board behind it says what the game is.
  home.innerHTML = `<img class="desktop-logo" src="tau-logo.png" alt="Tau" width="220" height="62">
    <button class="desktop-primary" id="desktopPlay">Play</button>
    <div class="desktop-choices">
      <label>Opponent<select id="desktopLevel" aria-label="Opponent level"></select></label>
      <label>You play<select id="desktopColour" aria-label="Your colour"><option value="0">Blue · first</option><option value="1">Red · second</option></select></label>
    </div>
    <nav class="desktop-links" aria-label="Other ways to play">
      <button id="desktopOnline">1v1</button>
      <button id="desktopWatch">Watch</button>
      <button id="desktopLearn">How to play</button>
      <button id="desktopLeaderboard">Leaderboard</button>
    </nav>
    <div class="desktop-home-bottom"><button id="desktopSettings">Settings</button><button id="desktopControls">Controls</button><button id="desktopLab">Lab</button><button id="desktopQuit" hidden>Quit</button></div>`;
  $('menu').appendChild(home);
  if (!renderer) root.classList.add('desktop-overhead');
  const toolbar = document.createElement('div');
  toolbar.className = 'desktop-toolbar';
  toolbar.innerHTML = `<button class="desktop-brand" id="desktopHome" aria-label="Open pause menu">TAU</button>
    <button class="desktop-menu" id="desktopPause">Menu <kbd>Esc</kbd></button>`;
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
  // Every entry routes to the web app's own handler for that button, so the two menus can never
  // drift apart in what they do -- only in how they look. The web's "vs AI" is the gold Play here
  // (the opponent and colour sit right under it), and its physical-set shop link doesn't belong
  // inside a paid build.
  $('desktopOnline').onclick = () => $('modeOnline').click();
  $('desktopWatch').onclick = () => $('watchBtn').click();
  $('desktopLearn').onclick = () => $('howToPlayBtn').click();
  $('desktopLeaderboard').onclick = () => $('leaderboardBtn').click();
  $('desktopControls').onclick = openControls;
  // The six art-directed premium boards (noir/math/sumo/cosy/alien/colossus) — the attract-mode
  // page the wrapper also reaches with F2; its "full game →" link returns here.
  // The analysis lab: brains on the bench, custom openings, position tools (the #lab dev route,
  // which has no other way in from a packaged desktop build with no URL bar).
  $('desktopLab').onclick = () => { if (typeof labOpenDrop === 'function') labOpenDrop(); };
  $('desktopSettings').onclick = openSettings;
  // The Menu button answers on the press, not the click: a click needs the pointer to come up on
  // the same element after the board's own pointer handling has had its say, and on a busy frame
  // that read as lag next to Escape. Keyboard activation (Enter/Space) still arrives as a click
  // with detail 0, so that path keeps working.
  $('desktopPause').addEventListener('pointerdown', e => { if (e.button === 0) { e.preventDefault(); openPause(); } });
  $('desktopPause').onclick = e => { if (e.detail === 0) openPause(); };
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
    // The match keeps going under this menu, offline as much as online: an opponent mid-swing
    // finishes its swing, and you can change the board or check the controls while it thinks.
    // The board stays visible behind the sheet (no blur on the backdrop) so you see it happen.
    showModal('Match menu', '', [
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
  // The Controls section: the inputs DRAWN, each key and button wearing the name of what it does,
  // rather than a table to read down. The keyboard is built from the live bindings so a rebind
  // redraws it; the pad from the chosen scheme. Both pictures are inline SVG, so they follow the
  // sheet's colours and scale with it.
  const keyName = k => ({ArrowLeft:'←',ArrowRight:'→',ArrowUp:'↑',ArrowDown:'↓',' ':'Space',Escape:'Esc'})[k]
    || (k.length === 1 ? k.toUpperCase() : k);
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // One key: a cap with its name, and the action written under it.
  const keyCap = (x, y, w, name, action, bound) =>
    `<rect class="k${bound?' bound':''}" x="${x}" y="${y}" width="${w}" height="26" rx="5"/>
     <text x="${x+w/2}" y="${y+13}">${esc(name)}</text>
     <text class="cap" x="${x+w/2}" y="${y+38}">${esc(action)}</text>`;
  function keyboardSvg() {
    const K = settings.keys, k = (x,y,w,action,name,bound=true) => keyCap(x,y,w,name,action,bound);
    const touch = typeof isNativeApp === 'function' && isNativeApp();
    return `<svg class="desktop-diagram" viewBox="0 0 440 160" role="img" aria-label="Keyboard controls">
      ${k(8,10,40,'menu','Esc',false)}${k(54,10,40,'controls','F1',false)}
      ${k(130,10,34,'foot 1',keyName(K.pin1))}${k(170,10,34,'foot 2',keyName(K.pin2))}${k(210,10,34,'foot 3',keyName(K.pin3))}
      ${k(290,10,78,'cancel swing',keyName(K.cancel))}${k(374,10,58,'end turn',keyName(K.commit))}
      ${k(130,66,34,'',keyName(K.shrink))}${k(170,66,34,'',keyName(K.grow))}<text class="cap" x="167" y="104">flat board size</text>
      ${k(290,66,50,'swing ↺',keyName(K.swingLeft))}${k(346,66,50,'swing ↻',keyName(K.swingRight))}
      ${touch
        ? `<text class="cap" x="220" y="134">Touch: tap a foot to pin it · drag another foot to swing</text>
           <text class="cap" x="220" y="150">Drag the 3D view to look around</text>`
        : `<text class="cap" x="220" y="134">Mouse: click a foot to pin it · drag another foot to swing · right-drag to look around</text>
           <text class="cap" x="220" y="150">Scroll the flat board, or drag its rim knob, to resize it</text>`}
    </svg>`;
  }
  function controllerSvg() {
    const triggers = settings.padScheme === 'triggers';
    const label = (x, y, text, anchor='middle') => `<text class="cap" x="${x}" y="${y}" style="text-anchor:${anchor}">${esc(text)}</text>`;
    const lead = (x1,y1,x2,y2) => `<line class="lead" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    // Labels sit in 110px margins either side of the pad, anchored to its edge, so nothing runs off
    // the picture; the trigger note goes underneath rather than stretching a label.
    return `<svg class="desktop-diagram" viewBox="0 0 520 224" role="img" aria-label="Controller controls">
      <rect class="body" x="160" y="60" width="200" height="110" rx="40"/>
      <rect class="k" x="180" y="34" width="52" height="16" rx="6"/><text x="206" y="42">LB</text>
      <rect class="k" x="288" y="34" width="52" height="16" rx="6"/><text x="314" y="42">RB</text>
      <rect class="k${triggers?' bound':''}" x="186" y="14" width="40" height="14" rx="5"/><text x="206" y="21">LT</text>
      <rect class="k${triggers?' bound':''}" x="294" y="14" width="40" height="14" rx="5"/><text x="314" y="21">RT</text>
      <circle class="k bound" cx="200" cy="95" r="16"/><text x="200" y="95">L</text>
      <circle class="k${triggers?'':' bound'}" cx="290" cy="135" r="16"/><text x="290" y="135">R</text>
      <rect class="k bound" x="218" y="122" width="34" height="34" rx="6"/><text x="235" y="139">✚</text>
      <circle class="k bound" cx="322" cy="80" r="9"/><text x="322" y="80">Y</text>
      <circle class="k bound" cx="340" cy="98" r="9"/><text x="340" y="98">B</text>
      <circle class="k bound" cx="322" cy="116" r="9"/><text x="322" y="116">A</text>
      <circle class="k" cx="304" cy="98" r="9"/><text x="304" y="98">X</text>
      <rect class="k bound" x="252" y="80" width="18" height="8" rx="3"/>
      ${lead(186,21,116,21)}${label(112,21,triggers?'LT · swing ↺':'LT · unused','end')}
      ${lead(180,42,116,42)}${label(112,42,'LB · smaller board','end')}
      ${lead(160,95,116,95)}${label(112,95,'left stick · camera','end')}
      ${lead(218,139,116,139)}${label(112,139,'D-pad ← → · foot','end')}
      ${lead(334,21,404,21)}${label(408,21,triggers?'RT · swing ↻':'RT · unused','start')}
      ${lead(340,42,404,42)}${label(408,42,'RB · bigger board','start')}
      ${lead(331,80,404,72)}${label(408,72,'Y · controls','start')}
      ${lead(349,98,404,98)}${label(408,98,'B · cancel swing','start')}
      ${lead(331,116,404,124)}${label(408,124,'A · pin · end turn','start')}
      ${lead(306,135,404,152)}${label(408,152,triggers?'right stick · unused':'right stick ← → · swing','start')}
      ${lead(261,80,261,186)}${label(261,194,'Start · match menu')}
      ${label(260,214,triggers?'Triggers: the harder you pull, the faster it turns':'Right stick: the further you push, the faster it turns')}
    </svg>`;
  }
  // Rebinding is a keyboard thing on desktop. The app has no keyboard, and a controller is
  // remapped by Steam Input (Steam → Settings → Controller) at the Steam level, per game, so an
  // in-game remap would only fight it.
  const canRebind = () => !(typeof isNativeApp === 'function' && isNativeApp());
  let rebindListener = null;
  function stopRebind() { if (rebindListener) { removeEventListener('keydown', rebindListener, true); rebindListener = null; } }
  function openControls() {
    stopRebind();
    const rebindRows = canRebind() ? `<div class="desktop-rebind">${KEY_ACTIONS.map(([a, what]) =>
        `<span>${esc(what)}</span><button type="button" data-rebind="${a}">${esc(keyName(settings.keys[a]))}</button>`).join('')}
      <span></span><button type="button" id="desktopKeysReset">Reset keys</button></div>
      <p class="desktop-controls-note">Click a key to change it, then press the new one. Esc and F1 stay as they are.${window.tauSteam ? ' Controllers are remapped in Steam’s own controller settings.' : ''}</p>` : '';
    showModal('Controls', `<div id="desktopKeyboardDiagram">${keyboardSvg()}</div>
      <div class="desktop-controls-scheme"><span class="desktop-controls-note" style="margin:0">Controller · swing with</span>
        <select id="desktopPadScheme" aria-label="Controller scheme"><option value="triggers">Triggers</option><option value="stick">Right stick</option></select></div>
      <div id="desktopPadDiagram">${controllerSvg()}</div>${rebindRows}`, [
      { label:'Done', onClick:() => { stopRebind(); if (inMatch()) focusBoard(); } },
    ], true, {dismiss:stopRebind});
    $('desktopPadScheme').value = settings.padScheme;
    $('desktopPadScheme').onchange = e => { settings.padScheme = e.target.value; saveSettings(); $('desktopPadDiagram').innerHTML = controllerSvg(); };
    if (!canRebind()) return;
    const redraw = () => {
      $('desktopKeyboardDiagram').innerHTML = keyboardSvg();
      for (const b of $('modalBox').querySelectorAll('[data-rebind]')) { b.textContent = keyName(settings.keys[b.dataset.rebind]); b.classList.remove('listening'); }
    };
    for (const b of $('modalBox').querySelectorAll('[data-rebind]')) b.onclick = () => {
      stopRebind(); redraw(); b.classList.add('listening'); b.textContent = '…';
      // Captured on the WINDOW so it runs before the game's own document-level keydown handler;
      // Esc backs out of the rebind without also closing the sheet.
      rebindListener = e => {
        e.preventDefault(); e.stopImmediatePropagation(); stopRebind();
        if (e.key !== 'Escape' && e.key !== 'F1') {
          const action = b.dataset.rebind;
          for (const [other] of KEY_ACTIONS) if (other !== action && settings.keys[other] === e.key) settings.keys[other] = DEFAULT_KEYS[other] === e.key ? '' : DEFAULT_KEYS[other];   // one key, one job
          settings.keys[action] = e.key; saveSettings();
        }
        redraw();
      };
      addEventListener('keydown', rebindListener, true);
    };
    $('desktopKeysReset').onclick = () => { stopRebind(); settings.keys = {...DEFAULT_KEYS}; saveSettings(); redraw(); };
  }
  // Grow or shrink the flat board. The corner layout is the only one with a board to resize, so
  // outside it this is a no-op rather than quietly moving a split nothing is showing.
  function resizeBoard(delta) {
    if (!cornerLayoutActive() || passiveView()) return;
    markSplitUsed();
    setViewSplit(Math.max(0, Math.min(1, viewSplit + delta)), true);
    saveViewSplit();
  }
  function confirmLeave() {
    showModal('Leave this match?', '', [
      {label:'Keep playing',onClick:() => focusBoard()},
      {label:'Leave match',onClick:backToMenu},
    ], false, {dismiss:true});
  }
  function openSettings() {
    const fullscreen = window.tauSteam?.setFullscreen;
    showModal('Settings', `<label class="desktop-setting desktop-volume">Sound <output id="desktopVolumeValue">${userVol}%</output><input id="desktopVolume" aria-label="Sound volume" type="range" min="0" max="200" step="5" value="${userVol}"></label>
      <label class="desktop-setting">Mute<input id="desktopMute" type="checkbox" ${soundOn?'':'checked'}></label>
      <label class="desktop-setting">Board<select id="desktopBoard">${BOARD_FINISHES.map(b=>isUnlocked(b.id)?`<option value="${b.id}">${b.name}</option>`:`<option value="${b.id}" disabled>${b.name} · ${unlockText(b.id)}</option>`).join('')}</select></label>
      ${testBoards ? '<p class="desktop-result-detail">All boards are open for testing. Type <b>ALLBOARDS</b> on the main menu to restore locks.</p>' : ''}
      <label class="desktop-setting">Graphics<select id="desktopQuality"><option value="balanced">Balanced</option><option value="high">High</option></select></label>
      <label class="desktop-setting">Invert camera Y<input id="desktopInvertY" type="checkbox" ${settings.invertCamY?'checked':''}></label>
      <label class="desktop-setting">Reduce camera motion<input id="desktopMotion" type="checkbox" ${settings.reducedMotion?'checked':''}></label>
      <label class="desktop-setting">Controller vibration<input id="desktopHaptics" type="checkbox" ${settings.haptics?'checked':''}></label>
      ${fullscreen ? '<label class="desktop-setting">Fullscreen<input id="desktopFullscreen" type="checkbox"></label>' : ''}`,
      [{label:'Done',onClick:() => { if(inMatch()) focusBoard(); }}], true, {dismiss:true});
    $('desktopQuality').value = settings.quality;
    $('desktopBoard').value = settings.board;
    $('desktopBoard').onchange = e => {
      if (!isUnlocked(e.target.value)) { e.target.value = settings.board; return; }
      settings.board=e.target.value; saveSettings();
      applyMaterials();   // rebakes the 3D surface for the new finish
      applyTheme();       // repaints the flat board from the same entry's palette
      render();
    };
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
    showModal(title, `<span class="desktop-result-mark" aria-hidden="true"></span><p class="desktop-result-detail">${detail}</p>${bodyHtml||''}${takeUnlockHtml()}`, buttons, true, {dismiss:false});
    $('modalBox').dataset.desktopResult='true';
    return true;
  }

  // A fixed seed makes the material stable across starts. Noise is visual only and never
  // consumes the random stream used by the opponents. The printed geometry comes from CFG.
  // Smooth grain coordinates shared with boards.js's detail shader. No polar angle or segmented
  // frame: those create radial joins (including a seam where atan wraps around the negative axis).
  // The board is assembled from pieces that meet at the printed curves -- the centre disc, each
  // ring band, and the six lens segments are separate boards -- and every piece was cut from its
  // plank at its own angle, so the grain turns at each joint the way a real inlaid top does. No
  // straight cuts anywhere: the joints ARE the rings and arcs. Nine pieces, each with a golden-angle
  // grain direction (neighbours never share one) and its own offset so no figure continues across
  // a joint; the gentle warp on top keeps the fibres curved. Mirrored in boards.js.
  function woodFrame(x, y, out) {
    const r = Math.hypot(x,y), r0=CFG.rings[0], r1=CFG.rings[1];
    const band = r < r0 ? 2 : r < r1 ? 1 : 0;
    const side = Math.hypot(x-CFG.sideArcs[0].cx, y-CFG.sideArcs[0].cy) < CFG.sideArcs[0].r ? 1
               : Math.hypot(x-CFG.sideArcs[1].cx, y-CFG.sideArcs[1].cy) < CFG.sideArcs[1].r ? 2 : 0;
    out.zone = band + 2 - (side ? 1 : 0);   // the flat board's zone value: 4 centre .. 1 outer lens
    const id = (2 - band) + 3*side;          // 0 centre, 1 mid ring, 2 outer ring, 3..8 the lens pieces
    const ang = (id * 2.399) % Math.PI, c = Math.cos(ang), sn = Math.sin(ang);
    const qx = c*x - sn*y + id*37, qy = sn*x + c*y + id*23;
    out.x = qx + 3.4*Math.sin(qy*0.065) + 1.6*Math.sin((qx+qy)*0.035);
    out.y = qy + 1.8*Math.sin(qx*0.05);
    return out;
  }
  function woodMaps(fin) {
    const wood = fin.wood, skin = fin.skin;
    // How much of the timber figure to print. A slate slab, a sheet of drafting paper and a living
    // membrane are not wood: at low strength the directional grain and pores fade out and only the
    // fine speckle survives, which is what those surfaces actually have.
    const grainAmt = wood.grain==null ? 1 : wood.grain;
    // The base colour per zone: the woods name a shade for each; the graded skins (Slate,
    // Dojo) use the flat board's own zone colours, so the 3D disc shades exactly as the 2D one.
    const hex = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16));
    const zones = wood.zones ? wood.zones
                : skin && skin.shadeByZoneValue ? [skin.v1, skin.v2, skin.v3, skin.v4].map(hex) : null;
    const S=window.TAU_TEST_BAKE_SIZE || 1536, cv=document.createElement('canvas'); cv.width=cv.height=S;
    const c=cv.getContext('2d'), pixels=c.createImageData(S,S), d=pixels.data;
    const sc=S/(CFG.edgeU*2), O=S/2, fr={x:0,y:0,zone:4};
    for(let y=0;y<S;y++) for(let x=0;x<S;x++) {
      let gx=x, gy=y, br=wood.base[0], bg=wood.base[1], bb=wood.base[2];
      if (zones) {
        woodFrame((x-O)/sc, (y-O)/sc, fr);
        const z = zones[fr.zone-1]; br=z[0]; bg=z[1]; bb=z[2];
        if (fin.detail === 'wood' || wood.assembled) {   // assembled: cleavage runs its own way on each piece
          gx = fr.x*sc; gy = fr.y*sc;
        }
      }
      const grain=gx+18*Math.sin(gy*.004)+7*Math.sin(gy*.012+gx*.003);
      const fine=Math.sin(grain*.26+Math.sin(gy*.013)*1.7);
      const broad=Math.sin(grain*.019+Math.sin(gy*.0018)*2.5);
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
  let envGroup = null, envFor = null, lookTheme = null;   // the showing look's surroundings, if it has any
  // Giants go over slowly: a look may slow the loser's fall (its simSpeed, floored so a match's
  // ending never drags), and the dust below runs on the same clock.
  function fallTimeScale() { return lookTheme && lookTheme.simSpeed ? Math.max(0.5, lookTheme.simSpeed) : 1; }
  // Where a fallen piece lands on this look, if it brings its own ground (null: the game's floor).
  function fallFloorY() { return lookTheme && lookTheme.floorY != null ? lookTheme.floorY : null; }
  // ---- Sand and stone: the dust a fall raises on a look that asks for it (T.dust) ----
  // Each puff is its own small point cloud thrown up from a spot: outward and up, slowed by the
  // air, settling under gravity, spreading and fading over a couple of seconds; beyond the rim
  // it keeps falling with the piece. Spawned where the loser's feet drag through the sand during
  // the slide, and in a burst where the piece meets the rim and tips.
  const puffs = [];
  function spawnDust(x, z, n, spread) {
    const T = lookTheme; if (!T || !T.dust || !scene) return;
    const pos = new Float32Array(n*3), vel = new Float32Array(n*3);
    for (let i = 0; i < n; i++) {
      const a = Math.random()*Math.PI*2, sp = spread*(0.3 + Math.random());
      pos[i*3] = x + (Math.random()-0.5)*5; pos[i*3+1] = 0.4 + Math.random()*2; pos[i*3+2] = z + (Math.random()-0.5)*5;
      vel[i*3] = Math.cos(a)*sp; vel[i*3+1] = spread*(0.4 + Math.random()*1.1); vel[i*3+2] = Math.sin(a)*sp;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const SH = showcase();
    const mat = new THREE.PointsMaterial({ color: T.dust.color, size: T.dust.size || 2.4, transparent: true,
      map: SH && SH.softDiscTexture ? SH.softDiscTexture() : null, alphaTest: 0.04,
      opacity: 0.8, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    pts.userData.dust = { vel, age: 0, life: 2.0 + Math.random()*0.8, size: T.dust.size || 2.4 };
    scene.add(pts); puffs.push(pts);
  }
  function tickDust(dt) {
    for (let k = puffs.length-1; k >= 0; k--) {
      const p = puffs[k], d = p.userData.dust, pos = p.geometry.attributes.position.array, v = d.vel;
      d.age += dt;
      const drag = Math.max(0, 1 - 1.8*dt);
      for (let i = 0; i < v.length; i += 3) {
        v[i+1] -= 40*dt; v[i] *= drag; v[i+2] *= drag;
        pos[i] += v[i]*dt; pos[i+1] += v[i+1]*dt; pos[i+2] += v[i+2]*dt;
        const floor = Math.hypot(pos[i], pos[i+2]) > CFG.edgeU ? -80 : 0.3;
        if (pos[i+1] < floor) { pos[i+1] = floor; v[i+1] = 0; }
      }
      p.geometry.attributes.position.needsUpdate = true;
      p.material.opacity = 0.8 * Math.max(0, 1 - d.age/d.life);
      p.material.size = d.size * (1 + d.age*1.3);   // the cloud spreads as it thins
      if (d.age >= d.life) { scene.remove(p); p.geometry.dispose(); p.material.dispose(); puffs.splice(k, 1); }
    }
  }
  let lastFallPhase = null, slideDustT = 0;
  function tickEffects(dt) {
    const now = performance.now()/1000;
    if (envGroup && envGroup.userData.tick) envGroup.userData.tick(now, dt);
    const phase = fall.active ? fall.phase : null;
    if (lookTheme && lookTheme.dust && fall.active && typeof tripods !== 'undefined' && tripods[fall.idx]) {
      const ts = fallTimeScale(), tp = tripods[fall.idx].position;
      if (phase === 'slide') {   // feet dragging through the sand: a puff behind the piece every so often
        slideDustT += dt*ts;
        if (slideDustT > 0.14) { slideDustT = 0;
          const d = Math.hypot(fall.vx, fall.vz) || 1;
          spawnDust(tp.x - fall.vx/d*10, tp.z - fall.vz/d*10, 26, 10); }
      }
      if (phase === 'pivot' && lastFallPhase === 'slide') {   // the rim: the big one, and the stands erupt
        spawnDust(fall.px, fall.pz, 170, 24);
        if (envGroup && envGroup.userData.excite) envGroup.userData.excite();
      }
    } else slideDustT = 0;
    lastFallPhase = phase;
    if (puffs.length) tickDust(dt * (lookTheme && lookTheme.dust ? fallTimeScale() : 1));
  }
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
  // ---- Glass through glass: the nearer piece is drawn in a second pass over the finished frame ----
  // three's transmission is screen-space: a glass surface shows the OPAQUE scene behind it, so a
  // glass leg behind another was simply not there through it. (A proxy that drew the legs into
  // that buffer was tried first; every leg then saw its own proxy and went opaque.) The answer is
  // to give the nearer piece a finished picture to look through. Pass one renders everything but
  // the piece nearest the camera into an off-screen target -- the far piece is real glass over
  // the board there; the near piece still casts its shadow, it just writes no colour. Pass two
  // paints that picture across the screen, colour and depth, and renders the near piece on top:
  // three's own transmission pass copies the painted picture into its buffer, so the near legs
  // refract the far piece exactly as they refract the board. Lights are cloned for the second
  // scene (the key light with its shadow, so the near piece still shades itself); the far
  // piece's shadow on the near one is the one thing lost. Only when two glass pieces are up.
  let gpTarget = null, gpScene = null, gpQuad = null, gpLights = [], gpFailed = false;
  const gpV = new THREE.Vector3(), gpSize = new THREE.Vector2();
  function glassPieces() {
    const out = [];
    for (const pair of [typeof tripods !== 'undefined' ? tripods : null, typeof htpTripods !== 'undefined' ? htpTripods : null])
      for (const t of pair || []) if (t && t.visible && t.userData.mat && t.userData.mat.transmission > 0) out.push(t);
    return out;
  }
  function gpSetup() {
    gpTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4,
      depthTexture: new THREE.DepthTexture(4, 4, THREE.UnsignedIntType) });
    gpQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, depthTest: false, depthWrite: true,
      uniforms: { tColor: { value: gpTarget.texture }, tDepth: { value: gpTarget.depthTexture } },
      vertexShader: 'out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'precision highp float; uniform sampler2D tColor; uniform sampler2D tDepth; in vec2 vUv;\n' +
        'layout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n' +
        'void main(){ gl_FragColor = texture(tColor, vUv); gl_FragDepth = texture(tDepth, vUv).r;\n' +
        '#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' }));
    gpQuad.frustumCulled = false; gpQuad.renderOrder = -1;
    gpScene = new THREE.Scene(); gpScene.add(gpQuad);
    gpLights = [];
    scene.traverse(o => { if (o.isLight) { const c = o.clone(); gpLights.push([o, c]); gpScene.add(c); if (c.target) gpScene.add(c.target); } });
  }
  function renderFrame() {
    if (!renderer || !camera || gpFailed) return false;
    const pieces = glassPieces();
    if (pieces.length < 2) return false;
    try {
      if (!gpTarget) gpSetup();
      pieces.forEach(t => t.updateMatrixWorld());
      pieces.sort((a, b) => camera.position.distanceToSquared(a.getWorldPosition(gpV)) - camera.position.distanceToSquared(b.getWorldPosition(gpV)));
      const near = pieces[0];
      renderer.getDrawingBufferSize(gpSize);
      if (gpTarget.width !== gpSize.x || gpTarget.height !== gpSize.y) gpTarget.setSize(gpSize.x, gpSize.y);
      // pass one: the world without the near piece's colour (its shadow still falls)
      const mats = [], seen = new Set();   // the feet share the hub's material: save each once
      near.traverse(o => { const m = o.material; if (m && !seen.has(m)) { seen.add(m); mats.push([m, m.colorWrite, m.depthWrite]); m.colorWrite = false; m.depthWrite = false; } });
      renderer.setRenderTarget(gpTarget); renderer.render(scene, camera);
      for (const [m, cw, dw] of mats) { m.colorWrite = cw; m.depthWrite = dw; }
      // pass two: that picture, then the near piece through it
      const parent = near.parent; parent.remove(near); gpScene.add(near);
      for (const [o, c] of gpLights) { c.position.copy(o.position); c.intensity = o.intensity; c.color.copy(o.color); if (o.groundColor) c.groundColor.copy(o.groundColor); }
      gpScene.environment = scene.environment; gpScene.fog = scene.fog;
      renderer.setRenderTarget(null); renderer.render(gpScene, camera);
      gpScene.remove(near); parent.add(near);
      return true;
    } catch (e) {
      gpFailed = true; console.warn('glass two-pass render unavailable', e);
      try { renderer.setRenderTarget(null); } catch (_) {}
      return false;
    }
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
  // What each board is made of, for the ear: the piece material sets the pick-up click, the move
  // thump and the rim impact; the surface bakes the sweep's own noise and sets the room.
  const ACOUSTICS_BY_BOARD = {
    walnut:['metal','wood'], ebony:['metal','wood'], maple:['metal','wood'], cosy:['metal','wood'],
    dark:['metal','slate'], slate:['metal','slate'], dojo:['metal','wood'], yellow:['metal','paper'],
    noir:['glass','slate'], math:['graphite','paper'], sumo:['wood','clay'], alien:['chitin','membrane'],
    colossus:['stone','sand'], marble:['glass','marble'],
  };
  function applyMaterials() {
    const fin=finish();
    if (typeof setAcoustics === 'function') { const a = ACOUSTICS_BY_BOARD[fin.id] || ['metal','wood']; setAcoustics(a[0], a[1]); }
    if(!renderer || !boardTop) return;
    const bm = boardTop.material;
    const SH = showcase();
    const T = SH && fin.showcase ? SH.THEMES[fin.showcase] : null;
    // The per-pixel surface pass lives on the board material once, whichever look is showing; its
    // mode uniform selects grain / marble / membrane / nothing per frame (see pollInput), and the
    // Math board's live construction rides on the same program.
    if (SH && !detail) detail = SH.installDetailShader(bm);
    if (T) {
      // A showcase look: its own bake, three or four maps, as the showcase page applies them. Baked
      // once per look and disposed on the way out -- each is a full-size canvas set.
      if (showMapsFor !== fin.id) {
        if (showMaps) for (const k in showMaps) showMaps[k] && showMaps[k].dispose();
        const maps = T.paint();
        SH.shadeZones(maps.albedo.getContext('2d'), T.zoneGrade == null ? 1 : T.zoneGrade);
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
        textures=woodMaps(fin); texturesFor=fin.id;
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
    // A look's surroundings come into the match with it and leave with it: Colossus's ground and
    // its haze (fog grades with distance, so the board stays clear and the far wall half-vanishes).
    const envWant = T && T.env ? fin.id : null;
    if (envFor !== envWant) {
      if (envGroup) {
        scene.remove(envGroup);
        envGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
        envGroup = null;
      }
      if (envWant) { envGroup = T.env(); scene.add(envGroup); }
      envFor = envWant;
    }
    scene.fog = T && T.fog ? new THREE.FogExp2(T.fog.color, T.fog.density) : null;
    lookTheme = T;
    if (typeof fallFloor !== 'undefined' && fallFloor) fallFloor.visible = !(T && T.floorY != null);   // the look's own ground replaces the black floor
    detailMode = fin.detail==='wood' ? 1 : fin.detail==='marble' ? 2 : fin.detail==='alien' ? 3 : 0;
    mathLive = fin.id === 'math';
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
    const fovWant = T && T.gameCam && T.gameCam.fov ? T.gameCam.fov : 38;   // a look's own lens (Colossus)
    if (camera.fov !== fovWant) { camera.fov = fovWant; camera.updateProjectionMatrix(); }
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
  // The home panel never scrolls: on a window too short for it, the whole panel scales down to
  // fit (about its left-centre, where it is anchored), leaving room above and for the account line
  // beneath it. Measured with the transform off, so the natural height is what is compared.
  // A narrow screen (the phone app, and a very narrow window) lays the panel out the other way --
  // presentation.css anchors it to the BOTTOM under the board, with the room's gradient darkened
  // behind it. The centring translate must not come back with the scale there: an inline transform
  // beats the stylesheet's transform:none, which lifted the whole menu half its own height up into
  // the board and left the bottom of the phone empty.
  function fitHome() {
    home.style.transform = '';
    const natural = home.offsetHeight;
    if (!natural) return;
    const centred = !matchMedia('(max-width:600px)').matches;
    // Centred: the panel owns the window's height. Bottom-anchored: it owns what is under the
    // board (the 53% tile in layout(), plus the gradient's fade, which it may sit slightly over).
    const room = centred ? innerHeight - 110 : innerHeight * 0.55 - 60;
    const s = Math.min(1, room / natural);
    home.style.transformOrigin = centred ? '0 50%' : '0 100%';
    home.style.transform = centred ? `translateY(-50%) scale(${s.toFixed(4)})` : `scale(${s.toFixed(4)})`;
  }
  function layout() {
    root.classList.toggle('desktop-watching', inMatch() && passiveView());
    if(htp3DActive || $('htpFull')) return false;
    if(!inMatch()) fitHome();
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
    // The corner layout positions the 3D tile with inline offsets and clears them in the game's own
    // resize(), which the menu never reaches (this returns true first). Left in place they pushed
    // the view past the window's edge -- the home screen with scrollbars -- so they go here.
    cv.style.left=cv.style.top=cv.style.right=cv.style.bottom='';
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
      // The menu's ambient tile is nearly square on a phone (full width, half the height), where a
      // distance tuned for a wide window crops the dish and slices the pieces off at the top edge.
      // Fit the dish across the tile the same way cornerDistance does; on any window wide enough for
      // the established look the floor still wins, so the desktop framing is untouched.
      const fitWide = CFG.edgeU / (0.92 * Math.tan(camera.fov * Math.PI / 360) * ratio);
      distance = menu ? Math.max(222, fitWide) : Math.max(205, 148/ratio);
    }
    const yaw=menu && !settings.reducedMotion ? .18+Math.sin(performance.now()*.000055)*.045 : 0;
    if(falling && !settings.reducedMotion && G.winner!=null){
      const p=tripods[fall.idx].position;
      tx=Math.max(-24,Math.min(24,p.x*.25)); tz=Math.max(-24,Math.min(24,p.z*.25)); distance+=18;
    }
    outTarget.set(tx,ty,tz);
    // The elevation is the boards' usual 44 degrees unless the showing look asks for its own
    // (Colossus sits lower, to take in the bank); a wider lens keeps the dish the same size.
    const gc = lookTheme && lookTheme.gameCam;
    const elev = gc && gc.elev ? gc.elev : 0.765;
    if (gc && gc.fov) distance *= Math.tan(19*Math.PI/180) / Math.tan(gc.fov*Math.PI/360);
    outPos.set(tx+Math.sin(yaw)*distance*Math.cos(elev),ty+distance*Math.sin(elev),tz+Math.cos(yaw)*distance*Math.cos(elev));
  }
  function updateCamera(dt, falling=false) {
    if(!renderer || htp3DActive) return false;
    // The corner layout renders the whole window and aims the camera at its solved tile with a
    // view offset (index.html's applyCornerViewOffset); anywhere else this clears a stale one.
    if (typeof applyCornerViewOffset === 'function') applyCornerViewOffset(camera); else camera.clearViewOffset();
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
      // Math: every foot's pivot-sweep circle, read off the RENDERED pieces (local foot positions
      // through the mesh's own transform), so the construction glides with the eased swing rather
      // than jumping to the rule engine's end pose.
      u.uMath.value = mathLive ? 1 : 0;
      if (mathLive && typeof tripods !== 'undefined') tripods.forEach((t, pi) => {
        t.updateMatrixWorld();
        for (let k = 0; k < 3; k++) {
          footTmp.set(Math.cos(k*2*Math.PI/3)*CFG.footR, 0, Math.sin(k*2*Math.PI/3)*CFG.footR);
          t.localToWorld(footTmp);
          u.uFeet.value[pi*3+k].set(t.visible ? footTmp.x : 1e4, t.visible ? footTmp.z : 1e4);
        }
      });
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
    } else { padButtons=[]; padAxisLatch=false; }
    if(heldLeft||heldRight)swing((heldRight?1:0)-(heldLeft?1:0),dt);
    tickEffects(dt);
  }
  document.addEventListener('keydown',e=>{
    if($('htpFull'))return;
    boardCheat(e);
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
    const K=settings.keys, pinIdx=[K.pin1,K.pin2,K.pin3].indexOf(e.key);
    if(pinIdx>=0){e.preventDefault();chooseFoot(pinIdx);if(G.pinned===null)pinOrCommit();}
    if(e.key===K.swingLeft||e.key===K.swingRight){
      e.preventDefault(); heldLeft=e.key===K.swingLeft; heldRight=e.key===K.swingRight;
      // A quick tap is a useful precision step; holding continues smoothly on animation frames.
      if(!e.repeat)swing(heldRight?1:-1,.08);
    }
    if(e.key===K.commit&&!e.repeat){e.preventDefault();pinOrCommit();}
    if(e.key===K.cancel){e.preventDefault();cancelSwing();}
    if(e.key===K.shrink){e.preventDefault();resizeBoard(-0.06);}
    if(e.key===K.grow){e.preventDefault();resizeBoard(+0.06);}
  },true);
  addEventListener('keyup',e=>{if(e.key===settings.keys.swingLeft)heldLeft=false;if(e.key===settings.keys.swingRight)heldRight=false;});
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
    get menuOpen(){return dialogOpen();},
    startMatch,
    get keys(){return {...settings.keys};},
    get skin(){return finish().skin;},
    get padScheme(){return settings.padScheme;},
    set padScheme(v){ if(PAD_SCHEMES.includes(v)){ settings.padScheme=v; saveSettings(); } },
    get invertCamY(){return settings.invertCamY;},
    set invertCamY(v){ settings.invertCamY=!!v; saveSettings(); },
    get board(){return settings.board;},
    set board(v){ if(BOARD_FINISHES.some(b=>b.id===v)){ settings.board=v; saveSettings(); applyMaterials(); applyTheme(); render(); } },
    get boards(){return BOARD_FINISHES.map(b=>({id:b.id,name:b.name,unlocked:isUnlocked(b.id),unlock:unlockText(b.id)}));},
    get progress(){return {...progress};},
    recordResult,
    debugDetailMode(){ return detailMode; },
    resize:layout, updateCamera, tick:pollInput, applyMaterials, showResult, fallTimeScale, fallFloorY, renderFrame,
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
      // No pause here: the opponent keeps playing under the menu (see openPause). Input to the
      // board is blocked by the open dialog itself (canPlay / inputBlocked check dialogOpen).
      requestAnimationFrame(()=>{if(dialogOpen())(focusable($('modalBtns'))[0]||focusable($('modalBox'))[0])?.focus();});
    },
    onModalHidden(){setPaused(false);if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});previousFocus=null;},
  };
  saveSettings(); applyTheme(); resize();
  if(!inMatch())$('desktopPlay').focus({preventScroll:true});
})();
