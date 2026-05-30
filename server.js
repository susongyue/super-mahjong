require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

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

// ── Supabase 客户端 ──
const supabaseUrl = process.env.SUPABASE_URL || 'https://rvdvdgriyleoiuglzgch.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2ZHZkZ3JpeWxlb2l1Z2x6Z2NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTk2NjQsImV4cCI6MjA5NTczNTY2NH0.ReGBK9H8xV0uReWiUWJe0Vo2hO4Jp66ou9pxjI2a3G4';
const supabase = createClient(supabaseUrl, supabaseKey);

// ── 内存缓存（从 Supabase 加载，减少数据库查询） ──
let users = {};
let rooms = {};
let socketRooms = {};
let draftResults = {};

// ── 作战选将 + 休息/保留状态 ──
// characterStates[roomId][username] = { "宫永咲": {resting:false}, "原村和": {resting:true}, ... }
let characterStates = {};
// battleSelections[roomId] = { "username1": "宫永咲", "username2": "天江衣", ... }
let battleSelections = {};

// ── 数据路径（兼容旧数据导入） ──
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const CHARS_FILE = path.join(DATA_DIR, 'characters.json');
const SOCKET_ROOMS_FILE = path.join(DATA_DIR, 'socket_rooms.json');
const DRAFT_RESULTS_FILE = path.join(DATA_DIR, 'draft_results.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── 从 Supabase 加载数据到内存缓存 ──
async function loadFromDB() {
  try {
    // 加载用户
    const { data: userData } = await supabase.from('users').select('*');
    if (userData) {
      users = {};
      userData.forEach(u => { users[u.username] = u.password; });
      console.log('✅ 从 Supabase 加载 ' + userData.length + ' 个用户');
    }

    // 加载 REST 房间
    const { data: roomData } = await supabase.from('rooms').select('*');
    if (roomData) {
      rooms = {};
      roomData.forEach(r => {
        const { room_id, ...rest } = r;
        rooms[room_id] = { id: room_id, ...rest };
      });
      console.log('✅ 从 Supabase 加载 ' + roomData.length + ' 个 REST 房间');
    }

    // 加载 Socket 房间
    const { data: srData } = await supabase.from('socket_rooms').select('*');
    if (srData) {
      socketRooms = {};
      srData.forEach(r => { socketRooms[r.room_id] = r.state_data; });
      // 重启后清空玩家连接
      Object.keys(socketRooms).forEach(id => {
        if (socketRooms[id] && socketRooms[id].players) socketRooms[id].players = [];
      });
      console.log('✅ 从 Supabase 加载 ' + srData.length + ' 个 Socket 房间');
    }

    // 加载选角结果
    const { data: drData } = await supabase.from('draft_results').select('*');
    if (drData) {
      draftResults = {};
      drData.forEach(r => { draftResults[r.room_id] = r.results; });
      console.log('✅ 从 Supabase 加载 ' + drData.length + ' 条选角结果');
    }
  } catch (e) {
    console.log('⚠️ Supabase 加载失败，尝试从本地 JSON 恢复: ' + e.message);
    loadFromLocalJSON();
  }
}

// 从本地 JSON 导入数据（兼容旧数据迁移）
function loadFromLocalJSON() {
  try { if (fs.existsSync(USERS_FILE)) users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { users = {}; }
  try { if (fs.existsSync(ROOMS_FILE)) rooms = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')); } catch (e) { rooms = {}; }
  try { if (fs.existsSync(SOCKET_ROOMS_FILE)) { socketRooms = JSON.parse(fs.readFileSync(SOCKET_ROOMS_FILE, 'utf8')); } } catch (e) { socketRooms = {}; }
  try { if (fs.existsSync(DRAFT_RESULTS_FILE)) draftResults = JSON.parse(fs.readFileSync(DRAFT_RESULTS_FILE, 'utf8')); } catch (e) { draftResults = {}; }
  Object.keys(socketRooms).forEach(id => { if (socketRooms[id].players) socketRooms[id].players = []; });
  console.log('✅ 从本地 JSON 文件加载数据');
}

// ── 从 Supabase 查询单个用户（登录时内存缓存缺失的兜底） ──
async function findUserInDB(username) {
  try {
    const { data, error } = await supabase.from('users').select('*').eq('username', username).single();
    if (error) { console.log('⚠️ findUserInDB 查询失败: ' + error.message); return null; }
    if (data) {
      users[data.username] = data.password; // 回填到内存缓存
      return data;
    }
    return null;
  } catch (e) { console.log('⚠️ findUserInDB 异常: ' + e.message); return null; }
}

// ── 保存到 Supabase ──
async function saveUserToDB(username, password) {
  try {
    const { error } = await supabase.from('users').insert({ username, password });
    if (error) { console.log('⚠️ saveUserToDB 失败: ' + error.message); return false; }
    console.log('✅ 用户 ' + username + ' 已写入 Supabase');
    return true;
  } catch (e) { console.log('⚠️ saveUserToDB 异常: ' + e.message); return false; }
}

async function saveRooms() {
  try {
    for (const [roomId, room] of Object.entries(rooms)) {
      await supabase.from('rooms').upsert({
        room_id: roomId,
        host: room.host,
        players: room.players || [],
        max_players: room.maxPlayers || 4,
        started: room.started || false,
        created_at: room.createdAt
      }, { onConflict: 'room_id' });
    }
  } catch (e) { console.log('⚠️ saveRooms 失败: ' + e.message); }
}
async function saveSocketRooms() {
  try {
    for (const [roomId, state] of Object.entries(socketRooms)) {
      await supabase.from('socket_rooms').upsert({
        room_id: roomId,
        state_data: state,
        updated_at: new Date().toISOString()
      }, { onConflict: 'room_id' });
    }
  } catch (e) { console.log('⚠️ saveSocketRooms 失败: ' + e.message); }
}
async function saveDraftResults() {
  try {
    for (const [roomId, results] of Object.entries(draftResults)) {
      await supabase.from('draft_results').upsert({
        room_id: roomId,
        results: results,
        updated_at: new Date().toISOString()
      }, { onConflict: 'room_id' });
    }
  } catch (e) { console.log('⚠️ saveDraftResults 失败: ' + e.message); }
}

// ── 辅助函数 ──
let _charCache = null;
let _charCacheTime = 0;

function getCharacterData(name) {
  const now = Date.now();
  if (!_charCache || now - _charCacheTime > 30000) {
    try { _charCache = JSON.parse(fs.readFileSync(CHARS_FILE, 'utf8')); _charCacheTime = now; } catch (e) { _charCache = []; }
  }
  return _charCache.find(c => c.name === name) || null;
}

const resetRoomVote = (roomId) => {
  const r = socketRooms[roomId];
  if (r) { r.vote = { random: 0, normal: 0 }; r.voteEnd = false; }
};

const isAllReady = (roomId) => {
  const room = socketRooms[roomId];
  if (!room || room.players.length === 0) return false;
  return room.players.every(p => p.ready);
};

// ── 回合结束后更新角色休息/保留状态 ──
function updateCharacterStatesAfterRound(roomId) {
  const selections = battleSelections[roomId] || {};
  const draft = draftResults[roomId] || {};

  // 初始化房间状态
  if (!characterStates[roomId]) characterStates[roomId] = {};

  // 遍历每个玩家的出战角色，将其标记为休息（保留角色除外）
  for (const [playerName, charName] of Object.entries(selections)) {
    if (!characterStates[roomId][playerName]) {
      // 初始化该玩家的角色状态
      characterStates[roomId][playerName] = {};
      const playerChars = draft[playerName] || [];
      playerChars.forEach(c => {
        characterStates[roomId][playerName][c.name] = { resting: false };
      });
    }

    // 所有角色出战都标记为休息（保留角色也计数，但可以选择时忽略）
    if (characterStates[roomId][playerName][charName]) {
      characterStates[roomId][playerName][charName].resting = true;
      const charData = getCharacterData(charName) || {};
      if (charData.retain) {
        console.log(`🛡️ ${playerName} 的 ${charName} 拥有保留效果，标记休息但可继续出战`);
      } else {
        console.log(`😴 ${playerName} 的 ${charName} 进入休息状态`);
      }
    }
  }

  // 检查是否所有角色都在休息（除了保留的）
  for (const [playerName, states] of Object.entries(characterStates[roomId])) {
    const allCharStates = Object.entries(states);
    const restingChars = allCharStates.filter(([, s]) => s.resting);

    if (restingChars.length >= allCharStates.length && allCharStates.length > 0) {
      // 所有角色都休息过了，重置
      allCharStates.forEach(([cn]) => {
        characterStates[roomId][playerName][cn].resting = false;
      });
      console.log(`🔄 ${playerName} 所有角色已休息完毕，全部恢复`);
    }
  }
}

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
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, msg: '用户名和密码不能为空' });

  // 先检查数据库是否已存在（避免内存缓存不完整导致重复注册）
  const existing = await findUserInDB(username);
  if (existing) return res.json({ success: false, msg: '用户名已存在' });

  // 直接写入数据库
  const ok = await saveUserToDB(username, password);
  if (!ok) return res.json({ success: false, msg: '注册失败，数据库写入异常，请重试' });

  // 更新内存缓存
  users[username] = password;
  console.log('✅ 注册成功: ' + username + ' (用户总数: ' + Object.keys(users).length + ')');
  res.json({ success: true, msg: '注册成功' });
});

// 登录
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, msg: '用户名和密码不能为空' });

  // 先查内存缓存
  let pwd = users[username];
  if (pwd) {
    // 内存命中，直接校验
    if (pwd !== password) return res.json({ success: false, msg: '密码错误' });
  } else {
    // 内存未命中，从 Supabase 查询
    console.log('🔍 内存缓存缺失 ' + username + '，尝试从 Supabase 查询...');
    const dbUser = await findUserInDB(username);
    if (!dbUser) return res.json({ success: false, msg: '用户不存在' });
    if (dbUser.password !== password) return res.json({ success: false, msg: '密码错误' });
  }
  res.json({ success: true, msg: '登录成功' });
});

// 创建房间（lobby 流程）
app.post('/api/create-room', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ success: false, msg: '用户名为空' });
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

// 加入房间（支持内存未命中时从 Supabase 查询）
app.post('/api/join-room', async (req, res) => {
  const { username, roomId } = req.body;
  if (!username || !roomId) return res.json({ success: false, msg: '参数不完整' });

  let room = rooms[roomId];
  // 内存未命中，从 Supabase 查询
  if (!room) {
    try {
      const { data, error } = await supabase.from('rooms').select('*').eq('room_id', roomId).single();
      if (!error && data) {
        room = { id: data.room_id, host: data.host, players: data.players, maxPlayers: data.max_players, started: data.started, createdAt: data.created_at };
        rooms[roomId] = room; // 回填内存
        console.log('🔍 从 Supabase 恢复房间 ' + roomId);
      }
    } catch (e) { /* ignore */ }
  }
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
    // 规范化键名
    const normalized = {};
    Object.keys(obj).forEach(k => {
      const nk = k.trim().toLowerCase()
        .replace(/（/g, '(').replace(/）/g, ')')
        .replace(/\s+/g, '');
      if (nk === '姓名' || nk === '角色' || nk === '角色名' || nk === '名称') normalized.name = obj[k];
      else if (nk === '强度' || nk === 'tier') normalized.tier = obj[k];
      else if (nk === '阵营' || nk === '势力') normalized.faction = obj[k];
      else if (nk === '限定技') normalized.limit = obj[k];
      else if (nk === '固有技' || nk === '天赋技') normalized.innate = obj[k];
      else if (nk === '被动技' || nk === '被动') normalized.passive = obj[k];
      else if (nk === '附加技' || nk === '额外技' || nk === '额外') normalized.extra = obj[k];
      else if (nk === '保留' || nk === 'retain') normalized.retain = (obj[k] && (obj[k].toLowerCase() === 'true' || obj[k] === '1' || obj[k] === '是' || obj[k] === 'yes'));
    });
    result.push(normalized);
  }
  return result;
}

// CSV 上传
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
app.post('/api/start-game', async (req, res) => {
  const { roomId } = req.body;
  if (roomId && rooms[roomId]) {
    rooms[roomId].started = true;
    saveRooms();
  }
  res.json({ success: true });
});

// 获取活跃房间列表
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
app.post('/api/draft-results', async (req, res) => {
  const { roomId, results } = req.body;
  if (!roomId || !results) return res.json({ success: false, msg: '参数不完整' });
  draftResults[roomId] = results;
  saveDraftResults();
  if (roomId && rooms[roomId]) {
    rooms[roomId].started = true;
    saveRooms();
  }
  res.json({ success: true });
});

// 获取当前用户的选角结果（支持内存未命中时从 Supabase 查询）
app.get('/api/my-draft', async (req, res) => {
  const { roomId, username } = req.query;
  if (!roomId || !username) return res.json([]);

  let room = draftResults[roomId];
  // 内存未命中，从 Supabase 查询
  if (!room) {
    try {
      const { data, error } = await supabase.from('draft_results').select('*').eq('room_id', roomId).single();
      if (!error && data && data.results) {
        room = data.results;
        draftResults[roomId] = room;
        console.log('🔍 从 Supabase 恢复选角结果 ' + roomId);
      }
    } catch (e) { /* ignore */ }
  }
  if (!room) return res.json([]);
  res.json(room[username] || []);
});

// 获取用户的角色状态（休息/保留）
app.get('/api/character-states', (req, res) => {
  const { roomId, username } = req.query;
  if (!roomId || !username) return res.json({});
  const roomStates = characterStates[roomId] || {};
  res.json(roomStates[username] || {});
});

// 获取当前回合所有玩家的出战选择（用于 battle_round.html）
app.get('/api/battle-selections', (req, res) => {
  const { roomId } = req.query;
  if (!roomId) return res.json({});
  res.json(battleSelections[roomId] || {});
});

// 获取当前房间所有玩家的角色信息
app.get('/api/all-draft', async (req, res) => {
  const { roomId } = req.query;
  if (!roomId) return res.json({});
  const room = draftResults[roomId];
  if (!room) return res.json({});
  res.json(room);
});

// ═══════════════════════════════════════
//  HTTP 服务器 + Socket.io
// ═══════════════════════════════════════
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  serveClient: true,
  maxHttpBufferSize: 1e8,
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

io.on('connection', (socket) => {
  console.log(`[Socket] 玩家 ${socket.id} 连接成功`);

  socket.on('joinRoom', (data) => {
    const { roomId = "0000", playerName } = data;
    if (!socketRooms[roomId]) {
      socketRooms[roomId] = {
        players: [], maxPlayers: 4, vote: { random: 0, normal: 0 }, voteEnd: false,
        round: 1, roundEndVotes: {}, gameEndVotes: {}
      };
    }
    const room = socketRooms[roomId];
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

    // 广播玩家列表（不包含出战选择，确保选将阶段保密）
    io.to(roomId).emit('roomPlayersUpdate', { players: room.players, roomId });
    // 单独发送角色休息状态给该玩家
    const cs = (characterStates[roomId] || {})[playerName] || {};
    socket.emit('characterStatesUpdate', cs);
    socket.emit('joinSuccess', `成功加入房间【${roomId}】`);
  });

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

  // ── 作战选将：玩家选择出战角色（选择内容保密，仅本人可见） ──
  socket.on('selectBattleCharacter', (data) => {
    const { roomId, characterName, playerName } = data;
    if (!roomId || !characterName || !playerName) return;

    if (!battleSelections[roomId]) battleSelections[roomId] = {};

    // 检查角色是否在休息状态（保留角色不受影响）
    const playerStates = (characterStates[roomId] || {})[playerName] || {};
    if (playerStates[characterName] && playerStates[characterName].resting) {
      const charData = getCharacterData(characterName);
      if (!charData || !charData.retain) {
        socket.emit('error', '该角色正在休息中，无法出战');
        return;
      }
      console.log(`🛡️ ${playerName} 的 ${characterName} 拥有保留效果，休息状态下出战`);
    }

    // 记录选择
    battleSelections[roomId][playerName] = characterName;
    console.log(`⚔️ ${playerName} 在房间 ${roomId} 选择了 ${characterName} 出战`);

    const selections = battleSelections[roomId];
    const room = socketRooms[roomId];
    const totalPlayers = room ? room.players.length : 4;
    const selectedCount = Object.keys(selections).length;
    const readyPlayerNames = Object.keys(selections); // 仅发送已准备的玩家名，不透露角色

    // 仅向选择者本人确认选择
    socket.emit('battleSelectionConfirm', {
      characterName,
      selectedCount,
      totalPlayers,
      readyPlayerNames
    });

    // 向房间内所有人广播准备状态（不包含具体角色选择）
    io.to(roomId).emit('battleReadyUpdate', {
      selectedCount,
      totalPlayers,
      readyPlayerNames,
      lastSelector: playerName
    });

    // 检查是否所有人都选完了
    if (room && selectedCount >= totalPlayers && totalPlayers > 0) {
      io.to(roomId).emit('allBattleSelected', {
        selections,
        msg: '所有玩家已选择出战角色，即将进入回合界面！'
      });
    }

    saveSocketRooms();
  });

  // ── 重置单个玩家的出战选择（切换选择时） ──
  socket.on('resetBattleSelection', (data) => {
    const { roomId, playerName } = data;
    if (!roomId || !playerName) return;
    if (battleSelections[roomId]) {
      delete battleSelections[roomId][playerName];
      const sel = battleSelections[roomId];
      const readyPlayerNames = Object.keys(sel);
      // 仅发送准备数量，不透露选择
      io.to(roomId).emit('battleReadyUpdate', {
        selectedCount: readyPlayerNames.length,
        totalPlayers: (socketRooms[roomId] || {}).players ? socketRooms[roomId].players.length : 4,
        readyPlayerNames
      });
      // 通知取消者本人
      socket.emit('battleSelectionCancel');
    }
  });

  // ── 查询当前作战选将状态 ──
  socket.on('getBattleState', (data) => {
    const roomId = typeof data === 'string' ? data : data.roomId;
    const playerName = typeof data === 'object' ? data.playerName : null;
    const selections = battleSelections[roomId] || {};
    const room = socketRooms[roomId];
    if (room) {
      const readyPlayerNames = Object.keys(selections);
      socket.emit('battleState', {
        selectedCount: readyPlayerNames.length,
        totalPlayers: room.players.length,
        round: room.round || 1,
        readyPlayerNames,
        mySelection: selections[playerName] || null
      });
    }
  });

  socket.on('voteEndRound', (roomId) => {
    const room = socketRooms[roomId];
    if (!room) return;
    if (!room.roundEndVotes) room.roundEndVotes = {};
    room.roundEndVotes[socket.id] = true;
    const votedCount = Object.keys(room.roundEndVotes).length;
    const totalCount = room.players.length;
    const votedNames = room.players.filter(p => room.roundEndVotes[p.id]).map(p => p.name);
    io.to(roomId).emit('roundEndVoteUpdate', { voted: votedCount, total: totalCount, votedNames });
    if (votedCount >= totalCount && totalCount > 0) {
      // ── 更新角色休息/保留状态 ──
      updateCharacterStatesAfterRound(roomId);
      room.round += 1;
      room.roundEndVotes = {};
      // 清空本轮作战选择
      battleSelections[roomId] = {};
      io.to(roomId).emit('roundAdvanced', { round: room.round });
    }
    saveSocketRooms();
  });

  socket.on('voteEndGame', (roomId) => {
    const room = socketRooms[roomId];
    if (!room) return;
    if (!room.gameEndVotes) room.gameEndVotes = {};
    room.gameEndVotes[socket.id] = true;
    const votedCount = Object.keys(room.gameEndVotes).length;
    const totalCount = room.players.length;
    const votedNames = room.players.filter(p => room.gameEndVotes[p.id]).map(p => p.name);
    io.to(roomId).emit('gameEndVoteUpdate', { voted: votedCount, total: totalCount, votedNames });
    if (votedCount >= totalCount && totalCount > 0) {
      // ── 清理作战选将和角色状态 ──
      delete battleSelections[roomId];
      delete characterStates[roomId];
      room.gameEndVotes = {};
      room.round = 1;
      io.to(roomId).emit('gameEnded', { msg: '全部玩家同意，对局结束！即将返回大厅。' });
    }
    saveSocketRooms();
  });

  socket.on('getRoomState', (roomId) => {
    const room = socketRooms[roomId];
    if (room) {
      const selections = battleSelections[roomId] || {};
      socket.emit('roomState', {
        round: room.round || 1,
        roundEndVotes: room.roundEndVotes ? Object.keys(room.roundEndVotes).length : 0,
        gameEndVotes: room.gameEndVotes ? Object.keys(room.gameEndVotes).length : 0,
        totalPlayers: room.players.length,
        selectedCount: Object.keys(selections).length,
        readyPlayerNames: Object.keys(selections)
      });
    }
  });

  socket.on('disconnect', () => {
    Object.keys(socketRooms).forEach(roomId => {
      const room = socketRooms[roomId];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx > -1) {
        const playerName = room.players[idx].name;
        room.players.splice(idx, 1);
        // 清理该玩家的作战选择
        if (battleSelections[roomId]) {
          delete battleSelections[roomId][playerName];
          // 广播更新后的准备状态
          const readyNames = Object.keys(battleSelections[roomId]);
          io.to(roomId).emit('battleReadyUpdate', {
            selectedCount: readyNames.length,
            totalPlayers: room.players.length,
            readyPlayerNames: readyNames
          });
        }
        saveSocketRooms();
        io.to(roomId).emit('roomPlayersUpdate', { players: room.players, roomId });
      }
    });
  });
});

// ── 启动服务 ──
const PORT = process.env.PORT || 3000;

async function start() {
  await loadFromDB();
  server.listen(PORT, () => {
    console.log(`✅ 服务器运行在 http://localhost:${PORT}`);
    console.log('   - 登录页:  http://localhost:' + PORT + '/login.html');
    console.log('   - 大厅页:  http://localhost:' + PORT + '/lobby.html');
    console.log('   - 房间页:  http://localhost:' + PORT + '/index.html');
    console.log('   - 对局页:  http://localhost:' + PORT + '/game.html');
    console.log('   - 回合页:  http://localhost:' + PORT + '/battle_round.html');
  });
}
start();
