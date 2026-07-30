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
    const descs = { classic: '经典模式：轮流画词猜词，60秒', speed: '快速模式：30秒速画，只用简单词', blind: '盲画模式：画时看不到笔迹，揭晓笑翻全场' };
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
  socket.on('guess-result', ({ correct, score, hint }) => {
    if (correct) {
      guessInput.disabled = true;
      guessInput.placeholder = '✅ 猜对了！+' + score + '分';
      sendGuessBtn.disabled = true;
      setTimeout(() => { guessInput.disabled = false; guessInput.placeholder = '你已猜对'; sendGuessBtn.disabled = true; }, 1500);
      showToast('🎉 猜对了！+' + score + '分');
    } else if (hint) { showToast('💡 ' + hint); }
  });

  // --- 聊天 ---
  socket.on('chat-message', (msg) => { addChatMessage(msg.type, msg.message, msg.from); });

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

// ##########################################################
// #                  单人创作模式 (Solo Mode)                #
// ##########################################################

// DOM 引用
const soloScreen = $('#solo-screen');
const soloModeBtn = $('#solo-mode-btn');
const soloBackBtn = $('#solo-back-btn');
const soloCanvas = $('#solo-canvas');
const soloCtx = soloCanvas.getContext('2d');
const soloBrushInfo = $('#solo-brush-info');
const soloSizeSlider = $('#solo-size-slider');
const soloSizeVal = $('#solo-size-val');
const soloOpacitySlider = $('#solo-opacity-slider');
const soloOpacityVal = $('#solo-opacity-val');
const soloUndoBtn = $('#solo-undo-btn');
const soloRedoBtn = $('#solo-redo-btn');
const soloClearBtn = $('#solo-clear-btn');
const soloSaveBtn = $('#solo-save-btn');
const soloCustomColor = $('#solo-custom-color');

// 状态
let soloBrush = 'pen';
let soloColor = '#000000';
let soloSize = 3;
let soloOpacity = 1;
let soloDrawing = false;
let soloLastPoint = null;
let soloStrokes = [];        // [{ brush, color, size, opacity, points: [{x,y,speed}] }]
let soloUndoStack = [];
let soloPoints = [];         // 当前笔画点

// ============ Solo 初始化 ============
function initSoloCanvas() {
  const wrap = $('#solo-canvas-wrap');
  const maxW = wrap.clientWidth - 8;
  const maxH = wrap.clientHeight - 8;
  const w = Math.min(maxW, 800);
  const h = Math.min(maxH, 600);
  const dpr = window.devicePixelRatio || 1;
  soloCanvas.style.width = w + 'px';
  soloCanvas.style.height = h + 'px';
  soloCanvas.width = w * dpr;
  soloCanvas.height = h * dpr;
  soloCtx.setTransform(1, 0, 0, 1, 0, 0);
  soloCtx.scale(dpr, dpr);
  soloCtx.fillStyle = '#FFFFFF';
  soloCtx.fillRect(0, 0, w, h);
}

function redrawAllStrokes() {
  const w = parseFloat(soloCanvas.style.width);
  const h = parseFloat(soloCanvas.style.height);
  soloCtx.clearRect(0, 0, w, h);
  soloCtx.fillStyle = '#FFFFFF';
  soloCtx.fillRect(0, 0, w, h);
  for (const stroke of soloStrokes) {
    renderStroke(stroke);
  }
}

function renderStroke(stroke) {
  const ctx = soloCtx;
  const pts = stroke.points;
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (stroke.brush === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = stroke.size * 2;
    for (let i = 1; i < pts.length; i++) {
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  ctx.globalCompositeOperation = stroke.brush === 'marker' ? 'multiply' : 'source-over';
  ctx.strokeStyle = stroke.color;

  if (stroke.brush === 'spray') {
    for (const p of pts) {
      const particles = Math.floor(stroke.size * 2);
      for (let j = 0; j < particles; j++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * stroke.size * 2;
        const px = p.x + Math.cos(angle) * dist;
        const py = p.y + Math.sin(angle) * dist;
        ctx.fillStyle = stroke.color;
        ctx.globalAlpha = stroke.opacity * Math.random() * 0.3;
        ctx.beginPath();
        ctx.arc(px, py, 0.5 + Math.random(), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return;
  }

  // 绘制贝塞尔曲线
  ctx.lineWidth = stroke.size;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];

    if (stroke.brush === 'water') {
      // 水彩：多层半透明圆
      const layers = 3;
      for (let l = 0; l < layers; l++) {
        ctx.globalAlpha = stroke.opacity * 0.15;
        ctx.lineWidth = stroke.size + (l * stroke.size * 0.8);
        ctx.strokeStyle = stroke.color;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    } else if (stroke.brush === 'calligraphy') {
      // 书法：根据移动方向旋转椭圆，速度越快越细
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const speed = Math.sqrt(dx * dx + dy * dy);
      const w = stroke.size * (1 + 1 / (1 + speed * 0.3));
      const h = stroke.size * (1 / (1 + speed * 0.1));
      const angle = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(p0.x, p0.y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = stroke.color;
      ctx.fill();
      ctx.restore();
    } else {
      // 钢笔/马克笔：二次贝塞尔平滑
      if (i >= 2) {
        const pp = pts[i - 2];
        const cpX = (pp.x + p0.x) / 2;
        const cpY = (pp.y + p0.y) / 2;
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        ctx.beginPath();
        ctx.moveTo(cpX, cpY);
        ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// ============ Solo 事件处理 ============
function getSoloPos(e) {
  const rect = soloCanvas.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  const scaleX = parseFloat(soloCanvas.style.width) / rect.width;
  const scaleY = parseFloat(soloCanvas.style.height) / rect.height;
  return {
    x: (cx - rect.left) * scaleX,
    y: (cy - rect.top) * scaleY,
    time: Date.now(),
  };
}

function soloStart(e) {
  e.preventDefault();
  soloDrawing = true;
  const pt = getSoloPos(e);
  soloLastPoint = pt;
  soloPoints = [pt];
  // 点一个点
  soloCtx.fillStyle = soloColor;
  soloCtx.globalAlpha = soloOpacity;
  soloCtx.beginPath();
  soloCtx.arc(pt.x, pt.y, soloSize / 2, 0, Math.PI * 2);
  soloCtx.fill();
}

function soloMove(e) {
  if (!soloDrawing) return;
  e.preventDefault();
  const pt = getSoloPos(e);
  const dx = pt.x - soloLastPoint.x;
  const dy = pt.y - soloLastPoint.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // 最小采样距离
  if (dist < 2) return;

  pt.speed = dist / Math.max(1, pt.time - soloLastPoint.time);
  soloPoints.push(pt);

  // 实时渲染当前段
  const ctx = soloCtx;
  ctx.save();
  ctx.globalAlpha = soloOpacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (soloBrush === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = soloSize * 2;
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.beginPath();
    ctx.moveTo(soloLastPoint.x, soloLastPoint.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  } else if (soloBrush === 'spray') {
    const particles = Math.floor(soloSize * 2);
    for (let j = 0; j < particles; j++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * soloSize * 2;
      ctx.fillStyle = soloColor;
      ctx.globalAlpha = soloOpacity * Math.random() * 0.3;
      ctx.beginPath();
      ctx.arc(pt.x + Math.cos(angle) * dist, pt.y + Math.sin(angle) * dist, 0.5 + Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (soloBrush === 'water') {
    for (let l = 0; l < 3; l++) {
      ctx.globalAlpha = soloOpacity * 0.12;
      ctx.lineWidth = soloSize + (l * soloSize * 0.8);
      ctx.strokeStyle = soloColor;
      ctx.beginPath();
      ctx.moveTo(soloLastPoint.x, soloLastPoint.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }
  } else if (soloBrush === 'calligraphy') {
    const speed = dist / Math.max(1, pt.time - soloLastPoint.time);
    const w = soloSize * (1 + 1 / (1 + speed * 0.3));
    const h = soloSize * (1 / (1 + speed * 0.1));
    const angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(soloLastPoint.x, soloLastPoint.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = soloColor;
    ctx.fill();
    ctx.restore();
  } else {
    // 钢笔/马克笔：贝塞尔平滑
    ctx.lineWidth = soloSize;
    ctx.strokeStyle = soloColor;
    if (soloBrush === 'marker') ctx.globalCompositeOperation = 'multiply';
    ctx.beginPath();
    if (soloPoints.length >= 3) {
      const pp = soloPoints[soloPoints.length - 3];
      const cpX = (pp.x + soloLastPoint.x) / 2;
      const cpY = (pp.y + soloLastPoint.y) / 2;
      const midX = (soloLastPoint.x + pt.x) / 2;
      const midY = (soloLastPoint.y + pt.y) / 2;
      ctx.moveTo(cpX, cpY);
      ctx.quadraticCurveTo(soloLastPoint.x, soloLastPoint.y, midX, midY);
    } else {
      ctx.moveTo(soloLastPoint.x, soloLastPoint.y);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  }
  ctx.restore();
  soloLastPoint = pt;
}

function soloEnd(e) {
  if (!soloDrawing) return;
  e.preventDefault();
  soloDrawing = false;
  soloLastPoint = null;

  if (soloPoints.length > 1) {
    // 保存笔画到历史
    soloUndoStack = [];
    soloStrokes.push({
      brush: soloBrush,
      color: soloColor,
      size: soloSize,
      opacity: soloOpacity,
      points: [...soloPoints],
    });
    updateUndoRedoBtns();
  }
  soloPoints = [];
}

// ============ Solo UI 控制器 ============
$$('.solo-brush-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.solo-brush-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    soloBrush = btn.dataset.brush;
    updateSoloBrushInfo();
  });
});

soloSizeSlider.addEventListener('input', () => {
  soloSize = parseInt(soloSizeSlider.value);
  soloSizeVal.textContent = soloSize;
  updateSoloBrushInfo();
});

soloOpacitySlider.addEventListener('input', () => {
  soloOpacity = parseInt(soloOpacitySlider.value) / 100;
  soloOpacityVal.textContent = parseInt(soloOpacitySlider.value);
});

$$('.solo-color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.solo-color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    soloColor = btn.dataset.color;
    soloCustomColor.value = soloColor;
  });
});

soloCustomColor.addEventListener('input', () => {
  soloColor = soloCustomColor.value;
  $$('.solo-color-btn').forEach(b => b.classList.remove('active'));
});

soloUndoBtn.addEventListener('click', () => {
  if (soloStrokes.length === 0) return;
  soloUndoStack.push(soloStrokes.pop());
  redrawAllStrokes();
  updateUndoRedoBtns();
});

soloRedoBtn.addEventListener('click', () => {
  if (soloUndoStack.length === 0) return;
  soloStrokes.push(soloUndoStack.pop());
  redrawAllStrokes();
  updateUndoRedoBtns();
});

soloClearBtn.addEventListener('click', () => {
  if (soloStrokes.length === 0) return;
  if (confirm('确定清空画布吗？此操作不可恢复。')) {
    soloStrokes = [];
    soloUndoStack = [];
    initSoloCanvas();
    updateUndoRedoBtns();
  }
});

soloSaveBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = '我的画作_' + new Date().toISOString().slice(0, 10) + '.png';
  link.href = soloCanvas.toDataURL('image/png');
  link.click();
  showToast('💾 画作已保存！');
});

function updateUndoRedoBtns() {
  soloUndoBtn.disabled = soloStrokes.length === 0;
  soloRedoBtn.disabled = soloUndoStack.length === 0;
}

function updateSoloBrushInfo() {
  const names = { pen: '钢笔', marker: '马克笔', water: '水彩', spray: '喷枪', calligraphy: '书法', eraser: '橡皮' };
  soloBrushInfo.textContent = (names[soloBrush] || '钢笔') + ' · ' + soloSize + 'px';
}

// Canvas 事件
soloCanvas.addEventListener('touchstart', soloStart, { passive: false });
soloCanvas.addEventListener('touchmove', soloMove, { passive: false });
soloCanvas.addEventListener('touchend', soloEnd);
soloCanvas.addEventListener('mousedown', soloStart);
soloCanvas.addEventListener('mousemove', soloMove);
soloCanvas.addEventListener('mouseup', soloEnd);
soloCanvas.addEventListener('mouseleave', soloEnd);

// 进入/退出单人模式
soloModeBtn.addEventListener('click', () => {
  lobbyScreen.classList.remove('active');
  soloScreen.classList.add('active');
  initSoloCanvas();
  soloStrokes = [];
  soloUndoStack = [];
  updateUndoRedoBtns();
  updateSoloBrushInfo();
});

soloBackBtn.addEventListener('click', () => {
  soloScreen.classList.remove('active');
  lobbyScreen.classList.add('active');
});

// resize/orientationchange 已在前面注册，此处通过合并处理
const _origResize = window.onresize;
window.addEventListener('resize', () => { if (soloScreen.classList.contains('active')) initSoloCanvas(); });
window.addEventListener('orientationchange', () => { if (soloScreen.classList.contains('active')) setTimeout(initSoloCanvas, 300); });

console.log('🎨 你画我猜 v2 - 前端就绪');
