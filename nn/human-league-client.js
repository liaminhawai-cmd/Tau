// League panel for the game page, injected only by nn/human-league.js (PLAY-LEAGUE.bat) -- the
// public site never loads this file. It plays you against league faces through the normal game
// screen: your moves are yours, the face's moves come from the local server (the league's own
// brain for that face), and every finished game is sent back as league evidence and training rows.
//
// It works by wrapping a few of index.html's own functions rather than changing them:
//   startAiTurn / nnPlanForGame  -- the face's move is fetched, then played by the normal AI path
//   finishTurn                   -- records the position each move was made from
//   startGame / backToMenu       -- a rematch starts a new league game; leaving closes the session
(function () {
  'use strict';
  if (window.__tauLeague) return;
  window.__tauLeague = true;
  // This page runs on its own address (127.0.0.1), which the site has never seen, so it would open
  // the first-visit how-to-play over the board. You know the game: mark this origin onboarded
  // before the page's load handler looks.
  try { if (typeof markOnboarded === 'function') markOnboarded('league'); } catch (e) {}
  const LEAGUE_MODEL = { league: true };       // stands in for a loaded checkpoint so the AI path runs
  const L = { game: null, last: null, tok: 0, state: null, nextSide: 0, starting: false };
  const $ = id => document.getElementById(id);
  const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    .then(r => r.json());
  const snap = () => ({ pose: poseNow(), m: G.active, plies: G.plies || 0,
                        ko: G.koHist ? JSON.parse(JSON.stringify(G.koHist)) : null });
  const inLeague = () => !!(L.game && vsAI && aiDifficulty === 'nn' && nnModel === LEAGUE_MODEL);

  // ---------- panel ----------
  const css = document.createElement('style');
  css.textContent = `
    #lgPanel { position:fixed; top:calc(10px + env(safe-area-inset-top)); right:10px; z-index:2147483000; width:290px;
               background:rgba(17,21,27,.94); border:1px solid #3a4048; border-radius:9px; padding:10px 12px;
               font:12px/1.4 system-ui,sans-serif; color:#d7dce1; box-shadow:0 4px 18px rgba(0,0,0,.4); }
    #lgPanel.min > :not(.lgHead) { display:none; }
    #lgPanel .lgHead { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
    #lgPanel .lgHead b { color:#ffd23f; letter-spacing:.05em; text-transform:uppercase; font-size:11.5px; }
    #lgPanel .lgHead button { background:none; border:none; color:#7d858d; font-size:14px; margin:0; padding:0 4px; cursor:pointer; }
    #lgPanel .lgRow { display:flex; gap:6px; align-items:center; margin:5px 0; }
    #lgPanel .lgRow label { width:62px; color:#9aa4ad; }
    #lgPanel select { flex:1; min-width:0; background:#0f1319; color:#e6e9ec; border:1px solid #2c3138; border-radius:5px; padding:4px; font-size:12px; }
    #lgPanel .lgBtns { display:flex; gap:6px; margin-top:8px; }
    #lgPanel .lgBtns button { flex:1; margin:0; padding:7px 6px; font-size:12px; border-radius:6px; border:1px solid #3d4753;
                              background:#1c222a; color:#e6e6e6; cursor:pointer; }
    #lgPanel .lgBtns button.go { border-color:#ffd23f; color:#ffd23f; }
    #lgPanel .lgBtns button:disabled { opacity:.4; cursor:default; }
    #lgPanel #lgMe { color:#e6e9ec; }
    #lgPanel #lgMe small { color:#7d858d; }
    #lgPanel #lgMsg { margin-top:7px; min-height:16px; color:#9aa4ad; }`;
  document.head.appendChild(css);
  const el = document.createElement('div');
  el.id = 'lgPanel';
  el.innerHTML = `
    <div class="lgHead"><b>League</b><button id="lgMin" title="Hide">–</button></div>
    <div id="lgMe">Connecting…</div>
    <div class="lgRow"><label>Opponent</label><select id="lgFace"><option value="auto">Auto: match my rating</option></select></div>
    <div class="lgRow"><label>You play</label><select id="lgSide"><option value="alt">Alternate colours</option>
      <option value="0">Blue</option><option value="1">Red</option></select></div>
    <div class="lgBtns"><button id="lgNext" class="go">Next game ▶</button><button id="lgBack" disabled>Take back ↶</button><button id="lgDone">Done</button></div>
    <div id="lgMsg"></div>`;
  document.body.appendChild(el);
  $('lgMin').addEventListener('click', () => el.classList.toggle('min'));
  const status = t => { $('lgMsg').textContent = t || ''; };
  function renderMe() {
    const m = L.state && L.state.me;
    if (!m) return;
    const p = m.provisional, u = m.undo.provisional;
    $('lgMe').innerHTML = `${m.id}: <b>${p.elo}</b> <small>(${p.games} game${p.games === 1 ? '' : 's'}, ${p.w}-${p.l}-${p.d}` +
      `${m.official ? `; league ${m.official.elo}` : ''})</small>` +
      (u.games ? `<br><small>with take-backs: ${u.elo} over ${u.games} game${u.games === 1 ? '' : 's'}</small>` : '') +
      `<br><small>Auto matches on ${m.matchOn === 'undo' ? 'your take-back rating' : 'your clean rating'} (${m.matchElo}).</small>`;
  }
  function renderFaces() {
    const sel = $('lgFace'), keep = sel.value;
    const faces = (L.state && L.state.faces) || [];
    sel.innerHTML = '<option value="auto">Auto: match my rating</option>' +
      faces.map(f => `<option value="${f.id}">${f.id}  ·  ${f.elo}${f.games < 6 ? ' (new)' : ''}</option>`).join('');
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  }
  function renderButtons() {
    const g = L.game;
    $('lgBack').disabled = !(g && g.turns.some(t => t.m === g.humanSide));
  }
  async function refresh() {
    try {
      L.state = await fetch('/league/state?last=' + encodeURIComponent(L.last || '')).then(r => r.json());
      renderMe(); renderFaces();
    } catch (e) { status('Cannot reach the league server -- is PLAY-LEAGUE still running?'); }
    return L.state;
  }

  // ---------- a league game ----------
  function begin(face, side) {
    const g = { session: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), face: face.id, faceElo: face.elo,
                depth: face.depth, humanSide: side, turns: [], starts: [], undo: false, lines: 0, pending: false };
    L.game = g; L.last = face.id;
    labMode = false; labAuto = false; ladderLevel = null;
    nnModel = LEAGUE_MODEL; nnPolicyModel = null; nnModelName = face.id;
    nnDepth = face.depth; nnDynamic = false; nnTemperature = 0;
    L.starting = true;
    try { startGame(true, side, 'nn'); } finally { L.starting = false; }
    g.starts.push(snap());
    renderButtons();
    status(`You are ${side === 0 ? 'Blue' : 'Red'} against ${face.id} (${face.elo}).`);
  }
  async function finishSession() {
    const g = L.game;
    if (!g || !g.lines) return;
    g.lines = 0;
    try {
      const r = await post('/league/finish', { session: g.session });
      if (r && r.me && L.state) { L.state.me = r.me; renderMe(); }
    } catch (e) { status('Could not save the last game: ' + e.message); }
  }
  async function nextGame() {
    await finishSession();
    const st = await refresh();
    if (!st) return;
    const pick = $('lgFace').value === 'auto' ? st.suggested : $('lgFace').value;
    const face = (st.faces || []).find(f => f.id === pick);
    if (!face) { status('No league face to play yet -- the league needs a rated pass first.'); return; }
    const sideSel = $('lgSide').value;
    const side = sideSel === 'alt' ? L.nextSide : +sideSel;
    L.nextSide = 1 - side;
    begin(face, side);
  }
  function lineDone(g) {
    g.lines++;
    const won = !G.adjudicated && G.winner === g.humanSide, lost = !G.adjudicated && G.winner === 1 - g.humanSide;
    post('/league/line', { session: g.session, face: g.face, faceElo: g.faceElo, humanSide: g.humanSide, undo: g.undo,
                           turns: g.turns.slice(), winner: G.winner, adjudicated: !!G.adjudicated })
      .catch(e => status('Could not save this game: ' + e.message));
    status((won ? 'You won.' : lost ? `${g.face} won.` : 'Drawn on the move cap.') +
           ' Next game to bank it' + (g.undo ? ' (rated with take-backs)' : '') + ', or take back to keep exploring.');
  }
  function takeBack() {
    const g = L.game;
    if (!g) return;
    let i = g.turns.length - 1;
    while (i >= 0 && g.turns[i].m !== g.humanSide) i--;
    if (i < 0) return;
    L.tok++; g.pending = false; g.forced = null; g.aiScore = null;
    clearTimeout(aiTimer); clearTimeout(aiGapTimer); clearTimeout(gameOverTimer); aiAnim = null;
    hideModal();
    const st = g.starts[i];
    replayApplyPose(st.pose); G.active = st.m;
    G.over = false; G.winner = null; G.adjudicated = false; G.plies = st.plies;
    if (st.ko && G.koHist) { G.koHist.length = 0; for (const q of st.ko) G.koHist.push(q); }
    fall.active = false; fallenIdx = -1;
    if (typeof tripods !== 'undefined' && tripods) tripods.forEach(t => { t.visible = true; t.position.y = 0; });
    clearTurn();
    g.turns.length = i; g.starts.length = i + 1; g.undo = true;
    render(); renderButtons();
    status('Took it back. Your move.' + (g.lines ? ' Finished lines are kept.' : ''));
  }
  $('lgNext').addEventListener('click', nextGame);
  $('lgBack').addEventListener('click', takeBack);
  $('lgDone').addEventListener('click', async () => {
    await finishSession();
    if (L.game) { L.game = null; backToMenu(); }
    status('Saved. The league folds your games in at its next pass.');
  });
  window.addEventListener('pagehide', () => {
    const g = L.game;
    if (g && g.lines) navigator.sendBeacon('/league/finish', new Blob([JSON.stringify({ session: g.session })], { type: 'application/json' }));
  });

  // ---------- the game's own functions, wrapped ----------
  const origAi = window.startAiTurn;
  window.startAiTurn = function () {
    if (!inLeague()) return origAi.apply(this, arguments);
    const g = L.game;
    if (G.over || G.active !== aiIdx || g.pending) return;
    g.pending = true;
    const tok = ++L.tok, t0 = performance.now();
    status(`${g.face} is thinking…`);
    post('/league/move', { face: g.face, pose: poseNow(), active: G.active }).then(res => {
      if (tok !== L.tok || L.game !== g) return;
      g.pending = false;
      if (G.over || G.active !== aiIdx) return;
      if (!res || res.error) { status('The face could not move: ' + (res && res.error)); return; }
      if (!res.plan) {                         // wedged: no legal move, the turn passes (as in arena)
        clearTurn(); G.active = 1 - G.active; g.starts[g.starts.length - 1] = snap(); render();
        status(`${g.face} has no move; your turn.`); return;
      }
      g.forced = res.plan; g.aiScore = { sv: res.sv, svd: res.svd };
      origAi();
      status(`${g.face} moved (${((performance.now() - t0)/1000).toFixed(1)}s). Your move.`);
    }).catch(e => { if (tok === L.tok) { g.pending = false; status('Lost the league server: ' + e.message); } });
  };
  const origNN = window.nnPlanForGame;
  window.nnPlanForGame = function () {
    const g = L.game;
    if (g && g.forced) { const p = g.forced; g.forced = null; return { pivotIdx: p.pivotIdx, dir: p.dir, targetRad: p.targetRad }; }
    return origNN.apply(this, arguments);
  };
  const origFinish = window.finishTurn;
  window.finishTurn = function () {
    if (!inLeague() || labSetup) return origFinish.apply(this, arguments);
    const g = L.game, start = g.starts[g.starts.length - 1];
    const t = { pose: start.pose, m: start.m };
    if (start.m !== g.humanSide && g.aiScore && g.aiScore.sv != null) { t.sv = g.aiScore.sv; t.svd = g.aiScore.svd; }
    g.aiScore = null;
    g.turns.push(t);
    const r = origFinish.apply(this, arguments);
    if (L.game === g) {
      g.starts.push(snap());
      if (G.over) lineDone(g);
      renderButtons();
    }
    return r;
  };
  const origStart = window.startGame;
  window.startGame = function (aiMode, humanColorIdx, difficulty) {
    if (L.game && !L.starting) {
      const g = L.game;
      finishSession();
      if (aiMode && difficulty === 'nn' && nnModel === LEAGUE_MODEL) {   // the sheet's rematch: same face, new game
        begin({ id: g.face, elo: g.faceElo, depth: g.depth }, humanColorIdx === undefined ? g.humanSide : humanColorIdx);
        return;
      }
      L.game = null;
      if (nnModel === LEAGUE_MODEL) nnModel = null;
    }
    return origStart.apply(this, arguments);
  };
  const origMenu = window.backToMenu;
  window.backToMenu = function () {
    if (L.game) { finishSession(); L.game = null; }
    if (nnModel === LEAGUE_MODEL) nnModel = null;
    renderButtons();
    return origMenu.apply(this, arguments);
  };

  refresh().then(st => { if (st) status('Next game plays the face nearest your rating, or pick one.'); });
  setInterval(() => { if (!L.game || !L.game.pending) refresh(); }, 60000);
})();
