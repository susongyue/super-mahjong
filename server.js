require('dotenv').config();
const express = require('express');
const compression = require('compression');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Gzip/Brotli 压缩（文本资源体积缩小 70%+）
app.use(compression());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

// 缓存头配置
const ONE_YEAR = 31536000; // 1 年（秒）
const ONE_DAY = 86400;     // 1 天
const ONE_HOUR = 3600;     // 1 小时

app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache'); // HTML 不缓存，确保获取最新版本
    } else if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    } else if (filePath.endsWith('.webp') || filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.svg')) {
      res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR}, immutable`);
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', `public, max-age=${ONE_DAY}`);
    }
  }
}));

// 角色头像：WebP 优先（体积减少 96%），PNG 作为原始路径保留
app.use('/webp', express.static('public/webp', {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR}, immutable`);
  }
}));
app.use('/png', express.static('png', {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR}, immutable`);
  }
}));
app.use('/avatars', express.static('public/avatars', {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', `public, max-age=${ONE_DAY}`);
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
// draftPools[roomId] = { deck, pool, pickOrder, currentTurnIndex, hands, phase, draftType }
let draftPools = {};

// ── 作战选将 + 休息/保留状态 ──
// characterStates[roomId][username] = { "宫永咲": {resting:false}, "原村和": {resting:true}, ... }
let characterStates = {};
// battleSelections[roomId] = { "username1": "宫永咲", "username2": "天江衣", ... }
let battleSelections = {};
// gameHistory[roomId] = { roomId, players, totalRounds, draftResults, host, createdAt, endedAt }
let gameHistory = {};
// finishedRooms 用于标记已结束的房间（防止重连）；值 = 结束时间戳
let finishedRooms = {};

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
      userData.forEach(u => { users[u.username] = { password: u.password, nickname: u.nickname || u.username, avatar: u.avatar || '', bio: u.bio || '' }; });
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

    // 加载角色休息/保留状态
    const { data: csData } = await supabase.from('character_states').select('*');
    if (csData) {
      characterStates = {};
      csData.forEach(r => { characterStates[r.room_id] = r.states_data; });
      console.log('✅ 从 Supabase 加载 ' + csData.length + ' 条角色状态');
    }

    // 加载出战选择（关键：服务器重启后恢复，避免 battle_round 页显示"未选择"）
    const { data: bsData } = await supabase.from('battle_selections').select('*');
    if (bsData) {
      battleSelections = {};
      bsData.forEach(r => {
        const sel = r.selections_data || {};
        // 验证：只保留在玩家角色池中实际存在的选择
        const draft = draftResults[r.room_id] || {};
        const valid = {};
        for (const [player, charName] of Object.entries(sel)) {
          const playerChars = (draft[player] || []).map(c => c.name);
          if (playerChars.includes(charName)) {
            valid[player] = charName;
          } else if (charName) {
            console.log(`🧹 移除过期选择: ${player}→${charName} (角色池中不存在)`);
          }
        }
        battleSelections[r.room_id] = valid;
      });
      console.log('✅ 从 Supabase 加载 ' + bsData.length + ' 条出战选择');
    }

    // 加载游戏历史记录
    const { data: ghData } = await supabase.from('game_history').select('*').order('ended_at', { ascending: false });
    if (ghData) {
      gameHistory = {};
      ghData.forEach(h => { gameHistory[h.room_id] = h; });
      console.log('✅ 从 Supabase 加载 ' + ghData.length + ' 条对局历史');
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
    const { data, error } = await supabase.from('users').select('*').eq('username', username).maybeSingle();
    if (error) { console.log('⚠️ findUserInDB 查询失败: ' + error.message); return null; }
    if (data) {
      users[data.username] = { password: data.password, nickname: data.nickname || data.username, avatar: data.avatar || '', bio: data.bio || '' }; // 回填到内存缓存
      return data;
    }
    return null;
  } catch (e) { console.log('⚠️ findUserInDB 异常: ' + e.message); return null; }
}

// ── 保存到 Supabase ──
async function saveUserToDB(username, password, nickname, avatar, bio) {
  try {
    const { error } = await supabase.from('users').insert({ username, password, nickname: nickname || username, avatar: avatar || '', bio: bio || '' });
    if (error) { console.log('⚠️ saveUserToDB 失败: ' + error.message); return false; }
    console.log('✅ 用户 ' + username + ' 已写入 Supabase');
    return true;
  } catch (e) { console.log('⚠️ saveUserToDB 异常: ' + e.message); return false; }
}

async function updateUserInDB(username, fields) {
  try {
    const updateData = { ...fields, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('users').update(updateData).eq('username', username);
    if (error) { console.log('⚠️ updateUserInDB 失败: ' + error.message); return false; }
    return true;
  } catch (e) { console.log('⚠️ updateUserInDB 异常: ' + e.message); return false; }
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

async function saveCharacterStates() {
  try {
    for (const [roomId, states] of Object.entries(characterStates)) {
      await supabase.from('character_states').upsert({
        room_id: roomId,
        states_data: states,
        updated_at: new Date().toISOString()
      }, { onConflict: 'room_id' });
    }
  } catch (e) { console.log('⚠️ saveCharacterStates 失败: ' + e.message); }
}

async function saveBattleSelections() {
  try {
    for (const [roomId, selections] of Object.entries(battleSelections)) {
      await supabase.from('battle_selections').upsert({
        room_id: roomId,
        selections_data: selections,
        updated_at: new Date().toISOString()
      }, { onConflict: 'room_id' });
    }
  } catch (e) { console.log('⚠️ saveBattleSelections 失败: ' + e.message); }
}

// 启动时清理 Supabase 中已不存在于内存的过期出战选择
async function cleanupStaleSelections() {
  try {
    const { data: existing } = await supabase.from('battle_selections').select('room_id');
    if (!existing) return;
    for (const r of existing) {
      if (!(r.room_id in battleSelections)) {
        await supabase.from('battle_selections').delete().eq('room_id', r.room_id);
      }
    }
  } catch (e) { /* ignore */ }
}

// 从 Supabase 恢复某个房间的出战选择（内存缺失时）
// 注意：dataFromMemory 必须是包含至少一个条目的对象，空对象 {} 不算有效数据
function _hasValidSelections(roomId) {
  const sel = battleSelections[roomId];
  return sel && typeof sel === 'object' && Object.keys(sel).length > 0;
}

async function restoreBattleSelections(roomId) {
  if (_hasValidSelections(roomId)) return battleSelections[roomId];
  try {
    const { data } = await supabase.from('battle_selections').select('*').eq('room_id', roomId).single();
    if (data && data.selections_data && Object.keys(data.selections_data).length > 0) {
      battleSelections[roomId] = data.selections_data;
      console.log(' 从 Supabase 恢复出战选择 ' + roomId);
      return data.selections_data;
    }
  } catch (e) { /* ignore */ }
  return null;
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

  // 获取房间所有玩家
  const room = socketRooms[roomId];
  const allPlayerNames = new Set();
  if (room && room.players) room.players.forEach(p => allPlayerNames.add(p.name));
  Object.keys(draft).forEach(p => allPlayerNames.add(p));
  Object.keys(selections).forEach(p => allPlayerNames.add(p));

  // 为每个玩家初始化角色状态（如果还没有）
  allPlayerNames.forEach(playerName => {
    if (!characterStates[roomId][playerName]) {
      characterStates[roomId][playerName] = {};
    }
    const playerChars = draft[playerName] || [];
    playerChars.forEach(c => {
      if (!(c.name in characterStates[roomId][playerName])) {
        characterStates[roomId][playerName][c.name] = { resting: false };
      }
    });
  });

  // 遍历每个玩家的本回合出战角色，将其标记为休息（保留角色除外）
  for (const [playerName, charName] of Object.entries(selections)) {
    // 确保角色在状态字典中
    if (!(charName in (characterStates[roomId][playerName] || {}))) {
      if (!characterStates[roomId][playerName]) characterStates[roomId][playerName] = {};
      characterStates[roomId][playerName][charName] = { resting: false };
    }

    const charData = getCharacterData(charName) || {};
    if (charData.retain) {
      // 保留角色也标记休息，但前端允许选择
      characterStates[roomId][playerName][charName].resting = true;
      console.log(` ${playerName} 的 ${charName} 拥有保留效果，标记休息但可继续出战`);
    } else {
      characterStates[roomId][playerName][charName].resting = true;
      console.log(` ${playerName} 的 ${charName} 进入休息状态`);
    }
  }

  // 检查是否所有非保留角色都在休息 → 全部重置
  // 检查是否所有角色都在休息（除了保留的）
  for (const [playerName, states] of Object.entries(characterStates[roomId])) {
    const allCharEntries = Object.entries(states);
    const nonRetainChars = allCharEntries.filter(([cn]) => {
      const cd = getCharacterData(cn) || {};
      return !cd.retain;
    });
    const retainChars = allCharEntries.filter(([cn]) => {
      const cd = getCharacterData(cn) || {};
      return cd.retain;
    });

    // 非保留角色全部休息 → 全部重置
    const allNonRetainResting = nonRetainChars.length > 0 && nonRetainChars.every(([, s]) => s.resting);
    if (allNonRetainResting) {
      nonRetainChars.forEach(([cn]) => {
        characterStates[roomId][playerName][cn].resting = false;
      });
      console.log(`🔄 ${playerName} 所有非保留角色已休息完毕，全部恢复`);
    }

    // 保留角色也全休息了 → 也重置保留角色
    const allRetainResting = retainChars.length > 0 && retainChars.every(([, s]) => s.resting);
    if (allRetainResting && allNonRetainResting) {
      retainChars.forEach(([cn]) => {
        characterStates[roomId][playerName][cn].resting = false;
      });
      console.log(`🔄 ${playerName} 所有保留角色也一并恢复`);
    }
  }

  // 持久化到 Supabase
  saveCharacterStates();

  // 广播角色状态给各玩家
  Object.keys(characterStates[roomId]).forEach(playerName => {
    const playerSocket = findSocketByPlayerName(roomId, playerName);
    if (playerSocket) {
      playerSocket.emit('characterStatesUpdate', { states: characterStates[roomId][playerName] });
    }
  });
}

// 辅助函数：通过玩家名查找 socket
function findSocketByPlayerName(roomId, playerName) {
  const room = socketRooms[roomId];
  if (!room) return null;
  const player = room.players.find(p => p.name === playerName);
  if (!player) return null;
  const sockets = io.sockets.adapter.rooms.get(roomId);
  if (!sockets) return null;
  for (const socketId of sockets) {
    const s = io.sockets.sockets.get(socketId);
    if (s && s.playerName === playerName) return s;
  }
  return null;
}

// ── 保存/删除游戏历史 ──
async function saveGameHistory(roomId, data) {
  try {
    await supabase.from('game_history').upsert({
      room_id: roomId,
      players: data.players || [],
      total_rounds: data.totalRounds || 0,
      draft_results: data.draftResults || {},
      host: data.host || '',
      created_at: data.createdAt || new Date().toISOString(),
      ended_at: data.endedAt || new Date().toISOString()
    }, { onConflict: 'room_id' });
    gameHistory[roomId] = data;
    console.log('📝 对局历史已保存: ' + roomId);
  } catch (e) { console.log('⚠️ saveGameHistory 失败: ' + e.message); }
}

// ── 清理过期房间数据（从 Supabase 和各内存缓存中删除） ──
async function deleteRoomData(roomId) {
  try {
    await supabase.from('rooms').delete().eq('room_id', roomId);
    await supabase.from('socket_rooms').delete().eq('room_id', roomId);
    await supabase.from('draft_results').delete().eq('room_id', roomId);
    await supabase.from('character_states').delete().eq('room_id', roomId);
    await supabase.from('battle_selections').delete().eq('room_id', roomId);
  } catch (e) { /* ignore */ }
  delete rooms[roomId];
  delete socketRooms[roomId];
  delete draftResults[roomId];
  delete draftPools[roomId];
  delete characterStates[roomId];
  delete battleSelections[roomId];
  console.log('已清理房间数据: ' + roomId);
}

// ── 更新房间最近活动时间 ──
function touchRoom(roomId) {
  if (socketRooms[roomId]) {
    socketRooms[roomId]._lastActivity = Date.now();
  }
}

// ── 定时清理超时对局 ──
// 超时规则：
//   1. 房间创建后 30 分钟无人加入 → 删除
//   2. 对局中（started=true）60 分钟无活动 → 保存为历史并删除
//   3. 已结束房间 → 保留在历史记录中（仅清理活跃数据）
const CLEANUP_INTERVAL = 5 * 60 * 1000;   // 每 5 分钟检查一次
const ROOM_IDLE_TIMEOUT = 30 * 60 * 1000;  // 30 分钟无活动超时
const GAME_TIMEOUT = 60 * 60 * 1000;        // 60 分钟对局超时

setInterval(async () => {
  const now = Date.now();
  const toClean = [];

  // 检查 socketRooms
  for (const [roomId, room] of Object.entries(socketRooms)) {
    const lastActivity = (room._lastActivity || 0);
    const hasPlayers = room.players && room.players.length > 0;
    const isStarted = rooms[roomId] && rooms[roomId].started;

    if (isStarted) {
      // 对局中：60 分钟无活动 → 自动结束并保存
      if (lastActivity && (now - lastActivity) > GAME_TIMEOUT) {
        const playerNames = (room.players || []).map(p => p.name);
        const uniquePlayers = [...new Set([...playerNames, ...(rooms[roomId] ? rooms[roomId].players || [] : [])])];
        console.log(`房间 ${roomId} 对局超时（${Math.floor((now - lastActivity) / 60000)} 分钟无活动），自动结束`);
        await saveGameHistory(roomId, {
          players: uniquePlayers,
          totalRounds: room.round || 1,
          draftResults: draftResults[roomId] || {},
          host: rooms[roomId] ? rooms[roomId].host : '',
          createdAt: rooms[roomId] ? rooms[roomId].createdAt : null,
          endedAt: new Date().toISOString()
        });
        finishedRooms[roomId] = Date.now();
        toClean.push(roomId);
      }
    } else if (!hasPlayers) {
      // 无人房间且无活动 30 分钟 → 清理
      if (!lastActivity || (now - lastActivity) > ROOM_IDLE_TIMEOUT) {
        console.log(`房间 ${roomId} 无人且超时，清理中...`);
        toClean.push(roomId);
      }
    }
  }

  // 检查 REST rooms 中的孤立房间（不在 socketRooms 中）
  for (const [roomId, room] of Object.entries(rooms)) {
    if (!socketRooms[roomId]) {
      const created = room.createdAt ? new Date(room.createdAt).getTime() : 0;
      if (created && (now - created) > ROOM_IDLE_TIMEOUT) {
        console.log(`孤立 REST 房间 ${roomId} 超时，清理中...`);
        toClean.push(roomId);
      }
    }
  }

  for (const roomId of toClean) {
    await deleteRoomData(roomId);
  }

  if (toClean.length > 0) {
    console.log('本轮清理 ' + toClean.length + ' 个超时房间');
  }
}, CLEANUP_INTERVAL);

// ═══════════════════════════════════════
//  REST API 路由
// ═══════════════════════════════════════

// 如果 characters.json 不存在，从 CSV 自动生成
const CSV_FILE = path.join(__dirname, 'super-mahjong.csv');
const IMG_MAP_FILE = path.join(__dirname, 'data', 'character-images.json');
if (!fs.existsSync(CHARS_FILE) && fs.existsSync(CSV_FILE)) {
  try {
    const csvText = fs.readFileSync(CSV_FILE, 'utf8');
    const result = parseCSV(csvText);
    // 合并头像映射
    let imgMap = {};
    try { imgMap = JSON.parse(fs.readFileSync(IMG_MAP_FILE, 'utf8')); } catch (e) {}
    const withImages = result.map(c => ({ ...c, image: imgMap[c.name] || null }));
    fs.writeFileSync(CHARS_FILE, JSON.stringify(withImages, null, 2), 'utf8');
    console.log('✅ 已从 CSV 自动生成 ' + withImages.length + ' 个角色（含头像映射）');
  } catch (e) { console.log('⚠️ CSV 解析失败: ' + e.message); }
}

// 注册
app.post('/api/register', async (req, res) => {
  const { username, password, nickname, avatar } = req.body;
  if (!username || !password) return res.json({ success: false, msg: '用户名和密码不能为空' });

  // 先检查数据库是否已存在（避免内存缓存不完整导致重复注册）
  const existing = await findUserInDB(username);
  if (existing) return res.json({ success: false, msg: '用户名已存在' });

  const displayNickname = nickname || username;
  const userAvatar = avatar || '';

  // 直接写入数据库
  const ok = await saveUserToDB(username, password, displayNickname, userAvatar, '');
  if (!ok) return res.json({ success: false, msg: '注册失败，数据库写入异常，请重试' });

  // 更新内存缓存
  users[username] = { password, nickname: displayNickname, avatar: userAvatar, bio: '' };
  console.log('✅ 注册成功: ' + username + ' (用户总数: ' + Object.keys(users).length + ')');
  res.json({ success: true, msg: '注册成功' });
});

// 登录
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, msg: '用户名和密码不能为空' });

  // 先查内存缓存
  let userObj = users[username];
  if (userObj) {
    // 内存命中，兼容旧格式：可能是字符串（旧密码）或对象（新格式）
    let storedPwd = typeof userObj === 'string' ? userObj : userObj.password;
    // 如果是旧格式字符串，自动升级为新格式对象
    if (typeof userObj === 'string') {
      users[username] = { password: userObj, nickname: username, avatar: '', bio: '' };
    }
    if (storedPwd !== password) return res.json({ success: false, msg: '密码错误' });
  } else {
    // 内存未命中，从 Supabase 查询
    console.log(' 内存缓存缺失 ' + username + '，尝试从 Supabase 查询...');
    const dbUser = await findUserInDB(username);
    if (!dbUser) return res.json({ success: false, msg: '用户不存在' });
    if (dbUser.password !== password) return res.json({ success: false, msg: '密码错误' });
  }

  const profile = users[username] || { nickname: username, avatar: '' };
  res.json({ success: true, msg: '登录成功', nickname: profile.nickname, avatar: profile.avatar });
});

// ── 获取用户资料 ──
app.get('/api/profile', (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ success: false, msg: '缺少用户名' });

  const userObj = users[username];
  if (userObj && typeof userObj === 'object') {
    return res.json({
      success: true,
      username,
      nickname: userObj.nickname || username,
      avatar: userObj.avatar || '',
      bio: userObj.bio || ''
    });
  }
  // 兼容旧格式或不存在
  return res.json({ success: true, username, nickname: username, avatar: '', bio: '' });
});

// ── 更新用户资料（昵称、头像、简介） ──
app.put('/api/profile', async (req, res) => {
  const { username, nickname, avatar, bio } = req.body;
  if (!username) return res.json({ success: false, msg: '缺少用户名' });

  // 确保内存缓存存在
  if (!users[username] || typeof users[username] !== 'object') {
    // 从数据库加载
    const dbUser = await findUserInDB(username);
    if (!dbUser) return res.json({ success: false, msg: '用户不存在' });
  }

  const updateFields = {};
  if (nickname !== undefined) { users[username].nickname = nickname; updateFields.nickname = nickname; }
  if (avatar !== undefined) { users[username].avatar = avatar; updateFields.avatar = avatar; }
  if (bio !== undefined) { users[username].bio = bio; updateFields.bio = bio; }

  const ok = await updateUserInDB(username, updateFields);
  if (!ok) return res.json({ success: false, msg: '更新失败，数据库异常' });

  res.json({
    success: true,
    msg: '资料已更新',
    nickname: users[username].nickname,
    avatar: users[username].avatar,
    bio: users[username].bio
  });
});

// ── 修改密码 ──
app.post('/api/change-password', async (req, res) => {
  const { username, oldPassword, newPassword } = req.body;
  if (!username || !oldPassword || !newPassword) return res.json({ success: false, msg: '请填写完整信息' });
  if (newPassword.length < 3) return res.json({ success: false, msg: '新密码至少3位' });

  let userObj = users[username];
  if (!userObj || typeof userObj !== 'object') {
    const dbUser = await findUserInDB(username);
    if (!dbUser) return res.json({ success: false, msg: '用户不存在' });
    userObj = users[username];
  }

  const currentPwd = typeof userObj === 'string' ? userObj : userObj.password;
  if (currentPwd !== oldPassword) return res.json({ success: false, msg: '原密码错误' });

  // 更新密码
  users[username].password = newPassword;
  const ok = await updateUserInDB(username, { password: newPassword });
  if (!ok) return res.json({ success: false, msg: '修改失败，数据库异常' });

  res.json({ success: true, msg: '密码修改成功' });
});

// ── 上传自定义头像（base64） ──
app.post('/api/upload-avatar', async (req, res) => {
  const { username, image } = req.body;
  if (!username || !image) return res.json({ success: false, msg: '缺少参数' });

  // 确保内存缓存存在
  if (!users[username] || typeof users[username] !== 'object') {
    const dbUser = await findUserInDB(username);
    if (!dbUser) return res.json({ success: false, msg: '用户不存在' });
  }

  // 解析 base64（支持 data:image/...;base64,xxx 格式）
  let base64 = image;
  const mimeMatch = image.match(/^data:(image\/\w+);base64,(.*)$/);
  if (mimeMatch) {
    base64 = mimeMatch[2];
    var ext = mimeMatch[1].split('/')[1]; // png, jpeg, gif, webp
  } else {
    var ext = 'png';
  }
  if (ext === 'jpeg') ext = 'jpg';

  const buf = Buffer.from(base64, 'base64');
  if (buf.length > 2 * 1024 * 1024) return res.json({ success: false, msg: '图片不能超过 2MB' });

  // 确保目录存在
  const avatarsDir = path.join(__dirname, 'public', 'avatars');
  if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

  const filename = username + '_' + Date.now() + '.' + ext;
  const filePath = path.join(avatarsDir, filename);

  try {
    fs.writeFileSync(filePath, buf);

    // 删除旧自定义头像文件（如果之前有上传过）
    const oldAvatar = users[username].avatar || '';
    if (oldAvatar.startsWith('/avatars/')) {
      const oldPath = path.join(__dirname, 'public', oldAvatar);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const avatarUrl = '/avatars/' + filename;
    users[username].avatar = avatarUrl;
    await updateUserInDB(username, { avatar: avatarUrl });

    res.json({ success: true, msg: '头像上传成功', avatar: avatarUrl });
  } catch (e) {
    console.log('⚠️ 头像上传失败: ' + e.message);
    res.json({ success: false, msg: '上传失败，请重试' });
  }
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
        console.log('从 Supabase 恢复房间 ' + roomId);
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
    // 合并头像映射
    let imgMap = {};
    try {
      imgMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'character-images.json'), 'utf8'));
    } catch (e) { /* ignore */ }
    const result = chars.map(c => ({
      ...c,
      image: imgMap[c.name] || null
    }));
    res.json(result);
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
    // 规范化键名（同时支持中文表头和英文表头）
    const normalized = {};
    Object.keys(obj).forEach(k => {
      const nk = k.trim().toLowerCase()
        .replace(/（/g, '(').replace(/）/g, ')')
        .replace(/\s+/g, '');
      if (nk === '姓名' || nk === '角色' || nk === '角色名' || nk === '名称' || nk === 'name') normalized.name = obj[k];
      else if (nk === '强度' || nk === 'tier') normalized.tier = obj[k];
      else if (nk === '阵营' || nk === '势力' || nk === 'faction') normalized.faction = obj[k];
      else if (nk === '限定技' || nk === 'limit') normalized.limit = obj[k];
      else if (nk === '固有技' || nk === '天赋技' || nk === 'innate') normalized.innate = obj[k];
      else if (nk === '被动技' || nk === '被动' || nk === 'passive') normalized.passive = obj[k];
      else if (nk === '附加技' || nk === '额外技' || nk === '额外' || nk === 'extra') normalized.extra = obj[k];
      else if (nk === '保留' || nk === 'retain') normalized.retain = (obj[k] && (obj[k].toLowerCase() === 'true' || obj[k] === '1' || obj[k] === '是' || obj[k] === 'yes'));
      else if (nk === '备注' || nk === 'note') normalized.note = obj[k];
      else if (nk === '标签' || nk === '定位' || nk === 'tags') normalized.tags = obj[k];
    });
    result.push(normalized);
  }
  return result;
}

// CSV 上传
app.post('/api/upload-csv', express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }), (req, res) => {
  try {
    const result = parseCSV(req.body);
    // 合并头像映射
    let imgMap = {};
    try { imgMap = JSON.parse(fs.readFileSync(IMG_MAP_FILE, 'utf8')); } catch (e) { /* ignore */ }
    const withImages = result.map(c => ({ ...c, image: imgMap[c.name] || null }));
    fs.writeFileSync(CHARS_FILE, JSON.stringify(withImages, null, 2), 'utf8');
    // 同时备份 CSV 到 data 目录
    fs.writeFileSync(CSV_FILE, req.body, 'utf8');
    console.log('✅ CSV 上传成功，共 ' + withImages.length + ' 个角色（含头像映射）');
    res.json({ success: true, count: withImages.length });
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
      const restRoom = rooms[id] || {};
      const isStarted = restRoom.started || false;
      const hostName = r.players[0] ? (r.players[0].nickname || r.players[0].name) : '';
      list.push({
        id: id,
        roomId: id,
        host: hostName,
        players: r.players.map(p => p.name),
        playerCount: r.players.length,
        maxPlayers: r.maxPlayers,
        allReady: r.players.every(p => p.ready),
        playing: !!r.voteEnd,
        started: isStarted,
        round: r.round || 1
      });
    }
  });
  // 也对 REST rooms 中在 socketRooms 中不存在的房间进行检查
  Object.keys(rooms).forEach(id => {
    if (!socketRooms[id] && rooms[id].started) {
      list.push({
        id: id,
        roomId: id,
        host: (rooms[id].players || [])[0] || '',
        players: rooms[id].players || [],
        playerCount: (rooms[id].players || []).length,
        maxPlayers: rooms[id].maxPlayers || 4,
        allReady: false,
        playing: false,
        started: true,
        round: 1
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
        console.log(' 从 Supabase 恢复选角结果 ' + roomId);
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
app.get('/api/battle-selections', async (req, res) => {
  const { roomId } = req.query;
  if (!roomId) return res.json({});

  // 内存已有有效数据直接返回
  if (_hasValidSelections(roomId)) {
    return res.json(battleSelections[roomId]);
  }

  // 内存缺失或为空，尝试从 Supabase 恢复
  const restored = await restoreBattleSelections(roomId);
  if (restored) {
    return res.json(restored);
  }

  return res.json({});
});

// 获取当前房间所有玩家的角色信息
app.get('/api/all-draft', async (req, res) => {
  const { roomId } = req.query;
  if (!roomId) return res.json({});

  // 内存已有
  if (draftResults[roomId]) {
    return res.json(draftResults[roomId]);
  }

  // 内存缺失，从 Supabase 恢复
  try {
    const { data } = await supabase.from('draft_results').select('*').eq('room_id', roomId).single();
    if (data && data.results) {
      draftResults[roomId] = data.results;
      console.log(' 从 Supabase 恢复选角结果 ' + roomId);
      return res.json(data.results);
    }
  } catch (e) { /* ignore */ }

  return res.json({});
});

// ── 对局历史：获取某个玩家的历史对局 ──
app.get('/api/game-history', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json([]);

  try {
    // 先从内存加载（如果不存在则从 Supabase 查询）
    let history = Object.values(gameHistory);
    if (history.length === 0) {
      const { data } = await supabase.from('game_history').select('*').order('ended_at', { ascending: false });
      if (data) {
        data.forEach(h => { gameHistory[h.room_id] = h; });
        history = data;
      }
    }
    const result = history.filter(h => {
      const players = h.players || [];
      return players.includes(username);
    }).map(h => ({
      roomId: h.room_id,
      players: h.players,
      totalRounds: h.total_rounds,
      host: h.host,
      endedAt: h.ended_at,
      playerCount: h.players ? h.players.length : 0
    }));
    res.json(result);
  } catch (e) {
    res.json([]);
  }
});

// ── 对局历史详情 ──
app.get('/api/game-history-detail', async (req, res) => {
  const { roomId } = req.query;
  if (!roomId) return res.json(null);

  try {
    let record = gameHistory[roomId];
    if (!record) {
      const { data } = await supabase.from('game_history').select('*').eq('room_id', roomId).single();
      if (data) {
        record = data;
        gameHistory[roomId] = data;
      }
    }
    if (record) {
      res.json({
        roomId: record.room_id,
        players: record.players,
        totalRounds: record.total_rounds,
        draftResults: record.draft_results,
        host: record.host,
        createdAt: record.created_at,
        endedAt: record.ended_at
      });
    } else {
      res.json(null);
    }
  } catch (e) {
    res.json(null);
  }
});

// ── 房间状态查询（用于重连判断） ──
app.get('/api/room-status', async (req, res) => {
  const { roomId, username } = req.query;
  if (!roomId) return res.json({ exists: false, msg: '未提供房间号' });

  // 检查是否为已结束房间
  if (finishedRooms[roomId]) {
    return res.json({ exists: false, finished: true, msg: '该对局已结束' });
  }
  // 检查历史记录中的已结束房间
  if (gameHistory[roomId]) {
    return res.json({ exists: false, finished: true, msg: '该对局已结束' });
  }

  // 检查活跃房间
  const socketRoom = socketRooms[roomId];
  const restRoom = rooms[roomId];

  if (!socketRoom && !restRoom) {
    // 尝试从 Supabase 恢复
    let found = false;
    try {
      const { data: sr } = await supabase.from('socket_rooms').select('*').eq('room_id', roomId).single();
      if (sr && sr.state_data) {
        socketRooms[roomId] = sr.state_data;
        found = true;
      }
      if (!found) {
        const { data: r } = await supabase.from('rooms').select('*').eq('room_id', roomId).single();
        if (r) {
          rooms[roomId] = { id: r.room_id, host: r.host, players: r.players, maxPlayers: r.max_players, started: r.started, createdAt: r.created_at };
          found = true;
        }
      }
    } catch (e) { /* ignore */ }
    if (!found) {
      return res.json({ exists: false, msg: '房间不存在或已过期' });
    }
  }

  const room = socketRooms[roomId] || {};
  const restR = rooms[roomId] || {};
  const isStarted = restR.started || (room.round > 1);

  // 检查用户是否是该房间的玩家
  const allPlayers = new Set();
  (restR.players || []).forEach(p => allPlayers.add(p));
  if (room.players) room.players.forEach(p => allPlayers.add(p.name));
  const isPlayer = username ? allPlayers.has(username) : false;

  // 判断当前阶段
  let phase = 'lobby'; // 大厅/准备阶段
  if (isStarted) {
    if (draftResults[roomId] && Object.keys(draftResults[roomId]).length > 0) {
      if (battleSelections[roomId] && Object.keys(battleSelections[roomId]).length > 0) {
        phase = 'battle_round'; // 回合对战阶段
      } else if (room.round > 1 && (!battleSelections[roomId] || Object.keys(battleSelections[roomId]).length === 0)) {
        phase = 'game'; // 选将阶段（新回合开始）
      } else {
        phase = 'game'; // 选将阶段
      }
    }
  }

  const playerNames = [...allPlayers];

  res.json({
    exists: true,
    roomId,
    phase,
    isStarted,
    isPlayer,
    players: playerNames,
    round: room.round || 1,
    totalPlayers: playerNames.length,
    host: restR.host || ''
  });
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
    const { roomId = "0000", playerName, username } = data;
    const name = playerName || username;
    socket.playerName = name; // 记录玩家名，用于后续查找

    // 检查房间是否已结束
    if (finishedRooms[roomId]) {
      socket.emit('joinFailed', '该对局已结束');
      return;
    }
    if (gameHistory[roomId]) {
      socket.emit('joinFailed', '该对局已结束，可在大厅查看历史记录');
      return;
    }

    if (!socketRooms[roomId]) {
      socketRooms[roomId] = {
        players: [], maxPlayers: 4, vote: { random: 0, normal: 0 }, voteEnd: false,
        round: 1, roundEndVotes: {}, gameEndVotes: {}, _lastActivity: Date.now()
      };
    }
    const room = socketRooms[roomId];
    touchRoom(roomId);
    if (!room.round) room.round = 1;
    if (!room.roundEndVotes) room.roundEndVotes = {};
    if (!room.gameEndVotes) room.gameEndVotes = {};

    if (room.players.length >= room.maxPlayers) {
      socket.emit('joinFailed', '房间人数已满（最多4人）');
      return;
    }

    const isExist = room.players.some(p => p.id === socket.id);
    if (!isExist) {
      // 获取用户昵称和头像
      const userObj = users[name];
      let nickname = name;
      let avatar = '';
      if (userObj && typeof userObj === 'object') {
        nickname = userObj.nickname || name;
        avatar = userObj.avatar || '';
      }
      room.players.push({
        id: socket.id,
        name: name || `玩家${Math.floor(Math.random() * 1000)}`,
        nickname: nickname,
        avatar: avatar,
        ready: false,
        vote: ''
      });
    } else {
      // 重连时刷新昵称和头像
      const existPlayer = room.players.find(p => p.id === socket.id);
      if (existPlayer) {
        const userObj = users[existPlayer.name];
        if (userObj && typeof userObj === 'object') {
          existPlayer.nickname = userObj.nickname || existPlayer.name;
          existPlayer.avatar = userObj.avatar || '';
        }
      }
    }

    socket.join(roomId);
    saveSocketRooms();

    // 广播玩家列表（不包含出战选择，确保选将阶段保密）
    const hostName = room.players[0] ? (room.players[0].nickname || room.players[0].name) : '';
    io.to(roomId).emit('roomPlayersUpdate', { players: room.players, roomId, host: hostName });
    // 单独发送角色休息状态给该玩家
    const cs = (characterStates[roomId] || {})[name] || {};
    socket.emit('characterStatesUpdate', { states: cs });
    socket.emit('joinSuccess', { players: room.players, host: hostName, roomId });
  });

  socket.on('toggleReady', (data) => {
    const roomId = typeof data === 'object' ? data.roomId : data;
    const room = socketRooms[roomId];
    if (!room) return socket.emit('error', '房间不存在');
    touchRoom(roomId);
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.ready = !player.ready;
      saveSocketRooms();
      const hostName = room.players[0] ? (room.players[0].nickname || room.players[0].name) : '';
      io.to(roomId).emit('roomPlayersUpdate', { players: room.players, roomId, host: hostName });
      if (isAllReady(roomId)) {
        resetRoomVote(roomId);
        io.to(roomId).emit('allReady', {});
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
        // ── 服务端启动选角 ──
        const playerNames = room.players.map(p => p.name);
        if (finalType === 'random') {
          executeRandomDraft(roomId, playerNames);
        } else {
          startPoolDraft(roomId, playerNames);
        }
      }
    }
  });

  // ═══════════════════════════════════════
  //  池选 draft：正常模式（服务端管理）
  // ═══════════════════════════════════════

  // 同步读取角色列表
  function getCharactersSync() {
    const now = Date.now();
    if (!_charCache || now - _charCacheTime > 30000) {
      try { _charCache = JSON.parse(fs.readFileSync(CHARS_FILE, 'utf8')); _charCacheTime = now; } catch (e) { _charCache = []; }
    }
    return _charCache;
  }

  // 发下一轮池（最多10张）
  function dealNextPool(roomId) {
    const dp = draftPools[roomId];
    if (!dp || dp.deck.length === 0) return [];
    const count = Math.min(10, dp.deck.length);
    dp.pool = dp.deck.splice(0, count);
    return dp.pool;
  }

  // 广播当前 draft 状态给房间所有人
  function broadcastDraftState(roomId) {
    const dp = draftPools[roomId];
    if (!dp) return;
    const currentPlayer = dp.currentTurnIndex < dp.pickOrder.length
      ? dp.pickOrder[dp.currentTurnIndex] : null;
    io.to(roomId).emit('draftUpdate', {
      pool: dp.pool,
      currentPlayer,
      hands: dp.hands,
      currentTurnIndex: dp.currentTurnIndex,
      totalPicks: dp.pickOrder.length,
      pickOrderPreview: dp.pickOrder.slice(dp.currentTurnIndex, dp.currentTurnIndex + 6)
    });
  }

  // 正常模式：启动池选 draft
  function startPoolDraft(roomId, playerNames) {
    const chars = getCharactersSync();
    const shuffled = [...chars].sort(() => Math.random() - 0.5);

    // 蛇形（循环）选角顺序：P1→P2→P3→P4→P1→...
    const pickOrder = [];
    const picksPerPlayer = 6;
    const totalPicks = playerNames.length * picksPerPlayer;
    for (let i = 0; i < totalPicks; i++) {
      pickOrder.push(playerNames[i % playerNames.length]);
    }

    const hands = {};
    playerNames.forEach(n => { hands[n] = []; });

    draftPools[roomId] = {
      deck: shuffled,
      pool: [],
      pickOrder,
      currentTurnIndex: 0,
      hands,
      phase: 'picking',
      draftType: 'normal'
    };

    // 发第一轮池
    dealNextPool(roomId);

    // 通知所有玩家
    const currentPlayer = pickOrder[0];
    io.to(roomId).emit('draftPoolStart', {
      type: 'normal',
      pool: draftPools[roomId].pool,
      currentPlayer,
      hands,
      currentTurnIndex: 0,
      totalPicks,
      pickOrderPreview: pickOrder.slice(0, 6),
      pickOrder // 完整顺序供客户端显示"你是第几个选"
    });
  }

  // 随机模式：直接分配角色（每人仅看自己的）
  function executeRandomDraft(roomId, playerNames) {
    const chars = getCharactersSync();
    const pool = [...chars];
    const result = {};

    playerNames.forEach(name => {
      result[name] = [];
      for (let i = 0; i < 6; i++) {
        if (pool.length === 0) break;
        const idx = Math.floor(Math.random() * pool.length);
        result[name].push(pool.splice(idx, 1)[0]);
      }
    });

    draftResults[roomId] = result;
    saveDraftResults();

    if (rooms[roomId]) {
      rooms[roomId].started = true;
      saveRooms();
    }

    // 每位玩家只能看到自己的角色
    playerNames.forEach(name => {
      const socket = findSocketByPlayerName(roomId, name);
      if (socket) {
        socket.emit('draftRandomResult', {
          type: 'random',
          characters: result[name],
          allPlayerNames: playerNames
        });
      }
    });

    // 通知所有人选角完成
    io.to(roomId).emit('draftAllDone', {
      type: 'random',
      msg: '角色已随机分配完成！'
    });
  }

  // 玩家从池中选角
  socket.on('draftPick', (data) => {
    const { roomId, characterName, playerName } = data;
    const dp = draftPools[roomId];
    if (!dp || dp.phase !== 'picking') {
      socket.emit('error', '选角状态异常');
      return;
    }

    const currentPlayer = dp.pickOrder[dp.currentTurnIndex];
    if (currentPlayer !== playerName) {
      socket.emit('error', '还没轮到你选角');
      return;
    }

    // 在池中查找角色
    const charIdx = dp.pool.findIndex(c => c.name === characterName);
    if (charIdx === -1) {
      socket.emit('error', '该角色不在当前池中');
      return;
    }

    // 移除并加入手牌
    const picked = dp.pool.splice(charIdx, 1)[0];
    dp.hands[playerName].push(picked);
    touchRoom(roomId);

    console.log(`🎯 ${playerName} 从池中选取了 ${characterName}（手牌 ${dp.hands[playerName].length}/6）`);

    // 推进回合
    dp.currentTurnIndex++;

    const allDone = dp.currentTurnIndex >= dp.pickOrder.length;

    // 如果池空了且还没选完，发下一轮
    if (dp.pool.length === 0 && !allDone) {
      dealNextPool(roomId);
    }

    if (allDone) {
      // 选角完成
      dp.phase = 'complete';
      draftResults[roomId] = dp.hands;
      saveDraftResults();

      if (rooms[roomId]) {
        rooms[roomId].started = true;
        saveRooms();
      }

      io.to(roomId).emit('draftAllDone', {
        type: 'normal',
        hands: dp.hands,
        msg: '选角完成！'
      });
    } else {
      // 广播更新状态
      broadcastDraftState(roomId);
    }

    saveSocketRooms();
  });

  // 查询 draft 状态（重连用）
  socket.on('getDraftState', (roomId) => {
    const dp = draftPools[roomId];
    if (!dp) {
      // 检查是否已完成
      if (draftResults[roomId]) {
        socket.emit('draftAllDone', {
          type: 'finished',
          hands: draftResults[roomId],
          msg: '选角已完成'
        });
      }
      return;
    }
    const playerName = socket.playerName;
    if (dp.draftType === 'random' && draftResults[roomId]) {
      socket.emit('draftRandomResult', {
        type: 'random',
        characters: draftResults[roomId][playerName] || [],
        allPlayerNames: Object.keys(draftResults[roomId])
      });
      socket.emit('draftAllDone', {
        type: 'random',
        msg: '角色已随机分配完成！'
      });
    } else if (dp.phase === 'picking') {
      socket.emit('draftPoolStart', {
        type: 'normal',
        pool: dp.pool,
        currentPlayer: dp.pickOrder[dp.currentTurnIndex],
        hands: dp.hands,
        currentTurnIndex: dp.currentTurnIndex,
        totalPicks: dp.pickOrder.length,
        pickOrderPreview: dp.pickOrder.slice(dp.currentTurnIndex, dp.currentTurnIndex + 6),
        pickOrder: dp.pickOrder
      });
    } else if (dp.phase === 'complete') {
      socket.emit('draftAllDone', {
        type: 'normal',
        hands: dp.hands,
        msg: '选角已完成'
      });
    }
  });

  // ── 作战选将：玩家选择出战角色（选择内容保密，仅本人可见） ──
  socket.on('selectBattleCharacter', (data) => {
    const { roomId, characterName, playerName } = data;
    if (!roomId || !characterName || !playerName) return;
    touchRoom(roomId);

    if (!battleSelections[roomId]) battleSelections[roomId] = {};

    // 检查角色是否在休息状态（保留角色不受影响）
    const playerStates = (characterStates[roomId] || {})[playerName] || {};
    if (playerStates[characterName] && playerStates[characterName].resting) {
      const charData = getCharacterData(characterName);
      if (!charData || !charData.retain) {
        socket.emit('error', '该角色正在休息中，无法出战');
        return;
      }
      console.log(` ${playerName} 的 ${characterName} 拥有保留效果，休息状态下出战`);
    }

    // 记录选择
    battleSelections[roomId][playerName] = characterName;
    saveBattleSelections(); // 立即持久化，防止重启丢失
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
      // 持久化角色状态（防止服务器重启丢失）
      saveCharacterStates();
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
      saveBattleSelections(); // 持久化更新
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
    touchRoom(roomId);
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
      saveBattleSelections(); // 持久化清空
      io.to(roomId).emit('roundAdvanced', { round: room.round });
    }
    saveSocketRooms();
  });

  socket.on('voteEndGame', async (roomId) => {
    const room = socketRooms[roomId];
    if (!room) return;
    if (!room.gameEndVotes) room.gameEndVotes = {};
    room.gameEndVotes[socket.id] = true;
    touchRoom(roomId);
    const votedCount = Object.keys(room.gameEndVotes).length;
    const totalCount = room.players.length;
    const votedNames = room.players.filter(p => room.gameEndVotes[p.id]).map(p => p.name);
    io.to(roomId).emit('gameEndVoteUpdate', { voted: votedCount, total: totalCount, votedNames });
    if (votedCount >= totalCount && totalCount > 0) {
      // ── 保存对局历史 ──
      const playerNames = room.players.map(p => p.name);
      const restRoom = rooms[roomId] || {};
      const allPlayers = [...new Set([...playerNames, ...(restRoom.players || [])])];
      await saveGameHistory(roomId, {
        players: allPlayers,
        totalRounds: room.round || 1,
        draftResults: draftResults[roomId] || {},
        host: restRoom.host || '',
        createdAt: restRoom.createdAt || null,
        endedAt: new Date().toISOString()
      });
      // 标记为已结束，阻止重连
      finishedRooms[roomId] = Date.now();
      // ── 清理作战选将和角色状态 ──
      delete battleSelections[roomId];
      delete draftPools[roomId];
      await saveBattleSelections(); // 持久化删除
      delete characterStates[roomId];
      room.gameEndVotes = {};
      room.round = 1;
      // 清除活跃房间数据
      await deleteRoomData(roomId);
      io.to(roomId).emit('gameEnded', { msg: '全部玩家同意，对局结束！即将返回大厅。', roomId });
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

  // ── battle_round.html 专用：请求完整对战数据 ──
  socket.on('requestBattleRoundData', async (roomId) => {
    const room = socketRooms[roomId];
    if (!room) {
      // 房间不在内存中，但数据可能仍在 Supabase 中，尝试恢复
      await restoreBattleSelections(roomId);
      if (!draftResults[roomId]) {
        try {
          const { data } = await supabase.from('draft_results').select('*').eq('room_id', roomId).single();
          if (data && data.results) draftResults[roomId] = data.results;
        } catch (e) { /* ignore */ }
      }
      return socket.emit('battleRoundData', {
        roomId,
        round: 1,
        draft: draftResults[roomId] || {},
        selections: battleSelections[roomId] || {},
        totalPlayers: 0,
        players: []
      });
    }

    // 确保数据从 Supabase 恢复（空对象也视为无效）
    if (!_hasValidSelections(roomId)) await restoreBattleSelections(roomId);
    if (!draftResults[roomId]) {
      try {
        const { data } = await supabase.from('draft_results').select('*').eq('room_id', roomId).single();
        if (data && data.results) draftResults[roomId] = data.results;
      } catch (e) { /* ignore */ }
    }

    // 构建玩家资料列表（用于前端展示昵称和头像）
    const playerProfiles = room.players.map(p => ({
      name: p.name,
      nickname: p.nickname || p.name,
      avatar: p.avatar || ''
    }));

    socket.emit('battleRoundData', {
      roomId,
      round: room.round || 1,
      draft: draftResults[roomId] || {},
      selections: battleSelections[roomId] || {},
      totalPlayers: room.players.length,
      players: playerProfiles
    });
  });

  // ── 用户资料变更广播 ──
  socket.on('profileChanged', (data) => {
    const { username: playerName, nickname, avatar } = data || {};
    if (!playerName) return;

    // 更新所有该用户所在房间中的玩家记录
    Object.keys(socketRooms).forEach(rid => {
      const room = socketRooms[rid];
      const player = room.players.find(p => p.name === playerName);
      if (player) {
        if (nickname) player.nickname = nickname;
        if (avatar) player.avatar = avatar;
        // 广播更新后的玩家列表
        io.to(rid).emit('roomPlayersUpdate', { players: room.players, roomId: rid });
      }
    });

    // 也更新内存中的用户缓存
    if (users[playerName] && typeof users[playerName] === 'object') {
      if (nickname) users[playerName].nickname = nickname;
      if (avatar) users[playerName].avatar = avatar;
    }
  });

  socket.on('disconnect', () => {
    Object.keys(socketRooms).forEach(roomId => {
      const room = socketRooms[roomId];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx > -1) {
        const playerName = room.players[idx].name;
        room.players.splice(idx, 1);
        touchRoom(roomId);
        // 不删除作战选择：断开连接不是真正的退出游戏，玩家重连后仍需保留其选择
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
  cleanupStaleSelections(); // 异步清理过期数据，不阻塞启动
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
