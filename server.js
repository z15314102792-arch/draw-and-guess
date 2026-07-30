const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const wordData = require('./words.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e6, // 5MB max message size (for canvas snapshots)
});

app.use(express.static(path.join(__dirname, 'public')));

// ============ 词库处理 ============
const allWords = [...wordData.easy, ...wordData.medium, ...wordData.hard];

/** 随机抽取 n 个不重复的词语，speed 模式只用简单词 */
function pickWords(n = 3, mode = 'classic') {
  const pool = mode === 'speed' ? [...wordData.easy] : [...allWords];
  const result = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return result;
}

/** 生成 4 位房间号 */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ============ 房间存储 ============
const rooms = {};

// ============ 辅助函数 ============
function getRoom(roomId) {
  return rooms[roomId] || null;
}

function getPlayer(room, playerId) {
  return room.players.find(p => p.id === playerId) || null;
}

/** 计算猜词得分：越快分越高，基础 100 分按剩余时间比例加成 */
function calculateGuessScore(timeRemaining, totalTime) {
  const ratio = timeRemaining / totalTime;
  return Math.round(100 * (0.3 + 0.7 * ratio));
}

/** 计算画家得分：每个猜对者给 50 分 */
function calculateDrawerScore(correctGuessers) {
  return correctGuessers.length * 50;
}

/** 清理房间定时器 */
function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    clearInterval(room.countdownInterval);
    room.timer = null;
    room.countdownInterval = null;
  }
}

// ============ Socket.IO 事件处理 ============
io.on('connection', (socket) => {
  console.log(`[连接] ${socket.id}`);

  // ---------- 创建房间 ----------
  socket.on('create-room', ({ playerName }) => {
    const roomId = generateRoomCode();
    // 确保不重复
    if (rooms[roomId]) {
      socket.emit('error', { message: '房间创建失败，请重试' });
      return;
    }

    rooms[roomId] = {
      id: roomId,
      players: [],
      status: 'waiting',     // waiting | word-select | drawing | reveal | game-over
      mode: 'classic',       // classic | speed | blind
      drawerIndex: 0,
      currentWord: '',
      currentOptions: [],
      round: 0,
      totalRounds: 0,        // 玩家到齐后设定 = 玩家数 × 2
      correctGuessers: [],   // 当前回合猜对的人
      timeRemaining: 0,
      totalTime: 60,         // 每回合秒数（speed 模式为 30）
      createdAt: Date.now(),
      timer: null,
      countdownInterval: null,
    };

    const player = {
      id: socket.id,
      name: playerName || '玩家',
      score: 0,
      isHost: true,
      isDrawer: false,
      connected: true,
    };

    rooms[roomId].players.push(player);
    socket.join(roomId);

    // 存储到 socket 上方便断线处理
    socket.data.roomId = roomId;
    socket.data.playerId = socket.id;

    const serverUrl = SERVER_URL;

    socket.emit('room-created', { roomId, players: rooms[roomId].players, serverUrl });
    io.to(roomId).emit('chat-message', {
      type: 'system',
      message: `${player.name} 创建了房间`,
    });

    console.log(`[房间] ${roomId} 由 ${player.name} 创建`);
  });

  // ---------- 加入房间 ----------
  socket.on('join-room', ({ roomId, playerName }) => {
    // 大小写不敏感
    const normalizedId = roomId.trim().toUpperCase();
    const room = getRoom(normalizedId);
    if (!room) {
      socket.emit('error', { message: '房间不存在' });
      return;
    }

    const player = {
      id: socket.id,
      name: playerName || '玩家',
      score: 0,
      isHost: false,
      isDrawer: false,
      connected: true,
    };

    room.players.push(player);
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.playerId = socket.id;

    socket.emit('room-joined', {
      roomId: room.id,
      players: room.players,
      status: room.status,
      currentDrawer: room.status !== 'waiting' ? room.players[room.drawerIndex]?.name : null,
      round: room.round,
      totalRounds: room.totalRounds,
      scoreboard: room.players.map(p => ({ name: p.name, score: p.score })),
      serverUrl: SERVER_URL,
    });

    // 如果正在绘画中，请求当前画布快照发给新玩家
    if (room.status === 'drawing') {
      const drawer = room.players[room.drawerIndex];
      if (drawer) {
        // 向画家请求快照
        io.to(drawer.id).emit('request-canvas-snapshot', { forPlayer: socket.id });
      }
    }

    // 广播玩家列表更新
    io.to(room.id).emit('players-update', {
      players: room.players.map(p => ({
        id: p.id, name: p.name, score: p.score,
        isHost: p.isHost, isDrawer: p.isDrawer, connected: p.connected,
      })),
    });

    io.to(room.id).emit('chat-message', {
      type: 'system',
      message: `${player.name} 加入了房间`,
    });

    console.log(`[房间] ${player.name} 加入了 ${room.id}`);
  });

  // ---------- 切换模式（仅房主，等待阶段）----------
  socket.on('set-mode', ({ mode }) => {
    const room = getRoom(socket.data.roomId);
    if (!room || room.status !== 'waiting') return;
    const player = getPlayer(room, socket.id);
    if (!player || !player.isHost) return;
    if (!['classic', 'speed', 'blind'].includes(mode)) return;

    room.mode = mode;
    const modeNames = { classic: '经典模式', speed: '快速模式(30秒)', blind: '盲画模式' };
    io.to(room.id).emit('mode-changed', { mode, modeName: modeNames[mode] });
    io.to(room.id).emit('chat-message', {
      type: 'system',
      message: `🎯 模式切换为：${modeNames[mode]}`,
    });
  });

  // ---------- 开始游戏 ----------
  socket.on('start-game', () => {
    const room = getRoom(socket.data.roomId);
    if (!room) return;

    const player = getPlayer(room, socket.id);
    if (!player || !player.isHost) {
      socket.emit('error', { message: '只有房主可以开始游戏' });
      return;
    }

    const connectedPlayers = room.players.filter(p => p.connected);
    if (connectedPlayers.length < 2) {
      socket.emit('error', { message: '至少需要 2 名玩家' });
      return;
    }

    // 根据模式设定参数
    if (room.mode === 'speed') {
      room.totalTime = 30;
    } else {
      room.totalTime = 60;
    }

    // 初始化游戏
    room.status = 'waiting';
    room.round = 0;
    room.totalRounds = connectedPlayers.length * 2;
    room.drawerIndex = -1;
    room.players.forEach(p => { p.score = 0; p.isDrawer = false; });

    const modeNames = { classic: '经典模式', speed: '快速模式', blind: '盲画模式' };
    io.to(room.id).emit('game-started', {
      totalRounds: room.totalRounds,
      mode: room.mode,
      players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    });

    io.to(room.id).emit('chat-message', {
      type: 'system',
      message: `🎮 游戏开始！${modeNames[room.mode]} · 共 ${room.totalRounds} 轮`,
    });

    console.log(`[游戏] ${room.id} 游戏开始`);
    startNextRound(room);
  });

  // ---------- 选词 ----------
  socket.on('word-select', ({ word }) => {
    const room = getRoom(socket.data.roomId);
    if (!room || room.status !== 'word-select') return;

    const player = getPlayer(room, socket.id);
    if (!player || !player.isDrawer) return;

    room.currentWord = word;
    room.status = 'drawing';

    clearRoomTimer(room);

    // 通知画家开始
    io.to(socket.id).emit('round-drawing', {
      word,
      time: room.totalTime,
      mode: room.mode,             // blind 模式前端需要知道
    });

    // 通知猜者（不显示词，显示字数）
    const wordLengthHint = word.length <= 4 ? `${word.length}个字` : `${word.length}个字/字母`;
    socket.to(room.id).emit('round-drawing', {
      word: word.replace(/./g, '＿'),
      time: room.totalTime,
      hint: wordLengthHint,
      mode: room.mode,
    });

    // 每回合重置猜对者列表
    room.correctGuessers = [];
    room.timeRemaining = room.totalTime;

    // 启动倒计时
    room.countdownInterval = setInterval(() => {
      room.timeRemaining--;
      io.to(room.id).emit('timer-update', { timeRemaining: room.timeRemaining });

      if (room.timeRemaining <= 0) {
        endRound(room);
      }
    }, 1000);

    io.to(room.id).emit('chat-message', {
      type: 'system',
      message: `🎨 ${player.name} 开始作画！提示：${wordLengthHint}`,
    });

    console.log(`[游戏] ${room.id} 画家选了词: ${word}`);
  });

  // ---------- 画板同步 ----------
  socket.on('draw', (data) => {
    const room = getRoom(socket.data.roomId);
    if (!room) return;
    if (room.status !== 'drawing' && room.status !== 'waiting') return;

    const player = getPlayer(room, socket.id);
    if (!player) return;

    // 等待阶段：任何人都可以涂鸦；绘画阶段：只有画家可以画
    if (room.status === 'drawing' && !player.isDrawer) return;

    // 广播给房间内除发送者外的所有人
    socket.to(room.id).emit('sync-draw', data);
  });

  // ---------- 清屏 ----------
  socket.on('clear-canvas', () => {
    const room = getRoom(socket.data.roomId);
    if (!room) return;
    if (room.status !== 'drawing' && room.status !== 'waiting') return;

    const player = getPlayer(room, socket.id);
    if (!player) return;
    if (room.status === 'drawing' && !player.isDrawer) return;

    socket.to(room.id).emit('sync-clear');
  });

  // ---------- 画布快照（新玩家加入时）----------
  socket.on('canvas-snapshot', ({ imageData, forPlayer }) => {
    if (forPlayer) {
      io.to(forPlayer).emit('sync-snapshot', { imageData });
    }
  });

  // ---------- 猜词 ----------
  socket.on('guess', ({ message }) => {
    const room = getRoom(socket.data.roomId);
    if (!room || room.status !== 'drawing') {
      socket.emit('chat-message', {
        type: 'self',
        message,
        from: getPlayer(room, socket.id)?.name || '未知',
      });
      return;
    }

    const player = getPlayer(room, socket.id);
    if (!player) return;
    if (player.isDrawer) return; // 画家不能猜

    const trimmedMsg = message.trim();

    // 检查是否已猜对
    if (room.correctGuessers.find(g => g.id === player.id)) {
      socket.emit('chat-message', {
        type: 'self',
        message: trimmedMsg,
        from: player.name,
      });
      return;
    }

    // 答案判定（忽略大小写和首尾空格）
    const isCorrect = trimmedMsg === room.currentWord ||
      trimmedMsg.toLowerCase() === room.currentWord.toLowerCase();

    if (isCorrect) {
      const guessScore = calculateGuessScore(room.timeRemaining, room.totalTime);
      player.score += guessScore;
      room.correctGuessers.push({ id: player.id, name: player.name });

      // 告知猜者猜对了
      socket.emit('guess-result', { correct: true, score: guessScore });

      // 广播有人猜对了
      io.to(room.id).emit('chat-message', {
        type: 'correct',
        message: `🎉 ${player.name} 猜对了！+${guessScore}分`,
      });

      // 给画家加分（每猜对一人 +50）
      const drawer = room.players[room.drawerIndex];
      if (drawer) {
        drawer.score += 50;
      }
      // 实时更新排行榜
      io.to(room.id).emit('scoreboard-update', {
        scoreboard: room.players.map(p => ({ name: p.name, score: p.score })),
      });

      // 检查是否所有人都猜对了
      const guessers = room.players.filter(p => !p.isDrawer && p.connected);
      if (room.correctGuessers.length >= guessers.length) {
        io.to(room.id).emit('chat-message', {
          type: 'system',
          message: '🏆 所有人都猜对了！提前结束回合',
        });
        endRound(room);
      }
    } else {
      // 错误猜测 → 广播为普通聊天
      io.to(room.id).emit('chat-message', {
        type: 'guess',
        message: trimmedMsg,
        from: player.name,
      });

      // 模糊匹配提示
      const similarity = getSimilarity(trimmedMsg, room.currentWord);
      if (similarity > 0.6) {
        socket.emit('guess-result', { correct: false, hint: '很接近了！' });
      }
    }
  });

  // ---------- 聊天消息（非猜词）----------
  socket.on('chat', ({ message }) => {
    const room = getRoom(socket.data.roomId);
    const player = room ? getPlayer(room, socket.id) : null;
    io.to(socket.data.roomId).emit('chat-message', {
      type: 'chat',
      message: message.trim(),
      from: player?.name || '未知',
    });
  });

  // ---------- 断开连接 ----------
  socket.on('disconnect', () => {
    const room = getRoom(socket.data.roomId);
    if (!room) return;

    const player = getPlayer(room, socket.id);
    if (!player) return;

    console.log(`[断开] ${player.name} 离开了 ${room.id}`);

    // 如果还在等待阶段，直接移除
    if (room.status === 'waiting') {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        // 空房间清理
        clearRoomTimer(room);
        delete rooms[room.id];
        console.log(`[清理] 房间 ${room.id} 已删除`);
        return;
      }
      // 重新分配房主
      if (player.isHost && room.players.length > 0) {
        room.players[0].isHost = true;
      }
    } else {
      // 游戏中：标记为断线
      player.connected = false;

      // 如果画家断线，结束当前回合
      if (player.isDrawer) {
        io.to(room.id).emit('chat-message', {
          type: 'system',
          message: `⚠️ 画家 ${player.name} 断线了，回合结束`,
        });
        endRound(room);
      }

      // 检查是否还有足够玩家（至少2个在线）
      const connectedPlayers = room.players.filter(p => p.connected);
      if (connectedPlayers.length < 2) {
        io.to(room.id).emit('chat-message', {
          type: 'system',
          message: '⚠️ 玩家不足，游戏暂停。等待玩家加入...',
        });
        if (room.status === 'drawing' || room.status === 'word-select') {
          endRound(room);
        }
        room.status = 'waiting';
      }
    }

    io.to(room.id).emit('players-update', {
      players: room.players.map(p => ({
        id: p.id, name: p.name, score: p.score,
        isHost: p.isHost, isDrawer: p.isDrawer, connected: p.connected,
      })),
    });

    io.to(room.id).emit('chat-message', {
      type: 'system',
      message: `${player.name} 离开了房间`,
    });
  });

  // ---------- 再来一局 ----------
  socket.on('play-again', () => {
    const room = getRoom(socket.data.roomId);
    if (!room) return;

    const player = getPlayer(room, socket.id);
    if (!player || !player.isHost) return;

    // 断开连接的玩家清理掉
    room.players = room.players.filter(p => p.connected);
    room.status = 'waiting';
    room.round = 0;
    room.drawerIndex = -1;
    room.players.forEach(p => { p.score = 0; p.isDrawer = false; });
    room.totalRounds = room.players.length * 2;

    io.to(room.id).emit('game-started', {
      totalRounds: room.totalRounds,
      players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    });

    io.to(room.id).emit('chat-message', {
      type: 'system',
      message: '🔄 再来一局！',
    });

    startNextRound(room);
  });
});

// ============ 游戏流程函数 ============

/** 字符串相似度（简单的包含/字符重叠判断） */
function getSimilarity(a, b) {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  let matches = 0;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  for (const char of shorter) {
    if (longer.includes(char)) matches++;
  }
  return matches / longer.length;
}

/** 开始下一轮 */
function startNextRound(room) {
  clearRoomTimer(room);

  // 清理断线玩家
  const connectedPlayers = room.players.filter(p => p.connected);
  if (connectedPlayers.length < 2) {
    room.status = 'waiting';
    io.to(room.id).emit('chat-message', {
      type: 'system',
      message: '⚠️ 玩家不足，等待更多玩家加入...',
    });
    return;
  }

  room.round++;

  // 检查游戏是否结束
  if (room.round > room.totalRounds) {
    endGame(room);
    return;
  }

  // 轮换画家：按顺序轮流
  room.drawerIndex = (room.drawerIndex + 1) % room.players.length;
  // 跳过断线玩家
  while (!room.players[room.drawerIndex].connected) {
    room.drawerIndex = (room.drawerIndex + 1) % room.players.length;
  }

  // 更新画家标记
  room.players.forEach(p => { p.isDrawer = false; });
  room.players[room.drawerIndex].isDrawer = true;

  const drawer = room.players[room.drawerIndex];

  // 选词阶段
  room.status = 'word-select';
  room.currentWord = '';
  room.currentOptions = pickWords(3, room.mode);
  room.correctGuessers = [];

  io.to(room.id).emit('round-word-select', {
    round: room.round,
    totalRounds: room.totalRounds,
    drawerId: drawer.id,
    drawerName: drawer.name,
    options: room.currentOptions,       // 只发给画家
    optionsForOthers: ['???', '???', '???'],
    timeout: 15,
  });

  // 单独给画家发可选词
  io.to(drawer.id).emit('your-word-options', {
    options: room.currentOptions,
    timeout: 15,
  });

  io.to(room.id).emit('scoreboard-update', {
    scoreboard: room.players.map(p => ({ name: p.name, score: p.score })),
  });

  io.to(room.id).emit('chat-message', {
    type: 'system',
    message: `📝 第 ${room.round}/${room.totalRounds} 轮 — ${drawer.name} 正在选词...`,
  });

  // 15秒选词超时
  room.timer = setTimeout(() => {
    if (room.status === 'word-select') {
      // 自动随机选一个
      const autoWord = room.currentOptions[Math.floor(Math.random() * room.currentOptions.length)];
      room.currentWord = autoWord;
      beginDrawing(room, drawer);
    }
  }, 15000);

  console.log(`[回合] ${room.id} 第${room.round}轮 画家: ${drawer.name} 选项: ${room.currentOptions.join(', ')}`);
}

/** 选完词开始绘画 */
function beginDrawing(room, drawer) {
  clearRoomTimer(room);
  room.status = 'drawing';
  room.timeRemaining = room.totalTime;
  room.correctGuessers = [];

  const wordLengthHint = room.currentWord.length <= 4
    ? `${room.currentWord.length}个字`
    : `${room.currentWord.length}个字/字母`;

  io.to(drawer.id).emit('round-drawing', {
    word: room.currentWord,
    time: room.totalTime,
    mode: room.mode,
  });

  io.to(room.id).except(drawer.id).emit('round-drawing', {
    word: room.currentWord.replace(/./g, '＿'),
    time: room.totalTime,
    hint: wordLengthHint,
    mode: room.mode,
  });

  io.to(room.id).emit('chat-message', {
    type: 'system',
    message: `🎨 ${drawer.name} 开始作画！提示：${wordLengthHint}`,
  });

  // 倒计时
  room.countdownInterval = setInterval(() => {
    room.timeRemaining--;
    io.to(room.id).emit('timer-update', { timeRemaining: room.timeRemaining });

    if (room.timeRemaining <= 0) {
      endRound(room);
    }
  }, 1000);
}

/** 结束当前回合 */
function endRound(room) {
  clearRoomTimer(room);

  if (room.status !== 'drawing') return;

  room.status = 'reveal';

  // 注意：画家分数已在 guess 事件中实时累加，这里不再重复加
  const drawer = room.players[room.drawerIndex];

  io.to(room.id).emit('round-end', {
    word: room.currentWord,
    correctGuessers: room.correctGuessers.map(g => g.name),
    drawerName: drawer.name,
    scoreboard: room.players.map(p => ({ name: p.name, score: p.score })),
  });

  io.to(room.id).emit('chat-message', {
    type: 'system',
    message: `⏰ 时间到！答案是「${room.currentWord}」`,
  });

  if (room.correctGuessers.length > 0) {
    io.to(room.id).emit('chat-message', {
      type: 'system',
      message: `🎉 猜对的人：${room.correctGuessers.map(g => g.name).join('、')}`,
    });
  } else {
    io.to(room.id).emit('chat-message', {
      type: 'system',
      message: '😢 没有人猜对...',
    });
  }

  // 5秒后进入下一轮
  room.timer = setTimeout(() => {
    startNextRound(room);
  }, 5000);

  console.log(`[回合结束] ${room.id} 词: ${room.currentWord} 猜对: ${room.correctGuessers.length}人`);
}

/** 结束游戏 */
function endGame(room) {
  clearRoomTimer(room);
  room.status = 'game-over';

  // 排名
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];

  io.to(room.id).emit('game-over', {
    winner: { name: winner.name, score: winner.score },
    scoreboard: sorted.map(p => ({ name: p.name, score: p.score })),
  });

  io.to(room.id).emit('chat-message', {
    type: 'system',
    message: `🏆 游戏结束！${winner.name} 获胜！(${winner.score}分)`,
  });

  console.log(`[游戏结束] ${room.id} 赢家: ${winner.name}`);
}

// ============ 定期清理僵尸房间 ============
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  for (const [id, room] of Object.entries(rooms)) {
    if (room.players.length === 0 && now - room.createdAt > oneHour) {
      clearRoomTimer(room);
      delete rooms[id];
      console.log(`[清理] 僵尸房间 ${id} 已删除`);
    }
  }
}, 30 * 60 * 1000);

// ============ 获取本机局域网 IP ============
function getLocalIP() {
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return 'localhost';
}
const LOCAL_IP = getLocalIP();
const PORT = process.env.PORT || 3000;
const SERVER_URL = LOCAL_IP !== 'localhost'
  ? `http://${LOCAL_IP}:${PORT}`
  : `http://localhost:${PORT}`;

// ============ 启动服务器 ============
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║        🎨 你画我猜 游戏服务器             ║
║                                          ║
║   本机访问: http://localhost:${PORT}         ║
║   手机访问: http://${LOCAL_IP}:${PORT}     ║
║                                          ║
║   分享上面「手机访问」地址给朋友即可！      ║
╚══════════════════════════════════════════╝
  `);
});
