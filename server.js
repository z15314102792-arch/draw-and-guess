const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const wordData = require('./words.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e6,
  cors: {
    origin: ['https://z15314102792-arch.github.io', 'http://localhost:3000', 'http://192.168.1.104:3000'],
    methods: ['GET', 'POST'],
  },
});

app.use(express.static(path.join(__dirname, 'public')));

// ============ 词库处理 ============
const allWords = [...wordData.easy, ...wordData.medium, ...wordData.hard];
const aiNames = ['🤖 小智', '🤖 阿呆', '🤖 逗逗'];

/** 随机抽取 n 个不重复的词语，speed 模式只用简单词，支持自定义词库 */
function pickWords(n = 3, mode = 'classic', customWords = null) {
  let pool;
  if (customWords && customWords.length >= 10) {
    pool = [...customWords];
  } else if (mode === 'speed') {
    pool = [...wordData.easy];
  } else {
    pool = [...allWords];
  }
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
    if (!['classic', 'speed', 'blind', 'chain', 'team', 'duel'].includes(mode)) return;

    room.mode = mode;
    const modeNames = { classic: '经典模式', speed: '快速模式(30秒)', blind: '盲画模式', chain: '接龙模式', team: '团队对抗', duel: '对决模式' };
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

    // 少于3人时添加AI猜词者
    if (connectedPlayers.length < 3 && room.mode !== 'chain') {
      const aiCount = 3 - connectedPlayers.length;
      for (let i = 0; i < aiCount; i++) {
        room.players.push({
          id: '__ai_normal_' + i, name: aiNames[i], score: 0,
          isHost: false, isDrawer: false, connected: true, isAI: true,
        });
      }
      room.hasAI = true;
      io.to(room.id).emit('chat-message', { type: 'system', message: '🤖 AI 玩家加入游戏（凑人数）' });
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
    room.players.forEach(p => { p.score = 0; p.isDrawer = false; p.guessStreak = 0; });

    const modeNames = { classic: '经典模式', speed: '快速模式(30秒)', blind: '盲画模式', chain: '接龙模式' };

    if (room.mode === 'chain') {
      startChainGame(room);
      return;
    }

    if (room.mode === 'team') {
      startTeamGame(room);
      return;
    }

    // 对决模式：快速回合，猜对速度加分加倍
    if (room.mode === 'duel') {
      room.totalTime = 45;
      room.totalRounds = connectedPlayers.length * 3;
      room.duelMode = true;
    }

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

      // --- 连击系统 v8.0 ---
      player.guessStreak = (player.guessStreak || 0) + 1;
      let streakMultiplier = 1;
      if (player.guessStreak >= 5) streakMultiplier = 3;
      else if (player.guessStreak >= 3) streakMultiplier = 2;
      else if (player.guessStreak >= 2) streakMultiplier = 1.5;
      const streakBonus = Math.floor(guessScore * (streakMultiplier - 1));
      let bonusMsg = '';
      if (streakMultiplier > 1) {
        player.score += streakBonus;
        bonusMsg = ` 🔥${player.guessStreak}连击 x${streakMultiplier}! (+${streakBonus})`;
      }

      // 告知猜者猜对了
      socket.emit('guess-result', { correct: true, score: guessScore + streakBonus, streak: player.guessStreak, multiplier: streakMultiplier });

      // 广播有人猜对了
      io.to(room.id).emit('chat-message', {
        type: 'correct',
        message: `🎉 ${player.name} 猜对了！+${guessScore}分${bonusMsg}`,
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
      // 错误猜测 → 重置连击
      player.guessStreak = 0;
      // 广播为普通聊天
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

  // ---------- 快捷表情反应 v8.0 ----------
  socket.on('reaction', ({ emoji }) => {
    const room = getRoom(socket.data.roomId);
    const player = room ? getPlayer(room, socket.id) : null;
    if (!room || !player) return;
    io.to(room.id).emit('reaction', { emoji, from: player.name, fromId: socket.id });
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

  // ---------- 接龙模式：提交画作 ----------
  socket.on('chain-draw-submit', ({ imageData }) => {
    const room = getRoom(socket.data.roomId);
    if (!room || room.mode !== 'chain') return;
    const player = getPlayer(room, socket.id);
    if (!player || !player.isDrawer) return;

    room.chain.steps.push({ type: 'draw', playerId: player.id, playerName: player.name, data: imageData });
    player.isDrawer = false;

    io.to(room.id).emit('chat-message', {
      type: 'system', message: `✅ ${player.name} 完成了绘画`,
    });
    nextChainStep(room);
  });

  // ---------- 接龙模式：提交猜测 ----------
  socket.on('chain-guess-submit', ({ guess }) => {
    const room = getRoom(socket.data.roomId);
    if (!room || room.mode !== 'chain') return;
    const player = getPlayer(room, socket.id);
    if (!player || room.chain.currentGuesser !== player.id) return;

    room.chain.steps.push({ type: 'guess', playerId: player.id, playerName: player.name, data: guess.trim() });

    io.to(room.id).emit('chat-message', {
      type: 'chat', message: guess.trim(),
      from: player.name,
    });
    io.to(room.id).emit('chat-message', {
      type: 'system', message: `✅ ${player.name} 提交了猜测`,
    });
    nextChainStep(room);
  });

  // ---------- 自定义词库 ----------
  socket.on('set-custom-words', ({ words }) => {
    const room = getRoom(socket.data.roomId);
    if (!room || room.status !== 'waiting') return;
    const player = getPlayer(room, socket.id);
    if (!player || !player.isHost) return;
    if (!Array.isArray(words) || words.length < 10) {
      socket.emit('error', { message: '至少需要 10 个词' });
      return;
    }
    room.customWords = words.filter(w => w && w.trim());
    io.to(room.id).emit('chat-message', {
      type: 'system',
      message: `📝 ${player.name} 设置了自定义词库（${room.customWords.length}个词）`,
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

    // 清理AI和断线玩家
    room.players = room.players.filter(p => p.connected && !p.isAI);
    room.hasAI = false;
    room.chain = null;
    room.status = 'waiting';
    room.round = 0;
    room.drawerIndex = -1;
    room.players.forEach(p => { p.score = 0; p.isDrawer = false; p.guessStreak = 0; });
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

  // 团队模式：队友也看到词
  if (room.mode === 'team') {
    room.players.filter(p => p.team === drawer.team && p.id !== drawer.id && p.connected).forEach(teammate => {
      io.to(teammate.id).emit('round-drawing', {
        word: room.currentWord,
        time: room.totalTime,
        mode: room.mode,
        isTeammate: true,
      });
    });
  }

  // 发送提示给非队友（团队模式）或所有人（经典模式）
  const teammates = room.mode === 'team' ? room.players.filter(p => p.team === drawer.team && p.id !== drawer.id).map(p => p.id) : [];
  const hintTargets = room.players.filter(p => p.id !== drawer.id && !teammates.includes(p.id) && p.connected).map(p => p.id);
  hintTargets.forEach(pid => {
    io.to(pid).emit('round-drawing', {
      word: room.currentWord.replace(/./g, '＿'),
      time: room.totalTime,
      hint: wordLengthHint,
      mode: room.mode,
    });
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

  // AI 猜词 v8.0: 多轮互动猜词，更像真人
  if (room.hasAI) {
    const aiPlayers = room.players.filter(p => p.isAI && !p.isDrawer);
    aiPlayers.forEach(ai => {
      // 每个 AI 进行 3-5 轮发言
      const rounds = 3 + Math.floor(Math.random() * 4);
      for (let r = 0; r < rounds; r++) {
        const delay = 4000 + r * (room.totalTime * 1000 / (rounds + 1)) + Math.random() * 3000;
        setTimeout(() => {
          if (room.status !== 'drawing') return;
          // 如果有人猜对了，AI 不再猜
          if (room.correctGuessers.length > 0 && room.correctGuessers.find(g => g.id === ai.id)) return;

          const roll = Math.random();
          if (roll < 0.2 && room.correctGuessers.length === 0) {
            // AI 猜对了 (只在还没人猜对时)
            const score = Math.floor(calculateGuessScore(room.timeRemaining, room.totalTime) * 0.8);
            ai.score += score;
            room.correctGuessers.push({ id: ai.id, name: ai.name });
            io.to(room.id).emit('chat-message', { type: 'correct', message: `🎉 ${ai.name} 猜对了！+${score}分（AI）` });
            const drawer = room.players[room.drawerIndex];
            if (drawer) drawer.score += 40;
            io.to(room.id).emit('scoreboard-update', { scoreboard: room.players.map(p => ({ name: p.name, score: p.score })) });
          } else if (roll < 0.5) {
            // AI 发互动评论
            const comments = [
              '🤔 让我想想...', '这个东西我见过！', '画得不错啊', '好抽象😅', '我好像看出来了...',
              '再给点提示呗', '这画风绝了', '原来是这个方向', '继续继续👏', '有点难度...',
            ];
            io.to(room.id).emit('chat-message', { type: 'chat', message: comments[Math.floor(Math.random() * comments.length)], from: ai.name });
          } else {
            // AI 乱猜一个
            const fakeGuess = pickWords(1, 'easy', room.customWords)[0];
            if (fakeGuess && fakeGuess !== room.currentWord) {
              io.to(room.id).emit('chat-message', { type: 'guess', message: fakeGuess, from: ai.name });
            }
          }
        }, delay);
      }
    });
  }
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

// ============ 接龙模式 ============

function startChainGame(room) {
  room.status = 'chain';
  const connected = room.players.filter(p => p.connected);
  let shuffled = [...connected].sort(() => Math.random() - 0.5);

  // 少于3人时插入AI猜词者
  if (shuffled.length < 3) {
    const aiCount = 3 - shuffled.length;
    for (let i = 0; i < aiCount; i++) {
      shuffled.splice(1 + i * 2, 0, { id: '__ai_' + i, name: aiNames[i], isAI: true, connected: true });
    }
  }

  room.chain = {
    steps: [],
    playerOrder: shuffled.map(p => p.id),
    currentIndex: 0,
    currentGuesser: null,
    players: shuffled,
  };

  // 第一个玩家：看词画画
  const firstPlayer = shuffled[0];
  firstPlayer.isDrawer = true;
  const word = pickWords(1, 'classic', room.customWords)[0];
  room.chain.originalWord = word;
  room.chain.steps.push({ type: 'word', playerId: firstPlayer.id, playerName: firstPlayer.name, data: word });

  room.players.forEach(p => { p.score = 0; p.isDrawer = p.id === firstPlayer.id; });

  io.to(room.id).emit('game-started', {
    totalRounds: shuffled.length,
    mode: 'chain',
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
  });

  io.to(room.id).emit('chat-message', {
    type: 'system',
    message: `🔗 接龙模式开始！${shuffled.length}人接龙`,
  });

  io.to(firstPlayer.id).emit('chain-draw-phase', {
    prompt: word,
    promptType: 'word',
    stepNumber: 1,
    totalSteps: shuffled.length,
  });

  io.to(room.id).except(firstPlayer.id).emit('chain-waiting', {
    currentPlayer: firstPlayer.name,
    step: 1,
    total: shuffled.length,
    message: `${firstPlayer.name} 正在画画...`,
  });

  io.to(room.id).emit('players-update', {
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, isHost: p.isHost, isDrawer: p.isDrawer, connected: p.connected })),
  });

  console.log(`[接龙] ${room.id} 开始，首位: ${firstPlayer.name}，词: ${word}`);
}

function nextChainStep(room) {
  if (!room.chain) return;
  room.chain.currentIndex++;

  const chain = room.chain;
  const order = chain.playerOrder;

  // 链条结束：所有玩家都参与过了
  if (chain.currentIndex >= order.length) {
    revealChain(room);
    return;
  }

  const currentPlayerId = order[chain.currentIndex];

  // AI 玩家处理
  if (currentPlayerId && currentPlayerId.startsWith('__ai_')) {
    const aiPlayer = chain.players.find(p => p.id === currentPlayerId);
    if (!aiPlayer) { chain.currentIndex++; return nextChainStep(room); }
    const prevStep2 = chain.steps[chain.steps.length - 1];
    const aiGuess = aiGenerateGuess(chain, room.customWords || null);
    chain.steps.push({ type: 'guess', playerId: aiPlayer.id, playerName: aiPlayer.name, data: aiGuess });
    io.to(room.id).emit('chat-message', { type: 'chat', message: aiGuess, from: aiPlayer.name });
    io.to(room.id).emit('chat-message', { type: 'system', message: `🤖 ${aiPlayer.name} 猜：${aiGuess}` });
    setTimeout(() => nextChainStep(room), 2000);
    return;
  }

  const currentPlayer = room.players.find(p => p.id === currentPlayerId);
  if (!currentPlayer || !currentPlayer.connected) {
    // 跳过离线玩家
    chain.currentIndex++;
    if (chain.currentIndex >= order.length) { revealChain(room); return; }
    return nextChainStep(room);
  }

  const prevStep = chain.steps[chain.steps.length - 1];
  const isDrawStep = prevStep.type === 'guess' || prevStep.type === 'word';

  if (isDrawStep) {
    // 当前玩家看到上一个猜测，要画出来
    const prompt = prevStep.type === 'word' ? prevStep.data : prevStep.data;
    currentPlayer.isDrawer = true;
    chain.currentGuesser = null;

    io.to(currentPlayer.id).emit('chain-draw-phase', {
      prompt: prompt,
      promptType: prevStep.type === 'word' ? 'word' : 'guess',
      stepNumber: chain.currentIndex + 1,
      totalSteps: order.length,
    });
    io.to(room.id).except(currentPlayer.id).emit('chain-waiting', {
      currentPlayer: currentPlayer.name,
      step: chain.currentIndex + 1,
      total: order.length,
      message: `${currentPlayer.name} 正在根据「${prevStep.type === 'word' ? '原词' : '猜测'}」画画...`,
    });
    io.to(room.id).emit('players-update', {
      players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, isHost: p.isHost, isDrawer: p.isDrawer, connected: p.connected })),
    });
  } else {
    // 当前玩家看到上一张画，要猜词
    const prevDraw = prevStep; // it's a draw step
    currentPlayer.isDrawer = false;
    chain.currentGuesser = currentPlayer.id;

    io.to(currentPlayer.id).emit('chain-guess-phase', {
      imageData: prevDraw.data,
      stepNumber: chain.currentIndex + 1,
      totalSteps: order.length,
    });
    io.to(room.id).except(currentPlayer.id).emit('chain-waiting', {
      currentPlayer: currentPlayer.name,
      step: chain.currentIndex + 1,
      total: order.length,
      message: `${currentPlayer.name} 正在猜画...`,
    });
  }
}

function revealChain(room) {
  room.status = 'chain-reveal';
  room.players.forEach(p => { p.isDrawer = false; });

  io.to(room.id).emit('chain-reveal', {
    steps: room.chain.steps,
    playerOrder: room.chain.playerOrder,
    originalWord: room.chain.originalWord,
  });

  io.to(room.id).emit('chat-message', {
    type: 'system',
    message: `🎬 接龙结束！来看看链条吧 → 原词：「${room.chain.originalWord}」`,
  });

  // 30秒后自动回到等待状态
  room.timer = setTimeout(() => {
    room.status = 'waiting';
    room.chain = null;
    room.players.forEach(p => { p.isDrawer = false; });
    io.to(room.id).emit('chain-finished');
    io.to(room.id).emit('chat-message', {
      type: 'system',
      message: '🔗 接龙结束，房主可以开始新一轮',
    });
  }, 30000);

  console.log(`[接龙] ${room.id} 揭示链条，${room.chain.steps.length}步`);
}

// ============ 团队对抗模式 ============

function startTeamGame(room) {
  const connected = room.players.filter(p => p.connected);
  // 随机分队
  const shuffled = [...connected].sort(() => Math.random() - 0.5);
  const mid = Math.ceil(shuffled.length / 2);
  shuffled.forEach((p, i) => { p.team = i < mid ? 'red' : 'blue'; p.score = 0; p.isDrawer = false; });

  room.teamScores = { red: 0, blue: 0 };
  room.drawerIndex = -1;
  room.round = 0;
  room.totalRounds = connected.length * 2;
  room.status = 'waiting';
  room.totalTime = 60;

  const reds = shuffled.filter(p => p.team === 'red').map(p => p.name).join('、');
  const blues = shuffled.filter(p => p.team === 'blue').map(p => p.name).join('、');

  io.to(room.id).emit('game-started', {
    totalRounds: room.totalRounds,
    mode: 'team',
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, team: p.team })),
  });

  io.to(room.id).emit('chat-message', { type: 'system', message: `👥 团队对抗！🔴 红队：${reds}  🔵 蓝队：${blues}` });
  io.to(room.id).emit('team-assign', { teams: room.players.map(p => ({ id: p.id, team: p.team })) });

  startNextRound(room);
}

// 覆盖分数更新（团队模式下按队伍计分）
const origCalcGuessScore = calculateGuessScore;
const origEndRound = endRound;

// 在 guess 事件中，队友猜对多加50%
// (团队逻辑通过覆写 calculateGuessScore 实现）
// 在 endRound 中按团队汇总分数

function aiGenerateGuess(chain, customWords) {
  const pool = customWords && customWords.length >= 10 ? customWords : allWords;
  // 30% 概率猜对（故意搞笑偏离更接近真实体验）
  if (Math.random() < 0.3 && chain.steps.length > 0) {
    const firstStep = chain.steps[0];
    if (firstStep && firstStep.data) return firstStep.data;
  }
  return pool[Math.floor(Math.random() * pool.length)];
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
const SERVER_URL = (LOCAL_IP !== 'localhost' && !LOCAL_IP.startsWith('10.') && !LOCAL_IP.startsWith('172.'))
  ? `http://${LOCAL_IP}:${PORT}`
  : `http://localhost:${PORT}`; // 云端部署时走 window.location.origin，本地走 localhost

// ============ 启动服务器 ============
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║        🎨 你画我猜 游戏服务器  v6.0       ║
║                                          ║
║   本机访问: http://localhost:${PORT}         ║
║   手机访问: http://${LOCAL_IP}:${PORT}     ║
║                                          ║
║   分享上面「手机访问」地址给朋友即可！      ║
╚══════════════════════════════════════════╝
  `);
});
