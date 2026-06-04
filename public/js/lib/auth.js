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
    const avatarHTML = avatar.startsWith('/avatars/')
      ? '<img src="' + avatar + '" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;">'
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
  }
};
