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
    if (n.wins) return n.wins > 1 ? tf('win {n} games', {n:n.wins}) : t('win 1 game');
    if (n.played) return tf('play {n} games', {n:n.played});
    return n.level >= LADDER_N ? t('beat the top ladder level') : tf('beat ladder level {n}', {n:n.level});
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
    const names = `<b>${pendingUnlocks.map(b=>b.name).join(', ')}</b>`;
    const html = `<p class="desktop-unlock">${pendingUnlocks.length>1 ? tf('New boards unlocked: {names}',{names}) : tf('New board unlocked: {name}',{name:names})}</p>`;
    pendingUnlocks = []; return html;
  }
  function toastUnlocks() {
    showToast(takeUnlockHtml());
  }
  function showToast(html) {
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
    showToast(`<p class="desktop-unlock">${testBoards
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
  const settings = { level:4, colour:0, quality:'balanced', board:'walnut', padScheme:'triggers', padBrand:'auto',
    invertCamY:false, keys:{...DEFAULT_KEYS}, rayTrace:false,
    reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches, haptics:true };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (saved.keys && typeof saved.keys === 'object')
      for (const [action] of KEY_ACTIONS) if (typeof saved.keys[action] === 'string' && saved.keys[action]) settings.keys[action] = saved.keys[action];
    if (Number.isInteger(saved.level) && saved.level >= 1 && saved.level <= LADDER_N) settings.level = saved.level;
    if (saved.colour === 0 || saved.colour === 1) settings.colour = saved.colour;
    if (['balanced','high','ultra'].includes(saved.quality)) settings.quality = saved.quality;
    if (BOARD_FINISHES.some(b => b.id === saved.board) && isUnlocked(saved.board)) settings.board = saved.board;
    if (PAD_SCHEMES.includes(saved.padScheme)) settings.padScheme = saved.padScheme;
    if (['auto','xbox','playstation','nintendo','generic'].includes(saved.padBrand)) settings.padBrand = saved.padBrand;
    for (const k of ['reducedMotion','haptics','invertCamY','rayTrace']) if (typeof saved[k] === 'boolean') settings[k] = saved[k];
    settings.rayTrace = settings.quality === 'ultra';   // one switch, not two that can disagree
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
  let currentPad = null, padList = [], padPrev = [], padFocus = 0;
  // A direction from a pad, however that pad expresses one. The standard mapping puts the D-pad on
  // buttons 12-15, but a controller the browser has no table for (DirectInput, adapters) reports an
  // empty mapping and puts its D-pad on a HAT AXIS instead, and its sticks wherever it likes. Such a
  // pad answered nothing at all: no menu navigation, and no way to change which foot is chosen --
  // which is why the only way to find out what was selected was to press A and see what got pinned.
  // Buttons, stick and hat all feed the same answer here.
  const PAD_DEAD = 0.55;
  function padHat(pad) {
    // The 8-way hat DirectInput pads report as one axis: -1 up, stepping clockwise in sevenths,
    // with a centre value outside [-1,1] (commonly 3.28) or exactly 0 on some.
    for (let i = 4; i < pad.axes.length; i++) {
      const v = pad.axes[i];
      if (typeof v !== 'number' || v === 0 || v < -1.05 || v > 1.05) continue;
      const step = (v + 1) * 3.5;
      if (Math.abs(step - Math.round(step)) > 0.12) continue;   // a real stick lands between steps
      const k = Math.round(step) % 8;
      return { x: [0,1,1,1,0,-1,-1,-1][k], y: [-1,-1,0,1,1,1,0,-1][k] };
    }
    return null;
  }
  function padDir(pad) {
    const btn = i => !!pad.buttons[i]?.pressed;
    const hat = padHat(pad);
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    return {
      x: btn(15) ? 1 : btn(14) ? -1 : (hat && hat.x) || (Math.abs(ax) > PAD_DEAD ? Math.sign(ax) : 0),
      y: btn(13) ? 1 : btn(12) ? -1 : (hat && hat.y) || (Math.abs(ay) > PAD_DEAD ? Math.sign(ay) : 0),
    };
  }
  // Who holds what in a local 1v1, one device per colour, as answered on the "choose your controls"
  // screen: {kind:'pad', index, brand} or {kind:'kbm'}. Empty in every other kind of match.
  let seats = [null, null];
  // Who is pressing, for index.html's one input gate (see seatBlocks): pollInput tags its pad work
  // 'pad', and everything else -- keys, mouse, touch -- arrives as the keyboard-and-mouse seat.
  let inputDevice = 'kbm';
  const KBM = { kind:'kbm' };
  const padSeat = p => ({ kind:'pad', index:p.index, brand:padBrandOf(p.id) });
  const sameDevice = (a, b) => !!a && !!b && a.kind === b.kind && (a.kind !== 'pad' || a.index === b.index);
  // The seats only GATE anything when the two colours sit on DIFFERENT devices. One device on both
  // sides is pass and play, where every input belongs to whoever is to move.
  function splitSeats() {
    if (!seats[0] || !seats[1] || sameDevice(seats[0], seats[1]) || !inMatch()) return false;
    // A pad unplugged mid-match must not strand its player: with a seated pad gone the gate comes
    // off and both colours share whatever is still connected.
    return seats.every(s => s.kind !== 'pad' || padList.some(p => p.index === s.index));
  }
  const activeSeat = () => splitSeats() ? seats[G.active] : null;
  const seatBlocks = device => { const s = activeSeat(); return !!s && s.kind !== device; };
  // The pad allowed to act: the active colour's own pad on split seats, otherwise the first one
  // plugged in. Rumble and the trigger reads follow it.
  // One pad's turn at the menus. Kept apart from the in-match branch because the rules differ: a
  // menu belongs to whoever reaches for a controller, a piece belongs to the colour whose turn it is.
  function padMenu(pad, prev, context) {
    const down=i=>!!pad.buttons[i]?.pressed, pressed=i=>down(i)&&!prev[i];
    const els=focusable(context), dir=padDir(pad), was=prev.dir||{x:0,y:0};
    const move=dir.y && dir.y!==was.y ? dir.y : 0;   // one step per push, however the pad sends it
    if(move && els.length){
      const current=els.indexOf(document.activeElement);
      padFocus=(Math.max(0,current)+move+els.length)%els.length;
      els[padFocus].focus();
      // A pad moving focus has to LOOK like it moved focus. The premium ring is :focus-visible,
      // which Chromium only grants when it judges focus should be shown -- a programmatic .focus()
      // after the player last touched a mouse does not qualify, so the pad was quietly walking an
      // invisible cursor down the menu and nothing on screen changed. This flag says "a controller
      // is driving now", and the mouse takes it away again.
      root.classList.add('desktop-pad-nav');
    }
    const el=document.activeElement;
    if(el?.tagName==='SELECT' && (pressed(14)||pressed(15))){el.selectedIndex=Math.max(0,Math.min(el.options.length-1,el.selectedIndex+(pressed(15)?1:-1)));el.dispatchEvent(new Event('change',{bubbles:true}));}
    if(el?.type==='range' && (pressed(14)||pressed(15))){el.value=String(Math.max(Number(el.min),Math.min(Number(el.max),Number(el.value)+(pressed(15)?1:-1)*Number(el.step||1))));el.dispatchEvent(new Event('input',{bubbles:true}));}
    if(pressed(0)){const target=els.includes(el)?el:els[0];if(target?.tagName!=='SELECT')target?.click();}
    if(pressed(1)&&dialogOpen()&&modalDismiss)modalDismiss();
    if(pressed(1)&&$('htpFull'))$('htpClose')?.click();
  }
  addEventListener('pointermove', () => root.classList.remove('desktop-pad-nav'), { passive: true });
  addEventListener('pointerdown', () => root.classList.remove('desktop-pad-nav'), { passive: true });
  function actingPad() {
    const s = activeSeat();
    if (!s) return currentPad;
    return s.kind === 'pad' ? padList.find(p => p.index === s.index) || null : null;
  }
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
  // The web app's menu, in the same words and the same order, on the premium presentation: the
  // gold Play (with its opponent and colour) up top, then the web's own entries. "Local 1v1" lives
  // inside 1v1 exactly as it does there, and Watch IS the replays screen, so neither gets a second
  // door here. No tagline or caption under the logo: the board behind it says what the game is.
  // The words are left out of the markup and painted by relabelHome: this menu is built once, at
  // load, and has to answer a language change that happens while it is on screen.
  home.innerHTML = `<img class="desktop-logo" src="tau-logo.png" alt="Tau" width="220" height="62">
    <button class="desktop-primary" id="desktopPlay"></button>
    <div class="desktop-choices">
      <label><span id="desktopLevelLabel"></span><select id="desktopLevel"></select></label>
      <label><span id="desktopColourLabel"></span><select id="desktopColour"><option value="0"></option><option value="1"></option></select></label>
    </div>
    <nav class="desktop-links" id="desktopLinks">
      <button id="desktopOnline">1v1</button>
      <button id="desktopWatch"></button>
      <button id="desktopLearn"></button>
      <button id="desktopLeaderboard"></button>
    </nav>
    <div class="desktop-home-bottom"><button id="desktopSettings"></button><button id="desktopControls"></button><button id="desktopLab"></button><button id="desktopQuit" hidden></button></div>`;
  $('menu').appendChild(home);
  if (!renderer) root.classList.add('desktop-overhead');
  const toolbar = document.createElement('div');
  toolbar.className = 'desktop-toolbar';
  toolbar.innerHTML = `<button class="desktop-brand" id="desktopHome">TAU</button>
    <button class="desktop-menu" id="desktopPause"><span id="desktopPauseLabel"></span> <kbd>Esc</kbd></button>`;
  document.body.appendChild(toolbar);
  for (let n=1;n<=LADDER_N;n++) {
    const opt = document.createElement('option'); opt.value = String(n);
    $('desktopLevel').appendChild(opt);
  }
  // Every label this layer paints once and keeps. Re-run whenever the language changes; the sheets
  // and the device-pick screen are built as they open, so they need nothing here.
  function relabelHome() {
    const set = (id, text) => { $(id).textContent = text; };
    home.setAttribute('aria-label', t('Main menu'));
    set('desktopPlay', t('Play'));
    set('desktopLevelLabel', t('Opponent'));
    set('desktopColourLabel', t('You play'));
    $('desktopLevel').setAttribute('aria-label', t('Opponent level'));
    $('desktopColour').setAttribute('aria-label', t('Your colour'));
    $('desktopColour').options[0].textContent = t('Blue · first');
    $('desktopColour').options[1].textContent = t('Red · second');
    for (const opt of $('desktopLevel').options) opt.textContent = tf('Level {n}', { n: opt.value });
    $('desktopLinks').setAttribute('aria-label', t('Other ways to play'));
    set('desktopWatch', t('Watch')); set('desktopLearn', t('How to play'));
    set('desktopLeaderboard', t('Leaderboard'));
    set('desktopSettings', t('Settings')); set('desktopControls', t('Controls'));
    if ($('desktopLab')) set('desktopLab', t('Lab'));
    set('desktopQuit', t('Quit'));
    set('desktopPauseLabel', t('Menu'));
    $('desktopHome').setAttribute('aria-label', t('Open pause menu'));
    $('view3d').setAttribute('aria-label', t('Game board. Click a foot to pin it, then drag another foot to swing. Keyboard: 1 to 3 pin, arrow keys swing, Enter ends the turn.'));
    canvas.setAttribute('aria-label', t('Overhead game board. Keyboard: 1 to 3 pin, arrow keys swing, Enter ends the turn.'));
  }
  $('desktopLevel').value = String(settings.level); $('desktopColour').value = String(settings.colour);
  $('desktopLevel').addEventListener('change', e => { settings.level = Number(e.target.value); saveSettings(); });
  $('desktopColour').addEventListener('change', e => { settings.colour = Number(e.target.value); saveSettings(); });

  function startMatch(local = false) {
    // Two people at one screen say who holds what before the board appears; every other match has
    // one human and starts straight away.
    if (local) chooseDevices(() => beginMatch(true));
    else beginMatch(false);
  }
  function beginMatch(local) {
    if (local) startGame(false);
    else startLadderLevel(settings.level - 1, settings.colour);
    ownMatch = true;
    // A same-screen board game has no network opponent waiting on a deadline.
    if (local) onlineTurnDeadline = null;
    focusBoard();
  }
  // A first-time player is offered the rules here too, the same as on the web menu.
  $('desktopPlay').onclick = () => (typeof offerHowToFirst === 'function' ? offerHowToFirst(() => startMatch()) : startMatch());
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
  // The Lab is a developer drop-target for neural-net models. It has no place in a shipped game, so
  // it only exists where it is actually used: a browser, never the packaged Steam or app build.
  if (window.TAU_DESKTOP && (window.tauSteam || (typeof isNativeApp === 'function' && isNativeApp()))) {
    $('desktopLab').remove();
  } else {
    $('desktopLab').onclick = () => { if (typeof labOpenDrop === 'function') labOpenDrop(); };
  }
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
    showModal(t('Match menu'), '', [
      { label:t('Continue'), onClick:() => focusBoard() },
      { label:t('Controls'), onClick:openControls },
      { label:t('Settings'), onClick:openSettings },
      { label:t('How to play'), onClick:() => $('howToPlayBtn').click() },
      { label:t('Leave match'), onClick:confirmLeave },
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
  // ---- The Controls sheet: pictures of the inputs, each key or button wearing what it does ----
  // Below 700px of window the pictures lose their side margins: the keyboard becomes a key-then-
  // meaning list and the pad is drawn bare with its legend underneath, so nothing shrinks to a
  // smudge on a phone or a small window.
  const compactSheet = () => matchMedia('(max-width: 700px)').matches;
  // One key: a cap with its name, and the action written under it. On desktop the cap is the
  // rebind button itself -- click it on the picture, press the new key.
  const keyCap = (x, y, w, name, action, bound, rebind) =>
    `<g${rebind ? ` data-rebind="${rebind}" tabindex="0" role="button"` : ''}>
     <rect class="k${bound?' bound':''}" x="${x}" y="${y}" width="${w}" height="40" rx="7"/>
     <text class="key" x="${x+w/2}" y="${y+20}">${esc(name)}</text>
     <text class="cap" x="${x+w/2}" y="${y+56}">${esc(action)}</text></g>`;
  function keyboardSvg() {
    const K = settings.keys, rb = canRebind();
    const k = (x,y,w,action,a) => keyCap(x,y,w,keyName(K[a]),action,true,rb ? a : '');
    return `<svg class="desktop-diagram" viewBox="0 0 760 170" role="img" aria-label="${esc(t('Keyboard controls'))}">
      ${keyCap(16,10,58,'Esc',t('menu'),false,'')}${keyCap(82,10,58,'F1',t('controls'),false,'')}
      ${k(186,10,52,t('foot 1'),'pin1')}${k(246,10,52,t('foot 2'),'pin2')}${k(306,10,52,t('foot 3'),'pin3')}
      ${k(404,10,130,t('cancel swing'),'cancel')}${k(544,10,120,t('end turn'),'commit')}
      ${k(186,96,52,'','shrink')}${k(246,96,52,'','grow')}<text class="cap" x="242" y="152">${esc(t('flat board size'))}</text>
      ${k(404,96,88,t('swing ↺'),'swingLeft')}${k(500,96,88,t('swing ↻'),'swingRight')}
    </svg>`;
  }
  function keyboardList() {
    const rb = canRebind();
    const rows = [['Esc',t('Menu'),''],['F1',t('Controls'),''], ...KEY_ACTIONS.map(([a, what]) => [keyName(settings.keys[a]), t(what), a])];
    return `<div class="desktop-controls">${rows.map(([key, what, a]) =>
      `<div class="desktop-controls-row"><kbd${a && rb ? ` data-rebind="${a}" tabindex="0" role="button"` : ''}>${esc(key)}</kbd><span>${esc(what)}</span></div>`).join('')}</div>`;
  }
  // Xbox and Nintendo pads put the left stick up top and the D-pad below it; PlayStation and most
  // generic pads put both sticks at the bottom with the D-pad up top. The face buttons carry each
  // maker's own names, and the browser's standard mapping already lines them up by POSITION
  // (0 bottom, 1 right, 2 left, 3 top), so only the labels change between brands, never what a
  // button does. Which picture to draw comes from the connected pad's id string unless the
  // player picks one, and with nothing plugged in the picture is an Xbox pad, the common one.
  const PAD_BRANDS = ['auto','xbox','playstation','nintendo','generic'];
  const BRAND_NAMES = { xbox:'Xbox', playstation:'PlayStation', nintendo:'Nintendo', generic:'Generic' };
  function padBrandOf(id) {
    const s = String(id || '').toLowerCase();
    if (/playstation|dualshock|dualsense|054c|sony/.test(s)) return 'playstation';
    if (/nintendo|switch|joy-con|057e/.test(s)) return 'nintendo';
    if (/xbox|x-box|xinput|045e|microsoft/.test(s)) return 'xbox';
    return 'generic';
  }
  const detectedPadBrand = () => currentPad ? padBrandOf(currentPad.id) : 'xbox';
  const padBrand = () => settings.padBrand === 'auto' ? detectedPadBrand() : settings.padBrand;
  const BRAND_KEYS = {   // what each maker prints on the buttons, by position
    xbox:        { top:'Y', right:'B', bottom:'A', left:'X', lb:'LB', rb:'RB', lt:'LT', rt:'RT', menu:'Menu', view:'View', sticksLow:false },
    nintendo:    { top:'X', right:'A', bottom:'B', left:'Y', lb:'L', rb:'R', lt:'ZL', rt:'ZR', menu:'+', view:'−', sticksLow:false },
    playstation: { top:'△', right:'○', bottom:'✕', left:'□', lb:'L1', rb:'R1', lt:'L2', rt:'R2', menu:'Options', view:'Create', sticksLow:true },
    generic:     { top:'4', right:'2', bottom:'1', left:'3', lb:'L1', rb:'R1', lt:'L2', rt:'R2', menu:'Start', view:'Select', sticksLow:true },
  };
  // What each control does, as [name, meaning]; the side-labelled picture and the legend both read it.
  function padBindings(B, triggers) {
    return { lt:[B.lt, triggers?t('swing ↺'):t('unused')], lb:[B.lb,t('smaller board')], ls:[t('left stick'),t('camera')], dp:[t('D-pad ← →'),t('foot')],
      rt:[B.rt, triggers?t('swing ↻'):t('unused')], rb:[B.rb,t('bigger board')], top:[B.top,t('controls')], right:[B.right,t('cancel swing')],
      bottom:[B.bottom,t('pin · end turn')], rs: triggers ? [t('right stick'),t('unused')] : [t('right stick ← →'),t('swing')], menu:[B.menu,t('match menu')] };
  }
  // Xbox-style body: a wide rounded top and two grips, around the centre line x = c.
  const padBodyPath = c => `M${c-130},90 C${c-90},66 ${c+90},66 ${c+130},90 C${c+170},104 ${c+200},160 ${c+208},210
    C${c+216},262 ${c+198},302 ${c+168},306 C${c+138},310 ${c+118},272 ${c+104},252 C${c+80},228 ${c-80},228 ${c-104},252
    C${c-118},272 ${c-138},310 ${c-168},306 C${c-198},302 ${c-216},262 ${c-208},210 C${c-200},160 ${c-170},104 ${c-130},90 Z`;
  // Where a brand's sticks, D-pad and face cluster sit, as [x, y] on that same centre line.
  const padParts = (B, c) => ({ ls: B.sticksLow ? [c-50,202] : [c-105,132], rs: [c+50,202],
    dp: B.sticksLow ? [c-105,132] : [c-50,202], fc: [c+105,132] });
  function controllerSvg(brand = padBrand(), compact = false) {
    const B = BRAND_KEYS[brand] || BRAND_KEYS.generic, triggers = settings.padScheme === 'triggers', L = padBindings(B, triggers);
    const c = 380;   // the pad's centre line; labels sit in the margins either side, anchored to its edge
    const txt = ([name, what]) => `${name} · ${what}`;
    const label = (x, y, key, anchor) => compact ? '' : `<text x="${x}" y="${y}" style="text-anchor:${anchor}">${esc(txt(L[key]))}</text>`;
    const lead = (x1,y1,x2,y2) => compact ? '' : `<line class="lead" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    const stick = (x, y, bound) => `<circle class="k${bound?' bound':''}" cx="${x}" cy="${y}" r="24"/><circle class="k" cx="${x}" cy="${y}" r="13"/>`;
    const dpad = (x, y) => `<rect class="k bound" x="${x-7}" y="${y-23}" width="14" height="46" rx="3"/><rect class="k bound" x="${x-23}" y="${y-7}" width="46" height="14" rx="3"/>`;
    const face = (x, y, name, bound) => `<circle class="k${bound?' bound':''}" cx="${x}" cy="${y}" r="13"/><text x="${x}" y="${y}">${esc(name)}</text>`;
    const pill = (x, y, w, name, bound) => `<rect class="k${bound?' bound':''}" x="${x-w/2}" y="${y-9}" width="${w}" height="18" rx="9"/><text x="${x}" y="${y}">${esc(name)}</text>`;
    const body = `<path class="body" d="${padBodyPath(c)}"/>`;
    const P = padParts(B, c), LS = P.ls, RS = P.rs, DP = P.dp, FC = P.fc;
    const centreBits = brand === 'playstation'
      ? `<rect class="k" x="${c-40}" y="88" width="80" height="46" rx="8"/><text class="cap" x="${c}" y="111">${esc(t('touch pad'))}</text>
         <rect class="k" x="${c-64}" y="94" width="10" height="26" rx="5"/><rect class="k bound" x="${c+54}" y="94" width="10" height="26" rx="5"/>
         <circle class="k" cx="${c}" cy="160" r="9"/>`
      : brand === 'generic'
      ? `${pill(c-34, 132, 48, B.view, false)}${pill(c+34, 132, 48, B.menu, true)}`
      : `<circle class="k" cx="${c}" cy="98" r="13"/>${face(c-32, 132, B.view === '−' ? '−' : '⧉', false)}${face(c+32, 132, B.menu === '+' ? '+' : '≡', true)}`;
    const menuPoint = brand === 'playstation' ? [c+59, 94] : brand === 'generic' ? [c+34, 123] : [c+32, 119];
    const view = compact ? '160 14 440 300' : '0 0 760 316';
    return `<svg class="desktop-diagram${compact?' compact':''}" viewBox="${view}" role="img" aria-label="${esc(tf('{brand} controls', {brand: BRAND_NAMES[brand] || t('Controller')}))}">
      ${body}
      <rect class="k" x="${c-150}" y="52" width="80" height="18" rx="9"/><text x="${c-110}" y="61">${esc(B.lb)}</text>
      <rect class="k" x="${c+70}" y="52" width="80" height="18" rx="9"/><text x="${c+110}" y="61">${esc(B.rb)}</text>
      <rect class="k${triggers?' bound':''}" x="${c-140}" y="22" width="60" height="22" rx="8"/><text x="${c-110}" y="33">${esc(B.lt)}</text>
      <rect class="k${triggers?' bound':''}" x="${c+80}" y="22" width="60" height="22" rx="8"/><text x="${c+110}" y="33">${esc(B.rt)}</text>
      ${stick(LS[0], LS[1], true)}${stick(RS[0], RS[1], !triggers)}${dpad(DP[0], DP[1])}
      ${face(FC[0], FC[1]-28, B.top, true)}${face(FC[0]-28, FC[1], B.left, false)}${face(FC[0]+28, FC[1], B.right, true)}${face(FC[0], FC[1]+28, B.bottom, true)}
      ${centreBits}
      ${lead(c-140,33,232,33)}${label(224,33,'lt','end')}
      ${lead(c-150,61,232,61)}${label(224,61,'lb','end')}
      ${lead(LS[0]-24,LS[1],232,LS[1])}${label(224,LS[1],'ls','end')}
      ${lead(DP[0]-23,DP[1],232,DP[1])}${label(224,DP[1],'dp','end')}
      ${lead(c+140,33,528,33)}${label(536,33,'rt','start')}
      ${lead(c+150,61,528,61)}${label(536,61,'rb','start')}
      ${lead(FC[0]+13,FC[1]-28,528,FC[1]-28)}${label(536,FC[1]-28,'top','start')}
      ${lead(FC[0]+41,FC[1],528,FC[1])}${label(536,FC[1],'right','start')}
      ${lead(FC[0]+13,FC[1]+28,528,FC[1]+28)}${label(536,FC[1]+28,'bottom','start')}
      ${lead(RS[0]+24,RS[1],528,RS[1])}${label(536,RS[1],'rs','start')}
      ${lead(menuPoint[0],menuPoint[1],menuPoint[0],10)}${compact ? '' : `<text x="${menuPoint[0]+8}" y="10" style="text-anchor:start">${esc(txt(L.menu))}</text>`}
    </svg>${compact ? `<div class="desktop-pad-legend">${['lt','rt','lb','rb','ls','rs','dp','menu','top','right','bottom'].map(k =>
      `<span><b>${esc(L[k][0])}</b> · ${esc(L[k][1])}</span>`).join('')}</div>` : ''}`;
  }
  // Rebinding is a keyboard thing on desktop. The app has no keyboard, and a controller is
  // remapped by Steam Input (Steam → Settings → Controller) at the Steam level, per game, so an
  // in-game remap would only fight it.
  const canRebind = () => !(typeof isNativeApp === 'function' && isNativeApp());
  let rebindListener = null, padBrandShown = null;
  function stopRebind() { if (rebindListener) { removeEventListener('keydown', rebindListener, true); rebindListener = null; } }
  // index.html stamps the build into #buildTag, which this presentation hides -- but "which build am
  // I running" is the first question any bug report needs answered.
  function buildTagText() {
    const el = $('buildTag');
    return el && el.textContent ? el.textContent.trim() : 'build unknown';
  }
  // Ultra is the one setting whose effect you cannot see at a glance -- it only shows itself once
  // the board holds still -- so it says out loud what it is doing.
  function drawQualityNote() {
    const el = $('desktopQualityNote'); if (!el) return;
    if (settings.quality !== 'ultra') { el.textContent = ''; return; }
    el.textContent = ptPhase === 'failed'
        ? t(ptFailReason === 'slow' ? 'Ray tracing runs too slowly on this GPU — drawing normally.'
                                    : 'Ray tracing could not start on this GPU — drawing normally.')
      : ptPhase === 'loading' ? t('Ray tracing: loading…')
      : ptPhase !== 'ready' ? t('Ray tracing: starting…')
      : ptStill >= PT_STILL_FRAMES ? t('Ray tracing: refining the still frame.')
      : t('Ray tracing: ready — it takes over whenever the board holds still.');
  }
  // The labels around the pictures wear whatever language is on, and a long one runs past the box
  // the picture was drawn in -- which the wrapper clips rather than scrolls. Measured once they are
  // in the document (no width guess per language holds) and the view opened out to what they need.
  function fitDiagram(wrap) {
    const svg = wrap && wrap.firstElementChild;
    if (!svg || typeof svg.getBBox !== 'function') return;
    const vb = svg.viewBox.baseVal;
    let left = vb.x, right = vb.x + vb.width;
    for (const label of svg.querySelectorAll('text')) {
      const b = label.getBBox();
      left = Math.min(left, b.x); right = Math.max(right, b.x + b.width);
    }
    if (left < vb.x || right > vb.x + vb.width)
      svg.setAttribute('viewBox', `${left - 6} ${vb.y} ${right - left + 12} ${vb.height}`);
  }
  function drawPad() {
    const el = $('desktopPadDiagram'); if (!el) return;
    padBrandShown = padBrand(); el.innerHTML = controllerSvg(padBrandShown, compactSheet());
    fitDiagram(el);
    if ($('desktopPadNote')) $('desktopPadNote').textContent = settings.padScheme === 'triggers'
      ? t('Triggers: the harder you pull, the faster it turns.') : t('Right stick: the further you push, the faster it turns.');
    const auto = $('desktopPadBrand') && $('desktopPadBrand').options[0];
    if (auto) auto.textContent = tf('Auto · {brand}', {brand: BRAND_NAMES[detectedPadBrand()]});
    drawPadSeen();
  }
  // What the game can actually SEE, live. A controller that does nothing is otherwise impossible to
  // tell apart from one the browser never handed us -- the Gamepad API only reports a pad once its
  // own window has focus and a button has been pressed on it.
  function drawPadSeen() {
    const el = $('desktopPadSeen'); if (!el) return;
    el.textContent = padList.length
      ? t('Connected: ') + padList.map((p, i) => tf('{brand} (pad {n})', {brand: BRAND_NAMES[padBrandOf(p.id)], n: i + 1})
          + (p.mapping === 'standard' ? '' : t(' — non-standard mapping, some buttons may be in odd places'))).join(', ')
      : t('No controller detected. Press a button on it with this window in front; some pads only appear once they are woken up. If a browser gamepad tester sees it and Tau does not, tell us.');
  }
  function openControls() {
    stopRebind();
    const touch = typeof isNativeApp === 'function' && isNativeApp(), compact = compactSheet();
    const keyboard = () => compact ? keyboardList() : keyboardSvg();
    showModal(t('Controls'), `${touch
        ? `<div class="desktop-controls-head">${esc(t('Touch'))}</div><p class="desktop-controls-note" style="margin:0 0 16px">${esc(t('Tap a foot to pin it, then drag another foot to swing. Drag the 3D view to look around. Drag the flat board\'s rim knob to resize it.'))}</p>`
        : ''}
      <div class="desktop-controls-head">${esc(touch ? t('Keyboard (if one is connected)') : t('Keyboard and mouse'))}</div>
      <div id="desktopKeyboardDiagram" class="desktop-diagram-wrap">${keyboard()}</div>
      ${touch ? '' : `<p class="desktop-controls-note" style="margin:0">${esc(t('Click a foot to pin it, then drag another foot to swing. Right-drag to look around. Scroll the flat board, or drag its rim knob, to resize it.'))}</p>`}
      ${canRebind() ? `<p class="desktop-controls-note">${esc(t('Click a key to change it, then press the new one. Esc and F1 stay as they are.'))}${window.tauSteam ? ' ' + esc(t('Controllers are remapped in Steam’s own controller settings.')) : ''} <button type="button" id="desktopKeysReset">${esc(t('Reset keys'))}</button></p>` : ''}
      <div class="desktop-controls-head" style="margin-top:20px">${esc(t('Controller'))}</div>
      <div class="desktop-controls-scheme">
        <label>${esc(t('Layout'))} <select id="desktopPadBrand" aria-label="${esc(t('Controller layout'))}"><option value="auto">${esc(t('Auto'))}</option>${['xbox','playstation','nintendo','generic'].map(b => `<option value="${b}">${BRAND_NAMES[b]}</option>`).join('')}</select></label>
        <label>${esc(t('Swing with'))} <select id="desktopPadScheme" aria-label="${esc(t('Controller scheme'))}"><option value="triggers">${esc(t('Triggers'))}</option><option value="stick">${esc(t('Right stick'))}</option></select></label>
      </div>
      <div id="desktopPadDiagram" class="desktop-diagram-wrap"></div>
      <p class="desktop-controls-note" id="desktopPadNote" style="margin:0"></p>
      <p class="desktop-controls-note" id="desktopPadSeen"></p>`, [
      { label:t('Done'), onClick:() => { stopRebind(); if (inMatch()) focusBoard(); } },
    ], true, {dismiss:stopRebind});
    $('modalBox').classList.add('desktop-sheet');
    $('desktopPadBrand').value = settings.padBrand;
    $('desktopPadBrand').onchange = e => { settings.padBrand = e.target.value; saveSettings(); drawPad(); };
    $('desktopPadScheme').value = settings.padScheme;
    $('desktopPadScheme').onchange = e => { settings.padScheme = e.target.value; saveSettings(); drawPad(); };
    drawPad();
    fitDiagram($('desktopKeyboardDiagram'));
    if (!canRebind()) return;
    const keyText = el => el.querySelector('.key') || el;
    const wire = () => {
      for (const b of $('modalBox').querySelectorAll('[data-rebind]')) b.onclick = () => {
        stopRebind(); redraw(); const el = $('modalBox').querySelector(`[data-rebind="${b.dataset.rebind}"]`);
        el.classList.add('listening'); keyText(el).textContent = '…';
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
    };
    const redraw = () => { $('desktopKeyboardDiagram').innerHTML = keyboard(); fitDiagram($('desktopKeyboardDiagram')); wire(); };
    wire();
    $('desktopKeysReset').onclick = () => { stopRebind(); settings.keys = {...DEFAULT_KEYS}; saveSettings(); redraw(); };
  }
  // ---- "Choose your controls": who plays Blue, who plays Red ----
  // A local 1v1 is the one match with two people at one screen, so it ASKS who is on what rather
  // than seating whatever happens to be plugged in. Blue chooses first, then Red; the same device
  // on both sides is pass and play, and two different devices each move only their own colour.
  const SEAT_NAMES = ['Blue', 'Red'];
  const SEAT_COLOURS = ['#6b9eff', '#ff6b6b'];   // the pieces' own blue and red
  let pick = null;
  const deviceName = d => d.kind === 'kbm' ? t('Keyboard & mouse')
    : d.brand === 'generic' ? t('Controller') : BRAND_NAMES[d.brand];
  // A piece, as it stands on the board: three legs 120° apart from the hub, each on a round foot.
  function tripodSvg(colour) {
    const c = 50, r = 31, feet = [90, 210, 330].map(a => [c + r*Math.cos(a*Math.PI/180), c + r*Math.sin(a*Math.PI/180)]);
    const leg = ([x, y]) => `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke-width="7" stroke-linecap="round"/>`;
    const foot = ([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" stroke="none"/>`;
    return `<svg class="desktop-pick-tripod" viewBox="0 0 100 100" aria-hidden="true" fill="${colour}" stroke="${colour}">
      ${feet.map(leg).join('')}${feet.map(foot).join('')}
      <circle cx="${c}" cy="${c}" r="9" stroke="none"/></svg>`;
  }
  // The same pad outline the Controls sheet draws, small and unlabelled: body, sticks, D-pad and
  // the four face buttons, which is as much as still reads at icon size.
  function padIconSvg(brand) {
    const c = 380, P = padParts(BRAND_KEYS[brand] || BRAND_KEYS.generic, c);
    const dot = ([x, y], r, dx = 0, dy = 0) => `<circle class="pick-part" cx="${x+dx}" cy="${y+dy}" r="${r}"/>`;
    return `<svg class="desktop-pick-icon" viewBox="166 58 428 258" role="img" aria-label="${esc(tf('{brand} controller', {brand: BRAND_NAMES[brand] || t('Controller')}))}">
      <path class="pick-body" d="${padBodyPath(c)}" stroke-width="6"/>
      ${dot(P.ls, 25)}${dot(P.rs, 25)}
      <rect class="pick-part" x="${P.dp[0]-8}" y="${P.dp[1]-26}" width="16" height="52" rx="4"/>
      <rect class="pick-part" x="${P.dp[0]-26}" y="${P.dp[1]-8}" width="52" height="16" rx="4"/>
      ${dot(P.fc, 12, 0, -28)}${dot(P.fc, 12, -28)}${dot(P.fc, 12, 28)}${dot(P.fc, 12, 0, 28)}</svg>`;
  }
  function kbmIconSvg() {
    const keys = [];
    for (let row = 0; row < 3; row++) for (let k = 0; k < 6; k++)
      keys.push(`<rect class="pick-part" x="${8 + k*13}" y="${23 + row*11}" width="9" height="7" rx="2"/>`);
    return `<svg class="desktop-pick-icon" viewBox="0 0 120 72" role="img" aria-label="${esc(t('Keyboard & mouse'))}">
      <rect class="pick-body" x="2" y="16" width="86" height="52" rx="8" stroke-width="2"/>
      ${keys.join('')}<rect class="pick-part" x="21" y="56" width="44" height="7" rx="2"/>
      <rect class="pick-body" x="96" y="14" width="22" height="42" rx="11" stroke-width="2"/>
      <line class="pick-line" x1="107" y1="14" x2="107" y2="30" stroke-width="2"/></svg>`;
  }
  const deviceIcon = d => d.kind === 'kbm' ? kbmIconSvg() : padIconSvg(d.brand);
  function chooseDevices(start) {
    if (pick) return;
    seats = [null, null];
    const el = document.createElement('section');
    el.className = 'desktop-pick';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', t('Choose your controls'));
    el.innerHTML = `<div class="desktop-pick-sheet" tabindex="-1">
      <h2>${esc(t('Choose your controls'))}</h2>
      <p class="desktop-pick-hint">${esc(t('One device each, or the same one twice to pass and play.'))}</p>
      <div class="desktop-pick-seats">${[0, 1].map(i => `<div class="desktop-pick-seat" data-seat="${i}">
          <span class="desktop-pick-colour" style="color:${SEAT_COLOURS[i]}">${esc(t(SEAT_NAMES[i]))}</span>
          ${tripodSvg(SEAT_COLOURS[i])}
          <div class="desktop-pick-device"></div>
          <p class="desktop-pick-prompt"></p>
        </div>`).join('')}</div>
      <p class="desktop-pick-same" hidden>${esc(t('Same device — pass and play'))}</p>
      <div class="desktop-pick-actions">
        <button type="button" id="desktopPickSkip">${esc(t('Skip — pass and play'))}</button>
        <button type="button" id="desktopPickBack">${esc(t('Back'))} <kbd>Esc</kbd></button>
      </div></div>`;
    document.body.appendChild(el);
    pick = { el, start, stage: 0, cand: null, onKey: pickKey };
    // Clicks are listened for on the OVERLAY, not the document: the click that opened this screen
    // is still on its way up through the menu it came from, and a document listener would catch it
    // as the first player offering the mouse.
    el.addEventListener('click', e => {
      if (!pick || e.target.closest('button')) return;
      if (pick.cand?.kind === 'kbm') pickConfirm(); else pickCandidate(KBM);
    });
    $('desktopPickSkip').onclick = () => { seats = [KBM, KBM]; pickPlay(); };
    $('desktopPickBack').onclick = pickBack;
    addEventListener('keydown', pick.onKey, true);
    drawPick();
    el.querySelector('.desktop-pick-sheet').focus({ preventScroll: true });
  }
  function drawPick() {
    for (const i of [0, 1]) {
      const card = pick.el.querySelector(`[data-seat="${i}"]`), device = i === pick.stage ? pick.cand : seats[i];
      card.classList.toggle('is-choosing', i === pick.stage);
      card.classList.toggle('is-set', !!device && i !== pick.stage);
      card.querySelector('.desktop-pick-device').innerHTML = device
        ? `${deviceIcon(device)}<span class="desktop-pick-device-name">${esc(deviceName(device))}</span>`
        : `<span class="desktop-pick-blank"></span><span class="desktop-pick-device-name">${esc(t('Not chosen'))}</span>`;
      card.querySelector('.desktop-pick-prompt').textContent = i !== pick.stage ? (seats[i] ? t('Ready') : '')
        : !pick.cand ? tf('{colour}: press any button on your controller, or a key / click', {colour: t(SEAT_NAMES[i])})
        : pick.cand.kind === 'kbm' ? t('Click or press Enter to confirm')
        : tf('Press {button} to confirm', {button: (BRAND_KEYS[pick.cand.brand] || BRAND_KEYS.generic).bottom});
    }
    pick.el.querySelector('.desktop-pick-same').hidden = !(pick.stage === 1 && sameDevice(seats[0], pick.cand));
  }
  function pickCandidate(device) {
    if (sameDevice(device, pick.cand)) return;
    pick.cand = device; drawPick();
  }
  function pickConfirm() {
    if (!pick.cand) return;
    seats[pick.stage] = pick.cand;
    if (pick.stage === 1) { pickPlay(); return; }
    pick.stage = 1; pick.cand = null; drawPick();
  }
  function pickBack() {
    if (pick.stage === 0) { closePick(); $('desktopPlay').focus({ preventScroll: true }); return; }
    // Back to Blue choosing, holding what they had: they can confirm it again, or hand the device
    // over and pick something else.
    pick.stage = 0; pick.cand = seats[0]; seats[0] = null; drawPick();
  }
  function pickPlay() { const start = pick.start; closePick(); start(); }
  function closePick() { removeEventListener('keydown', pick.onKey, true); pick.el.remove(); pick = null; }
  function pickKey(e) {
    if (!pick || e.key === 'Tab') return;
    // Enter or Space on one of this screen's own buttons is that button being pressed, not someone
    // offering the keyboard; a bare modifier (alt-tabbing back in, say) is nobody choosing anything.
    if (pick.el.contains(e.target) && e.target.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === 'Escape') pickBack();
    else if (pick.cand?.kind === 'kbm' && (e.key === 'Enter' || e.key === ' ')) pickConfirm();
    else pickCandidate(KBM);
  }
  // One press per pad per frame, off the same per-pad button memory the match uses. Button 1 (B) is
  // the way back everywhere on a pad, so it steps back rather than offering the pad; anything else
  // offers it, and once offered button 0 confirms it.
  function pollPick() {
    for (let i = 0; i < padList.length && pick; i++) {
      const pad = padList[i], prev = padPrev[i] || [];
      const hit = pad.buttons.findIndex((b, n) => b?.pressed && !prev[n]);
      if (hit < 0) continue;
      if (hit === 1) pickBack();
      else if (hit === 0 && pick.cand?.kind === 'pad' && pick.cand.index === pad.index) pickConfirm();
      else pickCandidate(padSeat(pad));
    }
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
    showModal(t('Leave this match?'), '', [
      {label:t('Keep playing'),onClick:() => focusBoard()},
      {label:t('Leave match'),onClick:backToMenu},
    ], false, {dismiss:true});
  }
  function openSettings() {
    const fullscreen = window.tauSteam?.setFullscreen;
    showModal(t('Settings'), `<label class="desktop-setting desktop-volume">${esc(t('Sound'))} <output id="desktopVolumeValue">${userVol}%</output><input id="desktopVolume" aria-label="${esc(t('Sound volume'))}" type="range" min="0" max="200" step="5" value="${userVol}"></label>
      <label class="desktop-setting">${esc(t('Mute'))}<input id="desktopMute" type="checkbox" ${soundOn?'':'checked'}></label>
      <label class="desktop-setting">${esc(t('Board'))}<select id="desktopBoard">${BOARD_FINISHES.map(b=>isUnlocked(b.id)?`<option value="${b.id}">${b.name}</option>`:`<option value="${b.id}" disabled>${b.name} · ${esc(unlockText(b.id))}</option>`).join('')}</select></label>
      ${testBoards ? '<p class="desktop-result-detail">All boards are open for testing. Type <b>ALLBOARDS</b> on the main menu to restore locks.</p>' : ''}
      <label class="desktop-setting">${esc(t('Graphics'))}<select id="desktopQuality"><option value="balanced">${esc(t('Balanced'))}</option><option value="high">${esc(t('High'))}</option><option value="ultra">${esc(t('Ultra · ray tracing'))}</option></select></label>
      <p class="desktop-controls-note" id="desktopQualityNote" style="margin:0"></p>
      <label class="desktop-setting">${esc(t('Language'))}<select id="desktopLanguage" aria-label="${esc(t('Language'))}">${LANG_NAMES.map(([code,label])=>`<option value="${code}">${esc(label)}</option>`).join('')}</select></label>
      <label class="desktop-setting">${esc(t('Invert camera Y'))}<input id="desktopInvertY" type="checkbox" ${settings.invertCamY?'checked':''}></label>
      <label class="desktop-setting">${esc(t('Reduce camera motion'))}<input id="desktopMotion" type="checkbox" ${settings.reducedMotion?'checked':''}></label>
      <label class="desktop-setting">${esc(t('Controller vibration'))}<input id="desktopHaptics" type="checkbox" ${settings.haptics?'checked':''}></label>
      ${fullscreen ? `<label class="desktop-setting">${esc(t('Fullscreen'))}<input id="desktopFullscreen" type="checkbox"></label>` : ''}
      <p class="desktop-controls-note" style="text-align:center">${esc(buildTagText())}</p>`,
      [{label:t('Done'),onClick:() => { if(inMatch()) focusBoard(); }}], true, {dismiss:true});
    $('desktopQuality').value = settings.quality;
    $('desktopLanguage').value = LANG;
    // setLang repaints the page (this layer included, via onLangChange); the sheet itself is
    // rebuilt right after so the player is not left reading the old language's Settings.
    $('desktopLanguage').onchange = e => { setLang(e.target.value); openSettings(); };
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
    $('desktopQuality').onchange = e => {
      settings.quality = e.target.value;
      settings.rayTrace = settings.quality === 'ultra';
      saveSettings(); configureQuality(); resize();
      if (settings.rayTrace) rayTraceLoad();
      drawQualityNote();
    };
    drawQualityNote();
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
    const buttons = [{label:t('Rematch'),onClick:rematch}];
    if (!local && G.winner===humanIdx && level+1<LADDER_N)
      buttons.push({label:t('Next level'),onClick:() => { settings.level=level+2; saveSettings(); $('desktopLevel').value=String(settings.level); startMatch(); }});
    if(replayFrames.length>15) buttons.push({label:t('Watch replay'),onClick:startReplay});
    buttons.push({label:t('Main menu'),onClick:backToMenu});
    const detail = local ? t('Two players · same screen')
      : tf('Level {n} · You played {colour}', {n: level+1, colour: colour===0?t('Blue'):t('Red')});
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
    renderer.setPixelRatio(Math.min(devicePixelRatio||1, settings.quality==='balanced'?1.5:2));
    renderer.toneMappingExposure=1.03;
    renderer.shadowMap.enabled=true;
    scene.traverse(o=>{ if(!o.isLight || !o.castShadow) return;
      const size=settings.quality==='balanced'?1024:2048;
      if(o.shadow.mapSize.x!==size){ o.shadow.mapSize.set(size,size); if(o.shadow.map){o.shadow.map.dispose();o.shadow.map=null;} }
      o.shadow.normalBias=.16; o.shadow.bias=-.0002;
    });
    renderer.shadowMap.needsUpdate=true;
    if (gpTarget && gpSamples !== gpSampleWant()) gpDispose();   // rebuilt on the next glass frame
  }
  let boardTrim = null;
  let envGroup = null, envFor = null, lookTheme = null;   // the showing look's surroundings, if it has any
  // Giants go over slowly: a look may slow the loser's fall (its simSpeed, floored so a match's
  // ending never drags), and the dust below runs on the same clock.
  function fallTimeScale() { return lookTheme && lookTheme.simSpeed ? Math.max(0.5, lookTheme.simSpeed) : 1; }
  // Where a fallen piece lands on this look, if it brings its own ground (null: the game's floor).
  // Where a fallen piece lands on this look, if it brings its own ground. A look whose ground is
  // not one flat plane -- Colossus stands its pitch on a plinth wider than the board -- answers per
  // position instead: asked with no position (the tests, and anything that just wants the look's
  // ground level) it still gives the one number.
  // EVERY BOARD SITS AT ITS OWN HEIGHT. A drop is a big part of what a board feels like, and they
  // were all the same twenty centimetres: Maple is a low table you could sweep a piece off onto the
  // rug, Dark is a board floating in a room with no bottom you can see. A look that draws its own
  // ground (Colossus' sand, Marble's hall) says so and keeps it; every other board just names a
  // depth and the game's own black floor is moved down to meet it.
  const FLOOR_BY_BOARD = {
    maple:  -11,    // a low bench: the piece is on the floor almost as soon as it leaves the board
    yellow: -16,
    dojo:   -20,    // the mat is right there
    walnut: -34,    // the height the rest of the game was tuned at
    ebony:  -44,
    slate:  -58,
    cosy:   -26,    // a rug, a foot below the coffee table
    sumo:   -14,    // the dohyo is built up off the ground, not much
    math:   -72,
    noir:  -130,    // it goes down into the dark and you hear it land
    dark:  -190,    // no bottom you can see from here
  };
  let lookFloor = null, lookOwnGround = false;
  function gameFloor() { return typeof FALL_FLOOR_Y !== 'undefined' ? FALL_FLOOR_Y : -34; }
  // How hard this look's gravity pulls, as a fraction of the usual, after a piece has been falling
  // for `airT` seconds. One everywhere except a look that says otherwise.
  function fallGravity(airT) {
    const g = lookTheme && lookTheme.gravity;
    if (!g) return 1;
    return Math.max(g.lift, 1 - (airT || 0)/g.fade);
  }
  function fallFloorY(x, z) {
    if (lookTheme && x !== undefined && typeof lookTheme.floorAt === 'function') return lookTheme.floorAt(x, z);
    return lookFloor != null ? lookFloor : gameFloor();
  }
  // ---- Sand and stone: the dust a fall raises on a look that asks for it (T.dust) ----
  // Each puff is its own small point cloud thrown up from a spot: outward and up, slowed by the
  // air, settling under gravity, spreading and fading over a couple of seconds; beyond the rim
  // it keeps falling with the piece. Spawned where the loser's feet drag through the sand during
  // the slide, in a burst where the piece meets the rim and tips, and again wherever it actually
  // lands (spawnDust's y: 0 for the board surface, the fall's own floor height below it).
  const puffs = [];
  function spawnDust(x, z, n, spread, y = 0) {
    const T = lookTheme; if (!T || !T.dust || !scene) return;
    const pos = new Float32Array(n*3), vel = new Float32Array(n*3);
    for (let i = 0; i < n; i++) {
      const a = Math.random()*Math.PI*2, sp = spread*(0.3 + Math.random());
      pos[i*3] = x + (Math.random()-0.5)*5; pos[i*3+1] = y + 0.4 + Math.random()*2; pos[i*3+2] = z + (Math.random()-0.5)*5;
      vel[i*3] = Math.cos(a)*sp; vel[i*3+1] = spread*(0.4 + Math.random()*1.1); vel[i*3+2] = Math.sin(a)*sp;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const SH = showcase();
    const mat = new THREE.PointsMaterial({ color: T.dust.color, size: T.dust.size || 2.4, transparent: true,
      map: SH && SH.softDiscTexture ? SH.softDiscTexture() : null, alphaTest: 0.04,
      opacity: 0.8, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    pts.userData.dust = { vel, age: 0, life: 2.0 + Math.random()*0.8, size: T.dust.size || 2.4, floorY: y };
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
        // Board-surface dust (floorY 0) keeps falling once it drifts past the rim, into the drop
        // below; dust spawned AT a landing floor (Colossus' sand, say) has no such edge to clear --
        // it rests on ITS OWN ground everywhere, which is why the floor comes from the puff, not a
        // fixed constant.
        const floor = d.floorY !== 0 ? d.floorY + 0.3 : (Math.hypot(pos[i], pos[i+2]) > CFG.edgeU ? -80 : 0.3);
        if (pos[i+1] < floor) { pos[i+1] = floor; v[i+1] = 0; }
      }
      p.geometry.attributes.position.needsUpdate = true;
      p.material.opacity = 0.8 * Math.max(0, 1 - d.age/d.life);
      p.material.size = d.size * (1 + d.age*1.3);   // the cloud spreads as it thins
      if (d.age >= d.life) { scene.remove(p); p.geometry.dispose(); p.material.dispose(); puffs.splice(k, 1); }
    }
  }
  let lastFallPhase = null, slideDustT = 0, lastFallBounces = 0, lastFallResting = false;
  function tickEffects(dt) {
    const now = performance.now()/1000;
    if (envGroup && envGroup.userData.tick) envGroup.userData.tick(now, dt);
    const phase = fall.active ? fall.phase : null;
    if (lookTheme && lookTheme.dust && fall.active && typeof tripods !== 'undefined' && tripods[fall.idx]) {
      const ts = fallTimeScale(), tp = tripods[fall.idx].position;
      // The body reports what it is touching, not which act of a script it is in: 'board' while
      // something of it is still on the board, 'ground' once it is down, 'air' in between.
      const vx = fall.V ? fall.V.x : 0, vz = fall.V ? fall.V.z : 0;
      if (phase === 'board') {   // feet dragging across the board: a puff behind the piece every so often
        slideDustT += dt*ts;
        if (slideDustT > 0.14) { slideDustT = 0;
          const d = Math.hypot(vx, vz) || 1;
          spawnDust(tp.x - vx/d*10, tp.z - vz/d*10, 26, 10); }
      }
      if (phase !== 'board' && lastFallPhase === 'board') {   // it has just left the rim: the big one
        spawnDust(tp.x, tp.z, 170, 24);
        if (envGroup && envGroup.userData.excite) envGroup.userData.excite();
      }
      // A fresh tumble starting mid-frame (the previous one never ran the reset branch below,
      // e.g. a replay re-running straight into another loss) must not inherit the last one's count.
      if (phase === 'board' && lastFallPhase !== 'board') { lastFallBounces = 0; lastFallResting = false; }
      // The ground below is a second surface entirely: a titan hitting the sand needs its own dust,
      // thrown up where it actually LANDS rather than where it left the board. Impact speed sets
      // the size -- the first landing is the heavy one, each bounce after throws up less.
      if (fall.bounces > lastFallBounces && fall.lastImpact) {
        // How much is thrown up follows how hard it hit, and nothing else. This used to single out
        // "the first landing" as the big one, which only held while a script decided what the first
        // landing was; the body reports every contact it makes, and the heaviest one is the heaviest
        // one whenever it happens -- a titan that clips the rim on the way over raises a little, and
        // the arrival on the sand raises a cloud.
        const hit = fall.lastImpact, k = Math.max(0.18, Math.min(1.35, hit.speed/130));
        spawnDust(hit.x, hit.z, Math.round(150*k*k), 24*k, hit.y);
      }
      lastFallBounces = fall.bounces || 0;
      if (fall.resting && !lastFallResting && fall.lastImpact) {
        spawnDust(fall.lastImpact.x, fall.lastImpact.z, 30, 5, fall.lastImpact.y);   // it settles: one last small puff
      }
      lastFallResting = fall.resting;
    } else { slideDustT = 0; lastFallBounces = 0; lastFallResting = false; }
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
  let gpTarget = null, gpScene = null, gpQuad = null, gpLights = [], gpFailed = false, gpSamples = -1;
  const gpV = new THREE.Vector3(), gpSize = new THREE.Vector2();
  // WHICH piece is the near one decides which is drawn through the other, so that choice is a big
  // part of what the player reads as "in front" -- and it has to be steady. Two pieces facing each
  // other sit the SAME distance from a camera looking down the line between them, so picking on
  // raw centre distance there turns on the last bit of a float: four degrees of orbit swapped which
  // piece looked in front, over and over. Two changes. Distance is measured to the nearest PART of
  // a piece, not its centre -- a leg reaching towards the camera is what being in front means --
  // and the standing choice is held until the other is nearer by a clear margin, so a slow orbit
  // hands over once, where the geometry really crosses, instead of strobing at the meeting point.
  const GP_HOLD = 5;   // units the challenger must beat the standing near piece by
  let gpNear = null;
  const GP_FEET = (() => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const a = i*2*Math.PI/3;
      out.push(new THREE.Vector3(Math.cos(a)*CFG.footR, 0, Math.sin(a)*CFG.footR));
    }
    return out;
  })();
  function gpNearest(t) {
    let best = Infinity;
    for (const p of GP_FEET) best = Math.min(best, camera.position.distanceTo(gpV.copy(p).applyMatrix4(t.matrixWorld)));
    const hub = t.userData && t.userData.hub;
    if (hub) best = Math.min(best, camera.position.distanceTo(hub.getWorldPosition(gpV)));
    return best;
  }
  function glassPieces() {
    const out = [];
    for (const pair of [typeof tripods !== 'undefined' ? tripods : null, typeof htpTripods !== 'undefined' ? htpTripods : null])
      for (const t of pair || []) if (t && t.visible && t.userData.mat && t.userData.mat.transmission > 0) out.push(t);
    return out;
  }
  // Two full scene renders a frame is a real cost, and three's own transmission pre-pass doubles
  // each of them: a marble frame is about four draws of the world. It is worth that ONLY where the
  // two pieces overlap on screen, because that is the only place the near piece has any of the far
  // one behind it to refract. Everywhere else the ordinary single-pass frame is the same picture,
  // pixel for pixel, so the second pass is skipped and an orbit costs what every other board costs.
  //
  // The test is angular, not a projection. Projecting to NDC gets this wrong the moment the corner
  // layout puts a view offset on the camera -- the offset rescales NDC around a sub-rectangle, and
  // two interlocked pieces came out as boxes a whole unit apart, so the pass was skipped exactly
  // where it was needed. An angle between two directions does not care how the frustum is cropped:
  // each piece is a sphere, and they overlap from here if the angle between their centres is less
  // than the sum of the angles they each subtend.
  const gpCenA = new THREE.Vector3(), gpCenB = new THREE.Vector3();
  const gpDirA = new THREE.Vector3(), gpDirB = new THREE.Vector3();
  const GP_SLACK = 1.15;   // a little generous: a leg bends in what sits just outside it
  function gpSpan(t, centre) {          // world centre of the piece, and the radius that holds it
    const cy = (t.userData && t.userData.hub) ? t.userData.hub.position.y : 12;
    centre.set(0, cy*0.5, 0).applyMatrix4(t.matrixWorld);
    return Math.hypot(CFG.footR, cy*0.5) * GP_SLACK;
  }
  function gpOverlap(a, b) {
    const ra = gpSpan(a, gpCenA), rb = gpSpan(b, gpCenB);
    const da = camera.position.distanceTo(gpCenA), db = camera.position.distanceTo(gpCenB);
    if (da <= ra || db <= rb) return true;          // standing inside one of them: never skip
    gpDirA.copy(gpCenA).sub(camera.position).divideScalar(da);
    gpDirB.copy(gpCenB).sub(camera.position).divideScalar(db);
    const apart = Math.acos(Math.max(-1, Math.min(1, gpDirA.dot(gpDirB))));
    return apart < Math.asin(ra/da) + Math.asin(rb/db);
  }
  // A multisampled colour+depth target is both the expensive and the least portable part of the
  // pass (the depth resolve is where drivers differ), so the cheap tier does without it.
  function gpSampleWant() { return settings.quality === 'balanced' ? 0 : 4; }
  function gpDispose() {
    if (!gpTarget) return;
    gpTarget.depthTexture.dispose(); gpTarget.dispose(); gpTarget = null;
  }
  function gpSetup() {
    gpSamples = gpSampleWant();
    gpTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: gpSamples,
      depthTexture: new THREE.DepthTexture(4, 4, THREE.UnsignedIntType) });
    // ALWAYS-passing depth test, NOT a disabled one. GL throws depth writes away whenever the
    // depth test is off -- depthMask does not matter -- so with depthTest:false the restored
    // gl_FragDepth here went nowhere and pass two ran against an empty depth buffer. The near
    // piece then drew over the far one at EVERY crossing instead of weaving through it, and the
    // whole lot swapped over at once when the near/far choice handed over: "the red is in front,
    // turn a little and the blue is in front". This is that bug.
    gpQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true,
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
  function renderGlassFrame() {
    if (!renderer || !camera || gpFailed) return false;
    const pieces = glassPieces();
    if (pieces.length < 2) return false;
    try {
      if (!gpTarget) gpSetup();
      pieces.forEach(t => t.updateMatrixWorld());
      const dists = pieces.map(gpNearest);
      let ni = 0;
      for (let i = 1; i < dists.length; i++) if (dists[i] < dists[ni]) ni = i;
      const held = pieces.indexOf(gpNear);
      if (held >= 0 && held !== ni && dists[ni] > dists[held] - GP_HOLD) ni = held;
      const near = pieces[ni];
      gpNear = near;
      // nothing of the far piece behind the near one: the plain frame is the same picture
      let crossing = false;
      for (const t of pieces) if (t !== near && gpOverlap(near, t)) { crossing = true; break; }
      if (!crossing) return false;
      renderer.getDrawingBufferSize(gpSize);
      if (gpTarget.width !== gpSize.x || gpTarget.height !== gpSize.y) gpTarget.setSize(gpSize.x, gpSize.y);
      // pass one: the world without the near piece's colour (its shadow still falls)
      const mats = [], seen = new Set();   // the feet share the hub's material: save each once
      near.traverse(o => { const m = o.material; if (m && !seen.has(m)) { seen.add(m); mats.push([m, m.colorWrite, m.depthWrite]); m.colorWrite = false; m.depthWrite = false; } });
      // the near piece gets its colour back for pass two; the far ones lose theirs there instead
      try { renderer.setRenderTarget(gpTarget); renderer.render(scene, camera); }
      finally { for (const [m, cw, dw] of mats) { m.colorWrite = cw; m.depthWrite = dw; } }
      // pass two: that picture, then the near piece through it. The pieces are LENT to the second
      // scene for one render and always handed back -- a throw that left one there would take it
      // out of the game. The far pieces come too, drawn without colour: they are already in the
      // painted picture, but without them in this scene they cast no shadow on the near piece, and
      // that shadow blinking on and off as the near/far choice hands over is itself a flicker.
      const lent = [];
      try {
        for (const t of pieces) {
          lent.push([t, t.parent]); t.parent.remove(t); gpScene.add(t);
          if (t !== near) t.traverse(o => { const m = o.material; if (m && !seen.has(m)) { seen.add(m); mats.push([m, m.colorWrite, m.depthWrite]); m.colorWrite = false; m.depthWrite = false; } });
        }
        for (const [o, c] of gpLights) { c.position.copy(o.position); c.intensity = o.intensity; c.color.copy(o.color); if (o.groundColor) c.groundColor.copy(o.groundColor); }
        gpScene.environment = scene.environment; gpScene.fog = scene.fog;
        renderer.setRenderTarget(null); renderer.render(gpScene, camera);
      } finally {
        for (const [t, parent] of lent) { gpScene.remove(t); parent.add(t); }
        for (const [m, cw, dw] of mats) { m.colorWrite = cw; m.depthWrite = dw; }
      }
      return true;
    } catch (e) {
      gpFailed = true; console.warn('glass two-pass render unavailable', e);
      try { renderer.setRenderTarget(null); } catch (_) {}
      return false;
    }
  }
  // ---- Ray tracing (Ultra): the still frame is path traced, everything else is rasterised ----
  // Off by default and desktop-only. While anything at all is in motion — the camera, a piece, a
  // fall, the crowd, a sheet opening — the frame is drawn exactly as it always was, so no control
  // ever waits on a traced sample. Once the picture has held still for a couple of frames the
  // tracer takes the canvas and refines the same image sample by sample until it hits the cap,
  // then stops drawing entirely and leaves the finished frame on screen.
  //
  // The bundle is fetched only when someone turns the setting on, so a player who never does
  // never downloads it. Anything that throws anywhere along the way — load, init, scene build,
  // sample — puts the rasteriser back for the session and says so.
  const PT_SRC = 'vendor/pathtracer/pathtracer.global.js';
  const PT_SAMPLE_CAP = 256;
  const PT_STILL_FRAMES = 2;
  // A path tracer asks the GPU for orders of magnitude more work than the rasteriser, and a card
  // that cannot keep up does not fail -- it just takes a second or more per frame, which from the
  // outside is a frozen game. So the tracer is watched, and a machine it is too slow on is told so
  // and put back on the rasteriser rather than left grinding. Three ways it can be too slow: the
  // scene build (one synchronous BVH pass), a single sample, or a run of heavy frames.
  const PT_SLOW_BUILD = 2600;    // ms to build the traced scene, once per world change
  const PT_SLOW_FRAME = 420;     // ms a traced frame takes before it reads as a stutter
  const PT_SLOW_STRIKES = 6;     // consecutive heavy frames -- one hitch is not a verdict
  const PT_TRACE_PIXELS = 1.2e6; // traced pixels per frame; above this the frame is traced smaller
  let ptSlow = 0, ptFrameAt = 0, ptWarm = 0;
  // How much light the traced scene gets, against what the rasteriser is given. The tracer carries
  // light between surfaces and the rasteriser does not, so handed the same room and the same key
  // it returns a markedly brighter picture -- the board "lighting up" the moment the scene settled,
  // which is the one thing Ultra must not do: it is meant to be the same table, better rendered.
  // One factor on both the room and the lamps scales every path equally, bounced light included,
  // so the traced frame lands on the rasterised one instead of above it.
  // Calibrated, not guessed: the same board and viewpoint captured traced and rasterised, at three
  // trims -- 1.00 came out 1.76x the rasterised frame's mean luminance, 0.62 gave 1.18x, 0.45 gave
  // 0.88x. The fit through those puts parity at 0.52, which is what this is.
  const PT_LIGHT_TRIM = 0.52;
  let ptPhase = 'off';                    // off | loading | ready | failed
  let ptTracer = null, ptScene = null, ptEnv = null, ptCueScene = null;
  let ptKey = '', ptWorldKey = '', ptStill = 0, ptWorldRev = 0, ptFailReason = '';

  const ptRound = v => Math.round(v * 1000) / 1000;
  // Pure. One string for everything the traced picture depends on; two frames that hash the same
  // are the same picture. Matrices are quantised because OrbitControls' damping keeps trickling
  // ever-smaller deltas into the camera long after the drag that started them has stopped — at
  // full precision the scene would never once read as at rest.
  function rayTraceKey(s) {
    const mat = m => m ? Array.from(m, ptRound).join(',') : '-';
    return [mat(s.camera), mat(s.proj), s.size, (s.pieces || []).map(mat).join(';'), s.board,
      s.rev, s.fall ? 1 : 0, s.shards || 0, s.ai ? 1 : 0, s.replay ? 1 : 0, s.pinned, ptRound(s.netRad || 0),
      ptRound(s.lift || 0), s.modal ? 1 : 0, s.hidden ? 1 : 0].join('|');
  }
  function rayTraceMotion(prev, next) { return prev && rayTraceKey(prev) === rayTraceKey(next) ? 'still' : 'moving'; }
  function rayTraceState() {
    const pieces = [];
    for (const pair of [typeof tripods !== 'undefined' ? tripods : null, typeof htpTripods !== 'undefined' ? htpTripods : null])
      for (const t of pair || []) pieces.push(t && t.visible ? t.matrixWorld.elements : null);
    const G_ = typeof G !== 'undefined' && G ? G : null;
    return {
      camera: camera.matrixWorld.elements, proj: camera.projectionMatrix.elements,
      size: renderer.domElement.width + 'x' + renderer.domElement.height,
      pieces, board: settings.board, rev: ptWorldRev,
      fall: typeof fall !== 'undefined' && fall.active,
      // Glass in the air is still motion: the shards of a shattered piece keep flying for a few
      // seconds after the fall itself has finished. Their age (not their count, which holds steady
      // while they fly) is what changes every frame, so the tracer waits until they are gone.
      shards: typeof shards !== 'undefined' && shards.length ? ptRound(shards[0].t) : 0,
      ai: typeof aiAnim !== 'undefined' && !!aiAnim,
      replay: typeof replayActive !== 'undefined' && !!replayActive,
      pinned: G_ ? G_.pinned : null, netRad: G_ ? G_.netRad : 0,
      // Colossus' stands jump when a titan goes over; the bowl is traced, so that is real motion.
      lift: envGroup && envGroup.userData.lift ? envGroup.userData.lift() : 0,
      modal: dialogOpen(), hidden: document.hidden,
    };
  }
  function rayTraceLoad() {
    if (ptPhase === 'failed') { rayTraceOff(); return; }   // asked for again after it fell over: say so again
    if (ptPhase !== 'off') return;
    if (window.TAU_PT) { ptPhase = 'ready'; return; }
    ptPhase = 'loading';
    showToast(`<p class="desktop-unlock">${esc(t('Ray tracing: loading…'))}</p>`);
    const s = document.createElement('script');
    s.src = PT_SRC;
    s.onload = () => { if (window.TAU_PT) ptPhase = 'ready'; else rayTraceFail(new Error('bundle loaded without TAU_PT')); };
    s.onerror = () => rayTraceFail(new Error('could not load ' + PT_SRC));
    document.body.appendChild(s);
  }
  function rayTraceOff(reason) {
    ptPhase = 'failed'; ptTracer = null; ptScene = null; ptFailReason = reason || 'failed';
    ptSlow = 0; ptFrameAt = 0;
    // Turned off in memory but deliberately NOT saved: the same profile may open tomorrow on a
    // machine whose GPU can run it, and the player's choice should still be there when it does.
    settings.rayTrace = false;
    if (settings.quality === 'ultra') settings.quality = 'high';
    if ($('desktopQuality') && $('desktopQuality').value === 'ultra') $('desktopQuality').value = 'high';
    showToast(`<p class="desktop-unlock">${esc(t(ptFailReason === 'slow'
      ? 'Ray tracing is too slow on this GPU.' : 'Ray tracing could not start on this GPU.'))}</p>`);
  }
  // Not a crash: the GPU works, it is simply too slow to be worth it. Same exit, different words.
  function rayTraceTooSlow(what, ms) {
    console.warn(`ray tracing is too slow on this GPU (${what} took ${Math.round(ms)}ms); drawing normally`);
    try { renderer.setRenderTarget(null); } catch (_) {}
    rayTraceOff('slow');
    drawQualityNote();
  }
  function rayTraceFail(err) {
    console.warn('ray tracing unavailable', err);
    try { renderer.setRenderTarget(null); } catch (_) {}
    rayTraceOff();
  }
  // The tracer has no hemisphere light and cannot sample a PMREM environment, which is where all
  // of this scene's ambient light comes from. Both are the same studio room, so it is rendered
  // once into a cube map; the tracer converts that to the equirect map it does understand.
  function ptEnvMap() {
    if (ptEnv || typeof premiumEnvScene !== 'function') return ptEnv;
    const room = premiumEnvScene();
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    new THREE.CubeCamera(1, 1200, rt).update(renderer, room);
    room.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    ptEnv = rt.texture;
    return ptEnv;
  }
  // What is worth tracing: the board, the pieces and the look's surroundings. Left out are the
  // dust and mote clouds (Points, which a path tracer has no notion of), the glow and hover
  // planes, the coach's rails, and the fog — none of them survive as geometry — and the crowd,
  // whose InstancedMesh this version of the tracer would bake as one figure at the group origin.
  function ptObjects() {
    const out = [], add = o => { if (o && o.visible) out.push(o); };
    if (typeof boardTop !== 'undefined') add(boardTop);
    if (typeof boardRim !== 'undefined') add(boardRim);
    add(boardTrim);
    if (typeof fallFloor !== 'undefined') add(fallFloor);
    for (const pair of [typeof tripods !== 'undefined' ? tripods : null, typeof htpTripods !== 'undefined' ? htpTripods : null])
      for (const t of pair || []) add(t);
    if (envGroup) envGroup.traverse(o => { if (o.isMesh && !o.isInstancedMesh) add(o); });
    scene.traverse(o => { if (o.isDirectionalLight) out.push(o); });   // the key and its rim; hemisphere light has no equivalent
    return out;
  }
  function ptInit() {
    ptTracer = new window.TAU_PT.WebGLPathTracer(renderer);
    ptTracer.renderDelay = 0;
    // Nothing traced reaches the screen until it has this many samples on it: below about twenty
    // the image is visibly speckled, and fading raster -> noise -> clean image read as the picture
    // "going grainy" every time the scene settled. The rasterised frame holds until it is clean.
    ptTracer.minSamples = 24;
    ptTracer.fadeDuration = 450;
    ptTracer.bounces = 5;
    ptTracer.transmissiveBounces = 8;
    ptTracer.tiles.set(2, 2);   // a quarter of the frame per call, so the first press still lands inside a frame
    // Until the traced image has samples to show, what fills the canvas is the GAME's frame —
    // dust, glow and all — not the stripped scene the tracer holds, so nothing blinks out.
    ptTracer.rasterizeSceneCallback = () => { if (!renderGlassFrame()) renderer.render(scene, camera); };
    ptScene = new THREE.Scene();
    ptScene.environment = ptEnvMap();
  }
  function ptRest(state) {
    if (!ptTracer) ptInit();
    const world = rayTraceKey({ ...state, camera: null, proj: null, size: '' });
    if (world === ptWorldKey) { ptTracer.updateCamera(); return true; }   // same world, new viewpoint: no BVH work
    ptWorldKey = world;
    // The meshes in the traced scene must be the GAME's meshes, or nothing the player did would
    // show in the trace. Adding them would reparent them out of the live scene, so the list goes
    // straight onto children: three builds each world matrix from the object's REAL parent, not
    // from whoever is traversing it, so both scenes see the same, correct transforms.
    ptScene.children = ptObjects();
    ptScene.background = scene.background;
    ptScene.environmentIntensity = PT_LIGHT_TRIM;
    // The lamps in the traced scene ARE the game's lamps, so they are turned down only for the
    // moment the tracer reads them (setScene copies their intensities into its own uniforms) and
    // put straight back -- the rasterised frame, which shares them, keeps its own exposure.
    const dimmed = [];
    scene.traverse(o => { if (o.isDirectionalLight) { dimmed.push([o, o.intensity]); o.intensity *= PT_LIGHT_TRIM; } });
    // Trace fewer pixels than the screen has when the screen is large, and let the blit stretch
    // them: a 4K canvas is four times the work of a 1080p one for a picture the eye reads the same,
    // and that difference alone is what puts some machines under.
    const px = renderer.domElement.width * renderer.domElement.height;
    ptTracer.renderScale = px > PT_TRACE_PIXELS ? Math.sqrt(PT_TRACE_PIXELS / px) : 1;
    const t0 = (performance || Date).now();
    try { ptTracer.setScene(ptScene, camera); }
    finally { for (const [l, i] of dimmed) l.intensity = i; }
    const build = (performance || Date).now() - t0;
    ptWarm = 0;   // the frames right after a build carry the shader compile; don't judge those
    if (build > PT_SLOW_BUILD) { rayTraceTooSlow('the scene build', build); return false; }
    return true;
  }
  // The board's live cues pulse and fade frame by frame and none of them survives into the traced
  // scene. The pinned foot's glow and a line-crossing flash mean the board is being PLAYED on, not
  // looked at, so those keep the rasteriser. The hover disc does not: the mouse resting on the
  // board is where it sits all game, and dropping the trace for it made the picture flip between
  // two looks every time the cursor crossed the rim. It is drawn over the finished trace instead.
  function ptCuesUp() {
    return (typeof pivotGlowMesh !== 'undefined' && pivotGlowMesh && pivotGlowMesh.visible)
      || (typeof crossFlashes !== 'undefined' && crossFlashes.length > 0);
  }
  // The hover highlight, painted on top of the traced frame. Its own scene, holding the game's own
  // mesh (children assigned directly, so three still builds the matrix from its REAL parent), with
  // the clear suppressed so the trace underneath survives. It is an additive disc lying on the
  // board, so drawing it without the scene's depth costs nothing but a piece never hiding it.
  function ptDrawHover() {
    if (typeof hoverDisc === 'undefined' || !hoverDisc || !hoverDisc.visible) return;
    if (!ptCueScene) ptCueScene = new THREE.Scene();
    ptCueScene.children = [hoverDisc];
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    // The depth left in the buffer belongs to whichever frame last rasterised, which may be from
    // before the camera moved; clearing it means the disc is drawn against nothing but the traced
    // picture, which is exactly what it is meant to sit on.
    if (renderer.clearDepth) renderer.clearDepth();
    renderer.render(ptCueScene, camera);
    renderer.autoClear = auto;
  }
  function rayTraceFrame() {
    if (ptPhase !== 'ready' || ptCuesUp()) { ptStill = 0; return false; }
    try {
      const state = rayTraceState(), key = rayTraceKey(state);
      if (key !== ptKey) { ptKey = key; ptStill = 0; ptFrameAt = 0; ptSlow = 0; return false; }
      if (++ptStill < PT_STILL_FRAMES) return false;
      if (ptStill === PT_STILL_FRAMES && !ptRest(state)) return false;
      if (ptTracer.samples < PT_SAMPLE_CAP) {
        // How long the LAST traced frame took, measured from the outside: renderSample only queues
        // the work, so the honest number is how long the game took to come back round for another.
        const now = (performance || Date).now();
        if (ptFrameAt && ptWarm++ > 2) {
          ptSlow = now - ptFrameAt > PT_SLOW_FRAME ? ptSlow + 1 : 0;
          if (ptSlow >= PT_SLOW_STRIKES) { rayTraceTooSlow('a traced frame', now - ptFrameAt); return false; }
        }
        ptFrameAt = now;
        ptTracer.renderSample();
      }
      ptDrawHover();
      return true;   // at the cap nothing is drawn at all: the finished frame stays on the canvas
    } catch (e) { rayTraceFail(e); return false; }
  }
  function renderFrame() {
    if (!renderer || !camera) return false;
    if (settings.rayTrace && rayTraceFrame()) return true;
    return renderGlassFrame();
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
    // A look's surroundings come into the match with it and leave with it: Colossus's stands and
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
    // the look's own ground replaces the black floor; otherwise the black floor is moved to its depth
    lookOwnGround = !!(T && (T.ownGround || T.gravity));   // nothing to draw a floor for if it never lands
    lookFloor = (T && T.floorY != null) ? T.floorY
              : (FLOOR_BY_BOARD[fin.id] != null ? FLOOR_BY_BOARD[fin.id] : gameFloor());
    if (typeof fallFloor !== 'undefined' && fallFloor) {
      fallFloor.visible = !lookOwnGround;
      fallFloor.position.y = lookFloor;
    }
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
    ptWorldRev++;   // new surfaces, pieces and surroundings: the traced scene has to be rebuilt
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
    let distance, tx=0,ty=4,tz=0, elevOverride=0;
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
      // WATCH THE PIECE, not the board it left. The target used to barely move off centre and stay
      // at board height while the loser dropped thirty-odd units below it and rolled out past the
      // rim -- the camera ended up framing an empty board with the whole fall off the bottom edge.
      // Following most of the way keeps both the board and the landing in shot.
      const p=tripods[fall.idx].position;
      tx=Math.max(-110,Math.min(110,p.x)); tz=Math.max(-110,Math.min(110,p.z));
      ty=p.y+6; distance+=34;
      // A piece that gravity has let go of goes up rather than down, and it keeps going. Stand back
      // as it climbs and drop towards level, so the board stays in shot under it instead of the
      // camera riding away with it into empty sky.
      if (lookTheme && lookTheme.gravity && p.y > 0) {
        const climb = Math.min(1, p.y/150);
        ty = p.y*(1 - climb*0.55) + 6;
        distance += climb*150;
        elevOverride = 0.765 - climb*0.42;
      }
    }
    outTarget.set(tx,ty,tz);
    // The elevation is the boards' usual 44 degrees unless the showing look asks for its own
    // (Colossus sits lower, to take in the stands); a wider lens keeps the dish the same size.
    const gc = lookTheme && lookTheme.gameCam;
    const elev = elevOverride || (gc && gc.elev ? gc.elev : 0.765);
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
    // A falling piece is chased, not settled towards: on a look whose floor is a long way down
    // (marble's table stands in a hall) the calm rate leaves the camera a third of a second behind
    // and the landing happens below the bottom edge.
    const rate = corner ? 6.5 : falling ? 5.8 : 3.2;
    const blend=settings.reducedMotion?1:1-Math.exp(-dt*rate);
    camera.position.lerp(cameraGoal,blend); controls.target.lerp(targetGoal,blend);
    return true;
  }

  function rumble(strength=.2) {
    const pad = actingPad();
    if(!settings.haptics || !pad?.vibrationActuator) return;
    if(performance.now()-lastRumble<120) return;
    lastRumble=performance.now();
    try { const p=pad.vibrationActuator.playEffect('dual-rumble',{duration:65,weakMagnitude:strength,strongMagnitude:strength*.35}); p?.catch(()=>{}); } catch(_) {}
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
  function triggerPull(i, pad) {
    const b=(pad||currentPad)?.buttons[i]; if(!b) return 0;
    const v=typeof b.value==='number' ? b.value : (b.pressed?1:0);
    return v>.04 ? (v-.04)/.96 : 0;
  }
  function triggerAxis(pad) { return triggerPull(7,pad)-triggerPull(6,pad); }
  // Left stick orbits the camera around whatever the controls are already looking at. Setting
  // camManualSet stops updateCamera's auto-frame from hauling the view back the next frame — the
  // same latch a mouse drag sets, so a pad and a mouse hand off to each other cleanly.
  // Looking around is not a move: the camera answers whenever a match is on screen, including while
  // the opponent is thinking or playing their turn. It used to sit behind canPlay(), which is false
  // on anyone else's turn, so the view froze exactly when a player had time to study the board.
  function canLook() { return inMatch() && !dialogOpen() && !$('htpFull') && !paused && !replayActive; }
  function orbitCamera(lx,ly,dt) {
    if(!renderer || !canLook() || (Math.abs(lx)<.18 && Math.abs(ly)<.18)) return;
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
  // The board is alive; two dead lacquered objects standing on it give the game away. Each side
  // breathes on its own clock -- the glow swells and falls, and the thin-film sheen drifts with it,
  // which is the part you notice without being able to say what moved. Slow enough that a still
  // frame looks like any other; nothing here is a cue the player has to read.
  function alienBreath(now) {
    for (const pair of [typeof tripods !== 'undefined' ? tripods : null,
                        typeof htpTripods !== 'undefined' ? htpTripods : null]) {
      if (!pair) continue;
      pair.forEach((piece, i) => {
        const mats = piece && piece.userData && piece.userData.showMats;
        if (!mats) return;
        const ph = now*0.5 + i*2.4;
        const swell = 0.74 + 0.30*Math.sin(ph) + 0.09*Math.sin(ph*2.7 + 1.1);
        for (const m of mats) {
          if (!m) continue;
          const d = m.userData;
          if (d.alienEmissive == null) d.alienEmissive = m.emissiveIntensity;
          if (d.alienIrid == null) d.alienIrid = m.iridescence;
          m.emissiveIntensity = d.alienEmissive * swell;
          if (d.alienIrid) m.iridescence = d.alienIrid * (0.72 + 0.4*Math.sin(ph*0.63 + 0.8));
        }
      });
    }
  }
  function pollInput(dt) {
    if (detail && detail.uniforms) {
      const u = detail.uniforms, now = performance.now()/1000;
      u.uDetail.value = detailMode === 3 ? 0 : detailMode;   // the membrane is its own pass below
      u.uDetailTime.value = now;
      u.uAlien.value = detailMode === 3 ? 1 : 0; u.uAlienTime.value = now;
      if (detailMode === 3) alienBreath(now);   // the pieces are of this place too, so they breathe
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
    // Every connected pad, not only the ones the browser labels "standard". A controller in
    // DirectInput mode, an adapter, or anything Chromium has no mapping table for reports an empty
    // mapping -- filtering those out made such a pad invisible to the whole game: no seat, no
    // readout, nothing to press. Their button numbers can differ from the standard layout, which is
    // what the readout warns about, but a pad that mostly works beats a pad that does nothing.
    padList=Array.from(navigator.getGamepads?.() || []).filter(p=>p?.connected);
    currentPad=padList[0] || null;
    if(pick){pollPick();padPrev=padList.map(p=>{ const a=p.buttons.map(b=>b.pressed); a.dir=padDir(p); return a; });tickEffects(dt);return;}
    if(padBrandShown && $('desktopPadDiagram') && padBrand()!==padBrandShown) drawPad();   // the sheet follows the pad that is plugged in
    if($('desktopPadSeen')) drawPadSeen();
    if($('desktopQualityNote')) drawQualityNote();
    if(lastActive!==G.active){lastActive=G.active;chosenFoot=0;heldLeft=heldRight=false;lastCrossings=0;}
    // The seats belong to the match that chose them, and nothing else: back on the menu (or in any
    // match that never asked) they are empty and every input is one player's.
    if(!inMatch() && (seats[0]||seats[1])) seats=[null,null];
    const inPlay = inMatch() && !dialogOpen() && !$('htpFull');
    // In a local 1v1 on split seats only the active colour's own pad can move a piece; menus stay
    // on whichever pad is in hand. Everything else has one human, so it stays on the first pad.
    const act = inPlay ? actingPad() : currentPad;
    // The match menu answers to EVERY pad, not just the one whose turn it is: either player has to
    // be able to pause, change a setting or leave without being handed the other's controller.
    if(inPlay) padList.forEach((p,i)=>{
      if(p!==act && p.buttons[9]?.pressed && !(padPrev[i]||[])[9]) openPause();
    });
    // Menus answer to EVERY pad. Driving them from one chosen pad meant player two's controller did
    // nothing at all outside their own turn -- and on the home menu it made the answer to "which pad
    // works here" depend on which one the browser happened to list first.
    const menuContext = $('htpFull') || (dialogOpen()?$('modalBox'):(!inMatch()?home:null));
    if(menuContext) padList.forEach((pad,i)=>padMenu(pad, padPrev[i]||[], menuContext));
    if(act && !menuContext){
      // Everything this pad does is tagged as pad input, so index.html's one gate can turn away a
      // pad seated to the other colour (see seatBlocks) without knowing anything about pads.
      inputDevice='pad';
      const prev=padPrev[padList.indexOf(act)] || [];
      const down=i=>!!act.buttons[i]?.pressed, pressed=i=>down(i)&&!prev[i];
      if(inMatch()) {
        if(pressed(9))openPause();
        // The D-pad picks the foot in EVERY scheme — one thing that never moves, so the sticks and
        // triggers are free to mean different things per scheme without the choice of foot moving too.
        const dir=padDir(act), wasX=(prev.dir||{}).x||0;
        if(dir.x && dir.x!==wasX) chooseFoot(chosenFoot+dir.x);
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
          swing(triggerAxis(act),dt,.02);
        } else {
          swing(act.axes[2]||0, dt);                                       // right stick left/right turns
        }
        orbitCamera(act.axes[0]||0, act.axes[1]||0, dt);                   // left stick moves the camera, always
        // Both seats can look around in a local 1v1: the waiting player is allowed to study the
        // board from their own angle, they just cannot touch a piece (see seatBlocks).
        for (const p of padList) if (p !== act) orbitCamera(p.axes[0]||0, p.axes[1]||0, dt);
        // A short pulse each time a foot actually crosses a printed line: the rule that decides the
        // turn, felt rather than read off the crossings counter.
        if(typeof G.crossings==='number'){
          if(G.crossings>lastCrossings) rumble(.34);
          lastCrossings=G.crossings;
        }
        if(canPlay())v3HoverIdx=G.pinned===null?chosenFoot:G.pinned;
      }
      inputDevice='kbm';
    }
    // Every pad's buttons are remembered, not just the acting one: otherwise the pad that is waiting
    // for its turn would fire everything it was holding the moment the turn passed to it.
    padPrev=padList.map(p=>{ const a=p.buttons.map(b=>b.pressed); a.dir=padDir(p); return a; });
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
  canvas.tabIndex=0;
  $('modalBox').setAttribute('role','dialog');
  $('modalBox').setAttribute('aria-modal','true');
  $('modalBox').setAttribute('aria-labelledby','modalTitle');

  window.tauDesktop={
    get paused(){return paused;},
    get menuOpen(){return dialogOpen();},
    startMatch, chooseDevices, seatBlocks,
    get inputDevice(){return inputDevice;},
    set inputDevice(v){ inputDevice = v === 'pad' ? 'pad' : 'kbm'; },
    get keys(){return {...settings.keys};},
    get skin(){return finish().skin;},
    get padScheme(){return settings.padScheme;},
    get padBrand(){return settings.padBrand;},
    set padBrand(v){ if(PAD_BRANDS.includes(v)){ settings.padBrand=v; saveSettings(); if($('desktopPadBrand')) $('desktopPadBrand').value=v; drawPad(); } },
    padBrandOf, controllerSvg,
    set padScheme(v){ if(PAD_SCHEMES.includes(v)){ settings.padScheme=v; saveSettings(); } },
    get invertCamY(){return settings.invertCamY;},
    set invertCamY(v){ settings.invertCamY=!!v; saveSettings(); },
    get board(){return settings.board;},
    set board(v){ if(BOARD_FINISHES.some(b=>b.id===v)){ settings.board=v; saveSettings(); applyMaterials(); applyTheme(); render(); } },
    get boards(){return BOARD_FINISHES.map(b=>({id:b.id,name:b.name,unlocked:isUnlocked(b.id),unlock:unlockText(b.id)}));},
    get progress(){return {...progress};},
    recordResult,
    debugDetailMode(){ return detailMode; },
    resize:layout, updateCamera, tick:pollInput, applyMaterials, showResult, fallTimeScale, fallFloorY, fallGravity, renderFrame,
    get rayTrace(){return settings.rayTrace;},
    set rayTrace(v){ settings.rayTrace=!!v; settings.quality = settings.rayTrace ? 'ultra' : (settings.quality==='ultra'?'high':settings.quality);
      saveSettings(); if($('desktopQuality')) $('desktopQuality').value=settings.quality;
      if(settings.rayTrace) rayTraceLoad(); drawQualityNote(); },
    rayTraceStatus(){return ptPhase;},
    rayTraceOverlay(){return ptCueScene;},   // what gets painted over a finished trace
    glassNear(){return gpNear;},   // the piece currently drawn through the other
    // whether two pieces overlap on screen from where the camera stands -- the question that
    // decides whether the second pass is worth drawing at all
    glassOverlap(a, b){ if(!camera||!a||!b) return false; a.updateMatrixWorld(); b.updateMatrixWorld();
      return gpOverlap(a, b); },
    rayTraceSamples(){return ptTracer ? ptTracer.samples : 0;},   // how far the still has refined
    canPlayNow: canPlay, canLookNow: canLook,
    rayTraceMotion,
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
    // index.html's setLang, after a switch from the corner picker or this layer's own Settings row.
    onLangChange(){ relabelHome(); resize(); },
    onModalShown(){
      delete $('modalBox').dataset.desktopResult;
      previousFocus=document.activeElement;
      // No pause here: the opponent keeps playing under the menu (see openPause). Input to the
      // board is blocked by the open dialog itself (canPlay / inputBlocked check dialogOpen).
      requestAnimationFrame(()=>{if(dialogOpen())(focusable($('modalBtns'))[0]||focusable($('modalBox'))[0])?.focus();});
    },
    onModalHidden(){setPaused(false);$('modalBox').classList.remove('desktop-sheet');if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});previousFocus=null;},
  };
  relabelHome();
  saveSettings(); applyTheme(); resize();
  if(settings.rayTrace) rayTraceLoad();
  if(!inMatch())$('desktopPlay').focus({preventScroll:true});
})();
