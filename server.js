const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

// Express 5 内置 JSON/urlencoded 解析
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    } else if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
  }
}));

// ── 数据持久化路径 ──
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const CHARS_FILE = path.join(DATA_DIR, 'characters.json');
const SOCKET_ROOMS_FILE = path.join(DATA_DIR, 'socket_rooms.json');
const DRAFT_RESULTS_FILE = path.join(DATA_DIR, 'draft_results.json');

// ── 内存数据存储 ──
let users = {};        // { username: password }
let rooms = {};        // REST 房间（lobby 流程用）
let socketRooms = {};  // Socket.io 房间（index.html 用）
let draftResults = {}; // 选角结果（按房间+用户）

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 从文件加载数据
function loadData() {
  try { if (fs.existsSync(USERS_FILE)) users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { users = {}; }
  try { if (fs.existsSync(ROOMS_FILE)) rooms = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')); } catch (e) { rooms = {}; }
  try { if (fs.existsSync(SOCKET_ROOMS_FILE)) socketRooms = JSON.parse(fs.readFileSync(SOCKET_ROOMS_FILE, 'utf8')); } catch (e) { socketRooms = {}; }
  try { if (fs.existsSync(DRAFT_RESULTS_FILE)) draftResults = JSON.parse(fs.readFileSync(DRAFT_RESULTS_FILE, 'utf8')); } catch (e) { draftResults = {}; }
  // 重启后清空玩家连接（socket.id 已失效），但保留房间结构和投票状态
  Object.keys(socketRooms).forEach(id => { if (socketRooms[id].players) socketRooms[id].players = []; });
}
function saveUsers()        { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8'); }
function saveRooms()        { fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2), 'utf8'); }
function saveSocketRooms()  { fs.writeFileSync(SOCKET_ROOMS_FILE, JSON.stringify(socketRooms, null, 2), 'utf8'); }
function saveDraftResults() { fs.writeFileSync(DRAFT_RESULTS_FILE, JSON.stringify(draftResults, null, 2), 'utf8'); }
loadData();

const resetRoomVote = (roomId) => {
  const r = socketRooms[roomId];
  if (r) { r.vote = { random: 0, normal: 0 }; r.voteEnd = false; }
};

const isAllReady = (roomId) => {
  const room = socketRooms[roomId];
  if (!room || room.players.length === 0) return false;
  return room.players.every(p => p.ready);
};

// ═══════════════════════════════════════
//  REST API 路由
// ═══════════════════════════════════════

// 如果 characters.json 不存在，从 CSV 自动生成
const CSV_FILE = path.join(__dirname, 'super-mahjong.csv');
if (!fs.existsSync(CHARS_FILE) && fs.existsSync(CSV_FILE)) {
  try {
    const csvText = fs.readFileSync(CSV_FILE, 'utf8');
    const result = parseCSV(csvText);
    fs.writeFileSync(CHARS_FILE, JSON.stringify(result, null, 2), 'utf8');
    console.log('✅ 已从 CSV 自动生成 ' + result.length + ' 个角色');
  } catch (e) { console.log('⚠️ CSV 解析失败: ' + e.message); }
}

// 注册
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, msg: '用户名和密码不能为空' });
  if (users[username]) return res.json({ success: false, msg: '用户名已存在' });
  users[username] = password;
  saveUsers();
  res.json({ success: true, msg: '注册成功' });
});

// 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, msg: '用户名和密码不能为空' });
  if (!users[username]) return res.json({ success: false, msg: '用户不存在' });
  if (users[username] !== password) return res.json({ success: false, msg: '密码错误' });
  res.json({ success: true, msg: '登录成功' });
});

// 创建房间（lobby 流程）
app.post('/api/create-room', (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ success: false, msg: '用户名为空' });
  // 生成6位房间号
  let roomId;
  do { roomId = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms[roomId]);
  rooms[roomId] = {
    id: roomId,
    host: username,
    players: [username],
    maxPlayers: 4,
    started: false,
    createdAt: new Date().toISOString()
  };
  saveRooms();
  res.json({ success: true, roomId });
});

// 加入房间
app.post('/api/join-room', (req, res) => {
  const { username, roomId } = req.body;
  if (!username || !roomId) return res.json({ success: false, msg: '参数不完整' });
  const room = rooms[roomId];
  if (!room) return res.json({ success: false, msg: '房间不存在' });
  if (room.started) return res.json({ success: false, msg: '游戏已开始' });
  if (room.players.length >= room.maxPlayers) return res.json({ success: false, msg: '房间已满' });
  if (!room.players.includes(username)) room.players.push(username);
  saveRooms();
  res.json({ success: true, roomId, players: room.players });
});

// 获取角色列表
app.get('/api/characters', (req, res) => {
  try {
    const chars = JSON.parse(fs.readFileSync(CHARS_FILE, 'utf8'));
    res.json(chars);
  } catch (e) {
    res.json([]);
  }
});

// CSV 解析辅助函数
function parseCSV(csvText) {
  const lines = csvText.replace(/\r\n/g, '\n').trim().split('\n');
  if (lines.length < 2) throw new Error('CSV 格式错误');
  const headers = lines[0].split(',');
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const obj = {};
    let current = '', fieldIdx = 0, inQuotes = false;
    for (let j = 0; j < lines[i].length; j++) {
      const ch = lines[i][j];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { obj[headers[fieldIdx]] = current; current = ''; fieldIdx++; }
      else { current += ch; }
    }
    obj[headers[fieldIdx]] = current;
    result.push(obj);
  }
  return result;
}

// CSV 上传（支持 text/csv 和 text/plain）
app.post('/api/upload-csv', express.text({ type: ['text/csv', 'text/plain'] }), (req, res) => {
  try {
    const result = parseCSV(req.body);
    fs.writeFileSync(CHARS_FILE, JSON.stringify(result, null, 2), 'utf8');
    res.json({ success: true, count: result.length });
  } catch (e) {
    res.json({ success: false, msg: e.message });
  }
});

// 开始游戏
app.post('/api/start-game', (req, res) => {
  const { roomId } = req.body;
  if (roomId && rooms[roomId]) {
    rooms[roomId].started = true;
    saveRooms();
  }
  res.json({ success: true });
});

// 获取活跃房间列表（大厅用）
app.get('/api/rooms', (req, res) => {
  const list = [];
  Object.keys(socketRooms).forEach(id => {
    const r = socketRooms[id];
    if (r.players && r.players.length > 0) {
      list.push({
        roomId: id,
        players: r.players.map(p => p.name),
        playerCount: r.players.length,
        maxPlayers: r.maxPlayers,
        allReady: r.players.every(p => p.ready),
        playing: !!r.voteEnd
      });
    }
  });
  res.json(list);
});

// 保存选角结果
app.post('/api/draft-results', (req, res) => {
  const { roomId, results } = req.body;
  if (!roomId || !results) return res.json({ success: false, msg: '参数不完整' });
  draftResults[roomId] = results;
  saveDraftResults();
  // 自动标记房间为对局中，玩家可直接进入 game.html
  if (roomId && rooms[roomId]) {
    rooms[roomId].started = true;
    saveRooms();
  }
  res.json({ success: true });
});

// 获取当前用户的选角结果
app.get('/api/my-draft', (req, res) => {
  const { roomId, username } = req.query;
  if (!roomId || !username) return res.json([]);
  const room = draftResults[roomId];
  if (!room) return res.json([]);
  res.json(room[username] || []);
});

// ═══════════════════════════════════════
//  HTTP 服务器 + Socket.io
// ═══════════════════════════════════════
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  serveClient: true,
  maxHttpBufferSize: 1e8,
  transports: ['polling', 'websocket'],  // 兼容 Render 反向代理
  allowEIO3: true
});

// Socket.io 核心逻辑
io.on('connection', (socket) => {
  console.log(`[Socket] 玩家 ${socket.id} 连接成功`);

  // 加入房间
  socket.on('joinRoom', (data) => {
    const { roomId = "0000", playerName } = data;
    if (!socketRooms[roomId]) {
      socketRooms[roomId] = {
        players: [], maxPlayers: 4, vote: { random: 0, normal: 0 }, voteEnd: false,
        round: 1, roundEndVotes: {}, gameEndVotes: {}
      };
    }
    const room = socketRooms[roomId];
    // 确保新加入的玩家回合计数器一致
    if (!room.round) room.round = 1;
    if (!room.roundEndVotes) room.roundEndVotes = {};
    if (!room.gameEndVotes) room.gameEndVotes = {};

    if (room.players.length >= room.maxPlayers) {
      socket.emit('joinFailed', '房间人数已满（最多4人）');
      return;
    }

    const isExist = room.players.some(p => p.id === socket.id);
    if (!isExist) {
      room.players.push({
        id: socket.id,
        name: playerName || `玩家${Math.floor(Math.random() * 1000)}`,
        ready: false,
        vote: ''
      });
    }

    socket.join(roomId);
    saveSocketRooms();
    io.to(roomId).emit('roomPlayersUpdate', { players: room.players, roomId });
    socket.emit('joinSuccess', `成功加入房间【${roomId}】`);
  });

  // 切换准备状态
  socket.on('toggleReady', (roomId) => {
    const room = socketRooms[roomId];
    if (!room) return socket.emit('error', '房间不存在');

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.ready = !player.ready;
      saveSocketRooms();
      io.to(roomId).emit('roomPlayersUpdate', { players: room.players, roomId });

      if (isAllReady(roomId)) {
        resetRoomVote(roomId);
        io.to(roomId).emit('allReady', '所有人已准备，开始投票选择角色抽取方式！');
      }
    }
  });

  // 投票
  socket.on('voteSelect', (data) => {
    const { roomId, type } = data;
    const room = socketRooms[roomId];
    if (!room || room.voteEnd) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      if (player.vote) room.vote[player.vote] -= 1;
      player.vote = type;
      room.vote[type] += 1;
      saveSocketRooms();

      io.to(roomId).emit('voteUpdate', { vote: room.vote, players: room.players });

      const allVoted = room.players.every(p => p.vote);
      if (allVoted) {
        room.voteEnd = true;
        const finalType = room.vote.random > room.vote.normal ? 'random' : 'normal';
        saveSocketRooms();
        io.to(roomId).emit('voteResult', {
          type: finalType,
          players: room.players,
          desc: finalType === 'random' ? '随机抽取角色' : '正常抽取角色'
        });
      }
    }
  });

  // 投票结束当前回合
  socket.on('voteEndRound', (roomId) => {
    const room = socketRooms[roomId];
    if (!room) return;
    if (!room.roundEndVotes) room.roundEndVotes = {};
    room.roundEndVotes[socket.id] = true;

    const votedCount = Object.keys(room.roundEndVotes).length;
    const totalCount = room.players.length;
    const votedNames = room.players.filter(p => room.roundEndVotes[p.id]).map(p => p.name);

    io.to(roomId).emit('roundEndVoteUpdate', {
      voted: votedCount,
      total: totalCount,
      votedNames
    });

    if (votedCount >= totalCount && totalCount > 0) {
      room.round += 1;
      room.roundEndVotes = {};
      io.to(roomId).emit('roundAdvanced', { round: room.round });
    }
    saveSocketRooms();
  });

  // 投票结束对局
  socket.on('voteEndGame', (roomId) => {
    const room = socketRooms[roomId];
    if (!room) return;
    if (!room.gameEndVotes) room.gameEndVotes = {};
    room.gameEndVotes[socket.id] = true;

    const votedCount = Object.keys(room.gameEndVotes).length;
    const totalCount = room.players.length;
    const votedNames = room.players.filter(p => room.gameEndVotes[p.id]).map(p => p.name);

    io.to(roomId).emit('gameEndVoteUpdate', {
      voted: votedCount,
      total: totalCount,
      votedNames
    });

    if (votedCount >= totalCount && totalCount > 0) {
      room.gameEndVotes = {};
      room.round = 1;
      io.to(roomId).emit('gameEnded', { msg: '全部玩家同意，对局结束！' });
    }
    saveSocketRooms();
  });

  // 获取当前房间状态（回合数等）
  socket.on('getRoomState', (roomId) => {
    const room = socketRooms[roomId];
    if (room) {
      socket.emit('roomState', {
        round: room.round || 1,
        roundEndVotes: room.roundEndVotes ? Object.keys(room.roundEndVotes).length : 0,
        gameEndVotes: room.gameEndVotes ? Object.keys(room.gameEndVotes).length : 0,
        totalPlayers: room.players.length
      });
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    Object.keys(socketRooms).forEach(roomId => {
      const room = socketRooms[roomId];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx > -1) {
        room.players.splice(idx, 1);
        saveSocketRooms();
        io.to(roomId).emit('roomPlayersUpdate', { players: room.players, roomId });
      }
    });
  });
});

// 启动服务
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ 服务器运行在 http://localhost:${PORT}`);
  console.log('   - 登录页:  http://localhost:' + PORT + '/login.html');
  console.log('   - 大厅页:  http://localhost:' + PORT + '/lobby.html');
  console.log('   - 房间页:  http://localhost:' + PORT + '/index.html');
  console.log('   - 对局页:  http://localhost:' + PORT + '/game.html');
});
