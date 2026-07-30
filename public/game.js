/**
 * 你画我猜 - 前端游戏逻辑
 * 处理 Socket 通信、Canvas 绘图、UI 状态切换
 */

// ============ DOM 元素缓存 ============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// 屏幕
const lobbyScreen = $('#lobby-screen');
const gameScreen = $('#game-screen');

// Lobby
const nicknameInput = $('#nickname-input');
const createRoomBtn = $('#create-room-btn');
const roomCodeInput = $('#room-code-input');
const joinRoomBtn = $('#join-room-btn');

// 游戏 UI
const roomCodeDisplay = $('#room-code-display');
const roundInfo = $('#round-info');
const timerDisplay = $('#timer-display');
const drawCanvas = $('#draw-canvas');
const ctx = drawCanvas.getContext('2d');

// 选词
const wordSelectPanel = $('#word-select-panel');
const wordOptions = $('#word-options');
const wordSelectCountdown = $('#word-select-countdown');

// 提示
const wordHintBar = $('#word-hint-bar');
const wordHintText = $('#word-hint-text');

// 工具栏
const toolbar = $('#toolbar');

// 聊天/猜词
const chatMessages = $('#chat-messages');
const guessBar = $('#guess-bar');
const guessInput = $('#guess-input');
const sendGuessBtn = $('#send-guess-btn');
const startGameBtn = $('#start-game-btn');
const playAgainBtn = $('#play-again-btn');

// 玩家面板
const playersPanel = $('#players-panel');
const playerList = $('#player-list');
const togglePlayersBtn = $('#toggle-players-btn');
const showPlayersBtn = $('#show-players-btn');

// 弹窗
const scorePopup = $('#score-popup');
const scoreTitle = $('#score-title');
const scoreBody = $('#score-body');
const scoreCloseBtn = $('#score-close-btn');
const toast = $('#toast');
const wechatTip = $('#wechat-tip');
const wechatGotIt = $('#wechat-got-it');
const wechatCopyBtn = $('#wechat-copy-btn');
const wechatUrlEl = $('#wechat-url');

// 等待房间
const waitingPanel = $('#waiting-panel');
const roomCodeBig = $('#room-code-big');
const copyRoomBtn = $('#copy-room-btn');
const shareRoomBtn = $('#share-room-btn');
const waitingStatusText = $('#waiting-status-text');
const waitingPlayerCount = $('#waiting-player-count');

// ============ 全局状态 ============
let socket = null;
let roomId = '';
let playerName = '';
let myPlayerId = '';
let isDrawer = false;
let isHost = false;
let gameStatus = 'lobby'; // lobby | waiting | word-select | drawing | reveal | game-over
let gameMode = 'classic'; // classic | speed | blind
let serverUrl = '';       // 服务端返回的可访问 URL（非 localhost）
let currentColor = '#000000';
let currentLineWidth = 3;
let currentTool = 'pen'; // pen | eraser
let drawTimeout = null;
let wordSelectTimer = null;
// 盲画模式：离屏 canvas 存储真实笔迹
let offscreenCanvas = null;
let offscreenCtx = null;

// ============ Socket 连接 ============
function connectSocket() {
  socket = io({
    transports: ['websocket', 'polling'],
  });

  // --- 房间事件 ---
  socket.on('room-created', ({ roomId: rid, players, serverUrl: sUrl }) => {
    roomId = rid;
    myPlayerId = socket.id;
    isHost = true;
    gameStatus = 'waiting';
    // 云端部署时 serverUrl 是内网 IP，用当前页面地址替代
    if (sUrl && !sUrl.includes('localhost') && !sUrl.match(/\/\/10\.|172\./)) serverUrl = sUrl;
    else serverUrl = window.location.origin;
    updatePlayerList(players);
    switchToGameScreen();
    updateWaitingPlayerCount(players);
    addChatMessage('system', `✅ 房间创建成功！房间号：${rid}`);
    if (serverUrl) addChatMessage('system', `📱 手机访问：${serverUrl}?room=${rid}`);
  });

  socket.on('room-joined', (data) => {
    roomId = data.roomId;
    myPlayerId = socket.id;
    isHost = data.players.find(p => p.id === socket.id)?.isHost || false;
    if (data.serverUrl) serverUrl = data.serverUrl;
    gameStatus = data.status;
    updatePlayerList(data.players);
    switchToGameScreen();

    if (gameStatus === 'waiting') {
      showWaitingPanel();
      updateWaitingPlayerCount(data.players);
      addChatMessage('system', `✅ 加入了房间 ${data.roomId}`);
    } else {
      // 加入了正在进行的游戏
      hideWaitingPanel();
      toolbar.classList.add('hidden');
      roundInfo.textContent = `第 ${data.round}/${data.totalRounds} 轮`;
      guessBar.classList.add('hidden');
      startGameBtn.classList.add('hidden');
      addChatMessage('system', `✅ 加入了房间 ${data.roomId}（观战中）`);
    }
  });

  socket.on('players-update', ({ players }) => {
    updatePlayerList(players);
    // 更新自己的状态
    const me = players.find(p => p.id === socket.id);
    if (me) {
      isHost = me.isHost;
      isDrawer = me.isDrawer;
    }
    // 更新等待面板
    if (gameStatus === 'waiting') {
      updateWaitingPlayerCount(players);
    }
  });

  // --- 游戏流程事件 ---
  socket.on('game-started', ({ totalRounds, players }) => {
    gameStatus = 'waiting';
    updatePlayerList(players);
    hideWaitingPanel();
    roundInfo.textContent = `准备开始`;
    timerDisplay.textContent = `⏱ --`;
    startGameBtn.classList.add('hidden');
    playAgainBtn.classList.add('hidden');
    clearCanvas();
    setDrawerMode(false);
    addChatMessage('system', `🎮 游戏开始！共 ${totalRounds} 轮`);
  });

  socket.on('round-word-select', ({ round, totalRounds, drawerId, drawerName, timeout }) => {
    gameStatus = 'word-select';
    hideWaitingPanel();
    toolbar.classList.add('hidden');
    roundInfo.textContent = `第 ${round}/${totalRounds} 轮`;
    clearCanvas();
    hideWordSelectPanel();
    wordHintBar.classList.add('hidden');
    guessBar.classList.add('hidden');
    startGameBtn.classList.add('hidden');

    if (drawerId === socket.id) {
      // 我是画家 → 等 your-word-options 事件
      setDrawerMode(true);
    } else {
      setDrawerMode(false);
      addChatMessage('system', `📝 ${drawerName} 正在选词...`);
    }
  });

  socket.on('your-word-options', ({ options, timeout }) => {
    gameStatus = 'word-select';
    showWordSelectPanel(options, timeout);
  });

  socket.on('round-drawing', ({ word, time, hint, mode }) => {
    gameStatus = 'drawing';
    if (mode) gameMode = mode;
    hideWordSelectPanel();
    wordHintBar.classList.add('hidden');
    clearCanvas();

    // 盲画模式：初始化离屏 canvas
    if (gameMode === 'blind' && isDrawer) {
      initOffscreenCanvas();
      clearCanvas(); // 屏上留白
    }

    if (isDrawer) {
      const modeLabel = gameMode === 'blind' ? '🙈 盲画' : gameMode === 'speed' ? '⚡ 快速' : '';
      wordHintBar.classList.remove('hidden');
      wordHintText.textContent = `🎨 画出：「${word}」${modeLabel ? ' [' + modeLabel + ']' : ''}`;
      toolbar.classList.remove('hidden');
      guessBar.classList.add('hidden');
    } else {
      const modeLabel = gameMode === 'blind' ? '🙈 盲画中...' : gameMode === 'speed' ? '⚡ 快速' : '';
      wordHintBar.classList.remove('hidden');
      wordHintText.textContent = `提示：${hint || word}${modeLabel ? ' ' + modeLabel : ''}`;
      toolbar.classList.add('hidden');
      guessBar.classList.remove('hidden');
      guessInput.focus();
    }

    updateTimer(time);
  });

  socket.on('timer-update', ({ timeRemaining }) => {
    updateTimer(timeRemaining);
  });

  // --- 画板同步 ---
  socket.on('sync-draw', (data) => {
    if (isDrawer) return; // 画家不需要回放自己的笔迹
    replayDrawData(data);
  });

  socket.on('sync-clear', () => {
    if (!isDrawer) clearCanvas();
  });

  socket.on('request-canvas-snapshot', ({ forPlayer }) => {
    if (isDrawer) {
      const imageData = drawCanvas.toDataURL('image/png');
      socket.emit('canvas-snapshot', { imageData, forPlayer });
    }
  });

  socket.on('sync-snapshot', ({ imageData }) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, drawCanvas.width, drawCanvas.height);
    };
    img.src = imageData;
  });

  // --- 猜词 ---
  socket.on('guess-result', ({ correct, score, hint }) => {
    if (correct) {
      // 猜对了！显示得分
      guessInput.disabled = true;
      guessInput.placeholder = `✅ 猜对了！+${score}分`;
      sendGuessBtn.disabled = true;
      setTimeout(() => {
        guessInput.disabled = false;
        guessInput.placeholder = '你已猜对，等待回合结束...';
        sendGuessBtn.disabled = true;
      }, 1500);
      showToast(`🎉 猜对了！+${score}分`);
    } else if (hint) {
      showToast(`💡 ${hint}`);
    }
  });

  // --- 聊天 ---
  socket.on('chat-message', (msg) => {
    addChatMessage(msg.type, msg.message, msg.from);
  });

  // --- 回合结束 ---
  socket.on('round-end', ({ word, correctGuessers, drawerName, scoreboard }) => {
    gameStatus = 'reveal';
    clearCountdown();
    timerDisplay.textContent = '⏱ --';
    toolbar.classList.add('hidden');
    guessBar.classList.add('hidden');
    wordHintBar.classList.add('hidden');

    // 盲画模式：揭示真实画作
    if (gameMode === 'blind' && isDrawer) {
      revealBlindCanvas();
      wordHintBar.classList.remove('hidden');
      wordHintText.textContent = `🙈 揭晓你的盲画作品：「${word}」`;
    }
    // 盲画模式的猜者也看到的画也需要揭示（他们看到的是正常的同步画，已经显示了）
    // 但猜者不知道是盲画，这里给个提示
    if (gameMode === 'blind' && !isDrawer) {
      wordHintBar.classList.remove('hidden');
      wordHintText.textContent = `🙈 这是画家的盲画作品：「${word}」`;
    }

    updateScoreboard(scoreboard);

    const title = correctGuessers.length > 0
      ? `🎉 答案揭晓：${word}`
      : `😢 答案揭晓：${word}`;

    scoreTitle.textContent = title;
    let body = `<p style="margin-bottom:8px;">画家：${drawerName}</p>`;
    if (correctGuessers.length > 0) {
      body += `<p style="color:var(--success);">猜对：${correctGuessers.join('、')}</p>`;
    } else {
      body += `<p style="color:var(--danger);">没有人猜对...</p>`;
    }
    body += `<div class="divider"></div>`;
    body += `<p class="muted">${scoreboard.length > 0 ? scoreboard.map((p,i) => `${i+1}.${p.name}:${p.score}分`).join(' | ') : ''}</p>`;
    scoreBody.innerHTML = body;
    scorePopup.classList.remove('hidden');
    scoreCloseBtn.onclick = () => scorePopup.classList.add('hidden');
  });

  socket.on('scoreboard-update', ({ scoreboard }) => {
    updateScoreboard(scoreboard);
  });

  // --- 模式切换 ---
  socket.on('mode-changed', ({ mode, modeName }) => {
    gameMode = mode;
    $$('.mode-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.mode-btn[data-mode="${mode}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    const descs = {
      classic: '经典模式：轮流画词猜词，60秒一回合',
      speed: '快速模式：30秒速画，只用简单词，紧张刺激',
      blind: '盲画模式：画的时候看不到自己在画什么，揭晓时笑翻全场',
    };
    if (modeDesc) modeDesc.textContent = descs[mode] || '';
    showToast(`🎯 ${modeName}`);
  });

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

    scoreTitle.textContent = `🏆 ${winner.name} 获胜！`;
    let body = '';
    scoreboard.forEach((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
      body += `<div class="score-row ${i === 0 ? 'winner' : ''}"><span>${medal} ${p.name}</span><span>${p.score} 分</span></div>`;
    });
    scoreBody.innerHTML = body;
    scorePopup.classList.remove('hidden');
    scoreCloseBtn.onclick = () => {
      scorePopup.classList.add('hidden');
      if (isHost) {
        playAgainBtn.classList.remove('hidden');
      }
    };

    addChatMessage('system', `🏆 游戏结束！${winner.name} 获胜 (${winner.score}分)`);
    if (isHost) {
      setTimeout(() => {
        playAgainBtn.classList.remove('hidden');
      }, 2000);
    }
  });

  // --- 错误 ---
  socket.on('error', ({ message }) => {
    showToast(`❌ ${message}`);
  });

  // --- 重连 ---
  socket.on('connect', () => {
    console.log('[Socket] 已连接');
  });

  socket.on('disconnect', () => {
    console.log('[Socket] 断开连接');
    showToast('⚠️ 连接断开，刷新页面重试');
  });
}

// ============ Canvas 绘图 ============
function resizeCanvas() {
  const area = $('#canvas-area');
  const maxWidth = Math.min(area.clientWidth - 16, 500);
  const maxHeight = Math.min(area.clientHeight - 80, 400);

  // 确保最小尺寸
  const width = Math.max(maxWidth, 280);
  const height = Math.max(maxHeight, 200);

  const dpr = window.devicePixelRatio || 1;

  // 保存当前画布内容
  const oldData = drawCanvas.toDataURL();

  drawCanvas.style.width = width + 'px';
  drawCanvas.style.height = height + 'px';
  drawCanvas.width = width * dpr;
  drawCanvas.height = height * dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  // 恢复画布（如果有内容的话）
  if (oldData && oldData !== 'data:,') {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
    };
    img.src = oldData;
  } else {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
  }
}

function clearCanvas() {
  const w = drawCanvas.style.width ? parseFloat(drawCanvas.style.width) : drawCanvas.width;
  const h = drawCanvas.style.height ? parseFloat(drawCanvas.style.height) : drawCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  // 同时清离屏 canvas
  if (offscreenCtx) {
    offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    offscreenCtx.fillStyle = '#FFFFFF';
    offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  }
}

/** 获取触摸/鼠标在 canvas 上的坐标（CSS 像素） */
function getCanvasPos(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
    // 归一化坐标 [0, 1]
    nx: (clientX - rect.left) / rect.width,
    ny: (clientY - rect.top) / rect.height,
  };
}

// 绘图状态
let isDrawing = false;
let lastPoint = null;

function startDraw(e) {
  if (gameStatus !== 'drawing' && gameStatus !== 'waiting') return;
  // 等待阶段任何人都能画；绘画阶段只有画家能画
  if (gameStatus === 'drawing' && !isDrawer) return;
  e.preventDefault();
  isDrawing = true;
  lastPoint = getCanvasPos(e);

  // 点一个点（用于单击画点）
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

/** 初始化离屏 Canvas（盲画模式用） */
function initOffscreenCanvas() {
  offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = drawCanvas.width;
  offscreenCanvas.height = drawCanvas.height;
  offscreenCtx = offscreenCanvas.getContext('2d');
  offscreenCtx.fillStyle = '#FFFFFF';
  offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
}

/** 盲画模式：揭示离屏 Canvas 到主画布 */
function revealBlindCanvas() {
  if (offscreenCanvas && offscreenCtx) {
    const w = drawCanvas.style.width ? parseFloat(drawCanvas.style.width) : drawCanvas.width;
    const h = drawCanvas.style.height ? parseFloat(drawCanvas.style.height) : drawCanvas.height;
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    ctx.drawImage(offscreenCanvas, 0, 0, w, h);
    offscreenCanvas = null;
    offscreenCtx = null;
  }
}

function drawDot(pos) {
  const targetCtx = (gameMode === 'blind' && isDrawer) ? offscreenCtx : ctx;
  if (!targetCtx) return;
  targetCtx.beginPath();
  targetCtx.fillStyle = currentTool === 'eraser' ? '#FFFFFF' : currentColor;
  targetCtx.arc(pos.x, pos.y, currentLineWidth / 2, 0, Math.PI * 2);
  targetCtx.fill();
}

function drawLine(from, to) {
  const targetCtx = (gameMode === 'blind' && isDrawer) ? offscreenCtx : ctx;
  if (!targetCtx) return;
  targetCtx.beginPath();
  targetCtx.moveTo(from.x, from.y);
  targetCtx.lineTo(to.x, to.y);
  targetCtx.strokeStyle = currentTool === 'eraser' ? '#FFFFFF' : currentColor;
  targetCtx.lineWidth = currentTool === 'eraser' ? currentLineWidth * 3 : currentLineWidth;
  targetCtx.lineCap = 'round';
  targetCtx.lineJoin = 'round';
  targetCtx.stroke();
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
  const w = drawCanvas.style.width ? parseFloat(drawCanvas.style.width) : drawCanvas.width;
  const h = drawCanvas.style.height ? parseFloat(drawCanvas.style.height) : drawCanvas.height;

  const x1 = data.x1 * w;
  const y1 = data.y1 * h;
  const x2 = data.x2 * w;
  const y2 = data.y2 * h;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = data.color;
  ctx.lineWidth = data.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// Canvas 事件绑定
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
    currentTool = 'pen';
    $('#tool-pen').classList.add('active');
    $('#tool-eraser').classList.remove('active');
  });
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
  // 等待阶段任何人都能清屏，绘画阶段只有画家能
  if (gameStatus === 'drawing' && !isDrawer) return;
  if (gameStatus !== 'drawing' && gameStatus !== 'waiting') return;
  clearCanvas();
  socket.emit('clear-canvas');
});

// ============ 聊天 & 猜词 ============
function sendGuess() {
  const msg = guessInput.value.trim();
  if (!msg) return;

  if (isDrawer || gameStatus !== 'drawing') {
    // 普通聊天
    socket.emit('chat', { message: msg });
  } else {
    // 猜词
    socket.emit('guess', { message: msg });
  }
  guessInput.value = '';
}

sendGuessBtn.addEventListener('click', sendGuess);
guessInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'done' || e.key === 'go') {
    e.preventDefault();
    sendGuess();
  }
});

// ============ Lobby 事件 ============
createRoomBtn.addEventListener('click', () => {
  const name = nicknameInput.value.trim() || '玩家';
  playerName = name;
  connectSocket();
  socket.on('connect', () => {
    socket.emit('create-room', { playerName: name });
  });
});

joinRoomBtn.addEventListener('click', () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    showToast('请输入房间号');
    return;
  }
  const name = nicknameInput.value.trim() || '玩家';
  playerName = name;
  connectSocket();
  socket.on('connect', () => {
    socket.emit('join-room', { roomId: code, playerName: name });
  });
});

// 回车加入房间
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    joinRoomBtn.click();
  }
});

// ============ 游戏流程触发 ============
startGameBtn.addEventListener('click', () => {
  socket.emit('start-game');
  startGameBtn.classList.add('hidden');
});

playAgainBtn.addEventListener('click', () => {
  socket.emit('play-again');
  playAgainBtn.classList.add('hidden');
});

// ============ 等待房间：复制 / 分享 ============
copyRoomBtn.addEventListener('click', () => {
  const baseUrl = serverUrl || window.location.origin;
  const url = `${baseUrl}?room=${roomId}`;
  const text = `来玩你画我猜！\n房间号：${roomId}\n链接：${url}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('✅ 已复制房间号和链接！');
    }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
});

shareRoomBtn.addEventListener('click', () => {
  const baseUrl = serverUrl || window.location.origin;
  const url = `${baseUrl}?room=${roomId}`;
  const text = `🎨 来玩你画我猜！房间号：${roomId}`;
  if (navigator.share) {
    navigator.share({ title: '你画我猜', text, url }).catch(() => {});
  } else {
    const shareText = `${text}\n${url}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText).then(() => {
        showToast('📤 链接已复制，发给朋友吧！');
      }).catch(() => fallbackCopy(shareText));
    } else {
      fallbackCopy(shareText);
    }
  }
});

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); showToast('✅ 已复制！'); } catch (e) { showToast('⚠️ 复制失败，请手动记下房间号'); }
  document.body.removeChild(ta);
}

// URL 参数：如果有 room，自动填入并加入房间
(function checkUrlRoom() {
  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get('room');
  if (roomFromUrl) {
    roomCodeInput.value = roomFromUrl.toUpperCase();
    // 自动生成昵称并加入房间（微信环境除外，等用户手动操作）
    if (!isWechatBrowser()) {
      const names = ['小明', '小红', '小刚', '阿花', '大壮', '豆豆', '乐乐', '小雪', '小龙', '菲菲'];
      nicknameInput.value = names[Math.floor(Math.random() * names.length)];
      // 等 socket 连接建立后自动加入
      setTimeout(() => {
        const code = roomCodeInput.value.trim().toUpperCase();
        if (code && !socket) {
          connectSocket();
          socket.on('connect', () => {
            socket.emit('join-room', { roomId: code, playerName: nicknameInput.value.trim() });
          });
        }
      }, 300);
    }
  }
})();

// ============ 玩家面板 ============
showPlayersBtn.addEventListener('click', () => {
  playersPanel.classList.add('open');
});
togglePlayersBtn.addEventListener('click', () => {
  playersPanel.classList.remove('open');
});

function updatePlayerList(players) {
  playerList.innerHTML = players.map(p => {
    let badges = '';
    if (p.isHost) badges += '<span class="badge badge-host">房主</span>';
    if (p.isDrawer) badges += '<span class="badge badge-drawing">绘画中</span>';
    if (!p.connected) badges += '<span class="badge badge-disconnected">离线</span>';
    return `
      <li class="player-item ${p.isDrawer ? 'current-drawer' : ''}">
        <span>${p.isDrawer ? '🎨' : '😊'} ${p.name}</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <span>${p.score}分</span>
          <span class="player-badges">${badges}</span>
        </span>
      </li>
    `;
  }).join('');

  // 同时在顶部显示
  const connected = players.filter(p => p.connected);
  $('#player-count-display')?.remove();
}

function updateScoreboard(scoreboard) {
  // 更新玩家列表中的分数
  const items = playerList.querySelectorAll('.player-item');
  items.forEach(item => {
    const nameEl = item.querySelector('span:first-child');
    const name = nameEl?.textContent?.replace(/^[🎨😊]\s*/, '') || '';
    const data = scoreboard.find(s => s.name === name);
    if (data) {
      const scoreSpan = item.querySelector('span:nth-child(2) > span:first-child');
      if (scoreSpan) {
        scoreSpan.textContent = `${data.score}分`;
      }
    }
  });
}

// ============ UI 辅助函数 ============
function switchToGameScreen() {
  lobbyScreen.classList.remove('active');
  gameScreen.classList.add('active');
  roomCodeDisplay.textContent = roomId;
  roomCodeBig.textContent = roomId;
  resizeCanvas();
  clearCanvas();
  showWaitingPanel();
}

/** 显示等待面板，允许自由涂鸦 */
function showWaitingPanel() {
  waitingPanel.classList.remove('hidden');
  toolbar.classList.remove('hidden');   // 等待时所有人都能画
  guessBar.classList.add('hidden');
  wordHintBar.classList.add('hidden');
  wordSelectPanel.classList.add('hidden');
  startGameBtn.classList.add('hidden');
  playAgainBtn.classList.add('hidden');
  timerDisplay.textContent = '⏱ --';
  roundInfo.textContent = '等待开始';
  isDrawer = false;  // 等待状态没有画家
  updateWaitingPanel();
}

/** 隐藏等待面板，进入游戏 */
function hideWaitingPanel() {
  waitingPanel.classList.add('hidden');
}

/** 更新等待面板信息 */
function updateWaitingPanel() {
  if (!waitingPanel || waitingPanel.classList.contains('hidden')) return;
  roomCodeBig.textContent = roomId;
  // 显示真实可访问地址
  const urlEl = document.getElementById('server-url-display');
  if (urlEl && serverUrl) {
    urlEl.textContent = `${serverUrl}?room=${roomId}`;
    urlEl.parentElement?.classList.remove('hidden');
  }
}

/** 根据玩家列表更新等待面板人数 */
function updateWaitingPlayerCount(players) {
  const connected = players.filter(p => p.connected);
  const count = connected.length;
  waitingPlayerCount.textContent = `当前 ${count} 人（至少需要 2 人）`;
  if (count >= 2) {
    waitingStatusText.textContent = '人数够了，房主可以开始游戏！';
    waitingPlayerCount.style.color = 'var(--success)';
    if (isHost) {
      startGameBtn.classList.remove('hidden');
      startGameBtn.textContent = '🎮 开始游戏';
    }
  } else {
    waitingStatusText.textContent = '等待好友加入...';
    waitingPlayerCount.style.color = 'var(--danger)';
    startGameBtn.classList.add('hidden');
  }
}

function showStartButton() {
  if (gameStatus === 'waiting') {
    startGameBtn.classList.remove('hidden');
    startGameBtn.textContent = '🎮 开始游戏';
  }
}

function setDrawerMode(drawer) {
  isDrawer = drawer;
  if (gameStatus === 'waiting') {
    // 等待阶段所有人可画
    toolbar.classList.remove('hidden');
    guessBar.classList.add('hidden');
    return;
  }
  if (drawer) {
    toolbar.classList.remove('hidden');
    guessBar.classList.add('hidden');
  } else {
    toolbar.classList.add('hidden');
    if (gameStatus === 'drawing') {
      guessBar.classList.remove('hidden');
    }
  }
}

function showWordSelectPanel(options, timeout) {
  wordSelectPanel.classList.remove('hidden');
  wordOptions.innerHTML = options.map(w =>
    `<button class="word-option">${w}</button>`
  ).join('');

  // 绑定选词
  wordOptions.querySelectorAll('.word-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const word = btn.textContent;
      socket.emit('word-select', { word });
      hideWordSelectPanel();
      clearInterval(wordSelectTimer);
    });
  });

  // 选词倒计时
  let remaining = timeout;
  wordSelectCountdown.textContent = remaining;
  clearInterval(wordSelectTimer);
  wordSelectTimer = setInterval(() => {
    remaining--;
    wordSelectCountdown.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(wordSelectTimer);
    }
  }, 1000);
}

function hideWordSelectPanel() {
  wordSelectPanel.classList.add('hidden');
  clearInterval(wordSelectTimer);
}

// 绘画阶段倒计时
let countdownInterval = null;
function startCountdown(time) {
  clearCountdown();
  updateTimer(time);
  countdownInterval = setInterval(() => {
    time--;
    updateTimer(time);
    if (time <= 0) {
      clearCountdown();
    }
  }, 1000);
}

function updateTimer(time) {
  timerDisplay.textContent = `⏱ ${time}`;
  if (time <= 10) {
    timerDisplay.classList.add('warning');
  } else {
    timerDisplay.classList.remove('warning');
  }
}

function clearCountdown() {
  clearInterval(countdownInterval);
  countdownInterval = null;
  timerDisplay.classList.remove('warning');
}

function addChatMessage(type, message, from) {
  const div = document.createElement('div');
  div.className = `chat-msg ${type}`;

  if (type === 'system') {
    div.textContent = message;
  } else if (type === 'correct') {
    div.textContent = message;
  } else if (type === 'guess' || type === 'chat' || type === 'self') {
    const fromSpan = document.createElement('span');
    fromSpan.className = 'msg-from';
    fromSpan.textContent = from + '：';
    div.appendChild(fromSpan);
    div.appendChild(document.createTextNode(message));
    if (type === 'self') {
      div.classList.add('self');
    }
  } else {
    div.textContent = message;
  }

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2000);
}

// ============ 微信浏览器检测 ============
function isWechatBrowser() {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('micromessenger');
}

if (isWechatBrowser()) {
  // 显示全屏引导页
  wechatTip.classList.remove('hidden');
  lobbyScreen.classList.add('hidden'); // 隐藏游戏 lobby

  // 显示当前 URL
  if (wechatUrlEl) {
    wechatUrlEl.textContent = window.location.href;
  }

  // 复制按钮
  if (wechatCopyBtn) {
    wechatCopyBtn.addEventListener('click', () => {
      const url = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          wechatCopyBtn.textContent = '✅ 已复制！去浏览器粘贴打开';
        }).catch(() => {
          wechatCopyBtn.textContent = '请长按上方链接手动复制';
        });
      } else {
        wechatCopyBtn.textContent = '请长按上方链接手动复制';
      }
    });
  }

  // "我已知晓"按钮 -> 仍然尝试在微信里用
  wechatGotIt.addEventListener('click', () => {
    wechatTip.classList.add('hidden');
    lobbyScreen.classList.add('active');
  });
}

// ============ 窗口大小调整 ============
window.addEventListener('resize', () => {
  resizeCanvas();
});

// 监听屏幕旋转（移动端）
window.addEventListener('orientationchange', () => {
  setTimeout(resizeCanvas, 300);
});

// ============ 初始设置 ============
function init() {
  // 随机昵称
  const names = ['小明', '小红', '小刚', '阿花', '大壮', '豆豆', '乐乐', '小雪', '小龙', '菲菲'];
  nicknameInput.value = names[Math.floor(Math.random() * names.length)];
}

init();

// ============ 模式选择器按钮（DOM 加载后绑定）============
const modeDesc = $('#mode-desc');
$$('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!isHost || gameStatus !== 'waiting') {
      if (!isHost) showToast('只有房主可以切换模式');
      return;
    }
    const mode = btn.dataset.mode;
    socket.emit('set-mode', { mode });
  });
});

// 非房主禁用模式按钮（在玩家列表更新时处理）
const origUpdatePlayerList = updatePlayerList;
updatePlayerList = function(players) {
  origUpdatePlayerList(players);
  // 非房主禁用模式按钮
  $$('.mode-btn').forEach(b => {
    b.disabled = !isHost;
  });
};

console.log('🎨 你画我猜 - 前端就绪');
