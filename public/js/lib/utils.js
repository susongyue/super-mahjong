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

  /** 角色头像 HTML（从角色池查 image 字段） */
  charImageHTML(chars, name, size = 'normal') {
    const c = (chars || []).find(x => x.name === name);
    const img = c && c.image;
    if (img) {
      const cls = size === 'big' ? 'fs-avatar' : 'char-avatar';
      return '<img class="' + cls + '" src="/png/' + img + '" alt="' + this.escHTML(name) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">';
    }
    const cls = size === 'big' ? 'fs-avatar-placeholder' : 'char-avatar-placeholder';
    return '<div class="' + cls + '">' + (name || '').charAt(0) + '</div>';
  },

  /** 玩家头像 HTML（用户自定义头像） */
  playerAvatarHTML(avatar) {
    if (!avatar) avatar = '';
    if (avatar.startsWith('/avatars/')) {
      return '<img src="' + avatar + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
    }
    return avatar;
  }
};
