const { io } = require('socket.io-client');
const SERVER = 'https://draw-and-guess-production-2897.up.railway.app';

let passed = 0, failed = 0;
function t(cond, msg) {
  if (cond) { passed++; console.log('✅', msg); }
  else { failed++; console.log('❌', msg); }
}

async function test() {
  const p1 = io(SERVER, { transports: ['websocket'] });
  const p2 = io(SERVER, { transports: ['websocket'] });

  await new Promise(r => p1.on('connect', r));
  console.log('已连接 Railway 服务器');

  // 创建房间
  p1.emit('create-room', { playerName: '测试A' });
  const d = await new Promise(r => p1.on('room-created', r));
  t(!!d.roomId, '房间创建: ' + d.roomId);
  console.log('  serverUrl:', d.serverUrl || '(未返回)');

  // 加入房间
  await new Promise(r => p2.on('connect', r));
  p2.emit('join-room', { roomId: d.roomId, playerName: '测试B' });
  await new Promise(r => p2.on('room-joined', r));
  await new Promise(r => {
    p1.on('players-update', x => { if (x.players.length === 2) r(); });
  });
  t(true, '2人加入成功');

  // 模式切换
  p1.emit('set-mode', { mode: 'speed' });
  const mc = await new Promise(r => p1.on('mode-changed', r));
  t(mc.mode === 'speed', '快速模式切换');

  // 开始游戏
  p1.emit('start-game');
  const gs = await new Promise(r => p1.on('game-started', r));
  t(gs.totalRounds === 4, '游戏开始 回合=' + gs.totalRounds);

  // 选词
  const opts = await new Promise(r => p1.on('your-word-options', r));
  t(opts.options.length === 3, '选3词: ' + opts.options.join(','));
  p1.emit('word-select', { word: opts.options[0] });

  // 绘画
  const draw = await new Promise(r => p1.on('round-drawing', r));
  t(draw.time === 30, '快速模式30秒');
  t(draw.word === opts.options[0], '画家看到正确词语');

  // 画板同步
  p1.emit('draw', { x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, color: '#000', lineWidth: 3, tool: 'pen' });
  const sync = await new Promise(r => p2.on('sync-draw', r));
  t(sync.x1 === 0.1, '画板同步正常');

  // 猜词
  p2.emit('guess', { message: opts.options[0] });
  const result = await new Promise(r => p2.on('guess-result', r));
  t(result.correct === true, '猜词判定正确');
  t(result.score > 0, '得分: ' + result.score);

  p1.close(); p2.close();
  console.log('\n通过: ' + passed + '/' + (passed + failed));
  process.exit(failed > 0 ? 1 : 0);
}

setTimeout(() => { console.log('⏱ 超时'); process.exit(1); }, 30000);
test().catch(e => { console.error('异常:', e.message); process.exit(1); });
