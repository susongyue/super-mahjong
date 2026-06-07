# Changelog

All notable changes to super-mahjong will be documented in this file.

---

## v1.0.1 (2026-06-07)

### 对局历史改造
- **唯一对局 ID**：`game_history` 新增 `game_id` 字段，格式 `g` + timestamp36 + random36，持久化存储
- **排序模式**：时间正序 ↑ / 倒序 ↓ 按钮切换，默认倒序（新→旧）
- **ID 搜索**：输入框防抖 350ms，支持按 `game_id` 或 `room_id` 搜索
- **回合回放**：详情弹窗新增"回合回放"标签，每回合可查看每个玩家选择的出战角色
- **回合导航**：◀ ▶ 按钮切换回合，带 opacity+translateY 过渡动画
- **后端**：`voteEndRound` 自动保存每轮出战选择到 `roundBattleHistory`；`saveGameHistory` 写入 `battle_history` JSONB；API 支持 `sort`/`search`/`gameId` 参数
- **前端**：`history.html` 全面重写（工具栏 + 卡片 + 详情弹窗双标签 + 回合导航）

### 角色图鉴动画
- 搜索/筛选切换：旧卡片逐一出场（0.2s）→ 新卡片逐次入场（0.35s stagger）
- Stagger 延迟防止卡片同时出现，`isRendering` 锁防止快速切换时动画重叠

### 对局历史工具栏重排
- **布局**：刷新按钮移入工具栏，排列为 刷新 → 排序下拉 → 搜索框 → 记录数量
- **排序改为下拉式**：点击展开菜单（时间倒序/时间正序），选择后自动刷新列表；带 ✓ 高亮当前选项和 fade 动画

### 角色图鉴双行布局
- 工具栏从单行 flex 改为纵向两行：
  - 第一行：筛选 chips（全部 / T0 / T1 / T2 / T3）
  - 第二行：搜索框 + 统计条（显示 N 名角色 · 各 tier 数量）

### 投票去重漏洞修复
- **根因**：`roundEndVotes` / `gameEndVotes` 用 `socket.id` 做投票 key，刷新页面后 socket.id 变更，同一玩家可重复投票（4人投票 → 1人刷4票）
- **修复**：改用 `player.name`（用户名，持久标识）做投票 key
- `voteEndRound` / `voteEndGame`：新增 `player` 查找容错（找不到则忽略投票）；`votedNames` 计算从 `p.id` 改为 `p.name`
- `disconnect`：断开连接时清理该玩家名在 `roundEndVotes` / `gameEndVotes` 中的残留记录
- `getRoomState`：投票计数只统计当前在线玩家，过滤孤立 socket.id 投票

### Bug 修复
- 排序下拉按钮 HTML 标签显示为纯文本（`textContent` → `innerHTML`）

### 对局开始时间戳
- `rooms` 和 `game_history` 新增 `started_at TIMESTAMPTZ` 列，记录每场对局的实际开始时间
- 4 处游戏开始点统一设置 `rooms[roomId].startedAt`：`/api/start-game`、`/api/draft-results`、`voteResult`、`draftAllDone`
- `saveRooms` / `saveGameHistory` 写入 `started_at` 到 Supabase
- `loadFromDB` 加载时保留 `startedAt` 字段
- 已有数据库迁移：`ALTER TABLE rooms/game_history ADD COLUMN IF NOT EXISTS started_at`

### 新增 CHANGELOG.md
- 版本变更记录文件，每次改动后追加更新

---

## v1.0.0 (2026-06-07)

### 架构迁移
- **全面迁移到 Supabase**：用户、房间、角色、对局历史、选角结果、socket_rooms 全部存储在 Supabase
- **移除本地存储**：删除 `DATA_DIR`、本地 JSON 读写、`fs.mkdirSync` 等依赖
- **CloudBase 头像存储**：用户头像上传到 CloudBase 云存储（`cloud://` fileID），通过临时 CDN URL 展示

### 角色数据管理
- 角色数据从本地 `characters.json` 迁移到 Supabase `characters` 表
- 移除 CSV 上传端点，仅保留 JSON 上传（同步写 Supabase + 本地备份）
- 76 个角色技能术语统一 + 发动时机明确化

### 新页面
- **角色图鉴**（`encyclopedia.html`）：网格展示、Tier 筛选、名称搜索、详情弹窗
- **对局历史**（`history.html`）：独立页面展示玩家历史对局

### UI 优化
- **Impeccable UI**：恢复浏览器缩放、键盘焦点样式、减少动画偏好、4px 网格对齐、品牌绿色调
- **详情弹窗统一**：居中卡片式详情弹窗替代全屏展开，CSS transition 渐显替代 GSAP 长动画
- **导航栏全站统一**：7 个页面新增"角色图鉴"链接；全局 navbar 遮挡修复
- **移动端优化**：login/lobby 页面 `100dvh` 居中、input/btn ≥44px、`font-size: 16px` 防 iOS 缩放
- **禁止页面右侧水平滚动条**

### Bug 修复
- `profile.html`：补充 GSAP CDN、navbar 数据同步、avatar 安全兜底
- `login.html` 设为首页路由 `/`
- `index.html` `.room-header` 导航栏遮挡修复
- xlsx 同步脚本格式保护加固（模板提取、K列保护、格式注入）

### CloudBase 部署
- Dockerfile（Node 22 Alpine / 端口 3000）
- CloudRun 容器部署：`https://super-mahjong-267217-4-1324905494.sh.run.tcloudbase.com`
- 环境 ID：`sr-mahjong-d0g8mp6w19f37dd37`（上海）

### 数据持久化
- `draftPools` / `finishedRooms` 内存数据持久化到 Supabase
- 服务器重启自动恢复选角池和已结束房间标记
