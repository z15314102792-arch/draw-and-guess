/**
 * 你画我猜 - 前端游戏逻辑 v2
 */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ============ DOM 元素 ============
// Lobby
const lobbyScreen = $('#lobby-screen');
const gameScreen = $('#game-screen');
const nicknameInput = $('#nickname-input');
const createRoomBtn = $('#create-room-btn');
const roomCodeInput = $('#room-code-input');
const joinRoomBtn = $('#join-room-btn');

// 顶栏
const roomCodeDisplay = $('#room-code-display');
const roundInfo = $('#round-info');
const timerDisplay = $('#timer-display');
const menuBtn = $('#menu-btn');

// Canvas
const drawCanvas = $('#draw-canvas');
const ctx = drawCanvas.getContext('2d');

// 选词
const wordSelectPanel = $('#word-select-panel');
const wordOptions = $('#word-options');
const wordSelectCountdown = $('#word-select-countdown');
const wordHintBar = $('#word-hint-bar');
const wordHintText = $('#word-hint-text');

// 工具栏
const toolbar = $('#toolbar');
const customColorInput = $('#custom-color');

// 等待底栏
const waitingBar = $('#waiting-bar');
const waitingBarCollapsed = $('#waiting-bar-collapsed');
const waitingBarExpanded = $('#waiting-bar-expanded');
const waitingBarStatus = $('#waiting-bar-status');
const waitingBarCount = $('#waiting-bar-count');
const waitingExpandBtn = $('#waiting-expand-btn');
const waitingCollapseBtn = $('#waiting-collapse-btn');
const roomCodeBig = $('#room-code-big');
const copyRoomBtn = $('#copy-room-btn');
const waitingPlayerCount = $('#waiting-player-count');
const modeDesc = $('#mode-desc');
const startGameBtn = $('#start-game-btn');

// 底部操作
const bottomArea = $('#bottom-area');
const chatMessages = $('#chat-messages');
const guessBar = $('#guess-bar');
const guessInput = $('#guess-input');
const sendGuessBtn = $('#send-guess-btn');
const playAgainBtn = $('#play-again-btn');

// 菜单
const slideMenu = $('#slide-menu');
const menuOverlay = $('#menu-overlay');
const closeMenuBtn = $('#close-menu-btn');
const playerList = $('#player-list');
const menuPlayerCount = $('#menu-player-count');
const btnBackLobby = $('#btn-back-lobby');
const btnLeaveRoom = $('#btn-leave-room');

// 弹窗
const scorePopup = $('#score-popup');
const scoreTitle = $('#score-title');
const scoreBody = $('#score-body');
const scoreCloseBtn = $('#score-close-btn');
const toast = $('#toast');

// 微信
const wechatTip = $('#wechat-tip');
const wechatCopyBtn = $('#wechat-copy-btn');
const wechatUrlEl = $('#wechat-url');

// ============ 全局状态 ============
let socket = null;
let roomId = '';
let playerName = '';
let myPlayerId = '';
let isDrawer = false;
let isHost = false;
let gameStatus = 'lobby'; // lobby | waiting | word-select | drawing | reveal | game-over
let gameMode = 'classic';
let serverUrl = '';
let currentColor = '#000000';
let currentLineWidth = 3;
let currentTool = 'pen';
let wordSelectTimer = null;
let countdownInterval = null;
// 盲画离屏 canvas
let offscreenCanvas = null;
let offscreenCtx = null;

// ============ Socket 连接 ============
function connectSocket() {
  // 微信浏览器用纯 HTTP 轮询（WebSocket 在微信中受限）
  if (isWechatBrowser()) {
    socket = io({ transports: ['polling'] });
  } else {
    socket = io();
  }

  socket.on('connect', () => { console.log('[Socket] 已连接'); });
  socket.on('connect_error', (err) => {
    console.error('[Socket] 连接失败:', err.message);
    showToast('⚠️ 连接服务器失败，请检查网络');
  });
  socket.on('disconnect', (reason) => {
    console.log('[Socket] 断开:', reason);
    if (reason === 'transport close' || reason === 'ping timeout') {
      showToast('⚠️ 连接断开，正在重连...');
    }
  });

  // --- 错误 ---
  socket.on('error', ({ message }) => {
    showToast('❌ ' + message);
    // 恢复按钮
    createRoomBtn.disabled = false; createRoomBtn.textContent = '🏠 创建房间';
    joinRoomBtn.disabled = false; joinRoomBtn.textContent = '加入';
  });

  // --- 房间创建 ---
  socket.on('room-created', ({ roomId: rid, players, serverUrl: sUrl }) => {
    roomId = rid; myPlayerId = socket.id; isHost = true; gameStatus = 'waiting';
    if (sUrl && !sUrl.includes('localhost') && !sUrl.match(/\/\/10\.|172\./)) serverUrl = sUrl;
    else serverUrl = window.location.origin;
    updatePlayerList(players);
    switchToGameScreen();
    updateWaitingUI(players);
    createRoomBtn.disabled = false; createRoomBtn.textContent = '🏠 创建房间';
    addChatMessage('system', '✅ 房间创建成功！房间号：' + rid);
  });

  // --- 房间加入 ---
  socket.on('room-joined', (data) => {
    roomId = data.roomId; myPlayerId = socket.id;
    isHost = data.players.find(p => p.id === socket.id)?.isHost || false;
    gameStatus = data.status;
    if (data.serverUrl && !data.serverUrl.includes('localhost')) serverUrl = data.serverUrl;
    else serverUrl = window.location.origin;
    updatePlayerList(data.players);
    switchToGameScreen();

    if (gameStatus === 'waiting') {
      showWaitingMode();
      updateWaitingUI(data.players);
      joinRoomBtn.disabled = false; joinRoomBtn.textContent = '加入';
      addChatMessage('system', '✅ 加入了房间 ' + data.roomId);
    } else {
      hideWaitingMode();
      roundInfo.textContent = '第 ' + data.round + '/' + data.totalRounds + ' 轮';
      addChatMessage('system', '✅ 加入了房间（观战中）');
    }
  });

  // --- 玩家更新 ---
  socket.on('players-update', ({ players }) => {
    updatePlayerList(players);
    const me = players.find(p => p.id === socket.id);
    if (me) { isHost = me.isHost; isDrawer = me.isDrawer; }
    if (gameStatus === 'waiting') updateWaitingUI(players);
  });

  // --- 模式切换 ---
  socket.on('mode-changed', ({ mode, modeName }) => {
    gameMode = mode;
    $$('.mode-btn').forEach(b => b.classList.remove('active'));
    const ab = document.querySelector('.mode-btn[data-mode="' + mode + '"]');
    if (ab) ab.classList.add('active');
    const descs = { classic: '经典模式：轮流画词猜词，60秒', speed: '快速模式：30秒速画，只用简单词', blind: '盲画模式：画时看不到笔迹，揭晓笑翻全场', chain: '接龙模式：画→猜→画→猜传递，最后揭晓链条（需3+人，不足时AI补位）', team: '团队对抗：随机分红蓝两队，交替画猜，队友猜对加分更多', duel: '对决模式：快速45秒回合，猜对速度奖励加倍，适合2-4人竞技' };
    if (modeDesc) modeDesc.textContent = descs[mode] || '';
    showToast(modeName);
  });

  // --- 游戏开始 ---
  socket.on('game-started', ({ totalRounds, mode }) => {
    gameStatus = 'waiting';
    if (mode) gameMode = mode;
    hideWaitingMode();
    updatePlayerListUI();
    roundInfo.textContent = '准备开始';
    timerDisplay.textContent = '⏱ --';
    startGameBtn.classList.add('hidden');
    playAgainBtn.classList.add('hidden');
    clearCanvas();
    setDrawerMode(false);
    addChatMessage('system', '🎮 游戏开始！共 ' + totalRounds + ' 轮');
  });

  // --- 选词 ---
  socket.on('round-word-select', ({ round, totalRounds, drawerId, drawerName }) => {
    gameStatus = 'word-select';
    hideWaitingMode();
    toolbar.classList.add('hidden');
    roundInfo.textContent = '第 ' + round + '/' + totalRounds + ' 轮';
    clearCanvas();
    hideWordSelectPanel();
    wordHintBar.classList.add('hidden');
    guessBar.classList.add('hidden');
    startGameBtn.classList.add('hidden');
    if (drawerId === socket.id) { setDrawerMode(true); }
    else { setDrawerMode(false); addChatMessage('system', '📝 ' + drawerName + ' 正在选词...'); }
  });

  socket.on('your-word-options', ({ options, timeout }) => {
    showWordSelectPanel(options, timeout);
  });

  // --- 绘画 ---
  socket.on('round-drawing', ({ word, time, hint, mode }) => {
    gameStatus = 'drawing';
    if (mode) gameMode = mode;
    hideWordSelectPanel();
    wordHintBar.classList.add('hidden');
    clearCanvas();

    if (gameMode === 'blind' && isDrawer) {
      initOffscreenCanvas();
      clearCanvas();
    }

    if (isDrawer) {
      const label = gameMode === 'blind' ? '🙈 盲画' : gameMode === 'speed' ? '⚡ 快速' : '';
      wordHintBar.classList.remove('hidden');
      wordHintText.textContent = '🎨 画出：「' + word + '」' + (label ? ' [' + label + ']' : '');
      toolbar.classList.remove('hidden');
      guessBar.classList.add('hidden');
    } else {
      const label = gameMode === 'blind' ? '🙈 盲画' : gameMode === 'speed' ? '⚡ 快速' : '';
      wordHintBar.classList.remove('hidden');
      wordHintText.textContent = '提示：' + (hint || word) + (label ? ' ' + label : '');
      toolbar.classList.add('hidden');
      guessBar.classList.remove('hidden');
      setTimeout(() => guessInput.focus(), 100);
    }
    updateTimer(time);
  });

  socket.on('timer-update', ({ timeRemaining }) => { updateTimer(timeRemaining); });

  // --- 画板同步 ---
  socket.on('sync-draw', (data) => { if (!isDrawer) replayDrawData(data); });
  socket.on('sync-clear', () => { if (!isDrawer) clearCanvas(); });
  socket.on('request-canvas-snapshot', ({ forPlayer }) => {
    if (isDrawer) socket.emit('canvas-snapshot', { imageData: drawCanvas.toDataURL('image/png'), forPlayer });
  });
  socket.on('sync-snapshot', ({ imageData }) => {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, drawCanvas.width, drawCanvas.height); };
    img.src = imageData;
  });

  // --- 猜词 ---
  socket.on('guess-result', ({ correct, score, hint, streak, multiplier }) => {
    if (correct) {
      guessInput.disabled = true;
      let streakHtml = '';
      if (streak && streak >= 2) {
        streakHtml = ' <span class="streak-badge">🔥'+streak+'连击 x'+multiplier+'</span>';
      }
      guessInput.placeholder = '✅ 猜对了！+' + score + '分';
      sendGuessBtn.disabled = true;
      setTimeout(() => { guessInput.disabled = false; guessInput.placeholder = '你已猜对'; sendGuessBtn.disabled = true; }, 1500);
      showToast('🎉 猜对了！+' + score + '分');
    } else if (hint) { showToast('💡 ' + hint); }
  });

  // --- 聊天 ---
  socket.on('chat-message', (msg) => { addChatMessage(msg.type, msg.message, msg.from); });

  // --- 快捷表情反应 v8.0 ---
  socket.on('reaction', ({ emoji, from, fromId }) => {
    showFloatingReaction(emoji, fromId === socket.id);
    if (fromId !== socket.id) {
      addChatMessage('system', from + ' ' + emoji);
    }
  });

  // --- 回合结束 ---
  socket.on('round-end', ({ word, correctGuessers, drawerName, scoreboard }) => {
    gameStatus = 'reveal';
    clearCountdown();
    timerDisplay.textContent = '⏱ --';
    toolbar.classList.add('hidden');
    guessBar.classList.add('hidden');
    wordHintBar.classList.add('hidden');

    if (gameMode === 'blind' && isDrawer) {
      revealBlindCanvas();
      wordHintBar.classList.remove('hidden');
      wordHintText.textContent = '🙈 盲画揭晓：「' + word + '」';
    }
    if (gameMode === 'blind' && !isDrawer) {
      wordHintBar.classList.remove('hidden');
      wordHintText.textContent = '🙈 盲画作品：「' + word + '」';
    }

    const title = correctGuessers.length > 0 ? '🎉 答案：' + word : '😢 答案：' + word;
    scoreTitle.textContent = title;
    let body = '<p>画家：' + drawerName + '</p>';
    body += correctGuessers.length > 0
      ? '<p style="color:var(--success);">猜对：' + correctGuessers.join('、') + '</p>'
      : '<p style="color:var(--danger);">无人猜对</p>';
    scoreBody.innerHTML = body;
    scorePopup.classList.remove('hidden');
    scoreCloseBtn.onclick = () => scorePopup.classList.add('hidden');

    updatePlayerListUI();
  });

  socket.on('scoreboard-update', () => { updatePlayerListUI(); });

  // --- 游戏结束 ---
  socket.on('game-over', ({ winner, scoreboard }) => {
    gameStatus = 'game-over';
    clearCountdown();
    timerDisplay.textContent = '⏱ --';
    toolbar.classList.add('hidden');
    guessBar.classList.add('hidden');
    wordHintBar.classList.add('hidden');
    wordSelectPanel.classList.add('hidden');
    setDrawerMode(false);

    scoreTitle.textContent = '🏆 ' + winner.name + ' 获胜！';
    let body = '';
    scoreboard.forEach((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
      body += '<div class="score-row ' + (i === 0 ? 'winner' : '') + '"><span>' + medal + ' ' + p.name + '</span><span>' + p.score + ' 分</span></div>';
    });
    scoreBody.innerHTML = body;
    scorePopup.classList.remove('hidden');
    scoreCloseBtn.onclick = () => {
      scorePopup.classList.add('hidden');
      if (isHost) playAgainBtn.classList.remove('hidden');
    };
    addChatMessage('system', '🏆 ' + winner.name + ' 获胜！(' + winner.score + '分)');
    if (isHost) setTimeout(() => playAgainBtn.classList.remove('hidden'), 2000);
  });

  // --- 接龙模式 v5.0 ---
  socket.on('chain-draw-phase', ({ prompt, promptType, stepNumber, totalSteps }) => {
    gameStatus = 'chain-draw';
    setDrawerMode(true);
    clearCanvas();
    toolbar.classList.remove('hidden');
    guessBar.classList.add('hidden');
    wordHintBar.classList.remove('hidden');
    wordHintText.textContent = (promptType === 'word' ? '🎨 画出：「' + prompt + '」' : '🎨 根据猜测画：「' + prompt + '」') + ' [' + stepNumber + '/' + totalSteps + ']';
    roundInfo.textContent = '接龙 ' + stepNumber + '/' + totalSteps;
    timerDisplay.textContent = '⏱ --';
    // 显示提交按钮
    var sb = $('#chain-submit-btn');
    if (sb) { sb.classList.remove('hidden'); sb.disabled = false; }
    hideChainGuessPanel();
  });

  socket.on('chain-guess-phase', ({ imageData, stepNumber, totalSteps }) => {
    gameStatus = 'chain-guess';
    setDrawerMode(false);
    clearCanvas();
    toolbar.classList.add('hidden');
    guessBar.classList.add('hidden');
    wordHintBar.classList.remove('hidden');
    wordHintText.textContent = '🔍 看图猜词 [' + stepNumber + '/' + totalSteps + ']';
    roundInfo.textContent = '接龙 ' + stepNumber + '/' + totalSteps;
    timerDisplay.textContent = '⏱ --';
    // 显示前一幅画
    var img = new Image();
    img.onload = function () { ctx.drawImage(img, 0, 0, parseFloat(drawCanvas.style.width), parseFloat(drawCanvas.style.height)); };
    img.src = imageData;
    showChainGuessPanel();
  });

  socket.on('chain-waiting', ({ currentPlayer, step, total, message }) => {
    gameStatus = 'chain-waiting';
    setDrawerMode(false);
    clearCanvas();
    toolbar.classList.add('hidden');
    guessBar.classList.add('hidden');
    wordHintBar.classList.remove('hidden');
    wordHintText.textContent = '⏳ ' + message;
    roundInfo.textContent = '接龙 ' + step + '/' + total;
    timerDisplay.textContent = '⏱ --';
    hideChainSubmit();
    hideChainGuessPanel();
  });

  socket.on('chain-reveal', ({ steps, playerOrder, originalWord }) => {
    gameStatus = 'chain-reveal';
    clearCanvas();
    toolbar.classList.add('hidden');
    guessBar.classList.add('hidden');
    hideChainSubmit();
    hideChainGuessPanel();
    showChainReveal(steps, originalWord);
  });

  socket.on('chain-finished', () => {
    gameStatus = 'waiting';
    hideChainReveal();
    clearCanvas();
    showWaitingMode();
    setDrawerMode(false);
    addChatMessage('system', '🔗 接龙结束！可以开始新一轮');
  });

  // 接龙模式：画作提交按钮
  var chainSubmitBtn = $('#chain-submit-btn');
  if(chainSubmitBtn) chainSubmitBtn.addEventListener('click', function(){
    if(gameStatus !== 'chain-draw') return;
    this.disabled = true;
    var imgData = drawCanvas.toDataURL('image/png');
    socket.emit('chain-draw-submit', { imageData: imgData });
    this.classList.add('hidden');
    wordHintText.textContent = '✅ 已提交画作，等待其他人...';
  });

  // 接龙模式：猜测提交按钮
  var chainGuessSubmitBtn = $('#chain-guess-submit-btn');
  if(chainGuessSubmitBtn) chainGuessSubmitBtn.addEventListener('click', submitChainGuess);
  var chainGuessInput = $('#chain-guess-input');
  if(chainGuessInput) chainGuessInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter' || e.key === 'done' || e.key === 'go'){ e.preventDefault(); submitChainGuess(); }
  });

  // 接龙模式：猜测提交
  function submitChainGuess(){
    var inp = $('#chain-guess-input');
    if(!inp) return;
    var guess = inp.value.trim();
    if(!guess) return;
    socket.emit('chain-guess-submit', { guess: guess });
    inp.value = '';
    inp.disabled = true;
    var sb = $('#chain-guess-submit-btn');
    if(sb) sb.disabled = true;
    hideChainGuessPanel();
    wordHintText.textContent = '✅ 已提交猜测，等待其他人...';
  }

  function showChainGuessPanel(){
    var p = $('#chain-guess-panel');
    if(p) p.classList.remove('hidden');
    var inp = $('#chain-guess-input');
    if(inp) { inp.disabled = false; inp.value = ''; setTimeout(function(){inp.focus();}, 200); }
    var sb = $('#chain-guess-submit-btn');
    if(sb) sb.disabled = false;
  }
  function hideChainGuessPanel(){
    var p = $('#chain-guess-panel');
    if(p) p.classList.add('hidden');
  }
  function hideChainSubmit(){
    var sb = $('#chain-submit-btn');
    if(sb) sb.classList.add('hidden');
  }
  function showChainReveal(steps, originalWord){
    var el = $('#chain-reveal-panel');
    if(!el) return;
    el.innerHTML = '<h3>🔗 接龙揭晓</h3><p style="color:var(--text-muted);margin-bottom:12px">原词：<b>' + originalWord + '</b></p>';
    steps.forEach(function(s, i){
      var div = document.createElement('div');
      div.className = 'chain-step-item';
      div.style.animationDelay = (i * 0.5) + 's';
      if(s.type === 'word'){
        div.innerHTML = '<span class="chain-step-badge">📝</span> <b>' + s.playerName + '</b> 看到词：<b>' + s.data + '</b>';
      } else if(s.type === 'draw'){
        div.innerHTML = '<span class="chain-step-badge">🎨</span> <b>' + s.playerName + '</b> 画了：<br><img src="' + s.data + '" style="max-width:100%;border-radius:8px;margin-top:4px">';
      } else if(s.type === 'guess'){
        div.innerHTML = '<span class="chain-step-badge">🔍</span> <b>' + s.playerName + '</b> 猜：<b>' + s.data + '</b>';
      }
      el.appendChild(div);
    });
    el.classList.remove('hidden');
    wordHintBar.classList.remove('hidden');
    wordHintText.textContent = '🎬 接龙揭晓！原词：「' + originalWord + '」→ 看看变成了什么...';
  }
  function hideChainReveal(){
    var el = $('#chain-reveal-panel');
    if(el) el.classList.add('hidden');
  }
  }

  // ============ Canvas 绘图 ============
function resizeCanvas() {
  const area = $('#canvas-area');
  const maxW = Math.min(area.clientWidth - 16, 500);
  const maxH = Math.min(area.clientHeight - 40, 400);
  const w = Math.max(maxW, 280);
  const h = Math.max(maxH, 180);
  const dpr = window.devicePixelRatio || 1;
  const oldData = drawCanvas.toDataURL();
  drawCanvas.style.width = w + 'px';
  drawCanvas.style.height = h + 'px';
  drawCanvas.width = w * dpr;
  drawCanvas.height = h * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  if (oldData && oldData !== 'data:,') {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, w, h);
    img.src = oldData;
  } else {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
  }
}

function clearCanvas() {
  const w = parseFloat(drawCanvas.style.width) || drawCanvas.width;
  const h = parseFloat(drawCanvas.style.height) || drawCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  if (offscreenCtx) {
    offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    offscreenCtx.fillStyle = '#FFFFFF';
    offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  }
}

function getCanvasPos(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: cx - rect.left, y: cy - rect.top, nx: (cx - rect.left) / rect.width, ny: (cy - rect.top) / rect.height };
}

let isDrawing = false, lastPoint = null;

function startDraw(e) {
  if (gameStatus !== 'drawing' && gameStatus !== 'waiting') return;
  if (gameStatus === 'drawing' && !isDrawer) return;
  e.preventDefault();
  isDrawing = true;
  lastPoint = getCanvasPos(e);
  drawDot(lastPoint);
  emitDraw({ x1: lastPoint.nx, y1: lastPoint.ny, x2: lastPoint.nx, y2: lastPoint.ny });
}

function moveDraw(e) {
  if (!isDrawing) return;
  if (gameStatus !== 'drawing' && gameStatus !== 'waiting') return;
  if (gameStatus === 'drawing' && !isDrawer) return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  drawLine(lastPoint, pos);
  emitDraw({ x1: lastPoint.nx, y1: lastPoint.ny, x2: pos.nx, y2: pos.ny });
  lastPoint = pos;
}

function endDraw(e) {
  if (!isDrawing) return;
  e.preventDefault();
  isDrawing = false;
  lastPoint = null;
}

function drawDot(pos) {
  const tc = (gameMode === 'blind' && isDrawer && gameStatus === 'drawing') ? offscreenCtx : ctx;
  if (!tc) return;
  tc.beginPath();
  tc.fillStyle = currentTool === 'eraser' ? '#FFFFFF' : currentColor;
  tc.arc(pos.x, pos.y, currentLineWidth / 2, 0, Math.PI * 2);
  tc.fill();
}

function drawLine(from, to) {
  const tc = (gameMode === 'blind' && isDrawer && gameStatus === 'drawing') ? offscreenCtx : ctx;
  if (!tc) return;
  tc.beginPath();
  tc.moveTo(from.x, from.y);
  tc.lineTo(to.x, to.y);
  tc.strokeStyle = currentTool === 'eraser' ? '#FFFFFF' : currentColor;
  tc.lineWidth = currentTool === 'eraser' ? currentLineWidth * 3 : currentLineWidth;
  tc.lineCap = 'round'; tc.lineJoin = 'round';
  tc.stroke();
}

function emitDraw({ x1, y1, x2, y2 }) {
  socket.emit('draw', {
    x1, y1, x2, y2,
    color: currentTool === 'eraser' ? '#FFFFFF' : currentColor,
    lineWidth: currentTool === 'eraser' ? currentLineWidth * 3 : currentLineWidth,
    tool: currentTool,
  });
}

function replayDrawData(data) {
  const w = parseFloat(drawCanvas.style.width) || drawCanvas.width;
  const h = parseFloat(drawCanvas.style.height) || drawCanvas.height;
  ctx.beginPath();
  ctx.moveTo(data.x1 * w, data.y1 * h);
  ctx.lineTo(data.x2 * w, data.y2 * h);
  ctx.strokeStyle = data.color;
  ctx.lineWidth = data.lineWidth;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke();
}

function initOffscreenCanvas() {
  offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = drawCanvas.width;
  offscreenCanvas.height = drawCanvas.height;
  offscreenCtx = offscreenCanvas.getContext('2d');
  offscreenCtx.fillStyle = '#FFFFFF';
  offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
}

function revealBlindCanvas() {
  if (offscreenCanvas && offscreenCtx) {
    const w = parseFloat(drawCanvas.style.width) || drawCanvas.width;
    const h = parseFloat(drawCanvas.style.height) || drawCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(offscreenCanvas, 0, 0, w, h);
    offscreenCanvas = null; offscreenCtx = null;
  }
}

// Canvas 事件
drawCanvas.addEventListener('touchstart', startDraw, { passive: false });
drawCanvas.addEventListener('touchmove', moveDraw, { passive: false });
drawCanvas.addEventListener('touchend', endDraw);
drawCanvas.addEventListener('touchcancel', endDraw);
drawCanvas.addEventListener('mousedown', startDraw);
drawCanvas.addEventListener('mousemove', moveDraw);
drawCanvas.addEventListener('mouseup', endDraw);
drawCanvas.addEventListener('mouseleave', endDraw);

// ============ 工具栏事件 ============
$$('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentColor = btn.dataset.color;
    customColorInput.value = currentColor;
    currentTool = 'pen';
    $('#tool-pen').classList.add('active');
    $('#tool-eraser').classList.remove('active');
  });
});

customColorInput.addEventListener('input', () => {
  currentColor = customColorInput.value;
  $$('.color-btn').forEach(b => b.classList.remove('active'));
  currentTool = 'pen';
  $('#tool-pen').classList.add('active');
  $('#tool-eraser').classList.remove('active');
});

$('#tool-pen').addEventListener('click', () => {
  currentTool = 'pen';
  $('#tool-pen').classList.add('active');
  $('#tool-eraser').classList.remove('active');
});

$('#tool-eraser').addEventListener('click', () => {
  currentTool = 'eraser';
  $('#tool-eraser').classList.add('active');
  $('#tool-pen').classList.remove('active');
});

$$('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentLineWidth = parseInt(btn.dataset.size);
  });
});

$('#btn-clear').addEventListener('click', () => {
  if (gameStatus === 'drawing' && !isDrawer) return;
  if (gameStatus !== 'drawing' && gameStatus !== 'waiting') return;
  clearCanvas();
  socket.emit('clear-canvas');
});

// ============ 猜词 ============
function sendGuess() {
  const msg = guessInput.value.trim();
  if (!msg) return;
  if (isDrawer || gameStatus !== 'drawing') {
    socket.emit('chat', { message: msg });
  } else {
    socket.emit('guess', { message: msg });
  }
  guessInput.value = '';
}
sendGuessBtn.addEventListener('click', sendGuess);
guessInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'done' || e.key === 'go') { e.preventDefault(); sendGuess(); }
});

// ============ 快捷表情反应 v8.0 ============
$$('.reaction-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.emoji;
    socket.emit('reaction', { emoji });
    // 本地也显示
    showFloatingReaction(emoji, true);
    // 短暂高亮
    btn.style.transform = 'scale(1.5)';
    setTimeout(() => { btn.style.transform = ''; }, 200);
  });
});

function showFloatingReaction(emoji, isSelf) {
  const container = $('#floating-reactions');
  if (!container) return;
  const el = document.createElement('span');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  // 随机水平位置和偏移
  const left = 20 + Math.random() * 60; // 20%-80%
  const bottom = 10 + Math.random() * 30; // 10%-40%
  el.style.left = left + '%';
  el.style.bottom = bottom + '%';
  if (isSelf) el.style.fontSize = '2.5rem';
  container.appendChild(el);
  // 动画结束后移除
  setTimeout(() => { el.remove(); }, 2000);
}

// ============ Lobby 事件 ============
createRoomBtn.addEventListener('click', () => {
  const name = nicknameInput.value.trim() || '玩家';
  playerName = name;
  // 清理旧连接
  if (socket) { socket.removeAllListeners(); socket.close(); socket = null; }
  createRoomBtn.disabled = true;
  createRoomBtn.textContent = '连接中...';
  connectSocket();
  if (socket.connected) {
    socket.emit('create-room', { playerName: name });
  } else {
    socket.once('connect', () => { socket.emit('create-room', { playerName: name }); });
  }
  // 5秒超时恢复按钮
  setTimeout(() => { createRoomBtn.disabled = false; createRoomBtn.textContent = '🏠 创建房间'; }, 5000);
});

joinRoomBtn.addEventListener('click', () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) { showToast('请输入房间号'); return; }
  const name = nicknameInput.value.trim() || '玩家';
  playerName = name;
  // 清理旧连接
  if (socket) { socket.removeAllListeners(); socket.close(); socket = null; }
  joinRoomBtn.disabled = true;
  joinRoomBtn.textContent = '连接中...';
  connectSocket();
  if (socket.connected) {
    socket.emit('join-room', { roomId: code, playerName: name });
  } else {
    socket.once('connect', () => { socket.emit('join-room', { roomId: code, playerName: name }); });
  }
  // 5秒超时恢复按钮
  setTimeout(() => { joinRoomBtn.disabled = false; joinRoomBtn.textContent = '加入'; }, 5000);
});
roomCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoomBtn.click(); });

// ============ 游戏流程按钮 ============
startGameBtn.addEventListener('click', () => { socket.emit('start-game'); startGameBtn.classList.add('hidden'); });
playAgainBtn.addEventListener('click', () => { socket.emit('play-again'); playAgainBtn.classList.add('hidden'); });

// ============ 等待底栏：展开/折叠 ============
waitingExpandBtn.addEventListener('click', () => {
  waitingBarCollapsed.classList.add('hidden');
  waitingBarExpanded.classList.remove('hidden');
});
waitingCollapseBtn.addEventListener('click', () => {
  waitingBarExpanded.classList.add('hidden');
  waitingBarCollapsed.classList.remove('hidden');
});

// ============ 自定义词库 ============
var customWordsToggle = $('#custom-words-toggle');
var customWordsPanel = $('#custom-words-panel');
if(customWordsToggle) customWordsToggle.addEventListener('click', function(){
  var isHidden = customWordsPanel.classList.contains('hidden');
  customWordsPanel.classList.toggle('hidden', !isHidden);
  this.textContent = isHidden ? '📝 自定义词库 ▾' : '📝 自定义词库 ▸';
});

var customWordsSave = $('#custom-words-save');
if(customWordsSave) customWordsSave.addEventListener('click', function(){
  var ta = $('#custom-words-input');
  if(!ta) return;
  var words = ta.value.split(/[\n,，]+/).map(function(w){return w.trim();}).filter(function(w){return w.length > 0;});
  if(words.length < 10){ showToast('至少需要10个词'); return; }
  var code = btoa(unescape(encodeURIComponent(words.join(','))));
  socket.emit('set-custom-words', { words: words });
  try { localStorage.setItem('custom-words-code', code); } catch(e) {}
  showToast('✅ 词库已保存（' + words.length + '个词）');
});

var customWordsShare = $('#custom-words-share');
if(customWordsShare) customWordsShare.addEventListener('click', function(){
  var ta = $('#custom-words-input');
  if(!ta) return;
  var words = ta.value.split(/[\n,，]+/).map(function(w){return w.trim();}).filter(function(w){return w.length > 0;});
  if(words.length < 10){ showToast('至少需要10个词才能分享'); return; }
  var code = btoa(unescape(encodeURIComponent(words.join(','))));
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(code).then(function(){ showToast('✅ 词包码已复制'); });
  } else {
    fallbackCopy(code);
  }
});

var customWordsLoad = $('#custom-words-load');
var customWordsCode = $('#custom-words-code');
if(customWordsLoad && customWordsCode) customWordsLoad.addEventListener('click', function(){
  var code = customWordsCode.value.trim();
  if(!code){ showToast('请粘贴词包码'); return; }
  try {
    var words = decodeURIComponent(escape(atob(code))).split(',').filter(function(w){return w.trim();});
    if(words.length < 10){ showToast('词包码无效或词数不足'); return; }
    var ta = $('#custom-words-input');
    if(ta) ta.value = words.join('\n');
    socket.emit('set-custom-words', { words: words });
    try { localStorage.setItem('custom-words-code', code); } catch(e) {}
    showToast('✅ 已加载词包（' + words.length + '个词）');
  } catch(e){ showToast('词包码格式错误'); }
});

// 页面加载时恢复之前保存的词包码
(function(){
  try {
    var savedCode = localStorage.getItem('custom-words-code');
    if(savedCode && customWordsCode){
      customWordsCode.value = savedCode;
    }
  } catch(e) {}
})();

// ============ 等待底栏：复制房间号（只复制房间号） ============
copyRoomBtn.addEventListener('click', () => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(roomId).then(() => showToast('✅ 已复制房间号：' + roomId))
      .catch(() => fallbackCopy(roomId));
  } else {
    fallbackCopy(roomId);
  }
});

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); showToast('✅ 已复制：' + text); } catch (e) { showToast('⚠️ 复制失败'); }
  document.body.removeChild(ta);
}

// ============ 菜单 ============
menuBtn.addEventListener('click', () => {
  slideMenu.classList.add('open');
  menuOverlay.classList.remove('hidden');
});
closeMenuBtn.addEventListener('click', closeMenu);
menuOverlay.addEventListener('click', closeMenu);
function closeMenu() {
  slideMenu.classList.remove('open');
  menuOverlay.classList.add('hidden');
}

btnBackLobby.addEventListener('click', () => {
  closeMenu();
  if (socket) { socket.close(); socket = null; }
  gameScreen.classList.remove('active');
  lobbyScreen.classList.add('active');
  gameStatus = 'lobby';
  roomId = '';
  isHost = false;
  clearCountdown();
});

btnLeaveRoom.addEventListener('click', () => {
  closeMenu();
  if (socket) { socket.close(); socket = null; }
  gameScreen.classList.remove('active');
  lobbyScreen.classList.add('active');
  gameStatus = 'lobby';
  roomId = '';
  isHost = false;
  clearCountdown();
  showToast('已退出房间');
});

// ============ 模式选择 ============
$$('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!isHost || gameStatus !== 'waiting') {
      if (!isHost) showToast('只有房主可以切换模式');
      return;
    }
    socket.emit('set-mode', { mode: btn.dataset.mode });
  });
});

// ============ UI 辅助 ============
function switchToGameScreen() {
  lobbyScreen.classList.remove('active');
  gameScreen.classList.add('active');
  roomCodeDisplay.textContent = roomId;
  roomCodeBig.textContent = roomId;
  resizeCanvas();
  clearCanvas();
  showWaitingMode();
}

function showWaitingMode() {
  waitingBar.classList.remove('hidden');
  bottomArea.classList.add('hidden');
  toolbar.classList.remove('hidden');
  guessBar.classList.add('hidden');
  wordHintBar.classList.add('hidden');
  wordSelectPanel.classList.add('hidden');
  startGameBtn.classList.add('hidden');
  playAgainBtn.classList.add('hidden');
  waitingBarCollapsed.classList.remove('hidden');
  waitingBarExpanded.classList.add('hidden');
  timerDisplay.textContent = '⏱ --';
  roundInfo.textContent = '等待开始';
  isDrawer = false;
}

function hideWaitingMode() {
  waitingBar.classList.add('hidden');
  bottomArea.classList.remove('hidden');
}

function updateWaitingUI(players) {
  const connected = players.filter(p => p.connected);
  const count = connected.length;
  waitingBarCount.textContent = count + '人';
  waitingPlayerCount.textContent = '当前 ' + count + ' 人（至少需要 2 人）';
  if (count >= 2) {
    waitingBarStatus.textContent = '🟢 人数够了，房主可以开始游戏！';
    if (isHost) { startGameBtn.classList.remove('hidden'); startGameBtn.textContent = '🎮 开始游戏'; }
  } else {
    waitingBarStatus.textContent = '🟢 等待好友加入...';
    startGameBtn.classList.add('hidden');
  }
  $$('.mode-btn').forEach(b => { b.disabled = !isHost; });
}

function setDrawerMode(drawer) {
  isDrawer = drawer;
  if (gameStatus === 'waiting') { toolbar.classList.remove('hidden'); guessBar.classList.add('hidden'); return; }
  if (drawer) { toolbar.classList.remove('hidden'); guessBar.classList.add('hidden'); }
  else { toolbar.classList.add('hidden'); if (gameStatus === 'drawing') guessBar.classList.remove('hidden'); }
}

function showWordSelectPanel(options, timeout) {
  wordSelectPanel.classList.remove('hidden');
  wordOptions.innerHTML = options.map(w => '<button class="word-option">' + w + '</button>').join('');
  wordOptions.querySelectorAll('.word-option').forEach(btn => {
    btn.addEventListener('click', () => { socket.emit('word-select', { word: btn.textContent }); hideWordSelectPanel(); clearInterval(wordSelectTimer); });
  });
  let remaining = timeout;
  wordSelectCountdown.textContent = remaining;
  clearInterval(wordSelectTimer);
  wordSelectTimer = setInterval(() => { remaining--; wordSelectCountdown.textContent = remaining; if (remaining <= 0) clearInterval(wordSelectTimer); }, 1000);
}

function hideWordSelectPanel() { wordSelectPanel.classList.add('hidden'); clearInterval(wordSelectTimer); }

function updateTimer(time) {
  timerDisplay.textContent = '⏱ ' + time;
  timerDisplay.classList.toggle('warning', time <= 10);
}
function clearCountdown() { clearInterval(countdownInterval); countdownInterval = null; timerDisplay.classList.remove('warning'); }

function addChatMessage(type, message, from) {
  const div = document.createElement('div');
  div.className = 'chat-msg ' + type;
  if (type === 'guess' || type === 'chat' || type === 'self') {
    const fs = document.createElement('span'); fs.className = 'msg-from'; fs.textContent = from + '：';
    div.appendChild(fs); div.appendChild(document.createTextNode(message));
    if (type === 'self') div.classList.add('self');
  } else { div.textContent = message; }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showToast(msg) {
  toast.textContent = msg; toast.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => toast.classList.add('hidden'), 2000);
}
// v8.10: 自定义确认框（确定在右，取消在左）
function showConfirm(msg, onOk){
  var overlay=dq('#confirm-dialog'),msgEl=dq('#confirm-msg'),okBtn=dq('#confirm-ok'),cancelBtn=dq('#confirm-cancel');
  if(!overlay)return;
  msgEl.textContent=msg;overlay.classList.remove('hidden');
  function cleanup(){overlay.classList.add('hidden');okBtn.removeEventListener('click',onOkHandler);cancelBtn.removeEventListener('click',onCancel);}
  function onOkHandler(){cleanup();if(onOk)onOk();}
  function onCancel(){cleanup();}
  okBtn.addEventListener('click',onOkHandler);
  cancelBtn.addEventListener('click',onCancel);
}

function updatePlayerList(players) {
  updatePlayerListUI();
  menuPlayerCount.textContent = players.filter(p => p.connected).length;
}

function updatePlayerListUI() {
  // player-list 由 players-update 事件的数据填充
  // 在 updatePlayerList 函数中处理
}

// 覆盖 updatePlayerList 以更新 UI
const _origUPL = updatePlayerList;
updatePlayerList = function(players) {
  playerList.innerHTML = players.map(p => {
    let badges = '';
    if (p.isHost) badges += '<span class="badge badge-host">房主</span>';
    if (p.isDrawer) badges += '<span class="badge badge-drawing">绘画</span>';
    if (!p.connected) badges += '<span class="badge badge-disconnected">离线</span>';
    const icon = p.isDrawer ? '🎨' : '😊';
    return '<li class="player-item' + (p.isDrawer ? ' current-drawer' : '') + '"><span>' + icon + ' ' + p.name + '</span><span style="display:flex;gap:6px">' + p.score + '分 ' + badges + '</span></li>';
  }).join('');
  menuPlayerCount.textContent = players.filter(p => p.connected).length;
  // 模式按钮权限
  $$('.mode-btn').forEach(b => { b.disabled = !isHost; });
};

// ============ 微信检测 ============
function isWechatBrowser() { return /micromessenger/i.test(navigator.userAgent); }

if (isWechatBrowser()) {
  // 微信内使用 HTTP 轮询模式，不再强制跳转浏览器
  // 但首次加载可能较慢，显示提示
  console.log('[微信] 使用轮询模式');
}

// ============ URL 直达 ============
(function checkUrlRoom() {
  const roomFromUrl = new URLSearchParams(window.location.search).get('room');
  if (roomFromUrl) {
    roomCodeInput.value = roomFromUrl.toUpperCase();
    const names = ['小明', '小红', '小刚', '阿花', '大壮', '豆豆', '乐乐', '小雪', '小龙', '菲菲'];
    nicknameInput.value = names[Math.floor(Math.random() * names.length)];
    setTimeout(() => {
      const code = roomCodeInput.value.trim().toUpperCase();
      if (code && !socket) {
        connectSocket();
        if (socket.connected) {
          socket.emit('join-room', { roomId: code, playerName: nicknameInput.value.trim() });
        } else {
          socket.once('connect', () => { socket.emit('join-room', { roomId: code, playerName: nicknameInput.value.trim() }); });
        }
      }
    }, 300);
  }
})();

// ============ 初始化 ============
function init() {
  const names = ['小明', '小红', '小刚', '阿花', '大壮', '豆豆', '乐乐', '小雪', '小龙', '菲菲'];
  nicknameInput.value = names[Math.floor(Math.random() * names.length)];
}

init();

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 300));

// 单人创作 v3 — 浅色主题/沉浸全屏/12种创意画笔
const soloScreen=$('#solo-screen'),soloModeBtn=$('#solo-mode-btn'),soloBackBtn=$('#solo-back-btn');
const soloCanvas=$('#solo-canvas'),soloCtx=soloCanvas.getContext('2d');
// --- 工具系统 v8.0 ---
let activeTool=null; // null | 'line' | 'rect' | 'circle' | 'triangle' | 'fill' | 'eyedropper' | 'text'
let toolStartPoint=null,toolDragging=false,toolPreviewPoint=null;
const soloSizeSlider=$('#solo-size-slider'),soloSizeVal=$('#solo-size-val');
const soloOpacitySlider=$('#solo-opacity-slider'),soloOpacityVal=$('#solo-opacity-val');
const soloSmoothSlider=$('#solo-smooth-slider'),soloSmoothVal=$('#solo-smooth-val');
const soloUndoBtn=$('#solo-undo-btn'),soloRedoBtn=$('#solo-redo-btn');
const soloClearBtn=$('#solo-clear-btn'),soloSaveBtn=$('#solo-save-btn');
const soloCustomColor=$('#solo-custom-color'),soloPanBtn=$('#solo-pan-btn');
const soloZoomBadge=$('#solo-zoom-badge'),soloZoomHint=$('#solo-zoom-hint');
// v8.8 提示系统
const soloHintViewer=$('#solo-hint-viewer');
const statusTool=$('#status-tool'),statusColor=$('#status-color'),statusColorName=$('#status-color-name');
const statusLayer=$('#status-layer'),statusMode=$('#status-mode'),statusZoom=$('#status-zoom');
var hintTimeout=null;
function dq(id){return document.querySelector(id);}

let soloBrush='pen',soloColor='#000000',soloSize=3,soloOpacity=1,soloHardness=0.5;
let soloImmersed=false,soloImmersedTimeout=null,soloToolbarCollapsed=false;
let soloDrawing=false,soloLastPos=null,soloPoints=[];
// v8.3 图层系统 — soloStrokes/soloUndoStack 始终指向当前活动图层
let soloLayers=[{name:'图层1',strokes:[],undoStack:[],visible:true}],soloActiveLayer=0;
let soloStrokes=soloLayers[0].strokes,soloUndoStack=soloLayers[0].undoStack;
let soloCamX=0,soloCamY=0,soloCamZoom=1,soloTwoFinger=false;
let soloPinching=false,soloPinchStartDist=0,soloPinchStartZoom=1,soloPinchMidX=0,soloPinchMidY=0;
let soloPanning=false,soloLastPanX=0,soloLastPanY=0,soloIsPanMode=false;
let soloPigmentMode=false; // v8.8 颜料混合模式：true=三原色混色（multiply），false=普通叠加
// v8.8 图片对象系统
let soloImages=[]; // {id, img, x, y, w, h, visible, locked}
let selectedImageId=null,imageDragging=false,imageDragStartWorld=null,imageDragOrigRect=null;
let imageResizing=false,imageResizeHandle=null,imageResizeStartWorld=null;
let soloImageIdCounter=0;
// v8.8: 统一绘制顺序（图层和贴图按此顺序渲染和显示）
let soloDrawOrder=[]; // [{type:'layer'|'image', idx:N}]
let soloActiveDrawIdx=0; // soloDrawOrder 中的当前活跃项
// 初始化 drawOrder：把现有图层加进去
(function initDrawOrder(){
  soloDrawOrder=[];
  for(var i=0;i<soloLayers.length;i++)soloDrawOrder.push({type:'layer',idx:i});
  for(var i=0;i<soloImages.length;i++)soloDrawOrder.push({type:'image',idx:i});
  soloActiveDrawIdx=0;
})();
let brushTipCache=null,brushTipCacheKey='',rainbowHue=0;
function srand(seed){var x=Math.sin(seed*9301+49297)*233280;return x-Math.floor(x);}
let soloRafPending=false,soloCachedRect=null;
function scheduleRedraw(){if(soloRafPending)return;soloRafPending=true;requestAnimationFrame(function(){soloRafPending=false;doRedrawAllStrokes();});}
function doRedrawAllStrokes(){
  var w=parseFloat(soloCanvas.style.width),h=parseFloat(soloCanvas.style.height);
  var dpr=window.devicePixelRatio||1;
  soloCtx.setTransform(dpr,0,0,dpr,0,0);
  soloCtx.clearRect(0,0,w,h);soloCtx.fillStyle='#F8F8F8';soloCtx.fillRect(0,0,w,h);
  soloCtx.translate(soloCamX,soloCamY);soloCtx.scale(soloCamZoom,soloCamZoom);
  // v8.8: 按 soloDrawOrder 顺序渲染（索引0=底层先画，末位=顶层后画）
  if(!soloDrawOrder||!soloDrawOrder.length){
    soloDrawOrder=[];
    for(var li=0;li<soloLayers.length;li++)soloDrawOrder.push({type:'layer',idx:li});
    for(var ii=0;ii<soloImages.length;ii++)soloDrawOrder.push({type:'image',idx:ii});
  }
  for(var d=0;d<soloDrawOrder.length;d++){
    var item=soloDrawOrder[d];
    if(item.type==='layer'){
      var layer=soloLayers[item.idx];
      if(!layer||!layer.visible)continue;
      var strokes=layer.strokes;
      for(var i=0;i<strokes.length;i++){
        var s=strokes[i];
        if(s.brush==='fill-op'){executeStoredFill(s);}
        else if(s.brush==='text'){renderTextStroke(s);}
        else renderStroke(s);
      }
    }else if(item.type==='image'){
      var im=soloImages[item.idx];
      if(!im||!im.visible)continue;
      soloCtx.save();
      soloCtx.globalAlpha=im.opacity||1;
      soloCtx.drawImage(im.img,im.x,im.y,im.w,im.h);
      soloCtx.restore();
    }
  }
  // v8.8: 渲染选中图片的选择框
  if(selectedImageId!==null&&activeTool==='select'){
    var sim=null;for(var k=0;k<soloImages.length;k++){if(soloImages[k].id===selectedImageId){sim=soloImages[k];break;}}
    if(sim){drawImageSelection(sim);}
  }
  // 形状预览（仅绘制在当前活动图层之上）
  if(toolDragging&&toolStartPoint&&toolPreviewPoint)drawToolPreview(toolStartPoint,toolPreviewPoint,activeTool);
}
// v8.8: 绘制图片选中框+手柄
function drawImageSelection(im){
  var ctx=soloCtx,hs=8/soloCamZoom; // 手柄大小（屏幕像素/缩放）
  var x=im.x,y=im.y,w=im.w,h=im.h;
  ctx.save();
  // 虚线选中框
  ctx.strokeStyle='#1a73e8';ctx.lineWidth=2/soloCamZoom;
  ctx.setLineDash([6/soloCamZoom,3/soloCamZoom]);
  ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);
  // 4角手柄
  ctx.fillStyle='#fff';ctx.strokeStyle='#1a73e8';ctx.lineWidth=1.5/soloCamZoom;
  var corners=[[x,y],[x+w,y],[x,y+h],[x+w,y+h]];
  for(var c=0;c<corners.length;c++){
    ctx.fillRect(corners[c][0]-hs/2,corners[c][1]-hs/2,hs,hs);
    ctx.strokeRect(corners[c][0]-hs/2,corners[c][1]-hs/2,hs,hs);
  }
  // 旋转手柄（上方偏移）
  var rhx=x+w/2,rhy=y-hs*3;
  ctx.fillStyle='#1a73e8';
  ctx.beginPath();ctx.arc(rhx,rhy,hs*0.7,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#fff';ctx.lineWidth=1/soloCamZoom;
  ctx.beginPath();ctx.arc(rhx,rhy,hs*0.7,0,Math.PI*2);ctx.stroke();
  // 连接线
  ctx.strokeStyle='#1a73e8';ctx.lineWidth=1/soloCamZoom;
  ctx.beginPath();ctx.moveTo(rhx,rhy+hs*0.7);ctx.lineTo(rhx,y);ctx.stroke();
  ctx.restore();
}
// v8.8: 图片碰撞检测
function hitTestImage(wx,wy){
  for(var i=soloImages.length-1;i>=0;i--){ // 从上到下检测（后面的在顶层）
    var im=soloImages[i];
    if(!im.visible||im.locked)continue;
    if(wx>=im.x&&wx<=im.x+im.w&&wy>=im.y&&wy<=im.y+im.h)return im.id;
  }
  return null;
}
function hitTestImageHandle(wx,wy,im){
  if(!im)return null;
  var hs=10/soloCamZoom,x=im.x,y=im.y,w=im.w,h=im.h;
  var corners={tl:[x,y],tr:[x+w,y],bl:[x,y+h],br:[x+w,y+h],rot:[x+w/2,y-hs*3]};
  for(var k in corners){
    var c=corners[k];
    if(Math.abs(wx-c[0])<hs&&Math.abs(wy-c[1])<hs)return k;
  }
  return null;
}
function getImageById(id){
  for(var i=0;i<soloImages.length;i++){if(soloImages[i].id===id)return soloImages[i];}
  return null;
}

// --- 工具函数 v8.0 ---
function drawToolPreview(from,to,tool){
  var ctx=soloCtx;ctx.save();ctx.strokeStyle='rgba(0,0,0,0.35)';ctx.lineWidth=2;ctx.setLineDash([6,4]);
  ctx.lineCap='round';ctx.lineJoin='round';
  if(tool==='line'){ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();}
  else if(tool==='rect'){ctx.strokeRect(from.x,from.y,to.x-from.x,to.y-from.y);}
  else if(tool==='circle'){var rx=(to.x-from.x)/2,ry=(to.y-from.y)/2;ctx.beginPath();ctx.ellipse(from.x+rx,from.y+ry,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2);ctx.stroke();}
  else if(tool==='triangle'){var mx=(from.x+to.x)/2;ctx.beginPath();ctx.moveTo(mx,from.y);ctx.lineTo(to.x,to.y);ctx.lineTo(from.x,to.y);ctx.closePath();ctx.stroke();}
  ctx.restore();
}
function finalizeToolShape(from,to,tool){
  var ctx=soloCtx;ctx.save();ctx.strokeStyle=soloColor;ctx.lineWidth=soloSize;ctx.globalAlpha=soloOpacity;
  ctx.lineCap='round';ctx.lineJoin='round';
  if(tool==='line'){ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();}
  else if(tool==='rect'){ctx.strokeRect(from.x,from.y,to.x-from.x,to.y-from.y);}
  else if(tool==='circle'){var rx=(to.x-from.x)/2,ry=(to.y-from.y)/2;ctx.beginPath();ctx.ellipse(from.x+rx,from.y+ry,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2);ctx.stroke();}
  else if(tool==='triangle'){var mx=(from.x+to.x)/2;ctx.beginPath();ctx.moveTo(mx,from.y);ctx.lineTo(to.x,to.y);ctx.lineTo(from.x,to.y);ctx.closePath();ctx.stroke();}
  ctx.restore();
}
// v8.3: 允许填充任意颜色（含白色），靠面积上限防止误填背景
function toolFillAction(wx,wy){
  var w=soloCanvas.width,h=soloCanvas.height,dpr=window.devicePixelRatio||1;
  var px=Math.round((wx*soloCamZoom+soloCamX)*dpr),py=Math.round((wy*soloCamZoom+soloCamY)*dpr);
  if(px<0||px>=w||py<0||py>=h){showToast('点击位置超出画布');return;}
  var id=soloCtx.getImageData(0,0,w,h),d=id.data,idx=(py*w+px)*4;
  var tr=d[idx],tg=d[idx+1],tb=d[idx+2];
  var fc={r:parseInt(soloColor.slice(1,3),16),g:parseInt(soloColor.slice(3,5),16),b:parseInt(soloColor.slice(5,7),16)};
  var stack=[[px,py]],vis=new Uint8Array(w*h),tol=40,count=0,lim=Math.floor(w*h/2);
  while(stack.length&&count<lim){
    var p=stack.pop(),x=p[0],y=p[1];
    if(x<0||x>=w||y<0||y>=h)continue;var vi=y*w+x;if(vis[vi])continue;var di=vi*4;
    if(Math.abs(d[di]-tr)>tol||Math.abs(d[di+1]-tg)>tol||Math.abs(d[di+2]-tb)>tol)continue;
    vis[vi]=1;d[di]=fc.r;d[di+1]=fc.g;d[di+2]=fc.b;d[di+3]=255;stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);count++;
  }
  if(count>=lim){showToast('⚠️ 未找到封闭边界，填充取消。请先画一个封闭轮廓再填充内部');return;}
  if(count===0){showToast('💡 此处无可填充区域');return;}
  soloCtx.putImageData(id,0,0);
  soloUndoStack.length=0;
  soloStrokes.push({brush:'fill-op',fillColor:soloColor,targetR:tr,targetG:tg,targetB:tb,worldX:wx,worldY:wy,tolerance:tol});
  updateUndoRedoBtns();showToast('✅ 已填充 '+count+' 像素 — 缩放时自动适配');
}
function toolPickAction(wx,wy){
  var w=soloCanvas.width,dpr=window.devicePixelRatio||1;
  var px=Math.round((wx*soloCamZoom+soloCamX)*dpr),py=Math.round((wy*soloCamZoom+soloCamY)*dpr);
  if(px<0||px>=w||py<0||py>=soloCanvas.height)return;
  var d=soloCtx.getImageData(px,py,1,1).data;
  var hex='#'+('0'+d[0].toString(16)).slice(-2)+('0'+d[1].toString(16)).slice(-2)+('0'+d[2].toString(16)).slice(-2);
  soloColor=hex;soloCustomColor.value=hex;
  document.querySelectorAll('.solo-color-btn').forEach(function(b){b.classList.remove('active');});
  brushTipCache=null;showToast('取色：'+hex);
}
// v8.2: 文字存储为矢量笔画，重绘时重新渲染 → 跟随缩放
function toolTextAction(wx,wy){
  var text=prompt('输入文字（最多10个字）：','');
  if(!text||!text.trim())return;
  text=text.trim().slice(0,10);
  // 立即绘制
  var ctx=soloCtx,dpr=window.devicePixelRatio||1;
  ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.translate(soloCamX,soloCamY);ctx.scale(soloCamZoom,soloCamZoom);
  ctx.font='bold '+(soloSize*8)+'px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle=soloColor;ctx.globalAlpha=soloOpacity;
  ctx.fillText(text,wx,wy);
  ctx.restore();
  // 存储矢量笔画（重绘时自动跟随缩放）
  soloUndoStack.length=0;
  soloStrokes.push({brush:'text',text:text,worldX:wx,worldY:wy,fontSize:soloSize*8,color:soloColor,opacity:soloOpacity});
  updateUndoRedoBtns();showToast('✅ 已添加文字：'+text+' — 缩放时自动适配');
}

// v8.3: 重绘时重新执行填充，带缓存（不变参数时复用，避免卡顿）
function executeStoredFill(s){
  // 缓存检查：相机位置+缩放未变时直接复用上次结果
  var ck=soloCamX.toFixed(1)+','+soloCamY.toFixed(1)+','+soloCamZoom.toFixed(2);
  if(s._cached&&s._ck===ck){soloCtx.putImageData(s._cached,0,0);return;}
  var w=soloCanvas.width,h=soloCanvas.height,dpr=window.devicePixelRatio||1;
  var px=Math.round((s.worldX*soloCamZoom+soloCamX)*dpr);
  var py=Math.round((s.worldY*soloCamZoom+soloCamY)*dpr);
  if(px<0||px>=w||py<0||py>=h)return;
  var id=soloCtx.getImageData(0,0,w,h),d=id.data,idx=(py*w+px)*4;
  var tr=d[idx],tg=d[idx+1],tb=d[idx+2];
  if(Math.abs(d[idx]-s.targetR)>s.tolerance||Math.abs(d[idx+1]-s.targetG)>s.tolerance||Math.abs(d[idx+2]-s.targetB)>s.tolerance)return;
  var fc={r:parseInt(s.fillColor.slice(1,3),16),g:parseInt(s.fillColor.slice(3,5),16),b:parseInt(s.fillColor.slice(5,7),16)};
  var stack=[[px,py]],vis=new Uint8Array(w*h),count=0,lim=Math.floor(w*h/2);
  while(stack.length&&count<lim){
    var p=stack.pop(),x=p[0],y=p[1];
    if(x<0||x>=w||y<0||y>=h)continue;var vi=y*w+x;if(vis[vi])continue;var di=vi*4;
    if(Math.abs(d[di]-tr)>s.tolerance||Math.abs(d[di+1]-tg)>s.tolerance||Math.abs(d[di+2]-tb)>s.tolerance)continue;
    vis[vi]=1;d[di]=fc.r;d[di+1]=fc.g;d[di+2]=fc.b;d[di+3]=255;stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);count++;
  }
  if(count<lim){soloCtx.putImageData(id,0,0);
    // 缓存结果（相机不变时复用，消除缩放/拖拽时的卡顿）
    s._cached=new ImageData(new Uint8ClampedArray(id.data),id.width,id.height);s._ck=ck;
  }
}
function invalidateFillCaches(){
  for(var l=0;l<soloLayers.length;l++){
    var st=soloLayers[l].strokes;
    for(var i=0;i<st.length;i++){if(st[i].brush==='fill-op'){st[i]._cached=null;st[i]._ck=null;}}
  }
}
// v8.2: 矢量文字渲染
function renderTextStroke(s){
  soloCtx.save();
  soloCtx.font='bold '+s.fontSize+'px "PingFang SC","Microsoft YaHei",sans-serif';
  soloCtx.fillStyle=s.color; soloCtx.globalAlpha=s.opacity||1;
  soloCtx.fillText(s.text,s.worldX,s.worldY);
  soloCtx.restore();
}

// v8.10: 颜料模式颜色提亮（multiply过暗，提亮40%使混合结果更鲜艳）
function pigmentBlendColor(hex){
  if(!hex||hex.length<7)return hex;
  var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  var boost=0.4; // 40% 靠近白色
  r=Math.round(r+(255-r)*boost);g=Math.round(g+(255-g)*boost);b=Math.round(b+(255-b)*boost);
  return '#'+('0'+r.toString(16)).slice(-2)+('0'+g.toString(16)).slice(-2)+('0'+b.toString(16)).slice(-2);
}
function getBrushTip(color,size,hardness,brush){
  if(brush==='eraser'||brush==='spray'||brush==='calligraphy'||brush==='pencil'||brush==='crayon'||brush==='rainbow'||brush==='splatter'||brush==='neon'||brush==='pixel'||brush==='mirror'||brush==='kaleidoscope'||brush==='sponge'||brush==='glitch'||brush==='invert'||brush==='charcoal'||brush==='screen'||brush==='fill-op'||brush==='text'||brush&&brush.indexOf('shape-')===0)return null;
  var key=color+'-'+size+'-'+hardness.toFixed(2)+'-'+brush;
  if(brushTipCache&&brushTipCacheKey===key)return brushTipCache;
  var s=Math.ceil(size*2)+4,c=document.createElement('canvas');c.width=s;c.height=s;
  var cx=c.getContext('2d'),outerR=s/2,innerR=outerR*(1-hardness);
  var grad=cx.createRadialGradient(s/2,s/2,innerR,s/2,s/2,outerR);
  grad.addColorStop(0,color);grad.addColorStop(1,'rgba(0,0,0,0)');
  cx.fillStyle=grad;cx.beginPath();cx.arc(s/2,s/2,outerR,0,Math.PI*2);cx.fill();
  brushTipCache=c;brushTipCacheKey=key;return c;
}
function stampBrushTip(ctx,x,y,size,tip){if(!tip)return;var s=tip.width;ctx.drawImage(tip,x-s/2,y-s/2,s,s);}

// v8.8: 重置单人模式状态
function resetSoloState(){
  soloLayers=[{name:'图层1',strokes:[],undoStack:[],visible:true}];
  soloDrawOrder=[{type:'layer',idx:0}];soloActiveDrawIdx=0;
  soloStrokes=soloLayers[0].strokes;soloUndoStack=soloLayers[0].undoStack;
  soloCamX=0;soloCamY=0;soloCamZoom=1;
  soloImmersed=false;soloToolbarCollapsed=false;
  soloIsPanMode=false;soloPigmentMode=false;activeTool=null;toolStartPoint=null;toolDragging=false;toolPreviewPoint=null;
  soloImages=[];selectedImageId=null;soloImageIdCounter=0;
  rainbowHue=Math.random()*360;
  soloScreen.classList.remove('immersed-full');
  var t=dq('#solo-top-bar');if(t)t.classList.remove('immersed');
  var tb=dq('#solo-toolbar');if(tb){tb.classList.remove('immersed');tb.classList.remove('collapsed');}
  var eb=dq('#solo-exit-immerse');if(eb)eb.classList.add('hidden');
  var bt=dq('#solo-toggle-toolbar');
  if(bt){bt.textContent='▼';
    // 如果切换按钮还在工具栏内部，移回原位
    if(bt.parentNode===tb&&tb){tb.parentNode.insertBefore(bt,tb);}
  }
  soloPanBtn.classList.remove('active');
  var spb=dq('#solo-pigment-btn');if(spb)spb.classList.remove('active');
  soloCanvas.style.cursor='crosshair';
  dq('#solo-brushes').querySelectorAll('.solo-brush-btn').forEach(function(b){b.classList.remove('active');});
  var firstBrush=dq('#solo-brushes').querySelector('.solo-brush-btn');
  if(firstBrush){firstBrush.classList.add('active');soloBrush=firstBrush.dataset.brush;}
  dq('.solo-tools-row').querySelectorAll('.solo-tool-btn').forEach(function(b){b.classList.remove('active');});
  updateStatusBar();
}

// v8.9: 屏幕切换与工具栏控制
soloModeBtn.addEventListener('click',function(){
  lobbyScreen.classList.remove('active');
  soloScreen.classList.add('active');
  resetSoloState();
  initSoloCanvas();
  updateLayerUI();
  updateStatusBar();
});
soloBackBtn.addEventListener('click',function(){
  soloScreen.classList.remove('active');
  lobbyScreen.classList.add('active');
  // 如果正在等待/游戏中则不显示lobby
  if(gameStatus==='waiting'||gameStatus==='word-select'||gameStatus==='drawing'||gameStatus==='reveal'){
    gameScreen.classList.add('active');
    lobbyScreen.classList.remove('active');
  }
});
// 沉浸模式
var soloImmerseBtn=dq('#solo-immerse-btn');
var soloExitImmerse=dq('#solo-exit-immerse');
if(soloImmerseBtn)soloImmerseBtn.addEventListener('click',function(){
  soloImmersed=true;
  var t=dq('#solo-top-bar');if(t)t.classList.add('immersed');
  var tb=dq('#solo-toolbar');
  if(tb){
    tb.classList.add('immersed');tb.classList.remove('collapsed');
    // 切换按钮移入工具栏内部（吸附在顶部）
    var toggle=dq('#solo-toggle-toolbar');
    if(toggle&&toggle.parentNode!==tb){tb.insertBefore(toggle,tb.firstChild);}
  }
  soloScreen.classList.add('immersed-full');
  if(soloExitImmerse)soloExitImmerse.classList.remove('hidden');
  setTimeout(function(){initSoloCanvas();},100);
  showToast('🔲 沉浸模式 — 画布已全屏，底部 ▼ 可唤出工具栏');
});
if(soloExitImmerse)soloExitImmerse.addEventListener('click',function(){
  soloImmersed=false;
  var t=dq('#solo-top-bar');if(t)t.classList.remove('immersed');
  var tb=dq('#solo-toolbar');
  if(tb){
    tb.classList.remove('immersed');tb.classList.remove('collapsed');
    // 切换按钮移回原位（canvas和toolbar之间）
    var toggle=dq('#solo-toggle-toolbar');
    if(toggle&&toggle.parentNode===tb){tb.parentNode.insertBefore(toggle,tb);}
  }
  soloScreen.classList.remove('immersed-full');
  soloExitImmerse.classList.add('hidden');
  setTimeout(function(){initSoloCanvas();},100);
});
// 工具栏折叠
var soloToggleToolbar=dq('#solo-toggle-toolbar');
if(soloToggleToolbar)soloToggleToolbar.addEventListener('click',function(e){
  e.stopPropagation();
  soloToolbarCollapsed=!soloToolbarCollapsed;
  var tb=dq('#solo-toolbar');
  if(tb){
    if(soloToolbarCollapsed){
      if(soloImmersed){tb.classList.add('immersed');}
      else{tb.classList.add('collapsed');}
      soloToggleToolbar.textContent='▼';
    }else{
      tb.classList.remove('collapsed');
      tb.classList.remove('immersed');
      soloToggleToolbar.textContent='▲';
    }
  }
});



function initSoloCanvas(){
  var wrap=dq('#solo-canvas-wrap'),w=wrap.clientWidth,h=wrap.clientHeight;
  // 兜底：如果容器尺寸还没就绪，用视口尺寸
  if(!w||!h){w=window.innerWidth;h=window.innerHeight-150;}
  var dpr=window.devicePixelRatio||1;
  soloCanvas.style.width=w+'px';soloCanvas.style.height=h+'px';
  soloCanvas.width=w*dpr;soloCanvas.height=h*dpr;
  soloCachedRect=null;
  soloCtx.setTransform(dpr,0,0,dpr,0,0);
  soloCtx.clearRect(0,0,w,h);
  soloCtx.fillStyle='#F8F8F8';
  soloCtx.fillRect(0,0,w,h);
  doRedrawAllStrokes();
}
function renderStroke(stroke){
  var ctx=soloCtx,pts=stroke.points;if(pts.length<2)return;
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=stroke.opacity;
  var hardness=stroke.hardness!==undefined?stroke.hardness:0.5;
  // v8.10: 颜料混合模式 — 提亮颜色后再multiply
  var dc=stroke.color;
  if(stroke.blendMode==='pigment'){
    ctx.globalCompositeOperation='multiply';
    if(stroke.color!=='#FFFFFF'&&stroke.color!=='#ffffff'){dc=pigmentBlendColor(stroke.color);}
  }
  else if(stroke.brush==='marker'||stroke.brush==='crayon'){ctx.globalCompositeOperation='multiply';}
  else{ctx.globalCompositeOperation='source-over';}

  if(stroke.brush==='eraser'){
    ctx.globalCompositeOperation='destination-out';ctx.lineWidth=stroke.size*2;ctx.strokeStyle='rgba(0,0,0,1)';
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  if(stroke.brush==='rainbow'){
    for(var i=1;i<pts.length;i++){
      var hue=(i*7+stroke._hueOffset||0)%360;
      ctx.strokeStyle='hsl('+hue+',100%,50%)';ctx.lineWidth=stroke.size;
      ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();
    }
    ctx.restore();return;
  }
  if(stroke.brush==='splatter'){
    var sd=stroke._seed||1;
    for(var i=0;i<pts.length;i+=2){
      var p=pts[i],n=Math.floor(stroke.size*1.5);
      for(var j=0;j<n;j++){
        var a=srand(sd+i*100+j)*Math.PI*2,d=srand(sd+i*100+j+50)*stroke.size*4;
        var rx=p.x+Math.cos(a)*d,ry=p.y+Math.sin(a)*d;
        ctx.globalAlpha=stroke.opacity*(0.2+srand(sd+i*100+j+100)*0.5);
        ctx.fillStyle=dc;ctx.beginPath();
        ctx.arc(rx,ry,0.8+srand(sd+i*100+j+200)*stroke.size*0.6,0,Math.PI*2);ctx.fill();
      }
    }
    ctx.restore();return;
  }
  if(stroke.brush==='neon'){
    ctx.shadowBlur=stroke.size*4;ctx.shadowColor=stroke.color;
    ctx.strokeStyle='#ffffff';ctx.lineWidth=stroke.size*0.4;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.shadowBlur=stroke.size*2;ctx.strokeStyle=dc;ctx.lineWidth=stroke.size;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  if(stroke.brush==='pixel'){
    ctx.lineWidth=stroke.size;ctx.strokeStyle=dc;
    for(var i=1;i<pts.length;i++){
      var px=Math.round(pts[i].x/stroke.size)*stroke.size,py=Math.round(pts[i].y/stroke.size)*stroke.size;
      var lpx=Math.round(pts[i-1].x/stroke.size)*stroke.size,lpy=Math.round(pts[i-1].y/stroke.size)*stroke.size;
      ctx.fillStyle=dc;ctx.globalAlpha=stroke.opacity;
      ctx.fillRect(px-stroke.size/2,py-stroke.size/2,stroke.size,stroke.size);
      ctx.fillRect(lpx-stroke.size/2,lpy-stroke.size/2,stroke.size,stroke.size);
    }
    ctx.restore();return;
  }

  if(stroke.brush==='glow'){ctx.shadowBlur=stroke.size*2;ctx.shadowColor=stroke.color;}
  var tip=(stroke.brush==='pen'||stroke.brush==='marker'||stroke.brush==='glow')?getBrushTip(stroke.color,stroke.size,hardness,stroke.brush):null;

  if(stroke.brush==='spray'){
    var sd=stroke._seed||1;for(var i=0;i<pts.length;i++){var p=pts[i],n=Math.floor(stroke.size*3);for(var j=0;j<n;j++){var a=srand(sd+i*100+j)*Math.PI*2,d=srand(sd+i*100+j+50)*stroke.size*2;ctx.globalAlpha=stroke.opacity*(0.08+srand(sd+i*100+j+100)*0.25);ctx.fillStyle=dc;ctx.beginPath();ctx.arc(p.x+Math.cos(a)*d,p.y+Math.sin(a)*d,0.6+srand(sd+i*100+j+200)*stroke.size*0.18,0,Math.PI*2);ctx.fill();}}ctx.restore();return;}
  if(stroke.brush==='water'){for(var l=0;l<3;l++){ctx.globalAlpha=stroke.opacity*0.12;ctx.lineWidth=stroke.size+l*stroke.size*0.8;ctx.strokeStyle=dc;for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}}ctx.restore();return;}
  if(stroke.brush==='pencil'){ctx.lineWidth=stroke.size*0.7;ctx.strokeStyle=dc;ctx.globalAlpha=stroke.opacity*0.85;var sd=stroke._seed||1;for(var i=1;i<pts.length;i++){var wb=stroke.size*0.15;ctx.beginPath();ctx.moveTo(pts[i-1].x+(srand(sd+i)-0.5)*wb,pts[i-1].y+(srand(sd+i+300)-0.5)*wb);ctx.lineTo(pts[i].x+(srand(sd+i+600)-0.5)*wb,pts[i].y+(srand(sd+i+900)-0.5)*wb);ctx.stroke();}ctx.restore();return;}
  if(stroke.brush==='crayon'){ctx.lineWidth=stroke.size*1.2;ctx.strokeStyle=dc;ctx.globalAlpha=stroke.opacity*0.7;var sd=stroke._seed||1;for(var p=0;p<2;p++)for(var i=1;i<pts.length;i++){var wb=stroke.size*0.3;ctx.beginPath();ctx.moveTo(pts[i-1].x+(srand(sd+i+p*1000)-0.5)*wb,pts[i-1].y+(srand(sd+i+p*1000+300)-0.5)*wb);ctx.lineTo(pts[i].x+(srand(sd+i+p*1000+600)-0.5)*wb,pts[i].y+(srand(sd+i+p*1000+900)-0.5)*wb);ctx.stroke();}ctx.restore();return;}
  if(stroke.brush==='calligraphy'){for(var i=1;i<pts.length;i++){var p0=pts[i-1],p1=pts[i],dx=p1.x-p0.x,dy=p1.y-p0.y,speed=Math.sqrt(dx*dx+dy*dy),w=stroke.size*(1+1/(1+speed*0.3)),h=stroke.size*(1/(1+speed*0.1));ctx.save();ctx.translate(p0.x,p0.y);ctx.rotate(Math.atan2(dy,dx));ctx.beginPath();ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);ctx.fillStyle=dc;ctx.fill();ctx.restore();}ctx.restore();return;}

  // --- 新画笔 v3.5 ---
  if(stroke.brush==='mirror'){
    var cw=parseFloat(soloCanvas.style.width),worldCX=(cw/2-soloCamX)/soloCamZoom;
    ctx.lineWidth=stroke.size;ctx.strokeStyle=dc;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    for(var i=1;i<pts.length;i++){var mx1=2*worldCX-pts[i-1].x,mx2=2*worldCX-pts[i].x;ctx.beginPath();ctx.moveTo(mx1,pts[i-1].y);ctx.lineTo(mx2,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  if(stroke.brush==='kaleidoscope'){
    var cw=parseFloat(soloCanvas.style.width),ch=parseFloat(soloCanvas.style.height);
    var wCX=(cw/2-soloCamX)/soloCamZoom,wCY=(ch/2-soloCamY)/soloCamZoom,N=6;
    ctx.lineWidth=stroke.size;ctx.strokeStyle=dc;
    for(var f=0;f<N;f++){
      var angle=f*2*Math.PI/N,cos=Math.cos(angle),sin=Math.sin(angle);
      for(var i=1;i<pts.length;i++){
        var dx1=pts[i-1].x-wCX,dy1=pts[i-1].y-wCY,rx1=wCX+dx1*cos-dy1*sin,ry1=wCY+dx1*sin+dy1*cos;
        var dx2=pts[i].x-wCX,dy2=pts[i].y-wCY,rx2=wCX+dx2*cos-dy2*sin,ry2=wCY+dx2*sin+dy2*cos;
        ctx.beginPath();ctx.moveTo(rx1,ry1);ctx.lineTo(rx2,ry2);ctx.stroke();
      }
    }
    ctx.restore();return;
  }
  if(stroke.brush==='sponge'){
    var sd=stroke._seed||1;
    for(var i=0;i<pts.length;i+=3){
      var p=pts[i],n=Math.floor(stroke.size*0.8);
      for(var j=0;j<n;j++){
        var a=srand(sd+i*100+j)*Math.PI*2,d=srand(sd+i*100+j+50)*stroke.size*3;
        ctx.globalAlpha=stroke.opacity*(0.15+srand(sd+i*100+j+100)*0.25);
        ctx.fillStyle=dc;ctx.beginPath();
        ctx.arc(p.x+Math.cos(a)*d,p.y+Math.sin(a)*d,srand(sd+i*100+j+200)*stroke.size*1.2+stroke.size*0.3,0,Math.PI*2);ctx.fill();
      }
    }
    ctx.restore();return;
  }
  if(stroke.brush==='glitch'){
    var shift=stroke.size*0.7;
    ctx.globalAlpha=0.45;ctx.strokeStyle='#ff0000';ctx.lineWidth=stroke.size;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x-shift,pts[i-1].y);ctx.lineTo(pts[i].x-shift,pts[i].y);ctx.stroke();}
    ctx.strokeStyle='#00ffff';ctx.lineWidth=stroke.size;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x+shift,pts[i-1].y);ctx.lineTo(pts[i].x+shift,pts[i].y);ctx.stroke();}
    ctx.globalAlpha=stroke.opacity;ctx.strokeStyle=dc;ctx.lineWidth=stroke.size*0.6;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  if(stroke.brush==='invert'){
    ctx.globalCompositeOperation='difference';ctx.strokeStyle='#ffffff';ctx.lineWidth=stroke.size;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  if(stroke.brush==='charcoal'){
    ctx.lineWidth=stroke.size;ctx.strokeStyle=dc;ctx.globalAlpha=stroke.opacity*0.85;
    var sd=stroke._seed||1;
    for(var i=1;i<pts.length;i++){var wb=stroke.size*0.3;ctx.beginPath();ctx.moveTo(pts[i-1].x+(srand(sd+i)-0.5)*wb,pts[i-1].y+(srand(sd+i+300)-0.5)*wb);ctx.lineTo(pts[i].x+(srand(sd+i+600)-0.5)*wb,pts[i].y+(srand(sd+i+900)-0.5)*wb);ctx.stroke();}
    for(var i=0;i<pts.length;i+=2){var p=pts[i],n=Math.floor(stroke.size*1.2);for(var j=0;j<n;j++){var a=srand(sd+i*100+j)*Math.PI*2,d=srand(sd+i*100+j+50)*stroke.size*2.5;ctx.globalAlpha=stroke.opacity*(0.1+srand(sd+i*100+j+100)*0.25);ctx.fillStyle='#000000';ctx.beginPath();ctx.arc(p.x+Math.cos(a)*d,p.y+Math.sin(a)*d,0.3+srand(sd+i*100+j+200)*2,0,Math.PI*2);ctx.fill();}}
    ctx.restore();return;
  }
  if(stroke.brush==='screen'){
    ctx.globalCompositeOperation='screen';ctx.lineWidth=stroke.size;ctx.strokeStyle=dc;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  if(stroke.brush==='shape-line'||stroke.brush==='shape-rect'||stroke.brush==='shape-circle'||stroke.brush==='shape-triangle'){
    var sd=stroke.shapeData||{x1:pts[0]?pts[0].x:0,y1:pts[0]?pts[0].y:0,x2:pts[1]?pts[1].x:0,y2:pts[1]?pts[1].y:0};
    ctx.lineWidth=stroke.size;ctx.strokeStyle=dc;ctx.globalAlpha=stroke.opacity;ctx.lineCap='round';ctx.lineJoin='round';
    if(stroke.brush==='shape-line'){ctx.beginPath();ctx.moveTo(sd.x1,sd.y1);ctx.lineTo(sd.x2,sd.y2);ctx.stroke();}
    else if(stroke.brush==='shape-rect'){ctx.strokeRect(sd.x1,sd.y1,sd.x2-sd.x1,sd.y2-sd.y1);}
    else if(stroke.brush==='shape-circle'){var rx=(sd.x2-sd.x1)/2,ry=(sd.y2-sd.y1)/2;ctx.beginPath();ctx.ellipse(sd.x1+rx,sd.y1+ry,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2);ctx.stroke();}
    else if(stroke.brush==='shape-triangle'){var mx=(sd.x1+sd.x2)/2;ctx.beginPath();ctx.moveTo(mx,sd.y1);ctx.lineTo(sd.x2,sd.y2);ctx.lineTo(sd.x1,sd.y2);ctx.closePath();ctx.stroke();}
    ctx.restore();return;
  }
  // fill-op 和 text 在 doRedrawAllStrokes 中单独处理，此处跳过
  // v8.8: 导入的图片（已改为独立对象系统）
  if(stroke.brush==='image'&&stroke._img){
    ctx.globalAlpha=stroke.opacity||1;
    ctx.drawImage(stroke._img,stroke.imgX,stroke.imgY,stroke.imgW,stroke.imgH);
    ctx.restore();return;
  }
  ctx.lineWidth=stroke.size;ctx.strokeStyle=dc;
  if(tip){for(var i=0;i<pts.length;i++)stampBrushTip(ctx,pts[i].x,pts[i].y,stroke.size,tip);for(var i=1;i<pts.length;i++){var dx=pts[i].x-pts[i-1].x,dy=pts[i].y-pts[i-1].y,dist=Math.sqrt(dx*dx+dy*dy);for(var s=1;s<Math.ceil(dist/(stroke.size*0.3));s++){var t=s/Math.ceil(dist/(stroke.size*0.3));stampBrushTip(ctx,pts[i-1].x+dx*t,pts[i-1].y+dy*t,stroke.size,tip);}}}
  else{for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}}
  ctx.restore();
}

function getSoloPos(e){if(!soloCachedRect)soloCachedRect=soloCanvas.getBoundingClientRect();var rect=soloCachedRect;var t=null;if(e.touches&&e.touches.length>0)t=e.touches[0];else if(e.changedTouches&&e.changedTouches.length>0)t=e.changedTouches[0];var cx=t?t.clientX:e.clientX,cy=t?t.clientY:e.clientY,sx=cx-rect.left,sy=cy-rect.top;return{x:(sx-soloCamX)/soloCamZoom,y:(sy-soloCamY)/soloCamZoom,rawX:sx,rawY:sy};}
function getTwoFingerMid(e){if(!soloCachedRect)soloCachedRect=soloCanvas.getBoundingClientRect();var r=soloCachedRect,x1=e.touches[0].clientX-r.left,y1=e.touches[0].clientY-r.top,x2=e.touches[1].clientX-r.left,y2=e.touches[1].clientY-r.top;return{x:(x1+x2)/2,y:(y1+y2)/2,dist:Math.hypot(x2-x1,y2-y1)};}

function soloStart(e){
  if(soloTwoFinger||soloPinching)return;
  soloCachedRect=null;
  if(soloIsPanMode){soloPanning=true;var p=getSoloPos(e);soloLastPanX=p.rawX;soloLastPanY=p.rawY;return;}
  // v8.8: 选择工具
  if(activeTool==='select'){
    e.preventDefault();
    var sp=getSoloPos(e),wx=sp.x,wy=sp.y;
    // 先检测是否有选中图片的手柄被点击
    if(selectedImageId!==null){
      var sim=getImageById(selectedImageId);
      var handle=hitTestImageHandle(wx,wy,sim);
      if(handle){
        if(handle==='rot'){/* 旋转略 */return;}
        imageResizing=true;imageResizeHandle=handle;
        imageResizeStartWorld={x:wx,y:wy};
        imageDragOrigRect={x:sim.x,y:sim.y,w:sim.w,h:sim.h};
        return;
      }
    }
    // 检测是否点击了图片
    var hitId=hitTestImage(wx,wy);
    if(hitId!==null){
      selectedImageId=hitId;
      var him=getImageById(hitId);
      imageDragging=true;imageDragStartWorld={x:wx,y:wy};
      imageDragOrigRect={x:him.x,y:him.y,w:him.w,h:him.h};
      doRedrawAllStrokes();return;
    }
    // 点击空白，取消选中
    selectedImageId=null;doRedrawAllStrokes();return;
  }
  // v8.0: 工具处理（使用 activeTool 状态机）
  if(activeTool==='fill'){e.preventDefault();var fp=getSoloPos(e);toolFillAction(fp.x,fp.y);return;}
  if(activeTool==='eyedropper'){e.preventDefault();var pp=getSoloPos(e);toolPickAction(pp.x,pp.y);return;}
  if(activeTool==='text'){e.preventDefault();var tp=getSoloPos(e);toolTextAction(tp.x,tp.y);return;}
  if(activeTool==='line'||activeTool==='rect'||activeTool==='circle'||activeTool==='triangle'){
    e.preventDefault();soloPanning=false;
    toolStartPoint=getSoloPos(e);toolDragging=true;toolPreviewPoint=toolStartPoint;
    return;
  }
  // 画笔模式
  e.preventDefault();soloDrawing=true;soloLastPos=getSoloPos(e);soloPoints=[soloLastPos];
}
function soloMove(e){
  if(soloPinching)return soloPinchMove(e);
  // v8.8: 图片拖动/缩放
  if(imageDragging&&selectedImageId!==null){
    e.preventDefault();
    var imp=getSoloPos(e),im=getImageById(selectedImageId);
    if(!im)return;
    var dx=imp.x-imageDragStartWorld.x,dy=imp.y-imageDragStartWorld.y;
    im.x=imageDragOrigRect.x+dx;im.y=imageDragOrigRect.y+dy;
    doRedrawAllStrokes();return;
  }
  if(imageResizing&&selectedImageId!==null){
    e.preventDefault();
    var rp=getSoloPos(e),rim=getImageById(selectedImageId);
    if(!rim)return;
    var rdx=rp.x-imageResizeStartWorld.x,rdy=rp.y-imageResizeStartWorld.y;
    var ox=imageDragOrigRect.x,oy=imageDragOrigRect.y,ow=imageDragOrigRect.w,oh=imageDragOrigRect.h;
    var aspect=ow/oh;
    if(imageResizeHandle==='br'){rim.w=Math.max(10,ow+rdx);rim.h=Math.max(10,oh+rdy);}
    else if(imageResizeHandle==='tl'){rim.w=Math.max(10,ow-rdx);rim.h=Math.max(10,oh-rdy);rim.x=ox+ow-rim.w;rim.y=oy+oh-rim.h;}
    else if(imageResizeHandle==='tr'){rim.w=Math.max(10,ow+rdx);rim.h=Math.max(10,oh-rdy);rim.y=oy+oh-rim.h;}
    else if(imageResizeHandle==='bl'){rim.w=Math.max(10,ow-rdx);rim.h=Math.max(10,oh+rdy);rim.x=ox+ow-rim.w;}
    // 等比缩放（Shift）
    if(e.shiftKey){var s=Math.max(rim.w/ow,rim.h/oh);rim.w=ow*s;rim.h=oh*s;if(imageResizeHandle.indexOf('l')>=0)rim.x=ox+ow-rim.w;if(imageResizeHandle.indexOf('t')>=0)rim.y=oy+oh-rim.h;}
    doRedrawAllStrokes();return;
  }
  if(soloPanning){e.preventDefault();var p=getSoloPos(e);soloCamX+=p.rawX-soloLastPanX;soloCamY+=p.rawY-soloLastPanY;soloLastPanX=p.rawX;soloLastPanY=p.rawY;scheduleRedraw();return;}
  // v8.0: 形状拖拽预览（rAF 节流）
  if(toolDragging&&toolStartPoint){
    e.preventDefault();
    toolPreviewPoint=getSoloPos(e);
    scheduleRedraw(); // 走 rAF 节流，预览足够流畅
    return;
  }
  if(!soloDrawing)return;e.preventDefault();var pt=getSoloPos(e);
  if(Math.abs(pt.x-soloLastPos.x)<0.5&&Math.abs(pt.y-soloLastPos.y)<0.5)return;
  soloPoints.push(pt);
  soloCtx.setTransform(1,0,0,1,0,0);soloCtx.scale(window.devicePixelRatio||1,window.devicePixelRatio||1);
  soloCtx.translate(soloCamX,soloCamY);soloCtx.scale(soloCamZoom,soloCamZoom);
  drawLiveSegment(soloLastPos,pt);soloLastPos=pt;
}
function soloEnd(e){
  if(e&&e.touches){soloTwoFinger=e.touches.length>=2;if(e.touches.length===0)soloPinching=false;}
  if(soloPinching){soloPinching=false;setTimeout(function(){soloZoomHint.classList.add('hidden');},1500);return;}
  // v8.8: 图片操作结束
  if(imageDragging){imageDragging=false;imageDragStartWorld=null;imageDragOrigRect=null;return;}
  if(imageResizing){imageResizing=false;imageResizeHandle=null;imageResizeStartWorld=null;imageDragOrigRect=null;return;}
  // v8.0: 形状工具完成
  if(toolDragging&&toolStartPoint&&toolPreviewPoint){
    e.preventDefault();
    var pt=toolPreviewPoint;
    // 最小拖拽距离检测（避免误触）
    var dx=pt.x-toolStartPoint.x,dy=pt.y-toolStartPoint.y;
    if(Math.abs(dx)<3&&Math.abs(dy)<3){toolDragging=false;toolStartPoint=null;toolPreviewPoint=null;scheduleRedraw();return;}
    finalizeToolShape(toolStartPoint,pt,activeTool);
    var sd={x1:toolStartPoint.x,y1:toolStartPoint.y,x2:pt.x,y2:pt.y};
    soloUndoStack.length=0;
    soloStrokes.push({brush:'shape-'+activeTool,color:soloColor,size:soloSize,opacity:soloOpacity,shapeData:sd,points:[toolStartPoint,pt],_seed:Math.floor(Math.random()*100000),blendMode:soloPigmentMode?'pigment':'normal'});
    updateUndoRedoBtns();
    toolDragging=false;toolStartPoint=null;toolPreviewPoint=null;
    return;
  }
  if(soloPanning){soloPanning=false;return;}
  if(!soloDrawing)return;e.preventDefault();soloDrawing=false;
  if(soloPoints.length>=1){
    var pts=soloPoints.length>1?soloPoints.slice():[soloPoints[0],Object.assign({},soloPoints[0])];
    soloUndoStack.length=0;
    soloStrokes.push({brush:soloBrush,color:soloColor,size:soloSize,opacity:soloOpacity,hardness:soloHardness,points:pts,_hueOffset:rainbowHue,_seed:Math.floor(Math.random()*100000),blendMode:soloPigmentMode?'pigment':'normal'});
    updateUndoRedoBtns();rainbowHue=(rainbowHue+37)%360;
  }
  soloPoints=[];
}
// v8.9: 取消当前所有操作（鼠标离开画布/触摸取消时）
function cancelSoloOperation(){
  if(soloDrawing){soloDrawing=false;soloPoints=[];}
  if(toolDragging){toolDragging=false;toolStartPoint=null;toolPreviewPoint=null;}
  if(imageDragging){imageDragging=false;imageDragStartWorld=null;imageDragOrigRect=null;}
  if(imageResizing){imageResizing=false;imageResizeHandle=null;imageResizeStartWorld=null;imageDragOrigRect=null;}
  if(soloPanning)soloPanning=false;
  scheduleRedraw();
}

function drawLiveSegment(from,to){
  var ctx=soloCtx;ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=soloOpacity;
  // v8.10: 颜料混合模式 — 提亮颜色后再multiply，防止过暗
  var dc=soloColor; // 实际绘制色
  if(soloPigmentMode){
    ctx.globalCompositeOperation='multiply';
    if(soloColor!=='#FFFFFF'&&soloColor!=='#ffffff'){dc=pigmentBlendColor(soloColor);}
  }
  else if(soloBrush==='marker'||soloBrush==='crayon'){ctx.globalCompositeOperation='multiply';}
  else{ctx.globalCompositeOperation='source-over';}
  if(soloBrush==='eraser'){ctx.globalCompositeOperation='destination-out';ctx.lineWidth=soloSize*2;ctx.strokeStyle='rgba(0,0,0,1)';ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.restore();return;}
  if(soloBrush==='rainbow'){ctx.strokeStyle='hsl('+rainbowHue+',100%,50%)';ctx.lineWidth=soloSize;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();rainbowHue=(rainbowHue+3)%360;ctx.restore();return;}
  if(soloBrush==='splatter'){var n=Math.floor(soloSize*1.5);for(var j=0;j<n;j++){var a=Math.random()*Math.PI*2,d=Math.random()*soloSize*4;ctx.globalAlpha=soloOpacity*(0.2+Math.random()*0.5);ctx.fillStyle=dc;ctx.beginPath();ctx.arc(to.x+Math.cos(a)*d,to.y+Math.sin(a)*d,0.8+Math.random()*soloSize*0.6,0,Math.PI*2);ctx.fill();}ctx.restore();return;}
  if(soloBrush==='neon'){ctx.shadowBlur=soloSize*4;ctx.shadowColor=soloColor;ctx.strokeStyle='#ffffff';ctx.lineWidth=soloSize*0.4;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.shadowBlur=soloSize*2;ctx.strokeStyle=dc;ctx.lineWidth=soloSize;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.restore();return;}
  if(soloBrush==='pixel'){var px=Math.round(to.x/soloSize)*soloSize,py=Math.round(to.y/soloSize)*soloSize;ctx.fillStyle=dc;ctx.globalAlpha=soloOpacity;ctx.fillRect(px-soloSize/2,py-soloSize/2,soloSize,soloSize);var fpx=Math.round(from.x/soloSize)*soloSize,fpy=Math.round(from.y/soloSize)*soloSize;ctx.fillRect(fpx-soloSize/2,fpy-soloSize/2,soloSize,soloSize);ctx.restore();return;}
  if(soloBrush==='glow'){ctx.shadowBlur=soloSize*2;ctx.shadowColor=soloColor;}
  if(soloBrush==='spray'){var n=Math.floor(soloSize*3);for(var j=0;j<n;j++){var a=Math.random()*Math.PI*2,d=Math.random()*soloSize*2;ctx.globalAlpha=soloOpacity*(0.08+Math.random()*0.25);ctx.fillStyle=dc;ctx.beginPath();ctx.arc(to.x+Math.cos(a)*d,to.y+Math.sin(a)*d,0.6+Math.random()*soloSize*0.18,0,Math.PI*2);ctx.fill();}ctx.restore();return;}
  if(soloBrush==='water'||soloBrush==='pencil'||soloBrush==='crayon'||soloBrush==='calligraphy'){ctx.lineWidth=soloSize;ctx.strokeStyle=dc;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.restore();return;}
  // --- 新画笔 v3.5 实时预览 ---
  if(soloBrush==='mirror'){
    var cw=parseFloat(soloCanvas.style.width),worldCX=(cw/2-soloCamX)/soloCamZoom;
    ctx.lineWidth=soloSize;ctx.strokeStyle=dc;
    ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
    var mx1=2*worldCX-from.x,mx2=2*worldCX-to.x;
    ctx.beginPath();ctx.moveTo(mx1,from.y);ctx.lineTo(mx2,to.y);ctx.stroke();
    ctx.restore();return;
  }
  if(soloBrush==='kaleidoscope'){
    var cw=parseFloat(soloCanvas.style.width),ch=parseFloat(soloCanvas.style.height);
    var wCX=(cw/2-soloCamX)/soloCamZoom,wCY=(ch/2-soloCamY)/soloCamZoom,N=6;
    ctx.lineWidth=soloSize;ctx.strokeStyle=dc;
    for(var f=0;f<N;f++){
      var angle=f*2*Math.PI/N,cos=Math.cos(angle),sin=Math.sin(angle);
      var dx1=from.x-wCX,dy1=from.y-wCY,rx1=wCX+dx1*cos-dy1*sin,ry1=wCY+dx1*sin+dy1*cos;
      var dx2=to.x-wCX,dy2=to.y-wCY,rx2=wCX+dx2*cos-dy2*sin,ry2=wCY+dx2*sin+dy2*cos;
      ctx.beginPath();ctx.moveTo(rx1,ry1);ctx.lineTo(rx2,ry2);ctx.stroke();
    }
    ctx.restore();return;
  }
  if(soloBrush==='sponge'){
    var n=Math.floor(soloSize*1.2);
    for(var j=0;j<n;j++){
      var a=Math.random()*Math.PI*2,d=Math.random()*soloSize*2.5;
      ctx.globalAlpha=soloOpacity*(0.2+Math.random()*0.25);
      ctx.fillStyle=dc;ctx.beginPath();
      ctx.arc(to.x+Math.cos(a)*d,to.y+Math.sin(a)*d,0.5+Math.random()*soloSize*1.2,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();return;
  }
  if(soloBrush==='glitch'){
    var shift=soloSize*0.7;
    ctx.globalAlpha=0.45;ctx.strokeStyle='#ff0000';ctx.lineWidth=soloSize;
    ctx.beginPath();ctx.moveTo(from.x-shift,from.y);ctx.lineTo(to.x-shift,to.y);ctx.stroke();
    ctx.strokeStyle='#00ffff';ctx.lineWidth=soloSize;
    ctx.beginPath();ctx.moveTo(from.x+shift,from.y);ctx.lineTo(to.x+shift,to.y);ctx.stroke();
    ctx.globalAlpha=soloOpacity;ctx.strokeStyle=dc;ctx.lineWidth=soloSize*0.6;
    ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
    ctx.restore();return;
  }
  if(soloBrush==='invert'){
    ctx.globalCompositeOperation='difference';ctx.strokeStyle='#ffffff';ctx.lineWidth=soloSize;
    ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
    ctx.restore();return;
  }
  if(soloBrush==='charcoal'){
    ctx.lineWidth=soloSize;ctx.strokeStyle=dc;ctx.globalAlpha=soloOpacity*0.85;
    var wb=soloSize*0.3;
    ctx.beginPath();
    ctx.moveTo(from.x+(Math.random()-0.5)*wb,from.y+(Math.random()-0.5)*wb);
    ctx.lineTo(to.x+(Math.random()-0.5)*wb,to.y+(Math.random()-0.5)*wb);
    ctx.stroke();
    for(var j=0;j<Math.floor(soloSize*1.2);j++){
      var a2=Math.random()*Math.PI*2,d2=Math.random()*soloSize*2.5;
      ctx.globalAlpha=soloOpacity*(0.1+Math.random()*0.25);
      ctx.fillStyle='#000000';ctx.beginPath();
      ctx.arc(to.x+Math.cos(a2)*d2,to.y+Math.sin(a2)*d2,0.3+Math.random()*2,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();return;
  }
  if(soloBrush==='screen'){
    ctx.globalCompositeOperation='screen';ctx.lineWidth=soloSize;ctx.strokeStyle=dc;
    ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
    ctx.restore();return;
  }
  var tip=(soloBrush==='pen'||soloBrush==='marker'||soloBrush==='glow')?getBrushTip(soloColor,soloSize,soloHardness,soloBrush):null;
  if(tip){stampBrushTip(ctx,to.x,to.y,soloSize,tip);var dx=to.x-from.x,dy=to.y-from.y,dist=Math.sqrt(dx*dx+dy*dy);for(var s=0;s<Math.ceil(dist/(soloSize*0.3));s++){var t=s/Math.ceil(dist/(soloSize*0.3));stampBrushTip(ctx,from.x+dx*t,from.y+dy*t,soloSize,tip);}}
  else{ctx.lineWidth=soloSize;ctx.strokeStyle=dc;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();}
  ctx.restore();
}
function soloPinchMove(e){var m=getTwoFingerMid(e),nz=soloPinchStartZoom*(m.dist/soloPinchStartDist);soloCamZoom=Math.max(0.01,Math.min(5,nz));var r=soloCamZoom/soloPinchStartZoom;soloCamX=m.x-(soloPinchMidX-soloCamX)*r;soloCamY=m.y-(soloPinchMidY-soloCamY)*r;soloPinchMidX=m.x;soloPinchMidY=m.y;soloPinchStartZoom=soloCamZoom;soloPinchStartDist=m.dist;scheduleRedraw();updateZoomBadge();}

// events
soloCanvas.addEventListener('touchstart',function(e){soloCachedRect=null;if(e.touches.length===2){e.preventDefault();soloPinching=true;soloTwoFinger=true;soloDrawing=false;toolDragging=false;toolStartPoint=null;toolPreviewPoint=null;var m=getTwoFingerMid(e);soloPinchStartDist=m.dist;soloPinchStartZoom=soloCamZoom;soloPinchMidX=m.x;soloPinchMidY=m.y;soloZoomHint.classList.remove('hidden');}else if(e.touches.length===1&&!soloPinching){soloTwoFinger=false;soloStart(e);}},{passive:false});
soloCanvas.addEventListener('touchmove',function(e){if(e.touches.length===2&&soloPinching){e.preventDefault();soloPinchMove(e);}else if(soloPanning)soloMove(e);else if(!soloPinching)soloMove(e);},{passive:false});
soloCanvas.addEventListener('touchend',soloEnd);
soloCanvas.addEventListener('mousedown',soloStart);soloCanvas.addEventListener('mousemove',soloMove);
soloCanvas.addEventListener('mouseup',soloEnd);soloCanvas.addEventListener('mouseleave',function(e){cancelSoloOperation();});
soloCanvas.addEventListener('touchcancel',function(e){cancelSoloOperation();soloPinching=false;soloTwoFinger=false;});
soloCanvas.addEventListener('wheel',function(e){e.preventDefault();soloCachedRect=null;var rect=soloCanvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top,nz=Math.max(0.01,Math.min(5,soloCamZoom*(e.deltaY<0?1.1:0.9)));soloCamX=mx-(mx-soloCamX)*(nz/soloCamZoom);soloCamY=my-(my-soloCamY)*(nz/soloCamZoom);soloCamZoom=nz;invalidateFillCaches();scheduleRedraw();updateZoomBadge();},{passive:false});
	// v8.8: Delete键删除选中图片
	document.addEventListener('keydown',function(e){if(e.key==='Delete'||e.key==='Backspace'){if(selectedImageId!==null&&activeTool==='select'&&document.activeElement===document.body){e.preventDefault();for(var i=0;i<soloImages.length;i++){if(soloImages[i].id===selectedImageId){soloImages.splice(i,1);break;}}selectedImageId=null;doRedrawAllStrokes();showToast('🗑 已删除贴图');}}});

function updateZoomBadge(){soloZoomBadge.textContent=Math.round(soloCamZoom*100)+'%';if(statusZoom)statusZoom.textContent='🔍 '+Math.round(soloCamZoom*100)+'%';}
// v8.8 提示系统
var TOOL_NAMES={select:'选择',line:'直线',rect:'矩形',circle:'圆形',triangle:'三角形',fill:'填充',eyedropper:'取色器',text:'文字'};
var TOOL_HINTS={select:'<kbd>点击</kbd> 选中贴图 · <kbd>拖动</kbd> 移动 · <kbd>Delete</kbd> 删除 · <kbd>Shift</kbd> 等比缩放',line:'<kbd>拖拽</kbd> 绘制直线 · <kbd>L</kbd>',rect:'<kbd>拖拽</kbd> 绘制矩形 · <kbd>R</kbd>',circle:'<kbd>拖拽</kbd> 绘制圆形 · <kbd>C</kbd>',triangle:'<kbd>拖拽</kbd> 绘制三角形 · <kbd>T</kbd>',fill:'<kbd>点击</kbd> 封闭区域填充 · <kbd>G</kbd>',eyedropper:'<kbd>点击</kbd> 画布取色 · <kbd>I</kbd>',text:'<kbd>点击</kbd> 输入文字 · <kbd>X</kbd>'};
var BRUSH_LABELS={pen:'钢笔',pencil:'铅笔',marker:'马克笔',spray:'喷枪',water:'水彩',crayon:'蜡笔',glow:'荧光笔',rainbow:'彩虹笔',splatter:'泼溅',neon:'霓虹',pixel:'像素',calligraphy:'书法',mirror:'镜像',kaleidoscope:'万花筒',sponge:'海绵',glitch:'故障',invert:'反相',charcoal:'炭笔',screen:'增亮',eraser:'橡皮'};
var COLOR_NAMES={'#000000':'黑色','#333333':'深灰','#666666':'灰色','#E74C3C':'红色','#E67E22':'橙色','#F1C40F':'黄色','#2ECC71':'绿色','#1ABC9C':'青色','#3498DB':'蓝色','#9B59B6':'紫色','#FF6B9D':'粉色','#FFFFFF':'白色','#8B4513':'棕色'};
function updateHintViewer(tool){if(!soloHintViewer)return;if(!tool){soloHintViewer.classList.remove('visible');return;}var h=TOOL_HINTS[tool]||'<kbd>拖动</kbd> 自由绘制';soloHintViewer.innerHTML=h;soloHintViewer.classList.add('visible');clearTimeout(hintTimeout);}
function showHintBriefly(tool){updateHintViewer(tool);if(!soloHintViewer)return;hintTimeout=setTimeout(function(){soloHintViewer.classList.remove('visible');},3000);}
function updateStatusBar(){if(!statusTool)return;var t=activeTool?('🔧 '+TOOL_NAMES[activeTool]):(soloIsPanMode?'✋ 抓取':'✏️ '+(BRUSH_LABELS[soloBrush]||soloBrush));statusTool.textContent=t;var cn=COLOR_NAMES[soloColor]||soloColor;statusColorName.textContent=cn;statusColor.style.color=soloColor;var ci3=soloDrawOrder[soloActiveDrawIdx];var ln=ci3?(ci3.type==='layer'?soloLayers[ci3.idx].name:(soloImages[ci3.idx]&&soloImages[ci3.idx].name||'贴图')):'?';statusLayer.textContent='📑 '+ln+' ('+(soloActiveDrawIdx+1)+'/'+soloDrawOrder.length+')';statusMode.textContent=soloPigmentMode?'🎨 颜料':'🖌 普通';statusZoom.textContent='🔍 '+Math.round(soloCamZoom*100)+'%';}

// brush selector
dq('#solo-brushes').addEventListener('click',function(e){var btn=e.target.closest('.solo-brush-btn');if(!btn)return;dq('#solo-brushes').querySelectorAll('.solo-brush-btn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');soloBrush=btn.dataset.brush;activeTool=null;toolStartPoint=null;toolDragging=false;toolPreviewPoint=null;doRedrawAllStrokes();dq('.solo-tools-row').querySelectorAll('.solo-tool-btn').forEach(function(b){b.classList.remove('active');});soloCanvas.style.cursor='crosshair';updateHintViewer(null);updateStatusBar();showToast('✏️ '+(BRUSH_LABELS[soloBrush]||soloBrush)+'画笔');});
// tool selector v8.0
var toolsRow=dq('.solo-tools-row');if(toolsRow)toolsRow.addEventListener('click',function(e){var btn=e.target.closest('.solo-tool-btn');if(!btn)return;toolsRow.querySelectorAll('.solo-tool-btn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');activeTool=btn.dataset.tool;toolStartPoint=null;toolDragging=false;toolPreviewPoint=null;soloPanning=false;doRedrawAllStrokes();dq('#solo-brushes').querySelectorAll('.solo-brush-btn').forEach(function(b){b.classList.remove('active');});soloCanvas.style.cursor=activeTool==='select'?'default':activeTool==='fill'||activeTool==='eyedropper'||activeTool==='text'?'cell':'crosshair';if(soloIsPanMode){soloIsPanMode=false;soloPanBtn.classList.remove('active');}});showHintBriefly(activeTool);updateStatusBar();
soloPanBtn.addEventListener('click',function(){soloIsPanMode=!soloIsPanMode;soloPanBtn.classList.toggle('active',soloIsPanMode);soloCanvas.style.cursor=soloIsPanMode?'grab':'crosshair';updateHintViewer(null);updateStatusBar();});
// v8.8 颜料混合模式切换
var soloPigmentBtn=dq('#solo-pigment-btn');
if(soloPigmentBtn)soloPigmentBtn.addEventListener('click',function(){
  soloPigmentMode=!soloPigmentMode;
  soloPigmentBtn.classList.toggle('active',soloPigmentMode);
  updateStatusBar();showToast(soloPigmentMode?'🎨 颜料模式：颜色叠加会混合出新颜色（黄+青=绿，青+品红=蓝）':'🖌 普通模式：颜色直接覆盖叠加');
});
soloSizeSlider.addEventListener('input',function(){soloSize=+soloSizeSlider.value;soloSizeVal.textContent=soloSize;});
soloOpacitySlider.addEventListener('input',function(){soloOpacity=+soloOpacitySlider.value/100;soloOpacityVal.textContent=soloOpacitySlider.value;});
soloSmoothSlider.addEventListener('input',function(){soloHardness=1-+soloSmoothSlider.value/100;soloSmoothVal.textContent=soloSmoothSlider.value;brushTipCache=null;});
dq('#solo-colors-wrap').addEventListener('click',function(e){var btn=e.target.closest('.solo-color-btn');if(!btn)return;document.querySelectorAll('.solo-color-btn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');soloColor=btn.dataset.color;soloCustomColor.value=soloColor;brushTipCache=null;updateStatusBar();showToast('🎨 颜色：'+(COLOR_NAMES[soloColor]||soloColor));});
soloCustomColor.addEventListener('input',function(){soloColor=soloCustomColor.value;document.querySelectorAll('.solo-color-btn').forEach(function(b){b.classList.remove('active');});brushTipCache=null;updateStatusBar();});
soloUndoBtn.addEventListener('click',function(){if(!soloStrokes.length)return;soloUndoStack.push(soloStrokes.pop());invalidateFillCaches();doRedrawAllStrokes();updateUndoRedoBtns();});
soloRedoBtn.addEventListener('click',function(){if(!soloUndoStack.length)return;soloStrokes.push(soloUndoStack.pop());invalidateFillCaches();doRedrawAllStrokes();updateUndoRedoBtns();});
soloClearBtn.addEventListener('click',function(){if(!soloStrokes.length)return;showConfirm('确定清空当前图层吗？',function(){soloStrokes.length=0;soloUndoStack.length=0;doRedrawAllStrokes();updateUndoRedoBtns();});});
soloSaveBtn.addEventListener('click',function(){var a=document.createElement('a');a.download='画作_'+new Date().toISOString().slice(0,10)+'.png';a.href=soloCanvas.toDataURL('image/png');a.click();showToast('已保存');});
// v8.8 导入图片/贴纸（存为独立对象）
	var soloImportBtn=dq('#solo-import-btn'),soloImportFile=dq('#solo-import-file');
	if(soloImportBtn&&soloImportFile){
	  soloImportBtn.addEventListener('click',function(){soloImportFile.click();});
	  soloImportFile.addEventListener('change',function(e){
	    var file=e.target.files[0];
	    if(!file)return;
	    var reader=new FileReader();
	    reader.onload=function(ev){
	      var img=new Image();
	      img.onload=function(){
	        var cw=parseFloat(soloCanvas.style.width),ch=parseFloat(soloCanvas.style.height);
	        var maxW=cw*0.6,maxH=ch*0.6;
	        var scale=Math.min(maxW/img.width,maxH/img.height,1);
	        var iw=img.width*scale,ih=img.height*scale;
	        var wx=(cw/2-soloCamX)/soloCamZoom-iw/2,wy=(ch/2-soloCamY)/soloCamZoom-ih/2;
	        soloImageIdCounter++;
	        var imgObj={id:'img_'+soloImageIdCounter,img:img,x:wx,y:wy,w:iw,h:ih,visible:true,locked:false,opacity:1};
	        soloImages.push(imgObj);
        soloDrawOrder.push({type:'image',idx:soloImages.length-1});
		soloActiveDrawIdx=soloDrawOrder.length-1;
	        selectedImageId=imgObj.id;
	        if(activeTool!=='select'){activeTool='select';
	          dq('.solo-tools-row').querySelectorAll('.solo-tool-btn').forEach(function(b){b.classList.remove('active');});
	          var selBtn=dq('.solo-tools-row').querySelector('[data-tool="select"]');
	          if(selBtn)selBtn.classList.add('active');
	          dq('#solo-brushes').querySelectorAll('.solo-brush-btn').forEach(function(b){b.classList.remove('active');});
	        }
	        doRedrawAllStrokes();updateStatusBar();
	        showToast('✅ 已导入贴图（'+Math.round(iw)+'x'+Math.round(ih)+'）— 使用🖱选择工具移动/缩放');
	      };
	      img.src=ev.target.result;
	    };
	    reader.readAsDataURL(file);
	    soloImportFile.value='';
	  });
}
function updateUndoRedoBtns(){soloUndoBtn.disabled=!soloStrokes.length;soloRedoBtn.disabled=!soloUndoStack.length;}

// ============ v8.3 图层管理 ============
function switchLayer(idx){
  // v8.8: 找到 drawOrder 中该图层的第一个位置并切换
  for(var i=0;i<soloDrawOrder.length;i++){
    if(soloDrawOrder[i].type==='layer'&&soloDrawOrder[i].idx===idx){switchToDrawItem(i);return;}
  }
}
function addLayer(){
  if(soloLayers.length>=5){showToast('最多5个图层');return;}
  var n=soloLayers.length+1;
  soloLayers.push({name:'图层'+n,strokes:[],undoStack:[],visible:true});
  var newIdx=soloLayers.length-1;
  soloDrawOrder.push({type:'layer',idx:newIdx});
  soloActiveDrawIdx=soloDrawOrder.length-1;
  soloStrokes=soloLayers[newIdx].strokes;
  soloUndoStack=soloLayers[newIdx].undoStack;
  doRedrawAllStrokes();updateUndoRedoBtns();updateLayerUI();updateStatusBar();
  showToast('✅ 已添加图层'+n);
}
function deleteLayer(idx){
  if(soloLayers.length<=1){showToast('至少保留1个图层');return;}
  // v8.8: 从 drawOrder 移除，修复索引
  for(var i=soloDrawOrder.length-1;i>=0;i--){
    if(soloDrawOrder[i].type==='layer'&&soloDrawOrder[i].idx===idx)soloDrawOrder.splice(i,1);
    else if(soloDrawOrder[i].type==='layer'&&soloDrawOrder[i].idx>idx)soloDrawOrder[i].idx--;
  }
  soloLayers.splice(idx,1);
  // 找最近图层
  for(var i=soloDrawOrder.length-1;i>=0;i--){
    if(soloDrawOrder[i].type==='layer'){soloActiveDrawIdx=i;break;}
  }
  if(soloActiveDrawIdx>=0&&soloActiveDrawIdx<soloDrawOrder.length){
    var ci=soloDrawOrder[soloActiveDrawIdx];
    if(ci&&ci.type==='layer'){soloStrokes=soloLayers[ci.idx].strokes;soloUndoStack=soloLayers[ci.idx].undoStack;}
  }
  doRedrawAllStrokes();updateUndoRedoBtns();updateLayerUI();updateStatusBar();
}
function toggleLayerVisibility(idx){
  soloLayers[idx].visible=!soloLayers[idx].visible;
  doRedrawAllStrokes();updateLayerUI();
}
// v8.8: 新增函数 — updateLayerUI 依赖这些
function toggleImageVisibility(imgIdx){
  soloImages[imgIdx].visible=!soloImages[imgIdx].visible;
  doRedrawAllStrokes();updateLayerUI();
}
function deleteImageItem(imgIdx){
  showConfirm('删除这张贴图？',function(){
  var imgId=soloImages[imgIdx].id;
  if(selectedImageId===imgId)selectedImageId=null;
  for(var i=soloDrawOrder.length-1;i>=0;i--){
    if(soloDrawOrder[i].type==='image'&&soloDrawOrder[i].idx===imgIdx)soloDrawOrder.splice(i,1);
    else if(soloDrawOrder[i].type==='image'&&soloDrawOrder[i].idx>imgIdx)soloDrawOrder[i].idx--;
  }
  soloImages.splice(imgIdx,1);
  if(soloActiveDrawIdx>=soloDrawOrder.length)soloActiveDrawIdx=soloDrawOrder.length-1;
  var ci=soloDrawOrder[soloActiveDrawIdx];
  if(ci&&ci.type==='layer'){soloStrokes=soloLayers[ci.idx].strokes;soloUndoStack=soloLayers[ci.idx].undoStack;}
  doRedrawAllStrokes();updateLayerUI();updateStatusBar();showToast('🗑 已删除贴图');
  });
}
function switchToDrawItem(drawIdx){
  if(drawIdx<0||drawIdx>=soloDrawOrder.length)return;
  var item=soloDrawOrder[drawIdx];
  if(item.type==='image'){
    selectedImageId=soloImages[item.idx].id;
    if(activeTool!=='select'){
      activeTool='select';
      dq('.solo-tools-row').querySelectorAll('.solo-tool-btn').forEach(function(b){b.classList.remove('active');});
      var sb=dq('.solo-tools-row').querySelector('[data-tool=\"select\"]');if(sb)sb.classList.add('active');
      dq('#solo-brushes').querySelectorAll('.solo-brush-btn').forEach(function(b){b.classList.remove('active');});
      soloCanvas.style.cursor='default';
    }
    soloActiveDrawIdx=drawIdx;doRedrawAllStrokes();updateLayerUI();updateStatusBar();return;
  }
  if(drawIdx===soloActiveDrawIdx)return;
  soloActiveDrawIdx=drawIdx;
  var layer=soloLayers[item.idx];
  soloStrokes=layer.strokes;soloUndoStack=layer.undoStack;
  if(activeTool==='select'){activeTool=null;soloCanvas.style.cursor='crosshair';}
  doRedrawAllStrokes();updateUndoRedoBtns();updateLayerUI();updateStatusBar();
}
function moveDrawOrderItem(fromDrawIdx,toDrawIdx){
  if(fromDrawIdx===toDrawIdx||fromDrawIdx<0||fromDrawIdx>=soloDrawOrder.length||toDrawIdx<0||toDrawIdx>=soloDrawOrder.length)return;
  var item=soloDrawOrder.splice(fromDrawIdx,1)[0];
  soloDrawOrder.splice(toDrawIdx,0,item);
  if(soloActiveDrawIdx===fromDrawIdx)soloActiveDrawIdx=toDrawIdx;
  else if(fromDrawIdx<soloActiveDrawIdx&&toDrawIdx>=soloActiveDrawIdx)soloActiveDrawIdx--;
  else if(fromDrawIdx>soloActiveDrawIdx&&toDrawIdx<=soloActiveDrawIdx)soloActiveDrawIdx++;
  if(soloActiveDrawIdx<0)soloActiveDrawIdx=0;
  if(soloActiveDrawIdx>=soloDrawOrder.length)soloActiveDrawIdx=soloDrawOrder.length-1;
  var ci=soloDrawOrder[soloActiveDrawIdx];
  if(ci&&ci.type==='layer'){soloStrokes=soloLayers[ci.idx].strokes;soloUndoStack=soloLayers[ci.idx].undoStack;}
  doRedrawAllStrokes();updateLayerUI();updateStatusBar();
}
// v8.8 图层排序
function moveLayer(fromIdx,toIdx){
  if(fromIdx===toIdx||fromIdx<0||fromIdx>=soloLayers.length||toIdx<0||toIdx>=soloLayers.length)return;
  var layer=soloLayers.splice(fromIdx,1)[0];
  soloLayers.splice(toIdx,0,layer);
  soloActiveLayer=toIdx;
  soloStrokes=soloLayers[soloActiveLayer].strokes;
  soloUndoStack=soloLayers[soloActiveLayer].undoStack;
  doRedrawAllStrokes();updateUndoRedoBtns();updateLayerUI();updateStatusBar();
}
function moveLayerUp(idx){moveLayer(idx,idx-1);}
function moveLayerDown(idx){moveLayer(idx,idx+1);}
function moveLayerToTop(idx){moveLayer(idx,soloLayers.length-1);}
function moveLayerToBottom(idx){moveLayer(idx,0);}
function mergeDown(){
  var ci=soloDrawOrder[soloActiveDrawIdx];
  if(!ci||ci.type!=='layer'){showToast('请先选中一个图层');return;}
  // v8.9: 在 drawOrder 中找到下方最近的图层
  var targetLayer=null;
  for(var i=soloActiveDrawIdx-1;i>=0;i--){
    if(soloDrawOrder[i].type==='layer'){targetLayer=soloLayers[soloDrawOrder[i].idx];break;}
  }
  if(!targetLayer){showToast('已在最底层，无法向下合并');return;}
  // 合并：当前图层笔画合并到目标图层
  var curLayer=soloLayers[ci.idx];
  targetLayer.strokes=targetLayer.strokes.concat(curLayer.strokes);
  // 删除当前图层，修复 drawOrder 引用
  var removedIdx=ci.idx;
  soloLayers.splice(removedIdx,1);
  for(var j=soloDrawOrder.length-1;j>=0;j--){
    if(soloDrawOrder[j].type==='layer'&&soloDrawOrder[j].idx===removedIdx)soloDrawOrder.splice(j,1);
    else if(soloDrawOrder[j].type==='layer'&&soloDrawOrder[j].idx>removedIdx)soloDrawOrder[j].idx--;
  }
  // 找到目标图层在 drawOrder 中的新位置并切换
  for(var k=0;k<soloDrawOrder.length;k++){
    if(soloDrawOrder[k].type==='layer'&&soloLayers[soloDrawOrder[k].idx]===targetLayer){soloActiveDrawIdx=k;break;}
  }
  soloStrokes=targetLayer.strokes;soloUndoStack=targetLayer.undoStack;
  doRedrawAllStrokes();updateUndoRedoBtns();updateLayerUI();updateStatusBar();
  showToast('✅ 已向下合并图层');
}
function renameLayer(idx){
  var name=prompt('图层名称：',soloLayers[idx].name);
  if(name&&name.trim()){soloLayers[idx].name=name.trim();updateLayerUI();updateStatusBar();}
}

// v8.10: 下拉式图层面板 - 垂直列表 + 指针拖拽
var layerDragInfo=null;
function updateLayerUI(){
  var panelLabel=dq("#layer-panel-label"),panelCount=dq("#layer-panel-count");
  var ci=soloDrawOrder[soloActiveDrawIdx];
  if(ci){
    if(ci.type==="layer"){var l=soloLayers[ci.idx];if(panelLabel)panelLabel.textContent="📑 "+l.name;}
    else{var im=soloImages[ci.idx];if(panelLabel)panelLabel.textContent="🖼 "+(im&&im.name||"贴图");}
  }
  if(panelCount)panelCount.textContent=(soloActiveDrawIdx+1)+"/"+soloDrawOrder.length;
  var list=dq("#layer-list");
  if(!list)return;
  list.innerHTML="";
  for(var di=0;di<soloDrawOrder.length;di++){
    var item=soloDrawOrder[di],isActive=(di===soloActiveDrawIdx);
    var entry=document.createElement("div");
    entry.className="layer-entry"+(isActive?" active":"");
    entry.dataset.drawIdx=di;
    var grip=document.createElement("span");
    grip.className="layer-entry-grip";grip.textContent="⋮⋮";
    var eye=document.createElement("span");
    eye.className="layer-entry-eye";
    var label=document.createElement("span");
    label.className="layer-entry-label";
    if(item.type==="layer"){
      var l=soloLayers[item.idx];
      eye.textContent=l.visible?"👁":"—";
      eye.style.opacity=l.visible?"0.7":"0.2";
      eye.title=l.visible?"点击隐藏":"点击显示";
      (function(idx){eye.addEventListener("click",function(e){e.stopPropagation();toggleLayerVisibility(idx);});})(item.idx);
      label.textContent="📄 "+l.name;
      label.title="双击改名";
      (function(di2){entry.addEventListener("click",function(e){if(e.target===eye||e.target.classList.contains("layer-entry-del"))return;switchToDrawItem(di2);updateLayerUI();});})(di);
      (function(idx){entry.addEventListener("dblclick",function(e){e.preventDefault();var nm=prompt("图层名称：",soloLayers[idx].name);if(nm&&nm.trim()){soloLayers[idx].name=nm.trim();updateLayerUI();updateStatusBar();}});})(item.idx);
    }else{
      var im=soloImages[item.idx];
      eye.textContent=im.visible?"👁":"—";
      eye.style.opacity=im.visible?"0.7":"0.2";
      eye.title=im.visible?"点击隐藏":"点击显示";
      (function(idx){eye.addEventListener("click",function(e){e.stopPropagation();toggleImageVisibility(idx);});})(item.idx);
      label.textContent="🖼 "+(im&&im.name||"贴图");
      label.title="双击改名";
      (function(di2){entry.addEventListener("click",function(e){if(e.target===eye||e.target.classList.contains("layer-entry-del"))return;switchToDrawItem(di2);updateLayerUI();});})(di);
      (function(idx){entry.addEventListener("dblclick",function(e){e.preventDefault();var nm=prompt("贴图名称：",soloImages[idx].name||"");if(nm&&nm.trim()){soloImages[idx].name=nm.trim();updateLayerUI();updateStatusBar();}});})(item.idx);
      var del=document.createElement("span");
      del.className="layer-entry-del";del.textContent="✕";del.title="删除贴图";
      (function(idx){del.addEventListener("click",function(e){e.stopPropagation();deleteImageItem(idx);});})(item.idx);
      entry.appendChild(del);
    }
    entry.appendChild(grip);entry.appendChild(eye);entry.appendChild(label);
    // 指针拖拽
    grip.addEventListener("pointerdown",function(e){
      e.preventDefault();e.stopPropagation();
      var fromIdx=parseInt(this.parentNode.dataset.drawIdx);
      var entryEl=this.parentNode;
      entryEl.classList.add("dragging");
      var allEntries=entryEl.parentNode.querySelectorAll(".layer-entry");
      var startY=e.clientY;
      function onMove(ev){
        ev.preventDefault();
        entryEl.style.transform="translateY("+(ev.clientY-startY)+"px)";
        allEntries.forEach(function(en){en.classList.remove("drag-over");if(en!==entryEl){var r=en.getBoundingClientRect();if(ev.clientY>r.top&&ev.clientY<r.bottom)en.classList.add("drag-over");}});
      }
      function onUp(ev){
        document.removeEventListener("pointermove",onMove);
        document.removeEventListener("pointerup",onUp);
        entryEl.classList.remove("dragging");entryEl.style.transform="";
        var toIdx=fromIdx;
        allEntries.forEach(function(en,idx){if(en.classList.contains("drag-over"))toIdx=idx;});
        allEntries.forEach(function(en){en.classList.remove("drag-over");});
        if(toIdx!==fromIdx)moveDrawOrderItem(fromIdx,toIdx);
      }
      document.addEventListener("pointermove",onMove);
      document.addEventListener("pointerup",onUp);
    });
    list.appendChild(entry);
  }
  var actions=dq("#layer-actions");
  if(actions){
    actions.innerHTML="";
    if(soloLayers.length<5){
      var addB=document.createElement("button");addB.textContent="+ 图层";addB.addEventListener("click",function(){addLayer();updateLayerUI();});actions.appendChild(addB);
    }
    if(soloDrawOrder.length>=2){
      var mergeB=document.createElement("button");mergeB.textContent="↓ 合并";mergeB.addEventListener("click",function(){showConfirm("合并到下一层？不可撤销",function(){mergeDown();});});actions.appendChild(mergeB);
    }
  }
}
// 图层面板下拉切换
var layerPanelBtn=dq("#layer-panel-btn"),layerPanelDropdown=dq("#layer-panel-dropdown");
if(layerPanelBtn&&layerPanelDropdown){
  layerPanelBtn.addEventListener("click",function(e){
    e.stopPropagation();
    layerPanelDropdown.classList.toggle("hidden");
    if(!layerPanelDropdown.classList.contains("hidden"))updateLayerUI();
  });
  document.addEventListener("click",function(e){
    if(!layerPanelBtn.contains(e.target)&&!layerPanelDropdown.contains(e.target)){
      layerPanelDropdown.classList.add("hidden");
    }
  });
}

