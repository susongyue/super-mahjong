/**
 * components.js — 可复用 UI 组件
 * 依赖: Utils
 */

// ── 技能类型定义 ──
window.SKILL_TYPES = {
  limit:   { label: '限定', icon: '', cls: 'limit', order: 1 },
  innate:  { label: '固有', icon: '', cls: 'innate', order: 2 },
  passive: { label: '被动', icon: '', cls: 'passive', order: 3 },
  extra:   { label: '附加', icon: '', cls: 'extra', order: 4 }
};

window.Components = {

  // ══════ 技能标签 ══════
  renderSkillTags(charData, clickable = false) {
    const skills = [];
    const u = window.Utils;
    if (charData.limit)   skills.push({ key: 'limit', text: charData.limit });
    if (charData.innate)  skills.push({ key: 'innate', text: charData.innate });
    if (charData.passive) skills.push({ key: 'passive', text: charData.passive });
    if (charData.extra)   skills.push({ key: 'extra', text: charData.extra });

    return skills.map(s => {
      const st = window.SKILL_TYPES[s.key];
      const onClick = clickable ? ' onclick="event.stopPropagation();Components.showSkillDetail(\'' + u.escHTML(s.text) + '\',\'' + st.label + '\',\'' + st.cls + '\')"' : '';
      return '<span class="skill-tag ' + st.cls + '"' + onClick + '><span class="tag-icon">' + st.icon + '</span>' + st.label + '</span>';
    }).join('');
  },

  /** 技能详情弹窗（小弹窗，适合移动端） */
  showSkillDetail(text, label, cls) {
    const st = window.SKILL_TYPES;
    const style = Object.entries(st).find(([, v]) => v.cls === cls);
    const icon = style ? style[1].icon : '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal-dialog">' +
      '<div class="dialog-header"><div class="dialog-title">' + icon + ' ' + label + '技能</div>' +
      '<button class="dialog-close" onclick="this.closest(\'.modal-overlay\').remove()">X</button></div>' +
      '<div class="dialog-body"><div class="dialog-skill-type ' + cls + '">' + icon + ' ' + label + '</div>' +
      '<div class="dialog-desc">' + window.Utils.escHTML(text) + '</div></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function escClose(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escClose); }
    });
  },

  // ══════ 策略标签 ══════
  renderStrategyTags(tags) {
    if (!tags || !tags.length) return '';
    return '<div class="strategy-tags">' + tags.map(t =>
      '<span class="strategy-tag ' + window.Utils.escHTML(t) + '">' + window.Utils.escHTML(t) + '</span>'
    ).join('') + '</div>';
  },

  // ══════ 角色卡片（紧凑版 ~ pool/draft） ══════
  renderCharCard(charData, opts = {}) {
    const u = window.Utils;
    const { clickable = false, charName = '' } = opts;
    const cls = clickable ? 'char-card draft-char-pickable' : 'char-card';
    const dataAttr = clickable ? ' data-char-name="' + u.escHTML(charData.name) + '"' : '';
    const img = u.charImageHTML([charData], charData.name, 'normal');

    return '<div class="' + cls + '"' + dataAttr + '>' +
      '<div class="char-card-header">' +
        img +
        '<div class="char-info">' +
          '<div class="faction-badge">' + u.escHTML(charData.faction || '无阵营') + '</div>' +
          '<div class="char-name">' + u.escHTML(charData.name) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="char-card-body">' +
        '<div class="char-meta"><span class="tier">Tier ' + u.escHTML(charData.tier) + '</span>' +
          (charData.limit ? ' <span class="limit-tag">限' + u.escHTML(charData.limit) + '</span>' : '') +
        '</div>' +
        '<div class="skill-tags">' + this.renderSkillTags(charData) + '</div>' +
      '</div>' +
    '</div>';
  },

  // ══════ 角色卡片（完整版 ~ game选将页 · 四区域布局） ══════
  renderCharCardFull(charData, opts = {}) {
    const u = window.Utils;
    const {
      isSelected = false, isResting = false, isRetain = false,
      onDeploy, onDetail, idx = 0
    } = opts;

    const isBlocked = isResting && !isRetain;
    const isRestingRetain = isResting && isRetain;

    let extraClasses = '';
    if (isSelected) extraClasses += ' selected';
    if (isBlocked) extraClasses += ' resting';
    if (isRestingRetain) extraClasses += ' resting-retain';

    const badges = [];
    if (isRestingRetain) badges.push('<div class="resting-badge retain-active">轮休·可出战</div>');
    else if (isResting) badges.push('<div class="resting-badge">休息中</div>');
    if (isRetain && !isResting) badges.push('<div class="retain-badge">保留</div>');

    const img = u.charImageHTML([charData], charData.name, 'normal');
    const skillTagsHTML = this.renderSkillTags(charData);
    const strategyHTML = this.renderStrategyTags(charData.tags);

    const deployBtn = isBlocked
      ? '<button class="btn-detail" onclick="event.stopPropagation();' + (onDetail || '') + '">详情</button>'
      : isSelected
        ? '<button class="btn-deploy deployed" onclick="event.stopPropagation();' + (onDeploy ? onDeploy.replace('deploy', 'cancel') : '') + '"> 已出战</button>'
        : '<button class="btn-deploy" onclick="event.stopPropagation();' + (onDeploy || '') + '">出战</button>';

    return '<div class="char-card' + extraClasses + '" onclick="' + (onDetail || '') + '">' +
      badges.join('') +
      // ① 头部区域
      '<div class="char-card-header">' + img +
        '<div class="char-info">' +
          '<div class="faction-badge">' + u.escHTML(charData.faction || '无阵营') + '</div>' +
          '<div class="char-name">' + u.escHTML(charData.name) + '</div>' +
          '<div class="char-meta"><span class="tier">Tier ' + u.escHTML(charData.tier) + '</span></div>' +
        '</div>' +
      '</div>' +
      // ② 技能区域
      (skillTagsHTML ? '<div class="skill-area"><div class="skill-tags">' + skillTagsHTML + '</div></div>' : '') +
      // ③ 策略标签区域
      (strategyHTML ? '<div class="tag-area">' + strategyHTML + '</div>' : '') +
      // ④ 操作按钮区域
      '<div class="card-actions">' +
        '<button class="btn-detail" onclick="event.stopPropagation();' + (onDetail || '') + '">详情</button>' +
        deployBtn +
      '</div>' +
    '</div>';
  },

  // ══════ 全屏角色详情弹窗 ══════
  openCharFullscreen(charData, opts = {}) {
    const u = window.Utils;
    const {
      onDeploy, onCancel, playerName = '', isResting = false,
      isRetain = false, isSelected = false, isBlocked = false
    } = opts;

    const overlay = document.createElement('div');
    overlay.className = 'char-fullscreen-overlay';
    overlay.id = 'charFullscreenTemp';

    const skills = [];
    if (charData.limit)   skills.push({ key: 'limit', text: charData.limit });
    if (charData.innate)  skills.push({ key: 'innate', text: charData.innate });
    if (charData.passive) skills.push({ key: 'passive', text: charData.passive });
    if (charData.extra)   skills.push({ key: 'extra', text: charData.extra });

    const bodyHTML = skills.map(s => {
      const st = window.SKILL_TYPES[s.key];
      return '<div class="fs-skill-block"><span class="fs-skill-label ' + st.cls + '">' + st.icon + ' ' + st.label + '技能</span><div class="fs-skill-text">' + u.escHTML(s.text) + '</div></div>';
    }).join('') + (charData.note ? '<div class="fs-skill-block"><span class="fs-skill-label note">备注</span><div class="fs-skill-text">' + u.escHTML(charData.note) + '</div></div>' : '');

    let deployBtnHTML = '';
    if (isBlocked && !isRetain) {
      deployBtnHTML = '<button class="fs-deploy-btn blocked" disabled>休息中，无法出战</button>';
    } else if (isSelected) {
      deployBtnHTML = '<button class="fs-deploy-btn deployed" id="fsDeployBtnTemp">已出战（点击取消）</button>';
    } else {
      deployBtnHTML = '<button class="fs-deploy-btn" id="fsDeployBtnTemp">出战</button>';
    }

    const retainInfo = (isResting && isRetain)
      ? '<div class="fs-retain-info">该角色拥有<strong>保留</strong>效果，休息状态下仍可出战！</div>'
      : (isRetain && !isResting)
        ? '<div class="fs-retain-info">该角色拥有<strong>保留</strong>效果，出战后仍可在下回合继续出战</div>'
        : '';

    const tierHTML = 'Tier ' + (charData.tier || '?') + (playerName ? '（' + u.escHTML(playerName) + '）' : '') +
      (charData.tags && charData.tags.length ? ' · ' + charData.tags.map(t => '<span class="strategy-tag ' + t + '">' + u.escHTML(t) + '</span>').join(' ') : '');

    const img = u.charImageHTML([charData], charData.name, 'big');

    overlay.innerHTML =
      '<div class="fs-header"><div class="fs-header-left">' +
        '<div id="fsAvatarTemp">' + img + '</div>' +
        '<div class="fs-header-text">' +
          '<div class="fs-char-name">' + u.escHTML(charData.name) + '</div>' +
          '<div class="fs-char-tier">' + tierHTML + '</div>' +
          '<div class="fs-faction-badge">' + u.escHTML(charData.faction || '无阵营') + '</div>' +
        '</div>' +
      '</div>' +
      '<button class="fs-close">X</button></div>' +
      '<div class="fs-body">' + bodyHTML + '</div>' +
      '<div id="fsRetainTemp">' + retainInfo + '</div>' +
      deployBtnHTML +
      '<div class="fs-footer"><span class="fs-footer-hint">按 ESC 关闭</span></div>';

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const close = () => {
      overlay.remove();
      document.body.style.overflow = '';
    };

    overlay.querySelector('.fs-close').onclick = close;
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });

    const deployBtn = overlay.querySelector('#fsDeployBtnTemp');
    if (deployBtn) {
      if (isSelected && onCancel) {
        deployBtn.onclick = () => { close(); onCancel(); };
      } else if (!isBlocked && onDeploy) {
        deployBtn.onclick = () => { close(); onDeploy(); };
      }
    }

    const escHandler = e => {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  },

  // ══════ 无数据占位 ══════
  renderNoData(msg = '暂无数据') {
    return '<div class="no-data">' + msg + '</div>';
  },

  // ══════ Loading ══════
  renderLoading(msg = '加载中...') {
    return '<div class="no-data"><span class="loading-spinner"></span> ' + msg + '</div>';
  }
};
