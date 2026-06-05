# 项目长期记忆

## 项目概述
Super Mahjong — 一个多人在线麻将游戏 Web 应用，包含登录、大厅、房间、选角、对战等页面。

## 技术栈
- 前端: 原生 HTML/CSS/JS，无框架
- 后端: Node.js (server.js)
- 主题: 通过 CSS 变量实现深色 (`:root`) 和浅色 (`[data-theme="notion"]`) 双主题

## 主题约定
- 所有颜色应使用 CSS 自定义属性（变量），避免硬编码 `#xxxxxx` 或 `rgba()` 值
- 统一边框粗细为 `2px`
- `--hairline`, `--hairline-soft`, `--hairline-strong` 用于边框颜色
- "备注" 标签统一使用 `.fs-skill-label.note` 类

## 项目文件结构
- `public/` — 前端静态文件
  - `*.html` — 各页面
  - `style.css` — 全局样式
  - `themes.css` — 主题变量定义
  - `js/lib/` — 工具库 (api.js, auth.js, components.js, theme-switcher.js, utils.js)
- `server.js` — 后端服务
- `data/` — JSON 数据文件
