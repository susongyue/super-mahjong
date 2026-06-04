/**
 * api.js — REST API 封装
 * 依赖: 无
 */
window.API = {
  // ── 用户 ──
  async login(username, password) {
    return fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then(x => x.json());
  },

  async register(username, password, nickname) {
    return fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, nickname: nickname || username, avatar: '' })
    }).then(x => x.json());
  },

  async getProfile(username) {
    return fetch('/api/profile?username=' + encodeURIComponent(username)).then(x => x.json());
  },

  async updateProfile(username, nickname, avatar, bio) {
    return fetch('/api/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, nickname, avatar, bio })
    }).then(x => x.json());
  },

  async changePassword(username, oldPassword, newPassword) {
    return fetch('/api/change-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, oldPassword, newPassword })
    }).then(x => x.json());
  },

  async uploadAvatar(username, image) {
    return fetch('/api/upload-avatar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, image })
    }).then(x => x.json());
  },

  // ── 房间 ──
  async createRoom(username) {
    return fetch('/api/create-room', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    }).then(x => x.json());
  },

  async joinRoom(username, roomId) {
    return fetch('/api/join-room', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, roomId })
    }).then(x => x.json());
  },

  async getRoomStatus(roomId, username) {
    return fetch('/api/room-status?roomId=' + roomId + '&username=' + encodeURIComponent(username))
      .then(x => x.json());
  },

  async getRooms() {
    return fetch('/api/rooms').then(x => x.json());
  },

  // ── 角色/选角 ──
  async getCharacters() {
    return fetch('/api/characters').then(x => x.json());
  },

  async getMyDraft(roomId, username) {
    return fetch('/api/my-draft?roomId=' + roomId + '&username=' + encodeURIComponent(username)).then(x => x.json());
  },

  async getCharacterStates(roomId, username) {
    return fetch('/api/character-states?roomId=' + roomId + '&username=' + encodeURIComponent(username)).then(x => x.json());
  },

  async getBattleSelections(roomId) {
    return fetch('/api/battle-selections?roomId=' + roomId).then(x => x.json());
  },

  async getAllDraft(roomId) {
    return fetch('/api/all-draft?roomId=' + roomId).then(x => x.json());
  },

  // ── 对局历史 ──
  async getGameHistory(username) {
    return fetch('/api/game-history?username=' + encodeURIComponent(username)).then(x => x.json());
  },

  async getGameHistoryDetail(roomId) {
    return fetch('/api/game-history-detail?roomId=' + roomId).then(x => x.json());
  },

  // ── CSV ──
  async uploadCSV(text) {
    return fetch('/api/upload-csv', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text
    }).then(x => x.json());
  }
};
