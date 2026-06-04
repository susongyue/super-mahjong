/**
 * theme-switcher.js — 双主题切换系统
 * 通过 html[data-theme="xxx"] 切换 Spotify / Notion 风格，
 * 偏好自动保存在 localStorage
 */
(function () {
  const THEMES = [
    { id: 'spotify',      name: 'Spotify Dark',    dot: '#1ed760', dark: true },
    { id: 'notion',       name: 'Notion Light',    dot: '#4b3fd9', dark: false }
  ];

  const KEY = 'mahjong-theme';
  const DEFAULT = 'spotify';

  function getTheme() {
    try { return localStorage.getItem(KEY) || DEFAULT; } catch (e) { return DEFAULT; }
  }
  function setTheme(id) {
    try { localStorage.setItem(KEY, id); } catch (e) { /* noop */ }
    document.documentElement.setAttribute('data-theme', id);
    // 亮色主题时切换 meta theme-color
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const t = THEMES.find(t => t.id === id);
      meta.content = t?.dark ? '#000000' : '#ffffff';
    }
  }

  // 初始化
  const current = getTheme();
  document.documentElement.setAttribute('data-theme', current);

  // 等待 DOM 就绪后注入切换器
  function inject() {
    if (document.getElementById('themeSwitcherBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'themeSwitcherBtn';
    btn.className = 'theme-switcher';
    btn.title = '切换主题';
    btn.innerHTML = '🎨';

    const panel = document.createElement('div');
    panel.id = 'themeSwitcherPanel';
    panel.className = 'theme-panel';
    panel.innerHTML =
      '<h4>选择主题</h4>' +
      THEMES.map(t =>
        '<div class="theme-opt' + (t.id === current ? ' active' : '') +
        '" data-theme-id="' + t.id + '">' +
        '<span class="dot" style="background:' + t.dot + '"></span>' +
        t.name + (t.dark ? ' 🌙' : ' ☀️') +
        '</div>'
      ).join('');

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    // 事件
    btn.addEventListener('click', function () {
      panel.classList.toggle('open');
    });

    panel.addEventListener('click', function (e) {
      const opt = e.target.closest('.theme-opt');
      if (!opt) return;
      const id = opt.getAttribute('data-theme-id');
      setTheme(id);
      panel.querySelectorAll('.theme-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      panel.classList.remove('open');
    });

    // 点击外部关闭
    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== btn) {
        panel.classList.remove('open');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
