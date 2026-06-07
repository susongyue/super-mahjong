/**
 * utils.js — 通用工具函数
 */
window.Utils = {
  /** HTML 转义 */
  escHTML(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  /** Toast 提示 */
  showToast(msg, duration = 2500) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), duration);
  },

  /** 创建全屏遮罩 */
  createOverlay(innerHTML, className = 'redirect-overlay') {
    const el = document.createElement('div');
    el.className = className;
    el.innerHTML = innerHTML;
    document.body.appendChild(el);
    return el;
  },

  /** 带重试的 fetch */
  async fetchWithRetry(url, options, maxRetry = 3) {
    for (let i = 0; i < maxRetry; i++) {
      try {
        const res = await fetch(url, options);
        return await res.json();
      } catch (e) {
        if (i === maxRetry - 1) throw e;
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
      }
    }
  },

  /** 计时器倒计时 */
  startCountdown(el, seconds, onComplete, prefix = '', suffix = '秒后自动跳转...') {
    let remaining = seconds;
    const timer = setInterval(() => {
      if (remaining <= 0) {
        clearInterval(timer);
        if (onComplete) onComplete();
      } else {
        el.innerText = prefix + ' ' + remaining + ' ' + suffix;
        remaining--;
      }
    }, 1000);
    return timer;
  },

  /** 角色头像 HTML（从角色池查 image 字段，WebP 优先 + PNG 降级） */
  charImageHTML(chars, name, size = 'normal') {
    const c = (chars || []).find(x => x.name === name);
    const img = c && c.image;
    if (img) {
      const cls = size === 'big' ? 'fs-avatar' : 'char-avatar';
      const webpSrc = '/webp/' + img.replace(/\.png$/i, '.webp');
      const pngSrc = '/png/' + img;
      return '<picture>' +
        '<source srcset="' + webpSrc + '" type="image/webp">' +
        '<img class="' + cls + '" src="' + pngSrc + '" alt="' + this.escHTML(name) + '" loading="lazy" onerror="this.style.display=\'none\';this.parentElement.nextElementSibling.style.display=\'flex\';">' +
        '</picture>';
    }
    const cls = size === 'big' ? 'fs-avatar-placeholder' : 'char-avatar-placeholder';
    return '<div class="' + cls + '">' + (name || '').charAt(0) + '</div>';
  },

  /** 玩家头像 HTML（用户自定义头像）
   *  支持：本地路径 /avatars/...、CDN URL https://...、Emoji 文字头像 */
  playerAvatarHTML(avatar) {
    if (!avatar) return '';
    // 任何可显示图片的 URL（本地路径或远程 CDN）→ 渲染 <img>
    if (avatar.startsWith('/') || avatar.startsWith('http://') || avatar.startsWith('https://')) {
      return '<img src="' + avatar + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" loading="lazy">';
    }
    // cloud:// fileID（兜底：后端已解析，不应走到这里）
    if (avatar.startsWith('cloud://')) return '';
    // Emoji / 文字头像 → 直接返回 HTML
    return avatar;
  }
};

/**
 * Nav — 导航栏管理器
 * 根据 localStorage.roomId 动态显示/隐藏游戏相关导航链接
 */
window.Nav = {
  /** 获取当前是否在游戏中 */
  isInGame() {
    return !!localStorage.getItem('roomId');
  },

  /** 退出对局 */
  exitGame() {
    localStorage.removeItem('roomId');
    this.updateLinks();
  },

  /** 更新导航栏中的游戏链接可见性 */
  updateLinks() {
    var inGame = this.isInGame();
    var selectLink = document.getElementById('navGameSelect');
    var battleLink = document.getElementById('navGameBattle');
    if (selectLink) selectLink.style.display = inGame ? '' : 'none';
    if (battleLink) battleLink.style.display = inGame ? '' : 'none';
  }
};
