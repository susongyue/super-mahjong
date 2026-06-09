/**
 * auth.js — 登录认证 & 用户资料管理
 * 依赖: 无 (纯 localStorage + fetch)
 */
window.Auth = {
  /** 检查登录态，未登录则跳转 */
  check() {
    if (!localStorage.user) {
      location.href = '/login.html';
      return false;
    }
    return true;
  },

  /** 获取当前用户名 */
  user() {
    return localStorage.user || '';
  },

  /** 获取昵称 */
  nickname() {
    return localStorage.nickname || this.user();
  },

  /** 获取头像 */
  avatar() {
    return localStorage.avatar || '';
  },

  /** 获取房间号 */
  roomId() {
    return localStorage.roomId || '';
  },

  /** 渲染导航栏用户信息 */
  renderNav(navUserEl) {
    const avatar = this.avatar();
    const nickname = this.nickname();
    const avatarHTML = (avatar.startsWith('/') || avatar.startsWith('http'))
      ? '<img src="' + avatar + '" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;" decoding="async">'
      : avatar;
    navUserEl.innerHTML = '<span style="cursor:pointer" onclick="location.href=\'/profile.html\'">' + avatarHTML + ' ' + Utils.escHTML(nickname) + '</span>';
  },

  /** 获取房间号并检查 */
  checkRoomId() {
    const rid = this.roomId();
    if (!rid) { location.href = '/lobby.html'; return ''; }
    return rid;
  },

  /** 登出 */
  logout() {
    if (!confirm('确定要退出登录吗？')) return;
    localStorage.clear();
    location.href = '/login.html';
  },

  /** 从服务器同步最新资料到 localStorage（修复头像跨页不刷新） */
  async syncProfile() {
    const username = this.user();
    if (!username) return;
    try {
      const r = await API.getProfile(username);
      if (r.success) {
        localStorage.nickname = r.nickname;
        localStorage.avatar = r.avatar || '';
        if (r.bio !== undefined) localStorage.bio = r.bio;
        return r;
      }
    } catch (e) { /* 网络失败时保留本地缓存 */ }
    return null;
  }
};
