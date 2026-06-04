/**
 * theme-switcher.js — 双主题切换系统
 * 通过 html[data-theme="xxx"] 切换 Spotify / Notion 风格，
 * 偏好自动保存在 localStorage
 */
(function () {
  const THEMES = [
    { id: 'spotify', name: 'Spotify Dark', dot: '#1ed760', dark: true },
    { id: 'notion',  name: 'Notion Light', dot: '#1ed760', dark: false }
  ];

  const KEY = 'mahjong-theme';
  const DEFAULT = 'spotify';

  function getTheme() {
    try { return localStorage.getItem(KEY) || DEFAULT; } catch (e) { return DEFAULT; }
  }
  function setTheme(id) {
    try { localStorage.setItem(KEY, id); } catch (e) { /* noop */ }
    document.documentElement.setAttribute('data-theme', id);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const t = THEMES.find(t => t.id === id);
      meta.content = t?.dark ? '#000000' : '#ffffff';
    }
  }

  // 初始化（如果 <head> 中的内联脚本已经设置过，这里会保持一致）
  const current = getTheme();
  document.documentElement.setAttribute('data-theme', current);

  // 暴露全局 API
  window.Theme = { get: getTheme, set: setTheme, list: THEMES };
})();
