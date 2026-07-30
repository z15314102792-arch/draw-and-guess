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
// #               单人创作模式 v3 (Solo Mode)                #
// ##########################################################

const soloScreen=$('#solo-screen'),soloModeBtn=$('#solo-mode-btn'),soloBackBtn=$('#solo-back-btn');
const soloCanvas=$('#solo-canvas'),soloCtx=soloCanvas.getContext('2d');
const soloSizeSlider=$('#solo-size-slider'),soloSizeVal=$('#solo-size-val');
const soloOpacitySlider=$('#solo-opacity-slider'),soloOpacityVal=$('#solo-opacity-val');
const soloSmoothSlider=$('#solo-smooth-slider'),soloSmoothVal=$('#solo-smooth-val');
const soloUndoBtn=$('#solo-undo-btn'),soloRedoBtn=$('#solo-redo-btn');
const soloClearBtn=$('#solo-clear-btn'),soloSaveBtn=$('#solo-save-btn');
const soloCustomColor=$('#solo-custom-color'),soloPanBtn=$('#solo-pan-btn');
const soloZoomBadge=$('#solo-zoom-badge'),soloZoomHint=$('#solo-zoom-hint');
function el(id){return document.querySelector(id);}

let soloBrush='pen',soloColor='#000000',soloSize=3,soloOpacity=1,soloHardness=0.5;
let soloImmersed=false,soloImmersedTimeout=null,soloToolbarCollapsed=false;
let soloDrawing=false,soloLastPos=null,soloStrokes=[],soloUndoStack=[],soloPoints=[];
let soloCamX=0,soloCamY=0,soloCamZoom=1,soloTwoFinger=false;
let soloPinching=false,soloPinchStartDist=0,soloPinchStartZoom=1,soloPinchMidX=0,soloPinchMidY=0;
let soloPanning=false,soloLastPanX=0,soloLastPanY=0,soloIsPanMode=false;
let brushTipCache=null,brushTipCacheKey='';

function getBrushTip(color,size,hardness,brush){
  if(brush==='eraser'||brush==='spray'||brush==='calligraphy'||brush==='pencil'||brush==='crayon')return null;
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
  var wrap=el('#solo-canvas-wrap'),w=wrap.clientWidth,h=wrap.clientHeight;
  var dpr=window.devicePixelRatio||1;
  soloCanvas.style.width=w+'px';soloCanvas.style.height=h+'px';
  soloCanvas.width=w*dpr;soloCanvas.height=h*dpr;
  redrawAllStrokes();
}
function redrawAllStrokes(){
  var w=parseFloat(soloCanvas.style.width),h=parseFloat(soloCanvas.style.height);
  var dpr=window.devicePixelRatio||1;
  soloCtx.setTransform(dpr,0,0,dpr,0,0);
  soloCtx.clearRect(0,0,w,h);soloCtx.fillStyle='#FFFFFF';soloCtx.fillRect(0,0,w,h);
  soloCtx.translate(soloCamX,soloCamY);soloCtx.scale(soloCamZoom,soloCamZoom);
  for(var i=0;i<soloStrokes.length;i++)renderStroke(soloStrokes[i]);
}
function renderStroke(stroke){
  var ctx=soloCtx,pts=stroke.points;if(pts.length<2)return;
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=stroke.opacity;
  if(stroke.brush==='eraser'){
    ctx.globalCompositeOperation='destination-out';ctx.lineWidth=stroke.size*2;ctx.strokeStyle='rgba(0,0,0,1)';
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  ctx.globalCompositeOperation=(stroke.brush==='marker'||stroke.brush==='crayon')?'multiply':'source-over';
  if(stroke.brush==='glow'){ctx.shadowBlur=stroke.size*2;ctx.shadowColor=stroke.color;}
  var hardness=stroke.hardness!==undefined?stroke.hardness:0.5;
  var tip=(stroke.brush==='pen'||stroke.brush==='marker'||stroke.brush==='glow')?getBrushTip(stroke.color,stroke.size,hardness,stroke.brush):null;
  if(stroke.brush==='spray'){for(var i=0;i<pts.length;i++){var p=pts[i],n=Math.floor(stroke.size*2);for(var j=0;j<n;j++){var a=Math.random()*Math.PI*2,d=Math.random()*stroke.size*2;ctx.globalAlpha=stroke.opacity*Math.random()*0.25;ctx.fillStyle=stroke.color;ctx.beginPath();ctx.arc(p.x+Math.cos(a)*d,p.y+Math.sin(a)*d,0.5+Math.random(),0,Math.PI*2);ctx.fill();}}ctx.restore();return;}
  if(stroke.brush==='water'){for(var l=0;l<3;l++){ctx.globalAlpha=stroke.opacity*0.12;ctx.lineWidth=stroke.size+l*stroke.size*0.8;ctx.strokeStyle=stroke.color;for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}}ctx.restore();return;}
  if(stroke.brush==='pencil'){ctx.lineWidth=stroke.size*0.7;ctx.strokeStyle=stroke.color;ctx.globalAlpha=stroke.opacity*0.85;for(var i=1;i<pts.length;i++){var wb=stroke.size*0.15;ctx.beginPath();ctx.moveTo(pts[i-1].x+(Math.random()-0.5)*wb,pts[i-1].y+(Math.random()-0.5)*wb);ctx.lineTo(pts[i].x+(Math.random()-0.5)*wb,pts[i].y+(Math.random()-0.5)*wb);ctx.stroke();}ctx.restore();return;}
  if(stroke.brush==='crayon'){ctx.lineWidth=stroke.size*1.2;ctx.strokeStyle=stroke.color;ctx.globalAlpha=stroke.opacity*0.7;for(var p=0;p<2;p++)for(var i=1;i<pts.length;i++){var wb=stroke.size*0.3;ctx.beginPath();ctx.moveTo(pts[i-1].x+(Math.random()-0.5)*wb,pts[i-1].y+(Math.random()-0.5)*wb);ctx.lineTo(pts[i].x+(Math.random()-0.5)*wb,pts[i].y+(Math.random()-0.5)*wb);ctx.stroke();}ctx.restore();return;}
  if(stroke.brush==='calligraphy'){for(var i=1;i<pts.length;i++){var p0=pts[i-1],p1=pts[i],dx=p1.x-p0.x,dy=p1.y-p0.y,speed=Math.sqrt(dx*dx+dy*dy),w=stroke.size*(1+1/(1+speed*0.3)),h=stroke.size*(1/(1+speed*0.1));ctx.save();ctx.translate(p0.x,p0.y);ctx.rotate(Math.atan2(dy,dx));ctx.beginPath();ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);ctx.fillStyle=stroke.color;ctx.fill();ctx.restore();}ctx.restore();return;}
  ctx.lineWidth=stroke.size;ctx.strokeStyle=stroke.color;
  if(tip){for(var i=0;i<pts.length;i++)stampBrushTip(ctx,pts[i].x,pts[i].y,stroke.size,tip);for(var i=1;i<pts.length;i++){var dx=pts[i].x-pts[i-1].x,dy=pts[i].y-pts[i-1].y,dist=Math.sqrt(dx*dx+dy*dy);for(var s=1;s<Math.ceil(dist/(stroke.size*0.3));s++){var t=s/Math.ceil(dist/(stroke.size*0.3));stampBrushTip(ctx,pts[i-1].x+dx*t,pts[i-1].y+dy*t,stroke.size,tip);}}}
  else{for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}}
  ctx.restore();
}
function getSoloPos(e){var rect=soloCanvas.getBoundingClientRect(),cx=e.touches?e.touches[0].clientX:e.clientX,cy=e.touches?e.touches[0].clientY:e.clientY,sx=cx-rect.left,sy=cy-rect.top;return{x:(sx-soloCamX)/soloCamZoom,y:(sy-soloCamY)/soloCamZoom,rawX:sx,rawY:sy};}
function getTwoFingerMid(e){var r=soloCanvas.getBoundingClientRect(),x1=e.touches[0].clientX-r.left,y1=e.touches[0].clientY-r.top,x2=e.touches[1].clientX-r.left,y2=e.touches[1].clientY-r.top;return{x:(x1+x2)/2,y:(y1+y2)/2,dist:Math.hypot(x2-x1,y2-y1)};}
function soloStart(e){if(soloTwoFinger||soloPinching)return;if(soloIsPanMode){soloPanning=true;var p=getSoloPos(e);soloLastPanX=p.rawX;soloLastPanY=p.rawY;return;}e.preventDefault();soloDrawing=true;soloLastPos=getSoloPos(e);soloPoints=[soloLastPos];}
function soloMove(e){if(soloPinching)return soloPinchMove(e);if(soloPanning){e.preventDefault();var p=getSoloPos(e);soloCamX+=p.rawX-soloLastPanX;soloCamY+=p.rawY-soloLastPanY;soloLastPanX=p.rawX;soloLastPanY=p.rawY;redrawAllStrokes();return;}if(!soloDrawing)return;e.preventDefault();var pt=getSoloPos(e);if(Math.abs(pt.x-soloLastPos.x)<0.5&&Math.abs(pt.y-soloLastPos.y)<0.5)return;soloPoints.push(pt);soloCtx.setTransform(1,0,0,1,0,0);soloCtx.scale(window.devicePixelRatio||1,window.devicePixelRatio||1);soloCtx.translate(soloCamX,soloCamY);soloCtx.scale(soloCamZoom,soloCamZoom);drawLiveSegment(soloLastPos,pt);soloLastPos=pt;}
function soloEnd(e){if(soloPinching){soloPinching=false;soloTwoFinger=e.touches?e.touches.length>=2:false;setTimeout(function(){soloZoomHint.classList.add('hidden');},1500);return;}if(soloPanning){soloPanning=false;return;}if(!soloDrawing)return;e.preventDefault();soloDrawing=false;if(soloPoints.length>=1){var pts=soloPoints.length>1?soloPoints.slice():[soloPoints[0],Object.assign({},soloPoints[0])];soloUndoStack=[];soloStrokes.push({brush:soloBrush,color:soloColor,size:soloSize,opacity:soloOpacity,hardness:soloHardness,points:pts});updateUndoRedoBtns();}soloPoints=[];}
function drawLiveSegment(from,to){var ctx=soloCtx;ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=soloOpacity;if(soloBrush==='eraser'){ctx.globalCompositeOperation='destination-out';ctx.lineWidth=soloSize*2;ctx.strokeStyle='rgba(0,0,0,1)';ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.restore();return;}if(soloBrush==='glow'){ctx.shadowBlur=soloSize*2;ctx.shadowColor=soloColor;}ctx.globalCompositeOperation=(soloBrush==='marker'||soloBrush==='crayon')?'multiply':'source-over';if(soloBrush==='spray'||soloBrush==='water'||soloBrush==='pencil'||soloBrush==='crayon'||soloBrush==='calligraphy'){ctx.lineWidth=soloSize;ctx.strokeStyle=soloColor;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.restore();return;}var tip=(soloBrush==='pen'||soloBrush==='marker'||soloBrush==='glow')?getBrushTip(soloColor,soloSize,soloHardness,soloBrush):null;if(tip){stampBrushTip(ctx,to.x,to.y,soloSize,tip);var dx=to.x-from.x,dy=to.y-from.y,dist=Math.sqrt(dx*dx+dy*dy);for(var s=0;s<Math.ceil(dist/(soloSize*0.3));s++){var t=s/Math.ceil(dist/(soloSize*0.3));stampBrushTip(ctx,from.x+dx*t,from.y+dy*t,soloSize,tip);}}else{ctx.lineWidth=soloSize;ctx.strokeStyle=soloColor;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();}ctx.restore();}
function soloPinchMove(e){var m=getTwoFingerMid(e),nz=soloPinchStartZoom*(m.dist/soloPinchStartDist);soloCamZoom=Math.max(0.01,Math.min(5,nz));var r=soloCamZoom/soloPinchStartZoom;soloCamX=m.x-(soloPinchMidX-soloCamX)*r;soloCamY=m.y-(soloPinchMidY-soloCamY)*r;soloPinchMidX=m.x;soloPinchMidY=m.y;soloPinchStartZoom=soloCamZoom;soloPinchStartDist=m.dist;redrawAllStrokes();updateZoomBadge();}

// event bindings
soloCanvas.addEventListener('touchstart',function(e){if(e.touches.length===2){e.preventDefault();soloPinching=true;soloTwoFinger=true;soloDrawing=false;var m=getTwoFingerMid(e);soloPinchStartDist=m.dist;soloPinchStartZoom=soloCamZoom;soloPinchMidX=m.x;soloPinchMidY=m.y;soloZoomHint.classList.remove('hidden');}else if(e.touches.length===1&&!soloPinching){soloTwoFinger=false;soloStart(e);}},{passive:false});
soloCanvas.addEventListener('touchmove',function(e){if(e.touches.length===2&&soloPinching){e.preventDefault();soloPinchMove(e);}else if(soloPanning)soloMove(e);else if(!soloPinching)soloMove(e);},{passive:false});
soloCanvas.addEventListener('touchend',soloEnd);
soloCanvas.addEventListener('mousedown',soloStart);soloCanvas.addEventListener('mousemove',soloMove);
soloCanvas.addEventListener('mouseup',soloEnd);soloCanvas.addEventListener('mouseleave',function(e){if(soloDrawing)soloEnd(e);});
soloCanvas.addEventListener('wheel',function(e){e.preventDefault();var rect=soloCanvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top,nz=Math.max(0.01,Math.min(5,soloCamZoom*(e.deltaY<0?1.1:0.9)));soloCamX=mx-(mx-soloCamX)*(nz/soloCamZoom);soloCamY=my-(my-soloCamY)*(nz/soloCamZoom);soloCamZoom=nz;redrawAllStrokes();updateZoomBadge();},{passive:false});
function updateZoomBadge(){soloZoomBadge.textContent=Math.round(soloCamZoom*100)+'%';}

// brush selector
el('#solo-brushes').addEventListener('click',function(e){var btn=e.target.closest('.solo-brush-btn');if(!btn)return;el('#solo-brushes').querySelectorAll('.solo-brush-btn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');soloBrush=btn.dataset.brush;});
soloPanBtn.addEventListener('click',function(){soloIsPanMode=!soloIsPanMode;soloPanBtn.classList.toggle('active',soloIsPanMode);soloCanvas.style.cursor=soloIsPanMode?'grab':'crosshair';});
soloSizeSlider.addEventListener('input',function(){soloSize=+soloSizeSlider.value;soloSizeVal.textContent=soloSize;});
soloOpacitySlider.addEventListener('input',function(){soloOpacity=+soloOpacitySlider.value/100;soloOpacityVal.textContent=soloOpacitySlider.value;});
soloSmoothSlider.addEventListener('input',function(){soloHardness=1-+soloSmoothSlider.value/100;soloSmoothVal.textContent=soloSmoothSlider.value;brushTipCache=null;});
el('#solo-colors-wrap').addEventListener('click',function(e){var btn=e.target.closest('.solo-color-btn');if(!btn)return;document.querySelectorAll('.solo-color-btn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');soloColor=btn.dataset.color;soloCustomColor.value=soloColor;brushTipCache=null;});
soloCustomColor.addEventListener('input',function(){soloColor=soloCustomColor.value;document.querySelectorAll('.solo-color-btn').forEach(function(b){b.classList.remove('active');});brushTipCache=null;});
soloUndoBtn.addEventListener('click',function(){if(!soloStrokes.length)return;soloUndoStack.push(soloStrokes.pop());redrawAllStrokes();updateUndoRedoBtns();});
soloRedoBtn.addEventListener('click',function(){if(!soloUndoStack.length)return;soloStrokes.push(soloUndoStack.pop());redrawAllStrokes();updateUndoRedoBtns();});
soloClearBtn.addEventListener('click',function(){if(!soloStrokes.length)return;if(confirm('确定清空画布吗？')){soloStrokes=[];soloUndoStack=[];redrawAllStrokes();updateUndoRedoBtns();}});
soloSaveBtn.addEventListener('click',function(){var a=document.createElement('a');a.download='画作_'+new Date().toISOString().slice(0,10)+'.png';a.href=soloCanvas.toDataURL('image/png');a.click();showToast('已保存');});
function updateUndoRedoBtns(){soloUndoBtn.disabled=!soloStrokes.length;soloRedoBtn.disabled=!soloUndoStack.length;}

// collapse toolbar
el('#solo-toggle-toolbar').addEventListener('click',function(){soloToolbarCollapsed=!soloToolbarCollapsed;var tb=el('#solo-toolbar');tb.classList.toggle('collapsed',soloToolbarCollapsed);el('#solo-toggle-toolbar').textContent=soloToolbarCollapsed?'▲':'▼';});

// immersive mode
el('#solo-immerse-btn').addEventListener('click',function(){soloImmersed=true;el('#solo-top-bar').classList.add('immersed');el('#solo-toolbar').classList.add('immersed');el('#solo-exit-immerse').classList.remove('hidden');});
el('#solo-exit-immerse').addEventListener('click',function(){soloImmersed=false;el('#solo-top-bar').classList.remove('immersed');el('#solo-toolbar').classList.remove('immersed');el('#solo-exit-immerse').classList.add('hidden');});
soloCanvas.addEventListener('click',function(e){if(!soloImmersed)return;el('#solo-top-bar').classList.remove('immersed');el('#solo-toolbar').classList.remove('immersed');el('#solo-exit-immerse').classList.remove('hidden');clearTimeout(soloImmersedTimeout);soloImmersedTimeout=setTimeout(function(){if(soloImmersed){el('#solo-top-bar').classList.add('immersed');el('#solo-toolbar').classList.add('immersed');}},2000);});

// entry/exit
soloModeBtn.addEventListener('click',function(){lobbyScreen.classList.remove('active');soloScreen.classList.add('active');soloStrokes=[];soloUndoStack=[];soloCamX=0;soloCamY=0;soloCamZoom=1;soloImmersed=false;soloToolbarCollapsed=false;el('#solo-top-bar').classList.remove('immersed');el('#solo-toolbar').classList.remove('immersed','collapsed');el('#solo-exit-immerse').classList.add('hidden');el('#solo-toggle-toolbar').textContent='▼';initSoloCanvas();updateUndoRedoBtns();updateZoomBadge();});
soloBackBtn.addEventListener('click',function(){soloScreen.classList.remove('active');lobbyScreen.classList.add('active');soloIsPanMode=false;soloPanBtn.classList.remove('active');});
window.addEventListener('resize',function(){if(soloScreen.classList.contains('active'))initSoloCanvas();});
window.addEventListener('orientationchange',function(){if(soloScreen.classList.contains('active'))setTimeout(initSoloCanvas,300);});

console.log('🎨 你画我猜 v2 - 前端就绪');
