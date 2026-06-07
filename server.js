require('dotenv').config();
const express = require('express');
const compression = require('compression');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const cloudbase = require('@cloudbase/node-sdk');

// ── CloudBase 云存储 ──
const TCB_ENV = 'sr-mahjong-d0g8mp6w19f37dd37';
let tcbApp = null;
if (process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY) {
  tcbApp = cloudbase.init({
    env: TCB_ENV,
    secretId: process.env.TENCENT_SECRET_ID,
    secretKey: process.env.TENCENT_SECRET_KEY
  });
  console.log('✅ CloudBase SDK 已初始化');
} else {
  console.log('⚠️ 未配置 TENCENT_SECRET_ID/TENCENT_SECRET_KEY，CloudBase 云存储不可用，头像将使用本地存储');
}
const AVATAR_CACHE = new Map(); // fileID → { url, expires }

const app = express();

// Gzip/Brotli 压缩（文本资源体积缩小 70%+）
app.use(compression());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

// ── 首页重定向到登录页 ──
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

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

// 角色头像：CloudBase 静态托管 CDN（sr-mahjong-d0g8mp6w19f37dd37-1324905494.tcloudbaseapp.com）
// 用户自定义头像：CloudBase 云存储（cloud:// fileID）

// ── 辅助：解析 CloudBase 头像 CDN 地址 ──
async function resolveAvatarUrl(avatar) {
  if (!avatar) return '';
  // CloudBase fileID → 解析为临时 CDN URL
  if (avatar.startsWith('cloud://')) {
    if (!tcbApp) return ''; // SDK 未初始化，无法解析
    const cached = AVATAR_CACHE.get(avatar);
    if (cached && cached.expires > Date.now()) return cached.url;
    try {
      const result = await tcbApp.getTempFileURL({
        fileList: [{ fileID: avatar, maxAge: 7200 }] // 2 小时有效期
      });
      const url = result.fileList?.[0]?.tempFileURL || result.fileList?.[0]?.download_url || '';
      if (url) {
        AVATAR_CACHE.set(avatar, { url, expires: Date.now() + 7000 * 1000 }); // 缓存 1.9h
      }
      return url;
    } catch (e) { return ''; }
  }
  return avatar;
}

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

// ── Supabase 客户端 ──
const supabaseUrl = process.env.SUPABASE_URL || 'https://rvdvdgriyleoiuglzgch.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2ZHZkZ3JpeWxlb2l1Z2x6Z2NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTk2NjQsImV4cCI6MjA5NTczNTY2NH0.ReGBK9H8xV0uReWiUWJe0Vo2hO4Jp66ou9pxjI2a3G4';
const supabase = createClient(supabaseUrl, supabaseKey);

// ── 管理员配置 ──
const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
const SERVER_START_TIME = Date.now();
function isAdmin(username) {
  return ADMIN_USERS.length > 0 && ADMIN_USERS.includes(username);
}

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
// roundBattleHistory[roomId] = [{ round: 1, selections: { "playerA": "宫永咲", ... }}, ...]
let roundBattleHistory = {};

// ── 从 Supabase 加载数据到内存缓存 ──
async function loadFromDB() {
  try {
    // 加载用户
    const { data: userData } = await supabase.from('users').select('*');
    if (userData) {
      users = {};
      userData.forEach(u => {
        let avatarHistory = [];
        try {
          if (u.avatar_history) {
            avatarHistory = Array.isArray(u.avatar_history) ? u.avatar_history : JSON.parse(u.avatar_history);
          }
        } catch (_) { avatarHistory = []; }
        users[u.username] = { password: u.password, nickname: u.nickname || u.username, avatar: u.avatar || '', bio: u.bio || '', avatar_history: avatarHistory };
      });
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
      srData.forEach(r => {
        socketRooms[r.room_id] = r.state_data;
        // 恢复进行中的 draft pool 状态
        if (r.state_data._draftPool) {
          draftPools[r.room_id] = r.state_data._draftPool;
        }
      });
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
      finishedRooms = {};
      ghData.forEach(h => {
        gameHistory[h.room_id] = { room_id: h.room_id, game_id: h.game_id, players: h.players, totalRounds: h.total_rounds, draftResults: h.draft_results, battle_history: h.battle_history, host: h.host, createdAt: h.created_at, startedAt: h.started_at, endedAt: h.ended_at };
        finishedRooms[h.room_id] = new Date(h.ended_at).getTime();
      });
      console.log('✅ 从 Supabase 加载 ' + ghData.length + ' 条对局历史');
    }

    // 加载角色数据
    await loadCharactersFromDB();

  } catch (e) {
    console.log('❌ Supabase 加载失败，服务器将以空数据启动: ' + e.message);
    console.log('⚠️ 请检查 SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量');
    // 角色数据也需要初始化（否则游戏无法进行）
    _charCache = [];
    _charCacheTime = Date.now();
  }
}

// 从 Supabase 加载角色数据（含自动建表和初始种数据）
async function loadCharactersFromDB() {
  try {
    const { data, error } = await supabase.from('characters').select('*');
    if (error) {
      // 表可能不存在，尝试自动创建
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        console.log('⚠️ characters 表不存在，尝试从本地 JSON 种数据...');
        return seedCharactersFromLocal();
      }
      throw error;
    }
    if (data && data.length > 0) {
      _charCache = data;
      _charCacheTime = Date.now();
      console.log('✅ 从 Supabase 加载 ' + data.length + ' 个角色');
      return;
    }
    // 表存在但为空，自动种数据
    console.log('⚠️ characters 表为空，从本地 JSON 种数据...');
    return seedCharactersFromLocal();
  } catch (e) {
    console.log('⚠️ Supabase 角色加载失败: ' + e.message);
    _charCache = [];
    _charCacheTime = Date.now();
  }
}

// 从本地 characters.json 读取数据并种入 Supabase（仅首次初始化/迁移用）
async function seedCharactersFromLocal() {
  const CHARS_FILE = path.join(__dirname, 'data', 'characters.json');
  let locals;
  try {
    locals = JSON.parse(fs.readFileSync(CHARS_FILE, 'utf8'));
  } catch (e) {
    console.log('⚠️ 无法读取本地 characters.json: ' + e.message);
    _charCache = [];
    _charCacheTime = Date.now();
    return;
  }
  if (!locals || locals.length === 0) { _charCache = []; _charCacheTime = Date.now(); return; }

  try {
    const { error } = await supabase.from('characters').upsert(locals, { onConflict: 'id' });
    if (error) {
      console.log('⚠️ 角色数据种子到 Supabase 失败: ' + error.message + '，仅加载到内存');
    } else {
      console.log('✅ 已从本地 JSON 种 ' + locals.length + ' 个角色到 Supabase');
    }
  } catch (e) {
    console.log('⚠️ 种子角色失败: ' + e.message + '，仅加载到内存');
  }
  _charCache = locals;
  _charCacheTime = Date.now();
}

// ── 从 Supabase 查询单个用户（登录时内存缓存缺失的兜底） ──
async function findUserInDB(username) {
  try {
    const { data, error } = await supabase.from('users').select('*').eq('username', username).maybeSingle();
    if (error) { console.log('⚠️ findUserInDB 查询失败: ' + error.message); return null; }
    if (data) {
      let history = [];
      try {
        if (data.avatar_history) {
          history = Array.isArray(data.avatar_history) ? data.avatar_history : JSON.parse(data.avatar_history);
        }
      } catch (_) { history = []; }
      users[data.username] = { password: data.password, nickname: data.nickname || data.username, avatar: data.avatar || '', bio: data.bio || '', avatar_history: history }; // 回填到内存缓存
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
        started_at: room.startedAt || null,
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
  if (!_charCache || _charCache.length === 0) return null;
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
    // 生成唯一对局 ID（已存在的保留）
    const existing = gameHistory[roomId];
    const gameId = (existing && existing.game_id) || ('g' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8));
    const battleHistory = roundBattleHistory[roomId] || [];
    await supabase.from('game_history').upsert({
      room_id: roomId,
      game_id: gameId,
      players: data.players || [],
      total_rounds: data.totalRounds || 0,
      draft_results: data.draftResults || {},
      battle_history: battleHistory,
      host: data.host || '',
      created_at: data.createdAt || new Date().toISOString(),
      started_at: data.startedAt || null,
      ended_at: data.endedAt || new Date().toISOString()
    }, { onConflict: 'room_id' });
    gameHistory[roomId] = { ...data, game_id: gameId, battle_history: battleHistory };
    // 清理回合出战历史内存
    delete roundBattleHistory[roomId];
    console.log('📝 对局历史已保存: ' + roomId + ' (ID: ' + gameId + ')');
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
          startedAt: rooms[roomId] ? rooms[roomId].startedAt : null,
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
  const displayAvatar = await resolveAvatarUrl(profile.avatar);
  res.json({ success: true, msg: '登录成功', nickname: profile.nickname, avatar: displayAvatar });
});

// ── 获取用户资料 ──
app.get('/api/profile', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ success: false, msg: '缺少用户名' });

  const userObj = users[username];
  if (userObj && typeof userObj === 'object') {
    const displayAvatar = await resolveAvatarUrl(userObj.avatar || '');
    return res.json({
      success: true,
      username,
      nickname: userObj.nickname || username,
      avatar: displayAvatar,
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

  const displayAvatar = await resolveAvatarUrl(users[username].avatar);
  res.json({
    success: true,
    msg: '资料已更新',
    nickname: users[username].nickname,
    avatar: displayAvatar,
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

// ── 上传自定义头像（CloudBase 云存储） ──
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

  const filename = username + '_' + Date.now() + '.' + ext;
  const cloudPath = 'avatars/' + filename;

  // 先获取旧头像 fileID
  const oldAvatar = users[username].avatar || '';

  // CloudBase 云存储上传
  if (!tcbApp) return res.json({ success: false, msg: 'CloudBase SDK 未初始化，请配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY' });

  try {
    const uploadResult = await tcbApp.uploadFile({
      cloudPath: cloudPath,
      fileContent: buf
    });
    const fileID = uploadResult.fileID;

    // 保存旧头像到历史记录（最多保留 10 个）
    if (!users[username].avatar_history) users[username].avatar_history = [];
    if (oldAvatar && oldAvatar.startsWith('cloud://')) {
      // 不重复添加
      if (!users[username].avatar_history.includes(oldAvatar)) {
        users[username].avatar_history.unshift(oldAvatar);
        if (users[username].avatar_history.length > 10) {
          // 删除最旧的 CloudBase 文件
          const removed = users[username].avatar_history.pop();
          try { await tcbApp.deleteFile({ fileList: [removed] }); } catch (_) {}
        }
      }
      // 注意：不再删除 CloudBase 上的旧头像文件（改为加入历史供切换）
    }

    // 解析为临时 CDN URL
    const tempRes = await tcbApp.getTempFileURL({
      fileList: [{ fileID: fileID, maxAge: 86400 }] // 24h
    });
    const displayUrl = tempRes.fileList?.[0]?.tempFileURL || tempRes.fileList?.[0]?.download_url || '';

    users[username].avatar = fileID;
    users[username]._avatarUrl = displayUrl;
    AVATAR_CACHE.set(fileID, { url: displayUrl, expires: Date.now() + 85000 * 1000 });
    await updateUserInDB(username, { avatar: fileID, avatar_history: users[username].avatar_history });

    console.log('✅ 头像上传成功: ' + fileID + ' | CDN: ' + displayUrl);
    res.json({ success: true, msg: '头像上传成功', avatar: displayUrl });
  } catch (err) {
    console.log('❌ 头像上传失败: ' + err.message);
    res.json({ success: false, msg: '上传失败: ' + err.message });
  }
});

// ── 头像历史记录 ──
app.get('/api/avatar-history', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ success: false, history: [] });

  const userObj = users[username];
  if (!userObj || typeof userObj !== 'object') return res.json({ success: false, history: [] });

  const history = userObj.avatar_history || [];
  // 解析所有 cloud:// fileID 为 CDN URL
  const resolved = await Promise.all(history.map(async (fileID) => {
    if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) return fileID;
    return await resolveAvatarUrl(fileID) || fileID;
  }));

  res.json({ success: true, history: resolved, rawHistory: history });
});

// 切换使用历史头像
app.post('/api/use-avatar', async (req, res) => {
  const { username, avatarIndex } = req.body;
  if (!username || avatarIndex === undefined) return res.json({ success: false, msg: '缺少参数' });

  const userObj = users[username];
  if (!userObj || !userObj.avatar_history) return res.json({ success: false, msg: '无历史头像' });

  const idx = parseInt(avatarIndex);
  const history = userObj.avatar_history;
  if (idx < 0 || idx >= history.length) return res.json({ success: false, msg: '索引无效' });

  // 把当前头像也加入历史
  const current = userObj.avatar || '';
  if (current && current.startsWith('cloud://')) {
    history.unshift(current);
    if (history.length > 10) {
      const removed = history.pop();
      if (tcbApp) try { await tcbApp.deleteFile({ fileList: [removed] }); } catch (_) {}
    }
  }

  // 使用选中的历史头像
  const selected = history.splice(idx, 1)[0];
  userObj.avatar = selected;
  userObj.avatar_history = history;

  const displayUrl = await resolveAvatarUrl(selected);
  userObj._avatarUrl = displayUrl;

  await updateUserInDB(username, { avatar: selected, avatar_history: history });

  res.json({ success: true, avatar: displayUrl });
});

// 创建房间（lobby 流程）
app.post('/api/create-room', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ success: false, msg: '用户名为空' });
  try {
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
    await saveRooms(); // 等待 Supabase 持久化完成
    console.log('✅ 房间 ' + roomId + ' 已创建（房主: ' + username + '）');
    res.json({ success: true, roomId });
  } catch (e) {
    console.error('❌ 创建房间失败: ' + (e.message || e));
    res.json({ success: false, msg: '服务器错误，请稍后重试' });
  }
});

// 加入房间（支持内存未命中时从 Supabase 查询）
app.post('/api/join-room', async (req, res) => {
  const { username, roomId } = req.body;
  if (!username || !roomId) return res.json({ success: false, msg: '参数不完整' });

  let room = rooms[roomId];
  // 内存未命中，从 Supabase 查询
  if (!room) {
    try {
      const { data, error } = await supabase.from('rooms').select('*').eq('room_id', roomId).maybeSingle();
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
  res.json(_charCache || []);
});

// JSON 上传 — 直接写入 Supabase
app.post('/api/upload-json', async (req, res) => {
  try {
    const chars = req.body;
    if (!Array.isArray(chars)) {
      return res.json({ success: false, msg: 'JSON 必须是一个角色数组' });
    }

    const { error } = await supabase.from('characters').upsert(chars, { onConflict: 'id' });
    if (error) {
      console.log('❌ Supabase 角色写入失败: ' + error.message);
      return res.json({ success: false, msg: '数据库写入失败: ' + error.message });
    }

    // 更新内存缓存
    _charCache = chars;
    _charCacheTime = Date.now();

    console.log('✅ 角色数据已上传到 Supabase，共 ' + chars.length + ' 个角色');
    res.json({ success: true, count: chars.length });
  } catch (e) {
    res.json({ success: false, msg: e.message });
  }
});

// 开始游戏
app.post('/api/start-game', async (req, res) => {
  const { roomId } = req.body;
  if (roomId && rooms[roomId]) {
    rooms[roomId].started = true;
    rooms[roomId].startedAt = rooms[roomId].startedAt || new Date().toISOString();
    saveRooms();
  }
  res.json({ success: true });
});

// 获取活跃房间列表（含玩家头像）
app.get('/api/rooms', async (req, res) => {
  const list = [];
  // 收集需要解析头像的玩家
  const playerLookups = []; // { roomIndex, playerIndex }

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
        playerDetails: [],
        playerCount: r.players.length,
        maxPlayers: r.maxPlayers,
        allReady: r.players.every(p => p.ready),
        playing: !!r.voteEnd,
        started: isStarted,
        round: r.round || 1
      });
      const roomIndex = list.length - 1;
      r.players.forEach((p, pi) => {
        const userObj = users[p.name];
        const rawAvatar = (p.avatar || (userObj && userObj.avatar) || '');
        playerLookups.push({ roomIndex, playerIndex: pi, name: p.name, rawAvatar });
      });
    }
  });

  // 解析所有头像 CDN URL（并发）
  const resolved = await Promise.all(
    playerLookups.map(pl => resolveAvatarUrl(pl.rawAvatar).then(url => ({ ...pl, url })))
  );

  resolved.forEach(pl => {
    if (!list[pl.roomIndex].playerDetails) list[pl.roomIndex].playerDetails = [];
    list[pl.roomIndex].playerDetails[pl.playerIndex] = {
      name: pl.name,
      avatar: pl.url
    };
  });

  // 也对 REST rooms 中在 socketRooms 中不存在的房间进行检查
  Object.keys(rooms).forEach(id => {
    if (!socketRooms[id] && rooms[id].started) {
      const pNames = rooms[id].players || [];
      list.push({
        id: id,
        roomId: id,
        host: pNames[0] || '',
        players: pNames,
        playerDetails: pNames.map(n => ({ name: n, avatar: '' })),
        playerCount: pNames.length,
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
    rooms[roomId].startedAt = rooms[roomId].startedAt || new Date().toISOString();
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
  const { username, sort, search } = req.query;
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
    let result = history.filter(h => {
      const players = h.players || [];
      return players.includes(username);
    });

    // ID 搜索过滤
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(h => {
        if (h.game_id && h.game_id.toLowerCase().includes(q)) return true;
        if (h.room_id && h.room_id.includes(q)) return true;
        return false;
      });
    }

    // 排序：默认倒序（新→旧），支持 asc 正序
    result.sort((a, b) => {
      const ta = new Date(a.ended_at || a.endedAt || a.created_at || a.createdAt || 0).getTime();
      const tb = new Date(b.ended_at || b.endedAt || b.created_at || b.createdAt || 0).getTime();
      return sort === 'asc' ? ta - tb : tb - ta;
    });

    res.json(result.map(h => ({
      roomId: h.room_id || h.roomId,
      gameId: (h.game_id || h.gameId) || '',
      players: h.players,
      totalRounds: h.total_rounds || h.totalRounds,
      host: h.host,
      endedAt: h.ended_at || h.endedAt,
      createdAt: h.created_at || h.createdAt,
      playerCount: h.players ? h.players.length : 0
    })));
  } catch (e) {
    res.json([]);
  }
});

// ── 对局历史详情 ──
app.get('/api/game-history-detail', async (req, res) => {
  const { roomId, gameId } = req.query;
  const lookup = roomId || gameId;
  if (!lookup) return res.status(400).json({ error: 'missing param', detail: null });

  try {
    let record = null;

    // 1) 优先用 gameId / roomId 从内存查找
    for (const h of Object.values(gameHistory)) {
      if ((roomId && h.room_id === roomId) || (gameId && h.game_id === gameId)) {
        record = h;
        break;
      }
    }

    // 2) 内存未命中 → 查 Supabase（确保跨实例可用）
    if (!record) {
      let query = supabase.from('game_history').select('*');
      query = roomId ? query.eq('room_id', roomId) : query.eq('game_id', gameId);
      const { data, error: sbError } = await query.maybeSingle();
      if (sbError) {
        console.error('[game-history-detail] Supabase error:', JSON.stringify(sbError));
      }
      if (data) {
        record = data;
        gameHistory[data.room_id] = data; // 回填缓存
      }
    }

    if (record) {
      res.json({
        roomId: record.room_id || record.roomId,
        gameId: (record.game_id || record.gameId) || '',
        players: record.players,
        totalRounds: record.total_rounds || record.totalRounds,
        draftResults: record.draft_results || record.draftResults,
        battleHistory: record.battle_history || record.battleHistory || [],
        host: record.host,
        createdAt: record.created_at || record.createdAt,
        endedAt: record.ended_at || record.endedAt
      });
    } else {
      console.warn('[game-history-detail] not found, lookup:', lookup);
      res.json(null);
    }
  } catch (e) {
    console.error('[game-history-detail] exception:', e.message || e);
    res.status(500).json({ error: e.message || 'unknown', detail: null });
  }
});

// ── 管理员检测（轻量，不返回 403 避免前端误判） ──
app.get('/api/admin/check', (req, res) => {
  const { username } = req.query;
  const admin = !!(username && isAdmin(username));
  res.json({ success: true, isAdmin: admin, adminUsers: ADMIN_USERS.length });
});

// ── 管理员面板 ──
app.post('/api/admin/restart', (req, res) => {
  const { username } = req.body;
  if (!isAdmin(username)) return res.status(403).json({ success: false, msg: '无管理员权限' });
  console.log('🔁 管理员 ' + username + ' 触发了服务器重启');
  res.json({ success: true, msg: '服务器将在 1 秒后重启' });
  setTimeout(() => { process.exit(0); }, 1000);
});

app.get('/api/admin/status', (req, res) => {
  const { username } = req.query;
  if (!isAdmin(username)) return res.status(403).json({ success: false, msg: '无管理员权限' });
  const uptime = Math.floor((Date.now() - SERVER_START_TIME) / 1000);
  const formatUptime = () => {
    const d = Math.floor(uptime / 86400);
    const h = Math.floor((uptime % 86400) / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = uptime % 60;
    return (d > 0 ? d + '天 ' : '') + h + '时 ' + m + '分 ' + s + '秒';
  };
  const mem = process.memoryUsage();
  res.json({
    success: true,
    uptime: formatUptime(),
    uptimeSeconds: uptime,
    memory: Math.round(mem.heapUsed / 1024 / 1024) + ' MB',
    nodeVersion: process.version,
    activeRooms: Object.keys(socketRooms).length,
    connectedPlayers: Object.values(socketRooms).reduce((a, r) => a + (r.players ? r.players.length : 0), 0)
  });
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

  // 同步读取角色列表（启动时已从 Supabase 加载到内存）
  function getCharactersSync() {
    return _charCache || [];
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

    // 持久化 draft pool 状态（防止服务器重启丢失）
    socketRooms[roomId]._draftPool = draftPools[roomId];
    saveSocketRooms();
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
      rooms[roomId].startedAt = rooms[roomId].startedAt || new Date().toISOString();
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
      // 清除持久化的 draft pool 状态
      if (socketRooms[roomId]) delete socketRooms[roomId]._draftPool;

      if (rooms[roomId]) {
        rooms[roomId].started = true;
        rooms[roomId].startedAt = rooms[roomId].startedAt || new Date().toISOString();
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
      // 持久化当前 draft pool 状态
      if (socketRooms[roomId]) {
        socketRooms[roomId]._draftPool = dp;
        saveSocketRooms();
      }
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
    // 找到当前 socket 对应的玩家
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const playerName = player.name;
    if (!room.roundEndVotes) room.roundEndVotes = {};
    // 用玩家名（持久标识）替代 socket.id 做投票 key，防止刷新换 ID 后重复投票
    room.roundEndVotes[playerName] = true;
    const votedCount = Object.keys(room.roundEndVotes).length;
    const totalCount = room.players.length;
    const votedNames = room.players.filter(p => room.roundEndVotes[p.name]).map(p => p.name);
    io.to(roomId).emit('roundEndVoteUpdate', { voted: votedCount, total: totalCount, votedNames });
    if (votedCount >= totalCount && totalCount > 0) {
      // ── 保存本轮出战选择到历史（用于对局记录回放）──
      if (!roundBattleHistory[roomId]) roundBattleHistory[roomId] = [];
      const currentRound = room.round || 1;
      const currentSelections = { ...(battleSelections[roomId] || {}) };
      if (Object.keys(currentSelections).length > 0) {
        roundBattleHistory[roomId].push({ round: currentRound, selections: currentSelections });
      }
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
    // 找到当前 socket 对应的玩家
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const playerName = player.name;
    if (!room.gameEndVotes) room.gameEndVotes = {};
    // 用玩家名（持久标识）替代 socket.id 做投票 key，防止刷新换 ID 后重复投票
    room.gameEndVotes[playerName] = true;
    touchRoom(roomId);
    const votedCount = Object.keys(room.gameEndVotes).length;
    const totalCount = room.players.length;
    const votedNames = room.players.filter(p => room.gameEndVotes[p.name]).map(p => p.name);
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
        startedAt: restRoom.startedAt || null,
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
      // 只统计当前在线玩家的有效投票数
      const activeNames = new Set(room.players.map(p => p.name));
      const roundVotes = room.roundEndVotes ? Object.keys(room.roundEndVotes).filter(k => activeNames.has(k)).length : 0;
      const gameVotes = room.gameEndVotes ? Object.keys(room.gameEndVotes).filter(k => activeNames.has(k)).length : 0;
      socket.emit('roomState', {
        round: room.round || 1,
        roundEndVotes: roundVotes,
        gameEndVotes: gameVotes,
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
        // 清理该玩家的投票记录，防止断开后残留旧投票
        if (room.roundEndVotes) delete room.roundEndVotes[playerName];
        if (room.gameEndVotes) delete room.gameEndVotes[playerName];
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
  console.log('   - 首页/登录: http://localhost:' + PORT + '/');
  console.log('   - 大厅页:  http://localhost:' + PORT + '/lobby.html');
  console.log('   - 房间页:  http://localhost:' + PORT + '/index.html');
    console.log('   - 对局页:  http://localhost:' + PORT + '/game.html');
    console.log('   - 回合页:  http://localhost:' + PORT + '/battle_round.html');
  });
}
start();
