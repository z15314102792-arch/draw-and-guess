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

// 单人创作 v3 — 浅色主题/沉浸全屏/12种创意画笔
const soloScreen=$('#solo-screen'),soloModeBtn=$('#solo-mode-btn'),soloBackBtn=$('#solo-back-btn');
const soloCanvas=$('#solo-canvas'),soloCtx=soloCanvas.getContext('2d');
const soloSizeSlider=$('#solo-size-slider'),soloSizeVal=$('#solo-size-val');
const soloOpacitySlider=$('#solo-opacity-slider'),soloOpacityVal=$('#solo-opacity-val');
const soloSmoothSlider=$('#solo-smooth-slider'),soloSmoothVal=$('#solo-smooth-val');
const soloUndoBtn=$('#solo-undo-btn'),soloRedoBtn=$('#solo-redo-btn');
const soloClearBtn=$('#solo-clear-btn'),soloSaveBtn=$('#solo-save-btn');
const soloCustomColor=$('#solo-custom-color'),soloPanBtn=$('#solo-pan-btn');
const soloZoomBadge=$('#solo-zoom-badge'),soloZoomHint=$('#solo-zoom-hint');
function dq(id){return document.querySelector(id);}

let soloBrush='pen',soloColor='#000000',soloSize=3,soloOpacity=1,soloHardness=0.5;
let soloImmersed=false,soloImmersedTimeout=null,soloToolbarCollapsed=false;
let soloDrawing=false,soloLastPos=null,soloStrokes=[],soloUndoStack=[],soloPoints=[];
let soloCamX=0,soloCamY=0,soloCamZoom=1,soloTwoFinger=false;
let soloPinching=false,soloPinchStartDist=0,soloPinchStartZoom=1,soloPinchMidX=0,soloPinchMidY=0;
let soloPanning=false,soloLastPanX=0,soloLastPanY=0,soloIsPanMode=false;
let brushTipCache=null,brushTipCacheKey='',rainbowHue=0;
let soloSessionStart=0,soloReplayMode=false,soloReplayTimer=null,soloReplaySpeed=2,soloReplayProgress=0,soloReplayTotalTime=0;
let soloReplayPaused=false;
let soloShapeStart=null,soloShapeSnapshot=null;
function srand(seed){var x=Math.sin(seed*9301+49297)*233280;return x-Math.floor(x);}
let soloRafPending=false,soloCachedRect=null;
function scheduleRedraw(){if(soloRafPending)return;soloRafPending=true;requestAnimationFrame(function(){soloRafPending=false;doRedrawAllStrokes();});}
function doRedrawAllStrokes(){
  var w=parseFloat(soloCanvas.style.width),h=parseFloat(soloCanvas.style.height);
  var dpr=window.devicePixelRatio||1;
  soloCtx.setTransform(dpr,0,0,dpr,0,0);
  soloCtx.clearRect(0,0,w,h);soloCtx.fillStyle='#FFFFFF';soloCtx.fillRect(0,0,w,h);
  soloCtx.translate(soloCamX,soloCamY);soloCtx.scale(soloCamZoom,soloCamZoom);
  for(var i=0;i<soloStrokes.length;i++)renderStroke(soloStrokes[i]);
}

// --- 形状/填充/取色工具 v4.2 ---
function drawShapePreview(from,to,brush){
  var ctx=soloCtx;ctx.save();
  ctx.setTransform(1,0,0,1,0,0);ctx.scale(window.devicePixelRatio||1,window.devicePixelRatio||1);
  ctx.translate(soloCamX,soloCamY);ctx.scale(soloCamZoom,soloCamZoom);
  ctx.globalAlpha=soloOpacity;ctx.strokeStyle=soloColor;ctx.lineWidth=soloSize;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.setLineDash([6,4]);
  if(brush==='shape-line'){ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();}
  else if(brush==='shape-rect'){ctx.strokeRect(from.x,from.y,to.x-from.x,to.y-from.y);}
  else if(brush==='shape-circle'){var rx=(to.x-from.x)/2,ry=(to.y-from.y)/2;ctx.beginPath();ctx.ellipse(from.x+rx,from.y+ry,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}
function drawFinalShape(sd,brush){
  var ctx=soloCtx;ctx.save();
  ctx.setTransform(1,0,0,1,0,0);ctx.scale(window.devicePixelRatio||1,window.devicePixelRatio||1);
  ctx.translate(soloCamX,soloCamY);ctx.scale(soloCamZoom,soloCamZoom);
  ctx.globalAlpha=soloOpacity;ctx.strokeStyle=soloColor;ctx.lineWidth=soloSize;ctx.lineCap='round';ctx.lineJoin='round';
  if(brush==='shape-line'){ctx.beginPath();ctx.moveTo(sd.x1,sd.y1);ctx.lineTo(sd.x2,sd.y2);ctx.stroke();}
  else if(brush==='shape-rect'){ctx.strokeRect(sd.x1,sd.y1,sd.x2-sd.x1,sd.y2-sd.y1);}
  else if(brush==='shape-circle'){var rx=(sd.x2-sd.x1)/2,ry=(sd.y2-sd.y1)/2;ctx.beginPath();ctx.ellipse(sd.x1+rx,sd.y1+ry,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}
function cmatch(r1,g1,b1,a1,r2,g2,b2,a2,t){return Math.abs(r1-r2)<=t&&Math.abs(g1-g2)<=t&&Math.abs(b1-b2)<=t&&Math.abs(a1-a2)<=t;}
function soloFloodFill(wx,wy){
  var w=soloCanvas.width,h=soloCanvas.height,dpr=window.devicePixelRatio||1;
  var px=Math.round((wx*soloCamZoom+soloCamX)*dpr),py=Math.round((wy*soloCamZoom+soloCamY)*dpr);
  if(px<0||px>=w||py<0||py>=h)return;
  var imageData=soloCtx.getImageData(0,0,w,h),data=imageData.data;
  var idx=(py*w+px)*4;var tr=data[idx],tg=data[idx+1],tb=data[idx+2],ta=data[idx+3];
  var fc={r:parseInt(soloColor.slice(1,3),16),g:parseInt(soloColor.slice(3,5),16),b:parseInt(soloColor.slice(5,7),16)};
  if(cmatch(fc.r,fc.g,fc.b,255,tr,tg,tb,ta,30))return;
  var stack=[[px,py]],visited=new Uint8Array(w*h),t=40,count=0;
  while(stack.length>0&&count<w*h){var p=stack.pop(),x=p[0],y=p[1];if(x<0||x>=w||y<0||y>=h)continue;var vi=y*w+x;if(visited[vi])continue;var di=vi*4;if(!cmatch(data[di],data[di+1],data[di+2],data[di+3],tr,tg,tb,ta,t))continue;visited[vi]=1;data[di]=fc.r;data[di+1]=fc.g;data[di+2]=fc.b;data[di+3]=255;stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);count++;}
  soloCtx.putImageData(imageData,0,0);showToast('已填充（填充不可撤销，缩放/撤销后填充会消失）');
}
function soloPickColor(wx,wy){
  var w=soloCanvas.width,dpr=window.devicePixelRatio||1;
  var px=Math.round((wx*soloCamZoom+soloCamX)*dpr),py=Math.round((wy*soloCamZoom+soloCamY)*dpr);
  if(px<0||px>=w||py<0||py>=soloCanvas.height)return;
  var data=soloCtx.getImageData(px,py,1,1).data;
  var hex='#'+('0'+data[0].toString(16)).slice(-2)+('0'+data[1].toString(16)).slice(-2)+('0'+data[2].toString(16)).slice(-2);
  soloColor=hex;soloCustomColor.value=hex;
  document.querySelectorAll('.solo-color-btn').forEach(function(b){b.classList.remove('active');});
  brushTipCache=null;showToast('取色：'+hex);
}

function getBrushTip(color,size,hardness,brush){
  if(brush==='eraser'||brush==='spray'||brush==='calligraphy'||brush==='pencil'||brush==='crayon'||brush==='rainbow'||brush==='splatter'||brush==='neon'||brush==='pixel'||brush==='mirror'||brush==='kaleidoscope'||brush==='sponge'||brush==='glitch'||brush==='invert'||brush==='charcoal'||brush==='screen'||brush==='shape-line'||brush==='shape-rect'||brush==='shape-circle'||brush==='fill'||brush==='eyedropper')return null;
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

function initSoloCanvas(){
  var wrap=dq('#solo-canvas-wrap'),w=wrap.clientWidth,h=wrap.clientHeight;
  var dpr=window.devicePixelRatio||1;
  soloCanvas.style.width=w+'px';soloCanvas.style.height=h+'px';
  soloCanvas.width=w*dpr;soloCanvas.height=h*dpr;
  soloCachedRect=null;
  doRedrawAllStrokes();
}
function renderStroke(stroke){
  var ctx=soloCtx,pts=stroke.points;if(pts.length<2)return;
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=stroke.opacity;
  var hardness=stroke.hardness!==undefined?stroke.hardness:0.5;

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
        ctx.fillStyle=stroke.color;ctx.beginPath();
        ctx.arc(rx,ry,0.8+srand(sd+i*100+j+200)*stroke.size*0.6,0,Math.PI*2);ctx.fill();
      }
    }
    ctx.restore();return;
  }
  if(stroke.brush==='neon'){
    ctx.shadowBlur=stroke.size*4;ctx.shadowColor=stroke.color;
    ctx.strokeStyle='#ffffff';ctx.lineWidth=stroke.size*0.4;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.shadowBlur=stroke.size*2;ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.size;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  if(stroke.brush==='pixel'){
    ctx.lineWidth=stroke.size;ctx.strokeStyle=stroke.color;
    for(var i=1;i<pts.length;i++){
      var px=Math.round(pts[i].x/stroke.size)*stroke.size,py=Math.round(pts[i].y/stroke.size)*stroke.size;
      var lpx=Math.round(pts[i-1].x/stroke.size)*stroke.size,lpy=Math.round(pts[i-1].y/stroke.size)*stroke.size;
      ctx.fillStyle=stroke.color;ctx.globalAlpha=stroke.opacity;
      ctx.fillRect(px-stroke.size/2,py-stroke.size/2,stroke.size,stroke.size);
      ctx.fillRect(lpx-stroke.size/2,lpy-stroke.size/2,stroke.size,stroke.size);
    }
    ctx.restore();return;
  }

  ctx.globalCompositeOperation=(stroke.brush==='marker'||stroke.brush==='crayon')?'multiply':'source-over';
  if(stroke.brush==='glow'){ctx.shadowBlur=stroke.size*2;ctx.shadowColor=stroke.color;}
  var tip=(stroke.brush==='pen'||stroke.brush==='marker'||stroke.brush==='glow')?getBrushTip(stroke.color,stroke.size,hardness,stroke.brush):null;

  if(stroke.brush==='spray'){
    var sd=stroke._seed||1;for(var i=0;i<pts.length;i++){var p=pts[i],n=Math.floor(stroke.size*2);for(var j=0;j<n;j++){var a=srand(sd+i*100+j)*Math.PI*2,d=srand(sd+i*100+j+50)*stroke.size*2;ctx.globalAlpha=stroke.opacity*srand(sd+i*100+j+100)*0.25;ctx.fillStyle=stroke.color;ctx.beginPath();ctx.arc(p.x+Math.cos(a)*d,p.y+Math.sin(a)*d,0.5+srand(sd+i*100+j+200),0,Math.PI*2);ctx.fill();}}ctx.restore();return;}
  if(stroke.brush==='water'){for(var l=0;l<3;l++){ctx.globalAlpha=stroke.opacity*0.12;ctx.lineWidth=stroke.size+l*stroke.size*0.8;ctx.strokeStyle=stroke.color;for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}}ctx.restore();return;}
  if(stroke.brush==='pencil'){ctx.lineWidth=stroke.size*0.7;ctx.strokeStyle=stroke.color;ctx.globalAlpha=stroke.opacity*0.85;var sd=stroke._seed||1;for(var i=1;i<pts.length;i++){var wb=stroke.size*0.15;ctx.beginPath();ctx.moveTo(pts[i-1].x+(srand(sd+i)-0.5)*wb,pts[i-1].y+(srand(sd+i+300)-0.5)*wb);ctx.lineTo(pts[i].x+(srand(sd+i+600)-0.5)*wb,pts[i].y+(srand(sd+i+900)-0.5)*wb);ctx.stroke();}ctx.restore();return;}
  if(stroke.brush==='crayon'){ctx.lineWidth=stroke.size*1.2;ctx.strokeStyle=stroke.color;ctx.globalAlpha=stroke.opacity*0.7;var sd=stroke._seed||1;for(var p=0;p<2;p++)for(var i=1;i<pts.length;i++){var wb=stroke.size*0.3;ctx.beginPath();ctx.moveTo(pts[i-1].x+(srand(sd+i+p*1000)-0.5)*wb,pts[i-1].y+(srand(sd+i+p*1000+300)-0.5)*wb);ctx.lineTo(pts[i].x+(srand(sd+i+p*1000+600)-0.5)*wb,pts[i].y+(srand(sd+i+p*1000+900)-0.5)*wb);ctx.stroke();}ctx.restore();return;}
  if(stroke.brush==='calligraphy'){for(var i=1;i<pts.length;i++){var p0=pts[i-1],p1=pts[i],dx=p1.x-p0.x,dy=p1.y-p0.y,speed=Math.sqrt(dx*dx+dy*dy),w=stroke.size*(1+1/(1+speed*0.3)),h=stroke.size*(1/(1+speed*0.1));ctx.save();ctx.translate(p0.x,p0.y);ctx.rotate(Math.atan2(dy,dx));ctx.beginPath();ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);ctx.fillStyle=stroke.color;ctx.fill();ctx.restore();}ctx.restore();return;}

  // --- 新画笔 v3.5 ---
  if(stroke.brush==='mirror'){
    var cw=parseFloat(soloCanvas.style.width),worldCX=(cw/2-soloCamX)/soloCamZoom;
    ctx.lineWidth=stroke.size;ctx.strokeStyle=stroke.color;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    for(var i=1;i<pts.length;i++){var mx1=2*worldCX-pts[i-1].x,mx2=2*worldCX-pts[i].x;ctx.beginPath();ctx.moveTo(mx1,pts[i-1].y);ctx.lineTo(mx2,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  if(stroke.brush==='kaleidoscope'){
    var cw=parseFloat(soloCanvas.style.width),ch=parseFloat(soloCanvas.style.height);
    var wCX=(cw/2-soloCamX)/soloCamZoom,wCY=(ch/2-soloCamY)/soloCamZoom,N=6;
    ctx.lineWidth=stroke.size;ctx.strokeStyle=stroke.color;
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
        ctx.fillStyle=stroke.color;ctx.beginPath();
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
    ctx.globalAlpha=stroke.opacity;ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.size*0.6;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  if(stroke.brush==='invert'){
    ctx.globalCompositeOperation='difference';ctx.strokeStyle='#ffffff';ctx.lineWidth=stroke.size;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  if(stroke.brush==='charcoal'){
    ctx.lineWidth=stroke.size;ctx.strokeStyle=stroke.color;ctx.globalAlpha=stroke.opacity*0.85;
    var sd=stroke._seed||1;
    for(var i=1;i<pts.length;i++){var wb=stroke.size*0.3;ctx.beginPath();ctx.moveTo(pts[i-1].x+(srand(sd+i)-0.5)*wb,pts[i-1].y+(srand(sd+i+300)-0.5)*wb);ctx.lineTo(pts[i].x+(srand(sd+i+600)-0.5)*wb,pts[i].y+(srand(sd+i+900)-0.5)*wb);ctx.stroke();}
    for(var i=0;i<pts.length;i+=2){var p=pts[i],n=Math.floor(stroke.size*1.2);for(var j=0;j<n;j++){var a=srand(sd+i*100+j)*Math.PI*2,d=srand(sd+i*100+j+50)*stroke.size*2.5;ctx.globalAlpha=stroke.opacity*(0.1+srand(sd+i*100+j+100)*0.25);ctx.fillStyle='#000000';ctx.beginPath();ctx.arc(p.x+Math.cos(a)*d,p.y+Math.sin(a)*d,0.3+srand(sd+i*100+j+200)*2,0,Math.PI*2);ctx.fill();}}
    ctx.restore();return;
  }
  if(stroke.brush==='screen'){
    ctx.globalCompositeOperation='screen';ctx.lineWidth=stroke.size;ctx.strokeStyle=stroke.color;
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  // 形状工具渲染
  if(stroke.brush==='shape-line'){
    ctx.lineWidth=stroke.size;ctx.strokeStyle=stroke.color;ctx.globalAlpha=stroke.opacity;ctx.lineCap='round';
    var sd=stroke.shapeData||{x1:pts[0].x,y1:pts[0].y,x2:pts[1].x,y2:pts[1].y};
    ctx.beginPath();ctx.moveTo(sd.x1,sd.y1);ctx.lineTo(sd.x2,sd.y2);ctx.stroke();ctx.restore();return;
  }
  if(stroke.brush==='shape-rect'){
    ctx.lineWidth=stroke.size;ctx.strokeStyle=stroke.color;ctx.globalAlpha=stroke.opacity;ctx.lineJoin='round';
    var sd=stroke.shapeData||{x1:pts[0].x,y1:pts[0].y,x2:pts[1].x,y2:pts[1].y};
    ctx.strokeRect(sd.x1,sd.y1,sd.x2-sd.x1,sd.y2-sd.y1);ctx.restore();return;
  }
  if(stroke.brush==='shape-circle'){
    ctx.lineWidth=stroke.size;ctx.strokeStyle=stroke.color;ctx.globalAlpha=stroke.opacity;
    var sd=stroke.shapeData||{x1:pts[0].x,y1:pts[0].y,x2:pts[1].x,y2:pts[1].y};
    var rx=(sd.x2-sd.x1)/2,ry=(sd.y2-sd.y1)/2;ctx.beginPath();
    ctx.ellipse(sd.x1+rx,sd.y1+ry,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2);ctx.stroke();ctx.restore();return;
  }

  ctx.lineWidth=stroke.size;ctx.strokeStyle=stroke.color;
  if(tip){for(var i=0;i<pts.length;i++)stampBrushTip(ctx,pts[i].x,pts[i].y,stroke.size,tip);for(var i=1;i<pts.length;i++){var dx=pts[i].x-pts[i-1].x,dy=pts[i].y-pts[i-1].y,dist=Math.sqrt(dx*dx+dy*dy);for(var s=1;s<Math.ceil(dist/(stroke.size*0.3));s++){var t=s/Math.ceil(dist/(stroke.size*0.3));stampBrushTip(ctx,pts[i-1].x+dx*t,pts[i-1].y+dy*t,stroke.size,tip);}}}
  else{for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}}
  ctx.restore();
}

function getSoloPos(e){if(!soloCachedRect)soloCachedRect=soloCanvas.getBoundingClientRect();var rect=soloCachedRect,cx=e.touches?e.touches[0].clientX:e.clientX,cy=e.touches?e.touches[0].clientY:e.clientY,sx=cx-rect.left,sy=cy-rect.top;return{x:(sx-soloCamX)/soloCamZoom,y:(sy-soloCamY)/soloCamZoom,rawX:sx,rawY:sy};}
function getTwoFingerMid(e){if(!soloCachedRect)soloCachedRect=soloCanvas.getBoundingClientRect();var r=soloCachedRect,x1=e.touches[0].clientX-r.left,y1=e.touches[0].clientY-r.top,x2=e.touches[1].clientX-r.left,y2=e.touches[1].clientY-r.top;return{x:(x1+x2)/2,y:(y1+y2)/2,dist:Math.hypot(x2-x1,y2-y1)};}

function soloStart(e){if(soloTwoFinger||soloPinching)return;soloCachedRect=null;if(soloIsPanMode){soloPanning=true;var p=getSoloPos(e);soloLastPanX=p.rawX;soloLastPanY=p.rawY;return;}
  if(soloBrush==='fill'){e.preventDefault();var fp=getSoloPos(e);soloFloodFill(fp.x,fp.y);return;}
  if(soloBrush==='eyedropper'){e.preventDefault();var ep=getSoloPos(e);soloPickColor(ep.x,ep.y);return;}
  if(soloBrush==='shape-line'||soloBrush==='shape-rect'||soloBrush==='shape-circle'){e.preventDefault();soloShapeStart=getSoloPos(e);soloShapeSnapshot=soloCtx.getImageData(0,0,soloCanvas.width,soloCanvas.height);return;}
  e.preventDefault();soloDrawing=true;soloLastPos=getSoloPos(e);soloPoints=[soloLastPos];}
function soloMove(e){if(soloPinching)return soloPinchMove(e);if(soloPanning){e.preventDefault();var p=getSoloPos(e);soloCamX+=p.rawX-soloLastPanX;soloCamY+=p.rawY-soloLastPanY;soloLastPanX=p.rawX;soloLastPanY=p.rawY;scheduleRedraw();return;}if(soloShapeStart){e.preventDefault();if(soloShapeSnapshot)soloCtx.putImageData(soloShapeSnapshot,0,0);var pt=getSoloPos(e);drawShapePreview(soloShapeStart,pt,soloBrush);return;}if(!soloDrawing)return;e.preventDefault();var pt=getSoloPos(e);if(Math.abs(pt.x-soloLastPos.x)<0.5&&Math.abs(pt.y-soloLastPos.y)<0.5)return;soloPoints.push(pt);soloCtx.setTransform(1,0,0,1,0,0);soloCtx.scale(window.devicePixelRatio||1,window.devicePixelRatio||1);soloCtx.translate(soloCamX,soloCamY);soloCtx.scale(soloCamZoom,soloCamZoom);drawLiveSegment(soloLastPos,pt);soloLastPos=pt;}
function soloEnd(e){if(soloPinching){soloPinching=false;soloTwoFinger=e.touches?e.touches.length>=2:false;setTimeout(function(){soloZoomHint.classList.add('hidden');},1500);return;}if(soloPanning){soloPanning=false;return;}if(soloShapeStart){e.preventDefault();var pt=getSoloPos(e);if(soloShapeSnapshot)soloCtx.putImageData(soloShapeSnapshot,0,0);var sd={x1:soloShapeStart.x,y1:soloShapeStart.y,x2:pt.x,y2:pt.y};drawFinalShape(sd,soloBrush);soloUndoStack=[];soloStrokes.push({brush:soloBrush,color:soloColor,size:soloSize,opacity:soloOpacity,shapeData:sd,points:[soloShapeStart,pt],_startTime:Date.now()-soloSessionStart,_seed:Math.floor(Math.random()*100000)});updateUndoRedoBtns();soloShapeStart=null;soloShapeSnapshot=null;return;}if(!soloDrawing)return;e.preventDefault();soloDrawing=false;if(soloPoints.length>=1){var pts=soloPoints.length>1?soloPoints.slice():[soloPoints[0],Object.assign({},soloPoints[0])];soloUndoStack=[];soloStrokes.push({brush:soloBrush,color:soloColor,size:soloSize,opacity:soloOpacity,hardness:soloHardness,points:pts,_hueOffset:rainbowHue,_seed:Math.floor(Math.random()*100000),_startTime:Date.now()-soloSessionStart});updateUndoRedoBtns();rainbowHue=(rainbowHue+37)%360;}soloPoints=[];}

function drawLiveSegment(from,to){
  var ctx=soloCtx;ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=soloOpacity;
  if(soloBrush==='eraser'){ctx.globalCompositeOperation='destination-out';ctx.lineWidth=soloSize*2;ctx.strokeStyle='rgba(0,0,0,1)';ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.restore();return;}
  if(soloBrush==='rainbow'){ctx.strokeStyle='hsl('+rainbowHue+',100%,50%)';ctx.lineWidth=soloSize;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();rainbowHue=(rainbowHue+3)%360;ctx.restore();return;}
  if(soloBrush==='splatter'){var n=Math.floor(soloSize*1.5);for(var j=0;j<n;j++){var a=Math.random()*Math.PI*2,d=Math.random()*soloSize*4;ctx.globalAlpha=soloOpacity*(0.2+Math.random()*0.5);ctx.fillStyle=soloColor;ctx.beginPath();ctx.arc(to.x+Math.cos(a)*d,to.y+Math.sin(a)*d,0.8+Math.random()*soloSize*0.6,0,Math.PI*2);ctx.fill();}ctx.restore();return;}
  if(soloBrush==='neon'){ctx.shadowBlur=soloSize*4;ctx.shadowColor=soloColor;ctx.strokeStyle='#ffffff';ctx.lineWidth=soloSize*0.4;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.shadowBlur=soloSize*2;ctx.strokeStyle=soloColor;ctx.lineWidth=soloSize;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.restore();return;}
  if(soloBrush==='pixel'){var px=Math.round(to.x/soloSize)*soloSize,py=Math.round(to.y/soloSize)*soloSize;ctx.fillStyle=soloColor;ctx.globalAlpha=soloOpacity;ctx.fillRect(px-soloSize/2,py-soloSize/2,soloSize,soloSize);var fpx=Math.round(from.x/soloSize)*soloSize,fpy=Math.round(from.y/soloSize)*soloSize;ctx.fillRect(fpx-soloSize/2,fpy-soloSize/2,soloSize,soloSize);ctx.restore();return;}
  if(soloBrush==='glow'){ctx.shadowBlur=soloSize*2;ctx.shadowColor=soloColor;}
  ctx.globalCompositeOperation=(soloBrush==='marker'||soloBrush==='crayon')?'multiply':'source-over';
  if(soloBrush==='spray'){var n=Math.floor(soloSize*2);for(var j=0;j<n;j++){var a=Math.random()*Math.PI*2,d=Math.random()*soloSize*2;ctx.globalAlpha=soloOpacity*Math.random()*0.25;ctx.fillStyle=soloColor;ctx.beginPath();ctx.arc(to.x+Math.cos(a)*d,to.y+Math.sin(a)*d,0.5+Math.random(),0,Math.PI*2);ctx.fill();}ctx.restore();return;}
  if(soloBrush==='water'||soloBrush==='pencil'||soloBrush==='crayon'||soloBrush==='calligraphy'){ctx.lineWidth=soloSize;ctx.strokeStyle=soloColor;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.restore();return;}
  // --- 新画笔 v3.5 实时预览 ---
  if(soloBrush==='mirror'){
    var cw=parseFloat(soloCanvas.style.width),worldCX=(cw/2-soloCamX)/soloCamZoom;
    ctx.lineWidth=soloSize;ctx.strokeStyle=soloColor;
    ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
    var mx1=2*worldCX-from.x,mx2=2*worldCX-to.x;
    ctx.beginPath();ctx.moveTo(mx1,from.y);ctx.lineTo(mx2,to.y);ctx.stroke();
    ctx.restore();return;
  }
  if(soloBrush==='kaleidoscope'){
    var cw=parseFloat(soloCanvas.style.width),ch=parseFloat(soloCanvas.style.height);
    var wCX=(cw/2-soloCamX)/soloCamZoom,wCY=(ch/2-soloCamY)/soloCamZoom,N=6;
    ctx.lineWidth=soloSize;ctx.strokeStyle=soloColor;
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
      ctx.fillStyle=soloColor;ctx.beginPath();
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
    ctx.globalAlpha=soloOpacity;ctx.strokeStyle=soloColor;ctx.lineWidth=soloSize*0.6;
    ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
    ctx.restore();return;
  }
  if(soloBrush==='invert'){
    ctx.globalCompositeOperation='difference';ctx.strokeStyle='#ffffff';ctx.lineWidth=soloSize;
    ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
    ctx.restore();return;
  }
  if(soloBrush==='charcoal'){
    ctx.lineWidth=soloSize;ctx.strokeStyle=soloColor;ctx.globalAlpha=soloOpacity*0.85;
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
    ctx.globalCompositeOperation='screen';ctx.lineWidth=soloSize;ctx.strokeStyle=soloColor;
    ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
    ctx.restore();return;
  }
  var tip=(soloBrush==='pen'||soloBrush==='marker'||soloBrush==='glow')?getBrushTip(soloColor,soloSize,soloHardness,soloBrush):null;
  if(tip){stampBrushTip(ctx,to.x,to.y,soloSize,tip);var dx=to.x-from.x,dy=to.y-from.y,dist=Math.sqrt(dx*dx+dy*dy);for(var s=0;s<Math.ceil(dist/(soloSize*0.3));s++){var t=s/Math.ceil(dist/(soloSize*0.3));stampBrushTip(ctx,from.x+dx*t,from.y+dy*t,soloSize,tip);}}
  else{ctx.lineWidth=soloSize;ctx.strokeStyle=soloColor;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();}
  ctx.restore();
}
function soloPinchMove(e){var m=getTwoFingerMid(e),nz=soloPinchStartZoom*(m.dist/soloPinchStartDist);soloCamZoom=Math.max(0.01,Math.min(5,nz));var r=soloCamZoom/soloPinchStartZoom;soloCamX=m.x-(soloPinchMidX-soloCamX)*r;soloCamY=m.y-(soloPinchMidY-soloCamY)*r;soloPinchMidX=m.x;soloPinchMidY=m.y;soloPinchStartZoom=soloCamZoom;soloPinchStartDist=m.dist;scheduleRedraw();updateZoomBadge();}

// events
soloCanvas.addEventListener('touchstart',function(e){soloCachedRect=null;if(e.touches.length===2){e.preventDefault();soloPinching=true;soloTwoFinger=true;soloDrawing=false;var m=getTwoFingerMid(e);soloPinchStartDist=m.dist;soloPinchStartZoom=soloCamZoom;soloPinchMidX=m.x;soloPinchMidY=m.y;soloZoomHint.classList.remove('hidden');}else if(e.touches.length===1&&!soloPinching){soloTwoFinger=false;soloStart(e);}},{passive:false});
soloCanvas.addEventListener('touchmove',function(e){if(e.touches.length===2&&soloPinching){e.preventDefault();soloPinchMove(e);}else if(soloPanning)soloMove(e);else if(!soloPinching)soloMove(e);},{passive:false});
soloCanvas.addEventListener('touchend',soloEnd);
soloCanvas.addEventListener('mousedown',soloStart);soloCanvas.addEventListener('mousemove',soloMove);
soloCanvas.addEventListener('mouseup',soloEnd);soloCanvas.addEventListener('mouseleave',function(e){if(soloDrawing)soloEnd(e);});
soloCanvas.addEventListener('wheel',function(e){e.preventDefault();soloCachedRect=null;var rect=soloCanvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top,nz=Math.max(0.01,Math.min(5,soloCamZoom*(e.deltaY<0?1.1:0.9)));soloCamX=mx-(mx-soloCamX)*(nz/soloCamZoom);soloCamY=my-(my-soloCamY)*(nz/soloCamZoom);soloCamZoom=nz;scheduleRedraw();updateZoomBadge();},{passive:false});
function updateZoomBadge(){soloZoomBadge.textContent=Math.round(soloCamZoom*100)+'%';}

// brush + tool selector
dq('#solo-brushes').addEventListener('click',function(e){var btn=e.target.closest('.solo-brush-btn');if(!btn)return;dq('#solo-brushes').querySelectorAll('.solo-brush-btn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');dq('#solo-tools').querySelectorAll('.solo-tool-btn').forEach(function(b){b.classList.remove('active');});soloBrush=btn.dataset.brush;soloCanvas.style.cursor='crosshair';});
dq('#solo-tools').addEventListener('click',function(e){var btn=e.target.closest('.solo-tool-btn');if(!btn)return;dq('#solo-tools').querySelectorAll('.solo-tool-btn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');dq('#solo-brushes').querySelectorAll('.solo-brush-btn').forEach(function(b){b.classList.remove('active');});soloBrush=btn.dataset.brush;soloCanvas.style.cursor=soloBrush==='fill'?'cell':soloBrush==='eyedropper'?'crosshair':'crosshair';if(soloIsPanMode){soloIsPanMode=false;soloPanBtn.classList.remove('active');}});
soloPanBtn.addEventListener('click',function(){soloIsPanMode=!soloIsPanMode;soloPanBtn.classList.toggle('active',soloIsPanMode);if(soloIsPanMode){dq('#solo-tools').querySelectorAll('.solo-tool-btn').forEach(function(b){b.classList.remove('active');});}soloCanvas.style.cursor=soloIsPanMode?'grab':'crosshair';});
soloSizeSlider.addEventListener('input',function(){soloSize=+soloSizeSlider.value;soloSizeVal.textContent=soloSize;});
soloOpacitySlider.addEventListener('input',function(){soloOpacity=+soloOpacitySlider.value/100;soloOpacityVal.textContent=soloOpacitySlider.value;});
soloSmoothSlider.addEventListener('input',function(){soloHardness=1-+soloSmoothSlider.value/100;soloSmoothVal.textContent=soloSmoothSlider.value;brushTipCache=null;});
dq('#solo-colors-wrap').addEventListener('click',function(e){var btn=e.target.closest('.solo-color-btn');if(!btn)return;document.querySelectorAll('.solo-color-btn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');soloColor=btn.dataset.color;soloCustomColor.value=soloColor;brushTipCache=null;});
soloCustomColor.addEventListener('input',function(){soloColor=soloCustomColor.value;document.querySelectorAll('.solo-color-btn').forEach(function(b){b.classList.remove('active');});brushTipCache=null;});
soloUndoBtn.addEventListener('click',function(){if(!soloStrokes.length)return;soloUndoStack.push(soloStrokes.pop());doRedrawAllStrokes();updateUndoRedoBtns();});
soloRedoBtn.addEventListener('click',function(){if(!soloUndoStack.length)return;soloStrokes.push(soloUndoStack.pop());doRedrawAllStrokes();updateUndoRedoBtns();});
soloClearBtn.addEventListener('click',function(){if(!soloStrokes.length)return;if(confirm('确定清空画布吗？')){soloStrokes=[];soloUndoStack=[];doRedrawAllStrokes();updateUndoRedoBtns();}});
soloSaveBtn.addEventListener('click',function(){var a=document.createElement('a');a.download='画作_'+new Date().toISOString().slice(0,10)+'.png';a.href=soloCanvas.toDataURL('image/png');a.click();showToast('已保存');});
function updateUndoRedoBtns(){soloUndoBtn.disabled=!soloStrokes.length;soloRedoBtn.disabled=!soloUndoStack.length;var rb=dq('#solo-replay-btn');if(rb)rb.disabled=!soloStrokes.length;}

  // --- 回放功能 v4.0 ---
  function startSoloReplay(){
    if(!soloStrokes.length)return;
    soloReplayMode=true;soloReplayPaused=false;soloReplayProgress=0;
    soloReplayTotalTime=soloStrokes[soloStrokes.length-1]._startTime+800;
    var rb=dq('#solo-replay-bar');if(rb)rb.classList.remove('hidden');
    soloCanvas.style.cursor='default';
    doReplayRedraw();
    soloReplayTimer=requestAnimationFrame(replayFrame);
  }
  function stopSoloReplay(){
    soloReplayMode=false;soloReplayPaused=false;
    if(soloReplayTimer){cancelAnimationFrame(soloReplayTimer);soloReplayTimer=null;}
    var rb=dq('#solo-replay-bar');if(rb)rb.classList.add('hidden');
    soloCanvas.style.cursor=soloIsPanMode?'grab':'crosshair';
    doRedrawAllStrokes();
  }
  function replayFrame(ts){
    if(!soloReplayMode)return;
    if(!soloReplayPaused){
      soloReplayProgress+=16.67*soloReplaySpeed;
      if(soloReplayProgress>=soloReplayTotalTime){soloReplayProgress=soloReplayTotalTime;doReplayRedraw();stopSoloReplay();return;}
      doReplayRedraw();
    }
    soloReplayTimer=requestAnimationFrame(replayFrame);
  }
  function doReplayRedraw(){
    var w=parseFloat(soloCanvas.style.width),h=parseFloat(soloCanvas.style.height);
    var dpr=window.devicePixelRatio||1;
    soloCtx.setTransform(dpr,0,0,dpr,0,0);
    soloCtx.clearRect(0,0,w,h);soloCtx.fillStyle='#FFFFFF';soloCtx.fillRect(0,0,w,h);
    soloCtx.translate(soloCamX,soloCamY);soloCtx.scale(soloCamZoom,soloCamZoom);
    for(var i=0;i<soloStrokes.length;i++){
      var s=soloStrokes[i];
      if(s._startTime>soloReplayProgress)break;
      renderStroke(s);
    }
    updateReplayProgressUI();
  }
  function toggleReplayPause(){soloReplayPaused=!soloReplayPaused;var pb=dq('#solo-replay-pause');if(pb)pb.textContent=soloReplayPaused?'▶':'⏸';}
  function changeReplaySpeed(sp){soloReplaySpeed=sp;var bb=dq('#solo-replay-bar');if(bb)bb.querySelectorAll('.replay-speed-btn').forEach(function(b){b.classList.toggle('active',+b.dataset.sp===sp);});}
  function updateReplayProgressUI(){
    var pct=soloReplayTotalTime?Math.round(soloReplayProgress/soloReplayTotalTime*100):0;
    var fill=dq('#solo-replay-fill');if(fill)fill.style.width=pct+'%';
    var time=dq('#solo-replay-time');if(time)time.textContent=(soloReplayProgress/1000).toFixed(1)+'s';
  }
  // 回放按钮事件
  (function(){
    var btn=dq('#solo-replay-btn');if(btn)btn.addEventListener('click',function(){if(soloReplayMode){stopSoloReplay();return;}startSoloReplay();});
    var pause=dq('#solo-replay-pause');if(pause)pause.addEventListener('click',toggleReplayPause);
    var stop=dq('#solo-replay-stop');if(stop)stop.addEventListener('click',stopSoloReplay);
    var bar=dq('#solo-replay-bar');if(bar)bar.querySelectorAll('.replay-speed-btn').forEach(function(b){b.addEventListener('click',function(){changeReplaySpeed(+b.dataset.sp);});});
  })();

// collapse
(function(){var b=dq('#solo-toggle-toolbar');if(b)b.addEventListener('click',function(){soloToolbarCollapsed=!soloToolbarCollapsed;var tb=dq('#solo-toolbar');if(tb)tb.classList.toggle('collapsed',soloToolbarCollapsed);b.textContent=soloToolbarCollapsed?'▲':'▼';});})();

// immersive
(function(){var ib=dq('#solo-immerse-btn'),eb=dq('#solo-exit-immerse');
if(ib)ib.addEventListener('click',function(){soloImmersed=true;var t=dq('#solo-top-bar');if(t)t.classList.add('immersed');var b=dq('#solo-toolbar');if(b)b.classList.add('immersed');soloScreen.classList.add('immersed-full');if(eb)eb.classList.remove('hidden');});
if(eb)eb.addEventListener('click',function(){soloImmersed=false;var t=dq('#solo-top-bar');if(t)t.classList.remove('immersed');var b=dq('#solo-toolbar');if(b)b.classList.remove('immersed');soloScreen.classList.remove('immersed-full');eb.classList.add('hidden');initSoloCanvas();});
})();
soloCanvas.addEventListener('click',function(e){if(!soloImmersed)return;var t=dq('#solo-top-bar');if(t)t.classList.remove('immersed');var b=dq('#solo-toolbar');if(b)b.classList.remove('immersed');var eb=dq('#solo-exit-immerse');if(eb)eb.classList.remove('hidden');clearTimeout(soloImmersedTimeout);soloImmersedTimeout=setTimeout(function(){if(soloImmersed){var t2=dq('#solo-top-bar');if(t2)t2.classList.add('immersed');var b2=dq('#solo-toolbar');if(b2)b2.classList.add('immersed');}},2000);});

// entry
soloModeBtn.addEventListener('click',function(){lobbyScreen.classList.remove('active');soloScreen.classList.add('active');soloStrokes=[];soloUndoStack=[];soloCamX=0;soloCamY=0;soloCamZoom=1;soloImmersed=false;soloToolbarCollapsed=false;rainbowHue=Math.random()*360;soloSessionStart=Date.now();soloReplayMode=false;soloReplayPaused=false;if(soloReplayTimer){cancelAnimationFrame(soloReplayTimer);soloReplayTimer=null;}var rb=dq('#solo-replay-bar');if(rb)rb.classList.add('hidden');soloScreen.classList.remove('immersed-full');var t=dq('#solo-top-bar');if(t)t.classList.remove('immersed');var tb=dq('#solo-toolbar');if(tb){tb.classList.remove('immersed');tb.classList.remove('collapsed');}var eb=dq('#solo-exit-immerse');if(eb)eb.classList.add('hidden');var bt=dq('#solo-toggle-toolbar');if(bt)bt.textContent='▼';initSoloCanvas();updateUndoRedoBtns();updateZoomBadge();});
soloBackBtn.addEventListener('click',function(){soloScreen.classList.remove('active');lobbyScreen.classList.add('active');soloIsPanMode=false;soloPanBtn.classList.remove('active');});
window.addEventListener('resize',function(){if(soloScreen.classList.contains('active'))initSoloCanvas();});
window.addEventListener('orientationchange',function(){if(soloScreen.classList.contains('active'))setTimeout(initSoloCanvas,300);});

// 主题切换
(function(){var b=document.querySelector('#theme-toggle');if(b)b.addEventListener('click',function(){var h=document.documentElement;var t=h.getAttribute('data-theme')==='dark'?'light':'dark';h.setAttribute('data-theme',t);localStorage.setItem('solo-theme',t);});})();

console.log('🎨 你画我猜 v4.2 - 前端就绪');
